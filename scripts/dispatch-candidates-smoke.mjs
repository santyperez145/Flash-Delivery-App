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
