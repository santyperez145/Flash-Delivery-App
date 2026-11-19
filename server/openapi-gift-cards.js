// Contrato OpenAPI de las tarjetas de regalo (PAG-04).
export function giftCardPaths({ success, json, errorResponses }) {
  const giftCardId = { name: "giftCardId", in: "path", required: true, schema: { type: "string" } };
  const comun = {
    401: errorResponses[401],
    429: errorResponses[429],
    503: { description: "Requiere PostgreSQL", content: json },
  };
  const tarjeta = success({ type: "object", properties: { card: { type: "object" } } }, "Tarjeta");
  return {
    "/api/me/gift-cards": {
      get: {
        tags: ["Finance"],
        operationId: "listMyGiftCards",
        summary: "Las tarjetas que compró la persona y las dirigidas a su cuenta sin canjear",
        description:
          "De las compradas, el código se devuelve sólo mientras la tarjeta está vigente. " +
          "La respuesta no se guarda en caché.",
        security: [{ bearerAuth: [] }],
        responses: {
          200: success(
            {
              type: "object",
              properties: { purchased: { type: "array" }, received: { type: "array" } },
            },
            "Lista",
          ),
          ...comun,
        },
      },
    },
    "/api/gift-cards": {
      post: {
        tags: ["Finance"],
        operationId: "purchaseGiftCard",
        summary: "Compra una tarjeta de regalo con el saldo de Flash Wallet",
        description:
          "El importe sale de la Wallet en el momento. Con `recipientEmail` de un cliente activo, " +
          "la tarjeta aparece en su Wallet para canjearla sin código; un email sin cuenta responde " +
          "igual. Con la verificación en dos pasos activa, pide `mfaCode`. `Idempotency-Key` es " +
          "obligatorio: repetirlo devuelve la misma tarjeta con 200.",
        security: [{ bearerAuth: [] }],
        parameters: [
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
                  amount: { type: "integer", minimum: 1000, description: "Pesos enteros" },
                  recipientEmail: { type: "string", format: "email" },
                  message: { type: "string", maxLength: 140 },
                  mfaCode: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          200: tarjeta,
          201: tarjeta,
          400: errorResponses[400],
          402: { description: "Saldo insuficiente en Flash Wallet", content: json },
          403: { description: "Falta el código de la verificación en dos pasos", content: json },
          ...comun,
        },
      },
    },
    "/api/gift-cards/redeem": {
      post: {
        tags: ["Finance"],
        operationId: "redeemGiftCardCode",
        summary: "Canjea una tarjeta de regalo con su código; el importe entra a la Wallet",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["code"],
                properties: { code: { type: "string", example: "ABCD-EFGH-JKLM-NPQR" } },
              },
            },
          },
        },
        responses: {
          200: tarjeta,
          400: errorResponses[400],
          404: { description: "El código no es de una tarjeta", content: json },
          409: {
            description: "Ya canjeada, anulada o comprada por la misma cuenta",
            content: json,
          },
          ...comun,
        },
      },
    },
    "/api/gift-cards/{giftCardId}/claim": {
      post: {
        tags: ["Finance"],
        operationId: "claimGiftCard",
        summary: "Canjea, sin código, una tarjeta dirigida a la cuenta",
        security: [{ bearerAuth: [] }],
        parameters: [giftCardId],
        responses: {
          200: tarjeta,
          404: { description: "No existe o es para otra cuenta", content: json },
          409: { description: "Ya canjeada o anulada", content: json },
          ...comun,
        },
      },
    },
    "/api/gift-cards/{giftCardId}/cancel": {
      post: {
        tags: ["Finance"],
        operationId: "cancelGiftCard",
        summary: "Quien la compró la anula mientras nadie la canjeó; el importe vuelve a su Wallet",
        security: [{ bearerAuth: [] }],
        parameters: [giftCardId],
        responses: {
          200: tarjeta,
          404: { description: "No existe o la compró otra cuenta", content: json },
          409: { description: "Ya canjeada o anulada", content: json },
          ...comun,
        },
      },
    },
  };
}
