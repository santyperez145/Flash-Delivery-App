import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import { postgresPool } from "./postgres.js";
import { decryptMfaSecret, encryptMfaSecret } from "./secret-envelope.js";

const maxAttempts = 5,
  lockMinutes = 15;
const normalizeCode = (value) =>
  String(value || "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
const publicStatus = (row) => ({
  enabled: Boolean(row?.enabled),
  method: row?.method || "totp",
  confirmedAt: row?.confirmed_at?.toISOString?.() || row?.confirmed_at || null,
  lockedUntil: row?.locked_until?.toISOString?.() || row?.locked_until || null,
  recoveryCodesRemaining: Array.isArray(row?.recovery_code_hashes)
    ? row.recovery_code_hashes.length
    : 0,
});

export async function getAdminMfaStatus(userPublicId) {
  if (!postgresPool)
    return {
      enabled: false,
      method: "totp",
      confirmedAt: null,
      lockedUntil: null,
      recoveryCodesRemaining: 0,
    };
  const result = await postgresPool.query(
    `SELECT m.* FROM users u LEFT JOIN user_mfa m ON m.user_id=u.id WHERE u.public_id=$1`,
    [userPublicId],
  );
  return publicStatus(result.rows[0]);
}

export async function beginAdminMfaEnrollment({ userPublicId, email }) {
  const current = await getAdminMfaStatus(userPublicId);
  if (current.enabled) {
    const error = new Error("MFA ya está activo");
    error.status = 409;
    throw error;
  }
  const secret = authenticator.generateSecret();
  const recoveryCodes = Array.from({ length: 8 }, () =>
    `${crypto.randomBytes(4).toString("hex").slice(0, 4)}-${crypto.randomBytes(4).toString("hex").slice(0, 4)}`.toUpperCase(),
  );
  const hashes = recoveryCodes.map((code) => bcrypt.hashSync(normalizeCode(code), 10));
  const result = await postgresPool.query(
    `INSERT INTO user_mfa(user_id,secret_ciphertext,recovery_code_hashes)
    SELECT id,$2,$3 FROM users WHERE public_id=$1
    ON CONFLICT(user_id) DO UPDATE SET
      secret_ciphertext=EXCLUDED.secret_ciphertext,
      recovery_code_hashes=EXCLUDED.recovery_code_hashes,
      enabled=false, failed_attempts=0, locked_until=NULL,
      confirmed_at=NULL, updated_at=now()
    RETURNING user_id`,
    [userPublicId, encryptMfaSecret(secret), hashes],
  );
  if (!result.rows[0]) {
    const error = new Error("Usuario no existe");
    error.status = 404;
    throw error;
  }
  return {
    secret,
    otpauthUri: authenticator.keyuri(email, "Flash Delivery Admin", secret),
    recoveryCodes,
  };
}

export async function confirmAdminMfa({ userPublicId, code }) {
  const result = await postgresPool.query(
    `SELECT m.* FROM user_mfa m JOIN users u ON u.id=m.user_id WHERE u.public_id=$1`,
    [userPublicId],
  );
  const row = result.rows[0];
  if (!row || row.enabled) {
    const error = new Error(row ? "MFA ya está activo" : "Primero inicia el enrolamiento");
    error.status = 409;
    throw error;
  }
  if (!authenticator.check(normalizeCode(code), decryptMfaSecret(row.secret_ciphertext))) {
    const error = new Error("Código TOTP inválido");
    error.status = 400;
    throw error;
  }
  await postgresPool.query(
    `UPDATE user_mfa SET enabled=true,confirmed_at=now(),failed_attempts=0,locked_until=NULL,updated_at=now() WHERE user_id=$1`,
    [row.user_id],
  );
  return getAdminMfaStatus(userPublicId);
}

export async function verifyAdminMfa({ userPublicId, code }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT m.* FROM user_mfa m JOIN users u ON u.id=m.user_id WHERE u.public_id=$1 FOR UPDATE`,
      [userPublicId],
    );
    const row = result.rows[0];
    if (!row?.enabled) {
      const error = new Error("MFA no está activo");
      error.status = 409;
      throw error;
    }
    if (row.locked_until && new Date(row.locked_until) > new Date()) {
      const error = new Error("MFA bloqueado temporalmente");
      error.status = 429;
      throw error;
    }
    const normalized = normalizeCode(code),
      secret = decryptMfaSecret(row.secret_ciphertext);
    let valid = authenticator.check(normalized, secret),
      recoveryIndex = -1;
    if (!valid)
      recoveryIndex = (row.recovery_code_hashes || []).findIndex((hash) =>
        bcrypt.compareSync(normalized, hash),
      );
    valid = valid || recoveryIndex >= 0;
    if (!valid) {
      const attempts = Number(row.failed_attempts || 0) + 1,
        locked = attempts >= maxAttempts;
      await client.query(
        `UPDATE user_mfa SET failed_attempts=$2,locked_until=CASE WHEN $3 THEN now()+($4||' minutes')::interval ELSE NULL END,updated_at=now() WHERE user_id=$1`,
        [row.user_id, locked ? 0 : attempts, locked, String(lockMinutes)],
      );
      await client.query("COMMIT");
      const error = new Error(locked ? "MFA bloqueado temporalmente" : "Código MFA inválido");
      error.status = locked ? 429 : 401;
      throw error;
    }
    const hashes = [...(row.recovery_code_hashes || [])];
    if (recoveryIndex >= 0) hashes.splice(recoveryIndex, 1);
    await client.query(
      `UPDATE user_mfa SET recovery_code_hashes=$2,failed_attempts=0,locked_until=NULL,updated_at=now() WHERE user_id=$1`,
      [row.user_id, hashes],
    );
    await client.query("COMMIT");
    return { recoveryCodeUsed: recoveryIndex >= 0 };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}
