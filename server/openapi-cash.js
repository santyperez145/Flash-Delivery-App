// Contrato OpenAPI del efectivo (PAG-01): la rendición de efectivo de repartidores y
// conductores. El pago en efectivo de un pedido se documenta en el alta del pedido.
export function cashPaths({ success, json, errorResponses }) {
  return {
    "/api/admin/drivers/{driverId}/cash-deposits": {
      post: {
        tags: ["Finance"],
        operationId: "registerCashDeposit",
        summary: "La operación registra que un repartidor o conductor entregó efectivo cobrado",
        description:
          "Acredita su Wallet y debita la caja de efectivo recibido. No puede superar lo que debe: " +
          "una rendición de más dejaría saldo retirable que nadie depositó. `Idempotency-Key` " +
          "obligatorio: repetirlo no registra otra rendición.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "driverId", in: "path", required: true, schema: { type: "string" } },
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: { type: "string", minLength: 16, maxLength: 128 },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["amount"],
                properties: {
                  amount: { type: "integer", minimum: 1, description: "Pesos enteros" },
                  reference: { type: "string", maxLength: 120 },
                },
              },
            },
          },
        },
        responses: {
          200: success(
            { type: "object", properties: { deposit: { type: "object" } } },
            "Registrada",
          ),
          400: errorResponses[400],
          401: errorResponses[401],
          403: errorResponses[403],
          404: { description: "Repartidor inexistente", content: json },
          409: { description: "La rendición supera lo que debe", content: json },
          503: { description: "Requiere PostgreSQL", content: json },
        },
      },
    },
  };
}
