import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
const payoutId = () => `PAY-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
const account = async (client, { ownerType, ownerId = null, accountType }) =>
  (
    await client.query(
      `INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type) VALUES($1,$2,'ARS',$3)
  ON CONFLICT(owner_type,owner_id,currency,account_type) DO UPDATE SET owner_type=excluded.owner_type RETURNING id`,
      [ownerType, ownerId, accountType],
    )
  ).rows[0].id;
const systemAccount = async (client, accountType) =>
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

export function calculateFoodSettlement({
  provider,
  total,
  subtotal,
  discount,
  commissionBps,
  deliveryFee,
  hasDriver,
  applicationFee = 0,
}) {
  const merchantSales = Math.max(0, subtotal - discount),
    commission = Math.round((merchantSales * commissionBps) / 10000),
    merchantNet = provider === "mercadopago" ? total - applicationFee : merchantSales - commission,
    driverNet = hasDriver ? Math.min(deliveryFee, total - merchantNet) : 0,
    platformNet = total - merchantNet - driverNet;
  if (
    merchantNet < 0 ||
    driverNet < 0 ||
    platformNet < 0 ||
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
  const total = Number(payment.captured_amount_cents),
    subtotal = Number(job.subtotal_cents),
    discount = Math.round(Number(job.metadata?.discount || 0) * 100),
    providerApplicationFee = Number(payment.provider_payload?.applicationFeeCents || 0),
    deliveryFee = Math.round(Number(job.metadata?.deliveryFee || 0) * 100),
    { merchantNet, driverNet, platformNet, commission } = calculateFoodSettlement({
      provider: payment.provider,
      total,
      subtotal,
      discount,
      commissionBps: Number(job.commission_bps),
      deliveryFee,
      hasDriver: Boolean(job.driver_user_id),
      applicationFee: providerApplicationFee,
    });
  const clearing = await systemAccount(client, "cash_clearing"),
    merchantDestination = await account(client, {
      ownerType: "merchant",
      ownerId: job.merchant_internal_id,
      accountType: payment.provider === "mercadopago" ? "seller_split_control" : "payable",
    }),
    platformRevenue = await systemAccount(client, "revenue");
  const entries = [
    [clearing, "debit", total],
    [merchantDestination, "credit", merchantNet],
    [platformRevenue, "credit", platformNet],
  ];
  if (driverNet) {
    const driverWallet = await account(client, {
      ownerType: "user",
      ownerId: job.driver_user_id,
      accountType: "wallet",
    });
    entries.push([driverWallet, "credit", driverNet]);
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

async function merchantForActor(client, { merchantPublicId, actorPublicId, admin = false }) {
  const row = (
    await client.query(
      `SELECT m.* FROM merchants m JOIN users owner ON owner.id=m.owner_id WHERE m.public_id=$1 AND ($3::boolean OR owner.public_id=$2)`,
      [merchantPublicId, actorPublicId, admin],
    )
  ).rows[0];
  if (!row) throw Object.assign(new Error("Comercio no autorizado"), { status: 403 });
  return row;
}

export async function createPayoutStepUp({
  jti,
  merchantPublicId,
  actorPublicId,
  admin = false,
  amount,
  expiresAt,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const merchant = await merchantForActor(client, { merchantPublicId, actorPublicId, admin }),
      user = (
        await client.query("SELECT id FROM users WHERE public_id=$1 AND status='active'", [
          actorPublicId,
        ])
      ).rows[0];
    if (!user) throw Object.assign(new Error("Usuario no encontrado"), { status: 404 });
    await client.query(
      "INSERT INTO payout_step_up_authorizations(jti,user_id,merchant_id,amount_cents,expires_at) VALUES($1,$2,$3,$4,$5)",
      [jti, user.id, merchant.id, Math.round(amount * 100), expiresAt],
    );
    await client.query("COMMIT");
    return {
      jti,
      merchantId: merchantPublicId,
      amount,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getMerchantFinance({ merchantPublicId, actorPublicId, admin = false }) {
  const client = await postgresPool.connect();
  try {
    const merchant = await merchantForActor(client, { merchantPublicId, actorPublicId, admin });
    const balance = (
      await client.query(
        `SELECT COALESCE(sum(CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END),0)::bigint balance FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id=a.id WHERE a.owner_type='merchant' AND a.owner_id=$1 AND a.account_type='payable'`,
        [merchant.id],
      )
    ).rows[0];
    const movements = await client.query(
      `SELECT t.id::text,t.kind,t.description,t.created_at,e.direction,e.amount_cents,t.metadata FROM ledger_accounts a JOIN ledger_entries e ON e.account_id=a.id JOIN ledger_transactions t ON t.id=e.transaction_id WHERE a.owner_type='merchant' AND a.owner_id=$1 ORDER BY t.created_at DESC LIMIT 100`,
      [merchant.id],
    );
    const payouts = await client.query(
      "SELECT public_id,amount_cents,status,period_start,period_end,created_at,paid_at,review_decision,review_note,reviewed_at FROM payouts WHERE payee_type='merchant' AND payee_id=$1 ORDER BY created_at DESC LIMIT 100",
      [merchant.id],
    );
    return {
      merchantId: merchantPublicId,
      availableBalance: Number(balance.balance) / 100,
      movements: movements.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        description: row.description,
        direction: row.direction,
        amount: Number(row.amount_cents) / 100,
        createdAt: new Date(row.created_at).toISOString(),
        metadata: row.metadata,
      })),
      payouts: payouts.rows.map((row) => ({
        id: row.public_id,
        amount: Number(row.amount_cents) / 100,
        status: row.status,
        periodStart: new Date(row.period_start).toISOString(),
        periodEnd: new Date(row.period_end).toISOString(),
        createdAt: new Date(row.created_at).toISOString(),
        paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
        reviewDecision: row.review_decision || null,
        reviewNote: row.review_note || null,
        reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
      })),
    };
  } finally {
    client.release();
  }
}

export async function requestMerchantPayout({
  merchantPublicId,
  actorPublicId,
  admin = false,
  amount,
  idempotencyKey,
  stepUpJti,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const merchant = await merchantForActor(client, { merchantPublicId, actorPublicId, admin }),
      amountCents = Math.round(amount * 100);
    const existing = (
      await client.query(
        "SELECT public_id FROM payouts WHERE idempotency_key=$1 AND payee_type='merchant' AND payee_id=$2",
        [idempotencyKey, merchant.id],
      )
    ).rows[0];
    if (existing) {
      await client.query("ROLLBACK");
      return getMerchantFinance({ merchantPublicId, actorPublicId, admin });
    }
    const authorized = (
      await client.query(
        `UPDATE payout_step_up_authorizations s SET consumed_at=now() FROM users u WHERE s.jti=$1 AND s.user_id=u.id AND u.public_id=$2 AND s.merchant_id=$3 AND s.amount_cents=$4 AND s.consumed_at IS NULL AND s.expires_at>now() RETURNING s.jti`,
        [stepUpJti, actorPublicId, merchant.id, amountCents],
      )
    ).rows[0];
    if (!authorized)
      throw Object.assign(new Error("Autorización reforzada inválida, vencida o ya utilizada"), {
        status: 403,
      });
    const payable = await account(client, {
      ownerType: "merchant",
      ownerId: merchant.id,
      accountType: "payable",
    });
    await client.query("SELECT id FROM ledger_accounts WHERE id=$1 FOR UPDATE", [payable]);
    const balance = Number(
      (
        await client.query(
          `SELECT COALESCE(sum(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END),0)::bigint balance FROM ledger_entries WHERE account_id=$1`,
          [payable],
        )
      ).rows[0].balance,
    );
    if (balance < amountCents)
      throw Object.assign(new Error("Saldo comercial insuficiente"), { status: 409 });
    const payout = (
      await client.query(
        `INSERT INTO payouts(public_id,payee_type,payee_id,provider,amount_cents,status,period_start,period_end,idempotency_key,metadata,requested_by) SELECT $1,'merchant',$2,'pending_provider',$3,'pending',now()-interval '30 days',now(),$4,$5,u.id FROM users u WHERE u.public_id=$6 ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING public_id`,
        [payoutId(), merchant.id, amountCents, idempotencyKey, { merchantPublicId }, actorPublicId],
      )
    ).rows[0];
    if (!payout) {
      await client.query("ROLLBACK");
      return getMerchantFinance({ merchantPublicId, actorPublicId, admin });
    }
    const transaction = (
      await client.query(
        `INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description,metadata) SELECT $1,'payout_reserve',u.id,$2,$3 FROM users u WHERE u.public_id=$4 RETURNING id`,
        [
          `payout-reserve-${idempotencyKey}`,
          `Reserva payout ${payout.public_id}`,
          { payoutId: payout.public_id },
          actorPublicId,
        ],
      )
    ).rows[0];
    const pending = await account(client, {
      ownerType: "merchant",
      ownerId: merchant.id,
      accountType: "payout_pending",
    });
    await client.query(
      `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,metadata) VALUES($1,$2,'debit',$4,'merchant_payout',$5),($1,$3,'credit',$4,'merchant_payout',$5)`,
      [transaction.id, payable, pending, amountCents, { payoutId: payout.public_id }],
    );
    await client.query("COMMIT");
    return getMerchantFinance({ merchantPublicId, actorPublicId, admin });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const mapPayout = (row) => ({
  id: row.public_id,
  merchantId: row.merchant_public_id,
  merchantName: row.merchant_name,
  amount: Number(row.amount_cents) / 100,
  currency: row.currency,
  status: row.status,
  provider: row.provider,
  providerPayoutId: row.provider_payout_id || null,
  requestedBy: row.requested_by_public_id || null,
  reviewedBy: row.reviewed_by_public_id || null,
  reviewDecision: row.review_decision || null,
  reviewNote: row.review_note || null,
  createdAt: new Date(row.created_at).toISOString(),
  reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
  paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
});
const payoutSelect = `SELECT p.*,m.public_id merchant_public_id,m.name merchant_name,requester.public_id requested_by_public_id,reviewer.public_id reviewed_by_public_id FROM payouts p JOIN merchants m ON p.payee_type='merchant' AND m.id=p.payee_id LEFT JOIN users requester ON requester.id=p.requested_by LEFT JOIN users reviewer ON reviewer.id=p.reviewed_by`;
export async function getPayoutReviewQueue() {
  return (
    await postgresPool.query(
      `${payoutSelect} ORDER BY CASE p.status WHEN 'pending' THEN 1 WHEN 'processing' THEN 2 ELSE 3 END,p.created_at DESC LIMIT 200`,
    )
  ).rows.map(mapPayout);
}
export async function reviewMerchantPayout({ payoutPublicId, actorPublicId, decision, note }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const payout = (
      await client.query(`${payoutSelect} WHERE p.public_id=$1 FOR UPDATE OF p`, [payoutPublicId])
    ).rows[0];
    if (!payout) throw Object.assign(new Error("Payout no encontrado"), { status: 404 });
    if (payout.requested_by_public_id === actorPublicId)
      throw Object.assign(new Error("Quien solicita no puede aprobar su propio payout"), {
        status: 409,
      });
    if (payout.review_decision) {
      if (payout.review_decision === decision) {
        await client.query("ROLLBACK");
        return mapPayout(payout);
      }
      throw Object.assign(new Error("El payout ya fue revisado"), { status: 409 });
    }
    if (payout.status !== "pending")
      throw Object.assign(new Error("El payout no está pendiente de revisión"), { status: 409 });
    const reviewer = (
      await client.query("SELECT id FROM users WHERE public_id=$1", [actorPublicId])
    ).rows[0];
    if (!reviewer) throw Object.assign(new Error("Revisor no encontrado"), { status: 404 });
    if (decision === "approved")
      await client.query(
        "UPDATE payouts SET status='processing',reviewed_by=$2,review_decision='approved',review_note=$3,reviewed_at=now() WHERE id=$1",
        [payout.id, reviewer.id, note],
      );
    else {
      const payable = await account(client, {
          ownerType: "merchant",
          ownerId: payout.payee_id,
          accountType: "payable",
        }),
        pending = await account(client, {
          ownerType: "merchant",
          ownerId: payout.payee_id,
          accountType: "payout_pending",
        }),
        transaction = (
          await client.query(
            `INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description,metadata) VALUES($1,'payout_release',$2,$3,$4) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
            [
              `payout-release-${payout.public_id}`,
              reviewer.id,
              `Liberación payout rechazado ${payout.public_id}`,
              { payoutId: payout.public_id },
            ],
          )
        ).rows[0];
      if (transaction)
        await client.query(
          `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES($1,$2,'debit',$4,'merchant_payout',$5,$6),($1,$3,'credit',$4,'merchant_payout',$5,$6)`,
          [
            transaction.id,
            pending,
            payable,
            payout.amount_cents,
            payout.id,
            { payoutId: payout.public_id },
          ],
        );
      await client.query(
        "UPDATE payouts SET status='cancelled',reviewed_by=$2,review_decision='rejected',review_note=$3,reviewed_at=now() WHERE id=$1",
        [payout.id, reviewer.id, note],
      );
    }
    await client.query("COMMIT");
    return mapPayout(
      (await postgresPool.query(`${payoutSelect} WHERE p.public_id=$1`, [payoutPublicId])).rows[0],
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
