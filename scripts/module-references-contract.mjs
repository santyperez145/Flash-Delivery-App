// Referencias sin resolver en los módulos del servidor (ticket ARC-001).
//
// Existe por un error concreto que se repitió tres veces al extraer grupos de
// rutas: el bloque movido usaba algo que vivía en `server/index.js`
// —`deliveryProofLimiter`, `requireAnyRole`, `config`— y el import no se agregó.
//
// Node no lo detecta al importar el módulo, porque la referencia está dentro del
// handler y sólo falla cuando llega un request. Así que el error llegaba a CI en
// forma de suite roja, no de fallo de arranque: minutos en lugar de segundos, y
// con un mensaje que no dice qué falta.
//
// Esta puerta lo encuentra estáticamente. No sustituye a las suites que ejercen
// las rutas: comprueba que cada nombre esté ligado, no que el handler haga lo
// correcto.
import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";

const ROOT = "server";
const GLOBALS = new Set([
  "console",
  "JSON",
  "Math",
  "Date",
  "Object",
  "Array",
  "String",
  "Number",
  "Boolean",
  "Promise",
  "Error",
  "TypeError",
  "RangeError",
  "Set",
  "Map",
  "WeakMap",
  "RegExp",
  "Symbol",
  "BigInt",
  "Infinity",
  "NaN",
  "undefined",
  "globalThis",
  "structuredClone",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "encodeURIComponent",
  "decodeURIComponent",
  "Buffer",
  "process",
  "URL",
  "URLSearchParams",
  "TextEncoder",
  "TextDecoder",
  "AbortController",
  "AbortSignal",
  "fetch",
  "Response",
  "Request",
  "Headers",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "setImmediate",
  "queueMicrotask",
  "Intl",
  "Proxy",
  "Reflect",
  "arguments",
  "AggregateError",
]);

/** Nombres que un patrón de binding introduce: destructuring, rest, defaults. */
function bindingNames(node, out) {
  if (!node) return;
  switch (node.type) {
    case "Identifier":
      out.add(node.name);
      break;
    case "ObjectPattern":
      for (const prop of node.properties)
        bindingNames(prop.type === "RestElement" ? prop.argument : prop.value, out);
      break;
    case "ArrayPattern":
      for (const element of node.elements) bindingNames(element, out);
      break;
    case "AssignmentPattern":
      bindingNames(node.left, out);
      break;
    case "RestElement":
      bindingNames(node.argument, out);
      break;
    default:
      break;
  }
}

/**
 * Recorre el AST acumulando ligaduras y referencias.
 *
 * Las ligaduras se juntan para todo el módulo sin distinguir alcance. Es una
 * sobreaproximación deliberada: puede dejar pasar un uso antes de su
 * declaración, pero **no inventa** un nombre faltante. Para lo que esta puerta
 * busca —un import olvidado— eso es exactamente lo que se quiere.
 */
function analyze(ast) {
  const bound = new Set();
  const referenced = new Map();

  const visit = (node, parent) => {
    if (!node || typeof node.type !== "string") return;

    switch (node.type) {
      case "ImportDeclaration":
        for (const spec of node.specifiers) bound.add(spec.local.name);
        return;
      case "VariableDeclarator":
        bindingNames(node.id, bound);
        break;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        if (node.id) bound.add(node.id.name);
        for (const param of node.params) bindingNames(param, bound);
        break;
      case "ClassDeclaration":
      case "ClassExpression":
        if (node.id) bound.add(node.id.name);
        break;
      case "CatchClause":
        bindingNames(node.param, bound);
        break;
      // `import.meta` no es una referencia a `import` ni a `meta`.
      case "MetaProperty":
        return;
      case "Identifier": {
        // Una propiedad no es una referencia: `a.config` no usa `config`.
        const isMemberProperty =
          parent?.type === "MemberExpression" && parent.property === node && !parent.computed;
        const isPropertyKey =
          parent?.type === "Property" && parent.key === node && !parent.computed;
        // El nombre de un método de clase tampoco: `execute() {}` no usa `execute`.
        const isClassMember =
          (parent?.type === "MethodDefinition" || parent?.type === "PropertyDefinition") &&
          parent.key === node &&
          !parent.computed;
        const isLabel = parent?.type === "LabeledStatement" || parent?.type === "BreakStatement";
        if (
          !isMemberProperty &&
          !isPropertyKey &&
          !isClassMember &&
          !isLabel &&
          !referenced.has(node.name)
        ) {
          referenced.set(node.name, node.loc?.start?.line ?? 0);
        }
        return;
      }
      default:
        break;
    }

    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "range" || key === "parent") continue;
      const child = node[key];
      if (Array.isArray(child)) for (const item of child) visit(item, node);
      else if (child && typeof child.type === "string") visit(child, node);
    }
  };

  visit(ast, null);
  return { bound, referenced };
}

async function collect(entry) {
  const stat = await fs.stat(entry).catch(() => null);
  if (!stat) return [];
  if (stat.isFile()) return entry.endsWith(".js") ? [entry] : [];
  const children = await fs.readdir(entry);
  const nested = await Promise.all(
    children
      .filter((child) => child !== "node_modules" && child !== "data")
      .map((child) => collect(path.posix.join(entry, child))),
  );
  return nested.flat();
}

const files = await collect(ROOT);
const FLOOR = 50;
if (files.length < FLOOR) {
  throw new Error(`Sólo se inspeccionaron ${files.length} módulos y el piso es ${FLOOR}`);
}

const problems = [];
for (const file of files) {
  const source = await fs.readFile(file, "utf8");
  let ast;
  try {
    ast = parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true });
  } catch (error) {
    problems.push(`${file}: no se pudo parsear (${error.message})`);
    continue;
  }
  const { bound, referenced } = analyze(ast);
  for (const [name, line] of referenced) {
    if (bound.has(name) || GLOBALS.has(name)) continue;
    problems.push(`${file}:${line} — \`${name}\` no está ligado ni importado`);
  }
}

if (problems.length) {
  console.error(`${problems.length} referencia(s) sin resolver:\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("\nUn handler que usa algo sin importar no falla al arrancar: falla cuando llega");
  console.error("un request. Agregá el import que falta.");
  process.exit(1);
}

console.log(`ok - ${files.length} módulos del servidor sin referencias sin resolver`);

// ---------------------------------------------------------------------------
// La misma clase de error, en el otro espacio de nombres: tablas (OPS-001).
//
// Un `FROM tabla_que_no_existe` falla igual que una variable sin ligar —recien
// cuando llega el request, con un mensaje que no dice que falta— y por el mismo
// motivo: nadie lo mira hasta que alguien pasa por ahi. Aparecio escribiendo el
// tablero de colas de trabajo, que nombra doce tablas y sus estados; una sola
// mal tipeada rompe la consulta entera y solo se ve corriendo contra la base.
//
// **Los alias y los CTE no son tablas.** `FROM jobs j` referencia `jobs`, y
// `WITH food_jobs AS (...) ... FROM food_jobs` no referencia nada del esquema.
// Sin distinguirlos, la puerta reportaria decenas de nombres inventados y se
// terminaria apagando.
const migraciones = await fs.readdir("database/migrations");
const sqlMigraciones = (
  await Promise.all(
    migraciones
      .filter((nombre) => nombre.endsWith(".sql"))
      .map((nombre) => fs.readFile(`database/migrations/${nombre}`, "utf8")),
  )
).join("\n");

// El propio migrador crea `schema_migrations` antes de aplicar la primera
// migracion, asi que es parte del esquema aunque no salga de `database/`.
const sqlDelEsquema = `${sqlMigraciones}
${await fs.readFile("scripts/db-migrate.mjs", "utf8")}`;

const tablasDelEsquema = new Set();
for (const creada of sqlDelEsquema.matchAll(
  /CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi,
))
  tablasDelEsquema.add(creada[1].toLowerCase());
// Las vistas se consultan como tablas y no las crea `CREATE TABLE`.
for (const vista of sqlDelEsquema.matchAll(
  /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+([a-z_][a-z0-9_]*)/gi,
))
  tablasDelEsquema.add(vista[1].toLowerCase());
// Una tabla renombrada sigue existiendo bajo su nombre nuevo.
for (const renombrada of sqlDelEsquema.matchAll(
  /ALTER\s+TABLE\s+[a-z_][a-z0-9_]*\s+RENAME\s+TO\s+([a-z_][a-z0-9_]*)/gi,
))
  tablasDelEsquema.add(renombrada[1].toLowerCase());

if (tablasDelEsquema.size < 80) {
  // Sin este piso, un error de ruta dejaria el conjunto vacio y todas las
  // referencias del servidor se reportarian como inexistentes — o peor, con la
  // comparacion al reves, ninguna.
  throw new Error(`Solo se leyeron ${tablasDelEsquema.size} tablas del esquema`);
}

// Catalogos del sistema y esquemas ajenos, que existen sin estar en ninguna
// migracion.
const TABLAS_EXTERNAS = new Set(["information_schema", "spatial_ref_sys"]);

// Palabras que siguen a FROM/JOIN/UPDATE sin ser tablas. Se listan por nombre
// porque son pocas y cerradas: `FOR UPDATE OF c,i` y `DO UPDATE SET x=1` son las
// dos que aparecen de verdad en este codigo, y una lista corta se lee mejor que
// una gramatica SQL a medias.
const PALABRAS_SQL = new Set(["of", "set", "only", "lateral", "unnest", "values", "skip"]);

// El respaldo SQLite (`store.js` y sus extracciones) tiene su propio esquema,
// creado en `store-schema.js`. Compararlo contra las migraciones de PostgreSQL
// reportaría todas sus tablas como inexistentes, que es exactamente al revés.
const FUERA_DEL_ESQUEMA_POSTGRES = new Set([
  "server/store.js",
  "server/store-local-preferences.js",
  "server/store-auth-sessions.js",
]);

const sinComentariosJs = (fuente) =>
  fuente.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const referenciasInvalidas = [];
for (const archivo of files) {
  if (FUERA_DEL_ESQUEMA_POSTGRES.has(archivo)) continue;
  // Los comentarios no cuentan: media docena de ellos explican una consulta en
  // prosa y contienen las palabras `FROM` y `JOIN`.
  const fuente = sinComentariosJs(await fs.readFile(archivo, "utf8"));
  // Nombres que el propio SQL define: CTE y subconsultas nombradas.
  const definidosEnLaConsulta = new Set(
    [...fuente.matchAll(/(?:WITH|,)\s*([a-z_][a-z0-9_]*)\s+AS\s*\(/gi)].map((coincidencia) =>
      coincidencia[1].toLowerCase(),
    ),
  );
  for (const referencia of fuente.matchAll(
    /\b(?:FROM|JOIN|INSERT\s+INTO|UPDATE)\s+([a-z_][a-z0-9_]*)(\s*\()?/gi,
  )) {
    const nombre = referencia[1].toLowerCase();
    // Un nombre seguido de parentesis es una funcion que devuelve filas
    // —`generate_series(...)`, `jsonb_to_recordset(...)`—, no una tabla.
    if (referencia[2]) continue;
    if (
      tablasDelEsquema.has(nombre) ||
      definidosEnLaConsulta.has(nombre) ||
      TABLAS_EXTERNAS.has(nombre) ||
      PALABRAS_SQL.has(nombre) ||
      nombre.startsWith("pg_")
    )
      continue;
    referenciasInvalidas.push(`${archivo.replace("server/", "")}: ${nombre}`);
  }
}

if (referenciasInvalidas.length) {
  console.error(`\n${referenciasInvalidas.length} referencia(s) a tablas inexistentes:\n`);
  for (const linea of [...new Set(referenciasInvalidas)].sort()) console.error(`  ${linea}`);
  console.error("\nUn FROM a una tabla que no existe falla recien cuando llega el request.");
  process.exit(1);
}
console.log(
  `ok - las tablas que nombra el servidor existen en el esquema (${tablasDelEsquema.size})`,
);
