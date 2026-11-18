// Código de entrega en pedidos (SEG-03) contra PostgreSQL y la API.
//
// Dos partes:
//
// 1. **La decisión**, dentro de una transacción que se deshace: con un cliente
//    sintético, un pedido de valor alto lleva código, uno chico sin reclamos no, y
//    uno chico de quien tuvo un reclamo aprobado sí. Un retiro nunca.
// 2. **El circuito**, con un pedido en camino del cliente y el repartidor de prueba:
//    el cliente ve el código, el repartidor no puede cerrar sin él, un código mal
//    cargado no sirve, cinco errores bloquean, y el correcto habilita el cierre.
//
// Todo lo que crea lo borra al final.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { createPool } from "./db-client.mjs";
import {
  orderNeedsDeliveryCode,
  requireOrderDeliveryCodeIfNeeded,
} from "../server/order-delivery-code-repository.js";
import { config } from "../server/config.js";
import { closePostgres } from "../server/postgres.js";
import { deriveOrderDeliveryCode } from "../server/secret-envelope.js";

const base = process.env.API_URL || "http://127.0.0.1:4000/api",
  pool = createPool(),
  marca = `odc-${crypto.randomBytes(4).toString("hex")}`;
const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
async function login(email) {
  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo123", deviceName: "order-delivery-code-smoke" }),
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
const insertarPedido = (client, { publicId, customerId, merchantId, driverId, status }) =>
  client.query(
    `INSERT INTO jobs(public_id,kind,customer_id,merchant_id,driver_id,status,
      pickup_address,pickup_location,dropoff_address,dropoff_location,
      service_level,quoted_amount_cents,final_amount_cents,distance_m,estimated_duration_s,metadata)
    VALUES($1,'delivery',$2,$3,$4,$5,
      'Comercio',ST_SetSRID(ST_MakePoint(-58.3816,-34.6037),4326)::geography,
      'Defensa 982',ST_SetSRID(ST_MakePoint(-58.3712,-34.6205),4326)::geography,
      'food',9000000,9000000,2500,900,'{"subtype":"food_order"}')
    RETURNING id`,
    [publicId, customerId, merchantId, driverId, status],
  );

const merchantId = (await pool.query("SELECT id FROM merchants ORDER BY created_at LIMIT 1"))
  .rows[0].id;

// --- 1. La decisión --------------------------------------------------------
const tx = await pool.connect();
try {
  await tx.query("BEGIN");
  const cliente = (
    await tx.query(
      `INSERT INTO users(public_id,email,password_hash,name) VALUES($1,$1||'@flash.test','x','Cliente sintético') RETURNING id`,
      [marca],
    )
  ).rows[0].id;
  const pedido = async (sufijo) =>
    (
      await insertarPedido(tx, {
        publicId: `ORD-${marca}-${sufijo}`,
        customerId: cliente,
        merchantId,
        driverId: null,
        status: "requested",
      })
    ).rows[0].id;
  const decidir = async (sufijo, totalCents, pickup = false) =>
    requireOrderDeliveryCodeIfNeeded(tx, {
      jobId: await pedido(sufijo),
      publicId: `ORD-${marca}-${sufijo}`,
      customerId: cliente,
      totalCents,
      pickup,
    });
  const umbral = config.orderDeliveryCodeMinCents;
  assert((await decidir("alto", umbral)) === "high_value", "un pedido de valor alto lleva código");
  assert((await decidir("retiro", umbral, true)) === null, "un retiro en el local no lleva código");
  assert(
    (await decidir("chico", umbral - 1)) === null,
    "un pedido chico sin reclamos no lleva código",
  );
  const reclamado = await pedido("reclamado");
  await tx.query(
    `INSERT INTO order_issues(public_id,job_id,reporter_id,category,description,status,resolved_by,resolved_at)
    VALUES($1,$2,$3,'missing_item','Faltó un producto','approved',$3,now())`,
    [`ISS-${marca}`, reclamado, cliente],
  );
  assert(
    (await decidir("chico-con-reclamo", umbral - 1)) === "prior_claim",
    "un pedido chico de quien tuvo un reclamo aprobado lleva código",
  );
  const guardado = (
    await tx.query(
      `SELECT c.pin_hash,c.reason FROM order_delivery_codes c JOIN jobs j ON j.id=c.job_id WHERE j.public_id=$1`,
      [`ORD-${marca}-alto`],
    )
  ).rows[0];
  assert(
    guardado.pin_hash.startsWith("$2") &&
      !guardado.pin_hash.includes(deriveOrderDeliveryCode(`ORD-${marca}-alto`)),
    "en la base queda sólo el hash del código",
  );
} finally {
  await tx.query("ROLLBACK");
  tx.release();
}

// --- 2. El circuito --------------------------------------------------------
const orderId = `ORD-${marca}-ruta`;
let jobId = null;
try {
  const customer = await login("cliente@flash.app"),
    driver = await login("conductor@flash.app");
  const ids = (
    await pool.query(
      `SELECT (SELECT id FROM users WHERE public_id=$1) customer_id,(SELECT id FROM drivers WHERE public_id=$2) driver_id`,
      [customer.user.id, driver.user.driverId],
    )
  ).rows[0];
  jobId = (
    await insertarPedido(pool, {
      publicId: orderId,
      customerId: ids.customer_id,
      merchantId,
      driverId: ids.driver_id,
      status: "delivering",
    })
  ).rows[0].id;
  await pool.query(
    "INSERT INTO order_delivery_codes(job_id,pin_hash,reason) VALUES($1,$2,'high_value')",
    [jobId, await bcrypt.hash(deriveOrderDeliveryCode(orderId), 10)],
  );
  const codigo = deriveOrderDeliveryCode(orderId);

  const visto = await request(`/orders/${orderId}/delivery-code`, customer.token);
  assert(visto.status === 200 && visto.body.deliveryCode === codigo, "el cliente ve su código");
  const ajeno = await request(`/orders/${orderId}/delivery-code`, driver.token);
  assert(ajeno.status === 403, "quien reparte no puede leer el código");

  const sinCodigo = await request(`/orders/${orderId}/advance`, driver.token, { method: "POST" });
  assert(sinCodigo.status === 409, "sin el código, el pedido no se cierra");

  const otro = codigo === "1234" ? "4321" : "1234";
  const mal = await request(`/orders/${orderId}/delivery-code/verify`, driver.token, {
    method: "POST",
    body: JSON.stringify({ pin: otro }),
  });
  assert(
    mal.status === 400 && (await orderNeedsDeliveryCode(orderId)),
    "un código mal cargado no sirve",
  );

  // Cinco errores bloquean, también al código correcto.
  await pool.query("UPDATE order_delivery_codes SET failed_attempts=4 WHERE job_id=$1", [jobId]);
  const quinto = await request(`/orders/${orderId}/delivery-code/verify`, driver.token, {
    method: "POST",
    body: JSON.stringify({ pin: otro }),
  });
  const bloqueado = await request(`/orders/${orderId}/delivery-code/verify`, driver.token, {
    method: "POST",
    body: JSON.stringify({ pin: codigo }),
  });
  assert(
    quinto.status === 429 && bloqueado.status === 429,
    "cinco errores bloquean, también al código correcto",
  );
  // Pasado el bloqueo (se simula), el código correcto vale.
  await pool.query(
    "UPDATE order_delivery_codes SET failed_attempts=0,locked_until=NULL WHERE job_id=$1",
    [jobId],
  );
  const bien = await request(`/orders/${orderId}/delivery-code/verify`, driver.token, {
    method: "POST",
    body: JSON.stringify({ pin: codigo }),
  });
  assert(bien.status === 200 && bien.body.verified === true, "el código correcto se verifica");
  assert(!(await orderNeedsDeliveryCode(orderId)), "verificado, el pedido ya se puede cerrar");
  const usado = await request(`/orders/${orderId}/delivery-code`, customer.token);
  assert(usado.status === 409, "un código usado ya no se muestra");

  // Con el código verificado, el pedido se cierra.
  const cerrado = await request(`/orders/${orderId}/advance`, driver.token, { method: "POST" });
  assert(
    cerrado.status === 200 && cerrado.body.order?.status === "delivered",
    "con el código verificado, quien reparte cierra el pedido",
  );
} finally {
  if (jobId) {
    await pool.query("DELETE FROM notifications WHERE deduplication_key LIKE $1", [
      `food_order:${orderId}:%`,
    ]);
    await pool.query("DELETE FROM order_delivery_codes WHERE job_id=$1", [jobId]);
    await pool.query("DELETE FROM job_events WHERE job_id=$1", [jobId]);
    await pool.query("DELETE FROM jobs WHERE id=$1", [jobId]);
  }
  await pool.end();
  await closePostgres();
}
