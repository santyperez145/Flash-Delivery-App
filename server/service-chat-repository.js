import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
import {
  decryptServiceAttachment,
  decryptServiceMessage,
  encryptServiceAttachment,
  encryptServiceMessage,
} from "./secret-envelope.js";

const publicId = () => `MSG-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
const attachmentPublicId = () => `ATT-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
const sha256 = (value) =>
  crypto
    .createHash("sha256")
    .update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8"))
    .digest("hex");
const activeStatuses = new Set([
  "requested",
  "accepted",
  "preparing",
  "ready_for_pickup",
  "driver_assigned",
  "arriving",
  "picked_up",
  "delivering",
  "in_progress",
]);
const mapMessage = (row) => ({
  id: row.public_id,
  jobId: row.job_public_id,
  senderId: row.sender_public_id,
  senderName: row.sender_name,
  body: decryptServiceMessage(row.body_ciphertext),
  createdAt: new Date(row.created_at).toISOString(),
  readBy: Array.isArray(row.read_by)
    ? row.read_by.map((entry) => ({
        userId: entry.userId,
        readAt: new Date(entry.readAt).toISOString(),
      }))
    : [],
  attachments: Array.isArray(row.attachments)
    ? row.attachments.map((entry) => ({
        id: entry.id,
        fileName: entry.fileName,
        mimeType: entry.mimeType,
        sizeBytes: Number(entry.sizeBytes),
        createdAt: new Date(entry.createdAt).toISOString(),
      }))
    : [],
});
const matchesMime = (content, mimeType) =>
  mimeType === "image/jpeg"
    ? content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff
    : mimeType === "image/png"
      ? content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : mimeType === "application/pdf"
        ? content.subarray(0, 5).toString("ascii") === "%PDF-"
        : false;
function decodeAttachment(attachment) {
  if (!attachment) return null;
  const content = Buffer.from(attachment.contentBase64, "base64"),
    normalized = content.toString("base64").replace(/=+$/, "");
  if (
    normalized !== attachment.contentBase64.replace(/\s/g, "").replace(/=+$/, "") ||
    !content.length ||
    content.length > 768000
  )
    throw Object.assign(new Error("Adjunto inválido o demasiado grande"), { status: 400 });
  if (!matchesMime(content, attachment.mimeType))
    throw Object.assign(new Error("El contenido no coincide con el tipo de archivo declarado"), {
      status: 400,
    });
  return {
    content,
    fileName: attachment.fileName.replace(/[\\/\0]/g, "_").slice(0, 160),
    mimeType: attachment.mimeType,
  };
}

async function participant(client, { jobPublicId, userPublicId, lock = false }) {
  const row = (
    await client.query(
      `SELECT j.id,j.public_id,j.status,j.kind,j.metadata,j.customer_id,d.user_id driver_user_id,m.owner_id merchant_owner_id,u.id actor_id
  FROM jobs j JOIN users u ON u.public_id=$2 LEFT JOIN drivers d ON d.id=j.driver_id LEFT JOIN merchants m ON m.id=j.merchant_id
  WHERE j.public_id=$1 ${lock ? "FOR UPDATE OF j" : ""}`,
      [jobPublicId, userPublicId],
    )
  ).rows[0];
  if (!row) throw Object.assign(new Error("Servicio no encontrado"), { status: 404 });
  if (
    ![row.customer_id, row.driver_user_id, row.merchant_owner_id]
      .filter(Boolean)
      .includes(row.actor_id)
  )
    throw Object.assign(new Error("No participas de esta conversación"), { status: 403 });
  return row;
}

export async function getServiceMessages({ jobPublicId, userPublicId }) {
  const client = await postgresPool.connect();
  try {
    const actor = await participant(client, { jobPublicId, userPublicId });
    const rows = (
      await client.query(
        `SELECT sm.public_id,j.public_id job_public_id,s.public_id sender_public_id,s.name sender_name,sm.body_ciphertext,sm.created_at,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',reader.public_id,'readAt',r.read_at) ORDER BY r.read_at)
    FROM service_message_reads r JOIN users reader ON reader.id=r.user_id WHERE r.message_id=sm.id),'[]'::jsonb) read_by,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.public_id,'fileName',a.file_name,'mimeType',a.mime_type,'sizeBytes',a.size_bytes,'createdAt',a.created_at) ORDER BY a.created_at)
    FROM service_message_attachments a WHERE a.message_id=sm.id),'[]'::jsonb) attachments
  FROM service_messages sm JOIN jobs j ON j.id=sm.job_id JOIN users s ON s.id=sm.sender_id WHERE j.public_id=$1 ORDER BY sm.created_at,sm.id LIMIT 200`,
        [jobPublicId],
      )
    ).rows;
    return {
      messages: rows.map(mapMessage),
      unreadCount: Number(
        (
          await client.query(
            `SELECT count(*)::int count FROM service_messages sm WHERE sm.job_id=$1 AND sm.sender_id<>$2
            AND NOT EXISTS(SELECT 1 FROM service_message_reads r WHERE r.message_id=sm.id AND r.user_id=$2)`,
            [actor.id, actor.actor_id],
          )
        ).rows[0].count,
      ),
    };
  } finally {
    client.release();
  }
}

export async function markServiceMessagesRead({ jobPublicId, userPublicId }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const actor = await participant(client, { jobPublicId, userPublicId, lock: true });
    const result = await client.query(
      `INSERT INTO service_message_reads(message_id,user_id)
  SELECT sm.id,$2 FROM service_messages sm WHERE sm.job_id=$1 AND sm.sender_id<>$2
  ON CONFLICT(message_id,user_id) DO NOTHING RETURNING message_id`,
      [actor.id, actor.actor_id],
    );
    await client.query(
      `UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE user_id=$2 AND template='service_message' AND payload->>'jobId'=$1`,
      [jobPublicId, actor.actor_id],
    );
    await client.query("COMMIT");
    return { readCount: result.rowCount, readAt: new Date().toISOString() };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getServiceAttachmentContent({
  attachmentPublicId: attachmentId,
  userPublicId,
}) {
  const client = await postgresPool.connect();
  try {
    const row = (
      await client.query(
        `SELECT a.public_id,a.file_name,a.mime_type,a.size_bytes,a.content_ciphertext,j.public_id job_public_id
        FROM service_message_attachments a JOIN service_messages sm ON sm.id=a.message_id JOIN jobs j ON j.id=sm.job_id
        WHERE a.public_id=$1`,
        [attachmentId],
      )
    ).rows[0];
    if (!row) throw Object.assign(new Error("Adjunto no encontrado"), { status: 404 });
    await participant(client, { jobPublicId: row.job_public_id, userPublicId });
    return {
      attachment: {
        id: row.public_id,
        fileName: row.file_name,
        mimeType: row.mime_type,
        sizeBytes: Number(row.size_bytes),
      },
      contentBase64: decryptServiceAttachment(row.content_ciphertext).toString("base64"),
    };
  } finally {
    client.release();
  }
}

const mapQuickReply = (row) => ({
  id: row.public_id,
  serviceScope: row.service_scope,
  audience: row.audience,
  locale: row.locale,
  body: row.body,
  position: Number(row.position),
  active: row.active,
  updatedAt: new Date(row.updated_at).toISOString(),
});
export async function getServiceQuickReplies({ jobPublicId, userPublicId, locale = "es-AR" }) {
  const client = await postgresPool.connect();
  try {
    const job = await participant(client, { jobPublicId, userPublicId }),
      audience =
        job.actor_id === job.customer_id
          ? "customer"
          : job.actor_id === job.driver_user_id
            ? "driver"
            : "merchant",
      scope =
        job.kind === "ride" ? "ride" : job.metadata?.subtype === "shipment" ? "shipment" : "food";
    const rows = (
      await client.query(
        `SELECT * FROM service_chat_quick_replies WHERE active AND audience=$1 AND locale=$2 AND service_scope IN('all',$3) ORDER BY CASE WHEN service_scope=$3 THEN 0 ELSE 1 END,position,body`,
        [audience, locale, scope],
      )
    ).rows;
    return {
      quickReplies: rows.map(mapQuickReply),
      context: { serviceScope: scope, audience, locale },
    };
  } finally {
    client.release();
  }
}
export async function listServiceQuickReplies() {
  return (
    await postgresPool.query(
      "SELECT * FROM service_chat_quick_replies ORDER BY locale,audience,service_scope,position,body",
    )
  ).rows.map(mapQuickReply);
}
export async function createServiceQuickReply({
  serviceScope,
  audience,
  locale,
  body,
  position,
  active,
}) {
  const id = `QRP-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
    row = (
      await postgresPool.query(
        `INSERT INTO service_chat_quick_replies(public_id,service_scope,audience,locale,body,position,active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [id, serviceScope, audience, locale, body, position, active],
      )
    ).rows[0];
  return mapQuickReply(row);
}
export async function updateServiceQuickReply({ publicId, ...changes }) {
  const current = (
    await postgresPool.query("SELECT * FROM service_chat_quick_replies WHERE public_id=$1", [
      publicId,
    ])
  ).rows[0];
  if (!current) throw Object.assign(new Error("Respuesta rápida no encontrada"), { status: 404 });
  const row = (
    await postgresPool.query(
      `UPDATE service_chat_quick_replies SET service_scope=$2,audience=$3,locale=$4,body=$5,position=$6,active=$7,updated_at=now() WHERE public_id=$1 RETURNING *`,
      [
        publicId,
        changes.serviceScope ?? current.service_scope,
        changes.audience ?? current.audience,
        changes.locale ?? current.locale,
        changes.body ?? current.body,
        changes.position ?? current.position,
        changes.active ?? current.active,
      ],
    )
  ).rows[0];
  return mapQuickReply(row);
}

export async function createServiceMessage({ jobPublicId, userPublicId, body, attachment }) {
  const decoded = decodeAttachment(attachment),
    client = await postgresPool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const job = await participant(client, { jobPublicId, userPublicId, lock: true });
    if (!activeStatuses.has(job.status))
      throw Object.assign(new Error("La conversación ya no admite mensajes"), { status: 409 });
    const id = publicId(),
      ciphertext = encryptServiceMessage(body || "");
    const row = (
      await client.query(
        `INSERT INTO service_messages(public_id,job_id,sender_id,body_ciphertext,body_sha256) SELECT $1,$2,u.id,$3,$4 FROM users u WHERE u.public_id=$5 RETURNING id,public_id,created_at`,
        [id, job.id, ciphertext, sha256(body || ""), userPublicId],
      )
    ).rows[0];
    if (decoded)
      await client.query(
        `INSERT INTO service_message_attachments(public_id,message_id,file_name,mime_type,content_ciphertext,content_sha256,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          attachmentPublicId(),
          row.id,
          decoded.fileName,
          decoded.mimeType,
          encryptServiceAttachment(decoded.content),
          sha256(decoded.content),
          decoded.content.length,
        ],
      );
    await client.query(
      `INSERT INTO notifications(public_id,user_id,channel,template,payload,deduplication_key,status)
    SELECT 'NTF-'||upper(substr(md5(random()::text||recipient::text),1,8)),recipient,'in_app','service_message',
      jsonb_build_object('jobId',$1::text,'messageId',$2::text),$2::text||':'||recipient::text,'sent'
    FROM unnest(ARRAY[$3::uuid,$4::uuid,$5::uuid]) recipient WHERE recipient IS NOT NULL AND recipient<>$6 ON CONFLICT DO NOTHING`,
      [jobPublicId, id, job.customer_id, job.driver_user_id, job.merchant_owner_id, job.actor_id],
    );
    await client.query("COMMIT");
    transactionOpen = false;
    return (await getServiceMessages({ jobPublicId, userPublicId })).messages.find(
      (message) => message.id === row.public_id,
    );
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
