import { json, errorResponses, success, bearerErrors, idempotencyHeader, body } from "./primitives.js";

export const mobilityFinancePaths = {
  "/api/payment-provider/client-configuration": {
    get: {
      tags: ["Payments"],
      operationId: "getPaymentClientConfiguration",
      summary: "Obtener configuración pública para tokenización",
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: "merchantId",
          in: "query",
          required: false,
          schema: { type: "string", maxLength: 100 },
        },
      ],
      responses: {
        200: success({ $ref: "#/components/schemas/PaymentClientConfigurationResponse" }),
        ...bearerErrors,
      },
    },
  },
  "/api/rides/options": {
    post: {
      tags: ["Mobility"],
      operationId: "quoteRideOptions",
      summary: "Cotizar todas las categorías de viaje",
      requestBody: body("RideQuoteRequest"),
      responses: {
        200: success({ $ref: "#/components/schemas/RideOptionsResponse" }),
        400: errorResponses[400],
        429: errorResponses[429],
        503: { description: "Proveedor o configuración no disponible", content: json },
      },
    },
  },
  "/api/rides": {
    post: {
      tags: ["Mobility"],
      operationId: "createRide",
      summary: "Solicitar o programar un viaje",
      security: [{ bearerAuth: [] }],
      parameters: [idempotencyHeader],
      requestBody: body("RideCreateRequest"),
      responses: { 200: success({ type: "object" }), ...bearerErrors },
    },
  },
  "/api/shipments/quote": {
    post: {
      tags: ["Shipments"],
      operationId: "quoteShipment",
      summary: "Cotizar un envío y sus protecciones",
      requestBody: body("ShipmentQuoteRequest"),
      responses: {
        200: success({ $ref: "#/components/schemas/QuoteResponse" }),
        400: errorResponses[400],
        429: errorResponses[429],
        503: { description: "Proveedor o configuración no disponible", content: json },
      },
    },
  },
  "/api/shipments": {
    post: {
      tags: ["Shipments"],
      operationId: "createShipment",
      summary: "Crear envío con cotización firmada",
      security: [{ bearerAuth: [] }],
      parameters: [idempotencyHeader],
      requestBody: body("ShipmentCreateRequest"),
      responses: { 200: success({ type: "object" }), ...bearerErrors },
    },
  },
  "/api/merchant/payouts/authorize": {
    post: {
      tags: ["Finance"],
      operationId: "authorizeMerchantPayout",
      summary: "Reautenticar y ligar autorización a un retiro",
      security: [{ bearerAuth: [] }],
      requestBody: body("PayoutAuthorizeRequest"),
      responses: {
        200: success({ $ref: "#/components/schemas/PayoutAuthorizationResponse" }),
        400: errorResponses[400],
        401: errorResponses[401],
        403: bearerErrors[403],
        429: errorResponses[429],
      },
    },
  },
  "/api/merchant/payouts": {
    post: {
      tags: ["Finance"],
      operationId: "requestMerchantPayout",
      summary: "Reservar retiro con autorización de un solo uso",
      security: [{ bearerAuth: [] }],
      parameters: [idempotencyHeader],
      requestBody: body("PayoutRequest"),
      responses: {
        201: success({ type: "object" }),
        400: errorResponses[400],
        401: errorResponses[401],
        403: bearerErrors[403],
        409: bearerErrors[409],
        429: errorResponses[429],
      },
    },
  },
  "/api/merchant/payment-provider": {
    get: {
      tags: ["Finance"],
      operationId: "getMerchantPaymentConnection",
      summary: "Consultar conexión PSP sin exponer tokens",
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "merchantId", in: "query", required: true, schema: { type: "string" } }],
      responses: {
        200: success({ $ref: "#/components/schemas/PaymentConnectionResponse" }),
        401: errorResponses[401],
        403: bearerErrors[403],
      },
    },
  },
  "/api/merchant/payment-provider/connect": {
    post: {
      tags: ["Finance"],
      operationId: "beginMerchantPaymentConnection",
      summary: "Crear state OAuth seller de un solo uso",
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["merchantId"],
              properties: { merchantId: { type: "string" } },
            },
          },
        },
      },
      responses: {
        200: success({ type: "object" }),
        401: errorResponses[401],
        403: bearerErrors[403],
        503: { description: "PSP no configurado", content: json },
      },
    },
  },
  "/api/merchant/payment-provider/disconnect": {
    post: {
      tags: ["Finance"],
      operationId: "disconnectMerchantPaymentConnection",
      summary: "Reautenticar, revocar y borrar credenciales seller",
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["merchantId", "password"],
              properties: {
                merchantId: { type: "string" },
                password: { type: "string", minLength: 4, maxLength: 128, writeOnly: true },
              },
            },
          },
        },
      },
      responses: {
        200: success({ $ref: "#/components/schemas/PaymentConnectionResponse" }),
        400: errorResponses[400],
        401: errorResponses[401],
        404: { description: "Conexión no encontrada", content: json },
        429: errorResponses[429],
      },
    },
  },
  "/api/payment-provider/mercadopago/callback": {
    get: {
      tags: ["Finance"],
      operationId: "completeMerchantPaymentConnection",
      summary: "Consumir callback OAuth seller",
      parameters: [
        { name: "code", in: "query", required: true, schema: { type: "string" } },
        { name: "state", in: "query", required: true, schema: { type: "string", minLength: 20 } },
      ],
      responses: {
        303: { description: "Redirección al portal sin credenciales" },
        429: errorResponses[429],
        502: { description: "Proveedor no disponible", content: json },
      },
    },
  },
  "/api/webhooks/mercadopago": {
    post: {
      tags: ["Finance"],
      operationId: "receiveMercadoPagoWebhook",
      summary: "Validar firma y deduplicar notificación PSP",
      parameters: [
        { name: "data.id", in: "query", required: true, schema: { type: "string" } },
        { name: "x-signature", in: "header", required: true, schema: { type: "string" } },
        { name: "x-request-id", in: "header", required: true, schema: { type: "string" } },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/MercadoPagoWebhook" } },
        },
      },
      responses: {
        200: { description: "Duplicado reconocido" },
        201: { description: "Evento firmado persistido" },
        400: errorResponses[400],
        401: errorResponses[401],
        503: { description: "Secret o PostgreSQL no disponible", content: json },
      },
    },
  },
  "/api/jobs/{jobId}/receipt": {
    get: {
      tags: ["Activity"],
      operationId: "getServiceReceipt",
      summary: "Obtener comprobante no fiscal de un servicio finalizado",
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "jobId", in: "path", required: true, schema: { type: "string", minLength: 3 } },
      ],
      responses: {
        200: success({ $ref: "#/components/schemas/ServiceReceiptResponse" }),
        401: errorResponses[401],
        403: bearerErrors[403],
        404: { description: "Servicio inexistente o ajeno", content: json },
        409: { description: "Servicio todavía no finalizado", content: json },
        503: { description: "Requiere PostgreSQL", content: json },
      },
    },
  },
  "/api/public/rides/track/{token}": {
    get: {
      tags: ["Tracking"],
      operationId: "getPublicRideTracking",
      summary: "Consultar estado mínimo mediante enlace temporal",
      parameters: [
        {
          name: "token",
          in: "path",
          required: true,
          schema: { type: "string", pattern: "^[A-Za-z0-9_-]{40,64}$", writeOnly: true },
        },
      ],
      responses: {
        200: success({ $ref: "#/components/schemas/PublicRideTrackingResponse" }),
        404: { description: "Enlace inexistente, vencido o revocado", content: json },
        429: errorResponses[429],
      },
    },
  },
  "/api/rides/{rideId}/tracking-links": {
    post: {
      tags: ["Tracking"],
      operationId: "createRideTrackingLink",
      summary: "Crear enlace temporal para un viaje propio",
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "rideId", in: "path", required: true, schema: { type: "string", minLength: 3 } },
      ],
      requestBody: body("RideTrackingLinkRequest"),
      responses: {
        201: success({ $ref: "#/components/schemas/RideTrackingLinkResponse" }),
        400: errorResponses[400],
        401: errorResponses[401],
        403: bearerErrors[403],
        404: { description: "Viaje inexistente o ajeno", content: json },
        429: errorResponses[429],
      },
    },
  },
  "/api/rides/{rideId}/tracking-links/{linkId}": {
    delete: {
      tags: ["Tracking"],
      operationId: "revokeRideTrackingLink",
      summary: "Revocar un enlace temporal propio",
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "rideId", in: "path", required: true, schema: { type: "string", minLength: 3 } },
        { name: "linkId", in: "path", required: true, schema: { type: "string", minLength: 3 } },
      ],
      responses: {
        200: success({ type: "object" }),
        401: errorResponses[401],
        403: bearerErrors[403],
        404: { description: "Enlace inexistente o ajeno", content: json },
        429: errorResponses[429],
      },
    },
  },
};
