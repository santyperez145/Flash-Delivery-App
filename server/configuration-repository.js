// Promociones y zonas de servicio (ARC-001).
//
// Tarifas versionadas → `pricing-repository.js`. Acá queda lo que opera
// marketing/cobertura geográfica sin el dual-control de pricing.
import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";

const promoId = () => `PROMO-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
export async function getPostgresPromotions({ includeInactive = false } = {}) {
  const result = await postgresPool.query(
    `SELECT public_id,code,name,description,kind,value,max_discount_cents,min_subtotal_cents,usage_limit,per_user_limit,starts_at,ends_at,rules,active,
  (SELECT count(*)::int FROM promotion_redemptions pr WHERE pr.promotion_id=p.id) usage_count FROM promotions p
  WHERE ($1::boolean OR (active AND now() BETWEEN starts_at AND ends_at)) ORDER BY created_at DESC`,
    [includeInactive],
  );
  return result.rows.map((row) => ({
    id: row.public_id,
    code: row.code,
    title: row.name,
    description: row.description,
    service: row.rules?.service || "food",
    kind: row.kind,
    discountPercent: row.kind === "percentage" ? row.value : 0,
    value: row.value,
    maxDiscount: Number(row.max_discount_cents || 0) / 100,
    minSubtotal: Number(row.min_subtotal_cents) / 100,
    usageLimit: row.usage_limit,
    usageCount: row.usage_count,
    perUserLimit: row.per_user_limit,
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    rules: row.rules,
    active: row.active,
  }));
}

export async function createPostgresPromotion(data) {
  const publicId = promoId();
  await postgresPool.query(
    `INSERT INTO promotions(public_id,code,name,description,kind,value,max_discount_cents,min_subtotal_cents,usage_limit,per_user_limit,starts_at,ends_at,rules,active)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      publicId,
      data.code || null,
      data.title,
      data.description || "",
      data.kind,
      data.value,
      Math.round((data.maxDiscount || 0) * 100) || null,
      Math.round((data.minSubtotal || 0) * 100),
      data.usageLimit || null,
      data.perUserLimit,
      data.startsAt,
      data.endsAt,
      { ...(data.rules || {}), service: data.service },
      data.active,
    ],
  );
  return (await getPostgresPromotions({ includeInactive: true })).find(
    (entry) => entry.id === publicId,
  );
}

export async function updatePostgresPromotion(publicId, data) {
  const current = (
    await postgresPool.query("SELECT * FROM promotions WHERE public_id=$1", [publicId])
  ).rows[0];
  if (!current) throw Object.assign(new Error("Promoción no encontrada"), { status: 404 });
  await postgresPool.query(
    `UPDATE promotions SET code=$2,name=$3,description=$4,kind=$5,value=$6,max_discount_cents=$7,min_subtotal_cents=$8,
      usage_limit=$9,per_user_limit=$10,starts_at=$11,ends_at=$12,rules=$13,active=$14 WHERE public_id=$1`,
    [
      publicId,
      data.code ?? current.code,
      data.title ?? current.name,
      data.description ?? current.description,
      data.kind ?? current.kind,
      data.value ?? current.value,
      data.maxDiscount === undefined
        ? current.max_discount_cents
        : Math.round(data.maxDiscount * 100) || null,
      data.minSubtotal === undefined
        ? current.min_subtotal_cents
        : Math.round(data.minSubtotal * 100),
      data.usageLimit === undefined ? current.usage_limit : data.usageLimit,
      data.perUserLimit ?? current.per_user_limit,
      data.startsAt ?? current.starts_at,
      data.endsAt ?? current.ends_at,
      {
        ...current.rules,
        ...(data.rules || {}),
        ...(data.service ? { service: data.service } : {}),
      },
      data.active ?? current.active,
    ],
  );
  return (await getPostgresPromotions({ includeInactive: true })).find(
    (entry) => entry.id === publicId,
  );
}

export async function getPostgresZones({ citySlug = "buenos-aires" } = {}) {
  const result = await postgresPool.query(
    `SELECT z.public_id,z.name,z.demand_level,z.delivery_multiplier,z.ride_multiplier,z.active,
  ST_AsGeoJSON(z.boundary::geometry)::jsonb boundary,
  count(j.id) FILTER(WHERE j.kind='delivery' AND j.status NOT IN('completed','cancelled'))::int active_orders,
  count(j.id) FILTER(WHERE j.kind='ride' AND j.status NOT IN('completed','cancelled'))::int active_rides
  FROM service_zones z JOIN cities c ON c.id=z.city_id LEFT JOIN jobs j ON j.city_id=z.city_id AND ST_Intersects(z.boundary,j.pickup_location)
  WHERE c.slug=$1 AND c.status IN('beta','active') GROUP BY z.id ORDER BY z.name`,
    [citySlug],
  );
  return result.rows.map((row) => ({
    id: row.public_id,
    name: row.name,
    demandLevel: row.demand_level,
    deliveryMultiplier: Number(row.delivery_multiplier),
    rideMultiplier: Number(row.ride_multiplier),
    activeOrders: row.active_orders,
    activeRides: row.active_rides,
    active: row.active,
    boundary: row.boundary.coordinates[0].map(([lng, lat]) => ({ lat, lng })),
  }));
}

export async function updatePostgresZone(publicId, data) {
  const result = await postgresPool.query(
    `UPDATE service_zones SET name=COALESCE($2,name),demand_level=COALESCE($3,demand_level),
      delivery_multiplier=COALESCE($4,delivery_multiplier),ride_multiplier=COALESCE($5,ride_multiplier),
      active=COALESCE($6,active),updated_at=now() WHERE public_id=$1 RETURNING id`,
    [
      publicId,
      data.name || null,
      data.demandLevel || null,
      data.deliveryMultiplier ?? null,
      data.rideMultiplier ?? null,
      data.active ?? null,
    ],
  );
  if (!result.rows[0]) throw Object.assign(new Error("Zona no encontrada"), { status: 404 });
  return (await getPostgresZones()).find((entry) => entry.id === publicId);
}

export async function getPostgresZonePricing(point) {
  if (!point) return { zoneId: null, deliveryMultiplier: 1, rideMultiplier: 1 };
  const row = (
    await postgresPool.query(
      `SELECT public_id,delivery_multiplier,ride_multiplier FROM service_zones WHERE active AND ST_Covers(boundary::geometry,ST_SetSRID(ST_MakePoint($1,$2),4326)) ORDER BY ST_Area(boundary) LIMIT 1`,
      [point.lng, point.lat],
    )
  ).rows[0];
  return row
    ? {
        zoneId: row.public_id,
        deliveryMultiplier: Number(row.delivery_multiplier),
        rideMultiplier: Number(row.ride_multiplier),
      }
    : { zoneId: null, deliveryMultiplier: 1, rideMultiplier: 1 };
}
