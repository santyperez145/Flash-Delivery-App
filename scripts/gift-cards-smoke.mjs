// Tarjetas de regalo (PAG-04) contra PostgreSQL.
//
// Con cuatro cuentas sintéticas —quien compra, quien recibe por email, quien canjea
// con el código y una sin saldo— y saldo cargado de verdad en el libro contable:
//
// - comprar: sale de la Wallet y entra a la cuenta de la plataforma; sin saldo,
//   402 y nada se mueve; repetir la clave devuelve la misma tarjeta sin cobrar otra;
// - el código no se guarda en claro: se busca por HMAC y se lee cifrado;
// - dirigir a un email sin cuenta responde igual que a uno con cuenta;
// - canjear por cuenta (sin código) y por código; un código ya usado, uno mal
//   escrito y el propio de quien compró se rechazan;
// - anular devuelve la plata a quien compró y el código deja de servir;
// - la cuenta de la plataforma queda en cero cuando no hay tarjetas vigentes;
// - un canje en carrera con el borrado de la cuenta no acredita una cuenta borrada;
// - una tarjeta vigente sigue en la lista aunque haya 50 cerradas más nuevas;
// - con la verificación en dos pasos, el reintento de una compra cuya respuesta se
//   perdió devuelve la misma tarjeta aunque traiga el código ya usado, y una compra
//   nueva con ese código se rechaza;
// - la misma clave con otros datos responde 409 y no cobra;
// - una compra que se iba a rechazar por saldo no gasta el código del segundo factor.
//
// Todo lo que crea lo borra al final.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import { createPool } from "./db-client.mjs";
import { closePostgres } from "../server/postgres.js";
import {
  cancelGiftCard,
  claimGiftCard,
  listGiftCards,
  normalizeGiftCardCode,
  purchaseGiftCard,
  redeemGiftCardCode,
} from "../server/gift-card-repository.js";

const base = process.env.API_URL || "http://127.0.0.1:4000/api",
  pool = createPool(),
  marca = `gift-${crypto.randomBytes(4).toString("hex")}`;
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
const tarjetas = [];
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
// Lo que esta prueba dejó en la cuenta de la plataforma: sólo sus tarjetas, para no
// depender de otras corridas que compartan la base.
const pasivoPropio = async () =>
  Number(
    (
      await pool.query(
        `SELECT COALESCE(sum(CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END),0)::bigint b
         FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.account_id
         WHERE a.owner_type='platform' AND a.account_type='gift_card_liability' AND e.reference_id = ANY($1)`,
        [tarjetas],
      )
    ).rows[0].b,
  );
const idDe = async (publicId) =>
  (await pool.query("SELECT id FROM gift_cards WHERE public_id=$1", [publicId])).rows[0].id;

try {
  // --- Cuentas sintéticas con saldo -----------------------------------------
  for (const [clave, cargaCents] of [
    ["compra", 5000000],
    ["recibe", 0],
    ["canjea", 0],
    ["sinsaldo", 50000],
    ["borrada", 0],
    ["segura", 1000000],
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
  const { compra, recibe, canjea, sinsaldo, borrada, segura } = usuarios;

  // --- Comprar ------------------------------------------------------------------
  const dirigida = await purchaseGiftCard({
    userPublicId: compra.public_id,
    amount: 10000,
    recipientEmail: recibe.email.toUpperCase(),
    message: "¡Feliz cumple!",
    idempotencyKey: `${marca}-dirigida`,
  });
  tarjetas.push(await idDe(dirigida.card.id));
  assert(dirigida.card.status === "active" && dirigida.card.amount === 10000, "compra una tarjeta");
  assert((await saldo(compra.id)) === 4000000, "el importe sale de la Wallet de quien compra");
  assert((await pasivoPropio()) === 1000000, "y entra a la cuenta de la plataforma");
  // El reintento trae los mismos datos, escritos como los escribió la persona.
  const repetida = await purchaseGiftCard({
    userPublicId: compra.public_id,
    amount: 10000,
    recipientEmail: ` ${recibe.email.toUpperCase()} `,
    message: "¡Feliz cumple!  ",
    idempotencyKey: `${marca}-dirigida`,
  });
  assert(
    repetida.replayed &&
      repetida.card.id === dirigida.card.id &&
      (await saldo(compra.id)) === 4000000,
    "repetir la clave devuelve la misma tarjeta y no cobra otra",
  );
  for (const [cambio, datos] of [
    ["el importe", { amount: 20000, recipientEmail: recibe.email, message: "¡Feliz cumple!" }],
    ["el destinatario", { amount: 10000, message: "¡Feliz cumple!" }],
    ["el mensaje", { amount: 10000, recipientEmail: recibe.email, message: "Otro" }],
  ]) {
    const distinta = await espera(
      purchaseGiftCard({
        userPublicId: compra.public_id,
        idempotencyKey: `${marca}-dirigida`,
        ...datos,
      }),
    );
    assert(
      distinta?.status === 409 && (await saldo(compra.id)) === 4000000,
      `la misma clave con otro valor en ${cambio} se rechaza y no cobra`,
    );
  }

  // El código no se guarda en claro.
  const fila = (await pool.query("SELECT * FROM gift_cards WHERE public_id=$1", [dirigida.card.id]))
    .rows[0];
  const crudo = normalizeGiftCardCode(dirigida.card.code);
  assert(
    crudo && !JSON.stringify(fila).includes(crudo) && fila.code_last4 === crudo.slice(-4),
    "el código no queda en claro en la base",
  );
  assert(
    fila.recipient_id === recibe.id && fila.recipient_email === recibe.email.toLowerCase(),
    "dirigida a la cuenta del email, sin importar mayúsculas",
  );
  const avisoRecibe = (
    await pool.query(
      "SELECT count(*)::int c FROM notifications WHERE user_id=$1 AND template='gift_card_received'",
      [recibe.id],
    )
  ).rows[0].c;
  assert(avisoRecibe === 1, "quien la recibe tiene el aviso");
  const avisoCompra = (
    await pool.query(
      "SELECT count(*)::int c FROM notifications WHERE user_id=$1 AND template='account_security_change' AND payload->>'event'='gift_card_purchased'",
      [compra.id],
    )
  ).rows[0].c;
  assert(avisoCompra === 1, "quien compró recibe el email de la compra");

  // Un email sin cuenta responde igual: dirigir no dice quién la tiene.
  const sinCuenta = await purchaseGiftCard({
    userPublicId: compra.public_id,
    amount: 5000,
    recipientEmail: `${marca}-nadie@flash.test`,
    idempotencyKey: `${marca}-sin-cuenta`,
  });
  tarjetas.push(await idDe(sinCuenta.card.id));
  assert(
    sinCuenta.card.status === "active" &&
      Object.keys(sinCuenta.card).join() === Object.keys(dirigida.card).join(),
    "un email sin cuenta responde igual que uno con cuenta",
  );

  const sinFondos = await espera(
    purchaseGiftCard({
      userPublicId: sinsaldo.public_id,
      amount: 1000,
      idempotencyKey: `${marca}-sin-saldo`,
    }),
  );
  assert(
    sinFondos?.status === 402 && (await saldo(sinsaldo.id)) === 50000,
    "sin saldo, 402 y nada se mueve",
  );
  const chica = await espera(
    purchaseGiftCard({
      userPublicId: compra.public_id,
      amount: 999,
      idempotencyKey: `${marca}-chica`,
    }),
  );
  assert(chica?.status === 400, "por debajo del mínimo, 400");
  const propia = await espera(
    purchaseGiftCard({
      userPublicId: compra.public_id,
      amount: 1000,
      recipientEmail: compra.email,
      idempotencyKey: `${marca}-propia`,
    }),
  );
  assert(propia?.status === 400, "no se dirige a la propia cuenta");

  // --- Canjear --------------------------------------------------------------------
  const lista = await listGiftCards(recibe.public_id);
  assert(
    lista.received.length === 1 &&
      lista.received[0].message === "¡Feliz cumple!" &&
      !("code" in lista.received[0]),
    "quien la recibe la ve en su Wallet, con el mensaje y sin el código",
  );
  const ajena = await espera(
    claimGiftCard({ userPublicId: canjea.public_id, giftCardPublicId: dirigida.card.id }),
  );
  assert(ajena?.status === 404, "otra cuenta no la canjea sin el código");
  await claimGiftCard({ userPublicId: recibe.public_id, giftCardPublicId: dirigida.card.id });
  assert((await saldo(recibe.id)) === 1000000, "canjeada por cuenta, el importe entra a su Wallet");
  const otraVez = await espera(
    redeemGiftCardCode({ userPublicId: canjea.public_id, code: dirigida.card.code }),
  );
  assert(otraVez?.status === 409, "un código ya canjeado no vuelve a servir");
  assert(
    (
      await pool.query("SELECT code_ciphertext FROM gift_cards WHERE public_id=$1", [
        dirigida.card.id,
      ])
    ).rows[0].code_ciphertext === null,
    "al canjearse, el código cifrado se borra",
  );

  // Con el código, en minúsculas y sin guiones, como lo escribe una persona.
  const suelta = await purchaseGiftCard({
    userPublicId: compra.public_id,
    amount: 20000,
    idempotencyKey: `${marca}-suelta`,
  });
  tarjetas.push(await idDe(suelta.card.id));
  const mia = await espera(
    redeemGiftCardCode({ userPublicId: compra.public_id, code: suelta.card.code }),
  );
  assert(mia?.status === 409, "quien compró no la canjea: la anula");
  const mal = await espera(
    redeemGiftCardCode({ userPublicId: canjea.public_id, code: "ABCD-EFGH-JKLM-NPQR" }),
  );
  const basura = await espera(
    redeemGiftCardCode({ userPublicId: canjea.public_id, code: "no es un código" }),
  );
  assert(
    mal?.status === 404 && basura?.status === 404,
    "un código inexistente y uno mal escrito responden igual",
  );
  await redeemGiftCardCode({
    userPublicId: canjea.public_id,
    code: suelta.card.code.toLowerCase().replaceAll("-", " "),
  });
  assert(
    (await saldo(canjea.id)) === 2000000,
    "canjeada con el código, el importe entra a su Wallet",
  );
  const avisoCanje = (
    await pool.query(
      "SELECT count(*)::int c FROM notifications WHERE user_id=$1 AND template='gift_card_redeemed'",
      [compra.id],
    )
  ).rows[0].c;
  assert(avisoCanje === 2, "quien compró se entera de cada canje");

  // --- Anular ---------------------------------------------------------------------
  const antes = await saldo(compra.id);
  const anulada = await cancelGiftCard({
    userPublicId: compra.public_id,
    giftCardPublicId: sinCuenta.card.id,
  });
  assert(
    anulada.status === "cancelled" &&
      anulada.code === null &&
      (await saldo(compra.id)) === antes + 500000,
    "anular devuelve el importe a quien compró",
  );
  const anuladaCodigo = await espera(
    redeemGiftCardCode({ userPublicId: canjea.public_id, code: sinCuenta.card.code }),
  );
  assert(anuladaCodigo?.status === 409, "el código de una anulada no sirve");
  const ajenaAnular = await espera(
    cancelGiftCard({ userPublicId: canjea.public_id, giftCardPublicId: suelta.card.id }),
  );
  assert(ajenaAnular?.status === 404, "sólo quien compró la anula");
  const canjeadaAnular = await espera(
    cancelGiftCard({ userPublicId: compra.public_id, giftCardPublicId: suelta.card.id }),
  );
  assert(canjeadaAnular?.status === 409, "una canjeada no se anula");

  // --- El libro cuadra --------------------------------------------------------------
  assert((await pasivoPropio()) === 0, "sin tarjetas vigentes, la plataforma no debe nada");
  assert(
    (await saldo(compra.id)) + (await saldo(recibe.id)) + (await saldo(canjea.id)) === 5000000,
    "la plata no se crea ni se pierde: sólo cambió de Wallet",
  );
  const compradas = await listGiftCards(compra.public_id);
  assert(
    compradas.purchased.length === 3 && compradas.purchased.every((card) => card.code === null),
    "quien compró ve sus tarjetas; el código ya no, porque ninguna está vigente",
  );

  // --- Canje en carrera con el borrado de la cuenta ---------------------------------
  // El borrado real (`app.delete_customer_account`) toma la fila de la cuenta y la
  // marca borrada; mientras no confirma, el canje tiene que esperarlo y, después,
  // rechazarse. Sin el bloqueo, el canje leía la cuenta activa y acreditaba la plata
  // en una cuenta que ya no existe.
  const carrera = await purchaseGiftCard({
    userPublicId: compra.public_id,
    amount: 3000,
    idempotencyKey: `${marca}-carrera`,
  });
  tarjetas.push(await idDe(carrera.card.id));
  const borrado = await pool.connect();
  let canjeEnCarrera = null;
  let canjeTermino = false;
  try {
    await borrado.query("BEGIN");
    await borrado.query("SELECT app.delete_customer_account($1)", [borrada.id]);
    canjeEnCarrera = espera(
      redeemGiftCardCode({ userPublicId: borrada.public_id, code: carrera.card.code }),
    ).then((resultado) => {
      canjeTermino = true;
      return resultado;
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert(!canjeTermino, "el canje espera a que el borrado de la cuenta termine");
    await borrado.query("COMMIT");
  } catch (failure) {
    await borrado.query("ROLLBACK");
    throw failure;
  } finally {
    borrado.release();
  }
  const resultadoCarrera = await canjeEnCarrera;
  assert(
    resultadoCarrera?.status === 404 && (await saldo(borrada.id)) === 0,
    "y después se rechaza: nada se acredita en la cuenta borrada",
  );
  assert(
    (await pool.query("SELECT status FROM gift_cards WHERE public_id=$1", [carrera.card.id]))
      .rows[0].status === "active",
    "la tarjeta sigue vigente para quien tenga el código",
  );

  // --- Una vigente vieja no se pierde detrás de 50 cerradas ---------------------------
  for (let i = 0; i < 51; i += 1)
    await pool.query(
      `INSERT INTO gift_cards(public_id,code_hash,code_last4,amount_cents,purchaser_id,status,
         cancelled_at,created_at)
       VALUES($1,$2,'WXYZ',100000,$3,'cancelled',now(),now() + make_interval(secs => $4))`,
      [`GFT-${marca}-${i}`, `${marca}-cerrada-${i}`, compra.id, i + 1],
    );
  const conHistoria = await listGiftCards(compra.public_id);
  const vigente = conHistoria.purchased.find((card) => card.id === carrera.card.id);
  assert(
    vigente?.code === carrera.card.code &&
      conHistoria.purchased.filter((card) => card.status !== "active").length === 50,
    "una vigente sigue en la lista, con su código, aunque haya 50 cerradas más nuevas",
  );
  await cancelGiftCard({ userPublicId: compra.public_id, giftCardPublicId: carrera.card.id });

  // --- Reintento de una compra con verificación en dos pasos --------------------------
  const password = `Clave-${crypto.randomBytes(9).toString("base64url")}`;
  await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
    await bcrypt.hash(password, 10),
    segura.id,
  ]);
  const api = async (path, { token, body, headers = {} } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };
  const ingreso = await api("/auth/login", {
    body: { email: segura.email, password, deviceName: "gift-cards-smoke" },
  });
  const alta = await api("/auth/mfa/enroll", { token: ingreso.body.token, body: {} });
  const secreto = alta.body.enrollment.secret;
  const confirmada = await api("/auth/mfa/confirm", {
    token: ingreso.body.token,
    body: { code: authenticator.generate(secreto), deviceName: "gift-cards-smoke" },
  });
  assert(confirmada.status === 200 && confirmada.body.token, "la cuenta activa el segundo factor");
  const sesion = confirmada.body.token;
  // Un código del paso siguiente: el de la activación ya se usó.
  const codigo = authenticator.clone({ epoch: Date.now() + 30000 }).generate(secreto);
  const claveSegura = `${marca}-segura-compra`;
  const comprarSegura = (key, mfaCode, amount = 1000) =>
    api("/gift-cards", {
      token: sesion,
      headers: { "Idempotency-Key": key },
      body: { amount, ...(mfaCode ? { mfaCode } : {}) },
    });
  const sinCodigo = await comprarSegura(`${marca}-segura-sin`);
  assert(
    sinCodigo.status === 403 && sinCodigo.body.mfaRequired,
    "sin el código, la compra se rechaza",
  );
  // Más que el saldo: se rechaza antes del segundo factor, y el código sigue sirviendo.
  const caro = await comprarSegura(`${marca}-segura-caro`, codigo, 50000);
  assert(caro.status === 402, "una compra sin saldo se rechaza antes de pedir el código");
  const primera = await comprarSegura(claveSegura, codigo);
  assert(
    primera.status === 201 && primera.body.card?.code,
    "con el mismo código, se compra: el rechazo por saldo no lo gastó",
  );
  tarjetas.push(await idDe(primera.body.card.id));
  const reintento = await comprarSegura(claveSegura, codigo);
  assert(
    reintento.status === 200 &&
      reintento.body.card.id === primera.body.card.id &&
      (await saldo(segura.id)) === 900000,
    "el reintento con el código ya usado devuelve la misma tarjeta, sin cobrar otra",
  );
  const otroImporte = await comprarSegura(claveSegura, codigo, 2000);
  assert(
    otroImporte.status === 409 && (await saldo(segura.id)) === 900000,
    "el reintento con la misma clave y otro importe responde 409",
  );
  const otraCompra = await comprarSegura(`${marca}-segura-otra`, codigo);
  assert(
    otraCompra.status === 403 && (await saldo(segura.id)) === 900000,
    "una compra nueva con el código ya usado se rechaza",
  );
  const avisosSegura = (
    await pool.query(
      `SELECT channel FROM notifications WHERE user_id=$1 AND deduplication_key LIKE 'security:gift_card_purchased:%'
`,
      [segura.id],
    )
  ).rows
    .map((row) => row.channel)
    .sort();
  assert(
    avisosSegura.join() === "email,push",
    "la compra encola, en su transacción, el aviso por push y por email",
  );

  // --- La ruta responde ---------------------------------------------------------------
  const login = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "cliente@flash.app",
      password: "demo123",
      deviceName: "gift-cards-smoke",
    }),
  }).then((response) => response.json());
  const ruta = await fetch(`${base}/me/gift-cards`, {
    headers: { Authorization: `Bearer ${login.token}` },
  });
  assert(
    ruta.status === 200 && ruta.headers.get("cache-control")?.includes("no-store"),
    "la ruta de tarjetas responde y no se guarda en caché",
  );
  const sinClave = await fetch(`${base}/gift-cards`, {
    method: "POST",
    headers: { Authorization: `Bearer ${login.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amount: 1000 }),
  });
  assert(sinClave.status === 400, "comprar sin Idempotency-Key se rechaza");
} finally {
  const ids = Object.values(usuarios).map((user) => user.id);
  const claves = (
    await pool.query(
      `SELECT DISTINCT t.id FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id=t.id
       JOIN ledger_accounts a ON a.id=e.account_id WHERE a.owner_id = ANY($1)
       UNION SELECT DISTINCT e.transaction_id FROM ledger_entries e WHERE e.reference_id = ANY($2)`,
      [ids, tarjetas],
    )
  ).rows.map((row) => row.id);
  await pool.query("DELETE FROM ledger_entries WHERE transaction_id = ANY($1)", [claves]);
  await pool.query("DELETE FROM ledger_transactions WHERE id = ANY($1)", [claves]);
  await pool.query("DELETE FROM gift_cards WHERE purchaser_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM ledger_accounts WHERE owner_type='user' AND owner_id = ANY($1)", [
    ids,
  ]);
  await pool.query("DELETE FROM notifications WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM audit_events WHERE actor_id = ANY($1) OR entity_id = ANY($2)", [
    ids,
    Object.values(usuarios).map((user) => user.public_id),
  ]);
  await pool.query("DELETE FROM refresh_sessions WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM user_mfa WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM user_roles WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM users WHERE id = ANY($1)", [ids]);
  await pool.end();
  await closePostgres();
}
