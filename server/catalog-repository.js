// El catálogo del comercio: qué se vende, dónde y cuándo (ticket ARC-001).
//
// Primera de las tres partes de `commerce-repository.js`, que juntaba 1.737
// líneas de catálogo, pedidos y conductores en un archivo. El corte es por
// dueño del dato: todo lo de acá lo escribe el comercio —restaurante, menú,
// agregados, etiquetas dietarias, sucursales, stock y horarios— y lo lee el
// resto de la plataforma.
//
// `mapCatalogItem` se exporta a propósito. El carrito (`cart-repository.js`)
// muestra ítems de catálogo; los pedidos dependen del catálogo y nunca al
// revés. Si alguna vez este archivo necesita importar de `order-repository.js`
// o `cart-repository.js`, el corte está mal.
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

export async function createPostgresMenuItem(merchantPublicId, item) {
  const merchant = await postgresPool.query(
    "SELECT id, eta_min, metadata FROM merchants WHERE public_id = $1",
    [merchantPublicId],
  );
  if (!merchant.rows[0]) return null;
  await postgresPool.query(
    `INSERT INTO catalog_items(public_id, merchant_id, sku, name, description, category, unit_price_cents, available, metadata)
     VALUES ($1, $2, $1, $3, $4, $5, $6, true, $7)`,
    [
      item.id,
      merchant.rows[0].id,
      item.name,
      item.description,
      item.category,
      Math.round(item.price * 100),
      {
        rating: item.rating,
        timeMin: item.timeMin,
        kcal: item.kcal,
        image: item.image,
        tags: item.tags,
      },
    ],
  );
  await postgresPool.query(
    `INSERT INTO catalog_branch_inventory(branch_id, catalog_item_id, available)
     SELECT b.id, c.id, true
     FROM merchant_branches b
     JOIN catalog_items c ON c.merchant_id = b.merchant_id
     WHERE b.merchant_id = $1 AND c.public_id = $2
     ON CONFLICT DO NOTHING`,
    [merchant.rows[0].id, item.id],
  );
  return (
    (await getPostgresRestaurants()).find((restaurant) => restaurant.id === merchantPublicId) ||
    null
  );
}

export async function updatePostgresMenuItem(merchantPublicId, itemPublicId, changes) {
  const fields = [];
  const values = [];
  if (typeof changes.stock === "boolean") {
    values.push(changes.stock);
    fields.push(`available = $${values.length}`);
  }
  if (typeof changes.price === "number") {
    values.push(Math.round(Math.max(100, changes.price) * 100));
    fields.push(`unit_price_cents = $${values.length}`);
  }
  if (!fields.length)
    return (
      (await getPostgresRestaurants()).find((restaurant) => restaurant.id === merchantPublicId) ||
      null
    );
  values.push(itemPublicId, merchantPublicId);
  await postgresPool.query(
    `UPDATE catalog_items ci SET ${fields.join(", ")}
     FROM merchants m WHERE ci.merchant_id = m.id AND ci.public_id = $${values.length - 1} AND m.public_id = $${values.length}`,
    values,
  );
  if (typeof changes.stock === "boolean")
    await postgresPool.query(
      `UPDATE catalog_branch_inventory i
       SET available = $3, version = version + 1, updated_at = now()
       FROM merchant_branches b
       JOIN merchants m ON m.id = b.merchant_id
       JOIN catalog_items c ON c.merchant_id = m.id
       WHERE i.branch_id = b.id AND i.catalog_item_id = c.id
         AND m.public_id = $1 AND c.public_id = $2`,
      [merchantPublicId, itemPublicId, changes.stock],
    );
  return (
    (await getPostgresRestaurants()).find((restaurant) => restaurant.id === merchantPublicId) ||
    null
  );
}

export async function replacePostgresItemModifiers({
  merchantPublicId,
  itemPublicId,
  actorPublicId,
  admin = false,
  groups,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const item = (
      await client.query(
        `SELECT c.id
         FROM catalog_items c
         JOIN merchants m ON m.id = c.merchant_id
         JOIN users u ON u.id = m.owner_id
         WHERE m.public_id = $1 AND c.public_id = $2
           AND ($4::boolean OR u.public_id = $3)
         FOR UPDATE OF c`,
        [merchantPublicId, itemPublicId, actorPublicId, admin],
      )
    ).rows[0];
    if (!item)
      throw Object.assign(new Error("Producto no encontrado o no autorizado"), { status: 404 });
    await client.query("DELETE FROM catalog_modifier_groups WHERE catalog_item_id=$1", [item.id]);
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const group = groups[groupIndex],
        inserted = (
          await client.query(
            `INSERT INTO catalog_modifier_groups(public_id,catalog_item_id,name,minimum_selections,maximum_selections,sort_order,active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [group.id, item.id, group.name, group.min, group.max, groupIndex, group.active],
          )
        ).rows[0];
      for (let modifierIndex = 0; modifierIndex < group.modifiers.length; modifierIndex++) {
        const modifier = group.modifiers[modifierIndex];
        await client.query(
          `INSERT INTO catalog_modifiers(public_id,group_id,name,price_cents,available,sort_order) VALUES($1,$2,$3,$4,$5,$6)`,
          [
            modifier.id,
            inserted.id,
            modifier.name,
            Math.round(modifier.price * 100),
            modifier.available,
            modifierIndex,
          ],
        );
      }
    }
    await client.query("COMMIT");
    return (await getPostgresRestaurants()).find(
      (restaurant) => restaurant.id === merchantPublicId,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505")
      throw Object.assign(
        new Error("Los identificadores de grupos y agregados no pueden repetirse"),
        { status: 409 },
      );
    throw error;
  } finally {
    client.release();
  }
}

export async function replacePostgresItemDietary({
  merchantPublicId,
  itemPublicId,
  actorPublicId,
  admin = false,
  dietaryLabels,
  allergens,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const item = (
      await client.query(
        `SELECT c.id
         FROM catalog_items c
         JOIN merchants m ON m.id = c.merchant_id
         JOIN users u ON u.id = m.owner_id
         WHERE m.public_id = $1 AND c.public_id = $2
           AND ($4::boolean OR u.public_id = $3)
         FOR UPDATE OF c`,
        [merchantPublicId, itemPublicId, actorPublicId, admin],
      )
    ).rows[0];
    if (!item)
      throw Object.assign(new Error("Producto no encontrado o no autorizado"), { status: 404 });
    const validDietary = (
        await client.query(
          "SELECT code FROM dietary_labels WHERE active AND code=ANY($1::text[])",
          [dietaryLabels],
        )
      ).rows.map((row) => row.code),
      validAllergens = (
        await client.query("SELECT code FROM allergens WHERE active AND code=ANY($1::text[])", [
          allergens.map((entry) => entry.code),
        ])
      ).rows.map((row) => row.code);
    if (validDietary.length !== dietaryLabels.length || validAllergens.length !== allergens.length)
      throw Object.assign(new Error("Existe una dieta o alérgeno no reconocido"), { status: 400 });
    await client.query("DELETE FROM catalog_item_dietary_labels WHERE catalog_item_id=$1", [
      item.id,
    ]);
    await client.query("DELETE FROM catalog_item_allergens WHERE catalog_item_id=$1", [item.id]);
    for (const code of dietaryLabels)
      await client.query(
        "INSERT INTO catalog_item_dietary_labels(catalog_item_id,dietary_code) VALUES($1,$2)",
        [item.id, code],
      );
    for (const allergen of allergens)
      await client.query(
        "INSERT INTO catalog_item_allergens(catalog_item_id,allergen_code,presence) VALUES($1,$2,$3)",
        [item.id, allergen.code, allergen.presence],
      );
    await client.query("COMMIT");
    return (await getPostgresRestaurants()).find(
      (restaurant) => restaurant.id === merchantPublicId,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updatePostgresBranch({
  merchantPublicId,
  branchPublicId,
  actorPublicId,
  admin = false,
  changes,
}) {
  const fields = [],
    values = [];
  for (const [key, column] of [
    ["open", "open"],
    ["etaMin", "eta_min"],
    ["status", "status"],
  ])
    if (changes[key] !== undefined) {
      values.push(changes[key]);
      fields.push(`${column}=$${values.length}`);
    }
  if (!fields.length) throw Object.assign(new Error("No hay cambios"), { status: 400 });
  values.push(merchantPublicId, branchPublicId, actorPublicId, admin);
  const result = await postgresPool.query(
    `UPDATE merchant_branches b
     SET ${fields.join(",")}, updated_at = now()
     FROM merchants m
     JOIN users u ON u.id = m.owner_id
     WHERE b.merchant_id = m.id
       AND m.public_id = $${values.length - 3}
       AND b.public_id = $${values.length - 2}
       AND ($${values.length}::boolean OR u.public_id = $${values.length - 1})
     RETURNING b.public_id`,
    values,
  );
  if (!result.rowCount)
    throw Object.assign(new Error("Sucursal no encontrada o no autorizada"), { status: 404 });
  return (await getPostgresRestaurants()).find((r) => r.id === merchantPublicId);
}
export async function updatePostgresBranchInventory({
  merchantPublicId,
  branchPublicId,
  itemPublicId,
  actorPublicId,
  admin = false,
  available,
  stockQuantity,
}) {
  const result = await postgresPool.query(
    `UPDATE catalog_branch_inventory i
     SET available = $6, stock_quantity = $7, version = version + 1, updated_at = now()
     FROM merchant_branches b
     JOIN merchants m ON m.id = b.merchant_id
     JOIN users u ON u.id = m.owner_id
     JOIN catalog_items c ON c.merchant_id = m.id
     WHERE i.branch_id = b.id AND i.catalog_item_id = c.id
       AND m.public_id = $1 AND b.public_id = $2 AND c.public_id = $3
       AND ($5::boolean OR u.public_id = $4)
     RETURNING i.version`,
    [
      merchantPublicId,
      branchPublicId,
      itemPublicId,
      actorPublicId,
      admin,
      available,
      stockQuantity ?? null,
    ],
  );
  if (!result.rowCount)
    throw Object.assign(new Error("Inventario de sucursal no encontrado o no autorizado"), {
      status: 404,
    });
  return (await getPostgresRestaurants()).find((r) => r.id === merchantPublicId);
}

async function lockOwnedBranch(client, { merchantPublicId, branchPublicId, actorPublicId, admin }) {
  const branch = (
    await client.query(
      `SELECT b.id
       FROM merchant_branches b
       JOIN merchants m ON m.id = b.merchant_id
       JOIN users u ON u.id = m.owner_id
       WHERE m.public_id = $1 AND b.public_id = $2
         AND ($4::boolean OR u.public_id = $3)
       FOR UPDATE OF b`,
      [merchantPublicId, branchPublicId, actorPublicId, admin],
    )
  ).rows[0];
  if (!branch)
    throw Object.assign(new Error("Sucursal no encontrada o no autorizada"), { status: 404 });
  return branch;
}

export async function replacePostgresBranchSchedule({
  merchantPublicId,
  branchPublicId,
  actorPublicId,
  admin = false,
  timezone,
  hours,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const branch = await lockOwnedBranch(client, {
      merchantPublicId,
      branchPublicId,
      actorPublicId,
      admin,
    });
    const validZone = (
      await client.query("SELECT 1 FROM pg_timezone_names WHERE name=$1", [timezone])
    ).rows[0];
    if (!validZone) throw Object.assign(new Error("Zona horaria inválida"), { status: 400 });
    await client.query("UPDATE merchant_branches SET timezone=$2,updated_at=now() WHERE id=$1", [
      branch.id,
      timezone,
    ]);
    await client.query("DELETE FROM branch_operating_hours WHERE branch_id=$1", [branch.id]);
    for (const hour of hours)
      await client.query(
        "INSERT INTO branch_operating_hours(branch_id,weekday,opens_at,closes_at,enabled) VALUES($1,$2,$3,$4,$5)",
        [branch.id, hour.weekday, hour.opensAt, hour.closesAt, hour.enabled],
      );
    await client.query("COMMIT");
    return (await getPostgresRestaurants()).find((r) => r.id === merchantPublicId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function upsertPostgresBranchScheduleException({
  merchantPublicId,
  branchPublicId,
  actorPublicId,
  admin = false,
  date,
  isOpen,
  opensAt,
  closesAt,
  reason,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const branch = await lockOwnedBranch(client, {
      merchantPublicId,
      branchPublicId,
      actorPublicId,
      admin,
    });
    await client.query(
      `INSERT INTO branch_schedule_exceptions(
         branch_id, local_date, is_open, opens_at, closes_at, reason
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (branch_id, local_date) DO UPDATE SET
         is_open = excluded.is_open,
         opens_at = excluded.opens_at,
         closes_at = excluded.closes_at,
         reason = excluded.reason,
         updated_at = now()`,
      [branch.id, date, isOpen, isOpen ? opensAt : null, isOpen ? closesAt : null, reason || null],
    );
    await client.query("COMMIT");
    return (await getPostgresRestaurants()).find((r) => r.id === merchantPublicId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
