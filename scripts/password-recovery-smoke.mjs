import { createPool } from "./db-client.mjs";
import { processPostgresNotificationBatch } from "../server/notification-repository.js";
import { closePostgres } from "../server/postgres.js";
const base = process.env.API_URL || "http://127.0.0.1:4000/api",
  pool = createPool(),
  email = "cliente@flash.app",
  newPassword = "Recovery987!";
const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
async function call(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
const original = (
  await pool.query(
    "SELECT id,public_id,password_hash,failed_login_attempts,login_locked_until FROM users WHERE email=$1",
    [email],
  )
).rows[0];
try {
  const login = await call("/auth/login", {
    email,
    password: "demo123",
    deviceName: "password-recovery-smoke",
  });
  assert(login.status === 200 && login.body.refreshToken, "fixture has an active refresh session");
  const unknown = await call("/auth/password-recovery/request", {
      email: `missing-${Date.now()}@flash.test`,
    }),
    known = await call("/auth/password-recovery/request", { email });
  assert(
    unknown.status === known.status && unknown.body.message === known.body.message,
    "request response does not disclose whether an account exists",
  );
  const token = known.body.developmentToken;
  assert(
    token && token.length >= 40,
    "development delivers the one-time token without persisting plaintext",
  );
  const stored = (
    await pool.query(
      "SELECT token_hash FROM password_recovery_tokens WHERE user_id=$1 AND consumed_at IS NULL",
      [original.id],
    )
  ).rows[0];
  assert(
    stored && !stored.token_hash.includes(token),
    "recovery database row stores only a digest",
  );
  const emailNotification = (
    await pool.query(
      "SELECT id,payload,sensitive_payload_ciphertext,status FROM notifications WHERE user_id=$1 AND template='password_recovery' ORDER BY created_at DESC LIMIT 1",
      [original.id],
    )
  ).rows[0];
  assert(
    emailNotification?.sensitive_payload_ciphertext &&
      !JSON.stringify(emailNotification.payload).includes(token) &&
      !emailNotification.sensitive_payload_ciphertext.includes(token),
    "email outbox encrypts the token outside the public payload",
  );
  if (emailNotification.status === "queued")
    await processPostgresNotificationBatch({
      workerId: `recovery-smoke-${process.pid}`,
      limit: 100,
      provider: "sandbox",
    });
  const delivery = (
    await pool.query(
      "SELECT status,provider FROM notification_deliveries WHERE notification_id=$1 ORDER BY created_at DESC LIMIT 1",
      [emailNotification.id],
    )
  ).rows[0];
  assert(
    delivery?.status === "delivered" && delivery.provider === "sandbox",
    "sandbox email worker records a verifiable delivery attempt",
  );
  const changed = await call("/auth/password-recovery/confirm", { token, password: newPassword });
  assert(
    changed.status === 200 && changed.body.passwordChanged,
    "valid token changes the password once",
  );
  const reused = await call("/auth/password-recovery/confirm", { token, password: "Another987!" });
  assert(reused.status === 400, "consumed recovery token cannot be replayed");
  const session = (
    await pool.query(
      "SELECT revoked_at FROM refresh_sessions WHERE token_hash=encode(digest($1,'sha256'),'hex')",
      [login.body.refreshToken],
    )
  ).rows[0];
  assert(session?.revoked_at, "password reset revokes every previous refresh session");
  const oldLogin = await call("/auth/login", { email, password: "demo123" }),
    newLogin = await call("/auth/login", { email, password: newPassword });
  assert(
    oldLogin.status === 401 && newLogin.status === 200,
    "old credential fails and new credential authenticates",
  );
  const sameRequest = await call("/auth/password-recovery/request", { email }),
    samePassword = await call("/auth/password-recovery/confirm", {
      token: sameRequest.body.developmentToken,
      password: newPassword,
    });
  assert(samePassword.status === 409, "recovery rejects reusing the current password");
  const expiring = await call("/auth/password-recovery/request", { email }),
    expiringToken = expiring.body.developmentToken;
  await pool.query(
    "UPDATE password_recovery_tokens SET created_at=now()-interval '21 minutes',expires_at=now()-interval '1 minute' WHERE user_id=$1 AND consumed_at IS NULL",
    [original.id],
  );
  const expired = await call("/auth/password-recovery/confirm", {
    token: expiringToken,
    password: "Expired987!",
  });
  assert(expired.status === 400, "expired token cannot change credentials");
} finally {
  await pool.query(
    "UPDATE users SET password_hash=$2,failed_login_attempts=$3,login_locked_until=$4,updated_at=now() WHERE id=$1",
    [
      original.id,
      original.password_hash,
      original.failed_login_attempts,
      original.login_locked_until,
    ],
  );
  await pool.query(
    "DELETE FROM refresh_sessions WHERE user_id=$1 AND device_name='password-recovery-smoke'",
    [original.id],
  );
  await pool.query("DELETE FROM password_recovery_tokens WHERE user_id=$1", [original.id]);
  await pool.query("DELETE FROM notifications WHERE user_id=$1 AND template='password_recovery'", [
    original.id,
  ]);
  await pool.query(
    "DELETE FROM audit_events WHERE actor_id=$1 AND action IN('auth.password_recovery_requested','auth.password_recovered')",
    [original.id],
  );
  await pool.end();
  await closePostgres();
}
