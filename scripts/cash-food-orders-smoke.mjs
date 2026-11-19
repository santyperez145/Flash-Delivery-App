// Efectivo en pedidos de comida (PAG-01) contra PostgreSQL y la API.
//
// Con un cliente y un repartidor sintéticos y el comercio de ejemplo (sus opciones
// de sucursal se restauran al final):
//
// - la sucursal decide: sin efectivo habilitado, la cotización responde 409;
// - antifraude: sin teléfono verificado, 409;
// - un pedido para retirar en efectivo, por la API: se crea aceptado, sin cobro ni
//   intención de pago, con «con cuánto pagás» y el vuelto; con menos que el total, 400;
// - la liquidación de un retiro: el comercio cobró en el mostrador y queda debiendo
//   la parte de la plataforma; la caja de compensación queda en cero; repetirla no
//   duplica nada;
// - la liquidación de una entrega: el repartidor cobró en la puerta y queda debiendo
//   todo menos su envío;
// - una incidencia sobre un pedido en efectivo: el reintegro va como saldo a la
//   Wallet de quien pidió;
// - la rendición de efectivo: baja la deuda, no puede superarla y no se duplica.
//
// Todo lo que crea lo borra al final.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { createPool } from "./db-client.mjs";
import { closePostgres } from "../server/postgres.js";
import { settleCapturedFoodOrder } from "../server/merchant-finance-repository.js";
import { registerCashDeposit } from "../server/wallet-repository.js";
import { createOrderIssue, resolveOrderIssue } from "../server/order-issue-repository.js";
import { setPostgresOrderStatus } from "../server/order-repository.js";

const base = process.env.API_URL || "http://127.0.0.1:4000/api",
  pool = createPool(),
  marca = `cash-${crypto.randomBytes(4).toString("hex")}`,
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
const saldo = async (accountFilter, params) =>
  Number(
    (
      await pool.query(
        `SELECT COALESCE(sum(CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END),0)::bigint b
         FROM ledger_accounts a JOIN ledger_entries e ON e.account_id=a.id WHERE ${accountFilter}`,
        params,
      )
    ).rows[0].b,
  );
const saldoUsuario = (userId) =>
  saldo("a.owner_type='user' AND a.owner_id=$1 AND a.account_type='wallet'", [userId]);
const saldoComercio = (merchantId) =>
  saldo("a.owner_type='merchant' AND a.owner_id=$1 AND a.account_type='payable'", [merchantId]);
const saldoPlataforma = (tipo) =>
  saldo("a.owner_type='platform' AND a.owner_id IS NULL AND a.account_type=$1", [tipo]);
const cuadra = async (idempotencyKey) =>
  (
    await pool.query(
      `SELECT COALESCE(sum(CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END),0)::bigint d,
         count(*)::int n
       FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id=t.id WHERE t.idempotency_key=$1`,
      [idempotencyKey],
    )
  ).rows[0];
const liquidar = async (jobId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await settleCapturedFoodOrder(client, { jobId });
    await client.query("COMMIT");
    return resultado;
  } catch (failure) {
    await client.query("ROLLBACK");
    throw failure;
  } finally {
    client.release();
  }
};

const usuarios = {};
const jobs = [];
let sucursal = null;
let repartidor = null;
const clavesRendicion = [];
try {
  // --- El comercio de ejemplo y su sucursal principal ----------------------------
  sucursal = (
    await pool.query(
      `SELECT b.id,b.public_id,b.pickup_enabled,b.cash_enabled,m.id merchant_id,m.public_id merchant_public_id
       FROM merchant_branches b JOIN merchants m ON m.id=b.merchant_id
       WHERE m.public_id='rest_roja' ORDER BY b.is_primary DESC LIMIT 1`,
    )
  ).rows[0];
  assert(Boolean(sucursal), "el comercio de ejemplo tiene una sucursal");
  const item = (
    await pool.query(
      "SELECT id,public_id,name,unit_price_cents FROM catalog_items WHERE public_id='item_burger_brava'",
    )
  ).rows[0];

  // --- Cuentas sintéticas -----------------------------------------------------------
  const hash = await bcrypt.hash(password, 10);
  for (const [clave, telefono] of [
    ["cliente", true],
    ["sintel", false],
    ["repartidor", false],
  ]) {
    const user = (
      await pool.query(
        `INSERT INTO users(public_id,email,password_hash,name,email_verified_at,phone,phone_verified_at,created_at)
         VALUES($1,$1||'@flash.test',$2,$3,now(),$4,$5,now()-interval '30 days') RETURNING id,public_id,email`,
        [
          `${marca}-${clave}`,
          hash,
          `${clave[0].toUpperCase()}${clave.slice(1)} Sintético`,
          telefono ? "+5491100000000" : null,
          telefono ? new Date() : null,
        ],
      )
    ).rows[0];
    await pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,$2)", [
      user.id,
      clave === "repartidor" ? "driver" : "customer",
    ]);
    usuarios[clave] = user;
  }
  repartidor = (
    await pool.query(
      `INSERT INTO drivers(public_id,user_id,online,active_mode,service_modes,metadata)
       VALUES($1,$2,false,'delivery',ARRAY['delivery']::job_kind[],'{}'::jsonb) RETURNING id,public_id`,
      [`DRV-${marca}`, usuarios.repartidor.id],
    )
  ).rows[0];
  const ingresar = async (user) =>
    (
      await api("/auth/login", {
        body: { email: user.email, password, deviceName: "cash-food-orders-smoke" },
      })
    ).body;
  const cliente = await ingresar(usuarios.cliente);
  const sinTelefono = await ingresar(usuarios.sintel);
  const pedidoBase = (sesion) => ({
    customerId: sesion.user.id,
    restaurantId: "rest_roja",
    branchId: sucursal.public_id,
    fulfillment: "pickup",
    paymentMethod: "Efectivo",
    items: [{ menuItemId: "item_burger_brava", quantity: 1, extras: [], note: "" }],
  });
  const cotizar = (sesion) =>
    api("/orders/quote", { token: sesion.token, body: pedidoBase(sesion) });

  // --- La sucursal decide -------------------------------------------------------------
  await pool.query(
    "UPDATE merchant_branches SET pickup_enabled=true,cash_enabled=false WHERE id=$1",
    [sucursal.id],
  );
  const sinEfectivo = await cotizar(cliente);
  assert(
    sinEfectivo.status === 409 && /no acepta efectivo/.test(sinEfectivo.body.message),
    "una sucursal que no acepta efectivo no lo cotiza",
  );
  await pool.query("UPDATE merchant_branches SET cash_enabled=true WHERE id=$1", [sucursal.id]);
  const noVerificado = await cotizar(sinTelefono);
  assert(
    noVerificado.status === 409 && /verificá tu teléfono/.test(noVerificado.body.message),
    "sin teléfono verificado no se paga en efectivo",
  );

  // --- Un retiro en efectivo por la API ------------------------------------------------
  const cotizacion = await cotizar(cliente);
  assert(
    cotizacion.status === 200 &&
      cotizacion.body.quote?.paymentMethod === "Efectivo" &&
      cotizacion.body.quote?.quoteToken,
    "la sucursal que acepta efectivo lo cotiza",
  );
  const totalCents = Math.round(Number(cotizacion.body.quote.total) * 100);
  const pedir = (cashTenderedCents, clave = `${marca}-pedido-${crypto.randomUUID()}`) =>
    api("/orders", {
      token: cliente.token,
      headers: { "Idempotency-Key": clave },
      body: {
        ...pedidoBase(cliente),
        quoteToken: cotizacion.body.quote.quoteToken,
        ...(cashTenderedCents ? { cashTenderedCents } : {}),
      },
    });
  const corto = await pedir(totalCents - 100);
  assert(corto.status === 400, "con menos que el total no alcanza");
  const antesCliente = await saldoUsuario(usuarios.cliente.id);
  const clavePedido = `${marca}-pedido-retiro`;
  const pedido = await pedir(totalCents + 500000, clavePedido);
  const orderId = pedido.body.order?.id;
  assert(
    pedido.status === 200 &&
      orderId &&
      pedido.body.order.paymentStatus === "cash_on_delivery" &&
      pedido.body.order.cashPayment?.change === 5000 &&
      pedido.body.order.cashPayment?.collector === "merchant",
    "un retiro en efectivo se crea sin cobro, y la confirmación trae el vuelto",
  );
  // El reintento de la misma solicitud devuelve el mismo pedido: no lo frena la regla de
  // un pedido en efectivo en curso, que es justamente el que ya creó.
  const reintento = await pedir(totalCents + 500000, clavePedido);
  assert(
    reintento.status === 200 && reintento.body.order?.id === orderId,
    "reintentar con la misma clave devuelve el mismo pedido",
  );
  const job = (
    await pool.query("SELECT id,status,metadata FROM jobs WHERE public_id=$1", [orderId])
  ).rows[0];
  jobs.push(job.id);
  const intenciones = Number(
    (await pool.query("SELECT count(*)::int n FROM payment_intents WHERE job_id=$1", [job.id]))
      .rows[0].n,
  );
  assert(
    job.status === "accepted" &&
      intenciones === 0 &&
      (await saldoUsuario(usuarios.cliente.id)) === antesCliente &&
      job.metadata.cashPayment?.collector === "merchant" &&
      Number(job.metadata.cashPayment.changeCents) === 500000,
    "aceptado, sin intención de pago ni débito, con el vuelto y quien cobra",
  );
  const segundo = await cotizar(cliente);
  assert(
    segundo.status === 409 && /en curso/.test(segundo.body.message),
    "un solo pedido en efectivo en curso a la vez",
  );

  // --- La liquidación de un retiro: cobra el comercio ----------------------------------
  const comercioAntes = await saldoComercio(sucursal.merchant_id);
  const ingresosAntes = await saldoPlataforma("revenue");
  const compensacionAntes = await saldoPlataforma("cash_clearing");
  // Por la función de estado, la misma que usa el comercio: es la que no deja completar
  // un pedido en efectivo sin su liquidación.
  for (const estado of ["preparing", "ready_for_pickup", "delivered"])
    await setPostgresOrderStatus(orderId, estado, usuarios.cliente.public_id);
  const retiro = await liquidar(job.id);
  const deltaComercio = (await saldoComercio(sucursal.merchant_id)) - comercioAntes;
  const deltaIngresos = (await saldoPlataforma("revenue")) - ingresosAntes;
  assert(
    (await pool.query("SELECT status FROM jobs WHERE id=$1", [job.id])).rows[0].status ===
      "completed" &&
      retiro.idempotent &&
      deltaIngresos > 0 &&
      deltaComercio === -deltaIngresos &&
      (await saldoPlataforma("cash_clearing")) === compensacionAntes,
    "el comercio cobró en el mostrador y queda debiendo la parte de la plataforma",
  );
  const asientoRetiro = await cuadra(`cash-collection-${orderId}`);
  assert(
    Number(asientoRetiro.d) === 0 && asientoRetiro.n === 2,
    "el cobro en mano se asienta cuadrado",
  );
  const otraVez = await liquidar(job.id);
  assert(
    otraVez.idempotent &&
      (await saldoComercio(sucursal.merchant_id)) === comercioAntes + deltaComercio,
    "liquidar otra vez no duplica nada",
  );

  // --- La liquidación de una entrega: cobra el repartidor ------------------------------
  const entregaId = `ORD-${marca}-entrega`;
  const entrega = (
    await pool.query(
      `INSERT INTO jobs(public_id,kind,customer_id,merchant_id,branch_id,driver_id,status,pickup_address,pickup_location,
         dropoff_address,dropoff_location,service_level,quoted_amount_cents,final_amount_cents,distance_m,
         estimated_duration_s,payment_method_label,metadata)
       VALUES($1,'delivery',$2,$3,$4,$5,'completed','Comercio',ST_SetSRID(ST_MakePoint(-58.3816,-34.6037),4326)::geography,
         'Casa',ST_SetSRID(ST_MakePoint(-58.4156,-34.5592),4326)::geography,'food',$6,$6,3000,900,'Efectivo',$7)
       RETURNING id`,
      [
        entregaId,
        usuarios.cliente.id,
        sucursal.merchant_id,
        sucursal.id,
        repartidor.id,
        Number(item.unit_price_cents) + 150000,
        {
          subtype: "food_order",
          subtotal: Number(item.unit_price_cents) / 100,
          deliveryFee: 1500,
          serviceFee: 0,
          discount: 0,
          tip: 0,
          fulfillment: "delivery",
          cashPayment: { tenderedCents: null, changeCents: 0, collector: "courier" },
        },
      ],
    )
  ).rows[0];
  jobs.push(entrega.id);
  await pool.query(
    "INSERT INTO job_items(job_id,catalog_item_id,name,quantity,unit_price_cents) VALUES($1,$2,$3,1,$4)",
    [entrega.id, item.id, item.name, item.unit_price_cents],
  );
  const totalEntrega = Number(item.unit_price_cents) + 150000;
  const liquidacion = await liquidar(entrega.id);
  assert(
    liquidacion.settled &&
      liquidacion.collector === "courier" &&
      liquidacion.driverNet === 150000 &&
      (await saldoUsuario(usuarios.repartidor.id)) === liquidacion.driverNet - totalEntrega,
    "el repartidor cobró en la puerta y queda debiendo todo menos su envío",
  );

  // --- Una incidencia sobre un pedido en efectivo: saldo en la Wallet ------------------
  const antesIncidencia = await saldoUsuario(usuarios.cliente.id);
  const incidencia = await createOrderIssue({
    orderPublicId: entregaId,
    customerPublicId: usuarios.cliente.public_id,
    category: "missing_item",
    description: "Faltó una parte del pedido",
    requestedRefund: 500,
  });
  const admin = (
    await pool.query(
      "SELECT u.public_id FROM users u JOIN user_roles r ON r.user_id=u.id AND r.role='admin' LIMIT 1",
    )
  ).rows[0];
  await resolveOrderIssue({
    issuePublicId: incidencia.id,
    actorPublicId: admin.public_id,
    status: "approved",
    approvedRefund: 500,
    resolutionNote: "Reintegro por faltante",
  });
  assert(
    (await saldoUsuario(usuarios.cliente.id)) === antesIncidencia + 50000,
    "el reintegro de un pedido en efectivo va como saldo a la Wallet de quien pidió",
  );

  // --- La rendición de efectivo ----------------------------------------------------------
  const deudaAntes = Math.max(0, -(await saldoUsuario(usuarios.repartidor.id)));
  // La incidencia también le revirtió al repartidor su parte del reintegro.
  assert(deudaAntes > 0, "el repartidor debe efectivo por rendir");
  const deMas = await espera(
    registerCashDeposit({
      driverPublicId: repartidor.public_id,
      amount: deudaAntes / 100 + 1,
      actorPublicId: admin.public_id,
      idempotencyKey: `${marca}-rendicion-de-mas`,
    }),
  );
  clavesRendicion.push(`cash-deposit-${marca}-rendicion-de-mas`);
  assert(deMas?.status === 409, "una rendición mayor a la deuda se rechaza");
  const parte = Math.floor(deudaAntes / 200);
  const clave = `${marca}-rendicion-parcial`;
  clavesRendicion.push(`cash-deposit-${clave}`);
  const cajaAntes = await saldoPlataforma("cash_on_hand");
  const rendicion = await registerCashDeposit({
    driverPublicId: repartidor.public_id,
    amount: parte,
    reference: "Depósito sintético",
    actorPublicId: admin.public_id,
    idempotencyKey: clave,
  });
  assert(
    !rendicion.duplicate &&
      Math.max(0, -(await saldoUsuario(usuarios.repartidor.id))) === deudaAntes - parte * 100 &&
      (await saldoPlataforma("cash_on_hand")) === cajaAntes - parte * 100,
    "la rendición baja la deuda y entra a la caja de efectivo",
  );
  const repetida = await registerCashDeposit({
    driverPublicId: repartidor.public_id,
    amount: parte,
    actorPublicId: admin.public_id,
    idempotencyKey: clave,
  });
  assert(
    repetida.duplicate &&
      Math.max(0, -(await saldoUsuario(usuarios.repartidor.id))) === deudaAntes - parte * 100,
    "repetir la clave no registra otra rendición",
  );
  const otraRendicion = await espera(
    registerCashDeposit({
      driverPublicId: repartidor.public_id,
      amount: parte + 1,
      actorPublicId: admin.public_id,
      idempotencyKey: clave,
    }),
  );
  assert(otraRendicion?.status === 409, "la misma clave con otro importe se rechaza");
} finally {
  if (sucursal)
    await pool.query("UPDATE merchant_branches SET pickup_enabled=$2,cash_enabled=$3 WHERE id=$1", [
      sucursal.id,
      sucursal.pickup_enabled,
      sucursal.cash_enabled,
    ]);
  const ids = Object.values(usuarios).map((user) => user.id);
  const publicos = Object.values(usuarios).map((user) => user.public_id);
  const todos = [
    ...jobs,
    ...(await pool.query("SELECT id FROM jobs WHERE customer_id = ANY($1)", [ids])).rows.map(
      (row) => row.id,
    ),
  ];
  // Sólo lo de esta prueba: asientos sobre sus cuentas, sobre sus pedidos (liquidación,
  // cobro en mano, incidencias) o con sus claves de rendición.
  const claves = (
    await pool.query(
      `SELECT DISTINCT e.transaction_id id FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.account_id
       WHERE (a.owner_type='user' AND a.owner_id = ANY($1)) OR e.reference_id = ANY($2)
       UNION SELECT id FROM ledger_transactions WHERE idempotency_key = ANY($3)`,
      [ids, todos, clavesRendicion],
    )
  ).rows.map((row) => row.id);
  await pool.query("DELETE FROM ledger_entries WHERE transaction_id = ANY($1)", [claves]);
  await pool.query("DELETE FROM ledger_transactions WHERE id = ANY($1)", [claves]);
  // Una incidencia que deja un saldo en negativo abre un caso de conciliación.
  await pool.query(
    "DELETE FROM payment_reconciliation_cases WHERE external_reference IN (SELECT public_id FROM order_issues WHERE job_id = ANY($1))",
    [todos],
  );
  await pool.query("DELETE FROM order_issues WHERE job_id = ANY($1)", [todos]);
  const hijas = (
    await pool.query(
      `SELECT c.conrelid::regclass::text tabla, a.attname columna
       FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
       WHERE c.contype='f' AND c.confrelid='jobs'::regclass AND array_length(c.conkey,1)=1`,
    )
  ).rows;
  for (let vuelta = 0; vuelta < 3; vuelta += 1)
    for (const { tabla, columna } of hijas)
      await pool
        .query(`DELETE FROM ${tabla} WHERE ${columna} = ANY($1)`, [todos])
        .catch(() => null);
  await pool.query("DELETE FROM jobs WHERE id = ANY($1)", [todos]);
  if (repartidor) await pool.query("DELETE FROM drivers WHERE id=$1", [repartidor.id]);
  await pool.query("DELETE FROM idempotency_keys WHERE user_id = ANY($1)", [ids]);
  // Cada alta de pedido por la API deja su evaluación de riesgo.
  await pool.query(
    "DELETE FROM transaction_risk_assessments WHERE customer_id = ANY($1) OR reviewed_by = ANY($1)",
    [ids],
  );
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
