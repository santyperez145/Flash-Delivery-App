// El catálogo del comercio: restaurantes y su menú embebido (ARC-001).
//
// Menú mutaciones → `menu-repository.js`. Sucursales/horarios/stock →
// `branch-repository.js`. `mapCatalogItem` se exporta para carrito/pedidos —
// el catálogo no importa de ellos.
import { postgresPool } from "./postgres.js";
import { pesos } from "./money.js";

export function mapCatalogItem(row) {
  const metadata = row.item_metadata || row.metadata || {};
  return {
    id: row.item_public_id || row.public_id,
    name: row.item_name || row.name,
    description: row.description || "",
    category: row.category,
    price: pesos(row.unit_price_cents),
    rating: Number(metadata.rating || 0),
    timeMin: Number(metadata.timeMin || 0),
    kcal: Number(metadata.kcal || 0),
    stock: Boolean(row.available),
    image: metadata.image || "",
    tags: metadata.tags || [],
    modifierGroups: row.modifier_groups || [],
    dietaryLabels: row.dietary_labels || [],
    allergens: row.allergens || [],
  };
}

export async function getPostgresRestaurants({ publicIds = null, ownerPublicId = null } = {}) {
  const result = await postgresPool.query(
    `
    SELECT m.id, m.public_id, m.owner_id, owner.public_id AS owner_public_id,
      m.name,
      COALESCE(branch.address, m.address) address,
      CASE
        WHEN branch.id IS NULL THEN m.open
        ELSE branch.open AND branch.status = 'active' AND app.branch_is_scheduled_open(branch.id, now())
      END open,
      COALESCE(branch.open, m.open) manual_open,
      COALESCE(branch.eta_min, m.eta_min) eta_min,
      m.delivery_fee_cents,
      m.metadata,
      (SELECT round(avg(r.score),2) FROM ratings r WHERE r.subject_type='merchant' AND r.subject_id=m.id) AS merchant_rating,
      ST_Y(COALESCE(branch.location,m.location)::geometry) AS lat, ST_X(COALESCE(branch.location,m.location)::geometry) AS lng,
      ci.public_id AS item_public_id, ci.name AS item_name, ci.description,
       ci.category, ci.unit_price_cents, COALESCE(inventory.available,ci.available) available, ci.metadata AS item_metadata,
      (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id',
              g.public_id,
              'name',
              g.name,
              'min',
              g.minimum_selections,
              'max',
              g.maximum_selections,
              'required',
              g.minimum_selections > 0,
              'modifiers',
              (
                SELECT COALESCE(
                  jsonb_agg(
                    jsonb_build_object(
                      'id',
                      mo.public_id,
                      'name',
                      mo.name,
                      'price',
                      mo.price_cents / 100.0,
                      'available',
                      mo.available
                    )
                    ORDER BY mo.sort_order, mo.created_at
                  ),
                  '[]'
                )
                FROM catalog_modifiers mo
                WHERE mo.group_id = g.id
              )
            )
            ORDER BY g.sort_order, g.created_at
          ),
          '[]'
        )
        FROM catalog_modifier_groups g
        WHERE g.catalog_item_id = ci.id AND g.active
      ) modifier_groups,
      (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object('code', d.code, 'name', d.name)
            ORDER BY d.name
          ),
          '[]'
        )
        FROM catalog_item_dietary_labels x
        JOIN dietary_labels d ON d.code = x.dietary_code
        WHERE x.catalog_item_id = ci.id AND d.active
      ) dietary_labels,
      (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'code',
              a.code,
              'name',
              a.name,
              'presence',
              x.presence
            )
            ORDER BY a.name
          ),
          '[]'
        )
        FROM catalog_item_allergens x
        JOIN allergens a ON a.code = x.allergen_code
        WHERE x.catalog_item_id = ci.id AND a.active
      ) allergens,
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id',
            b.public_id,
            'name',
            b.name,
            'address',
            b.address,
            'lat',
            ST_Y(b.location::geometry),
            'lng',
            ST_X(b.location::geometry),
            'open',
            b.open
              AND b.status = 'active'
              AND app.branch_is_scheduled_open(b.id, now()),
            'manualOpen',
            b.open,
            'status',
            b.status,
            'etaMin',
            b.eta_min,
            'isPrimary',
            b.is_primary,
            'timezone',
            b.timezone,
            'weeklyHours',
            (
              SELECT COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'weekday',
                    h.weekday,
                    'opensAt',
                    to_char(h.opens_at, 'HH24:MI'),
                    'closesAt',
                    to_char(h.closes_at, 'HH24:MI'),
                    'enabled',
                    h.enabled
                  )
                  ORDER BY h.weekday
                ),
                '[]'
              )
              FROM branch_operating_hours h
              WHERE h.branch_id = b.id
            ),
            'scheduleExceptions',
            (
              SELECT COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'date',
                    e.local_date,
                    'isOpen',
                    e.is_open,
                    'opensAt',
                    CASE
                      WHEN e.opens_at IS NULL THEN NULL
                      ELSE to_char(e.opens_at, 'HH24:MI')
                    END,
                    'closesAt',
                    CASE
                      WHEN e.closes_at IS NULL THEN NULL
                      ELSE to_char(e.closes_at, 'HH24:MI')
                    END,
                    'reason',
                    e.reason
                  )
                  ORDER BY e.local_date
                ),
                '[]'
              )
              FROM branch_schedule_exceptions e
              WHERE e.branch_id = b.id
                AND e.local_date >= ((now() AT TIME ZONE b.timezone)::date - interval '1 day')
                AND e.local_date <= ((now() AT TIME ZONE b.timezone)::date + interval '60 days')
            ),
            'inventory',
            (
              SELECT COALESCE(
                jsonb_object_agg(
                  c.public_id,
                  jsonb_build_object(
                    'available',
                    i.available,
                    'stockQuantity',
                    i.stock_quantity,
                    'version',
                    i.version
                  )
                ),
                '{}'
              )
              FROM catalog_branch_inventory i
              JOIN catalog_items c ON c.id = i.catalog_item_id
              WHERE i.branch_id = b.id
            )
          )
          ORDER BY b.is_primary DESC, b.created_at
        )
        FROM merchant_branches b
        WHERE b.merchant_id = m.id AND b.status <> 'closed'
      ) branches
    FROM merchants m
    JOIN users owner ON owner.id = m.owner_id
    LEFT JOIN LATERAL(SELECT * FROM merchant_branches b WHERE b.merchant_id=m.id AND b.is_primary LIMIT 1) branch ON true
    LEFT JOIN catalog_items ci ON ci.merchant_id = m.id
    LEFT JOIN catalog_branch_inventory inventory ON inventory.branch_id=branch.id AND inventory.catalog_item_id=ci.id
    WHERE m.status = 'active' AND ($1::text[] IS NULL OR m.public_id=ANY($1::text[]))
      AND ($2::text IS NULL OR owner.public_id=$2)
    ORDER BY m.created_at, ci.created_at
  `,
    [publicIds, ownerPublicId],
  );
  const restaurants = new Map();
  for (const row of result.rows) {
    if (!restaurants.has(row.public_id)) {
      const metadata = row.metadata || {};
      restaurants.set(row.public_id, {
        id: row.public_id,
        ownerId: row.owner_public_id,
        name: row.name,
        cuisine: metadata.cuisine || "Comercio",
        rating: Number(row.merchant_rating ?? metadata.rating ?? 0),
        distanceKm: Number(metadata.distanceKm || 0),
        etaMin: row.eta_min,
        deliveryFee: pesos(row.delivery_fee_cents),
        open: row.open,
        manualOpen: row.manual_open,
        image: metadata.image || "",
        cover: metadata.cover || metadata.image || "",
        badge: metadata.badge || "",
        address: row.address,
        lat: Number(row.lat),
        lng: Number(row.lng),
        menu: [],
        extras: metadata.extras || [],
        branches: row.branches || [],
      });
    }
    if (row.item_public_id) restaurants.get(row.public_id).menu.push(mapCatalogItem(row));
  }
  return [...restaurants.values()];
}

const publicRestaurant = (restaurant) => ({
  id: restaurant.id,
  name: restaurant.name,
  cuisine: restaurant.cuisine,
  rating: restaurant.rating,
  distanceKm: restaurant.distanceKm,
  etaMin: restaurant.etaMin,
  deliveryFee: restaurant.deliveryFee,
  open: restaurant.open,
  image: restaurant.image,
  cover: restaurant.cover,
  badge: restaurant.badge,
  address: restaurant.address,
  lat: restaurant.lat,
  lng: restaurant.lng,
  menu: restaurant.menu,
  extras: restaurant.extras,
  branches: (restaurant.branches || []).map((branch) => ({
    id: branch.id,
    name: branch.name,
    address: branch.address,
    lat: branch.lat,
    lng: branch.lng,
    open: branch.open,
    status: branch.status,
    etaMin: branch.etaMin,
    isPrimary: branch.isPrimary,
  })),
});
export async function getPostgresRestaurantPage({ limit = 20, cursor = null, query = "" } = {}) {
  const page = await postgresPool.query(
      `SELECT id, public_id, created_at,
         to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_created_at
       FROM merchants
       WHERE status = 'active'
         AND ($1 = '' OR name ILIKE '%' || $1 || '%' OR metadata->>'cuisine' ILIKE '%' || $1 || '%')
         AND ($2::timestamptz IS NULL OR (created_at, id) > ($2::timestamptz, $3::uuid))
       ORDER BY created_at, id
       LIMIT $4`,
      [query.trim(), cursor?.createdAt || null, cursor?.id || null, limit + 1],
    ),
    hasMore = page.rows.length > limit,
    rows = page.rows.slice(0, limit),
    restaurants = await getPostgresRestaurants({ publicIds: rows.map((row) => row.public_id) }),
    byId = new Map(restaurants.map((item) => [item.id, publicRestaurant(item)])),
    last = rows.at(-1);
  return {
    restaurants: rows.map((row) => byId.get(row.public_id)).filter(Boolean),
    nextCursor:
      hasMore && last
        ? Buffer.from(JSON.stringify({ createdAt: last.cursor_created_at, id: last.id })).toString(
            "base64url",
          )
        : null,
  };
}

export async function getPostgresOperationsRestaurantPage({
  limit = 50,
  cursor = null,
  query = "",
} = {}) {
  const page = await postgresPool.query(
    `SELECT id, public_id,
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_created_at
     FROM merchants
     WHERE ($1 = '' OR name ILIKE '%' || $1 || '%' OR public_id ILIKE '%' || $1 || '%')
       AND ($2::timestamptz IS NULL OR (created_at, id) > ($2::timestamptz, $3::uuid))
     ORDER BY created_at, id
     LIMIT $4`,
    [query.trim(), cursor?.createdAt || null, cursor?.id || null, limit + 1],
  );
  const hasMore = page.rows.length > limit,
    rows = page.rows.slice(0, limit),
    restaurants = await getPostgresRestaurants({ publicIds: rows.map((row) => row.public_id) }),
    byId = new Map(restaurants.map((item) => [item.id, item])),
    last = rows.at(-1);
  return {
    restaurants: rows.map((row) => byId.get(row.public_id)).filter(Boolean),
    nextCursor:
      hasMore && last
        ? Buffer.from(JSON.stringify({ createdAt: last.cursor_created_at, id: last.id })).toString(
            "base64url",
          )
        : null,
  };
}

export async function updatePostgresRestaurant(publicId, changes) {
  const fields = [];
  const values = [];
  if (typeof changes.open === "boolean") {
    values.push(changes.open);
    fields.push(`open = $${values.length}`);
  }
  if (typeof changes.etaMin === "number") {
    values.push(Math.max(5, Math.round(changes.etaMin)));
    fields.push(`eta_min = $${values.length}`);
  }
  if (fields.length) {
    const client = await postgresPool.connect();
    try {
      await client.query("BEGIN");
      values.push(publicId);
      await client.query(
        `UPDATE merchants SET ${fields.join(", ")} WHERE public_id = $${values.length}`,
        values,
      );
      const branchFields = [];
      const branchValues = [];
      if (typeof changes.open === "boolean") {
        branchValues.push(changes.open);
        branchFields.push(`open=$${branchValues.length}`);
      }
      if (typeof changes.etaMin === "number") {
        branchValues.push(Math.max(5, Math.round(changes.etaMin)));
        branchFields.push(`eta_min=$${branchValues.length}`);
      }
      branchValues.push(publicId);
      await client.query(
        `UPDATE merchant_branches b SET ${branchFields.join(",")},updated_at=now() FROM merchants m WHERE b.merchant_id=m.id AND b.is_primary AND m.public_id=$${branchValues.length}`,
        branchValues,
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return (await getPostgresRestaurants()).find((restaurant) => restaurant.id === publicId) || null;
}
