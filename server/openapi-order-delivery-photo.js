// Contrato OpenAPI de la foto de entrega de un pedido (P-02b).
export function orderDeliveryPhotoPaths({ success, json, errorResponses }) {
  return {
    "/api/orders/{orderId}/delivery-photo": {
      post: {
        tags: ["Commerce"],
        operationId: "addOrderDeliveryPhoto",
        summary: "Foto de un pedido dejado en la puerta, sacada por quien reparte",
        description:
          "Sólo el repartidor asignado y con el pedido en camino. Se guarda cifrada con su hash. " +
          "Si el cliente pidió dejarlo en la puerta, el pedido no se cierra sin ella.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "orderId", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["mimeType", "contentBase64"],
                properties: {
                  mimeType: { enum: ["image/jpeg", "image/png", "image/webp"] },
                  contentBase64: { type: "string", maxLength: 2100000 },
                  capturedAt: { type: "string", format: "date-time" },
                  location: {
                    type: "object",
                    properties: { lat: { type: "number" }, lng: { type: "number" } },
                  },
                },
              },
            },
          },
        },
        responses: {
          201: success({ type: "object", properties: { photo: { type: "object" } } }, "Guardada"),
          400: errorResponses[400],
          401: errorResponses[401],
          403: { description: "No es quien reparte el pedido", content: json },
          409: { description: "El pedido todavía no está en camino", content: json },
          429: errorResponses[429],
        },
      },
      get: {
        tags: ["Commerce"],
        operationId: "getOrderDeliveryPhoto",
        summary: "La foto de entrega, para quien pidió, quien repartió u operaciones",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "orderId", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: success({
            type: "object",
            required: ["photo", "contentBase64"],
            properties: {
              photo: { type: "object", properties: { mimeType: { type: "string" } } },
              contentBase64: { type: "string" },
            },
          }),
          401: errorResponses[401],
          403: { description: "No participó del pedido", content: json },
          404: { description: "El pedido no tiene foto de entrega", content: json },
        },
      },
    },
  };
}
