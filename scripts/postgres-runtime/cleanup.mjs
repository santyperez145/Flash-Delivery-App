import { closePostgres } from "../../server/postgres.js";

/** @param {import("./context.mjs").PostgresRuntimeContext} ctx */
export async function runCleanup(ctx) {
  const { request, pool } = ctx;
  const runtimeJobIds = [
    ctx.orderId,
    ctx.settlementOrderId,
    ctx.rideId,
    ctx.scheduledRideId,
    ctx.shipmentId,
    ctx.proofShipmentId,
  ].filter(Boolean);
  if (runtimeJobIds.length)
    await pool.query("DELETE FROM notifications WHERE payload->>'jobId'=ANY($1)", [runtimeJobIds]);
  if (runtimeJobIds.length)
    await pool.query(
      "DELETE FROM job_cancellations WHERE job_id IN(SELECT id FROM jobs WHERE public_id=ANY($1))",
      [runtimeJobIds],
    );
  if (ctx.orderId) {
    await pool.query("DELETE FROM audit_events WHERE entity_id=$1", [ctx.orderId]);
    await pool.query(
      "DELETE FROM promotion_redemptions WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1)",
      [ctx.orderId],
    );
    await pool.query(
      "DELETE FROM refunds WHERE payment_intent_id=(SELECT p.id FROM payment_intents p JOIN jobs j ON j.id=p.job_id WHERE j.public_id=$1)",
      [ctx.orderId],
    );
    await pool.query(
      "DELETE FROM payment_intents WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1)",
      [ctx.orderId],
    );
    await pool.query(
      "DELETE FROM ledger_entries WHERE transaction_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)",
      [`refund-${ctx.orderId}`],
    );
    await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key=$1", [
      `refund-${ctx.orderId}`,
    ]);
    await pool.query(
      "DELETE FROM ledger_entries WHERE transaction_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)",
      [`payment-${ctx.idempotencyKey}`],
    );
    await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key=$1", [
      `payment-${ctx.idempotencyKey}`,
    ]);
    await pool.query("DELETE FROM jobs WHERE public_id = $1", [ctx.orderId]);
  }
  if (ctx.idempotencyKey)
    await pool.query("DELETE FROM idempotency_keys WHERE key = $1", [ctx.idempotencyKey]);
  if (ctx.scheduledRideId) {
    await pool.query("DELETE FROM audit_events WHERE entity_id=$1", [ctx.scheduledRideId]);
    await pool.query("DELETE FROM notifications WHERE payload->>'jobId'=$1", [ctx.scheduledRideId]);
    await pool.query("DELETE FROM jobs WHERE public_id=$1", [ctx.scheduledRideId]);
  }
  if (ctx.scheduledRideKey)
    await pool.query("DELETE FROM idempotency_keys WHERE key=$1", [ctx.scheduledRideKey]);
  if (ctx.insufficientTipJobId)
    await pool.query("DELETE FROM jobs WHERE public_id=$1", [ctx.insufficientTipJobId]);
  if (ctx.proofShipmentId) {
    await pool.query("DELETE FROM audit_events WHERE entity_id=$1", [ctx.proofShipmentId]);
    await pool.query("DELETE FROM realtime_events WHERE entity_id=$1", [ctx.proofShipmentId]);
    await pool.query(
      "DELETE FROM service_receipts WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1)",
      [ctx.proofShipmentId],
    );
    if (ctx.tipKey) {
      await pool.query("DELETE FROM service_tips WHERE idempotency_key=$1", [ctx.tipKey]);
      await pool.query(
        "DELETE FROM ledger_entries WHERE transaction_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)",
        [`tip-${ctx.tipKey}`],
      );
      await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key=$1", [
        `tip-${ctx.tipKey}`,
      ]);
    }
    for (const transactionKey of [
      `driver-earning-envio-${ctx.proofShipmentId}`,
      `payment-${ctx.proofShipmentKey}`,
    ]) {
      await pool.query(
        "DELETE FROM ledger_entries WHERE transaction_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)",
        [transactionKey],
      );
      await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key=$1", [
        transactionKey,
      ]);
    }
    await pool.query(
      "DELETE FROM payment_intents WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1)",
      [ctx.proofShipmentId],
    );
    await pool.query("DELETE FROM jobs WHERE public_id=$1", [ctx.proofShipmentId]);
  }
  if (ctx.proofShipmentKey)
    await pool.query("DELETE FROM idempotency_keys WHERE key=$1", [ctx.proofShipmentKey]);
  if (ctx.merchantPayoutKey) {
    await pool.query(
      "DELETE FROM ledger_entries WHERE transaction_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)",
      [`payout-reserve-${ctx.merchantPayoutKey}`],
    );
    await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key=$1", [
      `payout-reserve-${ctx.merchantPayoutKey}`,
    ]);
    await pool.query("DELETE FROM payouts WHERE idempotency_key=$1", [ctx.merchantPayoutKey]);
  }
  if (ctx.settlementOrderId) {
    await pool.query(
      "DELETE FROM audit_events WHERE entity_id=$1 OR(entity_type='order_issue' AND entity_id=$2) OR(entity_type='order_substitution' AND entity_id=$3)",
      [ctx.settlementOrderId, ctx.orderIssueId, ctx.substitutionId],
    );
    if (ctx.orderIssueId) {
      await pool.query("DELETE FROM refunds WHERE provider_refund_id=$1", [ctx.orderIssueId]);
      await pool.query("DELETE FROM order_issues WHERE public_id=$1", [ctx.orderIssueId]);
      for (const transactionKey of [
        `issue-refund-${ctx.orderIssueId}`,
        `issue-reversal-${ctx.orderIssueId}`,
      ]) {
        await pool.query(
          "DELETE FROM ledger_entries WHERE transaction_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)",
          [transactionKey],
        );
        await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key=$1", [
          transactionKey,
        ]);
      }
    }
    const cleanupSubstitutions = (
      await pool.query(
        "SELECT s.public_id FROM order_item_substitutions s JOIN jobs j ON j.id=s.job_id WHERE j.public_id=$1",
        [ctx.settlementOrderId],
      )
    ).rows.map((row) => row.public_id);
    for (const cleanupSubstitutionId of cleanupSubstitutions) {
      await pool.query("DELETE FROM refunds WHERE provider_refund_id=$1", [cleanupSubstitutionId]);
      await pool.query(
        "DELETE FROM ledger_entries WHERE transaction_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)",
        [`substitution-refund-${cleanupSubstitutionId}`],
      );
      await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key=$1", [
        `substitution-refund-${cleanupSubstitutionId}`,
      ]);
    }
    await pool.query(
      "DELETE FROM order_item_substitutions WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1)",
      [ctx.settlementOrderId],
    );
    await pool.query(
      "DELETE FROM payment_intents WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1)",
      [ctx.settlementOrderId],
    );
    // Antes que los asientos y que el pedido: `service_tips` referencia a los dos
    // sin cascada, asi que borrarlos primero fallaria por clave foranea y el
    // pedido del smoke quedaria para la corrida siguiente.
    await pool.query(
      "DELETE FROM service_tips WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1)",
      [ctx.settlementOrderId],
    );
    for (const transactionKey of [
      `settlement-${ctx.settlementOrderId}`,
      `payment-${ctx.settlementOrderKey}`,
    ]) {
      await pool.query(
        "DELETE FROM ledger_entries WHERE transaction_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)",
        [transactionKey],
      );
      await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key=$1", [
        transactionKey,
      ]);
    }
    await pool.query("DELETE FROM jobs WHERE public_id=$1", [ctx.settlementOrderId]);
    // El plan del smoke y la suscripcion que abrio. En este orden: `plan_id` es
    // ON DELETE RESTRICT, asi que borrar el plan primero fallaria y dejaria a
    // `usr_customer` suscripto en la corrida siguiente.
    await pool.query(
      "DELETE FROM user_subscriptions WHERE plan_id IN(SELECT id FROM subscription_plans WHERE key='smoke_plan')",
    );
    await pool.query("DELETE FROM subscription_plans WHERE key='smoke_plan'");
    // El grupo del smoke. Participantes e items caen por cascada; el grupo no,
    // porque nada lo referencia y borrarlo explicitamente deja claro que la
    // corrida no ensucia el padron.
    //
    // Los eventos de auditoria van primero y son la parte que importa:
    // `audit_events.actor_id` referencia a `users` sin cascada, asi que un
    // evento de grupo a nombre del usuario registrado bloquea su borrado mas
    // abajo. Lo encontro CI con un error de clave foranea, no una asercion.
    if (ctx.grupoPublicId) {
      await pool.query("DELETE FROM audit_events WHERE entity_id=$1", [ctx.grupoPublicId]);
      await pool.query("DELETE FROM group_orders WHERE public_id=$1", [ctx.grupoPublicId]);
    }
    // Red de seguridad: si el bloque de suspension corta antes de restituir, el
    // comercio queda suspendido y la corrida siguiente no puede cotizar nada.
    // Restituirlo dos veces no cuesta nada; no restituirlo cuesta la corrida.
    await pool.query("UPDATE merchants SET status='active' WHERE public_id='rest_roja'");
    await pool.query("UPDATE catalog_items SET available=true WHERE public_id='item_burger_brava'");
    await pool.query(
      "UPDATE catalog_branch_inventory SET available=true,stock_quantity=NULL WHERE catalog_item_id=(SELECT id FROM catalog_items WHERE public_id='item_burger_brava')",
    );
    await pool.query(
      "UPDATE merchant_branches SET open=true,status='active',eta_min=22 WHERE public_id='branch_rest_roja'",
    );
  }
  if (ctx.settlementOrderKey)
    await pool.query("DELETE FROM idempotency_keys WHERE key=$1", [ctx.settlementOrderKey]);
  if (ctx.walletKey) {
    await pool.query(
      "DELETE FROM ledger_entries WHERE transaction_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)",
      [ctx.walletKey],
    );
    await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key=$1", [ctx.walletKey]);
  }
  for (const [jobId, key] of [
    [ctx.rideId, ctx.rideKey],
    [ctx.shipmentId, ctx.shipmentKey],
  ]) {
    if (jobId) {
      await pool.query("DELETE FROM audit_events WHERE entity_id=$1", [jobId]);
      await pool.query(
        "DELETE FROM refunds WHERE payment_intent_id=(SELECT p.id FROM payment_intents p JOIN jobs j ON j.id=p.job_id WHERE j.public_id=$1)",
        [jobId],
      );
      await pool.query(
        "DELETE FROM payment_intents WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1)",
        [jobId],
      );
      for (const transactionKey of [`refund-${jobId}`, `payment-${key}`]) {
        await pool.query(
          "DELETE FROM ledger_entries WHERE transaction_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)",
          [transactionKey],
        );
        await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key=$1", [
          transactionKey,
        ]);
      }
      await pool.query("DELETE FROM jobs WHERE public_id=$1", [jobId]);
    }
    if (key) await pool.query("DELETE FROM idempotency_keys WHERE key=$1", [key]);
  }
  if (ctx.webhookIds.length)
    await pool.query(
      "DELETE FROM webhook_events WHERE provider='sandbox' AND provider_event_id=ANY($1)",
      [ctx.webhookIds],
    );
  if (ctx.realtimeFixtureIds.length)
    await pool.query("DELETE FROM realtime_events WHERE public_id=ANY($1)", [
      ctx.realtimeFixtureIds,
    ]);
  if (ctx.ratingId) {
    await pool.query("DELETE FROM audit_events WHERE entity_type='rating' AND entity_id=$1", [
      ctx.ratingId,
    ]);
    await pool.query("DELETE FROM ratings WHERE public_id=$1", [ctx.ratingId]);
  }
  if (ctx.feedbackAuditRequestIds.filter(Boolean).length) {
    await pool.query("DELETE FROM audit_events WHERE request_id=ANY($1)", [
      ctx.feedbackAuditRequestIds.filter(Boolean),
    ]);
    await pool.query("DELETE FROM realtime_events WHERE request_id=ANY($1)", [
      ctx.feedbackAuditRequestIds.filter(Boolean),
    ]);
  }
  if (ctx.deviceAuditRequestId)
    await pool.query("DELETE FROM audit_events WHERE request_id=$1", [ctx.deviceAuditRequestId]);
  if (ctx.deviceId) await pool.query("DELETE FROM user_devices WHERE public_id=$1", [ctx.deviceId]);
  if (ctx.rideDestinationId)
    await pool.query("DELETE FROM ride_destination_history WHERE id=$1", [ctx.rideDestinationId]);
  if (ctx.trustedContactId)
    await pool.query("DELETE FROM ride_trusted_contacts WHERE id=$1", [ctx.trustedContactId]);
  if (ctx.supportTicketId) {
    await pool.query(
      "DELETE FROM audit_events WHERE entity_type='support_ticket' AND entity_id=$1",
      [ctx.supportTicketId],
    );
    await pool.query("DELETE FROM notifications WHERE payload->>'ticketId'=$1", [
      ctx.supportTicketId,
    ]);
    await pool.query("DELETE FROM support_tickets WHERE public_id=$1", [ctx.supportTicketId]);
  }
  if (ctx.createdPromotionId) {
    await pool.query("DELETE FROM audit_events WHERE entity_type='promotion' AND entity_id=$1", [
      ctx.createdPromotionId,
    ]);
    await pool.query("DELETE FROM promotions WHERE public_id=$1", [ctx.createdPromotionId]);
  }
  if (ctx.originalZoneMultiplier !== null) {
    await pool.query("UPDATE service_zones SET delivery_multiplier=$2 WHERE public_id=$1", [
      "zone_centro",
      ctx.originalZoneMultiplier,
    ]);
    await pool.query(
      "DELETE FROM audit_events WHERE entity_type='service_zone' AND entity_id='zone_centro'",
    );
  }
  if (ctx.dispatchDriverOriginalOnline !== null)
    await pool.query("UPDATE drivers SET online=$2 WHERE public_id=$1", [
      "drv_nico",
      ctx.dispatchDriverOriginalOnline,
    ]);
  if (ctx.registeredRideId) {
    await pool.query("DELETE FROM audit_events WHERE entity_id=$1", [ctx.registeredRideId]);
    await pool.query("DELETE FROM notifications WHERE payload->>'jobId'=$1", [
      ctx.registeredRideId,
    ]);
    await pool.query("DELETE FROM jobs WHERE public_id=$1", [ctx.registeredRideId]);
  }
  if (ctx.registeredRideKey)
    await pool.query("DELETE FROM idempotency_keys WHERE key=$1", [ctx.registeredRideKey]);
  if (ctx.unvalidatedAddressId)
    await pool.query("DELETE FROM addresses WHERE id=$1", [ctx.unvalidatedAddressId]);
  if (ctx.moderationDriverId)
    await pool.query("DELETE FROM drivers WHERE public_id=$1", [ctx.moderationDriverId]);
  const riskKeys = [
    ctx.idempotencyKey,
    ctx.rideKey,
    ctx.scheduledRideKey,
    ctx.shipmentKey,
    ctx.proofShipmentKey,
    ctx.settlementOrderKey,
    ctx.registeredRideKey,
  ].filter(Boolean);
  if (riskKeys.length)
    await pool.query("DELETE FROM transaction_risk_assessments WHERE idempotency_key=ANY($1)", [
      riskKeys,
    ]);
  if (ctx.registeredUserId) {
    await pool.query("DELETE FROM audit_events WHERE entity_type='user' AND entity_id=$1", [
      ctx.registeredUserId,
    ]);
    await pool.query(
      "DELETE FROM transaction_risk_assessments WHERE customer_id=(SELECT id FROM users WHERE public_id=$1)",
      [ctx.registeredUserId],
    );
    // Barrido por actor antes de borrar la persona. La limpieza puntual de cada
    // entidad de arriba cubre lo que esta corrida creo, pero vive dentro de sus
    // propios `if`: si el smoke corta antes, esos bloques no corren y el borrado
    // del usuario falla por clave foranea con un mensaje que no dice cual evento
    // sobro. Esto cierra esa clase entera en vez de la instancia de hoy.
    await pool.query(
      "DELETE FROM audit_events WHERE actor_id=(SELECT id FROM users WHERE public_id=$1)",
      [ctx.registeredUserId],
    );
    await pool.query("DELETE FROM users WHERE public_id=$1", [ctx.registeredUserId]);
  }
  ctx.token = ctx.customerToken || ctx.token;
  if (ctx.token) {
    const restaurantId = ctx.originalCart[0]?.restaurantId || "empty";
    await request("/cart", {
      method: "PUT",
      body: JSON.stringify({
        restaurantId,
        items: ctx.originalCart.map((line) => ({
          menuItemId: line.item.id,
          quantity: line.quantity,
          extras: line.extras,
          note: line.note,
        })),
      }),
    });
  }
  await pool.end();
  await closePostgres();
}
