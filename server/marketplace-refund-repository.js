import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
import { markHeldTipRefunded } from "./tip-repository.js";
import { decryptPaymentOAuthToken } from "./secret-envelope.js";
import { refundMercadoPagoPayment } from "./payment-marketplace-provider.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";

const refundKey = (value) =>
  `refund-${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
const systemAccount = async (client, accountType) =>
  (
    await client.query(
      `INSERT INTO ledger_accounts(owner_type, owner_id, currency, account_type)
       VALUES('platform', NULL, 'ARS', $1)
       ON CONFLICT(owner_type, currency, account_type) WHERE owner_id IS NULL
       DO UPDATE SET owner_type=excluded.owner_type RETURNING id`,
      [accountType],
    )
  ).rows[0].id;

export async function cancelMarketplaceOrderAndRefund({
  orderPublicId,
  actorPublicId,
  reason,
  reasonDetail = null,
}) {
  const context = (
    await postgresPool.query(
      `SELECT j.id job_id, j.customer_id, j.status,
         p.id payment_id, p.provider_intent_id, p.captured_amount_cents, p.status payment_status,
         c.access_token_ciphertext, c.revoked_at, u.id actor_id
       FROM jobs j
       JOIN payment_intents p ON p.job_id=j.id AND p.provider='mercadopago'
       JOIN merchants m ON m.id=j.merchant_id
       LEFT JOIN merchant_payment_connections c ON c.merchant_id=m.id AND c.provider='mercadopago'
       LEFT JOIN users u ON u.public_id=$2
       WHERE j.public_id=$1 AND j.kind='delivery' AND j.metadata->>'subtype'='food_order'`,
      [orderPublicId, actorPublicId],
    )
  ).rows[0];
  if (!context) return null;
  if (context.status === "completed" || context.status === "cancelled")
    throw Object.assign(new Error("El pedido no puede cancelarse"), { status: 409 });
  if (context.payment_status !== "captured" || !context.provider_intent_id)
    throw Object.assign(new Error("El pago externo no está capturado"), { status: 409 });
  if (!context.access_token_ciphertext || context.revoked_at)
    throw Object.assign(new Error("La conexión de cobros del comercio no está disponible"), {
      status: 409,
    });
  const idempotencyKey = refundKey(orderPublicId),
    amountCents = Number(context.captured_amount_cents);
  let claimed = (
    await postgresPool.query(
      `INSERT INTO refunds(
        payment_intent_id, requested_by, amount_cents, reason, status, idempotency_key
      ) VALUES($1, $2, $3, $4, 'pending', $5)
       ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id`,
      [context.payment_id, context.actor_id || null, amountCents, reason, idempotencyKey],
    )
  ).rows[0];
  if (!claimed) {
    const existing = (
      await postgresPool.query(
        "SELECT id,status,provider_refund_id,amount_cents FROM refunds WHERE idempotency_key=$1",
        [idempotencyKey],
      )
    ).rows[0];
    if (existing?.status === "succeeded")
      return {
        id: existing.provider_refund_id,
        refunded: true,
        refundAmount: Number(existing.amount_cents) / 100,
        reason,
        idempotent: true,
      };
    claimed = existing;
    await postgresPool.query("UPDATE refunds SET status='pending',resolved_at=NULL WHERE id=$1", [
      claimed.id,
    ]);
  }
  const reserved = await postgresPool.query(
    `UPDATE jobs SET metadata=jsonb_set(metadata,'{refundPending}','true'::jsonb),version=version+1,updated_at=now() WHERE id=$1 AND status NOT IN('completed','cancelled') RETURNING id`,
    [context.job_id],
  );
  if (!reserved.rowCount)
    throw Object.assign(new Error("El pedido cambió de estado antes del reintegro"), {
      status: 409,
    });
  let providerRefund;
  try {
    providerRefund = await refundMercadoPagoPayment({
      accessToken: decryptPaymentOAuthToken(context.access_token_ciphertext),
      paymentId: context.provider_intent_id,
      idempotencyKey,
      amount: amountCents / 100,
    });
  } catch (error) {
    await Promise.all([
      postgresPool.query("UPDATE refunds SET status='failed',resolved_at=now() WHERE id=$1", [
        claimed.id,
      ]),
      postgresPool.query(
        "UPDATE jobs SET metadata=metadata-'refundPending',version=version+1,updated_at=now() WHERE id=$1 AND status NOT IN('completed','cancelled')",
        [context.job_id],
      ),
    ]);
    throw error;
  }
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const payment = (
      await client.query(
        "SELECT status,captured_amount_cents FROM payment_intents WHERE id=$1 FOR UPDATE",
        [context.payment_id],
      )
    ).rows[0];
    if (payment.status !== "captured")
      throw Object.assign(new Error("El estado del pago cambió durante el reintegro"), {
        status: 409,
      });
    const clearing = await systemAccount(client, "cash_clearing"),
      providerControl = await systemAccount(client, "mercadopago_control"),
      transaction = (
        await client.query(
          `INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description,metadata) VALUES($1,'refund',$2,$3,$4) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
          [
            `ledger-${idempotencyKey}`,
            context.actor_id || null,
            `Reintegro Mercado Pago ${orderPublicId}`,
            { orderPublicId, providerRefundId: providerRefund.id },
          ],
        )
      ).rows[0];
    if (transaction)
      await client.query(
        `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES($1,$2,'debit',$4,'refund',$3,$5),($1,$6,'credit',$4,'refund',$3,$5)`,
        [
          transaction.id,
          clearing,
          context.payment_id,
          amountCents,
          { orderPublicId, providerRefundId: providerRefund.id },
          providerControl,
        ],
      );
    await client.query(
      "UPDATE payment_intents SET status='refunded',captured_amount_cents=0,updated_at=now() WHERE id=$1",
      [context.payment_id],
    );
    // Ver `cancelOrderAndRefundWallet`: la propina vuelve con el reintegro y la
    // fila tiene que dejar de decir «retenida».
    await markHeldTipRefunded(client, context.job_id);
    await client.query(
      "UPDATE refunds SET status='succeeded',provider_refund_id=$2,resolved_at=now() WHERE id=$1",
      [claimed.id, providerRefund.id],
    );
    await client.query(
      "UPDATE jobs SET status='cancelled',cancellation_reason=$2,metadata=metadata-'refundPending',version=version+1,updated_at=now() WHERE id=$1",
      [context.job_id, reason],
    );
    await client.query(
      "INSERT INTO job_events(job_id,actor_id,status,payload) VALUES($1,$2,'cancelled',$3)",
      [context.job_id, context.actor_id || null, { reason, providerRefundId: providerRefund.id }],
    );
    await client.query(
      "UPDATE dispatch_offers SET status='withdrawn',responded_at=now() WHERE job_id=$1 AND status='pending'",
      [context.job_id],
    );
    const cancellation = (
      await client.query(
        `INSERT INTO job_cancellations(public_id,job_id,actor_id,reason_code,reason_detail,refund_amount_cents) VALUES($1,$2,$3,$4,$5,$6) RETURNING public_id`,
        [
          `CAN-${crypto.randomUUID()}`,
          context.job_id,
          context.actor_id || null,
          reason,
          reasonDetail,
          amountCents,
        ],
      )
    ).rows[0];
    await enqueueNotificationForInternalUser(client, {
      userId: context.customer_id,
      template: "order_status",
      payload: { kind: "food_order", jobId: orderPublicId, status: "cancelled", refunded: true },
      deduplicationKey: `food_order:${orderPublicId}:cancelled`,
    });
    await client.query("COMMIT");
    return {
      id: cancellation.public_id,
      providerRefundId: providerRefund.id,
      refunded: true,
      refundAmount: amountCents / 100,
      reason,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
