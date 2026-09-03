import crypto from "node:crypto";

/** @param {import("./context.mjs").PostgresRuntimeContext} ctx */
export async function runShipmentsFinanceSupportSuite(ctx) {
  const { assert, request, readSseUntil, addressValidationToken, pool, base } = ctx;
  const pin = await pool.query(
    "SELECT delivery_pin_hash FROM shipment_details sd JOIN jobs j ON j.id=sd.job_id WHERE j.public_id=$1",
    [ctx.shipmentId],
  );
  assert(
    pin.rows[0]?.delivery_pin_hash?.startsWith("$2b$") &&
      pin.rows[0].delivery_pin_hash !== ctx.shipmentFirst.body.shipment.deliveryPin,
    "shipment stores only bcrypt PIN hash",
  );
  const shipmentPayment = await pool.query(
    "SELECT p.status FROM payment_intents p JOIN jobs j ON j.id=p.job_id WHERE j.public_id=$1",
    [ctx.shipmentId],
  );
  assert(
    shipmentPayment.rows[0]?.status === "captured" &&
      (await request("/me")).body.account.user.wallet ===
        ctx.shipmentWalletBefore - ctx.shipmentFirst.body.shipment.fare,
    "shipment captures wallet atomically",
  );
  const shipmentCancelled = await request(`/shipments/${shipmentId}/status`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "cancelled",
      reason: "recipient_unavailable",
    }),
  });
  assert(
    shipmentCancelled.status === 200 &&
      shipmentCancelled.body.shipment.status === "cancelled" &&
      (await request("/me")).body.account.user.wallet === ctx.shipmentWalletBefore,
    "shipment cancellation refunds wallet atomically",
  );
  const cancellationRecords = await pool.query(
    `SELECT j.public_id,c.reason_code,c.refund_amount_cents FROM job_cancellations c JOIN jobs j ON j.id=c.job_id WHERE j.public_id=ANY($1)`,
    [[ctx.orderId, ctx.rideId, ctx.shipmentId]],
  );
  const cancellationState = await request("/me/activity?limit=50");
  assert(
    cancellationRecords.rowCount === 3 &&
      cancellationRecords.rows.find((row) => row.public_id === ctx.rideId)?.reason_code ===
        "long_wait" &&
      cancellationRecords.rows.find((row) => row.public_id === ctx.shipmentId)?.reason_code ===
        "recipient_unavailable" &&
      cancellationRecords.rows.every((row) => Number(row.refund_amount_cents) > 0) &&
      cancellationState.body.items.find((entry) => entry.id === ctx.rideId)?.resource?.cancellation
        ?.refundAmount === ctx.rideFirst.body.ride.fare,
    "cancellations persist actor reason and exact refund outcome for every vertical",
  );
  const proofPayload = {
      ...ctx.shipmentPayload,
      paymentMethod: "Flash Wallet",
      destination: "Obelisco, Buenos Aires",
      destinationCoords: { lat: -34.6037, lng: -58.3816 },
      signatureRequired: true,
    },
    proofQuote = await request("/shipments/quote", {
      method: "POST",
      body: JSON.stringify(proofPayload),
    });
  ctx.proofShipmentKey = `proof-${crypto.randomUUID()}`;
  const proofCreated = await request("/shipments", {
    method: "POST",
    headers: { "Idempotency-Key": ctx.proofShipmentKey },
    body: JSON.stringify({
      ...proofPayload,
      quoteToken: proofQuote.body.quote?.quoteToken,
    }),
  });
  const proofShipmentId = proofCreated.body.shipment?.id;
  ctx.proofShipmentId = proofShipmentId;
  const proofPin = proofCreated.body.shipment?.deliveryPin;
  assert(
    proofCreated.body.shipment?.signatureRequired === true,
    "signed shipment quote persists the required receipt signature",
  );
  const ownerCode = await request(`/shipments/${proofShipmentId}/delivery-code`);
  assert(
    ownerCode.status === 200 && ownerCode.body.deliveryCode === proofPin,
    "shipment owner retrieves derivable delivery code without plaintext storage",
  );
  ctx.token = ctx.registeredToken;
  assert(
    (await request(`/shipments/${proofShipmentId}/delivery-code`)).status === 403,
    "another customer cannot read the delivery code",
  );
  ctx.token = ctx.driverToken;
  assert(
    (await request(`/shipments/${proofShipmentId}/delivery-code`)).status === 403,
    "driver cannot read the customer delivery code",
  );
  const proofOffers = await request("/driver/offers"),
    proofOffer = proofOffers.body.offers?.find((entry) => entry.jobId === ctx.proofShipmentId);
  assert(
    proofOffer &&
      (
        await request(`/shipments/${proofShipmentId}/accept`, {
          method: "POST",
          body: JSON.stringify({ driverId: ctx.runtimeDriverId }),
        })
      ).status === 200,
    "driver accepts proof-of-delivery shipment",
  );
  await request(`/shipments/${proofShipmentId}/advance`, {
    method: "POST",
    body: "{}",
  });
  await request(`/shipments/${proofShipmentId}/advance`, {
    method: "POST",
    body: "{}",
  });
  const deliveringProof = await request(`/shipments/${proofShipmentId}/advance`, {
    method: "POST",
    body: "{}",
  });
  assert(
    deliveringProof.body.shipment?.status === "delivering" &&
      (
        await request(`/shipments/${proofShipmentId}/advance`, {
          method: "POST",
          body: "{}",
        })
      ).status === 409,
    "shipment cannot complete without delivery PIN",
  );
  const missingPhotoProof = await request(`/shipments/${proofShipmentId}/verify-delivery`, {
    method: "POST",
    body: JSON.stringify({ pin: proofPin }),
  });
  assert(
    missingPhotoProof.status === 409,
    "shipment requires encrypted photo evidence before PIN verification",
  );
  ctx.token = ctx.registeredToken;
  assert(
    (await request(`/shipments/${proofShipmentId}/delivery-evidence`)).status === 403,
    "unrelated customer cannot inspect empty delivery evidence",
  );
  ctx.token = ctx.driverToken;
  const invalidEvidence = await request(`/shipments/${proofShipmentId}/delivery-evidence`, {
    method: "POST",
    body: JSON.stringify({
      type: "photo",
      mimeType: "image/jpeg",
      contentBase64: Buffer.from("not-an-image").toString("base64"),
    }),
  });
  assert(invalidEvidence.status === 400, "delivery evidence rejects MIME spoofing");
  const photoContent = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from(`flash-proof-${crypto.randomUUID()}`),
    ]),
    photoHash = crypto.createHash("sha256").update(photoContent).digest("hex"),
    uploadedEvidence = await request(`/shipments/${proofShipmentId}/delivery-evidence`, {
      method: "POST",
      body: JSON.stringify({
        type: "photo",
        mimeType: "image/jpeg",
        contentBase64: photoContent.toString("base64"),
        capturedAt: new Date().toISOString(),
        location: { lat: -34.6037, lng: -58.3816 },
      }),
    }),
    evidenceId = uploadedEvidence.body.evidence?.id,
    storedEvidence = await pool.query(
      "SELECT content_ciphertext,content_sha256 FROM shipment_delivery_evidence WHERE public_id=$1",
      [evidenceId],
    );
  assert(
    uploadedEvidence.status === 201 &&
      evidenceId &&
      storedEvidence.rows[0]?.content_sha256 === photoHash &&
      !storedEvidence.rows[0]?.content_ciphertext.includes(photoContent.toString("base64")),
    "assigned driver stores geolocated delivery photo encrypted at rest",
  );
  ctx.token = ctx.registeredToken;
  assert(
    (await request(`/shipment-delivery-evidence/${evidenceId}/content`)).status === 403,
    "unrelated customer cannot decrypt delivery evidence",
  );
  ctx.token = ctx.customerToken;
  const ownerEvidence = await request(`/shipments/${proofShipmentId}/delivery-evidence`),
    ownerEvidenceContent = await request(`/shipment-delivery-evidence/${evidenceId}/content`);
  assert(
    ownerEvidence.body.evidence?.[0]?.sha256 === photoHash &&
      ownerEvidenceContent.body.contentBase64 === photoContent.toString("base64"),
    "shipment owner verifies evidence metadata and authorized content",
  );
  ctx.token = ctx.driverToken;
  const missingSignatureProof = await request(`/shipments/${proofShipmentId}/verify-delivery`, {
    method: "POST",
    body: JSON.stringify({ pin: proofPin }),
  });
  assert(
    missingSignatureProof.status === 409,
    "shipment configured for signed receipt cannot complete with photo and PIN alone",
  );
  const signatureContent = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(`flash-signature-${crypto.randomUUID()}`),
  ]);
  assert(
    (
      await request(`/shipments/${proofShipmentId}/delivery-evidence`, {
        method: "POST",
        body: JSON.stringify({
          type: "signature",
          mimeType: "image/png",
          contentBase64: signatureContent.toString("base64"),
        }),
      })
    ).status === 400,
    "signature evidence rejects missing signer identity and consent",
  );
  const uploadedSignature = await request(`/shipments/${proofShipmentId}/delivery-evidence`, {
      method: "POST",
      body: JSON.stringify({
        type: "signature",
        mimeType: "image/png",
        contentBase64: signatureContent.toString("base64"),
        capturedAt: new Date().toISOString(),
        location: { lat: -34.6037, lng: -58.3816 },
        signerName: "Runtime Recipient",
        signerRelationship: "recipient",
        consentVersion: "shipment-receipt-v1",
      }),
    }),
    signatureRow = await pool.query(
      "SELECT signer_name,signer_relationship,consent_version,content_ciphertext FROM shipment_delivery_evidence WHERE public_id=$1",
      [uploadedSignature.body.evidence?.id],
    );
  assert(
    uploadedSignature.status === 201 &&
      signatureRow.rows[0]?.signer_name === "Runtime Recipient" &&
      signatureRow.rows[0]?.consent_version === "shipment-receipt-v1" &&
      !signatureRow.rows[0]?.content_ciphertext.includes(signatureContent.toString("base64")),
    "assigned driver stores signer identity, consent and encrypted handwritten evidence",
  );
  const wrongProof = await request(`/shipments/${proofShipmentId}/verify-delivery`, {
    method: "POST",
    body: JSON.stringify({ pin: proofPin === "0000" ? "9999" : "0000" }),
  });
  const failedProof = await pool.query(
    "SELECT delivery_pin_failed_attempts,delivery_verified_at FROM shipment_details sd JOIN jobs j ON j.id=sd.job_id WHERE j.public_id=$1",
    [ctx.proofShipmentId],
  );
  assert(
    wrongProof.status === 400 &&
      failedProof.rows[0]?.delivery_pin_failed_attempts === 1 &&
      !failedProof.rows[0]?.delivery_verified_at,
    "wrong delivery PIN is counted without exposing the secret",
  );
  await pool.query(
    "UPDATE shipment_details SET delivery_pin_failed_attempts=4 WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1)",
    [ctx.proofShipmentId],
  );
  const lockProof = await request(`/shipments/${proofShipmentId}/verify-delivery`, {
      method: "POST",
      body: JSON.stringify({ pin: "0000" }),
    }),
    blockedCorrect = await request(`/shipments/${proofShipmentId}/verify-delivery`, {
      method: "POST",
      body: JSON.stringify({ pin: proofPin }),
    });
  assert(
    lockProof.status === 429 && blockedCorrect.status === 429,
    "five failed PIN attempts lock verification even for a later correct code",
  );
  await pool.query(
    "UPDATE shipment_details SET delivery_pin_failed_attempts=0,delivery_pin_locked_until=NULL WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1)",
    [ctx.proofShipmentId],
  );
  const verifiedProof = await request(`/shipments/${proofShipmentId}/verify-delivery`, {
    method: "POST",
    body: JSON.stringify({ pin: proofPin }),
  });
  const proofLedger = await pool.query(
    "SELECT b.entry_count,b.imbalance_cents,t.metadata FROM ledger_transactions t JOIN ledger_transaction_balances b ON b.transaction_id=t.id WHERE t.idempotency_key=$1",
    [`driver-earning-envio-${proofShipmentId}`],
  );
  const repeatedProof = await request(`/shipments/${proofShipmentId}/verify-delivery`, {
    method: "POST",
    body: JSON.stringify({ pin: proofPin }),
  });
  if (verifiedProof.status !== 200 || !proofLedger.rows[0])
    console.error("mobility settlement diagnostic", verifiedProof, proofLedger.rows, repeatedProof);
  assert(
    verifiedProof.status === 200 &&
      verifiedProof.body.proof?.type === "pin+photo+signature" &&
      verifiedProof.body.shipment?.status === "delivered" &&
      Number(proofLedger.rows[0]?.entry_count) === 3 &&
      Number(proofLedger.rows[0]?.imbalance_cents) === 0 &&
      Number(proofLedger.rows[0]?.metadata?.driverCents) > 0 &&
      Number(proofLedger.rows[0]?.metadata?.platformCents) > 0 &&
      repeatedProof.status === 409,
    "correct PIN, photo and signature record proof and settle driver/platform exactly once with a balanced ledger",
  );
  ctx.token = ctx.customerToken;
  assert(
    (await request(`/shipments/${proofShipmentId}/delivery-code`)).status === 409,
    "delivery code becomes unavailable after completion",
  );
  ctx.token = ctx.registeredToken;
  assert(
    (
      await request(`/shipments/${proofShipmentId}/returns`, {
        method: "POST",
        body: JSON.stringify({ reason: "Intento sobre un envío ajeno" }),
      })
    ).status === 404,
    "another customer cannot request a return for a foreign shipment",
  );
  ctx.token = ctx.customerToken;
  const createdReturn = await request(`/shipments/${proofShipmentId}/returns`, {
      method: "POST",
      body: JSON.stringify({ reason: "El destinatario rechazó el paquete" }),
    }),
    shipmentReturnId = createdReturn.body.return?.id;
  assert(
    createdReturn.status === 201 &&
      shipmentReturnId &&
      (
        await request(`/shipments/${proofShipmentId}/returns`, {
          method: "POST",
          body: JSON.stringify({ reason: "Solicitud duplicada" }),
        })
      ).status === 409,
    "shipment owner creates exactly one return request",
  );
  const customerReturns = await request("/shipment-returns");
  assert(
    customerReturns.body.returns?.some((entry) => entry.id === shipmentReturnId),
    "shipment owner lists the return request",
  );
  ctx.token = ctx.registeredToken;
  assert(
    !(await request("/shipment-returns")).body.returns?.some(
      (entry) => entry.id === shipmentReturnId,
    ),
    "return listing is isolated between customers",
  );
  const returnsAdminLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "ops@flash.app",
      password: "demo123",
      deviceName: "postgres-smoke-returns",
    }),
  });
  ctx.token = returnsAdminLogin.body.token;
  assert(
    (
      await request(`/shipment-returns/${shipmentReturnId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "completed",
          resolution: "Salto inválido",
        }),
      })
    ).status === 409,
    "shipment return rejects invalid state transitions",
  );
  for (const [status, resolution] of [
    ["approved", "Retiro autorizado"],
    ["in_transit", "Paquete retirado"],
    ["completed", "Devuelto al remitente"],
  ]) {
    const transition = await request(`/shipment-returns/${shipmentReturnId}`, {
      method: "PATCH",
      body: JSON.stringify({ status, resolution }),
    });
    assert(
      transition.status === 200 && transition.body.return?.status === status,
      `shipment return transitions to ${status}`,
    );
  }
  ctx.token = ctx.customerToken;
  assert(
    (
      await request(`/jobs/${proofShipmentId}/tips`, {
        method: "POST",
        body: JSON.stringify({ amount: 500 }),
      })
    ).status === 400,
    "tip requires an idempotency key",
  );
  const excessiveTip = await request(`/jobs/${proofShipmentId}/tips`, {
    method: "POST",
    headers: { "Idempotency-Key": `tip-high-${crypto.randomUUID()}` },
    body: JSON.stringify({ amount: 100000 }),
  });
  assert(excessiveTip.status === 409, "tip is capped relative to service fare");
  const insufficientTipJobId = `RIDE-TIP-FUNDS-${Date.now()}`;
  ctx.insufficientTipJobId = insufficientTipJobId;
  await pool.query(
    `INSERT INTO jobs(
      public_id,kind,customer_id,driver_id,status,pickup_address,pickup_location,
      dropoff_address,dropoff_location,service_level,quoted_amount_cents,
      final_amount_cents,distance_m,estimated_duration_s,metadata
    ) SELECT $1,'ride',u.id,d.id,'completed','A',
      ST_SetSRID(ST_MakePoint(-58.4,-34.6),4326)::geography,'B',
      ST_SetSRID(ST_MakePoint(-58.41,-34.61),4326)::geography,'economy',
      100000,100000,1000,600,'{}'
    FROM users u CROSS JOIN drivers d WHERE u.public_id=$2 AND d.public_id=$3`,
    [ctx.insufficientTipJobId, ctx.registeredUserId, ctx.runtimeDriverId],
  );
  ctx.token = ctx.registeredToken;
  const insufficientTip = await request(`/jobs/${insufficientTipJobId}/tips`, {
    method: "POST",
    headers: { "Idempotency-Key": `tip-funds-${crypto.randomUUID()}` },
    body: JSON.stringify({ amount: 100 }),
  });
  assert(
    insufficientTip.status === 402 &&
      Number(
        (
          await pool.query(
            "SELECT count(*)::int count FROM service_tips t JOIN jobs j ON j.id=t.job_id WHERE j.public_id=$1",
            [ctx.insufficientTipJobId],
          )
        ).rows[0].count,
      ) === 0,
    "tip with insufficient Wallet balance leaves no financial records",
  );
  assert(
    (
      await request(`/jobs/${proofShipmentId}/tips`, {
        method: "POST",
        headers: { "Idempotency-Key": `tip-foreign-${crypto.randomUUID()}` },
        body: JSON.stringify({ amount: 500 }),
      })
    ).status === 404,
    "another customer cannot tip a foreign service",
  );
  ctx.token = ctx.driverToken;
  assert(
    (
      await request(`/jobs/${proofShipmentId}/tips`, {
        method: "POST",
        headers: { "Idempotency-Key": `tip-driver-${crypto.randomUUID()}` },
        body: JSON.stringify({ amount: 500 }),
      })
    ).status === 403,
    "driver cannot create a customer tip",
  );
  ctx.token = ctx.customerToken;
  const walletBalancesBeforeTip = await pool.query(
    `SELECT u.public_id,
      COALESCE(sum(CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END),0)::bigint balance
    FROM users u
    LEFT JOIN ledger_accounts a
      ON a.owner_type='user' AND a.owner_id=u.id AND a.account_type='wallet'
    LEFT JOIN ledger_entries e ON e.account_id=a.id
    WHERE u.public_id=ANY($1) GROUP BY u.public_id`,
    [["usr_customer", "usr_driver"]],
  );
  const tipKey = `tip-${crypto.randomUUID()}`;
  ctx.tipKey = tipKey;
  const firstTip = await request(`/jobs/${proofShipmentId}/tips`, {
      method: "POST",
      headers: { "Idempotency-Key": ctx.tipKey },
      body: JSON.stringify({ amount: 500 }),
    }),
    secondTip = await request(`/jobs/${proofShipmentId}/tips`, {
      method: "POST",
      headers: { "Idempotency-Key": ctx.tipKey },
      body: JSON.stringify({ amount: 500 }),
    });
  const walletBalancesAfterTip = await pool.query(
    `SELECT u.public_id,
      COALESCE(sum(CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END),0)::bigint balance
    FROM users u
    LEFT JOIN ledger_accounts a
      ON a.owner_type='user' AND a.owner_id=u.id AND a.account_type='wallet'
    LEFT JOIN ledger_entries e ON e.account_id=a.id
    WHERE u.public_id=ANY($1) GROUP BY u.public_id`,
    [["usr_customer", "usr_driver"]],
  );
  const tipLedger = await pool.query(
    "SELECT b.entry_count,b.imbalance_cents FROM ledger_transaction_balances b JOIN ledger_transactions t ON t.id=b.transaction_id WHERE t.idempotency_key=$1",
    [`tip-${tipKey}`],
  );
  const beforeTip = Object.fromEntries(
      walletBalancesBeforeTip.rows.map((row) => [row.public_id, Number(row.balance)]),
    ),
    afterTip = Object.fromEntries(
      walletBalancesAfterTip.rows.map((row) => [row.public_id, Number(row.balance)]),
    );
  assert(
    firstTip.status === 201 &&
      secondTip.body.tip?.id === firstTip.body.tip?.id &&
      afterTip.usr_customer === beforeTip.usr_customer - 50000 &&
      afterTip.usr_driver === beforeTip.usr_driver + 50000 &&
      Number(tipLedger.rows[0]?.imbalance_cents) === 0 &&
      Number(tipLedger.rows[0]?.entry_count) === 2,
    "tip transfers Wallet funds exactly once with a balanced ledger",
  );
  assert(
    (
      await request(`/jobs/${proofShipmentId}/tips`, {
        method: "POST",
        headers: { "Idempotency-Key": `tip-second-${crypto.randomUUID()}` },
        body: JSON.stringify({ amount: 500 }),
      })
    ).status === 409,
    "service accepts only one tip",
  );
  const customerTipState = await request("/me");
  assert(
    customerTipState.body.account.tips?.some(
      (entry) => entry.jobId === ctx.proofShipmentId && entry.amount === 500,
    ),
    "customer account persists the service tip",
  );
  const firstReceipt = await request(`/jobs/${proofShipmentId}/receipt`),
    secondReceipt = await request(`/jobs/${proofShipmentId}/receipt`);
  ctx.receiptId = firstReceipt.body.receipt?.id;
  const storedReceipt = await pool.query(
    "SELECT count(*)::int count,total_cents,payment_summary FROM service_receipts WHERE public_id=$1 GROUP BY total_cents,payment_summary",
    [ctx.receiptId],
  );
  if (firstReceipt.status !== 200) console.error("receipt diagnostic", firstReceipt, secondReceipt);
  assert(
    firstReceipt.status === 200 &&
      ctx.receiptId &&
      secondReceipt.body.receipt?.id === ctx.receiptId &&
      firstReceipt.body.receipt.fiscal === false &&
      storedReceipt.rows[0]?.count === 1 &&
      Number(storedReceipt.rows[0]?.total_cents) ===
        Math.round(firstReceipt.body.receipt.total * 100),
    "completed service issues one stable non-fiscal receipt snapshot",
  );
  ctx.token = ctx.registeredToken;
  assert(
    (await request(`/jobs/${proofShipmentId}/receipt`)).status === 404,
    "another customer cannot read a foreign receipt",
  );
  ctx.token = ctx.driverToken;
  assert(
    (await request(`/jobs/${proofShipmentId}/receipt`)).status === 403,
    "driver cannot read the customer receipt",
  );
  const driverTipState = await request("/me");
  assert(
    driverTipState.body.account.tips?.some((entry) => entry.jobId === ctx.proofShipmentId),
    "driver sees received tip without customer wallet data",
  );
  ctx.token = ctx.customerToken;
  const operationalAudit = await pool.query(
    `SELECT entity_type,entity_id,array_agg(action ORDER BY occurred_at) actions FROM audit_events WHERE entity_id=ANY($1) GROUP BY entity_type,entity_id`,
    [[ctx.orderId, ctx.rideId, ctx.shipmentId]],
  );
  assert(
    [ctx.orderId, ctx.rideId, ctx.shipmentId].every((id) =>
      operationalAudit.rows.some(
        (row) =>
          row.entity_id === id &&
          row.actions.some((action) => action.endsWith("created")) &&
          row.actions.some((action) => action.includes("status") || action.includes("cancelled")),
      ),
    ),
    "orders rides and shipments persist operational audit in PostgreSQL",
  );
  const webhookBody = JSON.stringify({
    id: `evt_${crypto.randomUUID()}`,
    type: "payment_intent.captured",
    data: { reference: "runtime-smoke" },
  });
  ctx.webhookIds.push(JSON.parse(webhookBody).id);
  const webhookSignature = crypto
    .createHmac("sha256", process.env.PAYMENT_WEBHOOK_SECRET)
    .update(webhookBody)
    .digest("hex");
  const webhookFirst = await request("/payments/webhooks/sandbox", {
    method: "POST",
    headers: { "X-Flash-Signature": webhookSignature },
    body: webhookBody,
  });
  const webhookSecond = await request("/payments/webhooks/sandbox", {
    method: "POST",
    headers: { "X-Flash-Signature": webhookSignature },
    body: webhookBody,
  });
  assert(
    webhookFirst.status === 200 && webhookFirst.body.processed && webhookSecond.body.duplicate,
    "signed payment webhook is processed once",
  );
  const invalidBody = JSON.stringify({
    id: `evt_${crypto.randomUUID()}`,
    type: "payment_intent.failed",
  });
  ctx.webhookIds.push(JSON.parse(invalidBody).id);
  const invalidWebhook = await request("/payments/webhooks/sandbox", {
    method: "POST",
    headers: { "X-Flash-Signature": "00".repeat(32) },
    body: invalidBody,
  });
  assert(invalidWebhook.status === 401, "invalid payment webhook signature is rejected");
  const supportCreated = await request("/support/tickets", {
    method: "POST",
    headers: { "Idempotency-Key": `runtime-support-${crypto.randomUUID()}` },
    body: JSON.stringify({
      category: "payment",
      priority: "high",
      subject: "Consulta runtime de pago",
      body: "Necesito revisar el reintegro de prueba",
    }),
  });
  const supportTicketId = supportCreated.body.ticket?.id;
  ctx.supportTicketId = supportTicketId;
  assert(
    supportCreated.status === 201 &&
      supportTicketId &&
      supportCreated.body.ticket.messages?.length === 1,
    "customer creates persistent support ticket",
  );
  const notifications = await request("/notifications");
  const supportNotification = notifications.body.notifications?.find(
    (entry) => entry.payload?.ticketId === ctx.supportTicketId,
  );
  assert(supportNotification?.status === "sent", "support action creates user notification");
  const readNotification = await request(`/notifications/${supportNotification.id}/read`, {
    method: "PATCH",
    body: "{}",
  });
  assert(
    readNotification.status === 200 &&
      readNotification.body.notifications.find((entry) => entry.id === supportNotification.id)
        ?.status === "read",
    "customer marks own notification read",
  );
  const merchantLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "comercio@flash.app",
      password: "demo123",
      deviceName: "postgres-smoke-merchant",
    }),
  });
  ctx.token = merchantLogin.body.token;
  const foreignReply = await request(`/support/tickets/${supportTicketId}/messages`, {
    method: "POST",
    headers: { "Idempotency-Key": `runtime-support-foreign-${crypto.randomUUID()}` },
    body: JSON.stringify({ body: "No debería poder responder" }),
  });
  assert(foreignReply.status === 403, "another user cannot access customer support ticket");
  ctx.token = ctx.customerToken;
  const issueWalletBefore = (await request("/me")).body.account.user.wallet;
  const createdIssue = await request(`/orders/${settlementOrderId}/issues`, {
    method: "POST",
    body: JSON.stringify({
      category: "missing_item",
      description: "Faltó un producto confirmado en la entrega",
      requestedRefund: 400,
    }),
  });
  const orderIssueId = createdIssue.body.issue?.id;
  ctx.orderIssueId = orderIssueId;
  const visibleIssue = await request(`/orders/${settlementOrderId}/issues`);
  assert(
    createdIssue.status === 201 &&
      orderIssueId &&
      visibleIssue.body.issues?.some(
        (entry) => entry.id === orderIssueId && entry.status === "open",
      ),
    "customer reports and reads a persisted food-order incident",
  );
  const adminLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "ops@flash.app",
      password: "demo123",
      deviceName: "postgres-smoke-ops",
    }),
  });
  ctx.token = adminLogin.body.token;
  const resolvedIssue = await request(`/order-issues/${orderIssueId}/resolve`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "approved",
      approvedRefund: 300,
      resolutionNote: "Reintegro parcial validado por operaciones",
    }),
  });
  const issueBalances = await pool.query(
    `SELECT b.imbalance_cents,b.entry_count FROM ledger_transaction_balances b JOIN ledger_transactions t ON t.id=b.transaction_id WHERE t.idempotency_key IN($1,$2) ORDER BY t.idempotency_key`,
    [`issue-refund-${orderIssueId}`, `issue-reversal-${orderIssueId}`],
  );
  ctx.token = ctx.customerToken;
  const issueWalletAfter = (await request("/me")).body.account.user.wallet;
  assert(
    resolvedIssue.status === 200 &&
      resolvedIssue.body.issue.approvedRefund === 300 &&
      issueWalletAfter === issueWalletBefore + 300 &&
      issueBalances.rowCount === 2 &&
      issueBalances.rows.every(
        (row) => Number(row.imbalance_cents) === 0 && Number(row.entry_count) >= 2,
      ),
    "operations approves one partial refund and reverses settlement with balanced double-entry transactions",
  );
  assert(
    (
      await request(`/order-issues/${orderIssueId}/resolve`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "approved",
          approvedRefund: 300,
          resolutionNote: "Duplicado",
        }),
      })
    ).status === 403,
    "customer cannot resolve an incident",
  );
  ctx.token = adminLogin.body.token;
  const selfSuspension = await request("/admin/users/usr_admin/status", {
    method: "PATCH",
    body: JSON.stringify({
      status: "suspended",
      reason: "Prueba de autoprotección",
    }),
  });
  assert(selfSuspension.status === 409, "admin cannot suspend its own account");
  ctx.moderationDriverId = `DRV-MOD-${Date.now()}`;
  await pool.query(
    `INSERT INTO user_roles(user_id,role) SELECT id,'driver' FROM users WHERE public_id=$1 ON CONFLICT DO NOTHING`,
    [ctx.registeredUserId],
  );
  await pool.query(
    `INSERT INTO drivers(public_id,user_id,online,active_mode,service_modes,current_location,location_updated_at) SELECT $1,
      id,
      true,
      'ride',
      ARRAY['ride']::job_kind[],
      ST_SetSRID(ST_MakePoint(-58.39,-34.60),4326)::geography,
      now() FROM users WHERE public_id=$2`,
    [ctx.moderationDriverId, ctx.registeredUserId],
  );
  await pool.query(
    `INSERT INTO dispatch_offers(public_id,job_id,driver_id,score,expires_at) SELECT $1,
      j.id,
      d.id,
      100,
      now()+interval '5 minutes' FROM jobs j CROSS JOIN drivers d WHERE j.public_id=$2 AND d.public_id=$3 ON CONFLICT(job_id,driver_id) DO UPDATE SET status='pending',
      expires_at=excluded.expires_at`,
    [`OFR-MOD-${Date.now()}`, ctx.registeredRideId, ctx.moderationDriverId],
  );
  const suspendedUser = await request(`/admin/users/${registeredUserId}/status`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "suspended",
      reason: "Revisión automatizada de seguridad",
    }),
  });
  const adminToken = ctx.token;
  ctx.token = ctx.registeredToken;
  const suspendedAccess = await request("/me");
  ctx.token = "";
  const suspendedRefresh = await request("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({
      refreshToken: ctx.registeredRefreshToken,
      deviceName: "suspended-runtime",
    }),
  });
  ctx.token = adminToken;
  const suspendedAdminState = await request(
    `/operations/users?q=${encodeURIComponent(registeredUserId)}&limit=10`,
  );
  const suspensionAudit = await pool.query(
    "SELECT after_data FROM audit_events WHERE entity_type='user' AND entity_id=$1 AND action='user.suspended' ORDER BY occurred_at DESC LIMIT 1",
    [ctx.registeredUserId],
  );
  const suspendedSupply = (
    await pool.query(
      `SELECT d.online,o.status offer_status FROM drivers d JOIN dispatch_offers o ON o.driver_id=d.id WHERE d.public_id=$1`,
      [ctx.moderationDriverId],
    )
  ).rows[0];
  assert(
    suspendedUser.status === 200 &&
      suspendedAccess.status === 401 &&
      suspendedRefresh.status === 401 &&
      suspendedAdminState.body.users.some(
        (entry) => entry.id === ctx.registeredUserId && entry.status === "suspended",
      ) &&
      !suspendedSupply.online &&
      suspendedSupply.offer_status === "withdrawn" &&
      suspensionAudit.rows[0]?.after_data.reason,
    "suspension revokes access, removes supply and remains visible and auditable to operations",
  );
  const reactivatedUser = await request(`/admin/users/${registeredUserId}/status`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "active",
      reason: "Revisión completada sin hallazgos",
    }),
  });
  ctx.token = "";
  const loginAfterReactivation = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: ctx.registeredEmail, password: "runtime123" }),
  });
  ctx.registeredToken = loginAfterReactivation.body.token;
  ctx.registeredRefreshToken = loginAfterReactivation.body.refreshToken;
  ctx.token = adminToken;
  assert(
    reactivatedUser.status === 200 && loginAfterReactivation.status === 200 && ctx.registeredToken,
    "reactivation restores credential access without restoring revoked sessions",
  );
  const adminDashboard = await request("/admin/dashboard"),
    postedRevenue =
      Number(
        (
          await pool.query(
            `SELECT COALESCE(sum(CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END),0)::bigint cents FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id=a.id ,
              WHERE a.owner_type='platform' AND a.owner_id IS NULL AND a.account_type='revenue'`,
          )
        ).rows[0].cents,
      ) / 100;
  assert(
    adminDashboard.status === 200 &&
      adminDashboard.body.dashboard.marketplace.estimatedPlatformRevenue === postedRevenue &&
      adminDashboard.body.dashboard.investor.monthlyBurn === null &&
      adminDashboard.body.dashboard.marketplace.financial.revenueCoverage === "wallet_settlements",
    "admin finance uses ledger facts and exposes no fabricated burn or runway",
  );
  const originalShipmentOptions = await request("/shipment-options"),
    originalFragile = originalShipmentOptions.body.categories.find(
      (entry) => entry.code === "fragile",
    ),
    originalPriority = originalShipmentOptions.body.serviceLevels.find(
      (entry) => entry.code === "priority",
    ),
    adminShipmentQuoteBefore = await request("/shipments/quote", {
      method: "POST",
      body: JSON.stringify(ctx.slaShipmentPayload),
    });
  const invalidCategoryLimit = await request("/admin/shipment-item-categories/fragile", {
      method: "PATCH",
      body: JSON.stringify({ maximumWeightKg: 25 }),
    }),
    updatedFragile = await request("/admin/shipment-item-categories/fragile", {
      method: "PATCH",
      body: JSON.stringify({ surcharge: originalFragile.surcharge + 1 }),
    }),
    adminShipmentQuoteAfter = await request("/shipments/quote", {
      method: "POST",
      body: JSON.stringify(ctx.slaShipmentPayload),
    }),
    restoredFragile = await request("/admin/shipment-item-categories/fragile", {
      method: "PATCH",
      body: JSON.stringify({ surcharge: originalFragile.surcharge }),
    }),
    updatedPriority = await request("/admin/shipment-service-levels/priority", {
      method: "PATCH",
      body: JSON.stringify({ etaMultiplier: 0.8, maximumDistanceKm: 25 }),
    }),
    restoredPriority = await request("/admin/shipment-service-levels/priority", {
      method: "PATCH",
      body: JSON.stringify({
        etaMultiplier: originalPriority.etaMultiplier,
        maximumDistanceKm: originalPriority.maximumDistanceKm,
      }),
    }),
    shipmentConfigAudit = await pool.query(
      "SELECT before_data,after_data FROM audit_events WHERE action='shipment.category_updated' AND entity_id='fragile' ORDER BY occurred_at DESC LIMIT 1",
    );
  assert(
    invalidCategoryLimit.status === 400 &&
      updatedFragile.status === 200 &&
      adminShipmentQuoteAfter.body.quote?.breakdown?.categorySurcharge ===
        originalFragile.surcharge + 1 &&
      adminShipmentQuoteAfter.body.quote?.fare > adminShipmentQuoteBefore.body.quote?.fare &&
      restoredFragile.status === 200 &&
      updatedPriority.status === 200 &&
      restoredPriority.status === 200 &&
      shipmentConfigAudit.rows[0]?.before_data &&
      shipmentConfigAudit.rows[0]?.after_data,
    "operations safely configures shipment limits, pricing and SLA with audit history used by live quotes",
  );
  const disabledElectronics = await request("/admin/shipment-item-categories/electronics", {
      method: "PATCH",
      body: JSON.stringify({ active: false }),
    }),
    publicOptionsWhileDisabled = await request("/shipment-options"),
    adminOptionsWhileDisabled = await request("/admin/shipment-options"),
    reactivatedElectronics = await request("/admin/shipment-item-categories/electronics", {
      method: "PATCH",
      body: JSON.stringify({ active: true }),
    });
  assert(
    disabledElectronics.status === 200 &&
      !publicOptionsWhileDisabled.body.categories.some((entry) => entry.code === "electronics") &&
      adminOptionsWhileDisabled.body.categories.some(
        (entry) => entry.code === "electronics" && entry.active === false,
      ) &&
      reactivatedElectronics.status === 200,
    "admin can deactivate and reactivate shipment options without exposing inactive choices to customers",
  );
  const originalShipmentPlan = (
    await pool.query(
      "SELECT id,version,config FROM pricing_plans WHERE service='shipment' AND active",
    )
  ).rows[0];
  const pricingStamp = Date.now(),
    publishedVersion = `AR-BA-SHIP-TEST-${pricingStamp}`,
    scheduledVersion = `AR-BA-SHIP-SCHEDULED-${pricingStamp}`,
    riskVersion = `AR-BA-SHIP-RISK-${pricingStamp}`,
    rollbackVersion = `AR-BA-SHIP-ROLLBACK-${pricingStamp}`;
  const publishedConfig = {
      ...originalShipmentPlan.config,
      baseFare: Number(originalShipmentPlan.config.baseFare) + 111,
    },
    scheduledConfig = {
      ...originalShipmentPlan.config,
      baseFare: Number(originalShipmentPlan.config.baseFare) + 222,
    },
    riskConfig = {
      ...originalShipmentPlan.config,
      baseFare: Number(originalShipmentPlan.config.baseFare) * 2,
    },
    pricingPayload = {
      pickup: "Defensa 982, San Telmo",
      destination: "Obelisco, Buenos Aires",
      packageSize: "small",
      weightKg: 1,
      pickupCoords: { lat: -34.6177, lng: -58.3621 },
      destinationCoords: { lat: -34.6037, lng: -58.3816 },
    };
  const publishedRequest = await request("/admin/pricing/shipment", {
      method: "POST",
      body: JSON.stringify({
        version: publishedVersion,
        config: publishedConfig,
      }),
    }),
    pricingRequestId = publishedRequest.body.changeRequest?.id;
  ctx.feedbackAuditRequestIds.push(publishedRequest.body.requestId);
  const selfApproval = await request(`/admin/pricing-changes/${pricingRequestId}/review`, {
    method: "PATCH",
    body: JSON.stringify({
      decision: "approved",
      note: "Aprobación propia inválida",
    }),
  });
  await pool.query(
    `INSERT INTO user_roles(user_id,role) SELECT id,'admin' FROM users WHERE public_id=$1 ON CONFLICT DO NOTHING`,
    [ctx.registeredUserId],
  );
  ctx.token = "";
  const pricingReviewerLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: ctx.registeredEmail,
      password: "runtime123",
      deviceName: "postgres-smoke-pricing-reviewer",
    }),
  });
  ctx.token = pricingReviewerLogin.body.token;
  const approvedPricing = await request(`/admin/pricing-changes/${pricingRequestId}/review`, {
      method: "PATCH",
      body: JSON.stringify({
        decision: "approved",
        note: "Comparación de costos y márgenes validada",
      }),
    }),
    publishedQuote = await request("/shipments/quote", {
      method: "POST",
      body: JSON.stringify(pricingPayload),
    });
  ctx.feedbackAuditRequestIds.push(approvedPricing.body.requestId);
  ctx.token = adminToken;
  const scheduledRequest = await request("/admin/pricing/shipment", {
      method: "POST",
      body: JSON.stringify({
        version: scheduledVersion,
        config: scheduledConfig,
        effectiveAt: new Date(Date.now() + 3600000).toISOString(),
      }),
    }),
    scheduledRequestId = scheduledRequest.body.changeRequest?.id;
  ctx.feedbackAuditRequestIds.push(scheduledRequest.body.requestId);
  ctx.token = pricingReviewerLogin.body.token;
  const approvedScheduled = await request(`/admin/pricing-changes/${scheduledRequestId}/review`, {
      method: "PATCH",
      body: JSON.stringify({
        decision: "approved",
        note: "Vigencia futura validada para ventana operativa",
      }),
    }),
    quoteBeforeSchedule = await request("/shipments/quote", {
      method: "POST",
      body: JSON.stringify(pricingPayload),
    });
  ctx.feedbackAuditRequestIds.push(approvedScheduled.body.requestId);
  await pool.query(
    "UPDATE pricing_plans SET effective_from=now()-interval '2 hours' WHERE service='shipment' AND version=$1",
    [publishedVersion],
  );
  await pool.query(
    "UPDATE pricing_change_requests SET effective_at=now()-interval '1 second' WHERE public_id=$1",
    [scheduledRequestId],
  );
  const quoteAfterSchedule = await request("/shipments/quote", {
    method: "POST",
    body: JSON.stringify(pricingPayload),
  });
  ctx.token = adminToken;
  const riskRequest = await request("/admin/pricing/shipment", {
      method: "POST",
      body: JSON.stringify({ version: riskVersion, config: riskConfig }),
    }),
    riskRequestId = riskRequest.body.changeRequest?.id;
  ctx.feedbackAuditRequestIds.push(riskRequest.body.requestId);
  ctx.token = pricingReviewerLogin.body.token;
  const shortRiskReview = await request(`/admin/pricing-changes/${riskRequestId}/review`, {
      method: "PATCH",
      body: JSON.stringify({ decision: "approved", note: "Muy corto" }),
    }),
    rejectedRisk = await request(`/admin/pricing-changes/${riskRequestId}/review`, {
      method: "PATCH",
      body: JSON.stringify({
        decision: "rejected",
        note: "Variación extraordinaria rechazada por impacto al usuario",
      }),
    });
  ctx.feedbackAuditRequestIds.push(rejectedRisk.body.requestId);
  ctx.token = adminToken;
  const rollbackRequest = await request("/admin/pricing/shipment/rollback", {
      method: "POST",
      body: JSON.stringify({
        targetVersion: originalShipmentPlan.version,
        version: rollbackVersion,
      }),
    }),
    rollbackRequestId = rollbackRequest.body.changeRequest?.id;
  ctx.feedbackAuditRequestIds.push(rollbackRequest.body.requestId);
  ctx.token = pricingReviewerLogin.body.token;
  const approvedRollback = await request(`/admin/pricing-changes/${rollbackRequestId}/review`, {
      method: "PATCH",
      body: JSON.stringify({
        decision: "approved",
        note: "Rollback validado contra la versión estable anterior",
      }),
    }),
    rollbackQuote = await request("/shipments/quote", {
      method: "POST",
      body: JSON.stringify(pricingPayload),
    });
  ctx.feedbackAuditRequestIds.push(approvedRollback.body.requestId);
  ctx.token = adminToken;
  const pricingQueue = await request("/admin/pricing-changes");
  await pool.query("DELETE FROM pricing_plans WHERE service='shipment' AND version=ANY($1)", [
    [publishedVersion, scheduledVersion, rollbackVersion],
  ]);
  await pool.query("UPDATE pricing_plans SET active=true,effective_until=NULL WHERE id=$1", [
    originalShipmentPlan.id,
  ]);
  await pool.query("DELETE FROM pricing_change_requests WHERE public_id=ANY($1)", [
    [pricingRequestId, scheduledRequestId, riskRequestId, rollbackRequestId],
  ]);
  const pricingDiagnostic = {
    publishedStatus: publishedRequest.status,
    selfApproval: selfApproval.status,
    reviewer: pricingReviewerLogin.status,
    approved: approvedPricing.body.changeRequest?.status,
    publishedVersion: publishedQuote.body.quote?.pricingVersion,
    scheduledStatus: scheduledRequest.status,
    scheduledReview: approvedScheduled.body.changeRequest?.status,
    beforeVersion: quoteBeforeSchedule.body.quote?.pricingVersion,
    afterVersion: quoteAfterSchedule.body.quote?.pricingVersion,
    risk: riskRequest.body.changeRequest?.riskLevel,
    warnings: riskRequest.body.changeRequest?.riskWarnings?.length,
    shortReview: shortRiskReview.status,
    rejected: rejectedRisk.body.changeRequest?.status,
    rollbackKind: rollbackRequest.body.changeRequest?.changeKind,
    rollbackSource: rollbackRequest.body.changeRequest?.sourceVersion,
    rollbackReview: approvedRollback.body.changeRequest?.status,
    rollbackVersion: rollbackQuote.body.quote?.pricingVersion,
    rollbackBase: rollbackQuote.body.quote?.breakdown?.base,
    expectedBase: Number(originalShipmentPlan.config.baseFare),
    queueHas: pricingQueue.body.requests?.some(
      (entry) => entry.id === rollbackRequestId && entry.status === "activated",
    ),
  };
  assert(
    publishedRequest.status === 201 &&
      selfApproval.status === 409 &&
      pricingReviewerLogin.status === 200 &&
      approvedPricing.body.changeRequest?.status === "activated" &&
      publishedQuote.body.quote?.pricingVersion === publishedVersion &&
      scheduledRequest.status === 201 &&
      approvedScheduled.body.changeRequest?.status === "approved" &&
      quoteBeforeSchedule.body.quote?.pricingVersion === publishedVersion &&
      quoteAfterSchedule.body.quote?.pricingVersion === scheduledVersion &&
      riskRequest.body.changeRequest?.riskLevel === "high" &&
      riskRequest.body.changeRequest?.riskWarnings?.length > 0 &&
      shortRiskReview.status === 400 &&
      rejectedRisk.body.changeRequest?.status === "rejected" &&
      rollbackRequest.body.changeRequest?.changeKind === "rollback" &&
      rollbackRequest.body.changeRequest?.sourceVersion === originalShipmentPlan.version &&
      approvedRollback.body.changeRequest?.status === "activated" &&
      rollbackQuote.body.quote?.pricingVersion === rollbackVersion &&
      rollbackQuote.body.quote?.breakdown.base === Number(originalShipmentPlan.config.baseFare) &&
      pricingQueue.body.requests?.some(
        (entry) => entry.id === rollbackRequestId && entry.status === "activated",
      ),
    `pricing detects risky variation, requires reinforced review and performs a second-approved rollback from immutable history (${JSON.stringify(pricingDiagnostic)})`,
  );
  const createdPromotion = await request("/promotions", {
    method: "POST",
    body: JSON.stringify({
      code: `RUNTIME${Date.now()}`,
      title: "Promoción runtime",
      description: "Prueba transaccional",
      service: "food",
      kind: "percentage",
      value: 7,
      maxDiscount: 1000,
      minSubtotal: 0,
      usageLimit: 10,
      perUserLimit: 1,
      startsAt: new Date(Date.now() - 60000).toISOString(),
      endsAt: new Date(Date.now() + 86400000).toISOString(),
      rules: {},
      active: true,
    }),
  });
  const createdPromotionId = createdPromotion.body.promotion?.id;
  ctx.createdPromotionId = createdPromotionId;
  assert(
    createdPromotion.status === 201 && createdPromotionId,
    "admin creates PostgreSQL promotion",
  );
  const disabledPromotion = await request(`/promotions/${createdPromotionId}`, {
    method: "PATCH",
    body: JSON.stringify({ active: false }),
  });
  assert(
    disabledPromotion.status === 200 && !disabledPromotion.body.promotion.active,
    "admin updates PostgreSQL promotion",
  );
  const updatedZone = await request("/zones/zone_centro", {
    method: "PATCH",
    body: JSON.stringify({
      deliveryMultiplier: Number((ctx.originalZoneMultiplier + 0.01).toFixed(2)),
    }),
  });
  assert(
    updatedZone.status === 200 &&
      updatedZone.body.zone.deliveryMultiplier !== ctx.originalZoneMultiplier,
    "admin updates PostGIS service zone configuration",
  );
  const supportQueue = await request("/support/tickets");
  assert(
    supportQueue.body.tickets?.some((entry) => entry.id === ctx.supportTicketId),
    "operations reads support queue",
  );
  const internalReply = await request(`/support/tickets/${supportTicketId}/messages`, {
    method: "POST",
    headers: { "Idempotency-Key": `runtime-support-internal-${crypto.randomUUID()}` },
    body: JSON.stringify({ body: "Nota interna runtime", internal: true }),
  });
  assert(
    internalReply.status === 200 &&
      internalReply.body.ticket.messages.some((entry) => entry.internal),
    "operations adds internal support note",
  );
  const resolved = await request(`/support/tickets/${supportTicketId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "resolved" }),
  });
  assert(
    resolved.status === 200 && resolved.body.ticket.status === "resolved",
    "operations resolves support ticket",
  );
  const processedNotifications = await request("/admin/notifications/process", {
    method: "POST",
    body: JSON.stringify({ limit: 100 }),
  });
  const delivered = await pool.query(
    "SELECT count(*)::int count FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id JOIN user_devices ud ON ud.id=d.device_id WHERE ud.public_id=$1 AND n.status='delivered'",
    [ctx.deviceId],
  );
  assert(
    processedNotifications.status === 200 &&
      Number.isInteger(processedNotifications.body.result?.claimed) &&
      delivered.rows[0].count >= 1,
    "notification worker processes outbox events and records sandbox delivery",
  );
  ctx.token = ctx.customerToken;
  const customerTickets = await request("/support/tickets");
  const customerTicket = customerTickets.body.tickets.find(
    (entry) => entry.id === ctx.supportTicketId,
  );
  assert(
    customerTicket.status === "resolved" &&
      !customerTicket.messages.some((entry) => entry.internal),
    "internal support notes stay hidden from customer",
  );
  const supportAudit = await pool.query(
    "SELECT action,after_data FROM audit_events WHERE entity_type='support_ticket' AND entity_id=$1 ORDER BY occurred_at",
    [ctx.supportTicketId],
  );
  assert(
    supportAudit.rowCount === 3 &&
      !supportAudit.rows.some((entry) =>
        JSON.stringify(entry.after_data).includes("Nota interna runtime"),
      ),
    "support mutations are audited without private message bodies",
  );
  const finalReady = await request("/ready");
  assert(
    finalReady.body.fallbackDiagnostics?.sqliteReads === 0,
    "PostgreSQL runtime performs zero SQLite fallback reads across the full smoke suite",
  );
  assert(
    ctx.sqliteFingerprint() === ctx.sqliteBefore,
    "PostgreSQL runtime smoke performs no SQLite writes",
  );
}
