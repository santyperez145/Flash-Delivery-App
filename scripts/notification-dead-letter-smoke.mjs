import crypto from "node:crypto";
import pg from "pg";
const pool = new pg.Pool({
    connectionString:
      process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
    ssl: false,
  }),
  base = process.env.API_URL || "http://127.0.0.1:4000/api",
  stamp = Date.now(),
  userId = `USR-NOTIFY-${stamp}`,
  email = `notify-dead-${stamp}@flash.test`,
  notificationId = `NTF-DEAD-${stamp}`,
  requestIds = [];
let token = "";
const assert = (value, label) => {
  if (!value) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
const call = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  let body = {};
  try {
    body = await response.json();
  } catch {}
  return { status: response.status, body };
};
const login = async (address) =>
  (
    await call("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: address,
        password: "demo123",
        deviceName: "notification-dead-letter-smoke",
      }),
    })
  ).body.token;
try {
  const admin = (
      await pool.query(
        "SELECT password_hash FROM users WHERE public_id='usr_admin'",
      )
    ).rows[0],
    user = (
      await pool.query(
        "INSERT INTO users(public_id,email,password_hash,name,email_verified_at) VALUES($1,$2,$3,'Usuario Notificaciones',now()) RETURNING id",
        [userId, email, admin.password_hash],
      )
    ).rows[0];
  await pool.query(
    "INSERT INTO user_roles(user_id,role) VALUES($1,'customer')",
    [user.id],
  );
  token = await login(email);
  const invalidToken = `sandbox-invalid:${crypto.randomUUID()}`,
    invalidDevice = await call("/devices", {
      method: "POST",
      body: JSON.stringify({
        platform: "android",
        pushToken: invalidToken,
        appVersion: "dead-letter-smoke",
        deviceFingerprint: `invalid-${crypto.randomUUID()}`,
      }),
    });
  requestIds.push(invalidDevice.body.requestId);
  await pool.query(
    `INSERT INTO notifications(public_id,user_id,channel,template,payload,deduplication_key,status) VALUES($1,$2,'push','service_status',$3,$4,'queued')`,
    [notificationId, user.id, { kind: "test" }, `dead-letter-${stamp}`],
  );
  assert(
    (await call("/admin/notifications/dead-letters")).status === 403,
    "customer cannot inspect dead-letter operations",
  );
  token = await login("ops@flash.app");
  const processed = await call("/admin/notifications/process", {
    method: "POST",
    body: JSON.stringify({ limit: 20 }),
  });
  const stored = await pool.query(
    `SELECT n.status,n.last_error,d.invalidated_at,d.invalid_reason,d.revoked_at,d.push_token,d.push_token_ciphertext,l.reason FROM notifications n JOIN user_devices d ON d.user_id=n.user_id JOIN notification_dead_letters l ON l.notification_id=n.id WHERE n.public_id=$1`,
    [notificationId],
  );
  assert(
    processed.status === 200 &&
      stored.rows[0]?.status === "dead_lettered" &&
      stored.rows[0].reason === "all_tokens_unregistered" &&
      stored.rows[0].invalid_reason === "unregistered" &&
      stored.rows[0].invalidated_at &&
      stored.rows[0].revoked_at &&
      stored.rows[0].push_token === null &&
      stored.rows[0].push_token_ciphertext &&
      !JSON.stringify(stored.rows[0]).includes(invalidToken),
    "permanent provider failure revokes encrypted token and dead-letters notification",
  );
  const queue = await call("/admin/notifications/dead-letters");
  assert(
    queue.body.deadLetters?.some(
      (entry) =>
        entry.id === notificationId &&
        entry.reason === "all_tokens_unregistered",
    ) &&
      !JSON.stringify(queue.body).includes("payload") &&
      !JSON.stringify(queue.body).includes(invalidToken),
    "admin queue exposes operational facts without token or payload",
  );
  const noDeviceReplay = await call(
    `/admin/notifications/dead-letters/${notificationId}/replay`,
    { method: "POST", body: "{}" },
  );
  assert(
    noDeviceReplay.status === 409,
    "replay requires a newly active delivery destination",
  );
  token = await login(email);
  const validDevice = await call("/devices", {
    method: "POST",
    body: JSON.stringify({
      platform: "android",
      pushToken: `sandbox-valid:${crypto.randomUUID()}`,
      appVersion: "dead-letter-smoke",
      deviceFingerprint: `valid-${crypto.randomUUID()}`,
    }),
  });
  requestIds.push(validDevice.body.requestId);
  token = await login("ops@flash.app");
  const replay = await call(
      `/admin/notifications/dead-letters/${notificationId}/replay`,
      { method: "POST", body: "{}" },
    ),
    replayAgain = await call(
      `/admin/notifications/dead-letters/${notificationId}/replay`,
      { method: "POST", body: "{}" },
    );
  requestIds.push(replay.body.requestId, replayAgain.body.requestId);
  const afterReplay = await pool.query(
    "SELECT status,replay_count,last_replayed_by IS NOT NULL attributed FROM notifications WHERE public_id=$1",
    [notificationId],
  );
  assert(
    replay.status === 200 &&
      replayAgain.status === 200 &&
      afterReplay.rows[0].status === "queued" &&
      afterReplay.rows[0].replay_count === 1 &&
      afterReplay.rows[0].attributed,
    "replay is attributed and idempotent while delivery is queued",
  );
  const delivered = await call("/admin/notifications/process", {
      method: "POST",
      body: JSON.stringify({ limit: 20 }),
    }),
    final = await pool.query(
      `SELECT n.status,l.resolved_at,(SELECT count(*) FROM notification_deliveries d WHERE d.notification_id=n.id AND d.status='delivered')::int delivered FROM notifications n JOIN notification_dead_letters l ON l.notification_id=n.id WHERE n.public_id=$1`,
      [notificationId],
    );
  assert(
    delivered.status === 200 &&
      final.rows[0].status === "delivered" &&
      final.rows[0].resolved_at &&
      final.rows[0].delivered === 1,
    "replayed notification reaches active device and resolves dead-letter evidence",
  );
} finally {
  await pool.query("SELECT set_config('app.audit_maintenance','on',false)");
  if (requestIds.filter(Boolean).length)
    await pool.query("DELETE FROM audit_events WHERE request_id=ANY($1)", [
      requestIds.filter(Boolean),
    ]);
  await pool.query("DELETE FROM notifications WHERE public_id=$1", [
    notificationId,
  ]);
  await pool.query(
    "DELETE FROM refresh_sessions WHERE user_id=(SELECT id FROM users WHERE public_id=$1)",
    [userId],
  );
  await pool.query(
    "DELETE FROM user_roles WHERE user_id=(SELECT id FROM users WHERE public_id=$1)",
    [userId],
  );
  await pool.query("DELETE FROM users WHERE public_id=$1", [userId]);
  await pool.end();
}
