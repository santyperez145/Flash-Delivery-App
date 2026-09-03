// Dead letters de notificaciones: escritura worker + cola ops (ARC-001).
//
// Separado del worker de push/email/recibos: el dual control de reintento no
// debe crecer el mismo archivo que Expo/SMTP.
import { postgresPool } from "./postgres.js";

export async function deadLetterNotification(notification, { workerId, reason }) {
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
