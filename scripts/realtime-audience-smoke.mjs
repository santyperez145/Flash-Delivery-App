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

// El inventario recorre **todo el árbol del servidor**, no un archivo.
//
// Leía sólo `server/index.js`. Cuando ARC-001 empezó a extraer grupos de rutas,
// las publicaciones que se mudaban dejaban de inventariarse y el contrato seguía
// en verde con menos cobertura: al sacar las direcciones pasó de 43 a 37
// publicaciones sin decir una palabra. Un contrato acoplado a **dónde vive** el
// código falla igual que uno acoplado a **cómo está escrito**, sólo que en
// silencio, que es peor.
async function serverSources(dir = "server") {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await serverSources(full)));
    else if (entry.name.endsWith(".js")) files.push(full);
  }
  return files.sort();
}

const sources = await Promise.all(
  (await serverSources()).map(async (file) => ({ file, src: await fs.readFile(file, "utf8") })),
);

function publishedEvents(src, file) {
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
      file,
      line: src.slice(0, match.index).split("\n").length,
      type: type ? type[1] : null,
      entityType: entityType ? entityType[1] : null,
    });
  }
  return events;
}

const events = sources.flatMap(({ file, src }) => publishedEvents(src, file));
const inventariados = [...new Set(events.map((event) => event.file))];
check(
  events.length > 0,
  `se inventariaron ${events.length} publicaciones realtime en ${inventariados.length} archivo(s)`,
  inventariados.join(", "),
);

// Un piso explícito. Sin él, la próxima extracción que mueva publicaciones a un
// lugar no cubierto vuelve a bajar la cobertura en silencio: `events.length > 0`
// pasa igual con una publicación que con cuarenta y tres. Bajar este número es
// una decisión que hay que escribir, igual que el ratchet de longitud de línea.
const PISO_PUBLICACIONES = 43;
check(
  events.length >= PISO_PUBLICACIONES,
  `el inventario no perdió publicaciones (${events.length} ≥ ${PISO_PUBLICACIONES})`,
  "si una publicación se eliminó de verdad, bajá PISO_PUBLICACIONES en este archivo y decí por qué",
);

// --- 2. Ninguna publicación real puede quedar sin clasificar -----------------

const unclassified = events.filter((event) => classifyRealtimeAudience(event) === "unclassified");
check(
  unclassified.length === 0,
  "toda publicación realtime resuelve una audiencia explícita",
  unclassified
    .map((e) => `${e.file}:${e.line} entityType=${e.entityType ?? "(ninguno)"} type=${e.type}`)
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
