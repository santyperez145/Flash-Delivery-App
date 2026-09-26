// Sesiones de refresh del fallback SQLite (ARC-001).
//
// Separadas del estado público readDb/writeDb: rotar/revocar tokens no es el
// mismo dominio que seedear restaurantes.
import crypto from "node:crypto";
import { createId, getStoreDatabase } from "./store.js";

const hashRefreshToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

export function createAuthSession(userId, deviceName = "unknown") {
  const id = createId("SES");
  const refreshToken = crypto.randomBytes(48).toString("base64url");
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  getStoreDatabase()
    .prepare(
      `
    INSERT INTO auth_sessions (id, user_id, refresh_token_hash, device_name, expires_at, revoked_at, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?)
  `,
    )
    .run(
      id,
      userId,
      hashRefreshToken(refreshToken),
      String(deviceName).slice(0, 160),
      expiresAt,
      createdAt,
    );
  return { id, refreshToken, expiresAt };
}

export function consumeAuthSession(refreshToken, deviceName = "unknown") {
  const tokenHash = hashRefreshToken(String(refreshToken || ""));
  const session = getStoreDatabase()
    .prepare(
      `
    SELECT * FROM auth_sessions
    WHERE refresh_token_hash = ? AND revoked_at IS NULL AND expires_at > ?
  `,
    )
    .get(tokenHash, new Date().toISOString());
  if (!session) return null;
  const replacement = getStoreDatabase().transaction(() => {
    getStoreDatabase()
      .prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ?")
      .run(new Date().toISOString(), session.id);
    return createAuthSession(session.user_id, deviceName || session.device_name);
  })();
  return { userId: session.user_id, ...replacement };
}

export function revokeAuthSession(refreshToken) {
  const result = getStoreDatabase()
    .prepare(
      `
    UPDATE auth_sessions SET revoked_at = ?
    WHERE refresh_token_hash = ? AND revoked_at IS NULL
  `,
    )
    .run(new Date().toISOString(), hashRefreshToken(String(refreshToken || "")));
  return result.changes > 0;
}
