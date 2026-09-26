import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { deleteLocalProductEvents } from "../server/store-local-preferences.js";
import { waitForHealthy } from "./wait-for-api.mjs";

const port = 4213;
const base = `http://127.0.0.1:${port}/api`;
const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
const api = spawn(process.execPath, ["server/start.js"], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: "test", LOG_LEVEL: "silent", PORT: String(port) },
  stdio: ["ignore", "ignore", "pipe"],
});
api.stderr.on("data", (data) => process.stderr.write(data));

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const call = async (path, { token, method = "GET", body } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  return { response, payload };
};
const login = async (email) =>
  (
    await call("/auth/login", {
      method: "POST",
      body: { email, password: "demo123", deviceName: "analytics-local-smoke" },
    })
  ).payload.token;

try {
  let healthy = false;
  await waitForHealthy(`${base}/health`);

  const customer = await login("cliente@flash.app");
  const admin = await login("ops@flash.app");
  const sessionId = crypto.randomUUID();
  const occurredAt = new Date().toISOString();
  const events = ids.map((id, index) => ({
    id,
    name: ["home_viewed", "checkout_started", "job_created"][index],
    surface: "customer_app",
    sessionId,
    occurredAt,
    properties: { vertical: "food" },
  }));

  const first = await call("/analytics/events", {
    token: customer,
    method: "POST",
    body: { events },
  });
  assert(
    first.response.status === 202 && first.payload.accepted === 3,
    "SQLite no aceptó el lote válido",
  );
  const duplicate = await call("/analytics/events", {
    token: customer,
    method: "POST",
    body: { events },
  });
  assert(
    duplicate.payload.accepted === 0 && duplicate.payload.duplicates === 3,
    "SQLite no deduplicó el lote",
  );
  const pii = await call("/analytics/events", {
    token: customer,
    method: "POST",
    body: {
      events: [
        { ...events[0], id: crypto.randomUUID(), properties: { email: "persona@example.com" } },
      ],
    },
  });
  assert(pii.response.status === 400, "SQLite aceptó una propiedad sensible");
  const forbidden = await call("/operations/product-metrics", { token: customer });
  assert(forbidden.response.status === 403, "Cliente pudo consultar métricas operativas");
  const metrics = await call("/operations/product-metrics?days=7", { token: admin });
  assert(
    metrics.response.ok && metrics.payload.metrics.funnel.checkoutToCreatedPercent >= 0,
    "SQLite no calculó el embudo",
  );
  console.log("ok - analytics local, dedupe, privacidad, RBAC y funnel verificados");
} finally {
  deleteLocalProductEvents(ids);
  api.kill("SIGTERM");
}
