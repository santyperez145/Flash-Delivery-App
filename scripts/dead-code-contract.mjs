// Declaraciones internas que nadie usa (ticket ARC-001).
//
// Existe por un error que la extracción de rutas hace fácil y ninguna otra
// puerta ve: **copiar en lugar de mover**. Al llevar un grupo de rutas a su
// router se copia el ayudante que necesitaba y se olvida borrar el original. El
// resultado son dos definiciones idénticas, una muerta, y todo sigue en verde
// porque nada está roto.
//
// `test:module-references` no lo detecta: busca nombres **sin ligar**, es decir
// lo contrario —un uso sin definición—. Este contrato mira el otro lado, una
// definición sin uso.
//
// Encontró dos al escribirse: `publicRestaurantFallback` en `server/index.js`,
// dejada atrás al extraer el router de catálogo, y `GOOGLE_PLACES` en
// `maps-provider.js`, que sobró de GEO-001 porque el adaptador terminó usando
// sólo Routes y Geocode.
//
// **Se cuentan apariciones del identificador en todo el archivo, no referencias
// reales.** Es una sobreaproximación deliberada hacia «está usado»: un nombre
// mencionado en un comentario cuenta como usado. Puede dejar pasar código
// muerto, pero no puede acusar a código vivo, que es la única forma de que una
// puerta así no termine desactivada.
//
// Sólo mira declaraciones **no exportadas**. Una exportada tiene su uso en otro
// archivo por definición, y decidir si ese uso existe es otro problema.
//
// El tokenizador evita barras invertidas a propósito. La primera versión usaba
// una frontera de palabra dentro de un template literal y quedó escrita como el
// carácter de retroceso en lugar de la frontera: el contraste daba cero
// apariciones para todo, así que el contrato acusaba de muertas a 350
// declaraciones vivas. Un patrón sin escapes no se puede romper de esa forma.
import fs from "node:fs/promises";
import path from "node:path";

const RAIZ = "server";
const PISO = 50;
const IDENTIFICADOR = /[A-Za-z_$][A-Za-z0-9_$]*/g;
const DECLARACION_FUNCION = /^(?:async )?function ([A-Za-z_$][A-Za-z0-9_$]*)/;
const DECLARACION_CONST = /^const ([A-Za-z_$][A-Za-z0-9_$]*) *=/;

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

const archivos = await recorrer(RAIZ);
if (archivos.length < PISO) {
  throw new Error(`Sólo se inspeccionaron ${archivos.length} módulos y el piso es ${PISO}`);
}

const muertas = [];
let revisadas = 0;
for (const archivo of archivos) {
  const fuente = await fs.readFile(archivo, "utf8");

  // Una sola pasada por archivo: cuántas veces aparece cada identificador.
  const frecuencia = new Map();
  for (const token of fuente.match(IDENTIFICADOR) ?? []) {
    frecuencia.set(token, (frecuencia.get(token) ?? 0) + 1);
  }

  for (const [indice, cruda] of fuente.split("\n").entries()) {
    // Los archivos son CRLF: sin quitar el retorno, ningún patrón anclado calza.
    const linea = cruda.replace(/\r$/, "");
    // Sólo nivel superior: una línea que empieza con espacio está anidada.
    if (linea.startsWith(" ") || linea.startsWith("export")) continue;
    const declaracion = DECLARACION_FUNCION.exec(linea) || DECLARACION_CONST.exec(linea);
    if (!declaracion) continue;
    revisadas += 1;
    const nombre = declaracion[1];
    if ((frecuencia.get(nombre) ?? 0) <= 1) {
      muertas.push(`${archivo}:${indice + 1} — \`${nombre}\``);
    }
  }
}

// Un piso sobre lo inspeccionado: si el reconocimiento de declaraciones se
// rompe, la puerta pasaría en verde sin haber mirado ninguna.
const PISO_DECLARACIONES = 200;
if (revisadas < PISO_DECLARACIONES) {
  throw new Error(
    `Sólo se reconocieron ${revisadas} declaraciones y el piso es ${PISO_DECLARACIONES}`,
  );
}

if (muertas.length) {
  console.error(`${muertas.length} declaración(es) internas sin ningún uso:\n`);
  for (const muerta of muertas) console.error(`  - ${muerta}`);
  console.error(
    "\nSi se movió a otro módulo, borrá el original: quedaron dos copias y una muerta.",
  );
  console.error("Si todavía no se usa, borrala igual y volvé a agregarla cuando haga falta.");
  process.exit(1);
}

console.log(
  `ok - ${revisadas} declaraciones internas en ${archivos.length} módulos, ninguna sin uso`,
);
