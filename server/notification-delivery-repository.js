// Entrega de notificaciones: worker push/email, recibos y dead letters (ARC-001).
//
// Separado del alta de preferencias/dispositivos y del enqueue: es el proceso
// que consume la cola. Preferencias e inbox viven en notification-repository.
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { postgresPool } from "./postgres.js";
import { config } from "./config.js";
import {
  buildExpoMessage,
  chunk,
  EXPO_BATCH_LIMIT,
  EXPO_RECEIPT_LIMIT,
  fetchExpoPushReceipts,
  sendExpoPushBatch,
} from "./push-provider.js";
import {
  decryptDeviceToken,
  decryptEmailVerificationCode,
  decryptRecoveryToken,
} from "./secret-envelope.js";

let smtpTransport = null;

async function deliverEmail(notification) {
  const recipient = (
    await postgresPool.query("SELECT email FROM users WHERE id=$1 AND status='active'", [
      notification.user_id,
    ])
  ).rows[0];
  if (!recipient)
    throw Object.assign(new Error("recipient_unavailable"), {
      code: "recipient_unavailable",
    });
  if (
    !notification.sensitive_payload_ciphertext ||
    !["password_recovery", "email_verification"].includes(notification.template)
  )
    throw Object.assign(new Error("unsupported_email_template"), {
      code: "unsupported_email_template",
    });
  const isVerification = notification.template === "email_verification",
    secret = isVerification
      ? decryptEmailVerificationCode(notification.sensitive_payload_ciphertext)
      : decryptRecoveryToken(notification.sensitive_payload_ciphertext),
    link = `${config.appPublicUrl.replace(/\/$/, "")}/recover-password?token=${encodeURIComponent(secret)}`;
  if (config.emailProvider === "sandbox") return `sandbox-email-${crypto.randomUUID()}`;
  if (config.emailProvider !== "smtp")
    throw Object.assign(new Error("email_provider_disabled"), {
      code: "email_provider_disabled",
    });
  smtpTransport ||= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.password },
    pool: true,
  });
  const message = isVerification
    ? {
        subject: "Verificá tu email en Flash",
        text: `Tu código de verificación es ${secret}. Vence en 10 minutos.`,
        html: `<p>Tu código de verificación de Flash es:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${secret}</p><p>Vence en 10 minutos.</p>`,
      }
    : {
        subject: "Recuperá tu cuenta Flash",
        text: `Abrí este enlace para crear una contraseña nueva. Vence en 20 minutos: ${link}\n\nSi no lo pediste, ignorá este mensaje.`,
        html: `<p>Abrí el siguiente enlace para crear una contraseña nueva. Vence en 20 minutos.</p><p><a href="${link}">Recuperar cuenta Flash</a></p><p>Si no lo pediste, ignorá este mensaje.</p>`,
      };
  const info = await smtpTransport.sendMail({
    from: config.smtp.from,
    to: recipient.email,
    ...message,
  });
  return info.messageId || `smtp-${crypto.randomUUID()}`;
}

async function deadLetterNotification(notification, { workerId, reason }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const updated = (
      await client.query(
        "UPDATE notifications SET status='dead_lettered',dead_lettered_at=now(),last_error=$3,locked_at=NULL,locked_by=NULL WHERE id=$1 AND locked_by=$2 RETURNING id",
        [notification.id, workerId, reason],
      )
    ).rows[0];
    if (updated)
      await client.query(
        `INSERT INTO notification_dead_letters(notification_id,reason,attempts) VALUES($1,$2,$3)
        ON CONFLICT(notification_id) DO UPDATE SET reason=excluded.reason,attempts=excluded.attempts,created_at=now(),resolved_at=NULL,replayed_by=NULL`,
        [notification.id, reason, notification.attempts],
      );
    await client.query("COMMIT");
    return Boolean(updated);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
const mapDeadLetter = (row) => ({
  id: row.public_id,
  userId: row.user_public_id,
  channel: row.channel,
  template: row.template,
  reason: row.reason,
  attempts: row.dead_letter_attempts,
  replayCount: row.replay_count,
  createdAt: new Date(row.dead_letter_created_at).toISOString(),
  lastReplayedAt: row.last_replayed_at ? new Date(row.last_replayed_at).toISOString() : null,
});
const deadLetterSelect = `SELECT n.public_id,n.channel,n.template,n.replay_count,n.last_replayed_at,u.public_id user_public_id,
  d.reason,d.attempts dead_letter_attempts,d.created_at dead_letter_created_at
  FROM notification_dead_letters d JOIN notifications n ON n.id=d.notification_id JOIN users u ON u.id=n.user_id`;
export async function getNotificationDeadLetters() {
  return (
    await postgresPool.query(
      `${deadLetterSelect} WHERE d.resolved_at IS NULL ORDER BY d.created_at DESC LIMIT 200`,
    )
  ).rows.map(mapDeadLetter);
}
export async function replayNotificationDeadLetter({ notificationPublicId, actorPublicId }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const row = (
      await client.query(`${deadLetterSelect} WHERE n.public_id=$1 FOR UPDATE OF n,d`, [
        notificationPublicId,
      ])
    ).rows[0];
    if (!row)
      throw Object.assign(new Error("Notificación descartada no encontrada"), {
        status: 404,
      });
    if (row.channel === "push") {
      const active = Number(
        (
          await client.query(
            "SELECT count(*)::int count FROM user_devices d JOIN notifications n ON n.user_id=d.user_id WHERE n.public_id=$1 AND d.revoked_at IS NULL AND d.push_token_ciphertext IS NOT NULL",
            [notificationPublicId],
          )
        ).rows[0].count,
      );
      if (!active)
        throw Object.assign(new Error("No hay dispositivo activo para reintentar"), {
          status: 409,
        });
    }
    const actor = (await client.query("SELECT id FROM users WHERE public_id=$1", [actorPublicId]))
      .rows[0];
    const replayed = (
      await client.query(
        `UPDATE notifications SET status='queued',attempts=0,scheduled_at=now(),dead_lettered_at=NULL,last_error=NULL,
          locked_at=NULL,locked_by=NULL,replay_count=replay_count+1,last_replayed_at=now(),last_replayed_by=$2
        WHERE public_id=$1 AND status='dead_lettered' RETURNING id`,
        [notificationPublicId, actor?.id || null],
      )
    ).rows[0];
    if (replayed)
      await client.query(
        "UPDATE notification_dead_letters SET resolved_at=now(),replayed_by=$2 WHERE notification_id=$1",
        [replayed.id, actor?.id || null],
      );
    await client.query("COMMIT");
    return mapDeadLetter({
      ...row,
      replay_count: Number(row.replay_count) + (replayed ? 1 : 0),
      last_replayed_at: replayed ? new Date() : row.last_replayed_at,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Entrega por Expo.
//
// Un ticket aceptado deja la notificación en `sent`, no en `delivered`: Expo
// sólo confirmó que tomó el mensaje. `processPostgresPushReceipts` la promueve a
// `delivered` cuando el recibo lo confirma. Tratar el ticket como entrega sería
// afirmar algo que el proveedor no dijo, y su servicio no tiene SLA.
async function deliverViaExpo({ notification, devices, attempt, workerId }) {
  const targets = [];
  for (const device of devices) {
    const token = decryptDeviceToken(device.push_token_ciphertext);
    if (!token) continue;
    targets.push({ device, token });
  }
  if (targets.length === 0) {
    await deadLetterNotification(notification, { workerId, reason: "no_active_device" });
    return { id: notification.public_id, status: "dead_lettered" };
  }

  let accepted = 0,
    invalidated = 0,
    failed = 0,
    retryable = false;
  let firstTicketId = null;

  for (const batch of chunk(targets, EXPO_BATCH_LIMIT)) {
    const messages = batch.map(({ token }) =>
      buildExpoMessage({
        token,
        title: notification.title,
        body: notification.body,
        // El payload no transporta datos sensibles: sólo lo necesario para que
        // la app abra el recurso correcto y vuelva a consultarlo autenticada.
        data: { type: notification.type, entityId: notification.entity_id ?? null },
      }),
    );

    let tickets;
    try {
      tickets = await sendExpoPushBatch({ messages });
    } catch (error) {
      // Falla de transporte: no se sabe si Expo recibió el lote. No se marca
      // nada como entregado y se deja que el reintento lo resuelva.
      retryable = retryable || error?.retryable !== false;
      failed += batch.length;
      continue;
    }

    for (let index = 0; index < tickets.length; index += 1) {
      const ticket = tickets[index];
      const { device } = batch[index];
      if (ticket.status === "accepted") {
        firstTicketId = firstTicketId ?? ticket.ticketId;
        await postgresPool.query(
          `INSERT INTO notification_deliveries(notification_id,device_id,attempt,provider,provider_message_id,status)
           VALUES($1,$2,$3,'expo',$4,'accepted')
           ON CONFLICT (notification_id,device_id,attempt) DO NOTHING`,
          [notification.id, device.id, attempt, ticket.ticketId],
        );
        accepted += 1;
        continue;
      }
      await postgresPool.query(
        `INSERT INTO notification_deliveries(notification_id,device_id,attempt,provider,status,error_code)
         VALUES($1,$2,$3,'expo','failed',$4)
         ON CONFLICT (notification_id,device_id,attempt) DO NOTHING`,
        [notification.id, device.id, attempt, ticket.reason],
      );
      if (ticket.reason === "device_unregistered") {
        await invalidateDevice(device.id, "unregistered");
        invalidated += 1;
      } else {
        failed += 1;
        retryable = retryable || ticket.retryable !== false;
      }
    }
  }

  if (accepted > 0) {
    await postgresPool.query(
      "UPDATE notifications SET status='sent',sent_at=now(),provider_message_id=$2,last_error=NULL,locked_at=NULL,locked_by=NULL WHERE id=$1 AND locked_by=$3",
      [notification.id, firstTicketId, workerId],
    );
    return { id: notification.public_id, status: "accepted", devices: accepted, invalidated };
  }

  if (retryable && failed > 0) {
    // Se libera el lock para que otra pasada lo reintente con backoff.
    await postgresPool.query(
      "UPDATE notifications SET locked_at=NULL,locked_by=NULL,last_error='expo_delivery_failed' WHERE id=$1 AND locked_by=$2",
      [notification.id, workerId],
    );
    return { id: notification.public_id, status: "retry", invalidated };
  }

  await deadLetterNotification(notification, {
    workerId,
    reason: invalidated ? "all_tokens_unregistered" : "delivery_failed",
  });
  return { id: notification.public_id, status: "dead_lettered", invalidated };
}

async function invalidateDevice(deviceId, reason) {
  await postgresPool.query(
    "UPDATE user_devices SET revoked_at=COALESCE(revoked_at,now()),invalidated_at=now(),invalid_reason=$2 WHERE id=$1",
    [deviceId, reason],
  );
}

/**
 * Confirma entregas consultando los recibos de Expo.
 *
 * Un recibo ausente NO es un éxito: queda como `accepted` sin confirmar y la
 * alerta de recibos vencidos lo tiene que levantar. Esa es la diferencia entre
 * monitorear la entrega y suponerla.
 */
export async function processPostgresPushReceipts({ limit = EXPO_RECEIPT_LIMIT } = {}) {
  const delaySeconds = config.push?.receiptDelaySeconds ?? 60;
  const pending = (
    await postgresPool.query(
      `SELECT d.id,d.provider_message_id,d.notification_id,d.device_id
       FROM notification_deliveries d
       WHERE d.status='accepted' AND d.receipt_checked_at IS NULL
         AND d.provider='expo' AND d.provider_message_id IS NOT NULL
         AND d.created_at <= now() - ($2 * interval '1 second')
       ORDER BY d.created_at LIMIT $1`,
      [Math.min(limit, EXPO_RECEIPT_LIMIT), delaySeconds],
    )
  ).rows;

  if (pending.length === 0)
    return { checked: 0, delivered: 0, failed: 0, unknown: 0, invalidated: 0 };

  const receipts = await fetchExpoPushReceipts({
    ticketIds: pending.map((row) => row.provider_message_id),
  });

  let delivered = 0,
    failed = 0,
    unknown = 0,
    invalidated = 0;

  for (const row of pending) {
    const receipt = receipts.get(row.provider_message_id) ?? { status: "unknown" };
    if (receipt.status === "delivered") {
      await postgresPool.query(
        "UPDATE notification_deliveries SET status='delivered',receipt_checked_at=now() WHERE id=$1",
        [row.id],
      );
      await postgresPool.query(
        "UPDATE notifications SET status='delivered' WHERE id=$1 AND status='sent'",
        [row.notification_id],
      );
      delivered += 1;
      continue;
    }
    if (receipt.status === "failed") {
      await postgresPool.query(
        "UPDATE notification_deliveries SET status='failed',receipt_checked_at=now(),receipt_error_code=$2 WHERE id=$1",
        [row.id, receipt.reason],
      );
      if (receipt.reason === "device_unregistered" && row.device_id) {
        await invalidateDevice(row.device_id, "unregistered");
        invalidated += 1;
      }
      failed += 1;
      continue;
    }
    // Desconocido: se deja pendiente a propósito para que la alerta lo vea.
    unknown += 1;
  }

  return { checked: pending.length, delivered, failed, unknown, invalidated };
}

export async function processPostgresNotificationBatch({
  workerId = `worker-${process.pid}`,
  limit = 25,
  provider = "sandbox",
} = {}) {
  const client = await postgresPool.connect();
  const claimed = [];
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `WITH candidates AS(
        SELECT id FROM notifications WHERE status='queued' AND scheduled_at<=now()
          AND (locked_at IS NULL OR locked_at<now()-interval '5 minutes')
        ORDER BY scheduled_at,created_at FOR UPDATE SKIP LOCKED LIMIT $1)
      UPDATE notifications n SET locked_at=now(),locked_by=$2,attempts=attempts+1
      FROM candidates c WHERE n.id=c.id RETURNING n.*`,
      [limit, workerId],
    );
    claimed.push(...result.rows);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const outcomes = [];
  for (const notification of claimed) {
    const devices = (
      await postgresPool.query(
        "SELECT id,public_id,push_token_ciphertext FROM user_devices WHERE user_id=$1 AND revoked_at IS NULL AND push_token_ciphertext IS NOT NULL",
        [notification.user_id],
      )
    ).rows;
    const attempt = notification.attempts;
    if (notification.channel === "email") {
      try {
        const providerMessageId = await deliverEmail(notification);
        await postgresPool.query(
          `INSERT INTO notification_deliveries(notification_id,device_id,attempt,provider,provider_message_id,status) VALUES($1,NULL,$2,$3,$4,'delivered')`,
          [notification.id, attempt, config.emailProvider, providerMessageId],
        );
        await postgresPool.query(
          "UPDATE notifications SET status='delivered',sent_at=now(),provider_message_id=$2,last_error=NULL,locked_at=NULL,locked_by=NULL WHERE id=$1 AND locked_by=$3",
          [notification.id, providerMessageId, workerId],
        );
        outcomes.push({
          id: notification.public_id,
          status: "delivered",
          channel: "email",
        });
      } catch (error) {
        const retry = attempt < 3,
          code = String(error?.code || "email_delivery_failed").slice(0, 120);
        await postgresPool.query(
          `INSERT INTO notification_deliveries(notification_id,device_id,attempt,provider,status,error_code) VALUES($1,NULL,$2,$3,'failed',$4)`,
          [notification.id, attempt, config.emailProvider, code],
        );
        if (retry)
          await postgresPool.query(
            "UPDATE notifications SET status='queued',scheduled_at=now()+($2*interval '1 minute'),last_error=$3,locked_at=NULL,locked_by=NULL WHERE id=$1 AND locked_by=$4",
            [notification.id, Math.min(30, 2 ** attempt), code, workerId],
          );
        else
          await deadLetterNotification(notification, {
            workerId,
            reason: code,
          });
        outcomes.push({
          id: notification.public_id,
          status: retry ? "retry" : "dead_lettered",
          channel: "email",
        });
      }
      continue;
    }
    if (notification.channel !== "push") {
      await postgresPool.query(
        "UPDATE notifications SET status='sent',sent_at=now(),locked_at=NULL,locked_by=NULL WHERE id=$1 AND locked_by=$2",
        [notification.id, workerId],
      );
      outcomes.push({ id: notification.public_id, status: "sent" });
      continue;
    }
    if (!devices.length) {
      const retry = attempt < 3;
      if (retry)
        await postgresPool.query(
          "UPDATE notifications SET status='queued',scheduled_at=now()+($2*interval '1 minute'),last_error='no_active_device',locked_at=NULL,locked_by=NULL WHERE id=$1 AND locked_by=$3",
          [notification.id, Math.min(30, 2 ** attempt), workerId],
        );
      else
        await deadLetterNotification(notification, {
          workerId,
          reason: "no_active_device",
        });
      outcomes.push({
        id: notification.public_id,
        status: retry ? "retry" : "dead_lettered",
      });
      continue;
    }
    if (provider === "expo") {
      const outcome = await deliverViaExpo({ notification, devices, attempt, workerId });
      outcomes.push(outcome);
      continue;
    }
    if (provider !== "sandbox") {
      await deadLetterNotification(notification, {
        workerId,
        reason: "provider_unavailable",
      });
      outcomes.push({ id: notification.public_id, status: "dead_lettered" });
      continue;
    }
    const providerMessageId = `${provider}-${crypto.randomUUID()}`;
    let delivered = 0,
      invalidated = 0;
    for (const device of devices) {
      const token = decryptDeviceToken(device.push_token_ciphertext);
      if (token.startsWith("sandbox-invalid:")) {
        await postgresPool.query(
          `INSERT INTO notification_deliveries(notification_id,device_id,attempt,provider,status,error_code) VALUES($1,$2,$3,$4,'failed','unregistered')`,
          [notification.id, device.id, attempt, provider],
        );
        await postgresPool.query(
          "UPDATE user_devices SET revoked_at=COALESCE(revoked_at,now()),invalidated_at=now(),invalid_reason='unregistered' WHERE id=$1",
          [device.id],
        );
        invalidated++;
        continue;
      }
      await postgresPool.query(
        `INSERT INTO notification_deliveries(notification_id,device_id,attempt,provider,provider_message_id,status) VALUES($1,$2,$3,$4,$5,'delivered')`,
        [notification.id, device.id, attempt, provider, providerMessageId],
      );
      delivered++;
    }
    if (delivered) {
      await postgresPool.query(
        "UPDATE notifications SET status='delivered',sent_at=now(),provider_message_id=$2,last_error=NULL,locked_at=NULL,locked_by=NULL WHERE id=$1 AND locked_by=$3",
        [notification.id, providerMessageId, workerId],
      );
      outcomes.push({
        id: notification.public_id,
        status: "delivered",
        devices: delivered,
        invalidated,
      });
    } else {
      await deadLetterNotification(notification, {
        workerId,
        reason: invalidated ? "all_tokens_unregistered" : "delivery_failed",
      });
      outcomes.push({
        id: notification.public_id,
        status: "dead_lettered",
        invalidated,
      });
    }
  }
  return { claimed: claimed.length, outcomes };
}
