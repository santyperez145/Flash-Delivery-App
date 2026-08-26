import { postgresPool } from "./postgres.js";
import { getPostgresOrders } from "./commerce-repository.js";
import { getPostgresRides, getPostgresShipments } from "./mobility-repository.js";

const encodeCursor = (row) =>
  Buffer.from(JSON.stringify({ createdAt: row.cursor_created_at, id: row.id })).toString(
    "base64url",
  );
export function decodeActivityCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof parsed.id !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(parsed.createdAt)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getActivityPage({ userPublicId, roles, limit = 20, cursor = null }) {
  const result = await postgresPool.query(
    `SELECT j.id,j.public_id,j.kind,j.metadata->>'subtype' subtype,j.created_at,to_char(j.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_created_at
    FROM jobs j
    JOIN users actor ON actor.public_id=$1
    LEFT JOIN drivers d ON d.id=j.driver_id
    LEFT JOIN merchants m ON m.id=j.merchant_id
    WHERE (
      ('customer'=ANY($2::text[]) AND j.customer_id=actor.id) OR
      ('driver'=ANY($2::text[]) AND d.user_id=actor.id) OR
      ('merchant'=ANY($2::text[]) AND m.owner_id=actor.id) OR
      ('admin'=ANY($2::text[]))
    ) AND ($3::timestamptz IS NULL OR (j.created_at,j.id)<($3::timestamptz,$4::uuid))
    ORDER BY j.created_at DESC,j.id DESC LIMIT $5`,
    [userPublicId, roles, cursor?.createdAt || null, cursor?.id || null, limit + 1],
  );
  const hasMore = result.rows.length > limit,
    rows = result.rows.slice(0, limit),
    ids = new Set(rows.map((row) => row.public_id));
  const [orders, rides, shipments] = await Promise.all([
    getPostgresOrders(),
    getPostgresRides(),
    getPostgresShipments(),
  ]);
  const resources = new Map([
    ...orders
      .filter((item) => ids.has(item.id))
      .map((item) => [item.id, { kind: "order", resource: item }]),
    ...rides
      .filter((item) => ids.has(item.id))
      .map((item) => [item.id, { kind: "ride", resource: item }]),
    ...shipments
      .filter((item) => ids.has(item.id))
      .map((item) => [item.id, { kind: "shipment", resource: item }]),
  ]);
  return {
    items: rows
      .map((row) => ({
        ...resources.get(row.public_id),
        id: row.public_id,
        createdAt: new Date(row.created_at).toISOString(),
      }))
      .filter((item) => item.kind),
    nextCursor: hasMore ? encodeCursor(rows.at(-1)) : null,
  };
}

export async function getAssignedDriverProjections({ userPublicId, roles }) {
  const result = await postgresPool.query(
    `SELECT DISTINCT ON(d.id)
      d.public_id id,
      COALESCE(d.metadata->>'name',d.public_id) name,
      COALESCE((SELECT round(avg(r.score),2) FROM ratings r WHERE r.subject_type='driver' AND r.subject_id=d.id),d.rating) rating,
      COALESCE(v.model,'Vehículo asignado') vehicle,
      COALESCE(v.plate,'') plate,
      v.kind vehicle_kind,
      ST_Y(d.current_location::geometry) lat,
      ST_X(d.current_location::geometry) lng,
      d.location_updated_at
    FROM jobs j
    JOIN users actor ON actor.public_id=$1
    JOIN drivers d ON d.id=j.driver_id
    LEFT JOIN merchants m ON m.id=j.merchant_id
    LEFT JOIN vehicles v ON v.driver_id=d.id AND v.active AND v.retired_at IS NULL
    WHERE (
      ('customer'=ANY($2::text[]) AND j.customer_id=actor.id) OR
      ('merchant'=ANY($2::text[]) AND m.owner_id=actor.id)
    ) AND (j.status NOT IN ('completed','cancelled') OR j.created_at>=now()-interval '180 days')
    ORDER BY d.id,j.created_at DESC`,
    [userPublicId, roles],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    rating: Number(row.rating || 0),
    vehicle: row.vehicle,
    plate: row.plate,
    vehicleKind: row.vehicle_kind || null,
    location:
      row.lat == null || row.lng == null
        ? null
        : { lat: Number(row.lat), lng: Number(row.lng), updatedAt: row.location_updated_at },
  }));
}
