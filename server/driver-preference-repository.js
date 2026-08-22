import { postgresPool } from "./postgres.js";

const mapPreferences = (row) => ({
  driverId: row.driver_public_id,
  navigationProvider: row.navigation_provider || "system",
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
});

export async function getDriverPreferences(actorPublicId) {
  const row = (
    await postgresPool.query(
      `SELECT d.public_id driver_public_id,p.navigation_provider,p.updated_at
       FROM drivers d JOIN users u ON u.id=d.user_id
       LEFT JOIN driver_preferences p ON p.driver_id=d.id
       WHERE u.public_id=$1`,
      [actorPublicId],
    )
  ).rows[0];
  return row ? mapPreferences(row) : null;
}

export async function updateDriverPreferences({ actorPublicId, navigationProvider }) {
  const row = (
    await postgresPool.query(
      `INSERT INTO driver_preferences(driver_id,navigation_provider,updated_at)
       SELECT d.id,$2,now() FROM drivers d JOIN users u ON u.id=d.user_id WHERE u.public_id=$1
       ON CONFLICT(driver_id) DO UPDATE SET navigation_provider=excluded.navigation_provider,updated_at=now()
       RETURNING driver_id,navigation_provider,updated_at`,
      [actorPublicId, navigationProvider],
    )
  ).rows[0];
  if (!row) return null;
  return getDriverPreferences(actorPublicId);
}
