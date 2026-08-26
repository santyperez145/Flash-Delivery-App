import { postgresPool } from "./postgres.js";

const normalizeAddress = (value) =>
  String(value)
    .trim()
    .toLocaleLowerCase("es-AR")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .slice(0, 240);
const mapDestination = (row) => ({
  id: String(row.id),
  label: row.label,
  address: row.formatted_address,
  point: { lat: Number(row.lat), lng: Number(row.lng) },
  useCount: Number(row.use_count),
  lastUsedAt: new Date(row.last_used_at).toISOString(),
});

export async function getPostgresRideDestinations(userPublicId, limit = 8) {
  const result = await postgresPool.query(
    `SELECT h.id,h.label,h.formatted_address,h.use_count,h.last_used_at,ST_Y(h.location::geometry) lat,ST_X(h.location::geometry) lng FROM ride_destination_history h JOIN users u ON u.id=h.user_id WHERE u.public_id=$1 ORDER BY h.last_used_at DESC LIMIT $2`,
    [userPublicId, limit],
  );
  return result.rows.map(mapDestination);
}

export async function recordPostgresRideDestination({ userPublicId, label, address, lat, lng }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const user = (await client.query("SELECT id FROM users WHERE public_id=$1", [userPublicId]))
      .rows[0];
    if (!user) throw Object.assign(new Error("Usuario no encontrado"), { status: 404 });
    const addressKey = normalizeAddress(address);
    const row = (
      await client.query(
        `INSERT INTO ride_destination_history(user_id,address_key,label,formatted_address,location) VALUES($1,$2,$3,$4,ST_SetSRID(ST_MakePoint($6,$5),4326)::geography) ON CONFLICT(user_id,address_key) DO UPDATE SET label=excluded.label,formatted_address=excluded.formatted_address,location=excluded.location,use_count=ride_destination_history.use_count+1,last_used_at=now(),updated_at=now() RETURNING id,label,formatted_address,use_count,last_used_at,ST_Y(location::geometry) lat,ST_X(location::geometry) lng`,
        [user.id, addressKey, label, address, lat, lng],
      )
    ).rows[0];
    await client.query(
      `DELETE FROM ride_destination_history WHERE user_id=$1 AND id IN(SELECT id FROM ride_destination_history WHERE user_id=$1 ORDER BY last_used_at DESC OFFSET 20)`,
      [user.id],
    );
    await client.query("COMMIT");
    return mapDestination(row);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deletePostgresRideDestination({ userPublicId, destinationId }) {
  const result = await postgresPool.query(
    `DELETE FROM ride_destination_history h USING users u WHERE h.id=$1 AND h.user_id=u.id AND u.public_id=$2 RETURNING h.id`,
    [destinationId, userPublicId],
  );
  if (!result.rows[0])
    throw Object.assign(new Error("Destino reciente no encontrado"), { status: 404 });
  return getPostgresRideDestinations(userPublicId);
}
