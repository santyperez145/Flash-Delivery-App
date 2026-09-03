import crypto from "node:crypto";
import pg from "pg";
const pool = new pg.Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
    ssl: false,
  }),
  base = process.env.API_URL || "http://127.0.0.1:4000/api",
  marker = `risk-${Date.now()}`,
  intentIds = [];
let token = "",
  assessmentId = null,
  originalPricing = null,
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
      body: JSON.stringify({ email, password: "demo123", deviceName: "risk-smoke" }),
    })
  ).body.token;
try {
  const user = (await pool.query("SELECT id FROM users WHERE public_id='usr_customer'")).rows[0],
    jobsBefore = Number(
      (await pool.query("SELECT count(*)::int count FROM jobs WHERE customer_id=$1", [user.id]))
        .rows[0].count,
    );
  for (let index = 0; index < 3; index++)
    intentIds.push(
      (
        await pool.query(
          `INSERT INTO payment_intents(customer_id,provider,provider_intent_id,status,amount_cents,currency,idempotency_key,failure_code) VALUES($1,'sandbox',$2,'failed',10000,'ARS',$3,'declined')
            RETURNING id`,
          [user.id, `${marker}-${index}`, `${marker}-${index}`],
        )
      ).rows[0].id,
    );
  originalPricing = (
    await pool.query("SELECT config FROM pricing_plans WHERE service='ride' AND active")
  ).rows[0].config;
  await pool.query(
    "UPDATE pricing_plans SET config=jsonb_set(config,'{baseFare}','600000'::jsonb) WHERE service='ride' AND active",
  );
  token = await login("cliente@flash.app");
  const quote = await call("/rides/quote", {
      method: "POST",
      body: JSON.stringify({
        pickup: "Defensa 982, San Telmo",
        destination: "Aeroparque Jorge Newbery",
        service: "economy",
        pickupCoords: { lat: -34.6177, lng: -58.3621 },
        destinationCoords: { lat: -34.5596, lng: -58.4156 },
      }),
    }),
    key = `${marker}-${crypto.randomUUID()}`,
    payload = {
      customerId: "usr_customer",
      pickup: "Defensa 982, San Telmo",
      destination: "Aeroparque Jorge Newbery",
      service: "economy",
      pickupCoords: { lat: -34.6177, lng: -58.3621 },
      destinationCoords: { lat: -34.5596, lng: -58.4156 },
      paymentMethod: "Flash Wallet",
      quoteToken: quote.body.quote?.quoteToken,
    };
  const blocked = await call("/rides", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify(payload),
    }),
    retry = await call("/rides", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify(payload),
    });
  requestIds.push(blocked.body.requestId, retry.body.requestId);
  const stored = await pool.query(
    "SELECT public_id,score,decision,rules,entity_public_id FROM transaction_risk_assessments WHERE idempotency_key=$1",
    [key],
  );
  assessmentId = stored.rows[0]?.public_id;
  const blockProof =
    quote.body.quote?.fare >= 500000 &&
    blocked.status === 403 &&
    retry.status === 403 &&
    stored.rowCount === 1 &&
    stored.rows[0].decision === "block" &&
    !stored.rows[0].entity_public_id;
  if (!blockProof)
    console.log(
      JSON.stringify({ fare: quote.body.quote?.fare, blocked, retry, stored: stored.rows }),
    );
  assert(blockProof, "critical score blocks before job or charge and retry is idempotent");
  assert(
    stored.rows[0].rules.some((rule) => rule.code === "high_amount") &&
      stored.rows[0].rules.some((rule) => rule.code === "payment_failures"),
    "risk decision is explained by live amount and payment-failure facts",
  );
  assert(
    Number(
      (await pool.query("SELECT count(*)::int count FROM jobs WHERE customer_id=$1", [user.id]))
        .rows[0].count,
    ) === jobsBefore,
    "blocked transaction creates no mobility job",
  );
  assert(
    (await call("/admin/transaction-risks")).status === 403,
    "customer cannot inspect internal risk rules",
  );
  token = await login("ops@flash.app");
  const listed = await call("/admin/transaction-risks"),
    reviewed = await call(`/admin/transaction-risks/${assessmentId}`, {
      method: "PATCH",
      body: JSON.stringify({
        reviewStatus: "confirmed_fraud",
        reviewNote: "Intentos fallidos y monto crítico confirmados",
      }),
    });
  requestIds.push(reviewed.body.requestId);
  assert(
    listed.body.assessments?.some((entry) => entry.id === assessmentId) &&
      reviewed.body.assessment?.reviewStatus === "confirmed_fraud" &&
      reviewed.body.assessment.reviewedBy === "usr_admin",
    "operations reviews an attributed explainable assessment",
  );
  const auditRules = await pool.query(
    "SELECT count(*)::int count FROM audit_events WHERE request_id=ANY($1) AND after_data::text LIKE '%payment_failures%'",
    [requestIds.filter(Boolean)],
  );
  assert(auditRules.rows[0].count === 0, "audit records outcome without disclosing fraud rules");
} finally {
  if (originalPricing)
    await pool.query("UPDATE pricing_plans SET config=$1 WHERE service='ride' AND active", [
      originalPricing,
    ]);
  await pool.query("SELECT set_config('app.audit_maintenance','on',false)");
  if (requestIds.filter(Boolean).length)
    await pool.query("DELETE FROM audit_events WHERE request_id=ANY($1)", [
      requestIds.filter(Boolean),
    ]);
  if (assessmentId)
    await pool.query("DELETE FROM transaction_risk_assessments WHERE public_id=$1", [assessmentId]);
  if (intentIds.length)
    await pool.query("DELETE FROM payment_intents WHERE id=ANY($1)", [intentIds]);
  await pool.end();
}
