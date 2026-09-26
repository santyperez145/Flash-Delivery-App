// Consulta de ganancias del conductor (ledger + tiempo online) — ARC-001.
//
// Separada del cobro/reintegro de wallet y del bridge SQLite en
// `driver-earnings.js`: acá solo la lectura operativa que ve el conductor.
import { postgresPool } from "./postgres.js";

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
