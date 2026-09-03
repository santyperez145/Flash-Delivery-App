// Cobro al crear el pedido (ARC-001).
//
// Wallet ledger vs intent Mercado Pago. Separado del orquestador de alta —
// misma frontera que checkout≠capture en DoorDash/Uber Eats. La captura MP
// productiva sigue en `order-marketplace-payment-repository.js`.
import { marketplacePaymentKey } from "./order-marketplace-payment-repository.js";

export async function captureCheckoutWalletPayment(
  client,
  { customerId, jobId, publicId, chargedCents, idempotencyKey },
) {
  const walletAccount = await client.query(
    `SELECT id FROM ledger_accounts WHERE owner_type='user' AND owner_id=$1 AND currency='ARS' AND account_type='wallet' FOR UPDATE`,
    [customerId],
  );
  const walletBalance = walletAccount.rows[0]
    ? await client.query(
        `SELECT COALESCE(sum(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END),0)::bigint AS balance FROM ledger_entries WHERE account_id=$1`,
        [walletAccount.rows[0].id],
      )
    : { rows: [] };
  // Contra `chargedCents` y no contra el total: si el saldo alcanza para el
  // pedido pero no para la propina, el cobro fallaria a mitad de camino.
  if (!walletAccount.rows[0] || Number(walletBalance.rows[0]?.balance || 0) < chargedCents) {
    throw Object.assign(new Error("Saldo insuficiente en Flash Wallet"), { status: 402 });
  }
  const clearing =
    await client.query(`INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type)
        VALUES('platform',NULL,'ARS','cash_clearing') ON CONFLICT(owner_type,currency,account_type) WHERE owner_id IS NULL
        DO UPDATE SET owner_type=EXCLUDED.owner_type RETURNING id`);
  const paymentTransaction = await client.query(
    `INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description,metadata)
         VALUES($1,'payment',$2,$3,$4) RETURNING id`,
    [`payment-${idempotencyKey}`, customerId, `Pago pedido ${publicId}`, { jobPublicId: publicId }],
  );
  await client.query(
    `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES
        ($1,$2,'debit',$4,'food_order',$3,$5),($1,$6,'credit',$4,'food_order',$3,$5)`,
    [
      paymentTransaction.rows[0].id,
      walletAccount.rows[0].id,
      jobId,
      chargedCents,
      { jobPublicId: publicId },
      clearing.rows[0].id,
    ],
  );
  await client.query(
    `INSERT INTO payment_intents(job_id,customer_id,provider,status,amount_cents,captured_amount_cents,currency,idempotency_key,provider_payload)
        VALUES($1,$2,'flash_wallet','captured',$3,$3,'ARS',$4,$5)`,
    [
      jobId,
      customerId,
      chargedCents,
      `payment-${idempotencyKey}`,
      { ledgerTransactionId: paymentTransaction.rows[0].id },
    ],
  );
  return "captured";
}

export async function createCheckoutMercadoPagoIntent(
  client,
  {
    customerId,
    jobId,
    chargedCents,
    subtotalCents,
    discountCents,
    deliveryFeeCents,
    subscriptionDiscountCents,
    serviceFeeCents,
    tipCents,
    commissionBps,
    idempotencyKey,
    providerPayment,
  },
) {
  const merchantCommissionCents = Math.round(
    (Math.max(0, subtotalCents - discountCents) * Number(commissionBps)) / 10000,
  );
  // El envio que regala la suscripcion sale del margen de Flash, no del
  // comercio: se descuenta de la comision de aplicacion y no de lo que se
  // le liquida. Sumarlo entero aca le cobraria al comercio un beneficio
  // que no vendio ni financio.
  // `+ tipCents`: con split de marketplace el comercio recibe lo cobrado
  // menos la comision de aplicacion. Sin sumar la propina ahi, la propina
  // del repartidor terminaria en la cuenta del comercio.
  const applicationFeeCents =
    deliveryFeeCents -
    subscriptionDiscountCents +
    serviceFeeCents +
    merchantCommissionCents +
    tipCents;
  if (applicationFeeCents >= chargedCents)
    throw Object.assign(new Error("La comisión configurada no permite procesar este pedido"), {
      status: 409,
    });
  await client.query(
    `INSERT INTO payment_intents(
          job_id, customer_id, provider, status, amount_cents, captured_amount_cents,
          currency, idempotency_key, provider_payload
        ) VALUES ($1, $2, 'mercadopago', 'requires_confirmation', $3, 0, 'ARS', $4, $5)`,
    [
      jobId,
      customerId,
      chargedCents,
      marketplacePaymentKey(idempotencyKey),
      {
        applicationFeeCents,
        paymentMethodId: providerPayment.paymentMethodId,
        installments: providerPayment.installments,
      },
    ],
  );
  return "requires_confirmation";
}

export async function settleCheckoutPayment(
  client,
  {
    walletPayment,
    customerId,
    jobId,
    publicId,
    chargedCents,
    subtotalCents,
    discountCents,
    deliveryFeeCents,
    subscriptionDiscountCents,
    serviceFeeCents,
    tipCents,
    commissionBps,
    idempotencyKey,
    providerPayment,
  },
) {
  if (walletPayment) {
    return captureCheckoutWalletPayment(client, {
      customerId,
      jobId,
      publicId,
      chargedCents,
      idempotencyKey,
    });
  }
  return createCheckoutMercadoPagoIntent(client, {
    customerId,
    jobId,
    chargedCents,
    subtotalCents,
    discountCents,
    deliveryFeeCents,
    subscriptionDiscountCents,
    serviceFeeCents,
    tipCents,
    commissionBps,
    idempotencyKey,
    providerPayment,
  });
}
