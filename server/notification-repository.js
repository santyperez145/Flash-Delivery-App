// Preferencias, dispositivos, enqueue e inbox de notificaciones (ARC-001).
//
// Entrega (worker push/email, recibos, dead letters) →
// `notification-delivery-repository.js`.
import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
import { encryptDeviceToken, hashDeviceToken } from "./secret-envelope.js";
const publicId = (prefix) => `${prefix}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const preferenceCategories = ["service_updates", "promotions", "support", "wallet", "account"];
// `job_released` / `job_assigned` van nombradas: caen en `account` por descarte
// —no contienen «status» ni empiezan con `ride_`— y son novedades de servicio.
// A un conductor que pierde o recibe un trabajo a mano hay que avisarle por el
// mismo canal que el resto de las ofertas, o se entera tarde.
const categoryForTemplate = (template) =>
  template === "job_released" || template === "job_assigned"
    ? "service_updates"
    : template.startsWith("support_")
      ? "support"
      : template.startsWith("tip_") || template.includes("refund")
        ? "wallet"
        : template.startsWith("promotion_")
          ? "promotions"
          : template.includes("status") ||
              template.includes("substitution") ||
              template.includes("issue") ||
              template.startsWith("ride_")
            ? "service_updates"
            : "account";
const essentialTemplates = new Set(["dispatch_offer", "job_assigned", "security_alert"]);
export async function getPostgresNotificationPreferences(userPublicId) {
  const rows = (
    await postgresPool.query(
      `SELECT p.category,p.push_enabled,p.email_enabled,p.updated_at FROM user_notification_preferences p JOIN users u ON u.id=p.user_id WHERE u.public_id=$1`,
      [userPublicId],
    )
  ).rows;
  const indexed = new Map(rows.map((row) => [row.category, row]));
  return preferenceCategories.map((category) => {
    const row = indexed.get(category);
    return {
      category,
      pushEnabled: row?.push_enabled ?? category !== "promotions",
      emailEnabled: row?.email_enabled ?? false,
      updatedAt: row ? new Date(row.updated_at).toISOString() : null,
    };
  });
}
export async function updatePostgresNotificationPreference({
  userPublicId,
  category,
  pushEnabled,
  emailEnabled,
}) {
  await postgresPool.query(
    `INSERT INTO user_notification_preferences(user_id,category,push_enabled,email_enabled)
    SELECT id,$2,$3,$4 FROM users WHERE public_id=$1
    ON CONFLICT(user_id,category) DO UPDATE SET push_enabled=excluded.push_enabled,email_enabled=excluded.email_enabled,updated_at=now()`,
    [userPublicId, category, pushEnabled, emailEnabled],
  );
  return getPostgresNotificationPreferences(userPublicId);
}

export async function registerPostgresDevice({
  userPublicId,
  platform,
  pushToken,
  appVersion,
  fingerprint,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const user = (await client.query("SELECT id FROM users WHERE public_id=$1", [userPublicId]))
      .rows[0];
    if (!user) throw Object.assign(new Error("Usuario no encontrado"), { status: 404 });
    const tokenHash = hashDeviceToken(pushToken),
      ciphertext = encryptDeviceToken(pushToken);
    await client.query(
      "UPDATE user_devices SET revoked_at=now() WHERE push_token_hash=$1 AND user_id<>$2 AND revoked_at IS NULL",
      [tokenHash, user.id],
    );
    const row = (
      await client.query(
        `INSERT INTO user_devices(public_id,user_id,platform,push_token,push_token_ciphertext,push_token_hash,device_fingerprint_hash,app_version,last_seen_at,revoked_at)
        VALUES($1,$2,$3,NULL,$4,$5,$6,$7,now(),NULL)
    ON CONFLICT(push_token_hash) WHERE push_token_hash IS NOT NULL AND revoked_at IS NULL
    DO UPDATE SET user_id=excluded.user_id,platform=excluded.platform,push_token=NULL,
      push_token_ciphertext=excluded.push_token_ciphertext,device_fingerprint_hash=excluded.device_fingerprint_hash,
      app_version=excluded.app_version,last_seen_at=now(),revoked_at=NULL
    RETURNING public_id,platform,app_version,last_seen_at`,
        [
          publicId("DEV"),
          user.id,
          platform,
          ciphertext,
          tokenHash,
          fingerprint,
          appVersion || null,
        ],
      )
    ).rows[0];
    await client.query("COMMIT");
    return {
      id: row.public_id,
      platform: row.platform,
      appVersion: row.app_version || null,
      lastSeenAt: new Date(row.last_seen_at).toISOString(),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function revokePostgresDevice({ userPublicId, devicePublicId }) {
  const result = await postgresPool.query(
    `UPDATE user_devices d SET revoked_at=now() FROM users u WHERE d.user_id=u.id AND u.public_id=$1 AND d.public_id=$2 AND d.revoked_at IS NULL RETURNING d.public_id`,
    [userPublicId, devicePublicId],
  );
  if (!result.rows[0])
    throw Object.assign(new Error("Dispositivo no encontrado"), {
      status: 404,
    });
}
export async function getPostgresDevices(userPublicId) {
  const result = await postgresPool.query(
    `SELECT d.public_id,d.platform,d.app_version,d.last_seen_at FROM user_devices d JOIN users u ON u.id=d.user_id WHERE u.public_id=$1 AND d.revoked_at IS NULL ORDER BY d.last_seen_at DESC`,
    [userPublicId],
  );
  return result.rows.map((row) => ({
    id: row.public_id,
    platform: row.platform,
    appVersion: row.app_version || null,
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
  }));
}

export async function enqueuePostgresNotification({
  userPublicId,
  channel = "push",
  template,
  payload = {},
  deduplicationKey,
  scheduledAt = new Date(),
}) {
  const category = categoryForTemplate(template),
    essential = essentialTemplates.has(template);
  const result = await postgresPool.query(
    `INSERT INTO notifications(public_id,user_id,channel,template,payload,deduplication_key,status,scheduled_at)
    SELECT $1,u.id,CASE WHEN $2='push' AND NOT $8 AND COALESCE(p.push_enabled,$9)=false THEN 'in_app' ELSE $2 END,$3,$4,$5,
      CASE WHEN $2='push' AND NOT $8 AND COALESCE(p.push_enabled,$9)=false THEN 'sent' ELSE 'queued' END,$6
    FROM users u LEFT JOIN user_notification_preferences p ON p.user_id=u.id AND p.category=$10
    WHERE u.public_id=$7 ON CONFLICT(user_id,channel,deduplication_key) DO NOTHING RETURNING public_id`,
    [
      publicId("NTF"),
      channel,
      template,
      payload,
      deduplicationKey,
      scheduledAt,
      userPublicId,
      essential,
      category !== "promotions",
      category,
    ],
  );
  return result.rows[0]?.public_id || null;
}

export async function enqueueNotificationForInternalUser(
  client,
  { userId, channel = "push", template, payload = {}, deduplicationKey, scheduledAt = new Date() },
) {
  const category = categoryForTemplate(template),
    essential = essentialTemplates.has(template),
    defaultPush = category !== "promotions";
  const result = await client.query(
    `INSERT INTO notifications(public_id,user_id,channel,template,payload,deduplication_key,status,scheduled_at)
    SELECT $1,$2,
      CASE WHEN $3='push' AND NOT $8 AND COALESCE(p.push_enabled,$9)=false THEN 'in_app' ELSE $3 END,
      $4,$5,$6,
      CASE WHEN $3='push' AND NOT $8 AND COALESCE(p.push_enabled,$9)=false THEN 'sent' ELSE 'queued' END,$7
    FROM (SELECT 1) seed LEFT JOIN user_notification_preferences p ON p.user_id=$2 AND p.category=$10
    ON CONFLICT(user_id,channel,deduplication_key) DO NOTHING RETURNING public_id`,
    [
      publicId("NTF"),
      userId,
      channel,
      template,
      payload,
      deduplicationKey,
      scheduledAt,
      essential,
      defaultPush,
      category,
    ],
  );
  return result.rows[0]?.public_id || null;
}

// Inbox del cliente (listar / marcar leída). El envío push vive arriba;
// estas dos lecturas salieron de operations-repository en ARC-001.
export async function getPostgresNotifications(userPublicId) {
  const result = await postgresPool.query(
    `SELECT n.public_id id, n.channel, n.template, n.payload, n.status,
      n.created_at, n.read_at
     FROM notifications n
     JOIN users u ON u.id = n.user_id
     WHERE u.public_id = $1
     ORDER BY n.created_at DESC
     LIMIT 100`,
    [userPublicId],
  );
  return result.rows.map((row) => ({
    ...row,
    createdAt: new Date(row.created_at).toISOString(),
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
  }));
}
export async function markPostgresNotificationRead({ publicId, userPublicId }) {
  const result = await postgresPool.query(
    `UPDATE notifications n SET status='read',read_at=COALESCE(read_at,now()) FROM users u WHERE n.user_id=u.id AND n.public_id=$1 AND u.public_id=$2 RETURNING n.public_id`,
    [publicId, userPublicId],
  );
  if (!result.rows[0])
    throw Object.assign(new Error("Notificación no encontrada"), {
      status: 404,
    });
  return getPostgresNotifications(userPublicId);
}
