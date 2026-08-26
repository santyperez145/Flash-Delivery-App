// El plantel de conductores como lo ve el comercio (ticket ARC-001).
//
// Tercera parte de `commerce-repository.js`. No confundir con los repositorios
// vecinos, que ya existían y tienen otro dueño: `driver-vehicle-repository.js`
// es la flota física, `driver-preference-repository.js` son las preferencias
// del propio conductor y `driver-demand-repository.js` es la demanda por zona.
//
// Lo de acá es el plantel: el perfil operativo con vehículo activo, rating,
// posición y ganancias del día —la vista que necesitan el despacho y
// operaciones—, más la actualización administrativa de estado.
import { postgresPool } from "./postgres.js";

export async function getPostgresDrivers({ userPublicId = null, publicIds = null } = {}) {
  const result = await postgresPool.query(
    `
    SELECT d.*, u.public_id AS user_public_id,(SELECT round(avg(r.score),2) FROM ratings r WHERE r.subject_type='driver' AND r.subject_id=d.id) AS feedback_rating,
      v.model vehicle_model,v.plate vehicle_plate,v.kind vehicle_kind,v.status vehicle_status,
      ST_Y(d.current_location::geometry) AS lat, ST_X(d.current_location::geometry) AS lng,
      (SELECT COALESCE(sum(CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END),0)::bigint
       FROM ledger_accounts a JOIN ledger_entries e ON e.account_id=a.id JOIN ledger_transactions t ON t.id=e.transaction_id
       WHERE a.owner_type='user' AND a.owner_id=d.user_id AND a.currency='ARS' AND a.account_type='wallet'
         AND t.status='posted' AND t.kind IN('driver_earning','merchant_settlement','tip','tip_adjustment')
         AND t.created_at >= (date_trunc('day',now() AT TIME ZONE u.timezone) AT TIME ZONE u.timezone)
         AND t.created_at < ((date_trunc('day',now() AT TIME ZONE u.timezone)+interval '1 day') AT TIME ZONE u.timezone)) earnings_today_cents
    FROM drivers d JOIN users u ON u.id = d.user_id
    LEFT JOIN vehicles v ON v.driver_id=d.id AND v.active AND v.retired_at IS NULL
    WHERE ($1::text IS NULL OR u.public_id = $1)
      AND ($2::text[] IS NULL OR d.public_id=ANY($2::text[]))
    ORDER BY d.created_at
  `,
    [userPublicId, publicIds],
  );
  return result.rows.map((row) => {
    const serviceModes = Array.isArray(row.service_modes)
      ? row.service_modes
      : String(row.service_modes || "")
          .replace(/^\{|\}$/g, "")
          .split(",")
          .filter(Boolean);
    return {
      id: row.public_id,
      userId: row.user_public_id,
      name: row.metadata?.name || row.public_id,
      online: row.online,
      serviceModes: serviceModes.map((mode) => (mode === "delivery" ? "delivery" : "ride")),
      activeService: row.active_mode === "ride" ? "ride" : "delivery",
      vehicle: row.vehicle_model || "Sin vehículo activo",
      plate: row.vehicle_plate || "",
      vehicleKind: row.vehicle_kind || null,
      vehicleStatus: row.vehicle_status || null,
      rating: Number(row.feedback_rating ?? row.rating),
      location: {
        lat: Number(row.lat),
        lng: Number(row.lng),
        label: row.metadata?.locationLabel || "GPS",
        updatedAt: row.location_updated_at,
        source: row.location_source || null,
        accuracyM: row.location_accuracy_m == null ? null : Number(row.location_accuracy_m),
      },
      earningsToday: Number(row.earnings_today_cents || 0) / 100,
    };
  });
}

export async function getPostgresDriverForUser(userPublicId) {
  return (await getPostgresDrivers({ userPublicId }))[0] || null;
}

export async function getPostgresOperationsDriverPage({
  limit = 50,
  cursor = null,
  query = "",
} = {}) {
  const page = await postgresPool.query(
    `SELECT d.id,d.public_id,to_char(d.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_created_at FROM drivers d WHERE ($1='' OR d.public_id ILIKE '%'||$1||'%' OR d.metadata->>'name' ILIKE '%'||$1||'%') AND ($2::timestamptz IS NULL OR (d.created_at,d.id)>($2::timestamptz,$3::uuid)) ORDER BY d.created_at,d.id LIMIT $4`,
    [query.trim(), cursor?.createdAt || null, cursor?.id || null, limit + 1],
  );
  const hasMore = page.rows.length > limit,
    rows = page.rows.slice(0, limit),
    drivers = await getPostgresDrivers({ publicIds: rows.map((row) => row.public_id) }),
    byId = new Map(drivers.map((item) => [item.id, item])),
    last = rows.at(-1);
  return {
    drivers: rows.map((row) => byId.get(row.public_id)).filter(Boolean),
    nextCursor:
      hasMore && last
        ? Buffer.from(JSON.stringify({ createdAt: last.cursor_created_at, id: last.id })).toString(
            "base64url",
          )
        : null,
  };
}

export async function updatePostgresDriver(publicId, changes) {
  const fields = [];
  const values = [];
  if (typeof changes.online === "boolean") {
    values.push(changes.online);
    fields.push(`online = $${values.length}`);
  }
  if (["delivery", "ride"].includes(changes.activeService)) {
    values.push(changes.activeService);
    fields.push(`active_mode = $${values.length}::job_kind`);
  }
  if (Number.isFinite(changes.lat) && Number.isFinite(changes.lng)) {
    values.push(changes.lng, changes.lat);
    fields.push(
      `current_location = ST_SetSRID(ST_MakePoint($${values.length - 1}, $${values.length}), 4326)::geography`,
      "location_updated_at = now()",
    );
    if (changes.label) {
      values.push(changes.label);
      fields.push(
        `metadata = jsonb_set(metadata, '{locationLabel}', to_jsonb($${values.length}::text), true)`,
      );
    }
    if (["foreground", "background"].includes(changes.source)) {
      values.push(changes.source);
      fields.push(`location_source = $${values.length}`);
    }
    if (Number.isFinite(changes.accuracyM)) {
      values.push(changes.accuracyM);
      fields.push(`location_accuracy_m = $${values.length}`);
    }
  }
  if (fields.length) {
    values.push(publicId);
    await postgresPool.query(
      `UPDATE drivers SET ${fields.join(", ")} WHERE public_id = $${values.length}`,
      values,
    );
  }
  return (await getPostgresDrivers()).find((driver) => driver.id === publicId) || null;
}
