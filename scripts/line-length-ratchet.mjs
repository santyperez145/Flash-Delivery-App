// Ratchet de longitud de línea (ARC-001, hallazgo H-08).
//
// El código fuente tiene hoy líneas de hasta 4.061 caracteres: funciones enteras
// escritas en una sola línea. Eso hace ilegible cualquier diff, irresoluble un
// conflicto de merge e impracticable una revisión de seguridad.
//
// No se puede exigir el objetivo final (ninguna línea > 200) sin reformatear todo
// primero. Mientras tanto, este ratchet impide que el problema crezca: cada
// archivo tiene un máximo tolerado y un PR sólo puede bajarlo, nunca subirlo.
//
//   node scripts/line-length-ratchet.mjs            verifica
//   node scripts/line-length-ratchet.mjs --update   baja la línea base tras mejorar
import fs from "node:fs/promises";
import path from "node:path";

const MAX_LINE_LENGTH = 200;
const BASELINE_PATH = "scripts/line-length-baseline.json";
const ROOTS = ["src", "apps/mobile/src", "apps/mobile/App.tsx", "server", "scripts"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs"]);

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
  const offenders = content.split("\n").filter((line) => line.length > MAX_LINE_LENGTH).length;
  if (offenders > 0) current[file] = offenders;
}

const total = Object.values(current).reduce((sum, count) => sum + count, 0);

if (process.argv.includes("--update")) {
  await fs.writeFile(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`ok - línea base actualizada: ${Object.keys(current).length} archivos, ${total} líneas largas`);
  process.exit(0);
}

const baseline = JSON.parse(await fs.readFile(BASELINE_PATH, "utf8"));
const regressions = [];
const improvements = [];

for (const [file, count] of Object.entries(current)) {
  const allowed = baseline[file] ?? 0;
  if (count > allowed) {
    regressions.push(
      `${file}: ${count} líneas > ${MAX_LINE_LENGTH} caracteres (tolerado ${allowed})`,
    );
  } else if (count < allowed) {
    improvements.push(`${file}: ${allowed} → ${count}`);
  }
}
for (const [file, allowed] of Object.entries(baseline)) {
  if (!current[file] && allowed > 0) improvements.push(`${file}: ${allowed} → 0`);
}

const baselineTotal = Object.values(baseline).reduce((sum, count) => sum + count, 0);

if (regressions.length) {
  console.error("El ratchet de longitud de línea sólo puede bajar.\n");
  for (const regression of regressions) console.error(`  - ${regression}`);
  console.error(
    "\nDividí la línea larga en lugar de ampliar la línea base. Si el archivo mejoró en conjunto,",
  );
  console.error("regenerá con: node scripts/line-length-ratchet.mjs --update");
  process.exit(1);
}

if (improvements.length) {
  console.log(`${improvements.length} archivo(s) mejoraron:`);
  for (const improvement of improvements.slice(0, 20)) console.log(`  - ${improvement}`);
  console.log("\nCorré `node scripts/line-length-ratchet.mjs --update` para fijar la mejora.");
}

console.log(
  `ok - ${total} líneas de más de ${MAX_LINE_LENGTH} caracteres en ${Object.keys(current).length} archivos (tolerado ${baselineTotal})`,
);
