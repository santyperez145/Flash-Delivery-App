import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
import { markHeldTipRefunded } from "./tip-repository.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";

const clearingAccount = async (client) =>
  (
    await client.query(`INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type)
  VALUES('platform',NULL,'ARS','cash_clearing') ON CONFLICT (owner_type,currency,account_type) WHERE owner_id IS NULL DO UPDATE SET owner_type=EXCLUDED.owner_type RETURNING id`)
  ).rows[0].id;
const userAccount = async (client, userId) =>
  (
    await client.query(
      `INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type)
  VALUES('user',$1,'ARS','wallet') ON CONFLICT(owner_type,owner_id,currency,account_type) DO UPDATE SET owner_type=EXCLUDED.owner_type RETURNING id`,
      [userId],
    )
  ).rows[0].id;

export async function captureWalletPayment(
  client,
  { jobId, customerId, amountCents, idempotencyKey, description, metadata = {} },
) {
  const wallet = await userAccount(client, customerId);
  await client.query("SELECT id FROM ledger_accounts WHERE id=$1 FOR UPDATE", [wallet]);
  const balance = Number(
    (
      await client.query(
        `SELECT COALESCE(sum(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END),0)::bigint balance FROM ledger_entries WHERE account_id=$1`,
        [wallet],
      )
    ).rows[0].balance,
  );
  if (balance < amountCents)
    throw Object.assign(new Error("Saldo insuficiente en Flash Wallet"), { status: 402 });
  const clearing = await clearingAccount(client);
  const transaction = (
    await client.query(
      `INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description,metadata)
    VALUES($1,'payment',$2,$3,$4) RETURNING id`,
      [`payment-${idempotencyKey}`, customerId, description, metadata],
    )
  ).rows[0];
  await client.query(
    `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES
    ($1,$2,'debit',$4,'payment',$3,$5),($1,$6,'credit',$4,'payment',$3,$5)`,
    [transaction.id, wallet, jobId, amountCents, metadata, clearing],
  );
  await client.query(
    `INSERT INTO payment_intents(job_id,customer_id,provider,status,amount_cents,captured_amount_cents,currency,idempotency_key,provider_payload)
    VALUES($1,$2,'flash_wallet','captured',$3,$3,'ARS',$4,$5)`,
    [jobId, customerId, amountCents, `wallet-${idempotencyKey}`, metadata],
  );
}

export async function getWallet(publicUserId) {
  const user = (await postgresPool.query("SELECT id FROM users WHERE public_id=$1", [publicUserId]))
    .rows[0];
  if (!user) return null;
  const account = (
    await postgresPool.query(
      "SELECT id FROM ledger_accounts WHERE owner_type='user' AND owner_id=$1 AND currency='ARS' AND account_type='wallet'",
      [user.id],
    )
  ).rows[0];
  if (!account) return { balance: 0, transactions: [] };
  const balance = await postgresPool.query(
    `SELECT COALESCE(sum(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END),0)::bigint balance FROM ledger_entries WHERE account_id=$1`,
    [account.id],
  );
  const history = await postgresPool.query(
    `SELECT t.id,t.kind,t.description,t.created_at,e.direction,e.amount_cents,t.metadata FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.transaction_id WHERE e.account_id=$1 AND t.status='posted' ORDER BY t.created_at DESC LIMIT 100`,
    [account.id],
  );
  return {
    balance: Number(balance.rows[0].balance) / 100,
    transactions: history.rows.map((row) => ({
      id: row.id,
      userId: publicUserId,
      kind: row.direction,
      amount: Number(row.amount_cents) / 100,
      description: row.description,
      createdAt: new Date(row.created_at).toISOString(),
      metadata: row.metadata,
    })),
  };
}

export async function getWalletBalances() {
  const result =
    await postgresPool.query(`SELECT u.public_id,COALESCE(sum(CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END),0)::bigint balance
  FROM users u LEFT JOIN ledger_accounts a ON a.owner_type='user' AND a.owner_id=u.id AND a.account_type='wallet' LEFT JOIN ledger_entries e ON e.account_id=a.id GROUP BY u.public_id`);
  return new Map(result.rows.map((row) => [row.public_id, Number(row.balance) / 100]));
}

export async function getPostgresWalletTransactions({ userPublicId, includeAll = false }) {
  const result = await postgresPool.query(
    `SELECT t.id::text,u.public_id user_id,t.kind,t.description,t.created_at,e.direction,e.amount_cents,t.metadata FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.transaction_id JOIN ledger_accounts a ON a.id=e.account_id JOIN users u ON u.id=a.owner_id WHERE a.owner_type='user' AND a.account_type='wallet' AND ($2::boolean OR u.public_id=$1) AND t.status='posted' ORDER BY t.created_at DESC LIMIT 500`,
    [userPublicId, includeAll],
  );
  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    kind: row.direction,
    transactionKind: row.kind,
    amount: Number(row.amount_cents) / 100,
    description: row.description,
    createdAt: new Date(row.created_at).toISOString(),
    metadata: row.metadata,
  }));
}

const driverEarningKinds = ["driver_earning", "merchant_settlement", "tip", "tip_adjustment"];
const signedCents = (row) => (row.direction === "credit" ? 1 : -1) * Number(row.amount_cents);
const earningCategory = (row) => {
  if (row.kind === "tip") return "tip";
  if (row.kind === "tip_adjustment") return "adjustment";
  if (row.kind === "merchant_settlement" || row.job_subtype === "food_order") return "food";
  return row.job_kind === "ride" ? "ride" : "shipment";
};

const unionDurationSeconds = (rows, start, end, observedAt) => {
  const lower = new Date(start).getTime();
  const upper = Math.min(new Date(end).getTime(), new Date(observedAt).getTime());
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) return 0;
  const intervals = rows
    .map((row) => [
      Math.max(lower, new Date(row.started_at).getTime()),
      Math.min(upper, row.ended_at ? new Date(row.ended_at).getTime() : upper),
    ])
    .filter(([from, to]) => Number.isFinite(from) && Number.isFinite(to) && to > from)
    .sort((left, right) => left[0] - right[0]);
  let total = 0;
  let current = null;
  for (const interval of intervals) {
    if (!current) current = [...interval];
    else if (interval[0] <= current[1]) current[1] = Math.max(current[1], interval[1]);
    else {
      total += current[1] - current[0];
      current = [...interval];
    }
  }
  if (current) total += current[1] - current[0];
  return Math.floor(total / 1000);
};

export async function getDriverEarnings(userPublicId) {
  const identity = (
    await postgresPool.query(
      `SELECT u.id user_id,u.timezone,d.id driver_id,d.public_id driver_public_id
       FROM users u JOIN drivers d ON d.user_id=u.id
       WHERE u.public_id=$1`,
      [userPublicId],
    )
  ).rows[0];
  if (!identity) return null;
  const timezone = identity.timezone || "America/Argentina/Buenos_Aires";
  const account = (
    await postgresPool.query(
      `SELECT id FROM ledger_accounts
       WHERE owner_type='user' AND owner_id=$1 AND currency='ARS' AND account_type='wallet'`,
      [identity.user_id],
    )
  ).rows[0];
  const periodBounds = (
    await postgresPool.query(
      `SELECT
         (date_trunc('day',now() AT TIME ZONE $1) AT TIME ZONE $1) today_start,
         ((date_trunc('day',now() AT TIME ZONE $1)+interval '1 day') AT TIME ZONE $1) today_end,
         (date_trunc('week',now() AT TIME ZONE $1) AT TIME ZONE $1) week_start,
         ((date_trunc('week',now() AT TIME ZONE $1)+interval '1 week') AT TIME ZONE $1) week_end`,
      [timezone],
    )
  ).rows[0];
  const observedAt = new Date();
  const [availabilityRows, jobRows, dayBounds] = await Promise.all([
    postgresPool.query(
      `SELECT started_at,ended_at FROM driver_availability_sessions
       WHERE driver_id=$1 AND started_at<$3 AND COALESCE(ended_at,$4)>$2
       ORDER BY started_at`,
      [identity.driver_id, periodBounds.week_start, periodBounds.week_end, observedAt],
    ),
    postgresPool.query(
      `SELECT started_at,ended_at FROM driver_job_sessions
       WHERE driver_id=$1 AND started_at<$3 AND COALESCE(ended_at,$4)>$2
       ORDER BY started_at`,
      [identity.driver_id, periodBounds.week_start, periodBounds.week_end, observedAt],
    ),
    postgresPool.query(
      `SELECT to_char(day.local_day,'YYYY-MM-DD') date,
         (day.local_day AT TIME ZONE $1) day_start,
         ((day.local_day+interval '1 day') AT TIME ZONE $1) day_end
       FROM generate_series(
         date_trunc('week',now() AT TIME ZONE $1),
         date_trunc('day',now() AT TIME ZONE $1),
         interval '1 day'
       ) AS day(local_day)
       ORDER BY day.local_day`,
      [timezone],
    ),
  ]);
  const operationalTime = (start, end) => ({
    onlineSeconds: unionDurationSeconds(availabilityRows.rows, start, end, observedAt),
    activeSeconds: unionDurationSeconds(jobRows.rows, start, end, observedAt),
  });
  const emptyPeriod = (start, end) => ({
    amount: 0,
    serviceEarnings: 0,
    tips: 0,
    adjustments: 0,
    services: 0,
    ...operationalTime(start, end),
    periodStart: new Date(start).toISOString(),
    periodEnd: new Date(end).toISOString(),
  });
  if (!account) {
    return {
      driverId: identity.driver_public_id,
      currency: "ARS",
      timezone,
      source: "postgres-ledger",
      walletBalance: 0,
      today: emptyPeriod(periodBounds.today_start, periodBounds.today_end),
      week: emptyPeriod(periodBounds.week_start, periodBounds.week_end),
      days: dayBounds.rows.map((day) => ({
        date: day.date,
        amount: 0,
        serviceEarnings: 0,
        tips: 0,
        adjustments: 0,
        services: 0,
        ...operationalTime(day.day_start, day.day_end),
      })),
      recent: [],
      timeTracking: {
        status: "available",
        source: "postgres-operational-sessions",
        observedAt: observedAt.toISOString(),
      },
      cashout: { status: "not_configured", reason: "external_payout_provider_required" },
    };
  }
  const [summaryResult, recentResult, dailyResult] = await Promise.all([
    postgresPool.query(
      `WITH scoped AS (
         SELECT t.kind,t.created_at,e.reference_id,
           CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END signed_cents
         FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.transaction_id
         WHERE e.account_id=$1 AND t.status='posted'
       )
       SELECT
         COALESCE(sum(signed_cents),0)::bigint wallet_balance,
         COALESCE(sum(signed_cents) FILTER(WHERE kind=ANY($2) AND created_at >= $3 AND created_at < $4),0)::bigint today_amount,
         COALESCE(sum(signed_cents) FILTER(WHERE kind IN('driver_earning','merchant_settlement') AND created_at >= $3 AND created_at < $4),0)::bigint today_services,
         COALESCE(sum(signed_cents) FILTER(WHERE kind='tip' AND created_at >= $3 AND created_at < $4),0)::bigint today_tips,
         COALESCE(sum(signed_cents) FILTER(WHERE kind='tip_adjustment' AND created_at >= $3 AND created_at < $4),0)::bigint today_adjustments,
         count(DISTINCT reference_id) FILTER(WHERE kind IN('driver_earning','merchant_settlement') AND signed_cents>0 AND created_at >= $3 AND created_at < $4)::int today_count,
         COALESCE(sum(signed_cents) FILTER(WHERE kind=ANY($2) AND created_at >= $5 AND created_at < $6),0)::bigint week_amount,
         COALESCE(sum(signed_cents) FILTER(WHERE kind IN('driver_earning','merchant_settlement') AND created_at >= $5 AND created_at < $6),0)::bigint week_services,
         COALESCE(sum(signed_cents) FILTER(WHERE kind='tip' AND created_at >= $5 AND created_at < $6),0)::bigint week_tips,
         COALESCE(sum(signed_cents) FILTER(WHERE kind='tip_adjustment' AND created_at >= $5 AND created_at < $6),0)::bigint week_adjustments,
         count(DISTINCT reference_id) FILTER(WHERE kind IN('driver_earning','merchant_settlement') AND signed_cents>0 AND created_at >= $5 AND created_at < $6)::int week_count
       FROM scoped`,
      [
        account.id,
        driverEarningKinds,
        periodBounds.today_start,
        periodBounds.today_end,
        periodBounds.week_start,
        periodBounds.week_end,
      ],
    ),
    postgresPool.query(
      `SELECT t.id::text,t.kind,t.description,t.created_at,e.direction,e.amount_cents,
         j.kind job_kind,j.metadata->>'subtype' job_subtype,
         COALESCE(j.public_id,t.metadata->>'jobId',t.metadata->>'publicId',e.metadata->>'jobPublicId') reference_public_id
       FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.transaction_id
       LEFT JOIN jobs j ON j.id=e.reference_id
       WHERE e.account_id=$1 AND t.status='posted' AND t.kind=ANY($2)
       ORDER BY t.created_at DESC,t.id DESC LIMIT 100`,
      [account.id, driverEarningKinds],
    ),
    postgresPool.query(
      `WITH scoped AS (
         SELECT t.kind,t.created_at,e.reference_id,
           CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END signed_cents
         FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.transaction_id
         WHERE e.account_id=$1 AND t.status='posted' AND t.kind=ANY($2)
           AND t.created_at>=$4 AND t.created_at<$5
       )
       SELECT to_char(created_at AT TIME ZONE $3,'YYYY-MM-DD') date,
         COALESCE(sum(signed_cents),0)::bigint amount,
         COALESCE(sum(signed_cents) FILTER(WHERE kind IN('driver_earning','merchant_settlement')),0)::bigint services_amount,
         COALESCE(sum(signed_cents) FILTER(WHERE kind='tip'),0)::bigint tips,
         COALESCE(sum(signed_cents) FILTER(WHERE kind='tip_adjustment'),0)::bigint adjustments,
         count(DISTINCT reference_id) FILTER(WHERE kind IN('driver_earning','merchant_settlement') AND signed_cents>0)::int services
       FROM scoped GROUP BY 1 ORDER BY 1`,
      [account.id, driverEarningKinds, timezone, periodBounds.week_start, periodBounds.week_end],
    ),
  ]);
  const summary = summaryResult.rows[0],
    recentRows = recentResult.rows;
  const amount = (value) => Number(value || 0) / 100;
  const dailyByDate = new Map(dailyResult.rows.map((row) => [row.date, row]));
  const period = (prefix, start, end) => ({
    amount: amount(summary[`${prefix}_amount`]),
    serviceEarnings: amount(summary[`${prefix}_services`]),
    tips: amount(summary[`${prefix}_tips`]),
    adjustments: amount(summary[`${prefix}_adjustments`]),
    services: Number(summary[`${prefix}_count`] || 0),
    ...operationalTime(start, end),
    periodStart: new Date(start).toISOString(),
    periodEnd: new Date(end).toISOString(),
  });
  return {
    driverId: identity.driver_public_id,
    currency: "ARS",
    timezone,
    source: "postgres-ledger",
    walletBalance: amount(summary.wallet_balance),
    today: period("today", periodBounds.today_start, periodBounds.today_end),
    week: period("week", periodBounds.week_start, periodBounds.week_end),
    days: dayBounds.rows.map((day) => {
      const row = dailyByDate.get(day.date) || {};
      return {
        date: day.date,
        amount: amount(row.amount),
        serviceEarnings: amount(row.services_amount),
        tips: amount(row.tips),
        adjustments: amount(row.adjustments),
        services: Number(row.services || 0),
        ...operationalTime(day.day_start, day.day_end),
      };
    }),
    recent: recentRows.map((row) => ({
      id: row.id,
      category: earningCategory(row),
      jobId: row.reference_public_id || null,
      description: row.description,
      amount: signedCents(row) / 100,
      createdAt: new Date(row.created_at).toISOString(),
    })),
    timeTracking: {
      status: "available",
      source: "postgres-operational-sessions",
      observedAt: observedAt.toISOString(),
    },
    cashout: { status: "not_configured", reason: "external_payout_provider_required" },
  };
}

export async function creditWallet({
  publicUserId,
  amount,
  idempotencyKey,
  kind,
  description,
  metadata = {},
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const user = (await client.query("SELECT id FROM users WHERE public_id=$1", [publicUserId]))
      .rows[0];
    if (!user) throw Object.assign(new Error("Usuario no encontrado"), { status: 404 });
    const transaction = await client.query(
      `INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description,metadata) VALUES($1,$2,$3,$4,$5) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
      [idempotencyKey, kind, user.id, description, metadata],
    );
    if (!transaction.rows[0]) {
      await client.query("ROLLBACK");
      return getWallet(publicUserId);
    }
    const wallet = await userAccount(client, user.id),
      clearing = await clearingAccount(client),
      amountCents = Math.round(amount * 100);
    await client.query(
      `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES
    ($1,$2,'credit',$4,$5,$3,$6),($1,$7,'debit',$4,$5,$3,$6)`,
      [transaction.rows[0].id, wallet, user.id, amountCents, kind, metadata, clearing],
    );
    await client.query("COMMIT");
    return getWallet(publicUserId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function settleMobilityWalletPayment({
  publicId,
  driverPublicId,
  driverAmount,
  reference,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const job = (
      await client.query(
        "SELECT j.id,j.kind,j.driver_id,d.user_id driver_user_id FROM jobs j JOIN drivers d ON d.id=j.driver_id WHERE j.public_id=$1 AND d.public_id=$2 AND j.status='completed' FOR UPDATE OF j",
        [publicId, driverPublicId],
      )
    ).rows[0];
    if (!job)
      throw Object.assign(new Error("Servicio completado no encontrado para liquidar"), {
        status: 409,
      });
    const payment = (
      await client.query(
        "SELECT id,captured_amount_cents FROM payment_intents WHERE job_id=$1 AND provider='flash_wallet' AND status='captured' FOR UPDATE",
        [job.id],
      )
    ).rows[0];
    if (!payment) {
      await client.query("ROLLBACK");
      return { settled: false, reason: "payment_not_captured" };
    }
    const total = Number(payment.captured_amount_cents),
      driverCents = Math.min(total, Math.max(0, Math.round(driverAmount * 100))),
      platformCents = total - driverCents;
    const transaction = (
      await client.query(
        `INSERT INTO ledger_transactions(idempotency_key,kind,description,metadata) VALUES($1,'driver_earning',$2,$3) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
        [
          `driver-earning-${reference}`,
          `Liquidación ${publicId}`,
          { publicId, driverCents, platformCents },
        ],
      )
    ).rows[0];
    if (!transaction) {
      await client.query("ROLLBACK");
      return {
        settled: true,
        duplicate: true,
        driverAmount: driverCents / 100,
        platformAmount: platformCents / 100,
      };
    }
    const driverWallet = await userAccount(client, job.driver_user_id),
      clearing = await clearingAccount(client),
      revenue = (
        await client.query(
          `INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type) VALUES('platform',NULL,'ARS','revenue') ON CONFLICT(owner_type,currency,account_type) WHERE owner_id IS NULL DO UPDATE SET owner_type=excluded.owner_type RETURNING id`,
        )
      ).rows[0].id;
    await client.query("SELECT id FROM ledger_accounts WHERE id=ANY($1) ORDER BY id FOR UPDATE", [
      [driverWallet, clearing, revenue],
    ]);
    await client.query(
      `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES($1,$2,'debit',$3,'mobility_settlement',$4,$5),($1,$6,'credit',$7,'mobility_settlement',$4,$5),($1,$8,'credit',$9,'mobility_settlement',$4,$5)`,
      [
        transaction.id,
        clearing,
        total,
        job.id,
        { publicId, driverCents, platformCents },
        driverWallet,
        driverCents,
        revenue,
        platformCents,
      ],
    );
    await client.query("COMMIT");
    return { settled: true, driverAmount: driverCents / 100, platformAmount: platformCents / 100 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

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
        `UPDATE jobs SET status='cancelled',version=version+1,updated_at=now() WHERE public_id=$1 AND kind='delivery' AND metadata->>'subtype'='food_order' AND status NOT IN('completed','cancelled') RETURNING id,customer_id`,
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
