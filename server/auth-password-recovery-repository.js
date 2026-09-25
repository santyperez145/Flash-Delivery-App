// Recuperación de contraseña (ARC-001).
//
// Separada del login/registro — misma frontera que reset≠session en Uber /
// DoorDash. Tokens de un solo uso, revocación de refresh al consumir.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { postgresPool } from "./postgres.js";
import { encryptRecoveryToken } from "./secret-envelope.js";

const tokenHash = (token) =>
  crypto
    .createHash("sha256")
    .update(String(token || ""))
    .digest("hex");

export async function requestPasswordRecovery({ email, requesterFingerprintHash }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const user = (
      await client.query(
        "SELECT id,public_id FROM users WHERE email=$1 AND status='active' FOR UPDATE",
        [String(email).trim().toLowerCase()],
      )
    ).rows[0];
    if (!user) {
      await client.query("COMMIT");
      return null;
    }
    await client.query(
      "UPDATE password_recovery_tokens SET consumed_at=COALESCE(consumed_at,now()) WHERE user_id=$1 AND consumed_at IS NULL",
      [user.id],
    );
    const token = crypto.randomBytes(32).toString("base64url"),
      expiresAt = new Date(Date.now() + 20 * 60 * 1000);
    await client.query(
      "INSERT INTO password_recovery_tokens(user_id,token_hash,requester_fingerprint_hash,expires_at) VALUES($1,$2,$3,$4)",
      [user.id, tokenHash(token), requesterFingerprintHash || null, expiresAt],
    );
    await client.query(
      `INSERT INTO notifications(public_id,user_id,channel,template,payload,sensitive_payload_ciphertext,deduplication_key,status)
      VALUES($1,$2,'email','password_recovery',$3,$4,$5,'queued')`,
      [
        `NTF-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
        user.id,
        { expiresAt: expiresAt.toISOString() },
        encryptRecoveryToken(token),
        `password-recovery:${user.id}:${Date.now()}`,
      ],
    );
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_roles,action,entity_type,entity_id,after_data) VALUES($1,ARRAY[]::user_role[],'auth.password_recovery_requested','user',$2,$3)`,
      [user.id, user.public_id, { expiresAt: expiresAt.toISOString() }],
    );
    await client.query("COMMIT");
    return { token, expiresAt: expiresAt.toISOString(), userPublicId: user.public_id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function consumePasswordRecovery({ token, password }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const row = (
      await client.query(
        `SELECT pr.id,pr.user_id,u.public_id,u.password_hash FROM password_recovery_tokens pr JOIN users u ON u.id=pr.user_id
      WHERE pr.token_hash=$1 AND pr.consumed_at IS NULL AND pr.expires_at>now() AND u.status='active' FOR UPDATE OF pr,u`,
        [tokenHash(token)],
      )
    ).rows[0];
    if (!row) throw Object.assign(new Error("El código no existe o venció"), { status: 400 });
    if (bcrypt.compareSync(password, row.password_hash))
      throw Object.assign(new Error("La contraseña nueva debe ser diferente"), { status: 409 });
    const passwordHash = bcrypt.hashSync(password, 12);
    await client.query(
      "UPDATE users SET password_hash=$2,failed_login_attempts=0,login_locked_until=NULL,updated_at=now() WHERE id=$1",
      [row.user_id, passwordHash],
    );
    await client.query(
      "UPDATE password_recovery_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL",
      [row.user_id],
    );
    const revokedSessions = (
      await client.query(
        "UPDATE refresh_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1 AND revoked_at IS NULL RETURNING id",
        [row.user_id],
      )
    ).rowCount;
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_roles,action,entity_type,entity_id,after_data) VALUES($1,ARRAY[]::user_role[],'auth.password_recovered','user',$2,$3)`,
      [row.user_id, row.public_id, { revokedSessions }],
    );
    await client.query("COMMIT");
    return { userPublicId: row.public_id, revokedSessions };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
