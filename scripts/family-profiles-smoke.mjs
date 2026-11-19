// Perfil familiar (PAG-05) contra PostgreSQL y la API.
//
// Con cuentas sintéticas —quien organiza, con saldo; dos miembros sin saldo, uno con
// tope; una que rechaza; una que borra su cuenta— recorre:
//
// - invitar: un email sin cuenta responde igual; repetido 409; a sí misma 400; el
//   perfil admite nueve personas;
// - responder: aceptar, rechazar, una invitación ajena (404), una ya respondida (409);
//   un miembro no organiza otro perfil;
// - un viaje por la API con «Perfil familiar»: se cobra de la Wallet de quien organiza,
//   con la membresía en el cobro y el aviso a quien organiza; no se puede dividir;
//   quien organiza no puede borrar su cuenta con ese viaje en curso; al cancelarlo,
//   la plata vuelve a quien organiza y no al miembro;
// - un envío por la API con «Perfil familiar»: igual; una etiqueta desconocida se
//   rechaza (antes creaba un envío sin cobrar);
// - el tope del mes: un viaje que lo supera responde 402 y no cobra; lo gastado se
//   suma y los reintegros lo devuelven;
// - un pedido con un reintegro parcial previo: al cancelarlo vuelve el resto, y a
//   quien pagó;
// - dejar el perfil y ser sacado: después no se paga con él;
// - borrar la cuenta de un miembro lo saca del perfil y borra el email escrito.
//
// Comprueba los saldos en el libro contable en cada paso. Todo lo que crea lo borra.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { createPool } from "./db-client.mjs";
import { closePostgres } from "../server/postgres.js";
import {
  getFamilyProfile,
  inviteFamilyMember,
  leaveFamilyProfile,
  removeFamilyMember,
  resolveFamilyPayer,
  respondFamilyInvitation,
  setFamilyMemberLimit,
} from "../server/family-profile-repository.js";
import { inviteToSplitFare } from "../server/ride-fare-split-repository.js";
import { cancelOrderAndRefundWallet, captureWalletPayment } from "../server/wallet-repository.js";

const base = process.env.API_URL || "http://127.0.0.1:4000/api",
  pool = createPool(),
  marca = `fam-${crypto.randomBytes(4).toString("hex")}`,
  password = `Clave-${crypto.randomBytes(9).toString("base64url")}`;
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
const avisos = async (userId, template) =>
  Number(
    (
      await pool.query(
        "SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND template=$2",
        [userId, template],
      )
    ).rows[0].n,
  );
async function api(path, { token, body, method = body ? "POST" : "GET", headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
const ingresar = async (user) =>
  (
    await api("/auth/login", {
      body: { email: user.email, password, deviceName: "family-profiles-smoke" },
    })
  ).body;
const viaje = {
  pickup: "Obelisco",
  destination: "Aeroparque",
  service: "economy",
  pickupCoords: { lat: -34.6037, lng: -58.3816 },
  destinationCoords: { lat: -34.5592, lng: -58.4156 },
};
async function pedirViaje(sesion, paymentMethod) {
  const opciones = await api("/rides/options", { token: sesion.token, body: viaje });
  const cotizacion = opciones.body.options?.find((entry) => entry.service === "economy");
  if (!cotizacion?.quoteToken) throw new Error("sin cotización de viaje");
  const respuesta = await api("/rides", {
    token: sesion.token,
    headers: { "Idempotency-Key": `${marca}-viaje-${crypto.randomUUID()}` },
    body: {
      customerId: sesion.user.id,
      ...viaje,
      paymentMethod,
      quoteToken: cotizacion.quoteToken,
    },
  });
  return { ...respuesta, tarifa: cotizacion.fare };
}
const envio = (customerId) => ({
  customerId,
  pickup: "Defensa 982, San Telmo",
  destination: "Plaza Italia, Buenos Aires",
  pickupCoords: { lat: -34.6177, lng: -58.3621 },
  destinationCoords: { lat: -34.5814, lng: -58.4208 },
  recipientName: "Familia Sintética",
  recipientPhone: "+5491100000000",
  packageSize: "small",
  description: "Documentos",
  weightKg: 0.5,
  deliveryNotes: "Recepción",
  termsAccepted: true,
});
async function pedirEnvio(sesion, paymentMethod) {
  const datos = { ...envio(sesion.user.id), paymentMethod };
  const cotizacion = await api("/shipments/quote", { token: sesion.token, body: datos });
  return api("/shipments", {
    token: sesion.token,
    headers: { "Idempotency-Key": `${marca}-envio-${crypto.randomUUID()}` },
    body: { ...datos, quoteToken: cotizacion.body.quote?.quoteToken },
  });
}
const cobroDe = async (jobPublicId) =>
  (
    await pool.query(
      `SELECT p.* FROM payment_intents p JOIN jobs j ON j.id=p.job_id WHERE j.public_id=$1
       ORDER BY p.created_at DESC LIMIT 1`,
      [jobPublicId],
    )
  ).rows[0];

try {
  // --- Cuentas sintéticas -----------------------------------------------------
  // Con 30 días de antigüedad: una cuenta nueva suma puntos de riesgo, y esta prueba
  // no es sobre el control de riesgo.
  const hash = await bcrypt.hash(password, 10);
  for (const [clave, cargaCents] of [
    ["organiza", 50000000],
    ["ana", 0],
    ["beto", 0],
    ["caro", 0],
    ["dora", 0],
  ]) {
    const user = (
      await pool.query(
        `INSERT INTO users(public_id,email,password_hash,name,email_verified_at,created_at)
         VALUES($1,$1||'@flash.test',$2,$3,now(),now()-interval '30 days') RETURNING id,public_id,email`,
        [`${marca}-${clave}`, hash, `${clave[0].toUpperCase()}${clave.slice(1)} Sintética`],
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
  const { organiza, ana, beto, caro, dora } = usuarios;

  // --- Invitar ------------------------------------------------------------------
  const aAna = await inviteFamilyMember({ userPublicId: organiza.public_id, email: ana.email });
  const aBeto = await inviteFamilyMember({
    userPublicId: organiza.public_id,
    email: beto.email.toUpperCase(),
    monthlyLimit: 1000,
  });
  const aCaro = await inviteFamilyMember({ userPublicId: organiza.public_id, email: caro.email });
  const aNadie = await inviteFamilyMember({
    userPublicId: organiza.public_id,
    email: `${marca}-nadie@flash.test`,
  });
  assert(
    aAna.status === "invited" &&
      aBeto.monthlyLimit === 1000 &&
      Object.keys(aNadie).join() === Object.keys(aAna).join(),
    "invita por email; un email sin cuenta responde igual que uno con cuenta",
  );
  assert((await avisos(ana.id, "family_invite")) === 1, "quien tiene cuenta recibe la invitación");
  const repetida = await espera(
    inviteFamilyMember({ userPublicId: organiza.public_id, email: ana.email }),
  );
  const propia = await espera(
    inviteFamilyMember({ userPublicId: organiza.public_id, email: organiza.email }),
  );
  assert(repetida?.status === 409 && propia?.status === 400, "repetida 409; a sí misma 400");
  const relleno = [];
  for (let i = 0; i < 5; i += 1)
    relleno.push(
      await inviteFamilyMember({
        userPublicId: organiza.public_id,
        email: `${marca}-relleno-${i}@flash.test`,
      }),
    );
  const decima = await espera(
    inviteFamilyMember({ userPublicId: organiza.public_id, email: `${marca}-decima@flash.test` }),
  );
  assert(decima?.status === 409, "el perfil admite nueve personas además de quien organiza");
  for (const fila of [...relleno, aNadie])
    await removeFamilyMember({ userPublicId: organiza.public_id, memberPublicId: fila.id });

  // --- Responder ----------------------------------------------------------------
  const ajena = await espera(
    respondFamilyInvitation({
      userPublicId: beto.public_id,
      memberPublicId: aAna.id,
      accept: true,
    }),
  );
  assert(ajena?.status === 404, "una invitación ajena responde como inexistente");
  await respondFamilyInvitation({
    userPublicId: ana.public_id,
    memberPublicId: aAna.id,
    accept: true,
  });
  await respondFamilyInvitation({
    userPublicId: beto.public_id,
    memberPublicId: aBeto.id,
    accept: true,
  });
  await respondFamilyInvitation({
    userPublicId: caro.public_id,
    memberPublicId: aCaro.id,
    accept: false,
  });
  const otraVez = await espera(
    respondFamilyInvitation({ userPublicId: ana.public_id, memberPublicId: aAna.id, accept: true }),
  );
  assert(otraVez?.status === 409, "una invitación ya respondida no se vuelve a responder");
  assert((await avisos(organiza.id, "family_member_joined")) === 2, "quien organiza se entera");
  const vistaOrganiza = await getFamilyProfile(organiza.public_id);
  const vistaAna = await getFamilyProfile(ana.public_id);
  assert(
    vistaOrganiza.role === "organizer" &&
      vistaOrganiza.organizer.activeMembers === 2 &&
      vistaOrganiza.organizer.members.every((m) => m.status === "active"),
    "quien organiza ve a sus dos miembros activos; la rechazada y las retiradas no",
  );
  assert(
    vistaAna.role === "member" &&
      vistaAna.membership.organizerName === "Organiza" &&
      vistaAna.membership.remaining === null &&
      !JSON.stringify(vistaAna).includes(String(50000000 / 100)),
    "un miembro ve quién paga y que no tiene tope, nunca el saldo de quien organiza",
  );
  const organizaOtro = await espera(
    inviteFamilyMember({ userPublicId: ana.public_id, email: caro.email }),
  );
  assert(organizaOtro?.status === 409, "un miembro no organiza otro perfil");

  // --- Un viaje con «Perfil familiar» ------------------------------------------
  const sesionAna = await ingresar(ana);
  const antesOrganiza = await saldo(organiza.id);
  const viajeAna = await pedirViaje(sesionAna, "Perfil familiar");
  assert(
    viajeAna.status === 200 && viajeAna.body.ride?.id,
    "un miembro pide un viaje con el perfil",
  );
  const rideId = viajeAna.body.ride.id;
  const tarifaCents = Math.round(viajeAna.tarifa * 100);
  const cobroViaje = await cobroDe(rideId);
  assert(
    (await saldo(organiza.id)) === antesOrganiza - tarifaCents &&
      (await saldo(ana.id)) === 0 &&
      cobroViaje.customer_id === organiza.id &&
      cobroViaje.family_member_id !== null,
    "el viaje se cobra de la Wallet de quien organiza, con la membresía en el cobro",
  );
  assert(
    (await avisos(organiza.id, "family_charge")) === 1,
    "quien organiza recibe el aviso del cobro",
  );
  const dividir = await espera(
    inviteToSplitFare({ ridePublicId: rideId, userPublicId: ana.public_id, email: caro.email }),
  );
  assert(dividir?.status === 409, "un viaje pagado con el perfil no se divide");

  // Quien organiza no borra su cuenta con un servicio en curso pagado por ella: una
  // cancelación le va a devolver plata. Se prueba el trigger directo, porque el
  // borrado completo frena antes por el saldo de su Wallet.
  const borrado = await pool.connect();
  let rechazoBorrado = null;
  try {
    await borrado.query("BEGIN");
    rechazoBorrado = await espera(
      borrado.query("UPDATE users SET status='deleted' WHERE id=$1", [organiza.id]),
    );
  } finally {
    await borrado.query("ROLLBACK");
    borrado.release();
  }
  assert(
    /FLASH_DELETE_ACTIVE_JOB/.test(String(rechazoBorrado?.message)),
    "quien organiza no borra su cuenta con un servicio pagado en curso",
  );

  const cancelado = await api(`/rides/${rideId}/status`, {
    token: sesionAna.token,
    method: "PATCH",
    body: { status: "cancelled", reason: "changed_mind" },
  });
  assert(
    cancelado.status === 200 &&
      (await saldo(organiza.id)) === antesOrganiza &&
      (await saldo(ana.id)) === 0,
    "al cancelar, la plata vuelve a quien organiza y no al miembro",
  );
  assert(
    (await avisos(organiza.id, "family_refund")) === 1,
    "quien organiza se entera del reintegro",
  );

  // --- Un envío con «Perfil familiar» ------------------------------------------
  const desconocido = await pedirEnvio(sesionAna, "Tarjeta de un amigo");
  assert(desconocido.status === 400, "un envío con un medio desconocido se rechaza");
  const envioAna = await pedirEnvio(sesionAna, "Perfil familiar");
  const shipmentId = envioAna.body.shipment?.id;
  const cobroEnvio = shipmentId ? await cobroDe(shipmentId) : null;
  assert(
    envioAna.status === 200 &&
      cobroEnvio?.customer_id === organiza.id &&
      (await saldo(organiza.id)) === antesOrganiza - Number(cobroEnvio.captured_amount_cents),
    "un envío con el perfil se cobra de quien organiza",
  );
  const envioCancelado = await api(`/shipments/${shipmentId}/status`, {
    token: sesionAna.token,
    method: "PATCH",
    body: { status: "cancelled", reason: "changed_mind" },
  });
  assert(
    envioCancelado.status === 200 && (await saldo(organiza.id)) === antesOrganiza,
    "al cancelar el envío, la plata vuelve a quien organiza",
  );

  // --- El tope del mes ------------------------------------------------------------
  const sesionBeto = await ingresar(beto);
  const antesTope = await saldo(organiza.id);
  const sobreTope = await pedirViaje(sesionBeto, "Perfil familiar");
  assert(
    sobreTope.status === 402 && (await saldo(organiza.id)) === antesTope,
    "un viaje que supera el tope responde 402 y no cobra",
  );
  await setFamilyMemberLimit({
    userPublicId: organiza.public_id,
    memberPublicId: aBeto.id,
    monthlyLimit: 3000,
  });
  const job = async (publicId, customerId) =>
    (
      await pool.query(
        `INSERT INTO jobs(public_id,kind,customer_id,status,pickup_address,pickup_location,dropoff_address,
           dropoff_location,service_level,quoted_amount_cents,final_amount_cents,distance_m,estimated_duration_s,
           payment_method_label,metadata)
         VALUES($1,'delivery',$2,'accepted','Comercio',ST_SetSRID(ST_MakePoint(-58.3816,-34.6037),4326)::geography,
           'Casa',ST_SetSRID(ST_MakePoint(-58.4156,-34.5592),4326)::geography,'standard',200000,200000,3000,900,
           'Perfil familiar','{"subtype":"food_order"}'::jsonb)
         RETURNING id`,
        [publicId, customerId],
      )
    ).rows[0].id;
  const pedidoBeto = `ORD-${marca}-beto`;
  const pedidoBetoId = await job(pedidoBeto, beto.id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const familia = await resolveFamilyPayer(client, { customerId: beto.id, amountCents: 200000 });
    await captureWalletPayment(client, {
      jobId: pedidoBetoId,
      customerId: familia.organizerId,
      amountCents: 200000,
      idempotencyKey: `${marca}-pedido-beto`,
      description: `Pedido ${pedidoBeto}`,
      familyMemberId: familia.familyMemberId,
    });
    await client.query("COMMIT");
  } catch (failure) {
    await client.query("ROLLBACK");
    throw failure;
  } finally {
    client.release();
  }
  const quedan = await getFamilyProfile(beto.public_id);
  assert(
    quedan.membership.spentThisMonth === 2000 && quedan.membership.remaining === 1000,
    "lo gastado se suma al mes y el miembro ve lo que le queda",
  );
  const tx = await pool.connect();
  let pasado = null;
  try {
    await tx.query("BEGIN");
    pasado = await espera(resolveFamilyPayer(tx, { customerId: beto.id, amountCents: 150000 }));
  } finally {
    await tx.query("ROLLBACK");
    tx.release();
  }
  assert(
    pasado?.status === 402 && /\$1\.000/.test(pasado.message),
    "pasarse del resto, 402 con lo que queda",
  );

  // Un reintegro parcial previo (una incidencia) y después la cancelación: vuelve el
  // resto, y a quien pagó.
  const antesParcial = await saldo(organiza.id);
  const cobroPedido = await cobroDe(pedidoBeto);
  const clearing = (
    await pool.query(
      "SELECT id FROM ledger_accounts WHERE owner_type='platform' AND owner_id IS NULL AND account_type='cash_clearing'",
    )
  ).rows[0].id;
  const walletOrganiza = (
    await pool.query(
      "SELECT id FROM ledger_accounts WHERE owner_type='user' AND owner_id=$1 AND account_type='wallet'",
      [organiza.id],
    )
  ).rows[0].id;
  const parcial = (
    await pool.query(
      `INSERT INTO ledger_transactions(idempotency_key,kind,description) VALUES($1,'refund','Reintegro parcial') RETURNING id`,
      [`${marca}-parcial`],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id)
     VALUES($1,$2,'credit',50000,'refund',$4),($1,$3,'debit',50000,'refund',$4)`,
    [parcial, walletOrganiza, clearing, cobroPedido.id],
  );
  await pool.query(
    "UPDATE payment_intents SET status='partially_refunded',captured_amount_cents=150000 WHERE id=$1",
    [cobroPedido.id],
  );
  const cancelacion = await cancelOrderAndRefundWallet({
    orderPublicId: pedidoBeto,
    actorPublicId: beto.public_id,
  });
  assert(
    cancelacion.refunded &&
      cancelacion.refundAmount === 1500 &&
      (await saldo(organiza.id)) === antesParcial + 200000 &&
      (await saldo(beto.id)) === 0,
    "cancelar un pedido con un reintegro parcial devuelve el resto, a quien pagó",
  );
  assert(
    (await getFamilyProfile(beto.public_id)).membership.spentThisMonth === 0,
    "los reintegros bajan lo gastado en el mes",
  );

  // --- Dejar el perfil y ser sacado ------------------------------------------------
  await leaveFamilyProfile({ userPublicId: ana.public_id });
  const sinPerfil = await pedirViaje(sesionAna, "Perfil familiar");
  assert(
    sinPerfil.status === 409 && (await avisos(organiza.id, "family_member_left")) === 1,
    "quien deja el perfil ya no paga con él, y quien organiza se entera",
  );
  await removeFamilyMember({ userPublicId: organiza.public_id, memberPublicId: aBeto.id });
  assert(
    (await getFamilyProfile(beto.public_id)).role === "none" &&
      (await avisos(beto.id, "family_removed")) === 1,
    "a quien sacan del perfil se le avisa y ya no es miembro",
  );

  // --- Borrar la cuenta de un miembro ----------------------------------------------
  const aDora = await inviteFamilyMember({ userPublicId: organiza.public_id, email: dora.email });
  await respondFamilyInvitation({
    userPublicId: dora.public_id,
    memberPublicId: aDora.id,
    accept: true,
  });
  await pool.query("SELECT app.delete_customer_account($1)", [dora.id]);
  const filaDora = (
    await pool.query("SELECT status,invitee_email FROM family_members WHERE public_id=$1", [
      aDora.id,
    ])
  ).rows[0];
  assert(
    filaDora.status === "left" && filaDora.invitee_email === null,
    "borrar la cuenta de un miembro lo saca del perfil y borra el email escrito",
  );

  // --- La ruta responde -------------------------------------------------------------
  const ruta = await api("/me/family", { token: sesionAna.token });
  assert(
    ruta.status === 200 && ruta.body.family?.role === "none",
    "la ruta del perfil familiar responde",
  );
} finally {
  const ids = Object.values(usuarios).map((user) => user.id);
  const publicos = Object.values(usuarios).map((user) => user.public_id);
  const jobs = (
    await pool.query("SELECT id FROM jobs WHERE customer_id = ANY($1)", [ids])
  ).rows.map((row) => row.id);
  const intents = (
    await pool.query(
      "SELECT id FROM payment_intents WHERE job_id = ANY($1) OR customer_id = ANY($2)",
      [jobs, ids],
    )
  ).rows.map((row) => row.id);
  const claves = (
    await pool.query(
      `SELECT DISTINCT t.id FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id=t.id
       JOIN ledger_accounts a ON a.id=e.account_id WHERE a.owner_id = ANY($1)
       UNION SELECT DISTINCT e.transaction_id FROM ledger_entries e WHERE e.reference_id = ANY($2) OR e.reference_id = ANY($3)`,
      [ids, jobs, intents],
    )
  ).rows.map((row) => row.id);
  await pool.query("DELETE FROM ledger_entries WHERE transaction_id = ANY($1)", [claves]);
  await pool.query("DELETE FROM ledger_transactions WHERE id = ANY($1)", [claves]);
  await pool.query("DELETE FROM refunds WHERE payment_intent_id = ANY($1)", [intents]);
  await pool.query("DELETE FROM payment_intents WHERE id = ANY($1)", [intents]);
  // Lo que cuelga de los servicios creados: se busca en el catálogo para no depender
  // de una lista que se queda vieja cuando una migración suma una tabla.
  const hijas = (
    await pool.query(
      `SELECT c.conrelid::regclass::text tabla, a.attname columna
       FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
       WHERE c.contype='f' AND c.confrelid='jobs'::regclass AND array_length(c.conkey,1)=1`,
    )
  ).rows;
  for (let vuelta = 0; vuelta < 3; vuelta += 1)
    for (const { tabla, columna } of hijas)
      await pool.query(`DELETE FROM ${tabla} WHERE ${columna} = ANY($1)`, [jobs]).catch(() => null);
  await pool.query("DELETE FROM jobs WHERE id = ANY($1)", [jobs]);
  await pool.query(
    "DELETE FROM family_members WHERE profile_id IN (SELECT id FROM family_profiles WHERE organizer_id = ANY($1)) OR member_id = ANY($1)",
    [ids],
  );
  await pool.query("DELETE FROM family_profiles WHERE organizer_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM transaction_risk_assessments WHERE customer_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM idempotency_keys WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM ledger_accounts WHERE owner_type='user' AND owner_id = ANY($1)", [
    ids,
  ]);
  await pool.query("DELETE FROM audit_events WHERE actor_id = ANY($1) OR entity_id = ANY($2)", [
    ids,
    publicos,
  ]);
  await pool.query("DELETE FROM notifications WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM refresh_sessions WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM user_roles WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM users WHERE id = ANY($1)", [ids]);
  await pool.end();
  await closePostgres();
}
