import { spawn } from "node:child_process";

const port = 4218;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server/start.js"], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: "test", LOG_LEVEL: "silent", PORT: String(port) },
  stdio: ["ignore", "ignore", "pipe"],
});
server.stderr.on("data", (data) => process.stderr.write(data));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); console.log(`ok - ${message}`); };

function collectRefs(value, refs = []) {
  if (!value || typeof value !== "object") return refs;
  if (typeof value.$ref === "string") refs.push(value.$ref);
  for (const nested of Object.values(value)) collectRefs(nested, refs);
  return refs;
}

try {
  let online = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`${origin}/api/health`)).ok) { online = true; break; } } catch {}
    await sleep(200);
  }
  assert(online, "la API de contrato inició");
  const specResponse = await fetch(`${origin}/api/openapi.json`);
  const spec = await specResponse.json();
  assert(specResponse.ok && spec.openapi === "3.1.0" && spec.info?.title === "Flash Platform API", "OpenAPI 3.1 está publicado y versionado");
  assert(specResponse.headers.get("cache-control")?.includes("stale-while-revalidate"), "el contrato permite revalidación controlada");

  const operations = Object.values(spec.paths).flatMap((path) => Object.values(path)).filter((operation) => operation?.operationId);
  const operationIds = operations.map((operation) => operation.operationId);
  assert(operationIds.length === new Set(operationIds).size && operationIds.length >= 30, "operationId es único en los dominios documentados");
  const refs = collectRefs(spec);
  const unresolvedRefs = refs.filter((ref) => !ref.startsWith("#/components/schemas/") || !spec.components.schemas[ref.split("/").at(-1)]);
  assert(unresolvedRefs.length === 0, `${new Set(refs).size} referencias internas están resueltas`);

  const healthResponse = await fetch(`${origin}/api/health`);
  const health = await healthResponse.json();
  assert(healthResponse.status === 200 && health.ok === true && health.requestId && health.service === "flash-fullstack-api" && health.timestamp, "health cumple su respuesta documentada");
  const citiesResponse = await fetch(`${origin}/api/cities`);
  const cities = await citiesResponse.json();
  assert(citiesResponse.status === 200 && cities.ok === true && cities.cities?.every((city) => city.id && city.slug && city.center && city.currency), "cities cumple su respuesta documentada");
  const invalidLogin = await fetch(`${origin}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "cliente@flash.app", password: "demo123", deviceName: "x".repeat(161) }),
  });
  assert(invalidLogin.status === 400 && spec.paths["/api/auth/login"].post.responses[400], "login valida el límite documentado de deviceName");
  const anonymousSessions = await fetch(`${origin}/api/me/sessions`);
  assert(anonymousSessions.status === 401 && spec.paths["/api/me/sessions"].get.responses[401], "sesiones exige el bearer documentado");
  const routeInput = { pickup: "Defensa 982, Buenos Aires", destination: "Av. Santa Fe 1800, Buenos Aires", pickupCoords: { lat: -34.6177, lng: -58.3621 }, destinationCoords: { lat: -34.595, lng: -58.392 } };
  const rideOptionsResponse = await fetch(`${origin}/api/rides/options`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(routeInput) });
  const rideOptions = await rideOptionsResponse.json();
  assert(rideOptionsResponse.status === 200 && rideOptions.options?.length === 4 && rideOptions.options.every((option) => option.quoteId && option.quoteToken && option.expiresAt), "opciones de viaje entregan cotizaciones firmadas documentadas");
  const shipmentQuoteResponse = await fetch(`${origin}/api/shipments/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...routeInput, packageSize: "small", weightKg: 1, declaredValue: 0, protection: "none" }) });
  const shipmentQuote = await shipmentQuoteResponse.json();
  assert(shipmentQuoteResponse.status === 200 && shipmentQuote.quote?.quoteId && shipmentQuote.quote?.quoteToken && shipmentQuote.quote?.expiresAt, "envíos entrega una cotización firmada documentada");
  const anonymousOrder = await fetch(`${origin}/api/orders`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "contract-order-0001" }, body: "{}" });
  assert(anonymousOrder.status === 401 && spec.paths["/api/orders"].post.security, "creación de pedidos exige bearer antes de procesar payload");
  const anonymousReceipt = await fetch(`${origin}/api/jobs/ORD-CONTRACT/receipt`);
  assert(anonymousReceipt.status === 401 && spec.paths["/api/jobs/{jobId}/receipt"].get.security, "comprobantes exigen identidad antes de consultar ownership");
  const anonymousTrackingLink = await fetch(`${origin}/api/rides/RIDE-CONTRACT/tracking-links`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ttlMinutes: 120 }) });
  assert(anonymousTrackingLink.status === 401 && spec.paths["/api/rides/{rideId}/tracking-links"].post.security, "crear enlaces de seguimiento exige identidad");
  assert(spec.components.schemas.MerchantPaymentConnection.properties.status.enum.includes("reconnect_required"), "contrato publica el estado operativo de reconexión PSP");
  const anonymousOffers=await fetch(`${origin}/api/driver/offers`),anonymousTickets=await fetch(`${origin}/api/support/tickets`);
  assert(anonymousOffers.status===401&&spec.paths["/api/driver/offers"].get.security,"ofertas privadas exigen identidad driver");
  assert(anonymousTickets.status===401&&spec.paths["/api/support/tickets"].get.security,"soporte exige identidad antes de resolver visibilidad");
  assert(spec.components.schemas.SupportMessageRequest.properties.internal.description.includes("support/admin"),"contrato distingue notas internas por rol");
  const serializedSpec=JSON.stringify(spec).toLowerCase();
  assert(!serializedSpec.includes('"pan"')&&!serializedSpec.includes('"cvv"')&&!serializedSpec.includes('access_token_ciphertext')&&!serializedSpec.includes('refresh_token_ciphertext'), "contrato no modela datos de tarjeta ni credenciales seller");
} finally {
  server.kill("SIGTERM");
}
