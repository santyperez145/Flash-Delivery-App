// Cobro marketplace Mercado Pago del pedido de comida (ARC-001).
//
// Separado de crear/avanzar el pedido: captura seller + application fee y
// decide accepted/cancelled. `getPostgresOrders` se carga diferido para no
// cerrar un ciclo con order-repository (create usa la misma clave de idempotencia).
import { postgresPool } from "./postgres.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";
import { recordMarketplaceCapture } from "./merchant-finance-repository.js";
import { decryptPaymentOAuthToken } from "./secret-envelope.js";
import {
  createMercadoPagoPayment,
  mercadoPagoFulfillmentDecision,
} from "./payment-marketplace-provider.js";
import { pesos } from "./money.js";
import crypto from "node:crypto";

export const marketplacePaymentKey = (value) =>
  `mp-${crypto.createHash("sha256").update(String(value)).digest("hex")}`;

async function loadOrders() {
  const { getPostgresOrders } = await import("./order-repository.js");
  return getPostgresOrders();
}

export async function processPostgresOrderMarketplacePayment({
  orderPublicId,
  customerPublicId,
  idempotencyKey,
  cardToken,
  paymentMethodId,
  installments,
}) {
  const context = (
    await postgresPool.query(
      `SELECT j.id job_id, j.public_id, j.status, j.quoted_amount_cents, j.customer_id,
        u.email, m.public_id merchant_public_id, p.id payment_intent_id,
        p.status payment_status, p.amount_cents, p.provider_payload,
        c.access_token_ciphertext, c.revoked_at, c.token_expires_at
       FROM jobs j
       JOIN users u ON u.id = j.customer_id
       JOIN merchants m ON m.id = j.merchant_id
       JOIN payment_intents p ON p.job_id = j.id AND p.provider = 'mercadopago'
       LEFT JOIN merchant_payment_connections c ON c.merchant_id = m.id
         AND c.provider = 'mercadopago'
       WHERE j.public_id = $1 AND u.public_id = $2`,
      [orderPublicId, customerPublicId],
    )
  ).rows[0];
  if (!context) throw Object.assign(new Error("Intento de pago no encontrado"), { status: 404 });
  if (context.payment_status === "captured")
    return (await loadOrders()).find((order) => order.id === orderPublicId);
  if (
    !context.access_token_ciphertext ||
    context.revoked_at ||
    (context.token_expires_at && new Date(context.token_expires_at) <= new Date())
  )
    throw Object.assign(new Error("El comercio todavía no puede cobrar con Mercado Pago"), {
      status: 409,
    });
  const payment = await createMercadoPagoPayment({
    accessToken: decryptPaymentOAuthToken(context.access_token_ciphertext),
    idempotencyKey: marketplacePaymentKey(idempotencyKey),
    cardToken,
    transactionAmount: pesos(context.amount_cents),
    applicationFee: pesos(context.provider_payload.applicationFeeCents),
    paymentMethodId,
    installments,
    payerEmail: context.email,
    externalReference: orderPublicId,
    description: `Pedido ${orderPublicId}`,
  });
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const locked = (
      await client.query("SELECT status FROM payment_intents WHERE id=$1 FOR UPDATE", [
        context.payment_intent_id,
      ])
    ).rows[0];
    if (locked.status === "captured") {
      await client.query("ROLLBACK");
      return (await loadOrders()).find((order) => order.id === orderPublicId);
    }
    const decision = mercadoPagoFulfillmentDecision(payment.status);
    await client.query(
      `UPDATE payment_intents SET provider_intent_id=$2,status=$3,captured_amount_cents=$4,failure_code=$5,provider_payload=provider_payload||$6::jsonb,updated_at=now() WHERE id=$1`,
      [
        context.payment_intent_id,
        payment.id,
        decision.intentStatus,
        decision.fulfill ? Number(context.amount_cents) : 0,
        decision.terminal && !decision.fulfill ? payment.statusDetail || payment.status : null,
        JSON.stringify({
          statusDetail: payment.statusDetail,
          applicationFee: payment.applicationFee,
          collectorId: payment.collectorId,
          dateApproved: payment.dateApproved,
        }),
      ],
    );
    if (decision.fulfill)
      await recordMarketplaceCapture(client, {
        paymentIntentId: context.payment_intent_id,
        jobId: context.job_id,
        jobPublicId: orderPublicId,
        providerPaymentId: payment.id,
        amountCents: Number(context.amount_cents),
        applicationFeeCents: Number(context.provider_payload.applicationFeeCents),
        collectorId: payment.collectorId,
      });
    if (decision.fulfill && context.status === "requested") {
      await client.query(
        // El vencimiento de cocina cuenta desde el horario reservado, no desde el
        // cobro: un pedido programado que se paga hoy no se cocina hoy.
        `UPDATE jobs SET status='accepted',
           merchant_ready_due_at=CASE WHEN merchant_prep_minutes IS NULL THEN NULL
             ELSE COALESCE(scheduled_for, now())+make_interval(mins=>merchant_prep_minutes::integer) END,
           updated_at=now() WHERE id=$1`,
        [context.job_id],
      );
      await client.query(
        "INSERT INTO job_events(job_id,actor_id,status,metadata) VALUES($1,$2,'accepted',$3)",
        [
          context.job_id,
          context.customer_id,
          { paymentProvider: "mercadopago", providerPaymentId: payment.id },
        ],
      );
      await enqueueNotificationForInternalUser(client, {
        userId: context.customer_id,
        template: "order_status",
        payload: { kind: "food_order", jobId: orderPublicId, status: "accepted" },
        deduplicationKey: `food_order:${orderPublicId}:accepted`,
      });
    } else if (decision.terminal && context.status === "requested") {
      await client.query(
        "UPDATE jobs SET status='cancelled',cancellation_reason='payment_failed',updated_at=now() WHERE id=$1",
        [context.job_id],
      );
      await client.query(
        "INSERT INTO job_events(job_id,actor_id,status,metadata) VALUES($1,$2,'cancelled',$3)",
        [
          context.job_id,
          context.customer_id,
          { reason: "payment_failed", providerStatus: payment.status },
        ],
      );
    }
    await client.query("COMMIT");
    return {
      ...(await loadOrders()).find((order) => order.id === orderPublicId),
      paymentStatus: decision.intentStatus,
      paymentStatusDetail: payment.statusDetail,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
