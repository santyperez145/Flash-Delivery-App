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
  ["test:performance", "mide latencia: sensible al ruido del runner, va a ci-nightly"],
  ["test:responsive-browser", "necesita el dev server de Vite y un navegador, va a ci-nightly"],
]);

const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
const suites = Object.keys(pkg.scripts).filter((name) => name.startsWith("test:"));

const files = await fs.readdir(WORKFLOWS_DIR);
const workflows = await Promise.all(
  files.map((file) => fs.readFile(`${WORKFLOWS_DIR}/${file}`, "utf8")),
);
const combined = workflows.join("\n");

// Una suite cuenta como cubierta si aparece invocada directamente o listada en
// un bucle de suites, donde figura como una línea con sólo su nombre.
const referenced = (suite) =>
  combined.includes(`npm run ${suite}`) ||
  new RegExp(`^\\s*${suite.replace(":", "\\:")}\\s*$`, "m").test(combined);

const uncovered = [];
const staleExclusions = [];

for (const suite of suites) {
  if (EXCLUDED.has(suite)) {
    if (referenced(suite)) staleExclusions.push(suite);
    continue;
  }
  if (!referenced(suite)) uncovered.push(suite);
}

for (const suite of EXCLUDED.keys()) {
  if (!suites.includes(suite)) staleExclusions.push(`${suite} (ya no existe)`);
}

if (uncovered.length) {
  console.error(`${uncovered.length} suite(s) sin puerta CI:\n`);
  for (const suite of uncovered) console.error(`  - ${suite}`);
  console.error(
    "\nConectala a un workflow, o agregala a EXCLUDED en este archivo con su motivo.",
  );
  process.exit(1);
}

if (staleExclusions.length) {
  console.error("Excepciones obsoletas: la suite ya está cubierta o no existe.\n");
  for (const suite of staleExclusions) console.error(`  - ${suite}`);
  console.error("\nQuitala de EXCLUDED.");
  process.exit(1);
}

const covered = suites.length - EXCLUDED.size;
console.log(`ok - ${covered} de ${suites.length} suites en una puerta CI`);
for (const [suite, reason] of EXCLUDED) console.log(`     excepción: ${suite} — ${reason}`);
