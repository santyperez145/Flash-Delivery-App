import pg from "pg";
import { createDispatchOffers } from "../server/dispatch-repository.js";

const pool = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  ssl: false,
});
const base = process.env.API_URL || "http://127.0.0.1:4000/api",
  stamp = Date.now(),
  userId = `USR-VEH-${stamp}`,
  driverId = `DRV-VEH-${stamp}`,
  email = `driver-vehicle-${stamp}@flash.test`,
  requestIds = [];
let token = "";
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
  if (body.requestId) requestIds.push(body.requestId);
  return { status: response.status, body };
};
const login = async (address) =>
  (
    await call("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: address,
        password: "demo123",
        deviceName: "driver-vehicle-smoke",
      }),
    })
  ).body.token;

try {
  const password = (await pool.query("SELECT password_hash FROM users WHERE public_id='usr_admin'"))
    .rows[0].password_hash;
  const user = (
    await pool.query(
      "INSERT INTO users(public_id,email,password_hash,name,email_verified_at,profile) VALUES($1,$2,$3,'Driver Vehículos',now(),jsonb_build_object('driverId',$4::text)) RETURNING id",
      [userId, email, password, driverId],
    )
  ).rows[0];
  await pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,'driver')", [user.id]);
  const driver = (
    await pool.query(
      `INSERT INTO drivers(public_id,user_id,online,active_mode,service_modes,current_location,location_updated_at,metadata) VALUES($1,$2,false,'ride',ARRAY['delivery','ride']::job_kind[],ST_SetSRID(ST_MakePoint(-58.39,-34.60),4326)::geography,now(),'{"name":"Driver Vehículos"}') RETURNING id`,
      [driverId, user.id],
    )
  ).rows[0];
  await pool.query(
    "INSERT INTO driver_compliance(driver_id,status,submitted_at,reviewed_at) VALUES($1,'approved',now(),now())",
    [driver.id],
  );
  token = await login(email);
  const empty = await call(`/drivers/${driverId}/vehicles`);
  assert(
    empty.status === 200 && empty.body.vehicles.length === 0,
    "driver starts with an authoritative empty registry",
  );
  const noVehicleOnline = await call(`/drivers/${driverId}/availability`, {
    method: "PATCH",
    body: JSON.stringify({ online: true }),
  });
  assert(
    noVehicleOnline.status === 409,
    "driver cannot go online without an approved active vehicle",
  );
  const created = await call(`/drivers/${driverId}/vehicles`, {
    method: "POST",
    body: JSON.stringify({
      kind: "car",
      model: "Toyota Corolla",
      plate: `AA${String(stamp).slice(-7)}`,
      color: "Blanco",
      seats: 4,
      serviceModes: ["delivery", "ride"],
    }),
  });
  if (created.status !== 201)
    console.log("diagnostic - create vehicle", created.status, created.body);
  const vehicleId = created.body.vehicle?.id;
  assert(
    created.status === 201 &&
      vehicleId &&
      created.body.vehicle.active &&
      created.body.vehicle.status === "pending",
    "driver registers a pending active vehicle in PostgreSQL",
  );
  assert(
    (
      await call(`/drivers/${driverId}/availability`, {
        method: "PATCH",
        body: JSON.stringify({ online: true }),
      })
    ).status === 409,
    "pending vehicle cannot receive work",
  );
  token = await login("cliente@flash.app");
  assert(
    (await call(`/drivers/${driverId}/vehicles`)).status === 403,
    "another customer cannot inspect driver vehicles",
  );
  token = await login("ops@flash.app");
  const approved = await call(`/admin/driver-vehicles/${vehicleId}/review`, {
    method: "PATCH",
    body: JSON.stringify({ status: "approved" }),
  });
  assert(
    approved.status === 200 && approved.body.vehicle.status === "approved",
    "operations independently approves vehicle",
  );
  token = await login(email);
  const online = await call(`/drivers/${driverId}/availability`, {
    method: "PATCH",
    body: JSON.stringify({ online: true }),
  });
  assert(
    online.status === 200 &&
      online.body.driver.online &&
      online.body.driver.vehicle === "Toyota Corolla",
    "approved active vehicle enables supply and drives public projection",
  );
  const backgroundFix = await call(`/drivers/${driverId}/location`, {
    method: "PATCH",
    body: JSON.stringify({
      lat: -34.6,
      lng: -58.39,
      label: "Ubicación background",
      source: "background",
      accuracyM: 8.5,
    }),
  });
  const telemetry = (
    await pool.query("SELECT location_source,location_accuracy_m FROM drivers WHERE public_id=$1", [
      driverId,
    ])
  ).rows[0];
  assert(
    backgroundFix.status === 200 &&
      backgroundFix.body.driver.location.source === "background" &&
      Number(telemetry.location_accuracy_m) === 8.5,
    "background GPS source and accuracy persist as authoritative telemetry",
  );
  const dispatchClient = await pool.connect();
  try {
    await dispatchClient.query("BEGIN");
    await dispatchClient.query("UPDATE drivers SET online=false WHERE public_id<>$1", [driverId]);
    const job = (
      await dispatchClient.query(
        `INSERT INTO jobs(public_id,kind,customer_id,status,pickup_address,pickup_location,dropoff_address,dropoff_location,service_level,quoted_amount_cents,distance_m,estimated_duration_s) SELECT $1,'ride',id,'requested','Origen',ST_SetSRID(ST_MakePoint(-58.39,-34.60),4326)::geography,'Destino',ST_SetSRID(ST_MakePoint(-58.40,-34.61),4326)::geography,'economy',100000,1500,600 FROM users WHERE public_id='usr_customer' RETURNING id`,
        [`RIDE-VEH-${stamp}`],
      )
    ).rows[0];
    await dispatchClient.query(
      "UPDATE drivers SET location_updated_at=now()-interval '11 minutes' WHERE public_id=$1",
      [driverId],
    );
    const stale = await createDispatchOffers(dispatchClient, { jobId: job.id, mode: "ride" });
    await dispatchClient.query(
      "UPDATE drivers SET location_updated_at=now(),location_accuracy_m=8.5 WHERE public_id=$1",
      [driverId],
    );
    const fresh = await createDispatchOffers(dispatchClient, { jobId: job.id, mode: "ride" });
    assert(
      stale.length === 0 && fresh.length === 1,
      "dispatch rejects stale GPS and accepts a fresh accurate fix",
    );
    await dispatchClient.query("ROLLBACK");
  } catch (error) {
    await dispatchClient.query("ROLLBACK");
    throw error;
  } finally {
    dispatchClient.release();
  }
  const edited = await call(`/driver-vehicles/${vehicleId}`, {
    method: "PATCH",
    body: JSON.stringify({ color: "Negro" }),
  });
  const persisted = await pool.query(
    "SELECT v.status,d.online FROM vehicles v JOIN drivers d ON d.id=v.driver_id WHERE v.public_id=$1",
    [vehicleId],
  );
  assert(
    edited.status === 200 && edited.body.vehicle.status === "pending" && !persisted.rows[0].online,
    "material edit resets approval and disconnects driver",
  );
  token = await login("ops@flash.app");
  const rejected = await call(`/admin/driver-vehicles/${vehicleId}/review`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "rejected",
      rejectionReason: "Color no coincide con documentación",
    }),
  });
  assert(
    rejected.status === 200 && rejected.body.vehicle.rejectionReason,
    "rejection persists an operational reason",
  );
  token = await login(email);
  assert(
    (await call(`/driver-vehicles/${vehicleId}/activate`, { method: "POST", body: "{}" }))
      .status === 409,
    "rejected vehicle cannot be activated",
  );
  await call(`/driver-vehicles/${vehicleId}`, {
    method: "PATCH",
    body: JSON.stringify({ color: "Blanco", serviceModes: ["delivery"] }),
  });
  token = await login("ops@flash.app");
  await call(`/admin/driver-vehicles/${vehicleId}/review`, {
    method: "PATCH",
    body: JSON.stringify({ status: "approved" }),
  });
  token = await login(email);
  await call(`/drivers/${driverId}/availability`, {
    method: "PATCH",
    body: JSON.stringify({ activeService: "delivery" }),
  });
  await call(`/drivers/${driverId}/availability`, {
    method: "PATCH",
    body: JSON.stringify({ online: true }),
  });
  const incompatibleSwitch = await call(`/drivers/${driverId}/availability`, {
    method: "PATCH",
    body: JSON.stringify({ activeService: "ride" }),
  });
  const modeState = (
    await pool.query("SELECT active_mode,online FROM drivers WHERE public_id=$1", [driverId])
  ).rows[0];
  assert(
    incompatibleSwitch.status === 409 && modeState.active_mode === "delivery" && modeState.online,
    "online driver cannot switch into a mode unsupported by the active vehicle",
  );
  const retired = await call(`/driver-vehicles/${vehicleId}`, { method: "DELETE" });
  const afterRetire = await pool.query(
    "SELECT v.retired_at,d.online FROM vehicles v JOIN drivers d ON d.id=v.driver_id WHERE v.public_id=$1",
    [vehicleId],
  );
  assert(
    retired.status === 200 && afterRetire.rows[0].retired_at && !afterRetire.rows[0].online,
    "retirement preserves evidence and removes driver from supply",
  );
} finally {
  await pool.query("SELECT set_config('app.audit_maintenance','on',false)");
  if (requestIds.length)
    await pool.query("DELETE FROM audit_events WHERE request_id=ANY($1)", [requestIds]);
  await pool.query(
    "DELETE FROM refresh_sessions WHERE user_id=(SELECT id FROM users WHERE public_id=$1)",
    [userId],
  );
  await pool.query("DELETE FROM drivers WHERE public_id=$1", [driverId]);
  await pool.query(
    "DELETE FROM user_roles WHERE user_id=(SELECT id FROM users WHERE public_id=$1)",
    [userId],
  );
  await pool.query("DELETE FROM users WHERE public_id=$1", [userId]);
  await pool.end();
}
