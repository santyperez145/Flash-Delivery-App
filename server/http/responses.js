// Respuestas HTTP y validación de entrada (ticket ARC-001, paso 2).
//
// Primer módulo extraído de `server/index.js`, que concentraba 172
// declaraciones de nivel superior y 210 rutas en un solo archivo de 9.696
// líneas.
//
// Estas tres funciones se eligieron primero por dos motivos: son puras —sólo
// dependen del `res` que reciben— y las usa prácticamente cada handler. Eso las
// vuelve la extracción de menor riesgo y mayor alcance: si algo se rompiera al
// moverlas, falla la suite entera de inmediato en lugar de en un caso raro.
//
// Todas las respuestas llevan `requestId`. Es lo que permite correlacionar una
// respuesta con sus logs y su traza sin exponer nada del usuario.

/** Respuesta exitosa. El `requestId` va siempre, no según el caso. */
export const ok = (res, payload = {}) =>
  res.json({ ok: true, requestId: res.locals.requestId, ...payload });

/** Respuesta de error. Mismo contrato que `ok`: nunca sin `requestId`. */
export const fail = (res, status, message) =>
  res.status(status).json({ ok: false, requestId: res.locals.requestId, message });

/**
 * Responde a partir de un error capturado, **sin filtrar su mensaje en un 500**.
 *
 * El manejador global de `server/index.js` ya decidió esta política: de 500 para
 * arriba responde «Error interno del servidor» y nunca el texto del error. El
 * problema era que 95 handlers capturaban el error ellos mismos y escribían
 * `fail(res, error.status || 500, error.message || "No se pudo X")`, con lo que
 * puenteaban esa política justo en el caso que la motiva.
 *
 * Encontrado probando en el navegador: `/api/admin/payouts` sobre el fallback
 * SQLite devolvía `Cannot read properties of null (reading 'query')` al cliente.
 * Ningún contrato estático lo veía, porque el código era correcto — sólo era
 * indiscreto.
 *
 * La regla es la del manejador global, dicha una vez:
 *
 * - **Menos de 500**: el error es del cliente y su mensaje es parte del
 *   contrato. Se responde tal cual.
 * - **500 o más**: la falla es interna. Se responde el mensaje propio del
 *   handler —que describe qué operación falló, no por qué— y el detalle queda
 *   en el log, correlacionable por `requestId`.
 */
export const failFrom = (res, error, fallback) => {
  const status = Number(error?.status) || 500;
  return fail(res, status, status >= 500 ? fallback : error?.message || fallback);
};

/**
 * Valida contra un esquema Zod sin lanzar.
 *
 * Devuelve `{ok:false,message}` en lugar de propagar el error de Zod: el
 * mensaje que ve el cliente se arma acá, y no arrastra la forma interna del
 * esquema ni el valor que se recibió.
 */
export const parseOrFail = (schema, payload) => {
  const result = schema.safeParse(payload);
  if (!result.success) {
    return {
      ok: false,
      message: result.error.issues.map((issue) => issue.message).join(", "),
    };
  }
  return { ok: true, data: result.data };
};
