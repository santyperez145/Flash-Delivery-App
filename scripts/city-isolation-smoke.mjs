import { spawn } from "node:child_process";
import { createPool } from "./db-client.mjs";
import { waitForHealthy } from "./wait-for-api.mjs";

const pool = createPool();
const port = 4210;
const api = spawn(process.execPath, ["server/start.js"], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: "test", LOG_LEVEL: "silent", PORT: String(port) },
  stdio: ["ignore", "ignore", "pipe"],
});
api.stderr.on("data", (data) => process.stderr.write(data));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

try {
  const integrity = await pool.query(`SELECT
    (SELECT count(*)::int FROM cities WHERE status IN('beta','active')) enabled_cities,
    (SELECT count(*)::int FROM users WHERE city_id IS NULL) users_without_city,
    (SELECT count(*)::int FROM merchants WHERE city_id IS NULL) merchants_without_city,
    (SELECT count(*)::int FROM drivers WHERE city_id IS NULL) drivers_without_city,
    (SELECT count(*)::int FROM jobs WHERE city_id IS NULL) jobs_without_city,
    (SELECT count(*)::int FROM service_zones WHERE city_id IS NULL) zones_without_city`);
  const row = integrity.rows[0];
  assert(row.enabled_cities === 1, "La beta debe exponer exactamente una ciudad");
  assert(
    [
      row.users_without_city,
      row.merchants_without_city,
      row.drivers_without_city,
      row.jobs_without_city,
      row.zones_without_city,
    ].every(Number.isInteger) &&
      [
        row.users_without_city,
        row.merchants_without_city,
        row.drivers_without_city,
        row.jobs_without_city,
        row.zones_without_city,
      ].every((value) => value === 0),
    "Todas las entidades operativas requieren ciudad",
  );

  let online = false;
  await waitForHealthy(`http://127.0.0.1:${port}/api/health`);
  const cities = await fetch(`http://127.0.0.1:${port}/api/cities`).then((response) =>
    response.json(),
  );
  assert(
    cities.cities?.length === 1 &&
      cities.cities[0].slug === "buenos-aires" &&
      !cities.cities[0].boundary,
    "El contrato público expone sólo la ciudad beta sin polígono interno",
  );
  const zones = await fetch(`http://127.0.0.1:${port}/api/zones?city=buenos-aires`);
  assert(
    zones.status === 200 && (await zones.json()).zones?.length > 0,
    "Buenos Aires expone sus zonas",
  );
  assert(
    (await fetch(`http://127.0.0.1:${port}/api/zones?city=cordoba`)).status === 404,
    "Una ciudad no habilitada no expone zonas",
  );
  assert(
    (await fetch(`http://127.0.0.1:${port}/api/zones?city=../../admin`)).status === 400,
    "El selector de ciudad rechaza entradas inválidas",
  );
  console.log("ok - aislamiento inicial de ciudad y contrato de expansión verificados");
} finally {
  api.kill("SIGTERM");
  await pool.end();
}
