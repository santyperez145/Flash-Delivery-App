// Ratchet de tamaño de archivo (ARC-001 / salida Fase 0).
//
// El criterio de salida pide que ningún archivo fuente supere 1.500 líneas.
// Mientras se parten monolitos, este ratchet impide que el problema crezca:
// cada archivo >1500 tiene un máximo tolerado y un PR sólo puede bajarlo.
//
//   node scripts/file-length-ratchet.mjs            verifica
//   node scripts/file-length-ratchet.mjs --update   baja la línea base
import fs from "node:fs/promises";
import path from "node:path";

const MAX_FILE_LINES = 1500;
const BASELINE_PATH = "scripts/file-length-baseline.json";
const ROOTS = ["src", "apps/mobile/src", "apps/mobile/App.tsx", "server", "scripts", "packages"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".css"]);

async function collect(entry) {
  const stat = await fs.stat(entry).catch(() => null);
  if (!stat) return [];
  if (stat.isFile()) return EXTENSIONS.has(path.extname(entry)) ? [entry] : [];
  const children = await fs.readdir(entry);
  const nested = await Promise.all(
    children
      .filter((child) => child !== "node_modules")
      .map((child) => collect(path.posix.join(entry, child))),
  );
  return nested.flat();
}

const files = (await Promise.all(ROOTS.map(collect))).flat().sort();
const current = {};
for (const file of files) {
  const content = await fs.readFile(file, "utf8");
  const lines = content.length === 0 ? 0 : content.replace(/\r$/, "").split("\n").length;
  if (lines > MAX_FILE_LINES) current[file] = lines;
}

const total = Object.values(current).reduce((sum, count) => sum + count, 0);

if (process.argv.includes("--update")) {
  await fs.writeFile(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
  console.log(
    `ok - línea base actualizada: ${Object.keys(current).length} archivos, ${total} líneas sobre ${MAX_FILE_LINES}`,
  );
  process.exit(0);
}

const baseline = JSON.parse(await fs.readFile(BASELINE_PATH, "utf8"));
const regressions = [];
const improvements = [];

for (const [file, count] of Object.entries(current)) {
  const allowed = baseline[file] ?? 0;
  if (count > allowed) {
    regressions.push(`${file}: ${count} líneas (tolerado ${allowed})`);
  } else if (count < allowed) {
    improvements.push(`${file}: ${allowed} → ${count}`);
  }
}
for (const [file, allowed] of Object.entries(baseline)) {
  if (!current[file] && allowed > 0) improvements.push(`${file}: ${allowed} → 0`);
}

const baselineTotal = Object.values(baseline).reduce((sum, count) => sum + count, 0);

if (regressions.length) {
  console.error("El ratchet de tamaño de archivo sólo puede bajar.\n");
  for (const regression of regressions) console.error(`  - ${regression}`);
  console.error(
    `\nTolerado: ${baselineTotal} líneas acumuladas sobre ${MAX_FILE_LINES} en ${Object.keys(baseline).length} archivos.`,
  );
  process.exit(1);
}

if (improvements.length) {
  console.log("Mejoras pendientes de fijar con --update:");
  for (const improvement of improvements) console.log(`  - ${improvement}`);
}

console.log(
  `ok - ${total} líneas sobre ${MAX_FILE_LINES} en ${Object.keys(current).length} archivos (tolerado ${baselineTotal})`,
);
