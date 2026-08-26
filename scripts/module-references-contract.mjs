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
