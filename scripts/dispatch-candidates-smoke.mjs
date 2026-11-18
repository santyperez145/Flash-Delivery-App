// Contrato de selección de candidatos de dispatch (ticket DSP-001, H-06).
//
// Verifica la forma de las consultas y la escalera de radios sin base de datos,
// así corre en la puerta rápida. El comportamiento de runtime lo prueba
// `test:postgres` contra PostgreSQL, que ya bloquea el merge.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

process.env.DISPATCH_SEARCH_RADIUS_M = "8000";
process.env.DISPATCH_MAX_RADIUS_M = "25000";
process.env.DISPATCH_SHORTLIST_SIZE = "30";

const { SHORTLIST_SQL, SCORE_SQL, radiusLadder } = await import("../server/dispatch-candidates.js");

const ok = (label) => console.log(`ok - ${label}`);

// --- Etapa 1: el recorte espacial existe y usa el índice ---------------------

assert.ok(SHORTLIST_SQL.includes("ST_DWithin"), "falta ST_DWithin");
assert.ok(SHORTLIST_SQL.includes("<->"), "falta el orden KNN");
ok("la lista corta recorta con ST_DWithin y ordena por KNN");

assert.match(SHORTLIST_SQL, /LIMIT \$4/);
ok("la lista corta está acotada por un límite explícito");

// El planificador sólo usa el índice para KNN cuando uno de los operandos es
// constante en la consulta. Si el punto viniera de un join, el recorte
// existiría en el texto pero no en el plan.
assert.match(SHORTLIST_SQL, /ORDER BY d\.current_location <-> \$1::geography/);
assert.ok(!/<->\s*j\./.test(SHORTLIST_SQL), "el operando KNN no puede venir de un join");
ok("el punto de pickup entra como parámetro, no como columna de un join");

// El índice es parcial: `drivers_available_location_gix ... WHERE online`.
assert.ok(SHORTLIST_SQL.includes("d.online"), "sin d.online el índice parcial no aplica");
ok("la lista corta filtra por `online`, que es la condición del índice parcial");

// La etapa barata no puede arrastrar los agregados caros.
for (const caro of ["dispatch_offers", "interval '30 days'", "acceptance_rate"]) {
  assert.ok(!SHORTLIST_SQL.includes(caro), `la etapa 1 no debe contener ${caro}`);
}
ok("la etapa 1 no calcula historial: para eso está la etapa 2");

// --- Etapa 2: el trabajo caro queda acotado ---------------------------------

assert.ok(
  SCORE_SQL.includes("d.id = ANY($2::uuid[])"),
  "la puntuación debe limitarse a la lista corta",
);
ok("la puntuación sólo evalúa los candidatos de la lista corta");

assert.ok(SCORE_SQL.includes("interval '30 days'"), "la etapa 2 conserva el historial");
assert.ok(SCORE_SQL.includes("score_breakdown") === false);
ok("la etapa 2 conserva el historial de 30 días, ahora sobre un conjunto acotado");

// El score no cambia: la optimización decide a cuántos se evalúa, no a quién se
// le ofrece el trabajo.
for (const componente of [
  "rating_points",
  "distance_penalty",
  "load_penalty",
  "freshness_penalty",
  "acceptance_points",
  "response_points",
]) {
  assert.ok(SCORE_SQL.includes(componente), `falta el componente ${componente}`);
}
ok("los componentes del score explicable siguen siendo los mismos");

// --- Escalera de radios ------------------------------------------------------

const ladder = radiusLadder();
assert.equal(ladder[0], 8000);
assert.equal(ladder[ladder.length - 1], 25000);
assert.ok(ladder.length > 1);
ok(`la escalera de radios va de ${ladder[0]} m a ${ladder[ladder.length - 1]} m`);

assert.deepEqual(radiusLadder({ base: 5000, max: 5000 }), [5000]);
ok("sin margen de expansión la escalera tiene un solo escalón");

assert.deepEqual(radiusLadder({ base: 1000, max: 8000 }), [1000, 2000, 4000, 8000]);
ok("la escalera duplica hasta el máximo, sin pasarse");

const creciente = ladder.every((radius, index) => index === 0 || radius > ladder[index - 1]);
assert.ok(creciente, "la escalera debe ser estrictamente creciente");
ok("la escalera nunca repite ni retrocede un radio");

// --- Regresión sobre el hallazgo original ------------------------------------

// La evidencia de H-06 fue exactamente que no había ninguna ocurrencia.
const dispatchSources = await Promise.all(
  ["server/dispatch-candidates.js", "server/dispatch-repository.js"].map((file) =>
    fs.readFile(file, "utf8"),
  ),
);
const combined = dispatchSources.join("\n");
assert.ok(combined.includes("ST_DWithin"), "el dispatch volvió a quedar sin recorte espacial");
assert.ok(combined.includes("<->"), "el dispatch volvió a quedar sin orden KNN");
ok("el dispatch no puede volver a quedarse sin recorte espacial");

console.log("\nok - contrato de candidatos de dispatch verificado");
console.log("     pendiente: EXPLAIN ANALYZE con padrón sintético y ETA vial por Route Matrix");

// --- Reservas: cuándo entra un trabajo a la cola (GTM-001) -------------------
//
// La programación y el dispatch son la misma pregunta mirada desde dos lados:
// cuándo un trabajo pasa a estar disponible. La ventana de reserva se afirma
// acá y no en su propio archivo porque romperla rompe el dispatch, no la
// pantalla.
const { validarHorarioProgramado, MINUTOS_MINIMOS_DE_ANTICIPACION, DIAS_MAXIMOS_DE_HORIZONTE } =
  await import("../server/scheduling.js");

// `ahora` fijo: un caso sobre «justo 30 minutos» que dependiera del reloj real
// pasaría o fallaría según cuánto tardó en correr el test.
const AHORA = Date.UTC(2026, 7, 28, 12, 0, 0);
const enMinutos = (minutos) => new Date(AHORA + minutos * 60_000).toISOString();

assert.equal(
  validarHorarioProgramado(enMinutos(MINUTOS_MINIMOS_DE_ANTICIPACION), AHORA),
  null,
  "justo en el mínimo de anticipación se acepta",
);
assert.ok(
  validarHorarioProgramado(enMinutos(MINUTOS_MINIMOS_DE_ANTICIPACION - 1), AHORA),
  "un minuto por debajo del mínimo se rechaza",
);
assert.equal(
  validarHorarioProgramado(enMinutos(DIAS_MAXIMOS_DE_HORIZONTE * 24 * 60), AHORA),
  null,
  "justo en el horizonte máximo se acepta",
);
assert.ok(
  validarHorarioProgramado(enMinutos(DIAS_MAXIMOS_DE_HORIZONTE * 24 * 60 + 1), AHORA),
  "un minuto más allá del horizonte se rechaza",
);
assert.ok(validarHorarioProgramado("mañana a la tarde", AHORA), "una fecha inválida se rechaza");
assert.ok(validarHorarioProgramado(enMinutos(-60), AHORA), "una fecha pasada se rechaza");
ok("la ventana de reserva acepta y rechaza en los bordes exactos");

// **Una sola copia de la ventana.** Vivía escrita a mano en el router de viajes
// y era la única parte del producto que sabía reservar; al programar pedidos de
// comida, una segunda copia habría divergido en silencio.
const routers = await Promise.all(
  [
    "server/http/ride-router.js",
    "server/http/order-router.js",
    "server/http/job-closure-router.js",
  ].map((ruta) => fs.readFile(ruta, "utf8")),
);
for (const [indice, fuente] of routers.entries()) {
  assert.ok(
    fuente.includes("validarHorarioProgramado"),
    `el router ${indice} valida la reserva con la regla compartida`,
  );
  assert.ok(
    !/30 \* 60 \* 1000/.test(fuente),
    `el router ${indice} no volvió a escribir la ventana a mano`,
  );
}
ok("las tres rutas que tocan horarios usan la misma ventana, sin copias");

// El dispatch sigue ignorando lo que todavía no entra en ventana. Si esto se
// perdiera, un pedido reservado para la semana que viene se ofrecería hoy.
const dispatch = await fs.readFile("server/dispatch-repository.js", "utf8");
const ventanas = dispatch.match(/scheduled_for IS NULL OR j\.scheduled_for<=now\(\)/g) || [];
assert.ok(
  ventanas.length >= 4,
  `el dispatch dejó de filtrar reservas futuras (${ventanas.length} filtros)`,
);
ok("el dispatch sigue sin ofrecer trabajos reservados fuera de ventana");

// --- Retiro en el local: nunca entra al despacho (GTM-002) -------------------
//
// El predicado de comida selecciona por `status='ready_for_pickup'`, que es
// exactamente el estado al que llega un pedido retirado cuando la cocina
// termina. Sin el filtro de `fulfillment`, cada pedido que el cliente va a
// buscar al local se le ofreceria a tres conductores, y el primero que aceptara
// se llevaria comida que nadie pidio que se mueva.
//
// Se cuentan los cuatro sitios y no uno: barrido, candidatos, oferta y
// aceptacion son cuatro consultas distintas, y una sola sin el filtro vuelve a
// abrir el agujero.
const dispatchFuente = await fs.readFile("server/dispatch-repository.js", "utf8");
const sinComentariosSql = dispatchFuente
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\r\n]*/g, "$1 ");
const filtrosDeRetiro = (
  sinComentariosSql.match(/COALESCE\(j\.metadata->>'fulfillment','delivery'\)<>'pickup'/g) || []
).length;
const predicadosDeComida = (sinComentariosSql.match(/j\.status='ready_for_pickup'/g) || []).length;
assert.ok(
  predicadosDeComida >= 4,
  `se esperaban al menos 4 predicados de comida y hay ${predicadosDeComida}`,
);
assert.equal(
  filtrosDeRetiro,
  predicadosDeComida,
  `cada predicado de comida necesita su filtro de retiro: ${predicadosDeComida} predicados, ${filtrosDeRetiro} filtros`,
);
ok("el despacho filtra los pedidos para retirar en las cuatro consultas");

// La otra mitad: la creacion directa de ofertas tambien lo sabe. El barrido no
// es el unico camino — `setPostgresOrderStatus` crea ofertas al pasar a listo.
const pedidosFuente = await fs.readFile("server/order-repository.js", "utf8");
assert.ok(
  /if \(databaseTarget === "ready_for_pickup" && !esRetiro\)/.test(pedidosFuente),
  "la creacion directa de ofertas no excluye los pedidos para retirar",
);
ok("al marcar listo un pedido retirado no se crean ofertas de reparto");

// **El pedido retirado tiene que poder completarse.** Es la otra mitad de
// excluirlo del despacho: si nadie lo mueve de `ready_for_pickup`, el retiro
// termina en un pedido cocinado, pagado y trabado para siempre. `nextOrderStatus`
// devolvia `null` en ese estado, porque el unico camino previsto era el del
// conductor.
const rutaFuente = await fs.readFile("server/http/order-router.js", "utf8");
assert.ok(
  /order\.status === "ready_for_pickup" && order\.fulfillment === "pickup"[\s\S]{0,40}return "delivered"/.test(
    rutaFuente,
  ),
  "el pedido para retirar no tiene siguiente estado: queda listo y trabado",
);
ok("un pedido para retirar avanza de listo a entregado");

// Y quien lo completa lo tiene que poder tocar. El servidor ya autoriza al
// comercio; la consola limitaba la accion a `accepted`/`preparing`.
const consolaFuente = await fs.readFile("src/merchant/MerchantConsole.tsx", "utf8");
assert.ok(
  /order\.fulfillment === "pickup" && order\.status === "ready_for_pickup"/.test(consolaFuente),
  "la consola del comercio no ofrece entregar un pedido para retirar",
);
assert.ok(
  /<MerchantPickupSwitch/.test(consolaFuente),
  "la consola del comercio no permite habilitar el retiro",
);
ok("el comercio habilita el retiro y entrega el pedido en el mostrador");
