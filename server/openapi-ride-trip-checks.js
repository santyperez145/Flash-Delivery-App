// Contrato OpenAPI del control del viaje (SEG-01).
export function rideTripCheckPaths({ success, json, errorResponses }) {
  return {
    "/api/rides/{rideId}/trip-checks/{checkId}": {
      post: {
        tags: ["Tracking"],
        operationId: "answerRideTripCheck",
        summary: "El pasajero contesta un aviso del control del viaje",
        description:
          "Flash avisa cuando el auto está detenido, se pierde la señal del conductor, se aleja " +
          "del recorrido o el viaje termina lejos del destino. «ok» cierra el aviso; «help» abre " +
          "un incidente de seguridad en la cola de operaciones, igual que el SOS.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "rideId", in: "path", required: true, schema: { type: "string" } },
          { name: "checkId", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["response"],
                properties: {
                  response: { enum: ["ok", "help"] },
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
          200: success({ type: "object", properties: { check: { type: "object" } } }, "Registrada"),
          400: errorResponses[400],
          401: errorResponses[401],
          403: { description: "Sólo quien viaja puede contestar", content: json },
          404: { description: "Aviso no encontrado", content: json },
          409: { description: "El aviso ya no está abierto", content: json },
          503: { description: "Requiere PostgreSQL", content: json },
        },
      },
    },
  };
}
