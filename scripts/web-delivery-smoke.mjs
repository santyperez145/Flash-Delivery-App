import { spawn } from "node:child_process";

const port = 4217;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server/start.js"], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: "test", LOG_LEVEL: "silent", PORT: String(port) },
  stdio: ["ignore", "ignore", "pipe"],
});
server.stderr.on("data", (data) => process.stderr.write(data));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); console.log(`ok - ${message}`); };

try {
  let online = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`${origin}/api/health`)).ok) { online = true; break; } } catch {}
    await sleep(200);
  }
  assert(online, "la API de prueba inició");
  const indexResponse = await fetch(origin, { headers: { "Accept-Encoding": "gzip" } });
  const html = await indexResponse.text();
  assert(indexResponse.ok && indexResponse.headers.get("cache-control") === "no-cache", "index.html siempre revalida despliegues");
  const csp = indexResponse.headers.get("content-security-policy") || "";
  assert(csp.includes("default-src 'self'") && csp.includes("object-src 'none'") && csp.includes("frame-ancestors 'none'") && !csp.includes("unsafe-eval"), "CSP bloquea ejecución, objetos y framing no autorizados");
  const assetPath = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
  assert(assetPath, "index.html referencia el entry versionado");
  const assetResponse = await fetch(new URL(assetPath, origin), { headers: { "Accept-Encoding": "gzip" } });
  await assetResponse.arrayBuffer();
  assert(assetResponse.headers.get("content-encoding") === "gzip", "JavaScript productivo se entrega comprimido");
  assert(assetResponse.headers.get("cache-control")?.includes("immutable"), "assets con hash usan cache inmutable anual");
  const invalidMediaResponse = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ email: "cliente@flash.app", password: "demo123" }),
  });
  assert(invalidMediaResponse.status === 415, "mutaciones con payload rechazan tipos de contenido ambiguos");
  const loginResponse = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "cliente@flash.app", password: "demo123", deviceName: "web-delivery-smoke" }),
  });
  const { token, refreshToken } = await loginResponse.json();
  assert(loginResponse.ok && token, "la prueba obtuvo una sesión efímera");
  assert(loginResponse.headers.get("cache-control") === "no-store, private", "login nativo no puede almacenarse en caches");
  const accountResponse = await fetch(`${origin}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert(accountResponse.ok && accountResponse.headers.get("cache-control") === "no-store, private", "respuestas autenticadas son privadas y no almacenables");
  const citiesResponse = await fetch(`${origin}/api/cities`);
  assert(citiesResponse.ok && citiesResponse.headers.get("cache-control")?.startsWith("public"), "catálogo público conserva su política de cache independiente");
  const streamController = new AbortController();
  const streamResponse = await fetch(`${origin}/api/events`, {
    headers: { Authorization: `Bearer ${token}`, "Accept-Encoding": "gzip" },
    signal: streamController.signal,
  });
  assert(streamResponse.ok && !streamResponse.headers.get("content-encoding"), "SSE queda sin compresión ni buffering");
  streamController.abort();
  await fetch(`${origin}/api/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ refreshToken }),
  });
  const webLoginResponse = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Flash-Client": "web" },
    body: JSON.stringify({ email: "cliente@flash.app", password: "demo123", deviceName: "web-cookie-smoke" }),
  });
  const webLogin = await webLoginResponse.json(),
    firstSetCookie = webLoginResponse.headers.get("set-cookie") || "",
    firstCookie = firstSetCookie.split(";")[0];
  assert(webLoginResponse.ok && webLogin.token && !webLogin.refreshToken && firstSetCookie.includes("HttpOnly") && firstSetCookie.includes("SameSite=Strict"), "web recibe refresh token sólo en cookie HttpOnly SameSite");
  assert(webLoginResponse.headers.get("cache-control") === "no-store, private", "login web con cookie no puede almacenarse en caches");
  const crossSiteRefreshResponse = await fetch(`${origin}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Flash-Client": "web", "Sec-Fetch-Site": "cross-site", Cookie: firstCookie },
    body: "{}",
  });
  assert(crossSiteRefreshResponse.status === 403, "refresh web rechaza navegación cross-site antes de usar la cookie");
  const webRefreshResponse = await fetch(`${origin}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Flash-Client": "web", Cookie: firstCookie },
    body: JSON.stringify({ deviceName: "web-cookie-smoke" }),
  });
  const webRefresh = await webRefreshResponse.json(),
    rotatedSetCookie = webRefreshResponse.headers.get("set-cookie") || "",
    rotatedCookie = rotatedSetCookie.split(";")[0];
  assert(webRefreshResponse.ok && webRefresh.token && !webRefresh.refreshToken && rotatedCookie && rotatedCookie !== firstCookie, "cookie web rota sin exponer credencial en JSON");
  assert(webRefreshResponse.headers.get("cache-control") === "no-store, private", "rotación web nunca queda en cache");
  const replayResponse = await fetch(`${origin}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Flash-Client": "web", Cookie: firstCookie },
    body: "{}",
  });
  assert(replayResponse.status === 401, "cookie rotada no puede reutilizarse");
  const webLogoutResponse = await fetch(`${origin}/api/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Flash-Client": "web", Cookie: rotatedCookie },
    body: "{}",
  });
  assert(webLogoutResponse.ok && (webLogoutResponse.headers.get("set-cookie") || "").includes("Expires=Thu, 01 Jan 1970"), "logout web revoca sesión y elimina cookie");
} finally {
  server.kill("SIGTERM");
}
