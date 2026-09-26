export const json = { "application/json": { schema: { $ref: "#/components/schemas/Error" } } };
export const errorResponses = {
  400: { description: "Solicitud inválida", content: json },
  401: { description: "Autenticación ausente, inválida o vencida", content: json },
  429: { description: "Límite de solicitudes excedido", content: json },
  500: { description: "Error interno", content: json },
};
export const success = (schema, description = "Operación exitosa") => ({
  description,
  content: { "application/json": { schema } },
});

export const bearerErrors = {
  400: errorResponses[400],
  401: errorResponses[401],
  403: { description: "La identidad no puede actuar por el customer solicitado", content: json },
  409: { description: "Cotización vencida o no correspondiente", content: json },
  429: errorResponses[429],
};
export const idempotencyHeader = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  description: "Clave única por intento lógico; 16 a 128 caracteres ASCII seguros.",
  schema: { type: "string", pattern: "^[a-zA-Z0-9._:-]{16,128}$" },
};
export const operationsPageParameters = [
  {
    name: "limit",
    in: "query",
    required: false,
    schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
  },
  { name: "cursor", in: "query", required: false, schema: { type: "string" } },
  { name: "q", in: "query", required: false, schema: { type: "string", maxLength: 100 } },
];
// El grupo entero se devuelve en cada respuesta que lo cambia: la pantalla
// necesita el estado nuevo completo, y devolver solo lo que cambio la obligaria
// a reconstruirlo por su cuenta.
export const groupResponse = {
  type: "object",
  required: ["group"],
  properties: { group: { $ref: "#/components/schemas/GroupOrder" } },
};
export const body = (schema) => ({
  required: true,
  content: { "application/json": { schema: { $ref: `#/components/schemas/${schema}` } } },
});
