// Dual control de ajustes de propina (ARC-001).
//
// Separado del hold/release de checkout: es revisión humana sobre plata ya
// liberada, no el ciclo del pedido.
import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";

const adjustmentId = () => `TADJ-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
const adjustmentSelect = `
  SELECT a.*, t.public_id tip_public_id, t.amount_cents tip_amount_cents, j.public_id job_public_id,
    c.public_id customer_public_id, d.public_id driver_public_id,
    requester.public_id requested_by_public_id, reviewer.public_id reviewed_by_public_id
  FROM service_tip_adjustments a
  JOIN service_tips t ON t.id = a.tip_id
  JOIN jobs j ON j.id = t.job_id
  JOIN users c ON c.id = t.customer_id
  JOIN drivers d ON d.id = t.driver_id
  JOIN users requester ON requester.id = a.requested_by
  LEFT JOIN users reviewer ON reviewer.id = a.reviewed_by
`;
const mapAdjustment = (row) => ({
  id: row.public_id,
  tipId: row.tip_public_id,
  jobId: row.job_public_id,
  customerId: row.customer_public_id,
  driverId: row.driver_public_id,
  tipAmount: Number(row.tip_amount_cents) / 100,
  amount: Number(row.amount_cents) / 100,
  reason: row.reason,
  status: row.status,
  requestedBy: row.requested_by_public_id,
  requestedAt: new Date(row.requested_at).toISOString(),
  reviewedBy: row.reviewed_by_public_id || null,
  reviewNote: row.review_note || null,
  reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
});

export async function getTipAdjustments() {
  return (
    await postgresPool.query(
      `${adjustmentSelect} ORDER BY CASE a.status WHEN 'pending' THEN 1 ELSE 2 END,a.requested_at DESC LIMIT 200`,
    )
  ).rows.map(mapAdjustment);
}

export async function requestTipAdjustment({
  tipPublicId,
  actorPublicId,
  amount,
  reason,
  idempotencyKey,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const existing = (
      await client.query(`${adjustmentSelect} WHERE a.idempotency_key=$1`, [idempotencyKey])
    ).rows[0];
    if (existing) {
      await client.query("ROLLBACK");
      return mapAdjustment(existing);
    }
    const tip = (
      await client.query("SELECT id,amount_cents FROM service_tips WHERE public_id=$1 FOR UPDATE", [
        tipPublicId,
      ])
    ).rows[0];
    if (!tip) throw Object.assign(new Error("Propina no encontrada"), { status: 404 });
    const amountCents = Math.round(amount * 100),
      alreadyRequested = Number(
        (
          await client.query(
            "SELECT COALESCE(sum(amount_cents),0)::bigint cents FROM service_tip_adjustments WHERE tip_id=$1 AND status IN('pending','approved')",
            [tip.id],
          )
        ).rows[0].cents,
      );
    if (alreadyRequested + amountCents > Number(tip.amount_cents))
      throw Object.assign(new Error("El ajuste supera el saldo corregible de la propina"), {
        status: 409,
      });
    const row = (
      await client.query(
        `INSERT INTO service_tip_adjustments(public_id,tip_id,amount_cents,reason,requested_by,idempotency_key) SELECT $1,$2,$3,$4,u.id,$5 FROM users u WHERE u.public_id=$6 RETURNING *`,
        [adjustmentId(), tip.id, amountCents, reason, idempotencyKey, actorPublicId],
      )
    ).rows[0];
    if (!row)
      throw Object.assign(new Error("Solicitante no encontrado"), {
        status: 404,
      });
    await client.query("COMMIT");
    return mapAdjustment(
      (await postgresPool.query(`${adjustmentSelect} WHERE a.id=$1`, [row.id])).rows[0],
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function reviewTipAdjustment({ adjustmentPublicId, actorPublicId, decision, note }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const adjustment = (
      await client.query(`${adjustmentSelect} WHERE a.public_id=$1 FOR UPDATE OF a`, [
        adjustmentPublicId,
      ])
    ).rows[0];
    if (!adjustment) throw Object.assign(new Error("Ajuste no encontrado"), { status: 404 });
    if (adjustment.requested_by_public_id === actorPublicId)
      throw Object.assign(new Error("Quien solicita no puede revisar su propio ajuste"), {
        status: 409,
      });
    if (adjustment.status !== "pending") {
      if ((adjustment.status === "approved") === (decision === "approved")) {
        await client.query("ROLLBACK");
        return mapAdjustment(adjustment);
      }
      throw Object.assign(new Error("El ajuste ya fue revisado"), {
        status: 409,
      });
    }
    const reviewer = (
      await client.query("SELECT id FROM users WHERE public_id=$1", [actorPublicId])
    ).rows[0];
    if (!reviewer) throw Object.assign(new Error("Revisor no encontrado"), { status: 404 });
    if (decision === "rejected")
      await client.query(
        "UPDATE service_tip_adjustments SET status='rejected',reviewed_by=$2,review_note=$3,reviewed_at=now() WHERE id=$1",
        [adjustment.id, reviewer.id, note],
      );
    else {
      const participants = (
        await client.query(
          "SELECT t.customer_id,d.user_id driver_user_id FROM service_tips t JOIN drivers d ON d.id=t.driver_id WHERE t.id=$1",
          [adjustment.tip_id],
        )
      ).rows[0];
      const accounts = await client.query(
        `INSERT INTO ledger_accounts(owner_type, owner_id, currency, account_type)
         VALUES ('user', $1, 'ARS', 'wallet'), ('user', $2, 'ARS', 'wallet')
         ON CONFLICT (owner_type, owner_id, currency, account_type)
         DO UPDATE SET owner_type = excluded.owner_type
         RETURNING id, owner_id`,
        [participants.customer_id, participants.driver_user_id],
      );
      const customerAccount = accounts.rows.find(
          (row) => String(row.owner_id) === String(participants.customer_id),
        ),
        driverAccount = accounts.rows.find(
          (row) => String(row.owner_id) === String(participants.driver_user_id),
        );
      await client.query("SELECT id FROM ledger_accounts WHERE id=ANY($1) ORDER BY id FOR UPDATE", [
        [customerAccount.id, driverAccount.id],
      ]);
      const transaction = (
        await client.query(
          "INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description,metadata) VALUES($1,'tip_adjustment',$2,$3,$4) RETURNING id",
          [
            `tip-adjustment-${adjustment.public_id}`,
            reviewer.id,
            `Ajuste de propina ${adjustment.tip_public_id}`,
            {
              tipId: adjustment.tip_public_id,
              adjustmentId: adjustment.public_id,
            },
          ],
        )
      ).rows[0];
      await client.query(
        `INSERT INTO ledger_entries(
           transaction_id, account_id, direction, amount_cents, reference_type, reference_id, metadata
         ) VALUES
           ($1, $2, 'debit', $4, 'tip_adjustment', $3, $5),
           ($1, $6, 'credit', $4, 'tip_adjustment', $3, $5)`,
        [
          transaction.id,
          driverAccount.id,
          adjustment.id,
          adjustment.amount_cents,
          {
            tipId: adjustment.tip_public_id,
            adjustmentId: adjustment.public_id,
          },
          customerAccount.id,
        ],
      );
      await client.query(
        "UPDATE service_tip_adjustments SET status='approved',reviewed_by=$2,review_note=$3,reviewed_at=now(),ledger_transaction_id=$4 WHERE id=$1",
        [adjustment.id, reviewer.id, note, transaction.id],
      );
      await enqueueNotificationForInternalUser(client, {
        userId: participants.customer_id,
        template: "tip_adjusted",
        payload: {
          kind: "tip_adjustment",
          jobId: adjustment.job_public_id,
          amount: Number(adjustment.amount_cents) / 100,
        },
        deduplicationKey: `tip-adjustment:${adjustment.public_id}:customer`,
      });
      await enqueueNotificationForInternalUser(client, {
        userId: participants.driver_user_id,
        template: "tip_adjusted",
        payload: {
          kind: "tip_adjustment",
          jobId: adjustment.job_public_id,
          amount: Number(adjustment.amount_cents) / 100,
        },
        deduplicationKey: `tip-adjustment:${adjustment.public_id}:driver`,
      });
    }
    await client.query("COMMIT");
    return mapAdjustment(
      (await postgresPool.query(`${adjustmentSelect} WHERE a.public_id=$1`, [adjustmentPublicId]))
        .rows[0],
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
