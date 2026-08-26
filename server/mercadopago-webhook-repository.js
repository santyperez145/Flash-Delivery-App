import { postgresPool } from "./postgres.js";
import { decryptPaymentOAuthToken } from "./secret-envelope.js";
import { fetchMercadoPagoResource } from "./payment-marketplace-provider.js";
import { mercadoPagoFulfillmentDecision } from "./payment-marketplace-provider.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";
import { recordMarketplaceCapture } from "./merchant-finance-repository.js";
export async function enqueueMercadoPagoWebhook({
  notificationId,
  resourceId,
  requestId,
  topic,
  action,
  liveMode,
  occurredAt,
  payload,
}) {
  const row = (
    await postgresPool.query(
      `INSERT INTO mercadopago_webhook_inbox(notification_id,resource_id,request_id,topic,action,live_mode,occurred_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(notification_id) DO UPDATE SET request_id=mercadopago_webhook_inbox.request_id RETURNING id,status,(xmax=0) inserted`,
      [
        notificationId,
        resourceId,
        requestId,
        topic,
        action || null,
        Boolean(liveMode),
        occurredAt || null,
        payload,
      ],
    )
  ).rows[0];
  return { id: String(row.id), status: row.status, duplicate: !row.inserted };
}

async function reconcilePaymentSnapshot(snapshot, connection) {
  if (!snapshot.externalReference) throw new Error("payment_external_reference_missing");
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const row = (
      await client.query(
        `SELECT p.*,j.id job_id,j.public_id job_public_id,j.status job_status,j.customer_id,j.merchant_id FROM payment_intents p JOIN jobs j ON j.id=p.job_id WHERE p.provider='mercadopago' AND j.public_id=$1 AND j.merchant_id=$2 FOR UPDATE OF p,j`,
        [snapshot.externalReference, connection.merchant_id],
      )
    ).rows[0];
    if (!row) throw new Error("payment_intent_missing");
    if (row.provider_intent_id && row.provider_intent_id !== snapshot.id)
      throw new Error("payment_provider_id_mismatch");
    if (
      Math.round(Number(snapshot.transactionAmount) * 100) !== Number(row.amount_cents) ||
      snapshot.currency !== row.currency
    )
      throw new Error("payment_amount_currency_mismatch");
    if (String(snapshot.collectorId || "") !== String(connection.external_account_id))
      throw new Error("payment_collector_mismatch");
    if (
      Math.round(Number(snapshot.applicationFee) * 100) !==
      Number(row.provider_payload?.applicationFeeCents)
    )
      throw new Error("payment_application_fee_mismatch");
    if (row.status === "captured") {
      await recordMarketplaceCapture(client, {
        paymentIntentId: row.id,
        jobId: row.job_id,
        jobPublicId: row.job_public_id,
        providerPaymentId: snapshot.id,
        amountCents: Number(row.amount_cents),
        applicationFeeCents: Number(row.provider_payload.applicationFeeCents),
        collectorId: snapshot.collectorId,
      });
      await client.query("COMMIT");
      return;
    }
    const decision = mercadoPagoFulfillmentDecision(snapshot.status);
    await client.query(
      `UPDATE payment_intents SET provider_intent_id=$2,status=$3,captured_amount_cents=$4,failure_code=$5,provider_payload=provider_payload||$6::jsonb,updated_at=now() WHERE id=$1`,
      [
        row.id,
        snapshot.id,
        decision.intentStatus,
        decision.fulfill ? Number(row.amount_cents) : 0,
        decision.terminal && !decision.fulfill ? snapshot.statusDetail || snapshot.status : null,
        JSON.stringify({
          statusDetail: snapshot.statusDetail,
          applicationFee: snapshot.applicationFee,
          collectorId: snapshot.collectorId,
          dateApproved: snapshot.dateApproved,
          reconciledBy: "webhook",
        }),
      ],
    );
    if (decision.fulfill)
      await recordMarketplaceCapture(client, {
        paymentIntentId: row.id,
        jobId: row.job_id,
        jobPublicId: row.job_public_id,
        providerPaymentId: snapshot.id,
        amountCents: Number(row.amount_cents),
        applicationFeeCents: Number(row.provider_payload.applicationFeeCents),
        collectorId: snapshot.collectorId,
      });
    if (decision.fulfill && row.job_status === "requested") {
      await client.query(
        "UPDATE jobs SET status='accepted',merchant_ready_due_at=CASE WHEN merchant_prep_minutes IS NULL THEN NULL ELSE now()+make_interval(mins=>merchant_prep_minutes::integer) END,updated_at=now() WHERE id=$1",
        [row.job_id],
      );
      await client.query(
        "INSERT INTO job_events(job_id,actor_id,status,metadata) VALUES($1,$2,'accepted',$3)",
        [
          row.job_id,
          row.customer_id,
          {
            paymentProvider: "mercadopago",
            providerPaymentId: snapshot.id,
            reconciledBy: "webhook",
          },
        ],
      );
      await enqueueNotificationForInternalUser(client, {
        userId: row.customer_id,
        template: "order_status",
        payload: { kind: "food_order", jobId: row.job_public_id, status: "accepted" },
        deduplicationKey: `food_order:${row.job_public_id}:accepted`,
      });
    } else if (decision.terminal && row.job_status === "requested") {
      await client.query(
        "UPDATE jobs SET status='cancelled',cancellation_reason='payment_failed',updated_at=now() WHERE id=$1",
        [row.job_id],
      );
      await client.query(
        "INSERT INTO job_events(job_id,actor_id,status,metadata) VALUES($1,$2,'cancelled',$3)",
        [
          row.job_id,
          row.customer_id,
          { reason: "payment_failed", providerStatus: snapshot.status, reconciledBy: "webhook" },
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function processMercadoPagoWebhookBatch({ limit = 20 } = {}) {
  const claimed = (
    await postgresPool.query(
      `WITH candidates AS (SELECT id FROM mercadopago_webhook_inbox WHERE (status='queued' OR (status='failed' AND attempts<5) OR (status='processing' AND attempts<5 AND processing_started_at<now()-interval '10 minutes')) ORDER BY received_at FOR UPDATE SKIP LOCKED LIMIT $1) UPDATE mercadopago_webhook_inbox i SET status='processing',attempts=attempts+1,processing_started_at=now(),last_error=NULL FROM candidates WHERE i.id=candidates.id RETURNING i.*`,
      [limit],
    )
  ).rows;
  let processed = 0,
    failed = 0,
    deadLetter = 0;
  for (const event of claimed) {
    try {
      const externalId = event.payload?.userId;
      if (!externalId) throw new Error("seller_external_id_missing");
      const connection = (
        await postgresPool.query(
          "SELECT * FROM merchant_payment_connections WHERE provider='mercadopago' AND external_account_id=$1",
          [externalId],
        )
      ).rows[0];
      if (!connection) throw new Error("seller_connection_missing");
      if (event.topic === "mp-connect") {
        if (event.action === "application.deauthorized")
          await postgresPool.query(
            "UPDATE merchant_payment_connections SET access_token_ciphertext=NULL,refresh_token_ciphertext=NULL,revoked_at=COALESCE(revoked_at,now()),updated_at=now() WHERE id=$1",
            [connection.id],
          );
        await postgresPool.query(
          "UPDATE mercadopago_webhook_inbox SET status='processed',processed_at=now(),processing_started_at=NULL WHERE id=$1",
          [event.id],
        );
        processed += 1;
        continue;
      }
      if (!connection.access_token_ciphertext || connection.revoked_at)
        throw new Error("seller_connection_inactive");
      const snapshot = await fetchMercadoPagoResource({
        topic: event.topic,
        resourceId: event.resource_id,
        accessToken: decryptPaymentOAuthToken(connection.access_token_ciphertext),
      });
      if (event.topic === "payment") await reconcilePaymentSnapshot(snapshot, connection);
      await postgresPool.query(
        "UPDATE mercadopago_webhook_inbox SET status='processed',resource_snapshot=$2,processed_at=now(),processing_started_at=NULL WHERE id=$1",
        [event.id, snapshot],
      );
      processed += 1;
    } catch (error) {
      const dead = Number(event.attempts) >= 5;
      await postgresPool.query(
        "UPDATE mercadopago_webhook_inbox SET status=$2,last_error=$3,processing_started_at=NULL WHERE id=$1",
        [
          event.id,
          dead ? "dead_letter" : "failed",
          String(error.message || "processing_failed").slice(0, 300),
        ],
      );
      if (dead) deadLetter += 1;
      else failed += 1;
    }
  }
  return { claimed: claimed.length, processed, failed, deadLetter };
}
