// Contrato OpenAPI de la cuenta y los documentos legales (LAN-001, LAN-002).
//
// Vive aparte de `openapi.js` porque ese archivo es un monolito identificado en
// el hallazgo H-08: recibe los ayudantes del documento en lugar de duplicarlos.
export function accountPaths({ success, json, errorResponses }) {
  return {
    "/api/me/delete": {
      post: {
        tags: ["Auth"],
        operationId: "deleteOwnAccount",
        summary: "Eliminar la cuenta propia, o pedirlo a soporte si tiene roles con obligaciones",
        description:
          "Pide la contraseña otra vez. Un cliente sin pedidos en curso ni saldo queda anonimizado " +
          "al instante (200); un comercio, repartidor o staff genera una solicitud a soporte (202).",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["password"],
                properties: {
                  password: { type: "string", minLength: 1, maxLength: 200, writeOnly: true },
                },
              },
            },
          },
        },
        responses: {
          200: success({ type: "object", properties: { status: { const: "deleted" } } }),
          202: success(
            { type: "object", properties: { status: { const: "requested" } } },
            "Solicitud creada",
          ),
          400: errorResponses[400],
          401: errorResponses[401],
          403: { description: "La contraseña no coincide", content: json },
          409: {
            description: "Pedido, reclamo o devolución en curso, o saldo en la Wallet",
            content: json,
          },
          429: { description: "Demasiados intentos de contraseña o de solicitudes", content: json },
        },
      },
    },
    "/api/public/legal": {
      get: {
        tags: ["Auth"],
        operationId: "getLegalLinks",
        summary: "URLs de los términos y la política de privacidad",
        description:
          "Pública: se muestra antes de tener cuenta. `null` mientras el documento no esté publicado.",
        responses: {
          200: success({
            type: "object",
            required: ["termsUrl", "privacyUrl"],
            properties: {
              termsUrl: { type: ["string", "null"], format: "uri" },
              privacyUrl: { type: ["string", "null"], format: "uri" },
            },
          }),
          429: errorResponses[429],
        },
      },
    },
  };
}
