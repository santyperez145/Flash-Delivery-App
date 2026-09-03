import crypto from "node:crypto";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  ssl: false,
});
const base = process.env.API_URL || "http://127.0.0.1:4000/api",
  marker = `tip-adjustment-${Date.now()}`,
  tipId = `TIP-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
  secondAdminId = `USR-TIP-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
  secondAdminEmail = `${marker}@flash.test`,
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
        deviceName: "tip-adjustment-smoke",
      }),
    })
  ).body.token;

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const fixture = (
      await client.query(
        `SELECT j.id job_id,
          j.customer_id,
          d.id driver_id,
          d.user_id driver_user_id,
          admin.id admin_id,
          admin.password_hash
        FROM jobs j
        JOIN drivers d ON d.id=j.driver_id
        JOIN users admin ON admin.public_id='usr_admin'
        WHERE NOT EXISTS(SELECT 1 FROM service_tips t WHERE t.job_id=j.id)
        LIMIT 1`,
      )
    ).rows[0];
    if (!fixture) throw new Error("No hay servicio asignado disponible para fixture de propina");
    const accounts = await client.query(
        `INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type) VALUES('user',$1,'ARS','wallet'),
          ('user',$2,'ARS','wallet') ON CONFLICT(owner_type,owner_id,currency,account_type) DO UPDATE SET owner_type=excluded.owner_type RETURNING id,
          owner_id`,
        [fixture.customer_id, fixture.driver_user_id],
      ),
      customerAccount = accounts.rows.find(
        (row) => String(row.owner_id) === String(fixture.customer_id),
      ),
      driverAccount = accounts.rows.find(
        (row) => String(row.owner_id) === String(fixture.driver_user_id),
      ),
      transaction = (
        await client.query(
          "INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description,metadata) VALUES($1,'tip',$2,'Fixture ajuste de propina',$3) RETURNING id",
          [marker, fixture.customer_id, { marker }],
        )
      ).rows[0];
    await client.query(
      `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES($1,$2,'debit',10000,'tip',$3,$4),($1,$5,'credit',10000,'tip',$3,$4)`,
      [transaction.id, customerAccount.id, fixture.job_id, { marker }, driverAccount.id],
    );
    await client.query(
      "INSERT INTO service_tips(public_id,job_id,customer_id,driver_id,amount_cents,idempotency_key,ledger_transaction_id) VALUES($1,$2,$3,$4,10000,$5,$6)",
      [
        tipId,
        fixture.job_id,
        fixture.customer_id,
        fixture.driver_id,
        `${marker}-tip`,
        transaction.id,
      ],
    );
    const admin = (
      await client.query(
        "INSERT INTO users(public_id,email,password_hash,name,email_verified_at) VALUES($1,$2,$3,'Revisor Propinas',now()) RETURNING id",
        [secondAdminId, secondAdminEmail, fixture.password_hash],
      )
    ).rows[0];
    await client.query("INSERT INTO user_roles(user_id,role) VALUES($1,'admin')", [admin.id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  token = await login("cliente@flash.app");
  assert(
    (await call("/admin/tip-adjustments")).status === 403,
    "customer cannot read operational tip adjustments",
  );
  token = await login("ops@flash.app");
  const key = `${marker}-request-${crypto.randomUUID()}`,
    requested = await call("/admin/tip-adjustments", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({
        tipId,
        amount: 40,
        reason: "Reclamo confirmado por soporte",
      }),
    }),
    duplicate = await call("/admin/tip-adjustments", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({
        tipId,
        amount: 40,
        reason: "Reclamo confirmado por soporte",
      }),
    });
  auditIds.push(requested.body.requestId, duplicate.body.requestId);
  const adjustment = requested.body.adjustment;
  assert(
    requested.status === 201 && duplicate.body.adjustment?.id === adjustment?.id,
    "request is persisted and idempotent",
  );
  assert(
    (
      await call(`/admin/tip-adjustments/${adjustment.id}/review`, {
        method: "PATCH",
        body: JSON.stringify({
          decision: "approved",
          note: "Intento del solicitante",
        }),
      })
    ).status === 409,
    "requester cannot approve own adjustment",
  );

  const balancesBefore = await pool.query(
    `SELECT a.owner_id,
      COALESCE(sum(
        CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END
      ),0)::bigint balance
    FROM service_tips t
    JOIN drivers d ON d.id=t.driver_id
    JOIN ledger_accounts a
      ON a.owner_type='user' AND a.account_type='wallet'
        AND a.owner_id IN(t.customer_id,d.user_id)
    LEFT JOIN ledger_entries e ON e.account_id=a.id
    WHERE t.public_id=$1 GROUP BY a.owner_id`,
    [tipId],
  );
  token = await login(secondAdminEmail);
  const approved = await call(`/admin/tip-adjustments/${adjustment.id}/review`, {
      method: "PATCH",
      body: JSON.stringify({
        decision: "approved",
        note: "Evidencia de soporte verificada",
      }),
    }),
    approvedAgain = await call(`/admin/tip-adjustments/${adjustment.id}/review`, {
      method: "PATCH",
      body: JSON.stringify({
        decision: "approved",
        note: "Reintento seguro",
      }),
    });
  auditIds.push(approved.body.requestId, approvedAgain.body.requestId);
  assert(
    approved.body.adjustment?.status === "approved" &&
      approvedAgain.body.adjustment?.status === "approved",
    "independent approval is attributed and idempotent",
  );
  const balancesAfter = await pool.query(
      `SELECT a.owner_id,
        COALESCE(sum(
          CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END
        ),0)::bigint balance
      FROM service_tips t
      JOIN drivers d ON d.id=t.driver_id
      JOIN ledger_accounts a
        ON a.owner_type='user' AND a.account_type='wallet'
          AND a.owner_id IN(t.customer_id,d.user_id)
      LEFT JOIN ledger_entries e ON e.account_id=a.id
      WHERE t.public_id=$1 GROUP BY a.owner_id`,
      [tipId],
    ),
    before = new Map(balancesBefore.rows.map((row) => [String(row.owner_id), Number(row.balance)])),
    deltas = balancesAfter.rows
      .map((row) => Number(row.balance) - before.get(String(row.owner_id)))
      .sort((a, b) => a - b);
  assert(
    deltas[0] === -4000 && deltas[1] === 4000,
    "approval transfers the exact amount from driver to customer",
  );

  const concurrent = await Promise.all(
    ["a", "b"].map((suffix) =>
      call("/admin/tip-adjustments", {
        method: "POST",
        headers: {
          "Idempotency-Key": `${marker}-${suffix}-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          tipId,
          amount: 40,
          reason: `Corrección concurrente ${suffix}`,
        }),
      }),
    ),
  );
  concurrent.forEach((result) => auditIds.push(result.body.requestId));
  assert(
    concurrent.filter((result) => result.status === 201).length === 1 &&
      concurrent.filter((result) => result.status === 409).length === 1,
    "concurrent requests cannot exceed original tip",
  );
  const imbalance = await pool.query(
    `SELECT count(*)::int count FROM (SELECT t.id FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id=t.id WHERE (t.idempotency_key=$1 OR t.idempotency_key LIKE 'tip-adjustment-%')
      AND t.metadata->>'tipId'=$2 GROUP BY t.id HAVING sum(CASE WHEN e.direction='debit' THEN e.amount_cents ELSE -e.amount_cents END)<>0) q`,
    [marker, tipId],
  );
  assert(
    imbalance.rows[0].count === 0,
    "original tip and approved correction remain double-entry balanced",
  );
} finally {
  await pool.query("SELECT set_config('app.audit_maintenance','on',false)");
  if (auditIds.filter(Boolean).length)
    await pool.query("DELETE FROM audit_events WHERE request_id=ANY($1)", [
      auditIds.filter(Boolean),
    ]);
  await pool.query(
    `DELETE FROM notifications WHERE deduplication_key IN(
      SELECT 'tip-adjustment:'||a.public_id||':customer' FROM service_tip_adjustments a JOIN service_tips t ON t.id=a.tip_id WHERE t.public_id=$1
      UNION ALL SELECT 'tip-adjustment:'||a.public_id||':driver' FROM service_tip_adjustments a JOIN service_tips t ON t.id=a.tip_id WHERE t.public_id=$1)`,
    [tipId],
  );
  await pool.query(
    "DELETE FROM realtime_events WHERE entity_id IN(SELECT j.public_id FROM service_tips t JOIN jobs j ON j.id=t.job_id WHERE t.public_id=$1)",
    [tipId],
  );
  const txs = (
    await pool.query(
      "SELECT ledger_transaction_id FROM service_tip_adjustments WHERE tip_id=(SELECT id FROM service_tips WHERE public_id=$1) AND ledger_transaction_id IS NOT NULL",
      [tipId],
    )
  ).rows.map((row) => row.ledger_transaction_id);
  await pool.query(
    "DELETE FROM service_tip_adjustments WHERE tip_id=(SELECT id FROM service_tips WHERE public_id=$1)",
    [tipId],
  );
  if (txs.length) {
    await pool.query("DELETE FROM ledger_entries WHERE transaction_id=ANY($1)", [txs]);
    await pool.query("DELETE FROM ledger_transactions WHERE id=ANY($1)", [txs]);
  }
  await pool.query("DELETE FROM service_tips WHERE public_id=$1", [tipId]);
  await pool.query(
    "DELETE FROM ledger_entries WHERE transaction_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)",
    [marker],
  );
  await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key=$1", [marker]);
  await pool.query(
    "DELETE FROM refresh_sessions WHERE user_id=(SELECT id FROM users WHERE public_id=$1)",
    [secondAdminId],
  );
  await pool.query(
    "DELETE FROM user_roles WHERE user_id=(SELECT id FROM users WHERE public_id=$1)",
    [secondAdminId],
  );
  await pool.query("DELETE FROM users WHERE public_id=$1", [secondAdminId]);
  await pool.end();
}
