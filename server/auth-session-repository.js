// Sesiones refresh PostgreSQL (ARC-001).
//
// Separadas de identity/login: rotar y revocar tokens es el ciclo de sesión,
// no el de credenciales. Importa `findAuthUserByInternalId` sin ciclo inverso.
import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
import { findAuthUserByInternalId } from "./auth-repository.js";

const refreshLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const tokenHash = (token) =>
  crypto
    .createHash("sha256")
    .update(String(token || ""))
    .digest("hex");

export async function createPostgresSession(user, deviceName = "unknown") {
  const refreshToken = crypto.randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + refreshLifetimeMs);
  await postgresPool.query(
    `INSERT INTO refresh_sessions(user_id, token_hash, device_name, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [user.internalId, tokenHash(refreshToken), String(deviceName).slice(0, 160), expiresAt],
  );
  return { refreshToken, expiresAt: expiresAt.toISOString() };
}

export async function rotatePostgresSession(refreshToken, deviceName = "unknown") {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT id, user_id, device_name FROM refresh_sessions
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [tokenHash(refreshToken)],
    );
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query("UPDATE refresh_sessions SET revoked_at = now() WHERE id = $1", [
      current.rows[0].id,
    ]);
    const nextToken = crypto.randomBytes(48).toString("base64url");
    const expiresAt = new Date(Date.now() + refreshLifetimeMs);
    await client.query(
      `INSERT INTO refresh_sessions(user_id, token_hash, device_name, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [
        current.rows[0].user_id,
        tokenHash(nextToken),
        String(deviceName || current.rows[0].device_name).slice(0, 160),
        expiresAt,
      ],
    );
    await client.query("COMMIT");
    const user = await findAuthUserByInternalId(current.rows[0].user_id);
    return user ? { user, refreshToken: nextToken, expiresAt: expiresAt.toISOString() } : null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokePostgresSession(refreshToken) {
  await postgresPool.query(
    "UPDATE refresh_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
    [tokenHash(refreshToken)],
  );
}

export async function getPostgresUserSessions(userPublicId) {
  const result = await postgresPool.query(
    `SELECT s.public_id,s.device_name,s.expires_at,s.created_at FROM refresh_sessions s JOIN users u ON u.id=s.user_id
  WHERE u.public_id=$1 AND s.revoked_at IS NULL AND s.expires_at>now() ORDER BY s.created_at DESC`,
    [userPublicId],
  );
  return result.rows.map((row) => ({
    id: row.public_id,
    deviceName: row.device_name || "Dispositivo desconocido",
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  }));
}

export async function revokeOwnedPostgresSession({ userPublicId, sessionPublicId }) {
  const result = await postgresPool.query(
    `UPDATE refresh_sessions s SET revoked_at=now() FROM users u WHERE s.user_id=u.id AND u.public_id=$1 AND s.public_id=$2 AND s.revoked_at IS NULL RETURNING s.public_id`,
    [userPublicId, sessionPublicId],
  );
  if (!result.rowCount)
    throw Object.assign(new Error("Sesión no encontrada o ya cerrada"), { status: 404 });
  return { revoked: true, id: sessionPublicId };
}

export async function revokeOtherPostgresSessions({ userPublicId, currentRefreshToken }) {
  const current = (
    await postgresPool.query(
      `SELECT s.id,s.user_id FROM refresh_sessions s JOIN users u ON u.id=s.user_id WHERE u.public_id=$1 AND s.token_hash=$2 AND s.revoked_at IS NULL AND s.expires_at>now()`,
      [userPublicId, tokenHash(currentRefreshToken)],
    )
  ).rows[0];
  if (!current) throw Object.assign(new Error("La sesión actual no es válida"), { status: 401 });
  const result = await postgresPool.query(
    "UPDATE refresh_sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL",
    [current.user_id, current.id],
  );
  return { revokedSessions: result.rowCount };
}
