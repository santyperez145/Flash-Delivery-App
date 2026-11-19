// Tarjetas de regalo (PAG-04), como las de Uber.
//
// Se compran con el saldo de Flash Wallet y se regalan con un código o dirigidas
// a otra cuenta Flash por su email. Quien la canjea recibe el importe en su
// Wallet. Quien la compró la puede anular mientras nadie la canjeó, y la plata le
// vuelve. No vence y no se cambia por dinero.
//
// **El dinero pasa por una cuenta de la plataforma** (`gift_card_liability`,
// migración 146): al comprar sale de la Wallet y entra ahí; al canjear o anular,
// sale de ahí. Su saldo es siempre la suma de las tarjetas vigentes, así que el
// libro contable dice cuánto debe Flash en tarjetas sin cruzar otra tabla.
//
// **El código es la tarjeta.** Dieciséis caracteres de un alfabeto de 32 (80 bits)
// sin 0, 1, O ni I, que se confunden al copiarlos. Se busca por HMAC y se guarda
// cifrado; nunca en claro, ni en un log, ni en la auditoría.
import crypto from "node:crypto";

import { enqueueSecurityAlert } from "./mfa-repository.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";
import { pesos } from "./money.js";
import { postgresPool } from "./postgres.js";
import { decryptGiftCardCode, encryptGiftCardCode, hashGiftCardCode } from "./secret-envelope.js";

export const GIFT_CARD_MIN_PESOS = 1000;
const ALFABETO = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const LARGO = 16;
const publicId = () => `GFT-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
const primerNombre = (nombre) => String(nombre || "").split(" ")[0] || "Alguien";
const importe = (cents) => `$${pesos(cents).toLocaleString("es-AR")}`;
const error = (message, status) => Object.assign(new Error(message), { status });

const generarCodigo = () =>
  Array.from({ length: LARGO }, () => ALFABETO[crypto.randomInt(ALFABETO.length)]).join("");

/** `ABCD-EFGH-JKLM-NPQR`: de a cuatro, como se lee en voz alta o se copia. */
export const formatGiftCardCode = (codigo) => codigo.match(/.{4}/g).join("-");

/** Lo que escribió la persona, sin espacios ni guiones y en mayúsculas; `null` si no puede ser un código. */
export function normalizeGiftCardCode(valor) {
  const codigo = String(valor || "")
    .toUpperCase()
    .replace(/[\s-]/g, "");
  return codigo.length === LARGO && [...codigo].every((c) => ALFABETO.includes(c)) ? codigo : null;
}

// Sin `DO UPDATE`: un upsert que actualiza bloquea la fila, y bloquear billeteras en
// distinto orden en dos transacciones las traba (mismo criterio que PAG-02).
const cuenta = async (client, { ownerType, ownerId, accountType }) => {
  await client.query(
    ownerId
      ? `INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type)
         VALUES($1,$2,'ARS',$3) ON CONFLICT(owner_type,owner_id,currency,account_type) DO NOTHING`
      : `INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type)
         VALUES($1,NULL,'ARS',$2) ON CONFLICT (owner_type,currency,account_type) WHERE owner_id IS NULL DO NOTHING`,
    ownerId ? [ownerType, ownerId, accountType] : [ownerType, accountType],
  );
  return (
    await client.query(
      `SELECT id FROM ledger_accounts WHERE owner_type=$1 AND owner_id IS NOT DISTINCT FROM $2::uuid
         AND currency='ARS' AND account_type=$3`,
      [ownerType, ownerId ?? null, accountType],
    )
  ).rows[0].id;
};
const wallet = (client, userId) =>
  cuenta(client, { ownerType: "user", ownerId: userId, accountType: "wallet" });
const pasivo = (client) =>
  cuenta(client, { ownerType: "platform", ownerId: null, accountType: "gift_card_liability" });

const saldo = async (client, accountId) =>
  Number(
    (
      await client.query(
        `SELECT COALESCE(sum(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END),0)::bigint balance
         FROM ledger_entries WHERE account_id=$1`,
        [accountId],
      )
    ).rows[0].balance,
  );

/** Un asiento `gift_card` cuadrado: `desde` se debita y `hacia` se acredita. */
async function asentar(client, { idempotencyKey, description, card, accion, desde, hacia }) {
  const transaccion = (
    await client.query(
      `INSERT INTO ledger_transactions(idempotency_key,kind,description,metadata)
       VALUES($1,'gift_card',$2,$3) RETURNING id`,
      [idempotencyKey, description, { giftCardId: card.public_id, action: accion }],
    )
  ).rows[0].id;
  await client.query(
    `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id)
     VALUES($1,$2,'debit',$4,'gift_card',$5),($1,$3,'credit',$4,'gift_card',$5)`,
    [transaccion, desde, hacia, card.amount_cents, card.id],
  );
}

// `FOR SHARE` hasta el final de la transacción: choca con el `FOR UPDATE` con que
// `app.delete_customer_account` empieza. Si el borrado llegó antes, la fila ya no está
// activa y esto responde 404; si llegó después, espera, ve el saldo nuevo y rechaza
// borrar la cuenta. Sin el bloqueo, un canje o una anulación en paralelo con el
// borrado acreditaba la plata en una cuenta ya borrada.
const usuarioActivo = async (client, userPublicId) => {
  const user = (
    await client.query(
      "SELECT id,name,email FROM users WHERE public_id=$1 AND status='active' FOR SHARE",
      [userPublicId],
    )
  ).rows[0];
  if (!user) throw error("Usuario no encontrado", 404);
  return user;
};

const claveCompra = (userId, idempotencyKey) => `gift_card:purchase:${userId}:${idempotencyKey}`;

/** Importe en centavos, email y mensaje tal como se guardan; 400 debajo del mínimo. */
const datosCompra = ({ amount, recipientEmail, message }) => {
  const amountCents = Math.round(Number(amount) * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents < GIFT_CARD_MIN_PESOS * 100)
    throw error(`El mínimo de una tarjeta de regalo es ${importe(GIFT_CARD_MIN_PESOS * 100)}`, 400);
  return {
    amountCents,
    correo: recipientEmail ? String(recipientEmail).trim().toLowerCase() : null,
    nota: message ? String(message).trim() || null : null,
  };
};

/**
 * Un reintento con la misma clave tiene que ser la misma compra. Si cambió el importe,
 * el destinatario o el mensaje, devolver la tarjeta anterior haría creer que se compró
 * la nueva: se responde 409, como las APIs de pago.
 */
const exigirMismaCompra = (row, { amountCents, correo, nota }) => {
  if (
    Number(row.amount_cents) !== amountCents ||
    (row.recipient_email ?? null) !== correo ||
    (row.message ?? null) !== nota
  )
    throw error(
      "Esa compra ya se hizo con otros datos. Revisá tus tarjetas antes de comprar otra.",
      409,
    );
};

/** Lo que ve quien compró: el código sólo mientras la tarjeta está vigente. */
const vistaComprada = (row) => ({
  id: row.public_id,
  amount: pesos(row.amount_cents),
  status: row.status,
  code: row.code_ciphertext ? formatGiftCardCode(decryptGiftCardCode(row.code_ciphertext)) : null,
  last4: row.code_last4,
  recipientEmail: row.recipient_email,
  message: row.message,
  createdAt: row.created_at,
  redeemedAt: row.redeemed_at,
  cancelledAt: row.cancelled_at,
});

/**
 * Compra una tarjeta con el saldo de la Wallet. `idempotencyKey` es el del
 * cliente: un doble toque o un reintento devuelve la misma tarjeta, no otra.
 */
export async function purchaseGiftCard({
  userPublicId,
  amount,
  recipientEmail = null,
  message = null,
  idempotencyKey,
}) {
  const datos = datosCompra({ amount, recipientEmail, message });
  const { amountCents, correo, nota } = datos;
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const user = await usuarioActivo(client, userPublicId);
    const clave = claveCompra(user.id, idempotencyKey);
    const walletId = await wallet(client, user.id);
    // Se bloquea la Wallet de quien compra: su saldo no cambia mientras se controla,
    // y dos compras simultáneas con el mismo saldo no pasan las dos.
    await client.query("SELECT id FROM ledger_accounts WHERE id=$1 FOR UPDATE", [walletId]);
    const repetida = (
      await client.query(
        `SELECT g.* FROM ledger_transactions t JOIN gift_cards g ON g.public_id=t.metadata->>'giftCardId'
         WHERE t.idempotency_key=$1`,
        [clave],
      )
    ).rows[0];
    if (repetida) {
      exigirMismaCompra(repetida, datos);
      await client.query("ROLLBACK");
      return { card: vistaComprada(repetida), replayed: true };
    }
    if ((await saldo(client, walletId)) < amountCents)
      throw error("Saldo insuficiente en Flash Wallet", 402);
    if (correo && correo === String(user.email).toLowerCase())
      throw error("La tarjeta es para regalar: no puede ser para tu propia cuenta", 400);
    // Dirigirla no dice quién tiene cuenta: un email que no es de un cliente activo
    // se guarda igual, sin destinatario, y la respuesta es la misma.
    const destinatario = correo
      ? (
          await client.query(
            // `FOR SHARE OF u`: si la cuenta se está borrando, se espera. Si el borrado
            // llegó antes, ya no está activa y la tarjeta se guarda sin destinatario; si
            // llega después, su trigger ve la tarjeta y borra el email y el mensaje.
            `SELECT u.id FROM users u JOIN user_roles r ON r.user_id=u.id AND r.role='customer'
             WHERE lower(u.email)=$1 AND u.status='active' AND u.id<>$2 LIMIT 1 FOR SHARE OF u`,
            [correo, user.id],
          )
        ).rows[0]
      : null;
    const codigo = generarCodigo();
    const card = (
      await client.query(
        `INSERT INTO gift_cards(public_id,code_hash,code_ciphertext,code_last4,amount_cents,purchaser_id,
           recipient_id,recipient_email,message)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          publicId(),
          hashGiftCardCode(codigo),
          encryptGiftCardCode(codigo),
          codigo.slice(-4),
          amountCents,
          user.id,
          destinatario?.id ?? null,
          correo,
          nota,
        ],
      )
    ).rows[0];
    await asentar(client, {
      idempotencyKey: clave,
      description: "Compraste una tarjeta de regalo",
      card,
      accion: "purchase",
      desde: walletId,
      hacia: await pasivo(client),
    });
    if (destinatario)
      await enqueueNotificationForInternalUser(client, {
        userId: destinatario.id,
        template: "gift_card_received",
        payload: {
          title: "Te regalaron una tarjeta",
          body: `${primerNombre(user.name)} te regaló ${importe(amountCents)} para usar en Flash.`,
          giftCardId: card.public_id,
        },
        deduplicationKey: `gift_card_received:${card.public_id}`,
      });
    // Aviso por push y email a quien compró: si no fue la persona, se entera ahora
    // y no cuando el saldo ya se canjeó en otra cuenta. Con la misma transacción: se
    // encola si y sólo si la compra se confirma.
    await enqueueSecurityAlert(client, { userId: user.id, event: "gift_card_purchased" });
    await client.query("COMMIT");
    return { card: vistaComprada(card), replayed: false };
  } catch (failure) {
    await client.query("ROLLBACK");
    throw failure;
  } finally {
    client.release();
  }
}

/**
 * Una compra ya hecha con esta clave por esta persona. La ruta la busca **antes**
 * de pedir el segundo factor: si la respuesta de una compra se perdió, el reintento
 * trae el mismo código de la app autenticadora, que ya se usó y no vuelve a servir.
 */
export async function findGiftCardPurchase({
  userPublicId,
  idempotencyKey,
  amount,
  recipientEmail = null,
  message = null,
}) {
  const user = (await postgresPool.query("SELECT id FROM users WHERE public_id=$1", [userPublicId]))
    .rows[0];
  if (!user) return null;
  const row = (
    await postgresPool.query(
      `SELECT g.* FROM ledger_transactions t JOIN gift_cards g ON g.public_id=t.metadata->>'giftCardId'
       WHERE t.idempotency_key=$1 AND g.purchaser_id=$2`,
      [claveCompra(user.id, idempotencyKey), user.id],
    )
  ).rows[0];
  if (!row) return null;
  exigirMismaCompra(row, datosCompra({ amount, recipientEmail, message }));
  return vistaComprada(row);
}

/**
 * Lo que puede hacer fallar una compra y se controla sin cobrar: se mira **antes** del
 * segundo factor. El código de la app autenticadora sirve una sola vez, y gastarlo en
 * una compra que después se rechaza por saldo o por destinatario obliga a esperar otro.
 * La compra lo vuelve a controlar con la Wallet bloqueada.
 */
export async function assertGiftCardPurchasable({ userPublicId, amount, recipientEmail = null }) {
  const { amountCents, correo } = datosCompra({ amount, recipientEmail });
  const user = (
    await postgresPool.query("SELECT id,email FROM users WHERE public_id=$1 AND status='active'", [
      userPublicId,
    ])
  ).rows[0];
  if (!user) throw error("Usuario no encontrado", 404);
  if (correo && correo === String(user.email).toLowerCase())
    throw error("La tarjeta es para regalar: no puede ser para tu propia cuenta", 400);
  const disponible = Number(
    (
      await postgresPool.query(
        `SELECT COALESCE(sum(CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END),0)::bigint b
         FROM ledger_accounts a JOIN ledger_entries e ON e.account_id=a.id
         WHERE a.owner_type='user' AND a.owner_id=$1 AND a.currency='ARS' AND a.account_type='wallet'`,
        [user.id],
      )
    ).rows[0].b,
  );
  if (disponible < amountCents) throw error("Saldo insuficiente en Flash Wallet", 402);
}

/**
 * Las que compró la persona y las dirigidas a su cuenta que todavía puede canjear.
 * De las compradas, **todas las vigentes** —tienen un código útil y plata que se
 * puede recuperar— y las últimas 50 cerradas, que son sólo historia.
 */
export async function listGiftCards(userPublicId) {
  const { rows: compradas } = await postgresPool.query(
    `SELECT g.* FROM gift_cards g JOIN users u ON u.id=g.purchaser_id
     WHERE u.public_id=$1 AND (g.status='active' OR g.id IN (
       SELECT x.id FROM gift_cards x WHERE x.purchaser_id=u.id AND x.status<>'active'
       ORDER BY x.created_at DESC LIMIT 50))
     ORDER BY g.status='active' DESC, g.created_at DESC`,
    [userPublicId],
  );
  const { rows: recibidas } = await postgresPool.query(
    `SELECT g.public_id,g.amount_cents,g.message,g.created_at,c.name purchaser_name
     FROM gift_cards g JOIN users u ON u.id=g.recipient_id JOIN users c ON c.id=g.purchaser_id
     WHERE u.public_id=$1 AND g.status='active' ORDER BY g.created_at DESC`,
    [userPublicId],
  );
  return {
    purchased: compradas.map(vistaComprada),
    received: recibidas.map((row) => ({
      id: row.public_id,
      amount: pesos(row.amount_cents),
      fromName: primerNombre(row.purchaser_name),
      message: row.message,
      createdAt: row.created_at,
    })),
  };
}

/** Pasa el importe de la cuenta de la plataforma a la Wallet de quien canjea. */
async function canjear(client, card, user) {
  if (card.status === "redeemed") throw error("Esa tarjeta ya se canjeó", 409);
  if (card.status === "cancelled") throw error("Esa tarjeta fue anulada", 409);
  if (card.purchaser_id === user.id)
    throw error("La compraste vos: para recuperar el saldo, anulala desde tus tarjetas", 409);
  await client.query(
    `UPDATE gift_cards SET status='redeemed',redeemed_by=$2,redeemed_at=now(),code_ciphertext=NULL
     WHERE id=$1`,
    [card.id, user.id],
  );
  await asentar(client, {
    idempotencyKey: `gift_card:redeem:${card.id}`,
    description: "Canjeaste una tarjeta de regalo",
    card,
    accion: "redemption",
    desde: await pasivo(client),
    hacia: await wallet(client, user.id),
  });
  await enqueueNotificationForInternalUser(client, {
    userId: card.purchaser_id,
    template: "gift_card_redeemed",
    payload: {
      title: "Canjearon tu tarjeta de regalo",
      body: `La tarjeta de ${importe(card.amount_cents)} que regalaste ya se usó.`,
      giftCardId: card.public_id,
    },
    deduplicationKey: `gift_card_redeemed:${card.public_id}`,
  });
  return { id: card.public_id, amount: pesos(card.amount_cents), status: "redeemed" };
}

/**
 * La tarjeta, bloqueada para canjearla, **después** de la cuenta de quien la compró.
 * El borrado de esa cuenta bloquea primero su fila y después, con su trigger, la de la
 * tarjeta; el canje avisa a quien compró, y ese aviso necesita su fila. En el orden
 * inverso, canje y borrado se esperaban mutuamente y PostgreSQL abortaba uno.
 * `purchaser_id` no cambia nunca, así que leerlo antes del bloqueo es seguro.
 */
const tarjetaParaCanjear = async (client, columna, valor) => {
  const comprador = (
    await client.query(`SELECT purchaser_id FROM gift_cards WHERE ${columna}=$1`, [valor])
  ).rows[0];
  if (!comprador) return null;
  await client.query("SELECT 1 FROM users WHERE id=$1 FOR KEY SHARE", [comprador.purchaser_id]);
  return (await client.query(`SELECT * FROM gift_cards WHERE ${columna}=$1 FOR UPDATE`, [valor]))
    .rows[0];
};

const enTransaccion = async (trabajo) => {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await trabajo(client);
    await client.query("COMMIT");
    return resultado;
  } catch (failure) {
    await client.query("ROLLBACK");
    throw failure;
  } finally {
    client.release();
  }
};

/** Canjea con el código, para quien lo recibió por fuera de la app. */
export const redeemGiftCardCode = ({ userPublicId, code }) =>
  enTransaccion(async (client) => {
    const user = await usuarioActivo(client, userPublicId);
    const codigo = normalizeGiftCardCode(code);
    // Un código mal escrito y uno que no existe responden igual.
    const card = codigo
      ? await tarjetaParaCanjear(client, "code_hash", hashGiftCardCode(codigo))
      : null;
    if (!card) throw error("Ese código no es de una tarjeta de regalo", 404);
    return canjear(client, card, user);
  });

/** Canjea una tarjeta dirigida a la cuenta, sin escribir el código. */
export const claimGiftCard = ({ userPublicId, giftCardPublicId }) =>
  enTransaccion(async (client) => {
    const user = await usuarioActivo(client, userPublicId);
    const card = await tarjetaParaCanjear(client, "public_id", giftCardPublicId);
    // Una tarjeta dirigida a otra cuenta responde como una que no existe.
    if (!card || card.recipient_id !== user.id) throw error("Tarjeta no encontrada", 404);
    return canjear(client, card, user);
  });

/** Quien compró la anula mientras nadie la canjeó: la plata le vuelve a la Wallet. */
export const cancelGiftCard = ({ userPublicId, giftCardPublicId }) =>
  enTransaccion(async (client) => {
    const user = await usuarioActivo(client, userPublicId);
    const card = (
      await client.query("SELECT * FROM gift_cards WHERE public_id=$1 FOR UPDATE", [
        giftCardPublicId,
      ])
    ).rows[0];
    if (!card || card.purchaser_id !== user.id) throw error("Tarjeta no encontrada", 404);
    if (card.status !== "active")
      throw error(
        card.status === "redeemed" ? "Esa tarjeta ya se canjeó" : "Esa tarjeta ya fue anulada",
        409,
      );
    const anulada = (
      await client.query(
        `UPDATE gift_cards SET status='cancelled',cancelled_at=now(),code_ciphertext=NULL
         WHERE id=$1 RETURNING *`,
        [card.id],
      )
    ).rows[0];
    await asentar(client, {
      idempotencyKey: `gift_card:cancel:${card.id}`,
      description: "Anulaste una tarjeta de regalo",
      card,
      accion: "refund",
      desde: await pasivo(client),
      hacia: await wallet(client, user.id),
    });
    return vistaComprada(anulada);
  });
