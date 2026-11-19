// Viajes en efectivo (PAG-01) contra PostgreSQL y la API.
//
// 1. La API sólo acepta Flash Wallet o efectivo: otro texto ya no crea un viaje
//    sin cobro.
// 2. La liquidación de un viaje en efectivo terminado asienta la ganancia del
//    conductor y la comisión, más el cobro en mano: el saldo del conductor baja
//    exactamente la comisión, y una segunda liquidación no duplica nada.
// 3. Un conductor que debe más del tope no puede aceptar otro viaje en efectivo
//    (dentro de una transacción que se deshace).
//
// Todo lo que crea lo borra al final.
import crypto from "node:crypto";
import { createPool } from "./db-client.mjs";
import { acceptDispatchOffer } from "../server/dispatch-repository.js";
import { config } from "../server/config.js";
import { closePostgres } from "../server/postgres.js";
import {
  driverWalletBalanceCents,
  settleMobilityWalletPayment,
} from "../server/wallet-repository.js";

const base = process.env.API_URL || "http://127.0.0.1:4000/api",
  pool = createPool(),
  marca = crypto.randomBytes(4).toString("hex").toUpperCase(),
  rideId = `RID-CASH-${marca}`;
const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
async function login(email) {
  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo123", deviceName: "cash-rides-smoke" }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message);
  return body;
}
const insertarViaje = (client, { publicId, customerId, driverId, status }) =>
  client.query(
    `INSERT INTO jobs(public_id,kind,customer_id,driver_id,status,
      pickup_address,pickup_location,dropoff_address,dropoff_location,
      service_level,quoted_amount_cents,final_amount_cents,distance_m,estimated_duration_s,
      payment_method_label)
    VALUES($1,'ride',$2,$3,$4,
      'Obelisco',ST_SetSRID(ST_MakePoint(-58.3816,-34.6037),4326)::geography,
      'Aeroparque',ST_SetSRID(ST_MakePoint(-58.4156,-34.5592),4326)::geography,
      'economy',1000000,1000000,7200,1500,'Efectivo')
    RETURNING id`,
    [publicId, customerId, driverId, status],
  );

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

  // --- 1. Sólo Flash Wallet o efectivo -------------------------------------
  // El resto del pedido es válido —clave de idempotencia y cotización firmada—,
  // así que si la API volviera a aceptar cualquier texto, el viaje se crearía y
  // esta afirmación fallaría.
  const opciones = await fetch(`${base}/rides/options`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${customer.token}` },
    body: JSON.stringify({
      pickup: "Obelisco",
      destination: "Aeroparque",
      service: "economy",
      pickupCoords: { lat: -34.6037, lng: -58.3816 },
      destinationCoords: { lat: -34.5592, lng: -58.4156 },
    }),
  }).then((response) => response.json());
  const cotizacion = opciones.options?.find((entry) => entry.service === "economy");
  assert(Boolean(cotizacion?.quoteToken), "la cotización del viaje trae su token firmado");
  const pedido = (paymentMethod) =>
    fetch(`${base}/rides`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${customer.token}`,
        "Idempotency-Key": `cash-rides-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({
        customerId: customer.user.id,
        pickup: "Obelisco",
        destination: "Aeroparque",
        service: "economy",
        pickupCoords: { lat: -34.6037, lng: -58.3816 },
        destinationCoords: { lat: -34.5592, lng: -58.4156 },
        paymentMethod,
        quoteToken: cotizacion.quoteToken,
      }),
    });
  const otro = await pedido("Tarjeta de un amigo");
  assert(otro.status === 400, "un viaje con otro medio de pago se rechaza");

  // --- 2. La liquidación ------------------------------------------------------
  jobId = (
    await insertarViaje(pool, {
      publicId: rideId,
      customerId: ids.customer_id,
      driverId: ids.driver_id,
      status: "completed",
    })
  ).rows[0].id;
  const client = await pool.connect();
  const antes = await driverWalletBalanceCents(client, ids.driver_id);
  client.release();
  const liquidado = await settleMobilityWalletPayment({
    publicId: rideId,
    driverPublicId: driver.user.driverId,
    driverAmount: 8000,
    reference: `viaje-${rideId}`,
  });
  assert(
    liquidado.settled && liquidado.cash && liquidado.driverAmount === 8000,
    "un viaje en efectivo terminado se liquida",
  );
  const asientos = (
    await pool.query(
      `SELECT t.kind,t.idempotency_key,sum(e.amount_cents) FILTER(WHERE e.direction='debit')::bigint debitos,
         sum(e.amount_cents) FILTER(WHERE e.direction='credit')::bigint creditos
       FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id=t.id
       WHERE t.idempotency_key = ANY($1) GROUP BY t.kind,t.idempotency_key`,
      [[`driver-earning-viaje-${rideId}`, `cash-collection-viaje-${rideId}`]],
    )
  ).rows;
  const ganancia = asientos.find((row) => row.kind === "driver_earning"),
    cobro = asientos.find((row) => row.kind === "cash_collection");
  assert(
    Number(ganancia?.debitos) === 1000000 &&
      Number(ganancia.creditos) === 1000000 &&
      Number(cobro?.debitos) === 1000000 &&
      Number(cobro.creditos) === 1000000,
    "se asientan la ganancia con su comisión y el cobro en mano, cuadrados",
  );
  const client2 = await pool.connect();
  const despues = await driverWalletBalanceCents(client2, ids.driver_id);
  client2.release();
  assert(despues - antes === -200000, "el saldo del conductor baja exactamente la comisión");
  const otraVez = await settleMobilityWalletPayment({
    publicId: rideId,
    driverPublicId: driver.user.driverId,
    driverAmount: 8000,
    reference: `viaje-${rideId}`,
  });
  const cuenta = Number(
    (
      await pool.query(
        "SELECT count(*)::int count FROM ledger_transactions WHERE idempotency_key = ANY($1)",
        [[`driver-earning-viaje-${rideId}`, `cash-collection-viaje-${rideId}`]],
      )
    ).rows[0].count,
  );
  assert(otraVez.duplicate === true && cuenta === 2, "una segunda liquidación no duplica nada");

  // --- 3. El tope de deuda ----------------------------------------------------
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const pendiente = (
      await insertarViaje(tx, {
        publicId: `${rideId}-B`,
        customerId: ids.customer_id,
        driverId: null,
        status: "requested",
      })
    ).rows[0].id;
    await tx.query(
      `INSERT INTO dispatch_offers(public_id,job_id,driver_id,score,expires_at,score_breakdown)
       VALUES($1,$2,$3,50,now()+interval '1 minute','{}')`,
      [`OFR-${marca}`, pendiente, ids.driver_id],
    );
    // Una deuda apenas por encima del tope, asentada como ajuste cuadrado.
    const deuda = config.cashDriverDebtLimitCents + 100 + Math.max(0, despues);
    const ajuste = (
      await tx.query(
        `INSERT INTO ledger_transactions(idempotency_key,kind,description) VALUES($1,'adjustment','Deuda de prueba') RETURNING id`,
        [`cash-debt-${marca}`],
      )
    ).rows[0].id;
    const cuentaConductor = (
      await tx.query(
        `SELECT a.id FROM ledger_accounts a JOIN drivers d ON d.user_id=a.owner_id
         WHERE d.id=$1 AND a.owner_type='user' AND a.account_type='wallet'`,
        [ids.driver_id],
      )
    ).rows[0].id;
    const ingresos = (
      await tx.query(
        `SELECT id FROM ledger_accounts WHERE owner_type='platform' AND account_type='revenue' AND owner_id IS NULL`,
      )
    ).rows[0].id;
    await tx.query(
      `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id)
       VALUES($1,$2,'debit',$4,'adjustment',$5),($1,$3,'credit',$4,'adjustment',$5)`,
      [ajuste, cuentaConductor, ingresos, deuda, pendiente],
    );
    let rechazo = null;
    try {
      await tx.query("SAVEPOINT aceptar");
      await acceptDispatchOffer(tx, {
        jobPublicId: `${rideId}-B`,
        driverPublicId: driver.user.driverId,
        actorUserId: null,
      });
    } catch (error) {
      rechazo = error;
      await tx.query("ROLLBACK TO SAVEPOINT aceptar");
    }
    assert(
      rechazo?.status === 409 && /efectivo/.test(rechazo.message),
      "quien debe más del tope no puede aceptar otro viaje en efectivo",
    );
  } finally {
    await tx.query("ROLLBACK");
    tx.release();
  }
} finally {
  const claves = [`driver-earning-viaje-${rideId}`, `cash-collection-viaje-${rideId}`];
  await pool.query(
    "DELETE FROM ledger_entries WHERE transaction_id IN (SELECT id FROM ledger_transactions WHERE idempotency_key = ANY($1))",
    [claves],
  );
  await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key = ANY($1)", [claves]);
  if (jobId) {
    await pool.query("DELETE FROM job_events WHERE job_id=$1", [jobId]);
    await pool.query("DELETE FROM jobs WHERE id=$1", [jobId]);
  }
  await pool.end();
  await closePostgres();
}
