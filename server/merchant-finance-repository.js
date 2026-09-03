// Captura MP y liquidación de pedidos de comida (ARC-001).
//
// Payouts/saldo → `merchant-payout-repository.js`.
import { heldTipForJob, markHeldTipRefunded, markTipReleased } from "./tip-repository.js";

export const account = async (client, { ownerType, ownerId = null, accountType }) =>
  (
    await client.query(
      `INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type) VALUES($1,$2,'ARS',$3)
  ON CONFLICT(owner_type,owner_id,currency,account_type) DO UPDATE SET owner_type=excluded.owner_type RETURNING id`,
      [ownerType, ownerId, accountType],
    )
  ).rows[0].id;
export const systemAccount = async (client, accountType) =>
  (
    await client.query(
      `INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type) VALUES('platform',NULL,'ARS',$1)
  ON CONFLICT(owner_type,currency,account_type) WHERE owner_id IS NULL DO UPDATE SET owner_type=excluded.owner_type RETURNING id`,
      [accountType],
    )
  ).rows[0].id;

export async function recordMarketplaceCapture(
  client,
  {
    paymentIntentId,
    jobId,
    jobPublicId,
    providerPaymentId,
    amountCents,
    applicationFeeCents,
    collectorId,
  },
) {
  const transaction = (
    await client.query(
      `INSERT INTO ledger_transactions(idempotency_key,kind,description,metadata) VALUES($1,'payment',$2,$3) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
      [
        `marketplace-capture-${providerPaymentId}`,
        `Captura Mercado Pago ${jobPublicId}`,
        {
          jobPublicId,
          provider: "mercadopago",
          providerPaymentId,
          applicationFeeCents,
          collectorId,
        },
      ],
    )
  ).rows[0];
  if (!transaction) return { recorded: true, idempotent: true };
  const providerControl = await systemAccount(client, "mercadopago_control"),
    clearing = await systemAccount(client, "cash_clearing");
  await client.query(
    `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES($1,$2,'debit',$4,'payment',$3,$5),($1,$6,'credit',$4,'payment',$3,$5)`,
    [
      transaction.id,
      providerControl,
      paymentIntentId,
      amountCents,
      { jobPublicId, providerPaymentId, applicationFeeCents, collectorId },
      clearing,
    ],
  );
  return { recorded: true, idempotent: false };
}

/**
 * Reparte lo cobrado entre comercio, conductor y plataforma.
 *
 * **`platformNet` puede ser negativo, y sólo por lo que la plataforma regaló.**
 * Cuando la suscripción cubre el envío, el cliente paga menos pero el conductor
 * cobra igual y el comercio cobra igual: la diferencia sale del margen de Flash,
 * que es de quien tiene que salir un beneficio que Flash vendió. Antes esto
 * hacía dos cosas mal a la vez —el conductor cobraba de menos y el reparto no
 * cerraba— y el pedido moría en la liquidación.
 *
 * El límite sigue siendo estricto: se admite perder exactamente el subsidio
 * otorgado y ni un centavo más. Levantar la cota del todo convertiría cualquier
 * error de tarifa en una pérdida silenciosa.
 */
export function calculateFoodSettlement({
  provider,
  total,
  subtotal,
  discount,
  commissionBps,
  deliveryFee,
  hasDriver,
  applicationFee = 0,
  subscriptionDiscount = 0,
}) {
  const merchantSales = Math.max(0, subtotal - discount),
    commission = Math.round((merchantSales * commissionBps) / 10000),
    merchantNet = provider === "mercadopago" ? total - applicationFee : merchantSales - commission,
    // El conductor cobra el envío completo aunque el cliente no lo haya pagado.
    // Sin `+ subscriptionDiscount` el tope lo dejaría en lo que sobró después de
    // regalar el envío, que es cobrarle a él la promoción.
    driverNet = hasDriver ? Math.min(deliveryFee, total + subscriptionDiscount - merchantNet) : 0,
    platformNet = total - merchantNet - driverNet;
  if (
    merchantNet < 0 ||
    driverNet < 0 ||
    platformNet < -subscriptionDiscount ||
    merchantNet + driverNet + platformNet !== total
  )
    throw new Error("El split financiero no balancea");
  return { merchantNet, driverNet, platformNet, commission };
}

export async function settleCapturedFoodOrder(client, { jobId, actorId = null }) {
  const job = (
    await client.query(
      `SELECT j.*,m.commission_bps,m.id merchant_internal_id,d.user_id driver_user_id,
    COALESCE((SELECT sum(quantity*unit_price_cents) FROM job_items WHERE job_id=j.id),0)::bigint subtotal_cents
    FROM jobs j JOIN merchants m ON m.id=j.merchant_id LEFT JOIN drivers d ON d.id=j.driver_id WHERE j.id=$1 FOR UPDATE OF j`,
      [jobId],
    )
  ).rows[0];
  if (!job) return { settled: false };
  const payment = (
    await client.query(
      "SELECT * FROM payment_intents WHERE job_id=$1 AND status IN('captured','partially_refunded') FOR UPDATE",
      [jobId],
    )
  ).rows[0];
  if (!payment) return { settled: false, reason: "payment_not_captured" };
  const transaction = (
    await client.query(
      `INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description,metadata) VALUES($1,'merchant_settlement',$2,$3,$4) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
      [
        `settlement-${job.public_id}`,
        actorId,
        `Liquidación pedido ${job.public_id}`,
        { jobPublicId: job.public_id },
      ],
    )
  ).rows[0];
  if (!transaction) return { settled: true, idempotent: true };
  // La propina tomada en el checkout viaja dentro de lo cobrado, pero **no se
  // reparte**: no es del comercio ni de la plataforma. Se saca del total antes
  // de dividir y se paga aparte, o el comercio se llevaria la propina del
  // repartidor.
  const tip = await heldTipForJob(client, job.id);
  const capturado = Number(payment.captured_amount_cents),
    total = capturado - tip.amountCents,
    subtotal = Number(job.subtotal_cents),
    discount = Math.round(Number(job.metadata?.discount || 0) * 100),
    // La comision de aplicacion incluye la propina desde la creacion del pedido,
    // para que el proveedor no se la deposite al comercio. Se descuenta acá por
    // el mismo motivo por el que se descuenta del total.
    providerApplicationFee =
      Number(payment.provider_payload?.applicationFeeCents || 0) - tip.amountCents,
    deliveryFee = Math.round(Number(job.metadata?.deliveryFee || 0) * 100),
    subscriptionDiscount = Math.round(Number(job.metadata?.subscriptionDiscount || 0) * 100),
    { merchantNet, driverNet, platformNet, commission } = calculateFoodSettlement({
      provider: payment.provider,
      total,
      subtotal,
      discount,
      commissionBps: Number(job.commission_bps),
      deliveryFee,
      hasDriver: Boolean(job.driver_user_id),
      applicationFee: providerApplicationFee,
      subscriptionDiscount,
    });
  const clearing = await systemAccount(client, "cash_clearing"),
    merchantDestination = await account(client, {
      ownerType: "merchant",
      ownerId: job.merchant_internal_id,
      accountType: payment.provider === "mercadopago" ? "seller_split_control" : "payable",
    }),
    platformRevenue = await systemAccount(client, "revenue");
  // Cuando la plataforma subsidia, su cuenta de resultados **se debita** en vez
  // de acreditarse. El asiento sigue balanceando porque el subsidio entra como
  // origen de fondos: es plata que Flash puso, y ponerla como un crédito
  // negativo dejaría el libro sin cuadrar.
  const entries = [
    [clearing, "debit", capturado],
    [merchantDestination, "credit", merchantNet],
    platformNet >= 0
      ? [platformRevenue, "credit", platformNet]
      : [platformRevenue, "debit", -platformNet],
  ];
  if (driverNet) {
    const driverWallet = await account(client, {
      ownerType: "user",
      ownerId: job.driver_user_id,
      accountType: "wallet",
    });
    entries.push([driverWallet, "credit", driverNet]);
  }
  // La propina, a quien corresponda. **Nunca se queda en la plataforma**: si el
  // pedido se completo sin conductor asignado —reparto propio del comercio— no
  // hay a quien pagarsela y vuelve al cliente. Quedarsela seria cobrar por un
  // servicio que nadie prestó, y es el error que nadie reclama porque nadie lo ve.
  if (tip.amountCents > 0) {
    const destinoPropina = job.driver_user_id
      ? await account(client, {
          ownerType: "user",
          ownerId: job.driver_user_id,
          accountType: "wallet",
        })
      : await account(client, {
          ownerType: "user",
          ownerId: job.customer_id,
          accountType: "wallet",
        });
    entries.push([destinoPropina, "credit", tip.amountCents]);
    if (job.driver_user_id)
      await markTipReleased(client, {
        tipId: tip.id,
        driverId: job.driver_id,
        ledgerTransactionId: transaction.id,
      });
    else await markHeldTipRefunded(client, job.id);
  }
  for (const [accountId, direction, amount] of entries)
    if (amount > 0)
      await client.query(
        `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES($1,$2,$3,$4,'food_settlement',$5,$6)`,
        [
          transaction.id,
          accountId,
          direction,
          amount,
          job.id,
          {
            jobPublicId: job.public_id,
            merchantNet,
            driverNet,
            platformNet,
            commission,
            settlementRail:
              payment.provider === "mercadopago" ? "provider_split" : "internal_payable",
            providerFeesExcluded: payment.provider === "mercadopago",
          },
        ],
      );
  return {
    settled: true,
    merchantNet,
    driverNet,
    platformNet,
    commission,
    settlementRail: payment.provider === "mercadopago" ? "provider_split" : "internal_payable",
  };
}
