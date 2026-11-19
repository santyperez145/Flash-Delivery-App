// Verificación en dos pasos (TOTP) para toda cuenta (SEG-08; antes sólo admin).
//
// El secreto se guarda cifrado con AES-256-GCM y los códigos de recuperación sólo
// como hashes bcrypt. Cinco fallos seguidos bloquean la verificación quince
// minutos, también cuando el código se pide para confirmar una acción sensible
// (desactivar, regenerar códigos, eliminar la cuenta o autorizar un retiro): si
// no, esas acciones servirían para probar códigos sin el bloqueo.
//
// Cada cambio (activar, desactivar, regenerar códigos o usar uno) se avisa por
// push y por email, como hacen Uber y Google: si no fue la persona, se entera.
//
// **Un código TOTP sirve una sola vez** (RFC 6238, sección 5.2). Se acepta un
// paso de 30 segundos de tolerancia hacia cada lado por relojes desfasados, y se
// guarda el último paso usado: quien vea el código por encima del hombro, o lo
// intercepte, no puede reusarlo dentro de su ventana.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import { enqueuePostgresNotification } from "./notification-repository.js";
import { postgresPool } from "./postgres.js";
import { decryptMfaSecret, encryptMfaSecret } from "./secret-envelope.js";

const maxAttempts = 5,
  lockMinutes = 15,
  recoveryCodeCount = 8;
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
const httpError = (message, status) => Object.assign(new Error(message), { status });

const totp = authenticator.clone({ window: 1 });
/** Paso TOTP (número de ventana de 30 s) que valida el código, o `null`. */
const totpStep = (code, secret) => {
  const delta = totp.checkDelta(code, secret);
  return delta === null ? null : Math.floor(Date.now() / 30000) + delta;
};

async function newRecoveryCodes() {
  const codes = Array.from({ length: recoveryCodeCount }, () =>
    `${crypto.randomBytes(2).toString("hex")}-${crypto.randomBytes(2).toString("hex")}`.toUpperCase(),
  );
  // Asíncrono: ocho hashes bcrypt seguidos bloquearían el proceso medio segundo.
  const hashes = await Promise.all(codes.map((code) => bcrypt.hash(normalizeCode(code), 10)));
  return { codes, hashes };
}

/** Avisos de seguridad: push esencial (no se puede apagar) y email. */
const securityCopy = {
  mfa_enabled: {
    title: "Activaste la verificación en dos pasos",
    body: "Desde ahora, al ingresar en un dispositivo nuevo te pedimos un código.",
  },
  mfa_disabled: {
    title: "Se desactivó la verificación en dos pasos",
    body: "Si no fuiste vos, cambiá tu contraseña y escribinos desde Ayuda.",
  },
  mfa_recovery_codes_regenerated: {
    title: "Generaste códigos de recuperación nuevos",
    body: "Los anteriores dejaron de funcionar.",
  },
  mfa_recovery_code_used: {
    title: "Se usó un código de recuperación",
    body: "Si no fuiste vos, cambiá tu contraseña y escribinos desde Ayuda.",
  },
  // PAG-04: comprar una tarjeta de regalo es la forma de sacar saldo de una cuenta
  // robada. El aviso llega en el momento, por push y por email.
  gift_card_purchased: {
    title: "Compraste una tarjeta de regalo",
    body: "Si no fuiste vos, anulala desde tu Wallet y cambiá tu contraseña.",
  },
};

export async function notifyMfaChange(userPublicId, event) {
  const copy = securityCopy[event];
  if (!copy || !postgresPool) return;
  const key = `mfa:${event}:${crypto.randomUUID()}`;
  // Un aviso que no se pudo encolar no deshace el cambio de seguridad ya hecho.
  await Promise.allSettled([
    enqueuePostgresNotification({
      userPublicId,
      channel: "push",
      template: "security_alert",
      payload: { ...copy, kind: event },
      deduplicationKey: key,
    }),
    enqueuePostgresNotification({
      userPublicId,
      channel: "email",
      template: "account_security_change",
      payload: { event },
      deduplicationKey: key,
    }),
  ]);
}

export async function getMfaStatus(userPublicId) {
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

export async function beginMfaEnrollment({ userPublicId, email, admin = false }) {
  const current = await getMfaStatus(userPublicId);
  if (current.enabled) throw httpError("La verificación en dos pasos ya está activa", 409);
  const secret = totp.generateSecret();
  const { codes, hashes } = await newRecoveryCodes();
  const result = await postgresPool.query(
    `INSERT INTO user_mfa(user_id,secret_ciphertext,recovery_code_hashes)
    SELECT id,$2,$3 FROM users WHERE public_id=$1
    ON CONFLICT(user_id) DO UPDATE SET secret_ciphertext=EXCLUDED.secret_ciphertext,recovery_code_hashes=EXCLUDED.recovery_code_hashes,enabled=false,failed_attempts=0,locked_until=NULL,confirmed_at=NULL,last_totp_step=NULL,updated_at=now()
    WHERE NOT user_mfa.enabled
    RETURNING user_id`,
    [userPublicId, encryptMfaSecret(secret), hashes],
  );
  // Sin fila: o la cuenta no existe, o la verificación se activó entre la consulta y acá.
  if (!result.rows[0])
    throw (await getMfaStatus(userPublicId)).enabled
      ? httpError("La verificación en dos pasos ya está activa", 409)
      : httpError("Usuario no existe", 404);
  return {
    secret,
    otpauthUri: totp.keyuri(email, admin ? "Flash Delivery Admin" : "Flash", secret),
    recoveryCodes: codes,
  };
}

export async function confirmMfa({ userPublicId, code }) {
  const result = await postgresPool.query(
    `SELECT m.* FROM user_mfa m JOIN users u ON u.id=m.user_id WHERE u.public_id=$1`,
    [userPublicId],
  );
  const row = result.rows[0];
  if (!row || row.enabled)
    throw httpError(
      row ? "La verificación en dos pasos ya está activa" : "Primero iniciá la activación",
      409,
    );
  const step = totpStep(normalizeCode(code), decryptMfaSecret(row.secret_ciphertext));
  if (step === null) throw httpError("Código inválido", 400);
  const updated = await postgresPool.query(
    `UPDATE user_mfa SET enabled=true,confirmed_at=now(),failed_attempts=0,locked_until=NULL,last_totp_step=$3,updated_at=now()
    WHERE user_id=$1 AND NOT enabled AND secret_ciphertext=$2`,
    [row.user_id, row.secret_ciphertext, step],
  );
  // Otra activación ganó la carrera o empezó una nueva con otro secreto.
  if (!updated.rowCount) throw httpError("La activación cambió; volvé a empezar", 409);
  await notifyMfaChange(userPublicId, "mfa_enabled");
  return getMfaStatus(userPublicId);
}

/**
 * Verifica un código (TOTP o de recuperación) y, si es válido, corre `after` en la
 * misma transacción, con la fila bloqueada. Un fallo se guarda aunque la
 * operación se rechace: es lo que hace que el bloqueo por intentos funcione.
 *
 * `invalidStatus`: 401 en el segundo paso del ingreso, donde todavía no hay
 * sesión; 403 dentro de una sesión. Los clientes web y móvil renuevan la sesión
 * ante cualquier 401, y un administrador que renueva vuelve a pasar el segundo
 * factor: un código mal escrito lo dejaría afuera.
 */
async function withVerifiedCode(userPublicId, code, after, { invalidStatus = 401 } = {}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT m.* FROM user_mfa m JOIN users u ON u.id=m.user_id WHERE u.public_id=$1 FOR UPDATE OF m`,
      [userPublicId],
    );
    const row = result.rows[0];
    if (!row?.enabled) throw httpError("La verificación en dos pasos no está activa", 409);
    if (row.locked_until && new Date(row.locked_until) > new Date())
      throw httpError("Demasiados códigos inválidos. Probá de nuevo en 15 minutos", 429);
    const normalized = normalizeCode(code),
      secret = decryptMfaSecret(row.secret_ciphertext);
    let recoveryIndex = -1;
    const step = totpStep(normalized, secret);
    // Un código ya usado (o uno anterior) no vale aunque siga en su ventana.
    const totpValid = step !== null && step > Number(row.last_totp_step ?? -1);
    let valid = totpValid;
    if (!valid && step === null) {
      const matches = await Promise.all(
        (row.recovery_code_hashes || []).map((hash) => bcrypt.compare(normalized, hash)),
      );
      recoveryIndex = matches.indexOf(true);
      valid = recoveryIndex >= 0;
    }
    if (!valid) {
      const attempts = Number(row.failed_attempts || 0) + 1,
        locked = attempts >= maxAttempts;
      await client.query(
        `UPDATE user_mfa SET failed_attempts=$2,locked_until=CASE WHEN $3 THEN now()+($4||' minutes')::interval ELSE NULL END,updated_at=now() WHERE user_id=$1`,
        [row.user_id, locked ? 0 : attempts, locked, String(lockMinutes)],
      );
      await client.query("COMMIT");
      throw httpError(
        locked ? "Demasiados códigos inválidos. Probá de nuevo en 15 minutos" : "Código inválido",
        locked ? 429 : invalidStatus,
      );
    }
    const hashes = [...(row.recovery_code_hashes || [])];
    if (recoveryIndex >= 0) hashes.splice(recoveryIndex, 1);
    await client.query(
      `UPDATE user_mfa SET recovery_code_hashes=$2,failed_attempts=0,locked_until=NULL,
        last_totp_step=CASE WHEN $3::bigint IS NULL THEN last_totp_step ELSE $3 END,updated_at=now() WHERE user_id=$1`,
      [row.user_id, hashes, totpValid ? step : null],
    );
    const extra = after ? await after(client, row) : {};
    await client.query("COMMIT");
    if (recoveryIndex >= 0) await notifyMfaChange(userPublicId, "mfa_recovery_code_used");
    return { recoveryCodeUsed: recoveryIndex >= 0, ...extra };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/** Segundo paso del ingreso, o confirmación de una acción sensible. */
export const verifyMfa = ({ userPublicId, code, inSession = false }) =>
  withVerifiedCode(userPublicId, code, null, { invalidStatus: inSession ? 403 : 401 });

/** Apagar exige un código: con la sesión robada sola no se puede desactivar. */
export async function disableMfa({ userPublicId, code }) {
  const result = await withVerifiedCode(
    userPublicId,
    code,
    async (client, row) => {
      await client.query(
        `UPDATE user_mfa SET enabled=false,recovery_code_hashes='{}',confirmed_at=NULL,disabled_at=now(),updated_at=now() WHERE user_id=$1`,
        [row.user_id],
      );
      return {};
    },
    { invalidStatus: 403 },
  );
  await notifyMfaChange(userPublicId, "mfa_disabled");
  return { ...result, mfa: await getMfaStatus(userPublicId) };
}

/** Códigos nuevos; los anteriores dejan de servir. */
export async function regenerateMfaRecoveryCodes({ userPublicId, code }) {
  const { codes, hashes } = await newRecoveryCodes();
  const result = await withVerifiedCode(
    userPublicId,
    code,
    async (client, row) => {
      await client.query(
        `UPDATE user_mfa SET recovery_code_hashes=$2,updated_at=now() WHERE user_id=$1`,
        [row.user_id, hashes],
      );
      return {};
    },
    { invalidStatus: 403 },
  );
  await notifyMfaChange(userPublicId, "mfa_recovery_codes_regenerated");
  return { ...result, recoveryCodes: codes, mfa: await getMfaStatus(userPublicId) };
}

/**
 * Para una acción sensible: si la cuenta tiene la verificación activa, exige un
 * código válido; si no la tiene, no pide nada. Un 403 con `mfaRequired` le dice
 * al cliente que muestre el campo del código (403 y no 401: ver `withVerifiedCode`).
 */
export async function requireMfaCodeIfEnabled({ userPublicId, code }) {
  if (!postgresPool || !(await getMfaStatus(userPublicId)).enabled) return { checked: false };
  if (!code)
    throw Object.assign(httpError("Ingresá el código de tu app autenticadora", 403), {
      mfaRequired: true,
    });
  return { checked: true, ...(await verifyMfa({ userPublicId, code, inSession: true })) };
}
