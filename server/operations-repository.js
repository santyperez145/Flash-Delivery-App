// Overview financiero de backoffice (ARC-001).
//
// Soporte → `support-repository.js`. Auditoría → `audit-repository.js`.
// Inbox → `notification-repository.js`. Acá queda el tablero de dinero admin.
import { postgresPool } from "./postgres.js";

export async function getPostgresAdminFinancials() {
  const [payments, refunds, revenue, merchantPayable, payouts] = await Promise.all([
    postgresPool.query(
      `SELECT COALESCE(sum(amount_cents),0)::bigint gross_processed_cents,COALESCE(sum(captured_amount_cents),0)::bigint net_captured_cents,count(*)::int payment_count FROM payment_intents`,
    ),
    postgresPool.query(
      `SELECT COALESCE(sum(amount_cents) FILTER(WHERE status='succeeded'),0)::bigint refunded_cents,count(*) FILTER(WHERE status='succeeded')::int refund_count FROM refunds`,
    ),
    postgresPool.query(
      `SELECT COALESCE(sum(CASE WHEN e.direction = 'credit' THEN e.amount_cents
        ELSE -e.amount_cents END), 0)::bigint cents
       FROM ledger_accounts a
       LEFT JOIN ledger_entries e ON e.account_id = a.id
       WHERE a.owner_type = 'platform' AND a.owner_id IS NULL AND a.account_type = 'revenue'`,
    ),
    postgresPool.query(
      `SELECT COALESCE(sum(CASE WHEN e.direction = 'credit' THEN e.amount_cents
        ELSE -e.amount_cents END), 0)::bigint cents
       FROM ledger_accounts a
       LEFT JOIN ledger_entries e ON e.account_id = a.id
       WHERE a.owner_type = 'merchant' AND a.account_type = 'payable'`,
    ),
    postgresPool.query(
      `SELECT COALESCE(sum(amount_cents) FILTER (WHERE status IN ('pending', 'processing')), 0)::bigint
        pending_cents,
        count(*) FILTER (WHERE status IN ('pending', 'processing'))::int pending_count
       FROM payouts`,
    ),
  ]);
  const money = (value) => Number(value || 0) / 100;
  return {
    grossProcessed: money(payments.rows[0].gross_processed_cents),
    netCaptured: money(payments.rows[0].net_captured_cents),
    paymentCount: payments.rows[0].payment_count,
    refunded: money(refunds.rows[0].refunded_cents),
    refundCount: refunds.rows[0].refund_count,
    postedPlatformRevenue: money(revenue.rows[0].cents),
    merchantPayable: money(merchantPayable.rows[0].cents),
    pendingPayouts: money(payouts.rows[0].pending_cents),
    pendingPayoutCount: payouts.rows[0].pending_count,
    currency: "ARS",
    revenueCoverage: "wallet_settlements",
  };
}
