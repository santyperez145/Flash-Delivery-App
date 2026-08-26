import { createPool } from "./db-client.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { waitForHealthy } from "./wait-for-api.mjs";

const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const selected = typeof address === "object" && address ? address.port : null;
    server.close((error) => (error ? reject(error) : resolve(selected)));
  });
});
if (!port) throw new Error("No se pudo reservar un puerto para auth audience smoke");
const base = `http://127.0.0.1:${port}/api`;
const pool = createPool();
const api = spawn(process.execPath, ["server/start.js"], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: "test", LOG_LEVEL: "silent", PORT: String(port) },
  stdio: ["ignore", "ignore", "pipe"],
});
api.stderr.on("data", (data) => process.stderr.write(data));
const marker = `auth-audience-${Date.now()}`;
const email = "comercio@flash.app";
const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
const call = async (path, body) => {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

try {
  await waitForHealthy(`${base}/health`);
  const wrong = await call("/auth/login", {
    email,
    password: "demo123",
    deviceName: marker,
    audience: "customer",
  });
  assert(
    wrong.status === 403 && !wrong.body.token && !wrong.body.refreshToken,
    "la variante incorrecta se rechaza sin credenciales",
  );
  const orphanCount = Number(
    (
      await pool.query("SELECT count(*) AS count FROM refresh_sessions WHERE device_name=$1", [
        marker,
      ])
    ).rows[0].count,
  );
  assert(orphanCount === 0, "la variante incorrecta no crea una sesión huérfana");

  const valid = await call("/auth/login", {
    email,
    password: "demo123",
    deviceName: marker,
    audience: "merchant",
  });
  assert(
    valid.status === 200 && valid.body.refreshToken && valid.body.user?.roles?.includes("merchant"),
    "la variante autorizada conserva el login real",
  );
  await call("/auth/logout", { refreshToken: valid.body.refreshToken });
  const session = (
    await pool.query(
      "SELECT revoked_at FROM refresh_sessions WHERE device_name=$1 ORDER BY created_at DESC LIMIT 1",
      [marker],
    )
  ).rows[0];
  assert(Boolean(session?.revoked_at), "la sesión de prueba queda revocada");
} finally {
  api.kill("SIGTERM");
  await pool.end();
}
