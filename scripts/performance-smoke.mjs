import { performance } from "node:perf_hooks";

const apiBase = process.env.API_URL || "http://127.0.0.1:4000/api";
const iterations = Number(process.env.PERFORMANCE_ITERATIONS || 30),
  concurrency = Number(process.env.PERFORMANCE_CONCURRENCY || 10),
  maxP95 = Number(process.env.PERFORMANCE_MAX_P95_MS || 500);
const login = await fetch(`${apiBase}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: process.env.PERFORMANCE_EMAIL || "cliente@flash.app",
    password: process.env.PERFORMANCE_PASSWORD || "demo123",
    deviceName: "performance-smoke",
  }),
});
if (!login.ok) throw new Error(`performance login failed: ${login.status}`);
const { token } = await login.json(),
  headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const scenarios = [
  { name: "ready", path: "/ready", method: "GET", auth: false },
  { name: "catalog", path: "/restaurants", method: "GET", auth: false },
  { name: "customer_state", path: "/state", method: "GET", auth: true },
  { name: "catalog_search", path: "/catalog/search?q=pizza&limit=20", method: "GET", auth: true },
  {
    name: "ride_quote",
    path: "/rides/quote",
    method: "POST",
    auth: true,
    body: {
      pickup: "Defensa 982",
      destination: "Aeroparque",
      service: "economy",
      pickupCoords: { lat: -34.6177, lng: -58.3621 },
      destinationCoords: { lat: -34.5596, lng: -58.4156 },
    },
  },
  {
    name: "shipment_quote",
    path: "/shipments/quote",
    method: "POST",
    auth: true,
    body: {
      pickup: "Defensa 982",
      destination: "Aeroparque",
      packageSize: "small",
      weightKg: 2,
      pickupCoords: { lat: -34.6177, lng: -58.3621 },
      destinationCoords: { lat: -34.5596, lng: -58.4156 },
    },
  },
];
const percentile = (values, p) =>
  values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];
const runOne = async (scenario) => {
  const started = performance.now(),
    response = await fetch(`${apiBase}${scenario.path}`, {
      method: scenario.method,
      headers: scenario.auth ? headers : { "content-type": "application/json" },
      body: scenario.body ? JSON.stringify(scenario.body) : undefined,
    });
  await response.arrayBuffer();
  return { ms: performance.now() - started, status: response.status };
};
const results = [];
for (const scenario of scenarios) {
  await runOne(scenario);
  const samples = [];
  for (let offset = 0; offset < iterations; offset += concurrency) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(concurrency, iterations - offset) }, () => runOne(scenario)),
    );
    samples.push(...batch);
  }
  const times = samples.map((sample) => sample.ms).sort((a, b) => a - b),
    errors = samples.filter((sample) => sample.status < 200 || sample.status >= 300);
  const result = {
    scenario: scenario.name,
    requests: samples.length,
    errors: errors.length,
    minMs: Number(times[0].toFixed(2)),
    medianMs: Number(percentile(times, 0.5).toFixed(2)),
    p95Ms: Number(percentile(times, 0.95).toFixed(2)),
    maxMs: Number(times.at(-1).toFixed(2)),
  };
  results.push(result);
  if (errors.length)
    throw new Error(
      `${scenario.name} returned ${errors.length} errors: ${[...new Set(errors.map((entry) => entry.status))].join(",")}`,
    );
  if (result.p95Ms > maxP95)
    throw new Error(`${scenario.name} p95 ${result.p95Ms}ms exceeds ${maxP95}ms`);
}
console.table(results);
console.log(JSON.stringify({ ok: true, thresholdP95Ms: maxP95, iterations, concurrency, results }));
