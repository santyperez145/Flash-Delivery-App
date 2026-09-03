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

assert.ok(SCORE_SQL.includes("driver_dispatch_stats"), "la etapa 2 usa stats precomputadas");
ok("la etapa 2 lee driver_dispatch_stats en lugar de agregar dispatch_offers");

assert.ok(
  !SCORE_SQL.includes("interval '30 days'"),
  "la etapa 2 no recalcula historial en caliente",
);
assert.ok(
  !/LEFT JOIN LATERAL\s*\([\s\S]*dispatch_offers prior/.test(SCORE_SQL),
  "sin agregado lateral de dispatch_offers",
);
ok("la etapa 2 no agrega historial de 30 días por candidato");

// El score no cambia: la optimización decide a cuántos se evalúa, no a quién se
// le ofrece el trabajo.
for (const componente of [
  "rating_points",
  "distance_penalty",
  "load_penalty",
  "freshness_penalty",
  "acceptance_points",
  "response_points",
  "incident_penalty",
]) {
  assert.ok(SCORE_SQL.includes(componente), `falta el componente ${componente}`);
}
ok("los componentes del score explicable siguen siendo los mismos");

assert.ok(SCORE_SQL.includes("incident_score") || SCORE_SQL.includes("incident_penalty"));
ok("el score resta la penalización de incidentes precomputada");

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

const { REFRESH_DRIVER_DISPATCH_STATS_SQL } = await import("../server/dispatch-stats.js");
assert.ok(REFRESH_DRIVER_DISPATCH_STATS_SQL.includes("INSERT INTO driver_dispatch_stats"));
assert.ok(REFRESH_DRIVER_DISPATCH_STATS_SQL.includes("ON CONFLICT (driver_id, service)"));
assert.ok(REFRESH_DRIVER_DISPATCH_STATS_SQL.includes("acceptance_rate_30d"));
assert.ok(REFRESH_DRIVER_DISPATCH_STATS_SQL.includes("percentile_cont(0.5)"));
assert.ok(
  REFRESH_DRIVER_DISPATCH_STATS_SQL.includes("ride_safety_incidents"),
  "el refresh debe leer incidentes de seguridad",
);
assert.ok(
  REFRESH_DRIVER_DISPATCH_STATS_SQL.includes("false_alarm"),
  "los falsos positivos no deben penalizar",
);
ok("el refresh upsertea stats con aceptación, mediana e incident_score desde safety");
