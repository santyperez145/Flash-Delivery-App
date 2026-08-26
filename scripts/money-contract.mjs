// El dinero se convierte en un solo lugar (ticket ARC-001).
//
// `pesos` estaba definida tres veces con el mismo cuerpo. Esta puerta impide la
// cuarta, y además pone número a lo que la unificación dejó a la vista: 26
// conversiones en línea repartidas por los repositorios, que no comparten la
// guarda contra columna ausente.
import fs from "node:fs/promises";
import path from "node:path";
import { pesos } from "../server/money.js";

const LINEA_BASE = 26;
const EN_LINEA = /Number\([^()]*(?:\([^()]*\))?[^()]*\)\s*\/\s*100\b/g;
const DEFINICION = /(?:const|let|var|function)\s+pesos\b/;

const problemas = [];
const check = (condicion, etiqueta) => {
  if (condicion) console.log(`ok - ${etiqueta}`);
  else problemas.push(etiqueta);
};

check(pesos(12345) === 123.45, "los centavos enteros se convierten a pesos");
check(pesos(0) === 0, "cero centavos son cero pesos");
check(pesos(null) === 0 && pesos(undefined) === 0, "una columna ausente se lee como cero");
check(pesos(1) === 0.01, "un centavo suelto no se pierde");

async function recorrer(entrada) {
  const stat = await fs.stat(entrada).catch(() => null);
  if (!stat) return [];
  if (stat.isFile()) return entrada.endsWith(".js") ? [entrada] : [];
  const hijos = await fs.readdir(entrada);
  const anidados = await Promise.all(
    hijos
      .filter((hijo) => hijo !== "node_modules" && hijo !== "data")
      .map((hijo) => recorrer(path.posix.join(entrada, hijo))),
  );
  return anidados.flat();
}

const archivos = (await recorrer("server")).filter((archivo) => archivo !== "server/money.js");
if (archivos.length < 50) throw new Error(`Sólo se inspeccionaron ${archivos.length} módulos`);

const copias = [];
let enLinea = 0;
const porArchivo = [];
for (const archivo of archivos) {
  const fuente = await fs.readFile(archivo, "utf8");
  if (DEFINICION.test(fuente)) copias.push(archivo);
  const encontradas = fuente.match(EN_LINEA)?.length ?? 0;
  if (encontradas) {
    enLinea += encontradas;
    porArchivo.push(`${encontradas} ${archivo}`);
  }
}

check(copias.length === 0, `nadie redefine \`pesos\` (${copias.join(", ") || "ninguna copia"})`);

// Trinquete: el número puede bajar y no subir. Una conversión nueva escrita a
// mano es exactamente lo que produjo las tres copias que este módulo unificó.
//
// Se acumula en `problemas` en vez de cortar acá: si además falla otra
// comprobación, quien lea la salida tiene que ver las dos.
if (enLinea > LINEA_BASE) {
  problemas.push(`conversiones en línea: ${enLinea}, y la línea base es ${LINEA_BASE}`);
  for (const detalle of porArchivo) problemas.push(`  en ${detalle}`);
} else if (enLinea < LINEA_BASE) {
  problemas.push(
    `conversiones en línea: ${enLinea}, por debajo de ${LINEA_BASE}: bajá LINEA_BASE para fijarlo`,
  );
} else {
  console.log(`ok - ${enLinea} conversiones en línea, igual a la línea base`);
}

if (problemas.length) {
  console.error(`\n${problemas.length} comprobación(es) fallaron:\n`);
  for (const problema of problemas) console.error(`  - ${problema}`);
  console.error("\nUsá `pesos` de `server/money.js` en lugar de dividir por 100 a mano.");
  process.exit(1);
}
console.log(`\nok - ${archivos.length} módulos del servidor con una sola conversión de dinero`);
