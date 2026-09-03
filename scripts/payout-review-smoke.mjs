import crypto from "node:crypto";
import pg from "pg";
const pool = new pg.Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
    ssl: false,
  }),
  base = process.env.API_URL || "http://127.0.0.1:4000/api",
  marker = `payout-review-${Date.now()}`,
  payoutKeys = [],
  auditIds = [];
let token = "";
const assert = (value, label) => {
  if (!value) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
const call = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  let body = {};
  try {
    body = await response.json();
  } catch {}
  return { status: response.status, body };
};
const login = async (email) =>
  (
    await call("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email,
        password: "demo123",
        deviceName: "payout-review-smoke",
      }),
    })
  ).body.token;
const authorize = async (amount) =>
  (
    await call("/merchant/payouts/authorize", {
      method: "POST",
      body: JSON.stringify({ merchantId: "rest_roja", amount, password: "demo123" }),
    })
  ).body.authorizationToken;
try {
  const fixture = await pool.connect();
  try {
    await fixture.query("BEGIN");
    const ids = (
        await fixture.query(
          `SELECT m.id merchant_id,u.id actor_id FROM merchants m JOIN users u ON u.id=m.owner_id WHERE m.public_id='rest_roja'`,
        )
      ).rows[0],
      payable = (
        await fixture.query(
          `INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type) VALUES('merchant',$1,'ARS','payable') ON CONFLICT(owner_type,owner_id,currency,account_type) DO UPDATE SET ,
            owner_type=excluded.owner_type RETURNING id`,
          [ids.merchant_id],
        )
      ).rows[0].id,
      clearing = (
        await fixture.query(
          `INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type) VALUES('platform',NULL,'ARS','cash_clearing') ON CONFLICT(owner_type,currency,account_type) WHERE owner_id IS NULL ,
            DO UPDATE SET owner_type=excluded.owner_type RETURNING id`,
        )
      ).rows[0].id,
      transaction = (
        await fixture.query(
          `INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description) VALUES($1,'adjustment',$2,'Fixture payout review') RETURNING id`,
          [marker, ids.actor_id],
        )
      ).rows[0].id;
    await fixture.query(
      `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,metadata) VALUES($1,$2,'debit',10000,'payout_test',$4),($1,$3,'credit',10000,'payout_test',$4)`,
      [transaction, clearing, payable, { marker }],
    );
    await fixture.query("COMMIT");
  } catch (error) {
    await fixture.query("ROLLBACK");
    throw error;
  } finally {
    fixture.release();
  }
  token = await login("comercio@flash.app");
  const before = (await call("/merchant/finance?merchantId=rest_roja")).body.finance
      .availableBalance,
    keyRejected = `${marker}-reject-${crypto.randomUUID()}`;
  payoutKeys.push(keyRejected);
  const rejectedAuthorization = await authorize(40);
  const requested = await call("/merchant/payouts", {
      method: "POST",
      headers: { "Idempotency-Key": keyRejected },
      body: JSON.stringify({
        merchantId: "rest_roja",
        amount: 40,
        authorizationToken: rejectedAuthorization,
      }),
    }),
    rejectedId = requested.body.finance?.payouts?.find(
      (entry) => entry.amount === 40 && entry.status === "pending",
    )?.id;
  assert(
    requested.status === 201 &&
      rejectedId &&
      requested.body.finance.availableBalance === before - 40,
    "merchant request reserves payable balance and stays pending review",
  );
  assert(
    (await call("/admin/payouts")).status === 403,
    "merchant cannot access independent payout approval",
  );
  token = await login("ops@flash.app");
  const queue = await call("/admin/payouts"),
    rejected = await call(`/admin/payouts/${rejectedId}/review`, {
      method: "PATCH",
      body: JSON.stringify({
        decision: "rejected",
        note: "Datos bancarios requieren corrección",
      }),
    }),
    rejectedAgain = await call(`/admin/payouts/${rejectedId}/review`, {
      method: "PATCH",
      body: JSON.stringify({
        decision: "rejected",
        note: "Reintento idempotente",
      }),
    });
  auditIds.push(rejected.body.requestId);
  assert(
    queue.body.payouts?.some((entry) => entry.id === rejectedId) &&
      rejected.body.payout?.status === "cancelled" &&
      rejectedAgain.body.payout?.status === "cancelled",
    "admin rejection is attributed and idempotent",
  );
  token = await login("comercio@flash.app");
  const afterReject = (await call("/merchant/finance?merchantId=rest_roja")).body.finance
    .availableBalance;
  assert(afterReject === before, "rejection releases the exact reserved balance");
  const keyApproved = `${marker}-approve-${crypto.randomUUID()}`;
  payoutKeys.push(keyApproved);
  const approvedAuthorization = await authorize(30);
  const requestedApproved = await call("/merchant/payouts", {
      method: "POST",
      headers: { "Idempotency-Key": keyApproved },
      body: JSON.stringify({
        merchantId: "rest_roja",
        amount: 30,
        authorizationToken: approvedAuthorization,
      }),
    }),
    approvedId = requestedApproved.body.finance?.payouts?.find(
      (entry) => entry.amount === 30 && entry.status === "pending",
    )?.id;
  token = await login("ops@flash.app");
  const approved = await call(`/admin/payouts/${approvedId}/review`, {
    method: "PATCH",
    body: JSON.stringify({
      decision: "approved",
      note: "Titularidad y saldo verificados",
    }),
  });
  auditIds.push(approved.body.requestId);
  assert(
    approved.body.payout?.status === "processing" &&
      approved.body.payout.reviewDecision === "approved" &&
      !approved.body.payout.providerPayoutId,
    "approval moves to processing without fabricating provider settlement",
  );
  const imbalance = await pool.query(
    `SELECT count(*)::int count FROM (SELECT t.id FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id=t.id WHERE t.idempotency_key=$1 OR t.idempotency_key LIKE $2 GROUP BY t.id ,
      HAVING sum(CASE WHEN e.direction='debit' THEN e.amount_cents ELSE -e.amount_cents END)<>0) q`,
    [marker, `payout-%-${marker}%`],
  );
  assert(
    imbalance.rows[0].count === 0,
    "fixture, reservation and release ledger transactions remain balanced",
  );
} finally {
  await pool.query("SELECT set_config('app.audit_maintenance','on',false)");
  if (auditIds.length)
    await pool.query("DELETE FROM audit_events WHERE request_id=ANY($1)", [auditIds]);
  for (const key of payoutKeys) {
    const payout = (
      await pool.query("SELECT id,public_id FROM payouts WHERE idempotency_key=$1", [key])
    ).rows[0];
    for (const transactionKey of [`payout-release-${payout?.public_id}`, `payout-reserve-${key}`]) {
      await pool.query(
        "DELETE FROM ledger_entries WHERE transaction_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)",
        [transactionKey],
      );
      await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key=$1", [
        transactionKey,
      ]);
    }
    await pool.query("DELETE FROM payouts WHERE idempotency_key=$1", [key]);
  }
  await pool.query(
    "DELETE FROM ledger_entries WHERE transaction_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)",
    [marker],
  );
  await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key=$1", [marker]);
  await pool.end();
}
