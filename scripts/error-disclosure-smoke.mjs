// Contrato de no divulgación en errores 5xx (ticket ARC-001, paso 13).
//
// Un 500 no describe su causa. El manejador global de `server/index.js` ya lo
// decidía —responde «Error interno del servidor» y nunca el texto del error—,
// pero **130 handlers capturaban el error ellos mismos** y escribían
// `fail(res, error.status || 500, error.message || "No se pudo X")`, con lo que
// puenteaban esa política justo en el caso que la motiva.
//
// El hallazgo no vino de leer código: vino de abrir la aplicación en un
// navegador. `/api/admin/payouts` sobre el fallback SQLite devolvía
// `Cannot read properties of null (reading 'query')` al cliente. Ningún contrato
// estático lo veía, porque el código no estaba roto — sólo era indiscreto.
//
// Esta suite tiene dos mitades: una función pura que se afirma directamente, y
// un barrido del árbol del servidor que impide que el patrón vuelva.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ok = (label) => console.log(`ok - ${label}`);
const { failFrom } = await import("../server/http/responses.js");

// --- 1. La política, afirmada sobre la función -------------------------------

const responder = () => {
  const res = { locals: { requestId: "REQ-1" }, statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
};

const interno = responder();
failFrom(
  interno,
  new TypeError("Cannot read properties of null (reading 'query')"),
  "No se pudo cargar la cola de retiros",
);
assert.equal(interno.statusCode, 500);
assert.equal(interno.body.message, "No se pudo cargar la cola de retiros");
ok("un error sin status responde 500 con el mensaje del handler, no con el del error");

// Éste es el caso exacto del hallazgo: el texto del TypeError no puede aparecer.
assert.ok(!interno.body.message.includes("null"));
assert.ok(!interno.body.message.includes("query"));
ok("el texto del error interno no llega al cliente");

const explicito = responder();
failFrom(
  explicito,
  Object.assign(new Error("Falla interna con detalle"), { status: 503 }),
  "El servicio no está disponible",
);
assert.equal(explicito.statusCode, 503);
assert.equal(explicito.body.message, "El servicio no está disponible");
ok("un 5xx declarado por el repositorio tampoco filtra su mensaje");

const delCliente = responder();
failFrom(
  delCliente,
  Object.assign(new Error("La dirección ya existe"), { status: 409 }),
  "No se pudo guardar",
);
assert.equal(delCliente.statusCode, 409);
assert.equal(delCliente.body.message, "La dirección ya existe");
ok("por debajo de 500 el mensaje del error es parte del contrato y se conserva");

const sinMensaje = responder();
failFrom(sinMensaje, { status: 400 }, "Solicitud inválida");
assert.equal(sinMensaje.statusCode, 400);
assert.equal(sinMensaje.body.message, "Solicitud inválida");
ok("un error de cliente sin mensaje cae al del handler en lugar de responder vacío");

const nulo = responder();
failFrom(nulo, null, "No se pudo completar la operación");
assert.equal(nulo.statusCode, 500);
assert.equal(nulo.body.message, "No se pudo completar la operación");
ok("un `catch` que recibe null no rompe la respuesta");

for (const respuesta of [interno, explicito, delCliente, sinMensaje, nulo]) {
  assert.equal(respuesta.body.ok, false);
  assert.equal(respuesta.body.requestId, "REQ-1");
}
ok("toda respuesta conserva el requestId, que es cómo se correlaciona con el log");

// --- 2. El patrón no puede volver --------------------------------------------

async function fuentesDelServidor(dir = "server") {
  const entradas = await fs.readdir(dir, { withFileTypes: true });
  const archivos = [];
  for (const entrada of entradas) {
    const completo = `${dir}/${entrada.name}`;
    if (entrada.isDirectory()) archivos.push(...(await fuentesDelServidor(completo)));
    else if (path.extname(entrada.name) === ".js") archivos.push(completo);
  }
  return archivos.sort();
}

/**
 * Cada llamada a `fail(`, con sus argumentos completos.
 *
 * Se cuentan paréntesis en lugar de mirar línea por línea. La primera versión de
 * este contrato buscaba la cadena `error.status || 500` sobre cada línea suelta,
 * y **tenía un punto ciego**: no veía `fail(res, 500, error.message || "...")`,
 * con el 500 escrito como literal. Lo encontró el navegador, no la suite, en la
 * sección de tarifas del backoffice.
 *
 * La lección quedó en la forma de la comprobación: se analiza la llamada entera,
 * no una forma de escribirla.
 */
function llamadasAFail(src) {
  const llamadas = [];
  const patron = /\bfail\(/g;
  let m;
  while ((m = patron.exec(src))) {
    let profundidad = 1;
    let i = m.index + m[0].length;
    while (i < src.length && profundidad > 0) {
      if (src[i] === "(") profundidad += 1;
      else if (src[i] === ")") profundidad -= 1;
      i += 1;
    }
    llamadas.push({
      texto: src.slice(m.index, i),
      linea: src.slice(0, m.index).split("\n").length,
    });
  }
  return llamadas;
}

const archivos = await fuentesDelServidor();
const infractores = [];
let revisadas = 0;
for (const archivo of archivos) {
  // `responses.js` define la política y `index.js` la aplica en su manejador
  // global, que es el único lugar donde `error.message` puede aparecer junto a un
  // 500 — porque ahí precisamente se lo reemplaza.
  if (archivo === "server/http/responses.js") continue;
  const src = await fs.readFile(archivo, "utf8");
  for (const llamada of llamadasAFail(src)) {
    revisadas += 1;
    if (!/\berror\??\.message\b/.test(llamada.texto)) continue;
    // El manejador global **es** la política: enmascara el 5xx él mismo. Se lo
    // exime por su forma y no por su archivo, para que copiar el patrón a otro
    // lado no herede la excepción sin heredar el enmascarado.
    if (/status >= 500 \? "Error interno del servidor"/.test(llamada.texto)) continue;
    // Un status por debajo de 500 es un error del cliente: su mensaje es parte
    // del contrato y puede responderse. Lo que no puede es un status que llegue
    // a 5xx, sea literal o derivado del error.
    const puedeSer5xx = /error\??\.status/.test(llamada.texto) || /\b5\d\d\b/.test(llamada.texto);
    if (puedeSer5xx) infractores.push(`${archivo}:${llamada.linea}`);
  }
}
assert.deepEqual(
  infractores,
  [],
  `estos \`fail\` pueden responder 5xx con el mensaje del error:\n  ${infractores.join("\n  ")}\n` +
    "Usá `failFrom(res, error, mensajePropio)`, que aplica la política del manejador global.",
);
ok(`ninguna de ${revisadas} llamadas a fail() puede filtrar un error en 5xx`);

console.log("\nok - contrato de no divulgación en errores verificado");
