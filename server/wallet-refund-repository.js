// Reintegros a Flash Wallet al cancelar pedido o movilidad (ARC-001).
//
// Separados del cobro y del crédito sandbox: son el camino inverso del dinero
// cuando el trabajo no se completa, con tip held y notificaciones.
import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
import { markHeldTipRefunded } from "./tip-repository.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";
import { clearingAccount, userAccount } from "./wallet-ledger-accounts.js";

export async function cancelOrderAndRefundWallet({
  orderPublicId,
  actorPublicId,
  reason = "changed_mind",
  reasonDetail = null,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const actor = (await client.query("SELECT id FROM users WHERE public_id=$1", [actorPublicId]))
      .rows[0];
    const job = (
      await client.query(
        `UPDATE jobs SET status='cancelled', version=version+1, updated_at=now()
         WHERE public_id=$1 AND kind='delivery' AND metadata->>'subtype'='food_order'
           AND status NOT IN('completed','cancelled') RETURNING id,customer_id`,
        [orderPublicId],
      )
    ).rows[0];
    if (!job) throw Object.assign(new Error("El pedido no puede cancelarse"), { status: 409 });
    await client.query(
      "INSERT INTO job_events(job_id,actor_id,status,payload) VALUES($1,$2,'cancelled',$3)",
      [job.id, actor?.id || null, { reason }],
    );
    await client.query(
      "UPDATE dispatch_offers SET status='withdrawn',responded_at=now() WHERE job_id=$1 AND status='pending'",
      [job.id],
    );
    const payment = (
      await client.query(
        "SELECT * FROM payment_intents WHERE job_id=$1 AND provider='flash_wallet' AND status='captured' FOR UPDATE",
        [job.id],
      )
    ).rows[0];
    if (payment) {
      const wallet = (
        await client.query(
          "SELECT id FROM ledger_accounts WHERE owner_type='user' AND owner_id=$1 AND account_type='wallet' FOR UPDATE",
          [job.customer_id],
        )
      ).rows[0];
      const clearing = (
        await client.query(
          "SELECT id FROM ledger_accounts WHERE owner_type='platform' AND owner_id IS NULL AND account_type='cash_clearing' FOR UPDATE",
        )
      ).rows[0];
      const transaction = (
        await client.query(
          `INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description,metadata) VALUES($1,'refund',$2,$3,$4) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
          [
            `refund-${orderPublicId}`,
            actor?.id || null,
            `Reintegro pedido ${orderPublicId}`,
            { orderPublicId, reason },
          ],
        )
      ).rows[0];
      if (transaction) {
        await client.query(
          `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES
      ($1,$2,'credit',$4,'refund',$3,$5),($1,$6,'debit',$4,'refund',$3,$5)`,
          [
            transaction.id,
            wallet.id,
            payment.id,
            payment.captured_amount_cents,
            { orderPublicId, reason },
            clearing.id,
          ],
        );
        await client.query(
          `INSERT INTO refunds(payment_intent_id,requested_by,amount_cents,reason,status,resolved_at) VALUES($1,$2,$3,$4,'succeeded',now())`,
          [payment.id, actor?.id || null, payment.captured_amount_cents, reason],
        );
      }
      await client.query(
        "UPDATE payment_intents SET status='refunded',captured_amount_cents=0,updated_at=now() WHERE id=$1",
        [payment.id],
      );
      // La propina del checkout viajó dentro del cobro, así que ya volvió con el
      // reintegro. Falta que la fila deje de decir «retenida»: una propina
      // retenida sobre un pedido reintegrado es plata que el sistema cree deber
      // y ya devolvió, y es la clase de fila que aparece meses después en una
      // conciliación.
      await markHeldTipRefunded(client, job.id);
    }
    const refundAmount = Number(payment?.captured_amount_cents || 0);
    const cancellation = (
      await client.query(
        `INSERT INTO job_cancellations(public_id,job_id,actor_id,reason_code,reason_detail,refund_amount_cents) VALUES($1,$2,$3,$4,$5,$6) RETURNING public_id`,
        [
          `CAN-${crypto.randomUUID()}`,
          job.id,
          actor?.id || null,
          reason,
          reasonDetail,
          refundAmount,
        ],
      )
    ).rows[0];
    await enqueueNotificationForInternalUser(client, {
      userId: job.customer_id,
      template: "order_status",
      payload: {
        kind: "food_order",
        jobId: orderPublicId,
        status: "cancelled",
        refunded: Boolean(payment),
      },
      deduplicationKey: `food_order:${orderPublicId}:cancelled`,
    });
    await client.query("COMMIT");
    return {
      id: cancellation.public_id,
      refunded: Boolean(payment),
      refundAmount: refundAmount / 100,
      reason,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function cancelMobilityJobAndRefundWallet({
  publicId,
  kind,
  actorPublicId,
  reason = "changed_mind",
  reasonDetail = null,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const actor = (await client.query("SELECT id FROM users WHERE public_id=$1", [actorPublicId]))
      .rows[0];
    const job = (
      await client.query(
        `UPDATE jobs SET status='cancelled',version=version+1,updated_at=now()
    WHERE public_id=$1 AND kind=$2 AND status NOT IN('completed','cancelled') RETURNING id,customer_id`,
        [publicId, kind],
      )
    ).rows[0];
    if (!job) throw Object.assign(new Error("El servicio no puede cancelarse"), { status: 409 });
    await client.query(
      "INSERT INTO job_events(job_id,actor_id,status,payload) VALUES($1,$2,'cancelled',$3)",
      [job.id, actor?.id || null, { reason }],
    );
    await client.query(
      "UPDATE dispatch_offers SET status='withdrawn',responded_at=now() WHERE job_id=$1 AND status='pending'",
      [job.id],
    );
    const payment = (
      await client.query(
        "SELECT * FROM payment_intents WHERE job_id=$1 AND provider='flash_wallet' AND status='captured' FOR UPDATE",
        [job.id],
      )
    ).rows[0];
    if (payment) {
      const wallet = (
        await client.query(
          "SELECT id FROM ledger_accounts WHERE owner_type='user' AND owner_id=$1 AND account_type='wallet' FOR UPDATE",
          [job.customer_id],
        )
      ).rows[0];
      const clearing = (
        await client.query(
          "SELECT id FROM ledger_accounts WHERE owner_type='platform' AND owner_id IS NULL AND account_type='cash_clearing' FOR UPDATE",
        )
      ).rows[0];
      const transaction = (
        await client.query(
          `INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description,metadata) VALUES($1,'refund',$2,$3,$4) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
          [
            `refund-${publicId}`,
            actor?.id || null,
            `Reintegro servicio ${publicId}`,
            { publicId, kind, reason },
          ],
        )
      ).rows[0];
      if (transaction) {
        await client.query(
          `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES
      ($1,$2,'credit',$4,'refund',$3,$5),($1,$6,'debit',$4,'refund',$3,$5)`,
          [
            transaction.id,
            wallet.id,
            payment.id,
            payment.captured_amount_cents,
            { publicId, kind, reason },
            clearing.id,
          ],
        );
        await client.query(
          `INSERT INTO refunds(payment_intent_id,requested_by,amount_cents,reason,status,resolved_at) VALUES($1,$2,$3,$4,'succeeded',now())`,
          [payment.id, actor?.id || null, payment.captured_amount_cents, reason],
        );
      }
      await client.query(
        "UPDATE payment_intents SET status='refunded',captured_amount_cents=0,updated_at=now() WHERE id=$1",
        [payment.id],
      );
    }
    const refundAmount = Number(payment?.captured_amount_cents || 0);
    const cancellation = (
      await client.query(
        `INSERT INTO job_cancellations(public_id,job_id,actor_id,reason_code,reason_detail,refund_amount_cents) VALUES($1,$2,$3,$4,$5,$6) RETURNING public_id`,
        [
          `CAN-${crypto.randomUUID()}`,
          job.id,
          actor?.id || null,
          reason,
          reasonDetail,
          refundAmount,
        ],
      )
    ).rows[0];
    const subtype = kind === "ride" ? "ride" : "shipment";
    await enqueueNotificationForInternalUser(client, {
      userId: job.customer_id,
      template: `${subtype}_status`,
      payload: { kind: subtype, jobId: publicId, status: "cancelled", refunded: Boolean(payment) },
      deduplicationKey: `${subtype}:${publicId}:cancelled`,
    });
    await client.query("COMMIT");
    return {
      id: cancellation.public_id,
      refunded: Boolean(payment),
      refundAmount: refundAmount / 100,
      reason,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
