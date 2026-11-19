// Pedidos agrupados (P-03): el cableado, sin base.
//
// `test:order-batching` recorre la oferta, la aceptación y las vistas contra
// PostgreSQL. Esto vigila lo que esa prueba no ve: que el lote sólo junte pedidos del
// mismo local y todavía sin retirar, que nunca pase de dos ni se sume a otro servicio,
// que el tope de desvío salga de la configuración, que se vuelva a controlar al
// aceptar con el primero bloqueado, que un lote en efectivo respete la deuda, que a
// quien ya lleva un pedido no le llegue uno suelto, y que las pantallas lo muestren.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { contains, squeeze } from "./source-contract.mjs";

const leer = (ruta) => fs.readFile(ruta, "utf8");
const [migracion, configuracion, despacho, pedidos, contratos, tiposWeb, tiposMovil] =
  await Promise.all(
    [
      "database/migrations/149_food_order_batches.sql",
      "server/config.js",
      "server/dispatch-repository.js",
      "server/order-repository.js",
      "packages/domain-contracts/src/index.ts",
      "src/types.ts",
      "apps/mobile/src/types.ts",
    ].map(leer),
  );

const tramo = (fuente, desde, hasta) => {
  const inicio = fuente.indexOf(desde);
  assert.ok(inicio >= 0, `falta ${desde}`);
  const fin = fuente.indexOf(hasta, inicio + desde.length);
  return fuente.slice(inicio, fin < 0 ? undefined : fin);
};

// --- La base: un segundo pedido apunta al primero, y uno solo por vez --------------
assert.ok(
  contains(migracion, "ADD COLUMN batch_anchor_id uuid REFERENCES jobs(id) ON DELETE SET NULL"),
  "el segundo pedido apunta al primero",
);
assert.ok(
  contains(
    migracion,
    "CREATE UNIQUE INDEX jobs_one_batch_follower ON jobs(batch_anchor_id) WHERE batch_anchor_id IS NOT NULL AND status NOT IN ('completed', 'cancelled')",
  ),
  "un pedido sostiene a lo sumo un segundo pedido en curso",
);

// --- La configuración: se puede apagar y el tope es explícito ----------------------
assert.ok(
  contains(configuracion, "FOOD_BATCHING_ENABLED: booleanFromEnv.default(true)") &&
    contains(configuracion, "batchingEnabled: env.FOOD_BATCHING_ENABLED"),
  "los lotes se pueden apagar por ambiente",
);
assert.ok(
  contains(
    configuracion,
    "FOOD_BATCH_MAX_DETOUR_M: z.coerce.number().int().min(0).max(50000).default(2500)",
  ) && contains(configuracion, "batchMaxDetourM: env.FOOD_BATCH_MAX_DETOUR_M"),
  "el desvío máximo sale de la configuración",
);

// --- Qué forma un lote ---------------------------------------------------------------
const lote = tramo(despacho, "const LOTE_COMPATIBLE_SQL", "const minutosDeDesvio");
assert.ok(
  contains(lote, "JOIN jobs a ON a.branch_id = n.branch_id AND a.id <> n.id"),
  "sólo pedidos del mismo local",
);
assert.ok(
  contains(lote, "a.status IN ('driver_assigned','arriving')") &&
    contains(lote, "AND a.batch_anchor_id IS NULL"),
  "el primero todavía no se retiró y no es a su vez un segundo",
);
assert.ok(
  contains(lote, "JOIN drivers d ON d.id = a.driver_id AND d.online"),
  "quien lo lleva está en línea",
);
assert.ok(
  contains(lote, "n.driver_id IS NULL AND n.branch_id IS NOT NULL"),
  "el pedido nuevo está libre y tiene local",
);
assert.ok(
  contains(lote, "AND x.status NOT IN ('completed','cancelled')) = 1"),
  "quien lo lleva no tiene ningún otro servicio en curso",
);
assert.ok(
  contains(
    lote,
    "AND NOT EXISTS (SELECT 1 FROM jobs f WHERE f.batch_anchor_id = a.id AND f.status NOT IN ('completed','cancelled'))",
  ),
  "como mucho dos pedidos por lote",
);
assert.ok(
  contains(
    lote,
    "ST_Distance(a.pickup_location, a.dropoff_location) + ST_Distance(a.dropoff_location, n.dropoff_location)" +
      " - ST_Distance(n.pickup_location, n.dropoff_location) <= $2 ORDER BY extra_m, a.created_at",
  ),
  "el desvío del segundo cliente no supera el tope",
);
assert.ok(
  contains(lote, "AND n.batch_anchor_id IS NULL") &&
    contains(
      lote,
      "AND NOT EXISTS (SELECT 1 FROM jobs g WHERE g.batch_anchor_id = n.id AND g.status NOT IN ('completed','cancelled'))",
    ),
  "el pedido nuevo no es parte de otro lote: nunca una cadena de tres",
);
assert.ok(
  contains(
    lote,
    "AND ($3::uuid IS NOT NULL OR NOT EXISTS (SELECT 1 FROM dispatch_offers p WHERE p.job_id = n.id AND p.driver_id = d.id))",
  ),
  "en la ronda siguiente el lote le llega a otro repartidor del mismo local",
);
assert.ok(
  contains(lote, "AND ($3::uuid IS NULL OR d.id = $3)"),
  "al aceptar se controla para ese repartidor",
);

// --- La oferta -------------------------------------------------------------------------
const oferta = tramo(despacho, "export async function createDispatchOffers", "\nexport ");
assert.ok(
  contains(oferta, "if (job.food) {") &&
    contains(
      oferta,
      "await client.query(`${LOTE_COMPATIBLE_SQL} LIMIT 2`, [ jobId, config.dispatch.batchMaxDetourM, null, ])",
    ),
  "un pedido de comida se ofrece primero como lote, con el tope configurado",
);
assert.ok(
  contains(oferta, "const lotesHabilitados = job.cash ? await elegiblesParaEfectivo("),
  "un lote en efectivo respeta la deuda de quien reparte",
);
assert.ok(
  contains(oferta, "if (!lotesHabilitados.includes(lote.driver_id)) continue;"),
  "quien no puede tomar efectivo no recibe el lote",
);
assert.ok(
  contains(
    oferta,
    "const habilitados = job.food ? await sinPedidoEnCurso(client, habilitadosEfectivo) : habilitadosEfectivo;",
  ),
  "a quien ya lleva un pedido no le llega uno de comida suelto",
);
assert.ok(
  oferta.indexOf("await sinPedidoEnCurso(client, habilitadosEfectivo)") > 0 &&
    oferta.indexOf("await sinPedidoEnCurso(client, habilitadosEfectivo)") <
      oferta.indexOf(
        "await scoreCandidates(client, { jobId, driverIds: habilitados, mode, limit })",
      ),
  "quien ya lleva un pedido se saca antes de puntuar, no después del corte",
);
const libres = tramo(despacho, "const sinPedidoEnCurso", "const minutosDeDesvio");
assert.ok(
  contains(
    libres,
    "WHERE driver_id = ANY($1::uuid[]) AND kind='delivery' AND status NOT IN ('completed','cancelled')",
  ) && contains(libres, "return driverIds.filter((id) => !ocupados.has(id));"),
  "ocupado es tener cualquier entrega en curso",
);

// --- La aceptación -----------------------------------------------------------------------
const aceptar = tramo(despacho, "export async function acceptDispatchOffer", "\nexport ");
assert.ok(
  contains(
    aceptar,
    'if (offer.kind === "delivery" && offer.subtype === "food_order" && active >= 1) {',
  ),
  "con un pedido en curso, uno de comida sólo se suma como lote",
);
assert.ok(
  contains(
    aceptar,
    "await client.query(`${LOTE_COMPATIBLE_SQL} LIMIT 1 FOR UPDATE OF a`, [ offer.job_id, config.dispatch.batchMaxDetourM, offer.driver_id, ])",
  ),
  "se vuelve a controlar al aceptar, con el primero bloqueado",
);
assert.ok(
  aceptar.indexOf('"SELECT id FROM drivers WHERE id=$1 FOR UPDATE"') <
    aceptar.indexOf("LIMIT 1 FOR UPDATE OF a"),
  "el repartidor se bloquea antes que el primer pedido",
);
assert.ok(
  contains(aceptar, "if (!lote) throw Object.assign(") && contains(aceptar, "{ status: 409 }"),
  "sin lote compatible, la aceptación se rechaza",
);
assert.ok(
  aceptar.indexOf("LIMIT 1 FOR UPDATE OF a") < aceptar.indexOf("UPDATE jobs SET driver_id=$1"),
  "el control va antes de asignar",
);
assert.ok(
  contains(aceptar, "UPDATE jobs SET batch_anchor_id=$2,") &&
    contains(aceptar, "to_jsonb(COALESCE((metadata->>'etaMin')::int,0) + $3::int)"),
  "aceptar une el pedido al primero y suma el desvío al horario",
);

// --- Las vistas -----------------------------------------------------------------------------
const ofertas = tramo(despacho, "export async function getPostgresDispatchOffers", "\nexport ");
assert.ok(
  contains(ofertas, "batch: row.score_breakdown?.batch ?? null,"),
  "la oferta dice que es un lote",
);
assert.ok(
  contains(
    ofertas,
    'courierEarning: row.metadata?.subtype === "food_order" ? Number(row.metadata?.deliveryFee || 0) + pesos(row.held_tip_cents) : null,',
  ) &&
    contains(
      ofertas,
      "COALESCE((SELECT sum(t.amount_cents) FROM service_tips t WHERE t.job_id=j.id AND t.status='held'),0) held_tip_cents",
    ),
  "la oferta de comida dice lo que gana quien reparte, envío y propina, no el total del pedido",
);
assert.ok(
  contains(
    pedidos,
    "WHEN EXISTS (SELECT 1 FROM jobs f WHERE f.batch_anchor_id=j.id AND f.status NOT IN ('completed','cancelled')) THEN 1",
  ) &&
    contains(
      pedidos,
      "WHEN j.batch_anchor_id IS NOT NULL AND EXISTS (SELECT 1 FROM jobs a WHERE a.id=j.batch_anchor_id AND a.status NOT IN ('completed','cancelled')) THEN 2",
    ),
  "el pedido sabe qué entrega es, mientras los dos siguen en curso",
);
assert.ok(
  contains(
    pedidos,
    "batch: row.batch_position ? { position: Number(row.batch_position), stops: 2 } : null,",
  ),
  "el pedido expone su lugar en el lote",
);
assert.ok(
  contains(contratos, "export type OrderBatch = {") &&
    squeeze(contratos).includes("position:1|2;") &&
    contains(tiposWeb, "batch?: OrderBatch | null") &&
    contains(tiposMovil, "batch?: OrderBatch | null"),
  "el lote está en los tipos compartidos de las dos apps",
);

// --- Las pantallas ---------------------------------------------------------------------------
const [
  webLote,
  webOperaciones,
  webSeguimiento,
  movilLote,
  movilTurno,
  movilInicio,
  movilSeguimiento,
  movilUi,
] = await Promise.all(
  [
    "src/operations/BatchRoute.tsx",
    "src/operations/OperationsSurface.tsx",
    "src/customer/OrderTrackingSheet.tsx",
    "apps/mobile/src/order-batch.ts",
    "apps/mobile/src/screens/useDriverShift.tsx",
    "apps/mobile/src/screens/DriverHomePanel.tsx",
    "apps/mobile/src/screens/CustomerTrackingSheets.tsx",
    "apps/mobile/src/ui.tsx",
  ].map(leer),
);
// El recorrido: primero lo que falta retirar, después las entregas por su lugar.
for (const [fuente, plataforma] of [
  [webLote, "web"],
  [movilLote, "móvil"],
])
  assert.ok(
    contains(fuente, "(a.batch?.position ?? 0) - (b.batch?.position ?? 0)") ||
      contains(fuente, "(a.order.batch?.position ?? 0) - (b.order.batch?.position ?? 0)"),
    `${plataforma}: las entregas van por su lugar en el lote`,
  );
assert.ok(
  contains(
    webLote,
    "Number(yaRetirado(a)) - Number(yaRetirado(b)) || (a.batch?.position ?? 0) - (b.batch?.position ?? 0)",
  ) &&
    contains(
      movilLote,
      "Number(orderPickedUp(a.order)) - Number(orderPickedUp(b.order)) || (a.order.batch?.position ?? 0) - (b.order.batch?.position ?? 0)",
    ),
  "primero se retira en el local y después se entrega",
);
assert.ok(
  contains(webOperaciones, "const activeOrders = ordenarRecorrido(") &&
    contains(movilTurno, "const activeOrders = ordersInRouteOrder("),
  "quien reparte ve sus pedidos en el orden del recorrido",
);
assert.ok(
  contains(movilTurno, "const order = activeOrders[0];") &&
    contains(movilTurno, "const toPickup = !orderPickedUp(order);"),
  "móvil: la navegación va a la próxima parada",
);
assert.ok(
  contains(webOperaciones, "Próxima parada: {siguienteParada}") &&
    contains(webLote, "const porRetirar = orders.find((order) => !yaRetirado(order));"),
  "web: la próxima parada es el local mientras falte retirar",
);
assert.ok(
  contains(webOperaciones, "Retirá los 2 pedidos del local") &&
    contains(movilInicio, "Retirá los 2 pedidos del local"),
  "las dos apps avisan que se retiran los dos juntos",
);
assert.ok(
  contains(webLote, "Entrega {order.batch.position} de {order.batch.stops}") &&
    contains(movilLote, "`Entrega ${batch.position} de ${batch.stops}`") &&
    contains(movilUi, 'preferencias === "reparto" && order.batch &&'),
  "cada pedido del lote dice qué entrega es, sólo a quien reparte",
);
assert.ok(
  contains(webLote, '"Sumá un pedido del mismo local"') &&
    contains(movilInicio, "Sumá un pedido del mismo local") &&
    contains(webLote, "+${offer.batch.extraMinutes} min") &&
    contains(movilLote, "`+${minutos} min`"),
  "la oferta de lote se distingue y dice los minutos de desvío",
);
assert.ok(
  contains(webLote, "Ganás ${money.format(offer.courierEarning)}") &&
    contains(movilInicio, "Ganás ${money.format(offer.courierEarning)}"),
  "la oferta de comida muestra lo que gana quien reparte",
);
const lineaCliente =
  "Tu repartidor entrega primero otro pedido del mismo local. Ya está contado en el horario estimado.";
assert.ok(
  contains(webSeguimiento, lineaCliente) &&
    contains(webSeguimiento, 'order.batch && !["delivered", "cancelled"].includes(order.status)') &&
    contains(movilLote, lineaCliente) &&
    contains(movilSeguimiento, "customerBatchLine(order)"),
  "quien pidió sabe que su pedido va segundo y que el horario ya lo cuenta",
);

// --- El lote se deshace solo ---------------------------------------------------------------
const deshacer = tramo(migracion, "CREATE OR REPLACE FUNCTION app.undo_food_order_batch()", "$$;");
assert.ok(
  contains(deshacer, "liberado boolean := OLD.driver_id IS NOT NULL AND NEW.driver_id IS NULL;") &&
    contains(
      deshacer,
      "cancelado boolean := NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled';",
    ),
  "el lote se deshace al liberar o cancelar",
);
assert.ok(
  contains(
    deshacer,
    "IF liberado AND NEW.batch_anchor_id IS NOT NULL THEN NEW.batch_anchor_id := NULL;",
  ) &&
    contains(
      deshacer,
      "WHERE batch_anchor_id = NEW.id AND status NOT IN ('completed', 'cancelled');",
    ),
  "se deshace de los dos lados: el liberado y el segundo del que se va",
);
assert.ok(
  squeeze(deshacer).split(squeeze("- COALESCE((NEW.metadata->'batch'->>'extraMinutes')::int, 0)"))
    .length === 2 &&
    squeeze(deshacer).split(squeeze("- COALESCE((metadata->'batch'->>'extraMinutes')::int, 0)"))
      .length === 2,
  "al deshacerse, el horario pierde los minutos de desvío",
);
assert.ok(
  contains(
    migracion,
    "CREATE TRIGGER jobs_undo_food_order_batch BEFORE UPDATE OF status, driver_id ON jobs FOR EACH ROW EXECUTE FUNCTION app.undo_food_order_batch();",
  ),
  "el trigger corre en cada liberación y cancelación, venga de donde venga",
);

// Una oferta de lote no trae la tasa de aceptación: no se muestra «NaN%».
assert.ok(
  contains(webOperaciones, "Number.isFinite(tasa) ?") &&
    contains(movilInicio, "Number.isFinite(offer.scoreBreakdown?.acceptanceRate) &&"),
  "sin historial calculado, la oferta no muestra la tasa",
);

console.log("order batching contract ok");
