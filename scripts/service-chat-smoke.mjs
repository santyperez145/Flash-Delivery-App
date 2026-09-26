import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  ssl: false,
});
const base = process.env.API_URL || "http://127.0.0.1:4000/api";
let token = "",
  jobId = `RIDE-CHAT-${Date.now()}`,
  requestIds = [],
  quickReplyId = null;
const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
const request = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  let body = {};
  try {
    body = await response.json();
  } catch {}
  return { status: response.status, body };
};
const login = async (email) => {
  const result = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "demo123", deviceName: "service-chat-smoke" }),
  });
  if (result.status !== 200) throw new Error(`login failed for ${email}`);
  return result.body.token;
};

try {
  await pool.query("SELECT set_config('app.audit_maintenance','on',false)");
  await pool.query("DELETE FROM audit_events WHERE entity_id LIKE 'RIDE-CHAT-%'");
  await pool.query("DELETE FROM realtime_events WHERE entity_id LIKE 'RIDE-CHAT-%'");
  await pool.query("DELETE FROM notifications WHERE payload->>'jobId' LIKE 'RIDE-CHAT-%'");
  await pool.query("DELETE FROM jobs WHERE public_id LIKE 'RIDE-CHAT-%'");
  await pool.query(
    `INSERT INTO jobs(
      public_id,kind,customer_id,driver_id,status,pickup_address,pickup_location,
      dropoff_address,dropoff_location,service_level,quoted_amount_cents,
      final_amount_cents,distance_m,estimated_duration_s,metadata
    )
    SELECT $1,'ride',customer.id,driver.id,'driver_assigned','Origen',
      ST_SetSRID(ST_MakePoint(-58.39,-34.60),4326)::geography,'Destino',
      ST_SetSRID(ST_MakePoint(-58.40,-34.61),4326)::geography,'economy',
      100000,100000,1500,600,'{}'::jsonb
    FROM users customer CROSS JOIN drivers driver
    WHERE customer.public_id='usr_customer' AND driver.public_id='drv_lautaro'`,
    [jobId],
  );
  const customerToken = await login("cliente@flash.app"),
    driverToken = await login("conductor@flash.app"),
    foreignToken = await login("ops@flash.app");
  token = customerToken;
  const customerReplies = await request(`/jobs/${jobId}/quick-replies`);
  token = foreignToken;
  const foreignReplies = await request(`/jobs/${jobId}/quick-replies`),
    adminReplies = await request("/admin/service-chat/quick-replies"),
    createdReply = await request("/admin/service-chat/quick-replies", {
      method: "POST",
      body: JSON.stringify({
        serviceScope: "ride",
        audience: "driver",
        locale: "es-AR",
        body: `Respuesta runtime ${Date.now()}`,
        position: 1,
        active: true,
      }),
    });
  quickReplyId = createdReply.body.quickReply?.id;
  requestIds.push(createdReply.body.requestId);
  token = driverToken;
  const driverReplies = await request(`/jobs/${jobId}/quick-replies`);
  token = foreignToken;
  const disabledReply = await request(`/admin/service-chat/quick-replies/${quickReplyId}`, {
    method: "PATCH",
    body: JSON.stringify({ active: false }),
  });
  requestIds.push(disabledReply.body.requestId);
  token = driverToken;
  const repliesAfterDisable = await request(`/jobs/${jobId}/quick-replies`);
  assert(
    customerReplies.body.context?.audience === "customer" &&
      customerReplies.body.quickReplies.every((entry) => entry.audience === "customer") &&
      foreignReplies.status === 403 &&
      adminReplies.body.quickReplies?.length >= 11 &&
      createdReply.status === 201 &&
      driverReplies.body.quickReplies?.some((entry) => entry.id === quickReplyId) &&
      disabledReply.body.quickReply?.active === false &&
      !repliesAfterDisable.body.quickReplies?.some((entry) => entry.id === quickReplyId),
    "quick replies are PostgreSQL-configured by service, audience and active state with admin-only mutations",
  );
  token = customerToken;
  const privateBody = `Mensaje receipt ${crypto.randomUUID()}`,
    created = await request(`/jobs/${jobId}/messages`, {
      method: "POST",
      body: JSON.stringify({ body: privateBody }),
    });
  requestIds.push(created.body.requestId);
  assert(
    created.status === 201 && created.body.message?.readBy?.length === 0,
    "new message starts without fabricated read receipts",
  );
  const attachmentBytes = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from(`chat-attachment-${crypto.randomUUID()}`),
    ]),
    invalidAttachment = await request(`/jobs/${jobId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        attachment: {
          fileName: "spoof.png",
          mimeType: "image/png",
          contentBase64: attachmentBytes.toString("base64"),
        },
      }),
    }),
    attached = await request(`/jobs/${jobId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        body: "Foto del punto",
        attachment: {
          fileName: "punto-seguro.jpg",
          mimeType: "image/jpeg",
          contentBase64: attachmentBytes.toString("base64"),
        },
      }),
    }),
    attachmentId = attached.body.message?.attachments?.[0]?.id;
  requestIds.push(attached.body.requestId);
  const storedAttachment = await pool.query(
    "SELECT content_ciphertext,content_sha256,size_bytes FROM service_message_attachments WHERE public_id=$1",
    [attachmentId],
  );
  assert(
    invalidAttachment.status === 400 &&
      attached.status === 201 &&
      attachmentId &&
      storedAttachment.rows[0]?.content_ciphertext.indexOf(attachmentBytes.toString("base64")) ===
        -1 &&
      storedAttachment.rows[0]?.content_sha256 ===
        crypto.createHash("sha256").update(attachmentBytes).digest("hex"),
    "chat attachment validates magic bytes and persists encrypted content with exact digest",
  );
  token = foreignToken;
  assert(
    (await request(`/jobs/${jobId}/messages/read`, { method: "POST", body: "{}" })).status ===
      403 && (await request(`/service-message-attachments/${attachmentId}/content`)).status === 403,
    "non-participant cannot create receipts or download attachments",
  );
  token = driverToken;
  const before = await request(`/jobs/${jobId}/messages`),
    downloaded = await request(`/service-message-attachments/${attachmentId}/content`);
  assert(
    before.status === 200 &&
      before.body.unreadCount === 2 &&
      before.body.messages[0]?.body === privateBody &&
      downloaded.body.contentBase64 === attachmentBytes.toString("base64"),
    "assigned driver sees genuine unread messages and decrypts the authorized attachment",
  );
  const marked = await request(`/jobs/${jobId}/messages/read`, { method: "POST", body: "{}" }),
    markedAgain = await request(`/jobs/${jobId}/messages/read`, { method: "POST", body: "{}" });
  assert(
    marked.body.receipt?.readCount === 2 && markedAgain.body.receipt?.readCount === 0,
    "read acknowledgement is durable and idempotent",
  );
  token = customerToken;
  const after = await request(`/jobs/${jobId}/messages`),
    stored = await pool.query(
      `SELECT sm.body_ciphertext,
        sm.body_sha256,
        r.read_at,
        reader.public_id reader_id FROM service_messages sm JOIN service_message_reads r ON r.message_id=sm.id JOIN users reader ON reader.id=r.user_id WHERE sm.public_id=$1`,
      [created.body.message.id],
    ),
    notification = await pool.query(
      `SELECT read_at,payload FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.public_id='usr_driver' AND n.template='service_message' AND n.payload->>'jobId'=$1`,
      [jobId],
    );
  assert(
    after.body.messages[0]?.readBy?.some((entry) => entry.userId === "usr_driver") &&
      stored.rows[0]?.body_ciphertext !== privateBody &&
      stored.rows[0]?.body_sha256.length === 64 &&
      stored.rows[0]?.reader_id === "usr_driver" &&
      notification.rows[0]?.read_at &&
      JSON.stringify(notification.rows[0].payload).indexOf(privateBody) === -1,
    "sender sees real receipt while content stays encrypted and notification remains metadata-only",
  );
} finally {
  if (requestIds.length) {
    await pool.query("SELECT set_config('app.audit_maintenance','on',false)");
    await pool.query("DELETE FROM audit_events WHERE request_id=ANY($1)", [requestIds]);
    await pool.query("DELETE FROM realtime_events WHERE request_id=ANY($1)", [requestIds]);
  }
  if (quickReplyId)
    await pool.query("DELETE FROM service_chat_quick_replies WHERE public_id=$1", [quickReplyId]);
  await pool.query("DELETE FROM notifications WHERE payload->>'jobId'=$1", [jobId]);
  await pool.query("DELETE FROM jobs WHERE public_id=$1", [jobId]);
  await pool.end();
}
