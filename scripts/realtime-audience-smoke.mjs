// Contrato de audiencias realtime (SEC-001).
//
// Verifica que ningún evento publicado por la API pueda difundirse a todos los
// roles por omisión. La comprobación es estática: no necesita PostgreSQL, por lo
// que puede bloquear cada PR desde la puerta rápida de CI.
import fs from "node:fs/promises";
import { classifyRealtimeAudience } from "../server/realtime-audience.js";

const failures = [];
function check(condition, label, detail = "") {
  if (condition) {
    console.log(`ok - ${label}`);
    return;
  }
  failures.push(`${label}${detail ? `: ${detail}` : ""}`);
}

// --- 1. Inventario real de eventos publicados por la API ---------------------

const source = await fs.readFile("server/index.js", "utf8");

function publishedEvents(src) {
  const events = [];
  const opener = /publishRealtimeEvent\(\{/g;
  let match;
  while ((match = opener.exec(src))) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth += 1;
      else if (src[i] === "}") depth -= 1;
      i += 1;
    }
    const block = src.slice(match.index + match[0].length, i);
    const entityType = block.match(/entityType:\s*"([a-z_]+)"/i);
    const type = block.match(/type:\s*"([a-z0-9_.]+)"/i);
    // La definición de la propia función usa parámetros por defecto, no literales.
    if (!entityType && !type) continue;
    events.push({
      line: src.slice(0, match.index).split("\n").length,
      type: type ? type[1] : null,
      entityType: entityType ? entityType[1] : null,
    });
  }
  return events;
}

const events = publishedEvents(source);
check(
  events.length > 0,
  `se inventariaron ${events.length} publicaciones realtime en server/index.js`,
);

// --- 2. Ninguna publicación real puede quedar sin clasificar -----------------

const unclassified = events.filter((event) => classifyRealtimeAudience(event) === "unclassified");
check(
  unclassified.length === 0,
  "toda publicación realtime resuelve una audiencia explícita",
  unclassified
    .map(
      (e) => `server/index.js:${e.line} entityType=${e.entityType ?? "(ninguno)"} type=${e.type}`,
    )
    .join(" | "),
);

// --- 3. La difusión global es una lista corta y deliberada -------------------

const globals = events.filter((event) => classifyRealtimeAudience(event) === "global");
const globalEntityTypes = [...new Set(globals.map((e) => e.entityType).filter(Boolean))].sort();
const globalEventTypes = [
  ...new Set(globals.filter((e) => !e.entityType).map((e) => e.type)),
].sort();

// Cambiar estas listas es una decisión de privacidad: exige revisión explícita.
const APPROVED_GLOBAL_ENTITY_TYPES = ["pricing_change_request", "service_zone"];
const APPROVED_GLOBAL_EVENT_TYPES = ["platform.reset"];

check(
  JSON.stringify(globalEntityTypes) === JSON.stringify(APPROVED_GLOBAL_ENTITY_TYPES),
  "las entidades de difusión global son exactamente las aprobadas",
  `encontradas: ${JSON.stringify(globalEntityTypes)}`,
);
check(
  JSON.stringify(globalEventTypes) === JSON.stringify(APPROVED_GLOBAL_EVENT_TYPES),
  "los eventos sin entidad de difusión global son exactamente los aprobados",
  `encontrados: ${JSON.stringify(globalEventTypes)}`,
);

// --- 4. Default-deny ante entidades desconocidas -----------------------------

const invented = ["entidad_inventada", "order_v2", "ORDER", "driver_payout_secret", ""];
for (const entityType of invented) {
  check(
    classifyRealtimeAudience({ type: "algo.paso", entityType }) === "unclassified",
    `entityType desconocido "${entityType}" no abre la audiencia`,
  );
}

check(
  classifyRealtimeAudience({ type: "evento.sin.entidad", entityType: null }) === "unclassified",
  "un evento sin entidad ni declaración global no abre la audiencia",
);

// --- 5. Las entidades por usuario siguen resolviendo a participantes ---------

for (const entityType of [
  "user",
  "address",
  "driver",
  "restaurant",
  "support_ticket",
  "order",
  "ride",
  "shipment",
  "job",
]) {
  check(
    classifyRealtimeAudience({ type: "x", entityType }) === "scoped",
    `entityType "${entityType}" resuelve a participantes`,
  );
}

// --- 6. Cobertura: cada entityType publicado tiene su caso arriba ------------

const publishedEntityTypes = [...new Set(events.map((e) => e.entityType).filter(Boolean))].sort();
const covered = new Set([
  ...APPROVED_GLOBAL_ENTITY_TYPES,
  "user",
  "address",
  "driver",
  "restaurant",
  "support_ticket",
  "order",
  "ride",
  "shipment",
  "job",
]);
const uncovered = publishedEntityTypes.filter((entityType) => !covered.has(entityType));
check(
  uncovered.length === 0,
  `los ${publishedEntityTypes.length} entityType publicados tienen caso de prueba`,
  `sin cubrir: ${uncovered.join(", ")}`,
);

// --- Resultado ---------------------------------------------------------------

if (failures.length) {
  console.error(`\n${failures.length} fallo(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `\nok - contrato de audiencias realtime verificado sobre ${events.length} publicaciones`,
);
