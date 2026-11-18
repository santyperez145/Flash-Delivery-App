// Contrato OpenAPI del código de entrega en pedidos (SEG-03).
export function orderDeliveryCodePaths({ success, json, errorResponses }) {
  const orderId = { name: "orderId", in: "path", required: true, schema: { type: "string" } };
  return {
    "/api/orders/{orderId}/delivery-code": {
      get: {
        tags: ["Commerce"],
        operationId: "getOrderDeliveryCode",
        summary: "El código de entrega, para quien pidió",
        description:
          "Un pedido con envío de valor alto, o de quien tuvo un reclamo aprobado en 90 días, se " +
          "entrega con un código de 4 dígitos. Sólo lo ve quien pidió y mientras el pedido sigue en curso.",
        security: [{ bearerAuth: [] }],
        parameters: [orderId],
        responses: {
          200: success(
            { type: "object", properties: { deliveryCode: { type: "string" } } },
            "Código",
          ),
          401: errorResponses[401],
          403: { description: "No es quien pidió", content: json },
          404: { description: "El pedido no usa código", content: json },
          409: { description: "El pedido terminó o el código ya se usó", content: json },
          503: { description: "Requiere PostgreSQL", content: json },
        },
      },
    },
    "/api/orders/{orderId}/delivery-code/verify": {
      post: {
        tags: ["Commerce"],
        operationId: "verifyOrderDeliveryCode",
        summary: "Quien reparte ingresa el código al llegar",
        description:
          "Sin el código verificado el pedido no se cierra. Cinco intentos fallidos bloquean diez minutos.",
        security: [{ bearerAuth: [] }],
        parameters: [orderId],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["pin"],
                properties: { pin: { type: "string", pattern: "^\d{4}$" } },
              },
            },
          },
        },
        responses: {
          200: success(
            { type: "object", properties: { verified: { type: "boolean" } } },
            "Verificado",
          ),
          400: errorResponses[400],
          401: errorResponses[401],
          403: { description: "No es quien reparte el pedido", content: json },
          409: { description: "El pedido todavía no está en camino", content: json },
          429: errorResponses[429],
          503: { description: "Requiere PostgreSQL", content: json },
        },
      },
    },
  };
}
