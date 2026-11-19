// Pedidos agrupados (P-03) contra PostgreSQL.
//
// Con un repartidor y pedidos sintéticos sobre las sucursales de ejemplo:
//
// - un pedido listo del mismo local, con la entrega en el camino, se le ofrece como
//   lote al repartidor que va a buscar otro pedido a ese local;
// - uno con un desvío de más, o de otro local, no: y como ya tiene un pedido en curso,
//   tampoco se le ofrece suelto;
// - aceptar el lote lo une al primero y suma el desvío al horario estimado;
// - aceptar un pedido de otro local con uno en curso se rechaza;
// - las vistas dicen qué entrega es cada uno, y si uno se cancela, el otro sigue solo.
//
// Todo lo que crea lo borra al final.
import crypto from "node:crypto";
import { createPool } from "./db-client.mjs";
import { closePostgres } from "../server/postgres.js";
import {
  acceptDispatchOffer,
  createDispatchOffers,
  getPostgresDispatchOffers,
} from "../server/dispatch-repository.js";
import { getPostgresOrders } from "../server/order-repository.js";

const pool = createPool(),
  marca = `lote-${crypto.randomBytes(4).toString("hex")}`;
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
const enTransaccion = async (trabajo) => {
  const client = await pool.connect();
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

const usuarios = [];
const jobs = [];
let repartidor = null;
try {
  // --- Las sucursales de ejemplo -----------------------------------------------
  const sucursales = (
    await pool.query(
      `SELECT b.id,b.merchant_id,ST_Y(b.location::geometry) lat,ST_X(b.location::geometry) lng
       FROM merchant_branches b ORDER BY b.created_at LIMIT 2`,
    )
  ).rows;
  assert(sucursales.length === 2, "hay dos sucursales de ejemplo");
  const [local, otroLocal] = sucursales;

  // --- Personas sintéticas ---------------------------------------------------------
  const persona = async (clave, rol) => {
    const user = (
      await pool.query(
        `INSERT INTO users(public_id,email,password_hash,name,email_verified_at)
         VALUES($1,$1||'@flash.test','x',$2,now()) RETURNING id,public_id`,
        [`${marca}-${clave}`, `${clave} Sintético`],
      )
    ).rows[0];
    await pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,$2)", [user.id, rol]);
    usuarios.push(user);
    return user;
  };
  const cliente = await persona("cliente", "customer");
  const conductor = await persona("repartidor", "driver");
  repartidor = (
    await pool.query(
      `INSERT INTO drivers(public_id,user_id,online,active_mode,service_modes,current_location,location_updated_at,metadata)
       VALUES($1,$2,true,'delivery',ARRAY['delivery']::job_kind[],ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,now(),'{}'::jsonb)
       RETURNING id,public_id`,
      [`DRV-${marca}`, conductor.id, Number(local.lng), Number(local.lat)],
    )
  ).rows[0];
  // Con un vehículo aprobado es un candidato de verdad para la lista corta: sin él, que no
  // reciba un pedido suelto no probaría nada.
  await pool.query(
    `INSERT INTO vehicles(public_id,driver_id,kind,model,plate,color,seats,active,service_modes,status,reviewed_at)
     VALUES($1,$2,'motorcycle','Moto de prueba',$3,'Negro',1,true,ARRAY['delivery']::job_kind[],'approved',now())`,
    [`VEH-${marca}`, repartidor.id, `LT${marca.slice(-8).toUpperCase()}`],
  );

  // Un pedido de comida sintético. `este` y `norte` son metros desde el local.
  const pedido = async (clave, { sucursal, status, driverId = null, este = 0, norte = 0 }) => {
    const lat = Number(sucursal.lat) + norte / 111320;
    const lng =
      Number(sucursal.lng) + este / (111320 * Math.cos((Number(sucursal.lat) * Math.PI) / 180));
    const job = (
      await pool.query(
        `INSERT INTO jobs(public_id,kind,customer_id,merchant_id,branch_id,driver_id,status,pickup_address,pickup_location,
           dropoff_address,dropoff_location,service_level,quoted_amount_cents,final_amount_cents,distance_m,
           estimated_duration_s,payment_method_label,metadata)
         VALUES($1,'delivery',$2,$3,$4,$5,$6,'Local',ST_SetSRID(ST_MakePoint($7,$8),4326)::geography,
           'Casa',ST_SetSRID(ST_MakePoint($9,$10),4326)::geography,'food',1000000,1000000,2000,1200,'Flash Wallet',$11)
         RETURNING id,public_id`,
        [
          `ORD-${marca}-${clave}`,
          cliente.id,
          sucursal.merchant_id,
          sucursal.id,
          driverId,
          status,
          Number(sucursal.lng),
          Number(sucursal.lat),
          lng,
          lat,
          { subtype: "food_order", fulfillment: "delivery", deliveryFee: 1500, etaMin: 30 },
        ],
      )
    ).rows[0];
    jobs.push(job.id);
    return job;
  };
  // El que ya lleva: a 1,5 km al este. El candidato: a 2 km al este, en el camino (sin
  // desvío). El lejano, al oeste: entregar antes el primero le suma ida y vuelta, 3 km.
  const primero = await pedido("primero", {
    sucursal: local,
    status: "driver_assigned",
    driverId: repartidor.id,
    este: 1500,
  });
  const enElCamino = await pedido("camino", {
    sucursal: local,
    status: "ready_for_pickup",
    este: 2000,
  });
  const lejos = await pedido("lejos", { sucursal: local, status: "ready_for_pickup", este: -3000 });
  const deOtroLocal = await pedido("otro", {
    sucursal: otroLocal,
    status: "ready_for_pickup",
    este: 1200,
  });

  const ofertasA = async (jobId) =>
    (
      await pool.query(
        "SELECT public_id,score_breakdown FROM dispatch_offers WHERE job_id=$1 AND driver_id=$2",
        [jobId, repartidor.id],
      )
    ).rows;

  // --- Ofertas ---------------------------------------------------------------------
  await enTransaccion((client) =>
    createDispatchOffers(client, { jobId: enElCamino.id, mode: "delivery" }),
  );
  const lote = await ofertasA(enElCamino.id);
  assert(
    lote.length === 1 &&
      lote[0].score_breakdown.batch?.anchorOrderId === primero.public_id &&
      lote[0].score_breakdown.batch.sequence === 2 &&
      lote[0].score_breakdown.batch.extraM <= 2500,
    "un pedido del mismo local y en el camino se ofrece como lote",
  );
  // Con una lista larga, el repartidor sintético entra seguro entre los puntuados: si no
  // recibe la oferta es por el filtro de quien ya lleva un pedido, no por el corte.
  await enTransaccion((client) =>
    createDispatchOffers(client, { jobId: lejos.id, mode: "delivery", limit: 50 }),
  );
  await enTransaccion((client) =>
    createDispatchOffers(client, { jobId: deOtroLocal.id, mode: "delivery", limit: 50 }),
  );
  assert(
    (await ofertasA(lejos.id)).length === 0 && (await ofertasA(deOtroLocal.id)).length === 0,
    "con un desvío de más o de otro local no hay lote, ni oferta suelta a quien ya lleva uno",
  );
  const vistas = await getPostgresDispatchOffers(repartidor.public_id);
  const vista = vistas.find((oferta) => oferta.jobId === enElCamino.public_id);
  assert(
    vista?.batch?.anchorOrderId === primero.public_id && vista.courierEarning === 1500,
    "la oferta dice que es un lote y cuánto gana quien reparte",
  );

  // --- Aceptar -----------------------------------------------------------------------
  // Un pedido de otro local, con uno en curso, se rechaza aunque tenga una oferta.
  await pool.query(
    `INSERT INTO dispatch_offers(public_id,job_id,driver_id,score,expires_at,score_breakdown)
     VALUES($1,$2,$3,1,now()+interval '1 minute','{}'::jsonb)`,
    [`OFR-${marca}-otro`, deOtroLocal.id, repartidor.id],
  );
  const suelto = await espera(
    enTransaccion((client) =>
      acceptDispatchOffer(client, {
        jobPublicId: deOtroLocal.public_id,
        driverPublicId: repartidor.public_id,
        actorUserId: conductor.id,
      }),
    ),
  );
  assert(
    suelto?.status === 409 && /mismo local/.test(suelto.message),
    "con un pedido en curso no se suma uno de otro local",
  );
  await enTransaccion((client) =>
    acceptDispatchOffer(client, {
      jobPublicId: enElCamino.public_id,
      driverPublicId: repartidor.public_id,
      actorUserId: conductor.id,
    }),
  );
  const unido = (
    await pool.query("SELECT driver_id,batch_anchor_id,metadata FROM jobs WHERE id=$1", [
      enElCamino.id,
    ])
  ).rows[0];
  assert(
    unido.driver_id === repartidor.id &&
      unido.batch_anchor_id === primero.id &&
      Number(unido.metadata.etaMin) === 30 + Number(unido.metadata.batch.extraMinutes),
    "aceptar el lote lo une al primero y suma el desvío al horario estimado",
  );

  // --- Lo que ven las personas ---------------------------------------------------------
  const posiciones = async () =>
    Object.fromEntries(
      (await getPostgresOrders({ publicIds: [primero.public_id, enElCamino.public_id] })).map(
        (orden) => [orden.id, orden.batch?.position ?? null],
      ),
    );
  const antes = await posiciones();
  assert(
    antes[primero.public_id] === 1 && antes[enElCamino.public_id] === 2,
    "cada pedido dice qué entrega es",
  );
  const segundo = async () =>
    (await pool.query("SELECT batch_anchor_id,metadata FROM jobs WHERE id=$1", [enElCamino.id]))
      .rows[0];

  // --- El lote se deshace solo -----------------------------------------------------------
  // La operación le saca el segundo al repartidor (como `releaseJobFromDriver`): vuelve a
  // la cola sin vínculo y sin los minutos de desvío, y se puede volver a agrupar.
  await pool.query(
    "UPDATE jobs SET driver_id=NULL,status='ready_for_pickup',version=version+1 WHERE id=$1",
    [enElCamino.id],
  );
  const liberado = await segundo();
  const tras = await posiciones();
  assert(
    liberado.batch_anchor_id === null &&
      liberado.metadata.batch === undefined &&
      Number(liberado.metadata.etaMin) === 30 &&
      tras[primero.public_id] === null &&
      tras[enElCamino.public_id] === null,
    "liberado, el segundo vuelve a la cola sin lote y sin el desvío",
  );
  await pool.query("DELETE FROM dispatch_offers WHERE job_id=$1 AND driver_id=$2", [
    enElCamino.id,
    repartidor.id,
  ]);
  await enTransaccion((client) =>
    createDispatchOffers(client, { jobId: enElCamino.id, mode: "delivery" }),
  );
  await enTransaccion((client) =>
    acceptDispatchOffer(client, {
      jobPublicId: enElCamino.public_id,
      driverPublicId: repartidor.public_id,
      actorUserId: conductor.id,
    }),
  );
  const reagrupado = await segundo();
  assert(
    reagrupado.batch_anchor_id === primero.id &&
      Number(reagrupado.metadata.etaMin) === 30 + Number(reagrupado.metadata.batch.extraMinutes),
    "un pedido liberado se vuelve a agrupar, con el desvío sumado una sola vez",
  );

  // Si el primero se cancela, el segundo sigue solo y se entrega sin desvío.
  await pool.query("UPDATE jobs SET status='cancelled' WHERE id=$1", [primero.id]);
  const despues = await posiciones();
  const solo = await segundo();
  assert(
    despues[enElCamino.public_id] === null &&
      solo.batch_anchor_id === null &&
      Number(solo.metadata.etaMin) === 30,
    "si uno se cancela, el otro sigue solo y sin el desvío en su horario",
  );

  // Control: sin pedidos en curso, el mismo repartidor sí recibe un pedido suelto. Prueba
  // que antes no lo recibía por llevar uno, no porque no fuera candidato.
  await pool.query("UPDATE jobs SET status='cancelled' WHERE id=$1", [enElCamino.id]);
  await enTransaccion((client) =>
    createDispatchOffers(client, { jobId: lejos.id, mode: "delivery", limit: 50 }),
  );
  assert(
    (await ofertasA(lejos.id)).length === 1,
    "sin pedidos en curso, el repartidor recibe el pedido suelto",
  );
} finally {
  const ids = usuarios.map((user) => user.id);
  const publicos = (
    await pool.query("SELECT public_id FROM jobs WHERE id = ANY($1)", [jobs])
  ).rows.map((row) => row.public_id);
  // Los pedidos sintéticos también se les ofrecen a los repartidores de ejemplo: sus
  // avisos de oferta se borran, el resto de sus avisos no.
  await pool.query(
    "DELETE FROM notifications WHERE user_id = ANY($1) OR (template='dispatch_offer' AND payload->>'jobId' = ANY($2))",
    [ids, publicos],
  );
  await pool.query("UPDATE jobs SET batch_anchor_id=NULL WHERE id = ANY($1)", [jobs]);
  const hijas = (
    await pool.query(
      `SELECT c.conrelid::regclass::text tabla, a.attname columna
       FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
       WHERE c.contype='f' AND c.confrelid='jobs'::regclass AND c.conrelid<>'jobs'::regclass
         AND array_length(c.conkey,1)=1`,
    )
  ).rows;
  for (let vuelta = 0; vuelta < 3; vuelta += 1)
    for (const { tabla, columna } of hijas)
      await pool.query(`DELETE FROM ${tabla} WHERE ${columna} = ANY($1)`, [jobs]).catch(() => null);
  await pool.query("DELETE FROM jobs WHERE id = ANY($1)", [jobs]);
  if (repartidor) await pool.query("DELETE FROM drivers WHERE id=$1", [repartidor.id]);
  await pool.query("DELETE FROM user_roles WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM users WHERE id = ANY($1)", [ids]);
  await pool.end();
  await closePostgres();
}
