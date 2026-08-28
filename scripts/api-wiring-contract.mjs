// Nada queda construido sin cablear (ARC-001).
//
// El servidor expone 191 rutas. El frente web y el móvil llaman a la mayoría,
// pero nadie cruzaba las dos listas, así que una ruta podía quedar viva y sin
// consumidor —trabajo hecho que nadie usa— sin que ninguna puerta lo dijera.
//
// Es la forma más cara de deuda porque no se ve: la ruta funciona, sus pruebas
// pasan, y sin embargo el producto no la ofrece. Lo mismo al revés sería peor,
// pero eso ya no pasa: **ningún literal del frente apunta a una ruta que no
// exista**, y esta puerta también lo vigila.
//
// **Sobredetectar del lado del cliente es el lado seguro.** Se toma como posible
// llamada cualquier literal que empiece con `/`, sin exigir que esté dentro de
// un `request(...)`. Un falso «esta ruta sí se usa» deja pasar una huérfana; un
// falso «nadie la usa» manda a borrar algo que hace falta. El primero cuesta una
// revisión, el segundo un incidente.
//
// **Las suites no cuentan como consumidor, y eso es deliberado.** Una ruta que
// sólo llama una prueba sigue siendo superficie que el producto no ofrece. Pero
// tiene un costo que conviene saber: al borrar `/api/restaurants` por huérfana,
// tres suites que la usaban se pusieron rojas. Ninguna era el producto —las tres
// se apuntaron a la ruta paginada, que devuelve lo mismo— pero la puerta no
// avisa de eso. Antes de borrar una huérfana conviene buscarla también en
// `scripts/`.
//
// La lista de excepciones no es una alfombra: cada entrada dice **quién** llama a
// esa ruta si no es el frente. Una ruta que nadie llama y no tiene explicación
// hace fallar la puerta, y ése es el momento barato de decidir si se conecta o
// se borra.
import fs from "node:fs/promises";
import path from "node:path";

const BASE = "scripts/api-wiring-baseline.json";

// Rutas que legítimamente no llama el frente, con su consumidor real.
const CONSUMIDOR_EXTERNO = new Map([
  ["/api/health", "orquestador de contenedores"],
  ["/api/ready", "orquestador de contenedores y rls-guard"],
  ["/api/metrics", "Prometheus"],
  ["/api/internal/metrics", "Prometheus"],
  ["/api/openapi.json", "clientes de integración y test:openapi-contract"],
  ["/api/webhooks/mercadopago", "Mercado Pago"],
  ["/api/payments/webhooks/*", "proveedores de pago"],
  ["/api/payment-provider/mercadopago/callback", "redirección OAuth del proveedor"],
  ["/api/admin/dispatch/process", "trabajo programado de cola"],
  ["/api/admin/notifications/process", "trabajo programado de cola"],
  ["/api/admin/support/process", "trabajo programado de cola"],
  // Lápida deliberada: responde 410 para que un cliente viejo sepa que el
  // recurso se retiró, en vez de recibir un 404 indistinguible de un error.
  ["/api/state", "clientes anteriores al corte de `bootstrap`"],
]);

const leer = async (dir, extension, encontrados = []) => {
  const entradas = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entrada of entradas) {
    const completo = path.posix.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name !== "node_modules") await leer(completo, extension, encontrados);
    } else if (extension.test(entrada.name)) {
      encontrados.push(completo);
    }
  }
  return encontrados;
};

/**
 * Un parámetro con nombre y una interpolación son la misma cosa acá: un hueco.
 *
 * El `*` pegado al final de un segmento se descarta —`.../configuration*` sale de
 * una query interpolada, no de un parámetro— pero el que ocupa un segmento entero
 * se conserva, porque `/zones/*` sí es un hueco de ruta. La diferencia es si la
 * barra viene antes.
 */
const normalizar = (ruta) =>
  ruta
    .replace(/:[A-Za-z_]+/g, "*")
    .replace(/\$\{[^}]*\}/g, "*")
    .split("?")[0]
    .replace(/(?<=[^/])\*+$/, "")
    .replace(/\/+$/, "") || "/";

/**
 * Reemplaza cada `${...}` por `*`, respetando anidamiento.
 *
 * Una interpolacion puede contener otra plantilla completa, con sus backticks.
 * Contar llaves alcanza para saltearla entera sin interpretar lo de adentro.
 */
function quitarInterpolaciones(texto) {
  let salida = "";
  for (let i = 0; i < texto.length; i++) {
    if (texto[i] !== "$" || texto[i + 1] !== "{") {
      salida += texto[i];
      continue;
    }
    let profundidad = 1;
    let j = i + 2;
    for (; j < texto.length && profundidad > 0; j++) {
      if (texto[j] === "{") profundidad += 1;
      else if (texto[j] === "}") profundidad -= 1;
    }
    salida += "*";
    i = j - 1;
  }
  return salida;
}

// --- Lo que el servidor expone ----------------------------------------------
//
// El patrón admite salto de línea entre `.get(` y la ruta: prettier parte las
// declaraciones con middlewares en varias líneas, y exigirlas en una sola perdía
// medio inventario sin decir nada.
const rutas = new Map();
for (const archivo of await leer("server", /\.js$/)) {
  const fuente = await fs.readFile(archivo, "utf8");
  const declaraciones =
    /(?:router|app|[A-Za-z]+Router)\.(get|post|patch|put|delete)\(\s*["'`](\/api\/[^"'`]*)["'`]/g;
  for (const encontrada of fuente.matchAll(declaraciones)) {
    const ruta = normalizar(encontrada[2]);
    if (!rutas.has(ruta)) rutas.set(ruta, { metodos: new Set(), archivo });
    rutas.get(ruta).metodos.add(encontrada[1].toUpperCase());
  }
}

const PISO_RUTAS = 150;
if (rutas.size < PISO_RUTAS) {
  throw new Error(`Sólo se detectaron ${rutas.size} rutas y el piso es ${PISO_RUTAS}`);
}

// --- Lo que el frente nombra --------------------------------------------------
const literales = new Set();
const clientes = [
  ...(await leer("src", /\.tsx?$/)),
  ...(await leer("apps/mobile/src", /\.tsx?$/)),
  "apps/mobile/App.tsx",
];
for (const archivo of clientes) {
  const fuente = await fs.readFile(archivo, "utf8").catch(() => "");
  // Las interpolaciones se reemplazan por `*` **antes** de buscar literales.
  //
  // Sin esto, `/payment-provider/client-configuration${x ? `?y=${z}` : ""}` rompe
  // cualquier patron que corte en el primer backtick: lleva una plantilla dentro
  // de su interpolacion, el patron se queda con medio literal y la ruta aparece
  // huerfana. Paso de verdad, y casi termino cableando algo que ya lo estaba —el
  // mismo defecto que esta puerta busca en otros, cometido por ella misma.
  //
  // Quitarlas primero es mas simple que recorrer plantillas: no hay que adivinar
  // donde empieza una, y un backtick suelto en un comentario deja de importar.
  const sinInterpolaciones = quitarInterpolaciones(fuente);
  // El `*` inicial admite la forma `${API_BASE}/ruta`, que tras el reemplazo
  // queda como `*/ruta`. Asi se llaman `logout`, `refresh` y el stream de
  // eventos: sin contemplarlo, tres rutas vivas volvian a figurar huerfanas.
  const literalDeRuta = /[`"'](\*?\/[a-z][^`"'\n]*)[`"']/gi;
  for (const encontrada of sinInterpolaciones.matchAll(literalDeRuta)) {
    const crudo = encontrada[1].replace(/^\*/, "");
    literales.add(normalizar(crudo.startsWith("/api/") ? crudo : `/api${crudo}`));
  }
}

const PISO_LITERALES = 120;
if (literales.size < PISO_LITERALES) {
  throw new Error(`Sólo se detectaron ${literales.size} literales y el piso es ${PISO_LITERALES}`);
}

// --- El cruce -----------------------------------------------------------------
const huerfanas = [];
for (const [ruta, detalle] of rutas) {
  if (literales.has(ruta)) continue;
  if (CONSUMIDOR_EXTERNO.has(ruta)) continue;
  huerfanas.push({ ruta, ...detalle });
}
huerfanas.sort((a, b) => a.ruta.localeCompare(b.ruta));

// Una excepción que ya no corresponde a ninguna ruta esconde una ruta borrada y
// una explicación que sobrevivió a lo que explicaba.
const explicacionesVencidas = [...CONSUMIDOR_EXTERNO.keys()].filter((ruta) => !rutas.has(ruta));

console.log(`${rutas.size} rutas expuestas · ${literales.size} literales de ruta en el frente`);
console.log(`${CONSUMIDOR_EXTERNO.size} con consumidor externo declarado`);
console.log(`\n${huerfanas.length} ruta(s) que ningún cliente nombra:`);
for (const { ruta, metodos, archivo } of huerfanas) {
  console.log(`  ${[...metodos].sort().join("/").padEnd(11)} ${ruta.padEnd(46)} ${archivo}`);
}
for (const ruta of explicacionesVencidas) {
  console.error(`\nCONSUMIDOR_EXTERNO tiene una entrada obsoleta: ${ruta}`);
}

const previa = JSON.parse(await fs.readFile(BASE, "utf8").catch(() => "null"));
if (!previa) {
  console.log(`\nSin línea base. Escribí ${BASE} con { "huerfanas": ${huerfanas.length} }.`);
  process.exit(1);
}
if (explicacionesVencidas.length) process.exit(1);
if (huerfanas.length > previa.huerfanas) {
  console.error(`\nLa línea base es ${previa.huerfanas} y ahora hay ${huerfanas.length}.`);
  console.error("Se agregó una ruta que ningún cliente llama. Conectala, borrala, o declará");
  console.error("quién la consume en CONSUMIDOR_EXTERNO diciendo qué la llama.");
  process.exit(1);
}
if (huerfanas.length < previa.huerfanas) {
  console.log(`\nok - bajó de ${previa.huerfanas} a ${huerfanas.length}: actualizá ${BASE}`);
  process.exit(1);
}
console.log(`\nok - ${huerfanas.length} huérfanas, igual que la línea base`);
