import { spawn } from "node:child_process";
import pg from "pg";
import { waitForHealthy } from "./wait-for-api.mjs";

const port = 4223,
  base = `http://127.0.0.1:${port}/api`,
  stamp = Date.now(),
  prefix = `MERCHANT-DASH-${stamp}`;
const pool = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  ssl: false,
});
const requestIds = [];
let originalMerchantState = null;
const server = spawn(process.execPath, ["server/start.js"], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: "test", LOG_LEVEL: "silent", PORT: String(port) },
  stdio: ["ignore", "ignore", "pipe"],
});
server.stderr.on("data", (data) => process.stderr.write(data));
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const assert = (value, label) => {
  if (!value) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
const call = async (path, { token, ...options } = {}) => {
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
  if (body.requestId) requestIds.push(body.requestId);
  return { status: response.status, body, headers: response.headers };
};
const login = async (email) =>
  (
    await call("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: "demo123", deviceName: "merchant-dashboard-smoke" }),
    })
  ).body.token;

try {
  let ready = false;
  await waitForHealthy(`${base}/health`);
  const merchantToken = await login("comercio@flash.app"),
    customerToken = await login("cliente@flash.app"),
    adminToken = await login("ops@flash.app");
  assert(
    Boolean(merchantToken && customerToken && adminToken),
    "merchant, customer and admin fixtures authenticate",
  );
  const context = (
    await pool.query(`SELECT m.id merchant_id,b.id branch_id,b.public_id branch_public_id,b.eta_min,u.id customer_id
    FROM merchants m JOIN merchant_branches b ON b.merchant_id=m.id AND b.is_primary
    CROSS JOIN users u WHERE m.public_id='rest_roja' AND u.public_id='usr_customer'`)
  ).rows[0];
  const baseline = (
    await pool.query(
      `SELECT
    count(*) FILTER(WHERE status='completed' AND EXISTS(SELECT 1 FROM job_events e WHERE e.job_id=jobs.id AND e.status='completed' AND e.occurred_at>=date_trunc('day',now() AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'America/Argentina/Buenos_Aires'))::int completed,
    COALESCE(sum(COALESCE(final_amount_cents,quoted_amount_cents)) FILTER(WHERE status='completed' AND EXISTS(SELECT 1 FROM job_events e WHERE e.job_id=jobs.id AND e.status='completed' AND e.occurred_at>=date_trunc('day',now() AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'America/Argentina/Buenos_Aires')),0)::bigint sales
    FROM jobs WHERE merchant_id=$1 AND kind='delivery' AND metadata->>'subtype'='food_order'`,
      [context.merchant_id],
    )
  ).rows[0];
  const inserted = await pool.query(
    `INSERT INTO jobs(public_id,kind,customer_id,merchant_id,branch_id,status,pickup_address,pickup_location,dropoff_address,dropoff_location,service_level,quoted_amount_cents,final_amount_cents,distance_m,estimated_duration_s,metadata,merchant_prep_minutes,merchant_ready_due_at)
    SELECT $1||'-LATE','delivery'::job_kind,$2::uuid,$3::uuid,$4::uuid,'accepted'::job_status,b.address,b.location,'Destino',b.location,'food',250000,250000,1000,1800,'{"subtype":"food_order"}'::jsonb,10::smallint,now()-interval '1 minute' FROM merchant_branches b WHERE b.id=$4::uuid
    UNION ALL SELECT $1||'-DONE','delivery'::job_kind,$2::uuid,$3::uuid,$4::uuid,'completed'::job_status,b.address,b.location,'Destino',b.location,'food',320000,320000,1000,1800,'{"subtype":"food_order"}'::jsonb,15::smallint,now()-interval '5 minutes' FROM merchant_branches b WHERE b.id=$4::uuid
    UNION ALL SELECT $1||'-CANCEL','delivery'::job_kind,$2::uuid,$3::uuid,$4::uuid,'cancelled'::job_status,b.address,b.location,'Destino',b.location,'food',180000,180000,1000,1800,'{"subtype":"food_order"}'::jsonb,15::smallint,now()-interval '5 minutes' FROM merchant_branches b WHERE b.id=$4::uuid RETURNING id,status`,
    [prefix, context.customer_id, context.merchant_id, context.branch_id],
  );
  for (const job of inserted.rows)
    await pool.query("INSERT INTO job_events(job_id,status) VALUES($1,$2)", [job.id, job.status]);

  assert(
    (await call("/merchant/dashboard")).status === 401,
    "anonymous cannot inspect merchant operations",
  );
  assert(
    (await call("/merchant/dashboard", { token: customerToken })).status === 403,
    "customer cannot inspect merchant operations",
  );
  assert(
    (await call("/merchant/orders/active?restaurantId=rest_roja")).status === 401,
    "anonymous cannot inspect the merchant order queue",
  );
  assert(
    (await call("/merchant/orders/active?restaurantId=rest_roja", { token: customerToken }))
      .status === 403,
    "customer cannot inspect the merchant order queue",
  );
  assert(
    (await call("/merchant/orders/active", { token: merchantToken })).status === 400,
    "merchant queue requires explicit commerce selection",
  );
  const response = await call("/merchant/dashboard?restaurantId=rest_roja", {
      token: merchantToken,
    }),
    dashboard = response.body.dashboard;
  assert(
    response.status === 200,
    `owner receives the operations snapshot (HTTP ${response.status}${response.body.message ? `: ${response.body.message}` : ""})`,
  );
  assert(
    response.headers.get("cache-control")?.includes("no-store"),
    "owner snapshot is private no-store",
  );
  assert(
    dashboard?.source === "postgres-live-operations",
    `owner snapshot is PostgreSQL-backed (${dashboard?.source || "missing"})`,
  );
  assert(
    dashboard.restaurantId === "rest_roja",
    `owner snapshot is ownership scoped (${dashboard.restaurantId})`,
  );
  assert(
    (await call("/merchant/dashboard?restaurantId=rest_ajeno", { token: merchantToken })).status ===
      404,
    "merchant selection never fabricates an unknown operation",
  );
  assert(
    dashboard.timezone === "America/Argentina/Buenos_Aires" &&
      dashboard.branch.timezone === dashboard.timezone,
    "daily cutoff and branch expose the authoritative local timezone",
  );
  assert(
    dashboard.metrics.completedToday === Number(baseline.completed) + 1 &&
      dashboard.metrics.grossSalesToday === Number(baseline.sales) / 100 + 3200,
    "today sales count only terminal events inside the local day",
  );
  assert(
    dashboard.metrics.lateOrders >= 1 &&
      dashboard.metrics.needsAction >= 1 &&
      dashboard.metrics.activeOrders >= 1,
    "live queue exposes actionable and overdue preparation from persisted deadlines",
  );
  assert(
    Number.isInteger(dashboard.metrics.untrackedPrepOrders) &&
      dashboard.metrics.untrackedPrepOrders >= 0,
    "legacy prep gaps remain explicit rather than guessed",
  );
  const activeQueue = await call("/merchant/orders/active?restaurantId=rest_roja&limit=100", {
      token: merchantToken,
    }),
    activeIds = activeQueue.body.orders?.map((order) => order.id) || [];
  assert(
    activeQueue.status === 200 &&
      activeQueue.headers.get("cache-control")?.includes("no-store") &&
      activeQueue.body.source === "postgres-live-operations" &&
      typeof activeQueue.body.hasMore === "boolean",
    "merchant receives a private bounded PostgreSQL active queue",
  );
  assert(
    activeIds.includes(`${prefix}-LATE`) &&
      !activeIds.includes(`${prefix}-DONE`) &&
      !activeIds.includes(`${prefix}-CANCEL`),
    "active queue includes actionable work and excludes terminal history",
  );
  assert(
    activeQueue.body.orders.find((order) => order.id === `${prefix}-LATE`)?.branchId ===
      context.branch_public_id,
    "active queue identifies the persisted order branch for scoped inventory actions",
  );
  assert(
    (await call("/merchant/orders/active?restaurantId=rest_ajeno", { token: merchantToken }))
      .status === 404,
    "active queue never fabricates an unknown commerce",
  );
  originalMerchantState = { open: dashboard.branch.manualOpen, etaMin: dashboard.branch.etaMin };
  const targetOpen = !originalMerchantState.open,
    targetEta = originalMerchantState.etaMin + 5;
  const update = await call("/restaurants/rest_roja", {
    token: merchantToken,
    method: "PATCH",
    body: JSON.stringify({ open: targetOpen, etaMin: targetEta }),
  });
  const refreshed = (
    await call("/merchant/dashboard?restaurantId=rest_roja", { token: merchantToken })
  ).body.dashboard;
  const primaryBranch = update.body.restaurant?.branches?.find((branch) => branch.isPrimary);
  assert(update.status === 200, "merchant owner can update aggregate availability and ETA");
  assert(
    primaryBranch?.manualOpen === targetOpen && Number(primaryBranch?.etaMin) === targetEta,
    "aggregate mutation returns the updated primary branch",
  );
  assert(
    refreshed.branch.manualOpen === targetOpen && refreshed.branch.etaMin === targetEta,
    "availability and ETA reach the authoritative dashboard atomically",
  );
  await call("/restaurants/rest_roja", {
    token: merchantToken,
    method: "PATCH",
    body: JSON.stringify(originalMerchantState),
  });
  const admin = await call("/merchant/dashboard?restaurantId=rest_roja", { token: adminToken });
  assert(
    admin.status === 200 && admin.body.dashboard.restaurantId === "rest_roja",
    "admin selection is explicit and authorized",
  );
  const missing = await call("/merchant/dashboard?restaurantId=missing", { token: adminToken });
  assert(
    missing.status === 404,
    "admin cannot receive a fabricated dashboard for an unknown merchant",
  );
} finally {
  server.kill("SIGTERM");
  if (originalMerchantState) {
    await pool.query("UPDATE merchants SET open=$2,eta_min=$3 WHERE public_id=$1", [
      "rest_roja",
      originalMerchantState.open,
      originalMerchantState.etaMin,
    ]);
    await pool.query(
      "UPDATE merchant_branches b SET open=$2,eta_min=$3,updated_at=now() FROM merchants m WHERE b.merchant_id=m.id AND b.is_primary AND m.public_id=$1",
      ["rest_roja", originalMerchantState.open, originalMerchantState.etaMin],
    );
  }
  await pool.query("SELECT set_config('app.audit_maintenance','on',false)");
  await pool.query("DELETE FROM jobs WHERE public_id LIKE $1", [`${prefix}%`]);
  if (requestIds.length)
    await pool.query("DELETE FROM audit_events WHERE request_id=ANY($1)", [requestIds]);
  await pool.end();
}
