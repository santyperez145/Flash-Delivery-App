// Pureza de los módulos de dominio (ticket ARC-001).
//
// El criterio es que la lógica no dependa del framework que la muestra. Un
// módulo de dominio que importa React deja de poder usarse desde un worker, un
// script o una prueba sin arrastrar medio árbol de renderizado, y empuja a que
// la regla de negocio termine viviendo dentro de un componente.
//
// La regla que se verifica es la convención del repositorio: **`.ts` es lógica,
// `.tsx` es presentación**. Un `.ts` que importa `react` está del lado
// equivocado de esa línea.
//
// `react-native` no cuenta como violación. Ahí no aporta hooks ni JSX sino
// primitivas de plataforma —`Platform`, `StyleSheet`— que un módulo de lógica
// móvil necesita legítimamente para decidir por sistema operativo.
//
// Al 26 de agosto de 2026 el criterio ya se cumplía. Esta puerta existe para que
// siga cumpliéndose: la extracción mueve código a archivos nuevos, y es
// exactamente ahí donde un import se cuela sin que nadie lo note.
import fs from "node:fs/promises";
import path from "node:path";

const ROOTS = ["server", "src", "apps/mobile/src"];
const IGNORED_DIRS = new Set(["node_modules", "data"]);

// Sólo React: un `.ts` que importe hooks o JSX está del lado equivocado.
const REACT_IMPORT = /(?:^|\n)\s*import[^;]*?from\s+["']react["']/;

// El servidor es `.js` y el frente es `.ts`: los dos son dominio.
const isDomainModule = (entry) =>
  (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) || entry.endsWith(".js");

async function collect(entry) {
  const stat = await fs.stat(entry).catch(() => null);
  if (!stat) return [];
  if (stat.isFile()) return isDomainModule(entry) ? [entry] : [];
  const children = await fs.readdir(entry);
  const nested = await Promise.all(
    children
      .filter((child) => !IGNORED_DIRS.has(child))
      .map((child) => collect(path.posix.join(entry, child))),
  );
  return nested.flat();
}

const files = (await Promise.all(ROOTS.map(collect))).flat();

// Un piso explícito: si el recorrido deja de encontrar archivos, la puerta
// pasaría en verde sin haber mirado nada.
const FLOOR = 60;
if (files.length < FLOOR) {
  throw new Error(
    `Sólo se inspeccionaron ${files.length} módulos y el piso es ${FLOOR}: el recorrido está roto`,
  );
}

const offenders = [];
for (const file of files) {
  const content = await fs.readFile(file, "utf8").catch(() => "");
  if (REACT_IMPORT.test(content)) offenders.push(file);
}

if (offenders.length) {
  console.error(`${offenders.length} módulo(s) de dominio importan React:\n`);
  for (const file of offenders) console.error(`  - ${file}`);
  console.error("\nUn `.ts` es lógica y un `.tsx` es presentación. Si el módulo necesita React,");
  console.error("es un componente y va en un `.tsx`; si no, sacá el import.");
  process.exit(1);
}

console.log(`ok - ${files.length} módulos de dominio sin dependencia de React`);
console.log("     `react-native` está permitido: aporta primitivas de plataforma, no renderizado");
