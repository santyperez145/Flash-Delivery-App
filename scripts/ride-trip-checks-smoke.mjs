// Control del viaje (SEG-01) contra PostgreSQL y la API.
//
// Arma un viaje en curso propio y recorre las cuatro señales: parada larga,
// desvío, señal perdida y final lejos del destino. Verifica el aviso al pasajero,
// que sólo él conteste, que «Pedir ayuda» abra un incidente de seguridad y que
// una señal contestada no se repita enseguida. Todo lo que crea lo borra al final
// y deja la ubicación del conductor como estaba.
import crypto from "node:crypto";
import { createPool } from "./db-client.mjs";
import { processPostgresTripChecks } from "../server/ride-trip-check-repository.js";
import { closePostgres } from "../server/postgres.js";

const base = process.env.API_URL || "http://127.0.0.1:4000/api",
  pool = createPool(),
  rideId = `RID-TCK-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
async function login(email) {
  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo123", deviceName: "ride-trip-checks-smoke" }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message);
  return body;
}
async function request(path, token, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  return { status: response.status, body: await response.json() };
}
const checksOf = async (jobId) =>
  (
    await pool.query(
      "SELECT public_id,kind,status,notified_at,incident_id FROM ride_trip_checks WHERE job_id=$1 ORDER BY detected_at",
      [jobId],
    )
  ).rows;
const open = (checks, kind) =>
  checks.find((check) => check.kind === kind && check.status === "open");

let jobId = null,
  driverId = null,
  driverBefore = null;
try {
  const customer = await login("cliente@flash.app"),
    driver = await login("conductor@flash.app");
  const ids = (
    await pool.query(
      `SELECT (SELECT id FROM users WHERE public_id=$1) customer_id,(SELECT id FROM drivers WHERE public_id=$2) driver_id`,
      [customer.user.id, driver.user.driverId],
    )
  ).rows[0];
  driverId = ids.driver_id;
  driverBefore = (
    await pool.query(
      "SELECT current_location,location_updated_at,last_moved_at,last_moved_location FROM drivers WHERE id=$1",
      [driverId],
    )
  ).rows[0];
  // Obelisco → Aeroparque: unos 5,9 km en línea recta.
  jobId = (
    await pool.query(
      `INSERT INTO jobs(public_id,kind,customer_id,driver_id,status,
        pickup_address,pickup_location,dropoff_address,dropoff_location,
        service_level,quoted_amount_cents,final_amount_cents,distance_m,estimated_duration_s)
      VALUES($1,'ride',$2,$3,'in_progress',
        'Obelisco',ST_SetSRID(ST_MakePoint(-58.3816,-34.6037),4326)::geography,
        'Aeroparque',ST_SetSRID(ST_MakePoint(-58.4156,-34.5592),4326)::geography,
        'economy',850000,850000,7200,1500)
      RETURNING id`,
      [rideId, ids.customer_id, ids.driver_id],
    )
  ).rows[0].id;

  // 1. En el corredor y moviéndose: no hay nada que avisar.
  await pool.query(
    `UPDATE drivers SET current_location=ST_SetSRID(ST_MakePoint(-58.3990,-34.5810),4326)::geography,location_updated_at=now() WHERE id=$1`,
    [driverId],
  );
  await processPostgresTripChecks({ onlyJobId: jobId });
  assert((await checksOf(jobId)).length === 0, "un viaje normal no dispara avisos");

  // 2. Detenido hace 10 minutos con GPS vivo: parada larga.
  await pool.query(
    "UPDATE drivers SET last_moved_at=now()-interval '10 minutes',location_updated_at=now() WHERE id=$1",
    [driverId],
  );
  const vuelta = await processPostgresTripChecks({ onlyJobId: jobId });
  let checks = await checksOf(jobId);
  const stop = open(checks, "long_stop");
  assert(stop && vuelta.notified >= 1, "un auto quieto cinco minutos abre un aviso y se avisa");
  assert(Boolean(stop.notified_at), "el aviso queda marcado como avisado");
  const push = (
    await pool.query(
      "SELECT template,channel,payload FROM notifications WHERE deduplication_key=$1",
      [`trip-check:${stop.public_id}`],
    )
  ).rows;
  assert(
    push.some(
      (row) =>
        row.template === "security_alert" &&
        row.payload.checkId === stop.public_id &&
        row.payload.title === "¿Todo bien en tu viaje?" &&
        row.payload.body.length > 10,
    ),
    "el pasajero recibe un aviso esencial con título y texto",
  );
  await processPostgresTripChecks({ onlyJobId: jobId });
  assert(
    (await checksOf(jobId)).filter((check) => check.kind === "long_stop").length === 1,
    "el barrido no repite un aviso abierto",
  );

  // 3. La ve el pasajero en su actividad.
  const activity = await request("/me/activity?limit=50", customer.token);
  const proyectado = activity.body.items?.find((item) => item.id === rideId)?.resource;
  assert(
    proyectado?.tripCheck?.id === stop.public_id && proyectado.tripCheck.kind === "long_stop",
    "el viaje del pasajero trae el aviso abierto",
  );

  // 4. Sólo contesta quien viaja, y una vez.
  const ajeno = await request(`/rides/${rideId}/trip-checks/${stop.public_id}`, driver.token, {
    method: "POST",
    body: JSON.stringify({ response: "ok" }),
  });
  assert(ajeno.status === 403, "el conductor no puede contestar por el pasajero");
  const bien = await request(`/rides/${rideId}/trip-checks/${stop.public_id}`, customer.token, {
    method: "POST",
    body: JSON.stringify({ response: "ok" }),
  });
  assert(
    bien.status === 200 && bien.body.check.status === "rider_ok",
    "«Estoy bien» cierra el aviso",
  );
  const otraVez = await request(`/rides/${rideId}/trip-checks/${stop.public_id}`, customer.token, {
    method: "POST",
    body: JSON.stringify({ response: "help" }),
  });
  assert(otraVez.status === 409, "un aviso contestado no se vuelve a contestar");
  await processPostgresTripChecks({ onlyJobId: jobId });
  assert(
    (await checksOf(jobId)).filter((check) => check.kind === "long_stop").length === 1,
    "una parada ya contestada no se vuelve a preguntar enseguida",
  );

  // 5. Lejos del corredor: desvío. «Pedir ayuda» abre un incidente de seguridad.
  await pool.query(
    `UPDATE drivers SET current_location=ST_SetSRID(ST_MakePoint(-58.5200,-34.6500),4326)::geography,location_updated_at=now() WHERE id=$1`,
    [driverId],
  );
  await processPostgresTripChecks({ onlyJobId: jobId });
  checks = await checksOf(jobId);
  const desvio = open(checks, "route_deviation");
  assert(Boolean(desvio), "alejarse del recorrido abre un aviso");
  const ayuda = await request(`/rides/${rideId}/trip-checks/${desvio.public_id}`, customer.token, {
    method: "POST",
    body: JSON.stringify({ response: "help", location: { lat: -34.65, lng: -58.52 } }),
  });
  const incidente = (
    await pool.query(
      "SELECT incident_type,status FROM ride_safety_incidents WHERE job_id=$1 AND public_id=$2",
      [jobId, ayuda.body.check?.incidentId],
    )
  ).rows[0];
  assert(
    ayuda.status === 200 && incidente?.incident_type === "sos" && incidente.status === "open",
    "«Pedir ayuda» abre un incidente de seguridad en la cola de operaciones",
  );

  // 6. Sin GPS hace cinco minutos: señal perdida.
  await pool.query(
    "UPDATE drivers SET location_updated_at=now()-interval '5 minutes' WHERE id=$1",
    [driverId],
  );
  await processPostgresTripChecks({ onlyJobId: jobId });
  assert(
    Boolean(open(await checksOf(jobId), "signal_lost")),
    "perder la señal del conductor abre un aviso",
  );

  // 7. Cerrar lejos del destino: lo abiertos vencen y se pregunta si llegó bien.
  await pool.query("UPDATE jobs SET status='completed' WHERE id=$1", [jobId]);
  checks = await checksOf(jobId);
  assert(
    !checks.some((check) => check.kind === "signal_lost" && check.status === "open"),
    "al cerrar el viaje vencen los avisos abiertos",
  );
  assert(Boolean(open(checks, "early_end")), "un viaje cerrado lejos del destino abre su aviso");
} finally {
  if (jobId) {
    await pool.query(
      "DELETE FROM notifications WHERE deduplication_key LIKE 'trip-check:%' AND payload->>'rideId'=$1",
      [rideId],
    );
    await pool.query(
      "DELETE FROM notifications WHERE template='safety_sos' AND payload->>'rideId'=$1",
      [rideId],
    );
    await pool.query("DELETE FROM ride_trip_checks WHERE job_id=$1", [jobId]);
    await pool.query("DELETE FROM ride_safety_incidents WHERE job_id=$1", [jobId]);
    await pool.query("DELETE FROM job_events WHERE job_id=$1", [jobId]);
    await pool.query("DELETE FROM jobs WHERE id=$1", [jobId]);
  }
  if (driverId && driverBefore)
    await pool.query(
      "UPDATE drivers SET current_location=$2,location_updated_at=$3,last_moved_at=$4,last_moved_location=$5 WHERE id=$1",
      [
        driverId,
        driverBefore.current_location,
        driverBefore.location_updated_at,
        driverBefore.last_moved_at,
        driverBefore.last_moved_location,
      ],
    );
  await pool.end();
  await closePostgres();
}
