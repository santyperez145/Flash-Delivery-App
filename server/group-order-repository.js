// Pedidos grupales (ticket GTM-001, cuarto hueco comercial).
//
// La vía natural al ticket promedio alto y al pedido de oficina, donde un pedido
// reemplaza a diez. Uber Eats, DoorDash y Rappi los tienen; Flash los prometía
// en la portada sin que existiera nada detrás.
//
// **Un grupo confirmado se convierte en un pedido normal.** No hay una segunda
// tubería de pedidos: se juntan los ítems de todos, se cotiza y se crea con el
// mismo camino de siempre. De ahí en adelante la propina, la suscripción, el
// horario reservado, el despacho y la liquidación no necesitan saber que esto
// empezó como grupo — que es exactamente lo que evita que cada una tenga que
// crecer un caso especial.
import crypto from "node:crypto";

import { pesos } from "./money.js";
import { postgresPool } from "./postgres.js";

const publicId = () => `GRP-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

// Seis caracteres de un alfabeto sin `0/O` ni `1/I/L`: se comparte por chat y se
// dicta en voz alta, y esos pares son los que se copian mal.
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const joinCode = () =>
  Array.from(crypto.randomBytes(6), (byte) => ALFABETO[byte % ALFABETO.length]).join("");

const mapearGrupo = (fila, participantes) => ({
  id: fila.public_id,
  // El código sólo viaja a quien ya es parte. La política de la migración 128
  // dice lo mismo del otro lado: primero se entra, después se ve.
  joinCode: fila.join_code,
  status: fila.status,
  restaurantId: fila.merchant_public_id,
  restaurantName: fila.merchant_name,
  branchId: fila.branch_public_id,
  hostId: fila.host_public_id,
  hostName: fila.host_name,
  spendLimit: fila.spend_limit_cents === null ? null : pesos(fila.spend_limit_cents),
  closesAt: fila.closes_at ? new Date(fila.closes_at).toISOString() : null,
  orderId: fila.job_public_id || null,
  createdAt: new Date(fila.created_at).toISOString(),
  participants: participantes,
  subtotal: participantes.reduce((suma, persona) => suma + persona.subtotal, 0),
});

const SELECT_GRUPO = `
  SELECT g.*, m.public_id merchant_public_id, m.name merchant_name,
         b.public_id branch_public_id, h.public_id host_public_id, h.name host_name,
         j.public_id job_public_id
  FROM group_orders g
  JOIN merchants m ON m.id=g.merchant_id
  JOIN merchant_branches b ON b.id=g.branch_id
  JOIN users h ON h.id=g.host_id
  LEFT JOIN jobs j ON j.id=g.job_id`;

/** Participantes con lo que eligió cada uno. Una sola consulta: una por persona
 *  convertiría un grupo de diez en once viajes a la base. */
async function participantesDe(ejecutor, groupOrderId) {
  const filas = (
    await ejecutor.query(
      `SELECT p.id, p.is_host, u.public_id user_public_id, u.name user_name,
              i.id item_id, i.quantity, i.unit_price_snapshot_cents, i.options, i.note,
              c.public_id catalog_public_id, c.name catalog_name
       FROM group_order_participants p
       JOIN users u ON u.id=p.user_id
       LEFT JOIN group_order_items i ON i.participant_id=p.id
       LEFT JOIN catalog_items c ON c.id=i.catalog_item_id
       WHERE p.group_order_id=$1
       ORDER BY p.is_host DESC, p.joined_at, i.created_at`,
      [groupOrderId],
    )
  ).rows;
  const porPersona = new Map();
  for (const fila of filas) {
    if (!porPersona.has(fila.id))
      porPersona.set(fila.id, {
        userId: fila.user_public_id,
        name: fila.user_name,
        isHost: fila.is_host,
        items: [],
        subtotal: 0,
      });
    if (!fila.item_id) continue;
    const persona = porPersona.get(fila.id);
    persona.items.push({
      menuItemId: fila.catalog_public_id,
      name: fila.catalog_name,
      quantity: fila.quantity,
      unitPrice: pesos(fila.unit_price_snapshot_cents),
      extras: fila.options || [],
      note: fila.note || "",
    });
    persona.subtotal += pesos(fila.unit_price_snapshot_cents) * fila.quantity;
  }
  return [...porPersona.values()];
}

/** Lee un grupo por su id público, ya sea porque sos parte o porque sos admin. */
export async function getGroupOrder({ groupPublicId, userPublicId, admin = false }) {
  const grupo = (
    await postgresPool.query(
      `${SELECT_GRUPO}
       WHERE g.public_id=$1 AND ($3::boolean OR EXISTS(
         SELECT 1 FROM group_order_participants p JOIN users u ON u.id=p.user_id
         WHERE p.group_order_id=g.id AND u.public_id=$2))`,
      [groupPublicId, userPublicId, admin],
    )
  ).rows[0];
  if (!grupo) throw Object.assign(new Error("Pedido grupal no encontrado"), { status: 404 });
  return mapearGrupo(grupo, await participantesDe(postgresPool, grupo.id));
}

/** Grupos abiertos en los que la persona participa, para poder volver a ellos. */
export async function listGroupOrders(userPublicId) {
  const filas = (
    await postgresPool.query(
      `${SELECT_GRUPO}
       JOIN group_order_participants mine ON mine.group_order_id=g.id
       JOIN users mu ON mu.id=mine.user_id AND mu.public_id=$1
       WHERE g.status IN('open','locked')
       ORDER BY g.created_at DESC LIMIT 20`,
      [userPublicId],
    )
  ).rows;
  return Promise.all(
    filas.map(async (fila) => mapearGrupo(fila, await participantesDe(postgresPool, fila.id))),
  );
}

/**
 * Abre un grupo. Quien lo abre queda dentro como anfitrión en el mismo paso.
 *
 * Un anfitrión que tuviera que sumarse después podría quedar afuera de su propio
 * grupo si algo fallara en el medio, y el índice parcial de la migración 128
 * dejaría al grupo sin nadie que pueda confirmarlo.
 */
export async function createGroupOrder({
  hostPublicId,
  merchantPublicId,
  branchPublicId,
  spendLimitCents = null,
  closesAt = null,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const contexto = (
      await client.query(
        `SELECT u.id host_id, m.id merchant_id, b.id branch_id
         FROM users u, merchants m
         JOIN merchant_branches b ON b.merchant_id=m.id AND b.status='active'
         WHERE u.public_id=$1 AND u.status='active' AND m.public_id=$2 AND m.status='active'
           AND ($3::text IS NULL OR b.public_id=$3)
         ORDER BY b.created_at LIMIT 1`,
        [hostPublicId, merchantPublicId, branchPublicId || null],
      )
    ).rows[0];
    if (!contexto)
      throw Object.assign(new Error("Comercio o sucursal no disponible"), { status: 404 });
    const grupo = (
      await client.query(
        `INSERT INTO group_orders(public_id, join_code, host_id, merchant_id, branch_id,
           spend_limit_cents, closes_at)
         VALUES($1,$2,$3,$4,$5,$6,$7::timestamptz) RETURNING id, public_id`,
        [
          publicId(),
          joinCode(),
          contexto.host_id,
          contexto.merchant_id,
          contexto.branch_id,
          spendLimitCents,
          closesAt,
        ],
      )
    ).rows[0];
    await client.query(
      "INSERT INTO group_order_participants(group_order_id, user_id, is_host) VALUES($1,$2,true)",
      [grupo.id, contexto.host_id],
    );
    await client.query("COMMIT");
    return getGroupOrder({ groupPublicId: grupo.public_id, userPublicId: hostPublicId });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Sumarse con el código.
 *
 * Volver a entrar con el mismo código no es un error: pasa cada vez que alguien
 * abre el enlace dos veces. Se devuelve el grupo en lugar de un 409 que
 * obligaría a la pantalla a distinguir dos casos que para la persona son el
 * mismo.
 */
export async function joinGroupOrder({ joinCode: codigo, userPublicId }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const grupo = (
      await client.query(
        "SELECT id, public_id, status, closes_at FROM group_orders WHERE join_code=$1 FOR UPDATE",
        [String(codigo).trim().toUpperCase()],
      )
    ).rows[0];
    if (!grupo) throw Object.assign(new Error("Código inválido"), { status: 404 });
    if (grupo.status !== "open")
      throw Object.assign(new Error("Este pedido grupal ya está cerrado"), { status: 409 });
    if (grupo.closes_at && new Date(grupo.closes_at) <= new Date())
      throw Object.assign(new Error("El tiempo para sumarse terminó"), { status: 409 });
    const usuario = (
      await client.query("SELECT id FROM users WHERE public_id=$1 AND status='active'", [
        userPublicId,
      ])
    ).rows[0];
    if (!usuario) throw Object.assign(new Error("Usuario no encontrado"), { status: 404 });
    await client.query(
      `INSERT INTO group_order_participants(group_order_id, user_id) VALUES($1,$2)
       ON CONFLICT(group_order_id, user_id) DO NOTHING`,
      [grupo.id, usuario.id],
    );
    await client.query("COMMIT");
    return getGroupOrder({ groupPublicId: grupo.public_id, userPublicId });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Reemplaza la canasta propia dentro del grupo.
 *
 * Reemplazo y no diferencia incremental: el cliente manda lo que quiere pedir y
 * eso queda. Un protocolo de altas y bajas por ítem obligaría a resolver
 * conflictos entre dos pestañas de la misma persona, y no hay nada que ganar con
 * eso en una canasta de cinco líneas.
 *
 * **El tope de gasto se verifica acá y contra los precios de la base**, no
 * contra los que mandó el cliente: un tope que se pudiera esquivar mandando
 * precios inventados no es un tope.
 */
export async function setGroupOrderItems({ groupPublicId, userPublicId, items }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const contexto = (
      await client.query(
        `SELECT g.id, g.public_id, g.status, g.closes_at, g.merchant_id, g.spend_limit_cents,
                p.id participant_id
         FROM group_orders g
         JOIN group_order_participants p ON p.group_order_id=g.id
         JOIN users u ON u.id=p.user_id AND u.public_id=$2
         WHERE g.public_id=$1 FOR UPDATE OF g`,
        [groupPublicId, userPublicId],
      )
    ).rows[0];
    if (!contexto)
      throw Object.assign(new Error("No formás parte de este pedido grupal"), { status: 404 });
    if (contexto.status !== "open")
      throw Object.assign(new Error("El pedido grupal ya está cerrado"), { status: 409 });
    if (contexto.closes_at && new Date(contexto.closes_at) <= new Date())
      throw Object.assign(new Error("El tiempo para agregar terminó"), { status: 409 });

    await client.query("DELETE FROM group_order_items WHERE participant_id=$1", [
      contexto.participant_id,
    ]);
    let subtotalCents = 0;
    for (const entrada of items) {
      const item = (
        await client.query(
          `SELECT id, unit_price_cents FROM catalog_items
           WHERE public_id=$1 AND merchant_id=$2 AND available`,
          [entrada.menuItemId, contexto.merchant_id],
        )
      ).rows[0];
      if (!item)
        throw Object.assign(new Error(`Producto no disponible: ${entrada.menuItemId}`), {
          status: 409,
        });
      subtotalCents += Number(item.unit_price_cents) * entrada.quantity;
      await client.query(
        `INSERT INTO group_order_items(participant_id, catalog_item_id, quantity,
           unit_price_snapshot_cents, options, note)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [
          contexto.participant_id,
          item.id,
          entrada.quantity,
          item.unit_price_cents,
          JSON.stringify(entrada.extras || []),
          entrada.note || null,
        ],
      );
    }
    if (contexto.spend_limit_cents !== null && subtotalCents > Number(contexto.spend_limit_cents))
      throw Object.assign(
        new Error(`Tu parte supera el tope de $${pesos(contexto.spend_limit_cents).toFixed(0)}`),
        { status: 409 },
      );
    await client.query("UPDATE group_orders SET updated_at=now() WHERE id=$1", [contexto.id]);
    await client.query("COMMIT");
    return getGroupOrder({ groupPublicId, userPublicId });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Cambia el estado del grupo. Sólo el anfitrión.
 *
 * `locked` corta el agregado sin confirmar todavía: es el momento en que el
 * anfitrión revisa lo que pidió cada uno antes de pagar. Sin ese estado
 * intermedio, alguien podría sumar un plato entre que el anfitrión mira el total
 * y toca confirmar, y el precio cambiaría bajo sus pies.
 */
export async function setGroupOrderStatus({ groupPublicId, hostPublicId, status }) {
  const grupo = (
    await postgresPool.query(
      `UPDATE group_orders g SET status=$3, updated_at=now()
       FROM users h
       WHERE h.id=g.host_id AND g.public_id=$1 AND h.public_id=$2
         AND g.status IN('open','locked')
       RETURNING g.public_id`,
      [groupPublicId, hostPublicId, status],
    )
  ).rows[0];
  if (!grupo)
    throw Object.assign(
      new Error("Sólo quien abrió el grupo puede cambiarlo, y sólo si sigue abierto"),
      {
        status: 409,
      },
    );
  return getGroupOrder({ groupPublicId, userPublicId: hostPublicId });
}

/**
 * Lo que el grupo pide, junto, en el formato que espera la cotización.
 *
 * Devuelve las líneas sumadas por producto y opciones: dos personas que piden la
 * misma hamburguesa son una línea de cantidad dos, no dos líneas. El pedido que
 * llega a la cocina tiene que leerse como un pedido, no como un acta de quién
 * pidió qué.
 */
export async function collectGroupOrderItems({ groupPublicId, hostPublicId }) {
  const grupo = (
    await postgresPool.query(
      `SELECT g.id, g.status, g.merchant_id, m.public_id merchant_public_id,
              b.public_id branch_public_id
       FROM group_orders g
       JOIN users h ON h.id=g.host_id AND h.public_id=$2
       JOIN merchants m ON m.id=g.merchant_id
       JOIN merchant_branches b ON b.id=g.branch_id
       WHERE g.public_id=$1`,
      [groupPublicId, hostPublicId],
    )
  ).rows[0];
  if (!grupo)
    throw Object.assign(new Error("Sólo quien abrió el grupo puede confirmarlo"), { status: 403 });
  if (grupo.status !== "locked")
    throw Object.assign(new Error("Cerrá el grupo antes de confirmarlo"), { status: 409 });

  const filas = (
    await postgresPool.query(
      `SELECT c.public_id menu_item_id, i.options, sum(i.quantity)::int quantity,
              string_agg(NULLIF(i.note,''), ' · ') notes
       FROM group_order_items i
       JOIN group_order_participants p ON p.id=i.participant_id
       JOIN catalog_items c ON c.id=i.catalog_item_id
       WHERE p.group_order_id=$1
       GROUP BY c.public_id, i.options`,
      [grupo.id],
    )
  ).rows;
  if (filas.length === 0)
    throw Object.assign(new Error("El pedido grupal no tiene productos"), { status: 409 });
  return {
    merchantPublicId: grupo.merchant_public_id,
    branchPublicId: grupo.branch_public_id,
    items: filas.map((fila) => ({
      menuItemId: fila.menu_item_id,
      quantity: fila.quantity,
      extras: fila.options || [],
      // Las notas de cada persona se juntan en una: la cocina lee una línea por
      // producto, y perder «sin cebolla» porque otro pidió lo mismo sería el
      // error caro de esta función.
      note: (fila.notes || "").slice(0, 500),
    })),
  };
}

/** Ata el grupo al pedido creado. Después de esto el grupo es historia y el
 *  pedido sigue su curso normal. */
export async function markGroupOrderPlaced({ groupPublicId, orderPublicId }) {
  await postgresPool.query(
    `UPDATE group_orders SET status='placed', updated_at=now(),
       job_id=(SELECT id FROM jobs WHERE public_id=$2)
     WHERE public_id=$1`,
    [groupPublicId, orderPublicId],
  );
}
