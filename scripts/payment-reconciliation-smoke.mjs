import pg from "pg";
const pool = new pg.Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
    ssl: false,
  }),
  base = process.env.API_URL || "http://127.0.0.1:4000/api",
  marker = `recon-${Date.now()}`;
let token = "",
  intentIds = [],
  webhookId = null,
  caseIds = [],
  requestIds = [];
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
        deviceName: "payment-reconciliation-smoke",
      }),
    })
  ).body.token;
try {
  await pool.query(
    "DELETE FROM payment_reconciliation_cases WHERE external_reference LIKE 'recon-%'",
  );
  await pool.query("DELETE FROM webhook_events WHERE provider_event_id LIKE 'recon-%'");
  await pool.query(
    "DELETE FROM refunds WHERE payment_intent_id IN(SELECT id FROM payment_intents WHERE provider_intent_id LIKE 'recon-%')",
  );
  await pool.query("DELETE FROM payment_intents WHERE provider_intent_id LIKE 'recon-%'");
  const user = (await pool.query("SELECT id FROM users WHERE public_id='usr_customer'")).rows[0];
  for (const fixture of [
    {
      suffix: "stale",
      status: "requires_confirmation",
      amount: 12000,
      captured: 0,
      age: "2 hours",
    },
    { suffix: "capture", status: "authorized", amount: 15000, captured: 5000, age: "1 minute" },
    { suffix: "refund", status: "captured", amount: 10000, captured: 10000, age: "1 minute" },
  ]) {
    const row = (
      await pool.query(
        `INSERT INTO payment_intents(customer_id,provider,provider_intent_id,status,amount_cents,captured_amount_cents,currency,idempotency_key,provider_payload,created_at,updated_at) VALUES($1,'sandbox',$2,$3,$4,$5,'ARS',$6,$7,now()-$8::interval,now()-$8::interval) RETURNING id`,
        [
          user.id,
          `${marker}-${fixture.suffix}`,
          fixture.status,
          fixture.amount,
          fixture.captured,
          `${marker}-${fixture.suffix}`,
          { secretToken: "must-never-leak" },
          fixture.age,
        ],
      )
    ).rows[0];
    intentIds.push(row.id);
  }
  await pool.query(
    "INSERT INTO refunds(payment_intent_id,amount_cents,reason,status) VALUES($1,7000,'fixture','succeeded'),($1,6000,'fixture','succeeded')",
    [intentIds[2]],
  );
  webhookId = (
    await pool.query(
      `INSERT INTO webhook_events(provider,provider_event_id,event_type,payload,signature_valid,processed_at) VALUES('sandbox',$1,'payment.updated',$2,true,now()) RETURNING id`,
      [
        `${marker}-event`,
        { providerIntentId: `${marker}-missing`, secretToken: "must-never-leak" },
      ],
    )
  ).rows[0].id;
  token = await login("cliente@flash.app");
  assert(
    (await call("/admin/payment-reconciliation")).status === 403,
    "customer cannot inspect payment reconciliation",
  );
  token = await login("ops@flash.app");
  const scan = await call("/admin/payment-reconciliation/scan", { method: "POST" });
  requestIds.push(scan.body.requestId);
  if (scan.status !== 200) throw new Error(`scan failed ${scan.status}: ${scan.body.message}`);
  const found =
    scan.body.cases?.filter((entry) => String(entry.externalReference || "").includes(marker)) ||
    [];
  caseIds = found.map((entry) => entry.id);
  assert(
    new Set(found.map((entry) => entry.caseType)).size === 4,
    "scan persists stale, capture, refund and orphan-webhook exceptions",
  );
  assert(
    !JSON.stringify(found).includes("must-never-leak"),
    "reconciliation exposes diagnostic facts without provider payload secrets",
  );
  const stale = found.find((entry) => entry.caseType === "stale_intent");
  await pool.query(
    "UPDATE payment_intents SET status='cancelled',updated_at=now() WHERE provider_intent_id=$1",
    [`${marker}-stale`],
  );
  const resolved = await call(`/admin/payment-reconciliation/${stale.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "resolved",
      resolutionNote: "Verificado y cancelado contra el proveedor sandbox",
    }),
  });
  requestIds.push(resolved.body.requestId);
  assert(
    resolved.body.case?.status === "resolved" && resolved.body.case.resolvedBy === "usr_admin",
    "operations resolves a persisted case with attribution",
  );
  const rescanned = await call("/admin/payment-reconciliation/scan", { method: "POST" });
  assert(
    rescanned.body.cases?.find((entry) => entry.id === stale.id)?.status === "resolved",
    "resolved exception stays closed after the source discrepancy disappears",
  );
  const auditLeak = await pool.query(
    "SELECT count(*)::int count FROM audit_events WHERE request_id=ANY($1) AND after_data::text LIKE '%must-never-leak%'",
    [requestIds],
  );
  assert(auditLeak.rows[0].count === 0, "audit payloads exclude provider secrets");
} finally {
  await pool.query("SELECT set_config('app.audit_maintenance','on',false)");
  if (requestIds.length)
    await pool.query("DELETE FROM audit_events WHERE request_id=ANY($1)", [requestIds]);
  if (caseIds.length)
    await pool.query("DELETE FROM payment_reconciliation_cases WHERE public_id=ANY($1)", [caseIds]);
  if (webhookId) await pool.query("DELETE FROM webhook_events WHERE id=$1", [webhookId]);
  if (intentIds.length) {
    await pool.query("DELETE FROM refunds WHERE payment_intent_id=ANY($1)", [intentIds]);
    await pool.query("DELETE FROM payment_intents WHERE id=ANY($1)", [intentIds]);
  }
  await pool.end();
}
