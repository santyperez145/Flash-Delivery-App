// Lo declarado como dependencia de producción es lo que el servidor usa
// (ticket INF-001).
//
// La imagen productiva instala con `npm ci --omit=dev`, así que todo lo que
// esté en `dependencies` se despliega, lo importe el servidor o no. Siete
// paquetes que sólo usa el frente —React, React DOM, `lucide-react`,
// `maplibre-gl`, el SDK de Mercado Pago, `qrcode` y `concurrently`— vivían ahí
// y viajaban en cada despliegue.
//
// Eso no es sólo tamaño. Cada paquete en la imagen es superficie: un
// `postinstall`, una dependencia transitiva, algo que un escáner tiene que
// mirar y alguien tiene que actualizar. Un paquete que el proceso nunca importa
// es riesgo sin contrapartida.
//
// **La puerta de auditoría se amplió antes de mover nada.** Con la versión
// anterior —`npm audit --omit=dev`— pasarlos a desarrollo los habría sacado de
// la auditoría: se habría cambiado tamaño por cobertura, que no es una mejora.
// Ahora `test:dependency-gate` audita los cuatro alcances.
//
// El criterio que se verifica acá es directo: **cada paquete de `dependencies`
// tiene que aparecer importado en `server/` o en `scripts/`.** Al escribirse,
// las veinte lo cumplen.
//
// La detección busca formas de importación reales —`from "x"`, `require("x")`,
// `import("x")`— sobre la fuente con los comentarios ya quitados. Las dos cosas
// hicieron falta y las dos se descubrieron probando que la puerta fallara: sin
// la primera bastaba con que el nombre apareciera en cualquier cadena, y sin la
// segunda alcanzaba con que un comentario lo mencionara.
import fs from "node:fs/promises";
import path from "node:path";

const RAICES = ["server", "scripts"];

// Paquetes que el servidor usa sin nombrarlos en un `import`. Cada entrada
// necesita decir quién los invoca: si no se puede escribir, no van acá.
const INDIRECTOS = new Map();

async function recorrer(entrada) {
  const stat = await fs.stat(entrada).catch(() => null);
  if (!stat) return [];
  if (stat.isFile()) return /\.(js|mjs)$/.test(entrada) ? [entrada] : [];
  const hijos = await fs.readdir(entrada);
  const anidados = await Promise.all(
    hijos
      .filter((hijo) => hijo !== "node_modules" && hijo !== "data")
      .map((hijo) => recorrer(path.posix.join(entrada, hijo))),
  );
  return anidados.flat();
}

const archivos = (await Promise.all(RAICES.map(recorrer))).flat();
const PISO = 60;
if (archivos.length < PISO) {
  throw new Error(`Sólo se inspeccionaron ${archivos.length} archivos y el piso es ${PISO}`);
}

/**
 * Quita los comentarios antes de buscar importaciones.
 *
 * Sin esto la puerta no puede fallar para un paquete que algún comentario
 * nombre, y eso no es hipotético: `domain-purity-contract.mjs` explica su regla
 * escribiendo `from "react"` en prosa, así que React aparecía importado por el
 * servidor. Una puerta que no puede fallar no protege nada.
 *
 * Se descartan las líneas que **empiezan** con `//` y los bloques `/* *​/`. No
 * puede comerse una importación real: una que esté dentro de un comentario es
 * código desactivado, y darla por ausente es lo correcto.
 */
const sinComentarios = (texto) =>
  texto
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((linea) => !linea.trimStart().startsWith("//"))
    .join("\n");

const fuente = (await Promise.all(archivos.map((a) => fs.readFile(a, "utf8"))))
  .map(sinComentarios)
  .join("\n");
const { dependencies } = JSON.parse(await fs.readFile("package.json", "utf8"));
const paquetes = Object.keys(dependencies ?? {});

if (!paquetes.length) throw new Error("No se encontraron dependencias de producción");

// Se buscan formas de importación reales y no el nombre suelto. La primera
// versión buscaba la cadena `"paquete"` en cualquier parte y no detectaba nada:
// los propios contratos de este directorio mencionan nombres de paquetes como
// dato —`domain-purity-contract.mjs` contiene la palabra `react` en su regla—,
// así que todo aparecía usado. Una puerta que no puede fallar no sirve.
const ESPECIALES = /[.*+?^${}()|[\]\\]/g;
const escapar = (texto) => texto.replace(ESPECIALES, String.raw`\$&`);
const usado = (paquete) => {
  if (INDIRECTOS.has(paquete)) return true;
  const p = escapar(paquete);
  const comilla = String.raw`["'\`]`;
  const subruta = String.raw`(/[^"'\`]*)?`;
  const formas = new RegExp(
    `from ${comilla}${p}${subruta}${comilla}` +
      `|(require|import)\\(\\s*${comilla}${p}${subruta}${comilla}`,
  );
  return formas.test(fuente);
};

const huerfanos = paquetes.filter((paquete) => !usado(paquete));

// Una entrada de INDIRECTOS que ya no haga falta esconde un paquete de más.
const coartadasVencidas = [...INDIRECTOS.keys()].filter((paquete) => !paquetes.includes(paquete));

if (huerfanos.length || coartadasVencidas.length) {
  if (huerfanos.length) {
    console.error(`${huerfanos.length} dependencia(s) de producción que el servidor no importa:\n`);
    for (const paquete of huerfanos) console.error(`  - ${paquete}`);
    console.error("\nSi sólo lo usa el frente, va en `devDependencies`: la imagen instala con");
    console.error("`--omit=dev` y todo lo que quede acá se despliega.");
  }
  for (const paquete of coartadasVencidas) {
    console.error(`\nINDIRECTOS tiene una entrada obsoleta: ${paquete}`);
  }
  process.exit(1);
}

console.log(`ok - las ${paquetes.length} dependencias de producción las usa el servidor`);
console.log(`     ${archivos.length} archivos de ${RAICES.join(" y ")} inspeccionados`);
