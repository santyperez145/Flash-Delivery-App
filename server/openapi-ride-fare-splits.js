// Contrato OpenAPI de dividir la tarifa de un viaje (PAG-02).
export function rideFareSplitPaths({ success, json, errorResponses }) {
  const rideId = { name: "rideId", in: "path", required: true, schema: { type: "string" } };
  const splitId = { name: "splitId", in: "path", required: true, schema: { type: "string" } };
  const comun = {
    401: errorResponses[401],
    503: { description: "Requiere PostgreSQL", content: json },
  };
  const respuesta = (accion) => ({
    post: {
      tags: ["Finance"],
      operationId: `${accion}FareSplit`,
      summary:
        accion === "accept"
          ? "El invitado acepta y paga su parte desde su Flash Wallet"
          : "El invitado rechaza dividir la tarifa",
      description:
        "Al aceptar, la tarifa se divide en partes iguales entre quien pidió y quienes aceptaron; " +
        "a los que ya habían aceptado se les devuelve lo que pagaron de más.",
      security: [{ bearerAuth: [] }],
      parameters: [splitId],
      responses: {
        200: success({ type: "object", properties: { split: { type: "object" } } }, "Respondida"),
        402: { description: "Saldo insuficiente para la parte", content: json },
        403: { description: "La invitación es para otra persona", content: json },
        404: { description: "Invitación no encontrada", content: json },
        409: { description: "Ya respondida, o el viaje terminó", content: json },
        429: errorResponses[429],
        ...comun,
      },
    },
  });
  return {
    "/api/rides/{rideId}/splits": {
      post: {
        tags: ["Finance"],
        operationId: "inviteToSplitFare",
        summary: "Quien pidió el viaje invita a otra cuenta Flash a dividir la tarifa",
        description:
          "Sólo un viaje pagado con Flash Wallet y todavía en curso. Hasta cuatro personas. Un " +
          "email que no es de un cliente activo responde igual que uno inexistente.",
        security: [{ bearerAuth: [] }],
        parameters: [rideId],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                properties: { email: { type: "string", format: "email" } },
              },
            },
          },
        },
        responses: {
          201: success({ type: "object", properties: { split: { type: "object" } } }, "Invitada"),
          400: errorResponses[400],
          403: { description: "No es quien pidió el viaje", content: json },
          404: { description: "Sin cuenta Flash con ese email", content: json },
          409: { description: "Viaje terminado, sin Wallet, repetido o completo", content: json },
          429: errorResponses[429],
          ...comun,
        },
      },
      get: {
        tags: ["Finance"],
        operationId: "listRideFareSplits",
        summary: "Con quién se divide el viaje, en qué estado y cuánto pagó cada uno",
        security: [{ bearerAuth: [] }],
        parameters: [rideId],
        responses: {
          200: success({ type: "object", properties: { splits: { type: "array" } } }, "Lista"),
          ...comun,
        },
      },
    },
    "/api/me/fare-split-invitations": {
      get: {
        tags: ["Finance"],
        operationId: "listMyFareSplitInvitations",
        summary: "Las invitaciones pendientes a dividir un viaje, con la parte que tocaría",
        security: [{ bearerAuth: [] }],
        responses: {
          200: success({ type: "object", properties: { invitations: { type: "array" } } }, "Lista"),
          ...comun,
        },
      },
    },
    "/api/ride-splits/{splitId}/accept": respuesta("accept"),
    "/api/ride-splits/{splitId}/decline": respuesta("decline"),
  };
}
