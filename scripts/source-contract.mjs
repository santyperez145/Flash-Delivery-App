// Contratos sobre código fuente, independientes del formato (ticket ARC-001).
//
// Varias suites afirman que cierta lógica existe en el código leyendo el archivo
// y buscando substrings literales. La intención es buena: impide que una
// pantalla vuelva a inicializarse con datos ficticios, o que un checkout
// confirme una cotización distinta de la que mostró.
//
// El problema es cómo estaba implementado. `app.includes("entry.lat!==null")`
// falla en cuanto un formateador escribe `entry.lat !== null`, así que el
// contrato quedaba acoplado al espaciado del archivo. Eso convierte a estas
// suites en un obstáculo para cualquier refactor —incluido el reformateo que
// ARC-001 necesita como primer paso— en lugar de una protección.
//
// `contains` compara ignorando todo el espaciado, de los dos lados. El contrato
// sigue afirmando lo mismo; deja de afirmar cómo está escrito.
//
// El paso 8 agrega la otra mitad: **dejar de afirmar dónde está escrito.** Nueve
// suites leían `src/App.tsx` o `apps/mobile/App.tsx` por ruta fija, y la mitad
// del trabajo que queda de ARC-001 es justamente partir esos dos archivos. Un
// contrato acoplado a la ubicación se rompe —o peor, se vacía— en cuanto el
// código se mueve. `readAudienceSource` lee el árbol de una audiencia entera, así
// que un componente que cambia de archivo sigue estando bajo contrato.
import fs from "node:fs/promises";
import path from "node:path";

/** Quita todo el espaciado para comparar sólo la forma del código. */
export const squeeze = (source) => String(source).replace(/\s+/g, "");

/** ¿La fuente contiene este fragmento, sin importar el espaciado? */
export const contains = (source, needle) => squeeze(source).includes(squeeze(needle));

/** ¿Contiene todos estos fragmentos? */
export const containsAll = (source, needles) => needles.every((needle) => contains(source, needle));

/**
 * Piso de plausibilidad para una región de código.
 *
 * Una sección de un componente real son miles de caracteres. Sesenta es lo que
 * queda cuando el cuerpo se mudó a otro archivo y sólo sobrevive la firma.
 */
const MIN_REGION_CHARS = 200;

/**
 * ¿No contiene ninguno? Útil para prohibir datos ficticios o rutas semilla.
 *
 * **Lanza si la fuente es demasiado chica para afirmar algo.** Una aserción de
 * ausencia sobre una región vacía o colapsada no afirma nada: pasa siempre, y
 * pasa en silencio.
 *
 * Eso no es teórico. `web-checkout-ui-smoke` recorta el checkout entre
 * `function CartScreen(` y `type ProviderPaymentInput` y verifica que no haya
 * una dirección hardcodeada. Cuando ARC-001 mueva ese componente a su propio
 * archivo, la sección colapsa a la firma —60 caracteres— y la guarda
 * `if (!checkout) throw` no la atrapa, porque 60 caracteres son un valor
 * verdadero. El contrato quedaría en verde afirmando sobre nada, justo cuando la
 * dirección prohibida podría haberse ido con el componente.
 */
export const containsNone = (source, needles, { minChars = MIN_REGION_CHARS } = {}) => {
  const squeezed = squeeze(source);
  if (squeezed.length < minChars) {
    throw new Error(
      `containsNone recibió ${squeezed.length} caracteres, menos que el piso de ${minChars}: ` +
        "una aserción de ausencia sobre una región colapsada pasa siempre y no protege nada. " +
        "Si la región se movió, actualizá los marcadores; si de verdad achicó, bajá minChars a propósito.",
    );
  }
  return needles.every((needle) => !contains(squeezed, needle));
};

/**
 * Recorta la sección entre dos marcadores, tolerando el espaciado.
 *
 * Devuelve el fragmento ya comprimido: sólo sirve para usarlo con `contains`,
 * nunca para mostrarlo ni para contar líneas.
 *
 * **Lanza en lugar de devolver una región vacía o colapsada.** Devolvía `""`
 * cuando no encontraba el marcador de inicio, lo que obligaba a cada sitio de
 * llamada a acordarse de escribir su propia guarda: de cuatro que hay en el
 * repositorio, sólo uno la tenía. Y la guarda tampoco alcanzaba, porque el caso
 * peligroso no es la región vacía sino la que **encogió**.
 *
 * Un marcador que ya no aparece es un contrato desactualizado, no un resultado
 * vacío. Decirlo fuerte es la diferencia entre un refactor que se frena y uno
 * que avanza con la protección apagada.
 */
export function section(source, from, to, { minChars = MIN_REGION_CHARS } = {}) {
  const squeezed = squeeze(source);
  const start = squeezed.indexOf(squeeze(from));
  if (start === -1) {
    throw new Error(
      `section no encontró el marcador de inicio ${JSON.stringify(from)}. ` +
        "El código se movió o se renombró: actualizá el marcador del contrato.",
    );
  }
  const end = to ? squeezed.indexOf(squeeze(to), start) : -1;
  const region = end === -1 ? squeezed.slice(start) : squeezed.slice(start, end);
  if (region.length < minChars) {
    throw new Error(
      `section devolvió ${region.length} caracteres entre ${JSON.stringify(from)} y ` +
        `${JSON.stringify(to)}, menos que el piso de ${minChars}. La región colapsó: ` +
        "probablemente el código de en medio se mudó a otro archivo. " +
        "Actualizá los marcadores, o pasá minChars a propósito si la región achicó de verdad.",
    );
  }
  return region;
}

// --- Lectura por audiencia, no por archivo ------------------------------------

const EXTENSIONES = new Set([".ts", ".tsx"]);

async function archivosDe(raiz) {
  const stat = await fs.stat(raiz).catch(() => null);
  if (!stat) return [];
  if (stat.isFile()) return [raiz];
  const entradas = await fs.readdir(raiz, { withFileTypes: true });
  const encontrados = [];
  for (const entrada of entradas) {
    const completo = path.posix.join(raiz, entrada.name);
    if (entrada.isDirectory()) encontrados.push(...(await archivosDe(completo)));
    else if (EXTENSIONES.has(path.extname(entrada.name))) encontrados.push(completo);
  }
  return encontrados;
}

/**
 * Todo el código de una audiencia, concatenado y en orden estable.
 *
 * Las raíces se recorren enteras, así que un componente que ARC-001 mueva de
 * `App.tsx` a su propio archivo sigue estando bajo el mismo contrato. El orden
 * es alfabético para que `section` recorte siempre la misma región entre dos
 * corridas.
 *
 * Devuelve también `files`, que es lo que permite fijar un piso de cobertura:
 * sin él, una suite que dejara de encontrar archivos pasaría igual.
 */
export async function readAudienceSource(roots, { exclude = [] } = {}) {
  const todos = (await Promise.all(roots.map(archivosDe))).flat().sort();
  const archivos = todos.filter(
    (archivo) => !exclude.some((prefijo) => archivo.startsWith(prefijo)),
  );
  const partes = await Promise.all(
    archivos.map(async (archivo) => `// ${archivo}\n${await fs.readFile(archivo, "utf8")}`),
  );
  return { source: partes.join("\n"), files: archivos };
}

/** Superficie web: todo `src/`, sea un archivo o cien. */
export const readWebSource = () => readAudienceSource(["src"]);

/** Hojas de estilo web en el mismo orden que `src/main.tsx`. */
const WEB_STYLE_FILES = [
  "src/styles.css",
  "src/styles/customer-food.css",
  "src/styles/ride-mobility.css",
  "src/styles/commerce-ops.css",
  "src/styles/phone-stage.css",
  "src/styles/admin-ops.css",
  "src/styles/merchant-desktop.css",
  "src/styles/foundation.css",
  "src/styles/auth.css",
  "src/styles/states.css",
  "src/adaptive.css",
];

export async function readWebStyles() {
  const partes = await Promise.all(WEB_STYLE_FILES.map((archivo) => fs.readFile(archivo, "utf8")));
  return { source: partes.join("\n"), files: WEB_STYLE_FILES };
}

/** Superficie móvil: el entrypoint más su árbol. */
export const readMobileSource = () =>
  readAudienceSource(["apps/mobile/App.tsx", "apps/mobile/src"]);
