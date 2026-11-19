// Dividir la tarifa (PAG-02) contra PostgreSQL.
//
// Con cuatro cuentas sintéticas —quien pide, dos que aceptan y una sin saldo— y un
// viaje cobrado de verdad desde la Wallet:
//
// - invitar: un email sin cuenta responde 404, repetir una invitación 409;
// - aceptar: el primero paga la mitad; al aceptar el segundo, todos quedan en un
//   tercio y al primero se le devuelve lo que pagó de más;
// - sin saldo para su parte, 402 y nada se mueve;
// - cancelar: quien pidió recupera el total y cada invitado lo que pagó.
//
// Comprueba los saldos en el libro contable en cada paso. Todo lo que crea lo
// borra al final.
import crypto from "node:crypto";
import { createPool } from "./db-client.mjs";
import { closePostgres } from "../server/postgres.js";
import {
  inviteToSplitFare,
  listRideFareSplits,
  respondToFareSplit,
} from "../server/ride-fare-split-repository.js";
import {
  cancelMobilityJobAndRefundWallet,
  captureWalletPayment,
} from "../server/wallet-repository.js";

const base = process.env.API_URL || "http://127.0.0.1:4000/api",
  pool = createPool(),
  marca = `split-${crypto.randomBytes(4).toString("hex")}`,
  rideId = `RID-SPL-${marca}`;
const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
const espera = async (promesa) => {
  try {
    await promesa;
    return null;
  } catch (error) {
    return error;
  }
};

const usuarios = {};
const saldo = async (userId) =>
  Number(
    (
      await pool.query(
        `SELECT COALESCE(sum(CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END),0)::bigint b
         FROM ledger_accounts a JOIN ledger_entries e ON e.account_id=a.id
         WHERE a.owner_type='user' AND a.owner_id=$1 AND a.account_type='wallet'`,
        [userId],
      )
    ).rows[0].b,
  );

let jobId = null;
try {
  // --- Cuentas sintéticas con saldo -----------------------------------------
  for (const [clave, cargaCents] of [
    ["pide", 900000],
    ["ana", 500000],
    ["beto", 500000],
    ["sinsaldo", 0],
  ]) {
    const user = (
      await pool.query(
        `INSERT INTO users(public_id,email,password_hash,name,email_verified_at)
         VALUES($1,$1||'@flash.test','x',$2,now()) RETURNING id,public_id,email`,
        [`${marca}-${clave}`, `${clave[0].toUpperCase()}${clave.slice(1)} Sintético`],
      )
    ).rows[0];
    await pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,'customer')", [user.id]);
    usuarios[clave] = user;
    if (!cargaCents) continue;
    const cuenta = (
      await pool.query(
        `INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type) VALUES('user',$1,'ARS','wallet') RETURNING id`,
        [user.id],
      )
    ).rows[0].id;
    const clearing = (
      await pool.query(
        `INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type) VALUES('platform',NULL,'ARS','cash_clearing')
         ON CONFLICT (owner_type,currency,account_type) WHERE owner_id IS NULL DO UPDATE SET owner_type=EXCLUDED.owner_type RETURNING id`,
      )
    ).rows[0].id;
    const tx = (
      await pool.query(
        `INSERT INTO ledger_transactions(idempotency_key,kind,description) VALUES($1,'sandbox_topup','Carga de prueba') RETURNING id`,
        [`${marca}-topup-${clave}`],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type)
       VALUES($1,$2,'credit',$4,'sandbox_topup'),($1,$3,'debit',$4,'sandbox_topup')`,
      [tx, cuenta, clearing, cargaCents],
    );
  }

  // --- Un viaje en curso, cobrado de verdad desde la Wallet -------------------
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    jobId = (
      await client.query(
        `INSERT INTO jobs(public_id,kind,customer_id,status,pickup_address,pickup_location,dropoff_address,
           dropoff_location,service_level,quoted_amount_cents,final_amount_cents,distance_m,estimated_duration_s,
           payment_method_label)
         VALUES($1,'ride',$2,'in_progress','Obelisco',ST_SetSRID(ST_MakePoint(-58.3816,-34.6037),4326)::geography,
           'Aeroparque',ST_SetSRID(ST_MakePoint(-58.4156,-34.5592),4326)::geography,'economy',900000,900000,7200,1500,
           'Flash Wallet')
         RETURNING id`,
        [rideId, usuarios.pide.id],
      )
    ).rows[0].id;
    await captureWalletPayment(client, {
      jobId,
      customerId: usuarios.pide.id,
      amountCents: 900000,
      idempotencyKey: `${marca}-viaje`,
      description: `Viaje ${rideId}`,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  assert((await saldo(usuarios.pide.id)) === 0, "quien pide pagó el viaje entero");

  // --- Invitar ----------------------------------------------------------------
  const sinCuenta = await espera(
    inviteToSplitFare({
      ridePublicId: rideId,
      userPublicId: usuarios.pide.public_id,
      email: `${marca}-nadie@flash.test`,
    }),
  );
  assert(sinCuenta?.status === 404, "un email sin cuenta Flash no se puede invitar");
  const ana = await inviteToSplitFare({
    ridePublicId: rideId,
    userPublicId: usuarios.pide.public_id,
    email: usuarios.ana.email,
  });
  const repetida = await espera(
    inviteToSplitFare({
      ridePublicId: rideId,
      userPublicId: usuarios.pide.public_id,
      email: usuarios.ana.email,
    }),
  );
  assert(ana.status === "invited" && repetida?.status === 409, "se invita una vez a cada persona");
  const ajena = await espera(
    inviteToSplitFare({
      ridePublicId: rideId,
      userPublicId: usuarios.ana.public_id,
      email: usuarios.beto.email,
    }),
  );
  assert(ajena?.status === 403, "sólo quien pidió el viaje puede dividirlo");

  // --- Aceptar y reequilibrar --------------------------------------------------
  const aceptaAna = await respondToFareSplit({
    splitPublicId: ana.id,
    userPublicId: usuarios.ana.public_id,
    accept: true,
  });
  assert(aceptaAna.share === 4500, "la primera en aceptar paga la mitad");
  assert(
    (await saldo(usuarios.ana.id)) === 50000 && (await saldo(usuarios.pide.id)) === 450000,
    "la mitad pasa de su Wallet a la de quien pidió",
  );
  const beto = await inviteToSplitFare({
    ridePublicId: rideId,
    userPublicId: usuarios.pide.public_id,
    email: usuarios.beto.email,
  });
  await respondToFareSplit({
    splitPublicId: beto.id,
    userPublicId: usuarios.beto.public_id,
    accept: true,
  });
  assert(
    (await saldo(usuarios.pide.id)) === 600000 &&
      (await saldo(usuarios.ana.id)) === 200000 &&
      (await saldo(usuarios.beto.id)) === 200000,
    "al aceptar el segundo, los tres quedan en un tercio y a la primera se le devuelve el resto",
  );

  // --- Sin saldo ----------------------------------------------------------------
  const sinSaldo = await inviteToSplitFare({
    ridePublicId: rideId,
    userPublicId: usuarios.pide.public_id,
    email: usuarios.sinsaldo.email,
  });
  const rechazo = await espera(
    respondToFareSplit({
      splitPublicId: sinSaldo.id,
      userPublicId: usuarios.sinsaldo.public_id,
      accept: true,
    }),
  );
  assert(
    rechazo?.status === 402 && (await saldo(usuarios.pide.id)) === 600000,
    "sin saldo para su parte no se acepta, y nada se mueve",
  );
  const lista = await listRideFareSplits({
    ridePublicId: rideId,
    userPublicId: usuarios.pide.public_id,
  });
  assert(
    lista.filter((split) => split.status === "accepted").length === 2 && lista.length === 3,
    "quien pidió ve con quién divide y en qué estado",
  );

  // --- Cancelar -----------------------------------------------------------------
  await cancelMobilityJobAndRefundWallet({
    publicId: rideId,
    kind: "ride",
    actorPublicId: usuarios.pide.public_id,
  });
  assert(
    (await saldo(usuarios.pide.id)) === 900000 &&
      (await saldo(usuarios.ana.id)) === 500000 &&
      (await saldo(usuarios.beto.id)) === 500000,
    "al cancelar, cada uno recupera exactamente lo que había pagado",
  );

  // --- La ruta, cableada ----------------------------------------------------------
  const login = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "cliente@flash.app",
      password: "demo123",
      deviceName: "fare-splits-smoke",
    }),
  }).then((response) => response.json());
  const invitaciones = await fetch(`${base}/me/fare-split-invitations`, {
    headers: { Authorization: `Bearer ${login.token}` },
  });
  assert(invitaciones.status === 200, "la ruta de invitaciones responde");
} finally {
  const ids = Object.values(usuarios).map((user) => user.id);
  const claves = (
    await pool.query(
      `SELECT DISTINCT t.id FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id=t.id
       JOIN ledger_accounts a ON a.id=e.account_id WHERE a.owner_id = ANY($1)`,
      [ids],
    )
  ).rows.map((row) => row.id);
  await pool.query("DELETE FROM ledger_entries WHERE transaction_id = ANY($1)", [claves]);
  await pool.query("DELETE FROM ledger_transactions WHERE id = ANY($1)", [claves]);
  if (jobId) {
    await pool.query(
      "DELETE FROM refunds WHERE payment_intent_id IN (SELECT id FROM payment_intents WHERE job_id=$1)",
      [jobId],
    );
    await pool.query("DELETE FROM payment_intents WHERE job_id=$1", [jobId]);
    await pool.query("DELETE FROM job_cancellations WHERE job_id=$1", [jobId]);
    await pool.query("DELETE FROM job_events WHERE job_id=$1", [jobId]);
    await pool.query("DELETE FROM jobs WHERE id=$1", [jobId]);
  }
  await pool.query("DELETE FROM ledger_accounts WHERE owner_type='user' AND owner_id = ANY($1)", [
    ids,
  ]);
  await pool.query("DELETE FROM notifications WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM user_roles WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM users WHERE id = ANY($1)", [ids]);
  await pool.end();
  await closePostgres();
}
