// Cobertura de puertas CI (ticket CI-001).
//
// Verifica que cada script `test:*` declarado en package.json esté referenciado
// por algún workflow, o exceptuado explícitamente acá con su motivo.
//
// Existe porque el hallazgo H-01 fue precisamente ese: 104 scripts declarados y
// 15 ejecutados, sin que nada lo hiciera evidente. Una suite que se escribe y no
// se conecta a una puerta no protege nada, y el olvido es silencioso.
import fs from "node:fs/promises";

const WORKFLOWS_DIR = ".github/workflows";

// Excepciones deliberadas. Cada entrada necesita un motivo: si no se puede
// escribir uno, la suite va a una puerta.
const EXCLUDED = new Map([
  ["test:security", "corre dentro de `npm run check`, que sí está en ci-fast"],
]);

// Nocturnas: tienen puerta —`ci-nightly.yml`— pero no bloquean un merge, y por
// eso no pueden contarse junto a las que sí.
//
// La distinción importa porque el número que este script publica se usa para
// decir cuánto protege CI. Meter una suite nocturna en ese total diría que un
// PR queda bloqueado por algo que en realidad corre ocho horas después.
//
// Las dos están acá por motivos distintos y los dos son legítimos: una mide
// latencia en un runner compartido, la otra necesita tres servidores y un
// bundle de Expo por variante.
const NIGHTLY = new Map([
  ["test:performance", "mide latencia: sensible al ruido del runner"],
  ["test:responsive-browser", "navegador real, tres servidores y un bundle por variante"],
]);

// Cuarentena: suites conectadas a una puerta pero declaradas no bloqueantes.
// No son una excepción — siguen corriendo y su resultado se publica — pero la
// deuda tiene que decirse en voz alta en cada corrida, no quedar escondida en
// un `continue-on-error` del YAML.
// Vacía desde el 27-08. Se deja el mecanismo porque la cuarentena es la forma
// honesta de tener una suite rota —corre, se publica y se nombra— frente a la
// alternativa de borrarla del pipeline.
//
// Con una advertencia ganada a pulso: **una causa anotada con cautela se lee
// después como un hecho**. Ninguna de las cuatro causas que pasaron por acá
// sobrevivió al contacto con la evidencia, y la última mandó a buscar durante un
// mes un defecto de concurrencia que no existía —a la suite le faltaba una
// cabecera—. Lo que se escriba acá debería decir qué se midió, no qué se supone.
const QUARANTINED = new Map();

const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
const suites = Object.keys(pkg.scripts).filter((name) => name.startsWith("test:"));

const files = await fs.readdir(WORKFLOWS_DIR);
const workflows = await Promise.all(
  files.map((file) => fs.readFile(`${WORKFLOWS_DIR}/${file}`, "utf8")),
);
const combined = workflows.join("\n");

// Una suite cuenta como cubierta si aparece invocada directamente o listada en
// un bucle de suites, sea una por línea o varias en la misma línea.
const referenced = (suite) => {
  if (combined.includes(`npm run ${suite}`)) return true;
  const escaped = suite.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // El nombre debe aparecer como token completo. Un `test:driver` no puede
  // dar por cubierto a `test:driver-kyc`, y el token puede terminar en `;`
  // cuando se lista dentro de un `for ... do`.
  return new RegExp(`(^|[\\s"'])${escaped}(?![\\w:-])`, "m").test(combined);
};

const uncovered = [];
const staleExclusions = [];

for (const suite of suites) {
  if (EXCLUDED.has(suite)) {
    if (referenced(suite)) staleExclusions.push(suite);
    continue;
  }
  // Una nocturna sí tiene que estar referenciada: si no, no corre en ningún
  // lado y la etiqueta la estaría encubriendo.
  if (!referenced(suite)) uncovered.push(suite);
}

const nightlyHuerfanas = [...NIGHTLY.keys()].filter(
  (suite) => !suites.includes(suite) || !referenced(suite),
);

for (const suite of EXCLUDED.keys()) {
  if (!suites.includes(suite)) staleExclusions.push(`${suite} (ya no existe)`);
}

if (uncovered.length) {
  console.error(`${uncovered.length} suite(s) sin puerta CI:\n`);
  for (const suite of uncovered) console.error(`  - ${suite}`);
  console.error("\nConectala a un workflow, o agregala a EXCLUDED en este archivo con su motivo.");
  process.exit(1);
}

if (staleExclusions.length) {
  console.error("Excepciones obsoletas: la suite ya está cubierta o no existe.\n");
  for (const suite of staleExclusions) console.error(`  - ${suite}`);
  console.error("\nQuitala de EXCLUDED.");
  process.exit(1);
}

if (nightlyHuerfanas.length) {
  console.error(`Suites nocturnas sin workflow que las corra: ${nightlyHuerfanas.join(", ")}`);
  console.error("Conectalas a `ci-nightly.yml` o sacalas de NIGHTLY.");
  process.exit(1);
}

const staleQuarantine = [...QUARANTINED.keys()].filter((suite) => !suites.includes(suite));
if (staleQuarantine.length) {
  console.error(`Cuarentena obsoleta, la suite ya no existe: ${staleQuarantine.join(", ")}`);
  process.exit(1);
}

const covered = suites.length - EXCLUDED.size;
const blocking = covered - QUARANTINED.size - NIGHTLY.size;
console.log(`ok - ${covered} de ${suites.length} suites en una puerta CI`);
console.log(
  `     ${blocking} bloquean el merge, ${NIGHTLY.size} nocturnas, ${QUARANTINED.size} en cuarentena`,
);
for (const [suite, reason] of EXCLUDED) console.log(`     excepción:  ${suite} — ${reason}`);
for (const [suite, reason] of NIGHTLY) console.log(`     nocturna:   ${suite} — ${reason}`);
for (const [suite, reason] of QUARANTINED) console.log(`     cuarentena: ${suite} — ${reason}`);
