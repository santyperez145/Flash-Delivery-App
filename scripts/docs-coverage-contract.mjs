// Cada puerta está nombrada en la documentación (tickets CI-001 y ARC-001).
//
// Una puerta que nadie sabe que existe no se mantiene. Cuando falla, quien la
// encuentra no sabe qué protegía, si el defecto que la motivó sigue vigente, ni
// si conviene arreglar el código o borrar la puerta. En un repositorio con
// noventa suites, esa diferencia decide si CI es una red o un peaje.
//
// La regla es de proceso y por eso se verifica: **una puerta nueva se documenta
// en el mismo PR que la crea.** Es la misma forma que ya tiene la matriz RLS
// —una tabla nueva se clasifica en el PR que la crea— y por el mismo motivo:
// la documentación que depende de que alguien se acuerde, no ocurre.
//
// Es un trinquete y no un absoluto. Al escribirse había 14 suites sin mencionar
// en ningún lado, casi todas anteriores a la auditoría del 25 de agosto de 2026.
// Exigir cero de entrada habría dejado el número rojo sin que nadie pudiera
// avanzar; permitir que suba habría vuelto la puerta decorativa. El número sólo
// puede bajar, así que la deuda heredada se paga cuando se toca cada suite.
//
// Lo que se comprueba es que el nombre aparezca, no que la explicación sea
// buena. Eso no se puede verificar con un script, y pretenderlo daría una falsa
// sensación de cobertura.
import fs from "node:fs/promises";
import path from "node:path";

const LINEA_BASE = 14;
const PAQUETE = "package.json";
const FUENTES = ["docs", "AGENTS.md"];

async function recorrer(entrada) {
  const stat = await fs.stat(entrada).catch(() => null);
  if (!stat) return [];
  if (stat.isFile()) return entrada.endsWith(".md") ? [entrada] : [];
  const hijos = await fs.readdir(entrada);
  const anidados = await Promise.all(hijos.map((hijo) => recorrer(path.posix.join(entrada, hijo))));
  return anidados.flat();
}

const { scripts } = JSON.parse(await fs.readFile(PAQUETE, "utf8"));
const suites = Object.keys(scripts).filter((nombre) => nombre.startsWith("test:"));

const PISO = 50;
if (suites.length < PISO) {
  throw new Error(`Sólo se encontraron ${suites.length} suites y el piso es ${PISO}`);
}

const archivos = (await Promise.all(FUENTES.map(recorrer))).flat();
if (!archivos.length) throw new Error("No se encontró documentación que inspeccionar");

const documentacion = (
  await Promise.all(archivos.map((archivo) => fs.readFile(archivo, "utf8")))
).join("\n");

// Se exige el nombre completo del script. `test:rls` no cuenta como mención de
// `test:rls-matrix`, así que se compara contra el nombre seguido de un carácter
// que no pueda continuarlo.
const mencionada = (suite) => new RegExp(`${suite}(?![\\w:-])`).test(documentacion);

const huerfanas = suites.filter((suite) => !mencionada(suite));

if (huerfanas.length > LINEA_BASE) {
  console.error(
    `${huerfanas.length} suites sin mencionar en la documentación y la línea base es ${LINEA_BASE}:\n`,
  );
  for (const suite of huerfanas.sort()) console.error(`  - ${suite}`);
  console.error("\nUna puerta nueva se documenta en el mismo PR que la crea. Contá qué defecto");
  console.error(
    "motivó la puerta y qué pasa si falla, en el documento de `docs/` que corresponda.",
  );
  process.exit(1);
}

if (huerfanas.length < LINEA_BASE) {
  console.error(
    `${huerfanas.length} suites sin documentar, por debajo de la línea base ${LINEA_BASE}.`,
  );
  console.error("Bajá LINEA_BASE en este archivo para que el avance quede fijado.");
  process.exit(1);
}

console.log(`ok - ${suites.length} suites, ${huerfanas.length} sin documentar (línea base)`);
console.log(`     ${archivos.length} documentos inspeccionados`);
if (huerfanas.length) {
  console.log("\n     deuda heredada, sólo puede achicarse:");
  for (const suite of huerfanas.sort()) console.log(`       ${suite}`);
}
