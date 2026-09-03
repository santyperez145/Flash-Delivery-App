import {
  json,
  errorResponses,
  success,
  bearerErrors,
  idempotencyHeader,
  body,
  operationsPageParameters,
} from "./primitives.js";

export const dispatchOperationsPaths = {
  "/api/driver/offers": {
    get: {
      tags: ["Dispatch"],
      operationId: "listDriverOffers",
      summary: "Listar ofertas privadas vigentes del conductor",
      security: [{ bearerAuth: [] }],
      responses: {
        200: success({ $ref: "#/components/schemas/DispatchOffersResponse" }),
        400: errorResponses[400],
        401: errorResponses[401],
        403: bearerErrors[403],
        429: errorResponses[429],
      },
    },
  },
  "/api/driver/demand-zones": {
    get: {
      tags: ["Driver"],
      operationId: "getDriverDemandZones",
      summary: "Obtener actividad operativa agregada por zona",
      description:
        "Compara trabajos abiertos sin asignar con conductores realmente elegibles y ubicación reciente. No pronostica pedidos, ganancias ni modifica precios.",
      security: [{ bearerAuth: [] }],
      responses: {
        200: success({ $ref: "#/components/schemas/DriverDemandResponse" }),
        401: errorResponses[401],
        403: bearerErrors[403],
        404: { description: "Perfil de conductor inexistente", content: json },
        429: errorResponses[429],
        503: { description: "Requiere PostgreSQL/PostGIS", content: json },
      },
    },
  },
  "/api/driver/earnings": {
    get: {
      tags: ["Finance"],
      operationId: "getDriverEarnings",
      summary: "Obtener ganancias propias calculadas desde el ledger",
      description:
        "Corta día, semana y serie diaria en la zona horaria del conductor; incluye servicios, propinas, ajustes y tiempo operativo observados. No habilita retiros.",
      security: [{ bearerAuth: [] }],
      responses: {
        200: success({ $ref: "#/components/schemas/DriverEarningsResponse" }),
        401: errorResponses[401],
        403: bearerErrors[403],
        404: { description: "Perfil de conductor inexistente", content: json },
        429: errorResponses[429],
      },
    },
  },
  "/api/merchant/dashboard": {
    get: {
      tags: ["Merchant Operations"],
      operationId: "getMerchantOperationsDashboard",
      summary: "Obtener operación privada del comercio",
      description:
        "Métricas del día local y cola activa calculadas en PostgreSQL. Los plazos históricos sin snapshot se informan como no observados en vez de estimarse.",
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: "restaurantId",
          in: "query",
          required: false,
          description:
            "Selecciona un comercio propio; operaciones admin también puede seleccionar cualquier comercio autorizado.",
          schema: { type: "string", maxLength: 100 },
        },
      ],
      responses: {
        200: success({ $ref: "#/components/schemas/MerchantDashboardResponse" }),
        401: errorResponses[401],
        403: bearerErrors[403],
        404: { description: "Comercio inexistente o ajeno", content: json },
        429: errorResponses[429],
      },
    },
  },
  "/api/merchant/orders/active": {
    get: {
      tags: ["Merchant Operations"],
      operationId: "listMerchantActiveOrders",
      summary: "Listar cola activa autoritativa del comercio",
      description:
        "Devuelve pedidos no terminales priorizados por responsabilidad operativa y plazo. No depende de la actividad parcial descargada por el cliente.",
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: "restaurantId",
          in: "query",
          required: true,
          schema: { type: "string", minLength: 1, maxLength: 100 },
        },
        {
          name: "limit",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1, maximum: 100, default: 100 },
        },
      ],
      responses: {
        200: success({ $ref: "#/components/schemas/MerchantActiveOrdersResponse" }),
        400: errorResponses[400],
        401: errorResponses[401],
        403: bearerErrors[403],
        404: { description: "Comercio inexistente o ajeno", content: json },
        429: errorResponses[429],
      },
    },
  },
  "/api/orders/{orderId}/substitutions": {
    get: {
      tags: ["Merchant Operations"],
      operationId: "listOrderSubstitutions",
      summary: "Listar sustituciones visibles del pedido",
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: "orderId",
          in: "path",
          required: true,
          schema: { type: "string", minLength: 3, maxLength: 100 },
        },
      ],
      responses: {
        200: success({ $ref: "#/components/schemas/OrderSubstitutionsResponse" }),
        401: errorResponses[401],
        403: bearerErrors[403],
        429: errorResponses[429],
      },
    },
    post: {
      tags: ["Merchant Operations"],
      operationId: "proposeOrderSubstitution",
      summary: "Proponer sustitución con inventario y precio validados",
      description:
        "Sólo Comercio u Operaciones puede proponer durante preparación. " +
        "El original debe estar agotado y el reemplazo debe tener stock suficiente " +
        "en la sucursal, ser distinto y no superar el precio original.",
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: "orderId",
          in: "path",
          required: true,
          schema: { type: "string", minLength: 3, maxLength: 100 },
        },
      ],
      requestBody: body("OrderSubstitutionProposal"),
      responses: {
        201: success({ $ref: "#/components/schemas/OrderSubstitutionResponse" }),
        400: errorResponses[400],
        401: errorResponses[401],
        403: bearerErrors[403],
        404: { description: "Pedido, producto o comercio no disponible", content: json },
        409: {
          description: "Inventario, precio, etapa o sustitución pendiente inválidos",
          content: json,
        },
        429: errorResponses[429],
      },
    },
  },
  "/api/order-substitutions/{substitutionId}": {
    patch: {
      tags: ["Commerce"],
      operationId: "decideOrderSubstitution",
      summary: "Aceptar o rechazar una sustitución propia",
      description:
        "La decisión pertenece al cliente. La aceptación actualiza el snapshot y reintegra por Wallet la diferencia exacta en una transacción balanceada.",
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: "substitutionId",
          in: "path",
          required: true,
          schema: { type: "string", minLength: 3, maxLength: 100 },
        },
      ],
      requestBody: body("OrderSubstitutionDecision"),
      responses: {
        200: success({ $ref: "#/components/schemas/OrderSubstitutionResponse" }),
        400: errorResponses[400],
        401: errorResponses[401],
        403: bearerErrors[403],
        409: { description: "Sustitución ajena, decidida o fuera de etapa", content: json },
        429: errorResponses[429],
      },
    },
  },
  "/api/driver/preferences": {
    get: {
      tags: ["Driver"],
      operationId: "getDriverPreferences",
      summary: "Obtener preferencias operativas propias",
      security: [{ bearerAuth: [] }],
      responses: {
        200: success({ $ref: "#/components/schemas/DriverPreferencesResponse" }),
        401: errorResponses[401],
        403: bearerErrors[403],
        404: { description: "Perfil de conductor inexistente", content: json },
        429: errorResponses[429],
      },
    },
    patch: {
      tags: ["Driver"],
      operationId: "updateDriverPreferences",
      summary: "Actualizar proveedor de navegación externa",
      description:
        "La preferencia sólo controla el handoff; no altera ruta, destino ni estado del trabajo.",
      security: [{ bearerAuth: [] }],
      requestBody: body("DriverPreferencesInput"),
      responses: {
        200: success({ $ref: "#/components/schemas/DriverPreferencesResponse" }),
        400: errorResponses[400],
        401: errorResponses[401],
        403: bearerErrors[403],
        404: { description: "Perfil de conductor inexistente", content: json },
        429: errorResponses[429],
      },
    },
  },
  "/api/driver/offers/{offerId}/reject": {
    post: {
      tags: ["Dispatch"],
      operationId: "rejectDriverOffer",
      summary: "Rechazar una oferta propia todavía vigente",
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "offerId", in: "path", required: true, schema: { type: "string", minLength: 3 } },
      ],
      requestBody: {
        required: false,
        content: {
          "application/json": { schema: { type: "object", additionalProperties: false } },
        },
      },
      responses: {
        200: success({
          type: "object",
          required: ["ok", "requestId", "rejected"],
          properties: {
            ok: { const: true },
            requestId: { type: "string" },
            rejected: { const: true },
          },
        }),
        400: errorResponses[400],
        401: errorResponses[401],
        403: bearerErrors[403],
        409: { description: "Oferta inexistente, vencida o resuelta", content: json },
        429: errorResponses[429],
      },
    },
  },
  "/api/support/tickets": {
    get: {
      tags: ["Support"],
      operationId: "listSupportTickets",
      summary: "Listar tickets visibles para la identidad",
      security: [{ bearerAuth: [] }],
      responses: {
        200: success({ $ref: "#/components/schemas/SupportTicketsResponse" }),
        401: errorResponses[401],
        429: errorResponses[429],
      },
    },
    post: {
      tags: ["Support"],
      operationId: "createSupportTicket",
      summary: "Crear ticket persistente y auditable",
      security: [{ bearerAuth: [] }],
      parameters: [idempotencyHeader],
      requestBody: body("SupportTicketCreateRequest"),
      responses: {
        201: success({ $ref: "#/components/schemas/SupportTicketResponse" }),
        400: errorResponses[400],
        401: errorResponses[401],
        409: {
          description: "Clave reutilizada con otro payload o solicitud en proceso",
          content: json,
        },
        429: errorResponses[429],
        503: { description: "Soporte real requiere PostgreSQL", content: json },
      },
    },
  },
  "/api/support/tickets/{ticketId}/messages": {
    post: {
      tags: ["Support"],
      operationId: "addSupportMessage",
      summary: "Agregar mensaje a un ticket visible",
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "ticketId", in: "path", required: true, schema: { type: "string", minLength: 3 } },
        idempotencyHeader,
      ],
      requestBody: body("SupportMessageRequest"),
      responses: {
        200: success({ $ref: "#/components/schemas/SupportTicketResponse" }),
        400: errorResponses[400],
        401: errorResponses[401],
        403: bearerErrors[403],
        404: { description: "Ticket inexistente o ajeno", content: json },
        409: {
          description: "Clave reutilizada con otro mensaje o escritura en proceso",
          content: json,
        },
        429: errorResponses[429],
        503: { description: "Soporte real requiere PostgreSQL", content: json },
      },
    },
  },
  "/api/support/tickets/{ticketId}": {
    patch: {
      tags: ["Support"],
      operationId: "updateSupportTicket",
      summary: "Actualizar estado, prioridad o asignación como agente",
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "ticketId", in: "path", required: true, schema: { type: "string", minLength: 3 } },
      ],
      requestBody: body("SupportTicketUpdateRequest"),
      responses: {
        200: success({ $ref: "#/components/schemas/SupportTicketResponse" }),
        400: errorResponses[400],
        401: errorResponses[401],
        403: bearerErrors[403],
        404: { description: "Ticket inexistente", content: json },
        429: errorResponses[429],
      },
    },
  },
  "/api/operations/restaurants": {
    get: {
      tags: ["Operations"],
      operationId: "listOperationsRestaurants",
      summary: "Paginar comercios para backoffice",
      security: [{ bearerAuth: [] }],
      parameters: operationsPageParameters,
      responses: {
        200: success({ $ref: "#/components/schemas/OperationsPageResponse" }),
        400: errorResponses[400],
        401: errorResponses[401],
        403: bearerErrors[403],
        429: errorResponses[429],
      },
    },
  },
  "/api/operations/drivers": {
    get: {
      tags: ["Operations"],
      operationId: "listOperationsDrivers",
      summary: "Paginar conductores para backoffice",
      security: [{ bearerAuth: [] }],
      parameters: operationsPageParameters,
      responses: {
        200: success({ $ref: "#/components/schemas/OperationsPageResponse" }),
        400: errorResponses[400],
        401: errorResponses[401],
        403: bearerErrors[403],
        429: errorResponses[429],
      },
    },
  },
  "/api/operations/users": {
    get: {
      tags: ["Operations"],
      operationId: "listOperationsUsers",
      summary: "Paginar usuarios para backoffice",
      security: [{ bearerAuth: [] }],
      parameters: operationsPageParameters,
      responses: {
        200: success({ $ref: "#/components/schemas/OperationsPageResponse" }),
        400: errorResponses[400],
        401: errorResponses[401],
        403: bearerErrors[403],
        429: errorResponses[429],
      },
    },
  },
  "/api/operations/support-tickets": {
    get: {
      tags: ["Operations"],
      operationId: "listOperationsSupportTickets",
      summary: "Paginar mesa de ayuda completa",
      security: [{ bearerAuth: [] }],
      parameters: operationsPageParameters,
      responses: {
        200: success({ $ref: "#/components/schemas/OperationsPageResponse" }),
        400: errorResponses[400],
        401: errorResponses[401],
        403: bearerErrors[403],
        429: errorResponses[429],
      },
    },
  },
  "/api/operations/audit-events": {
    get: {
      tags: ["Operations"],
      operationId: "listOperationsAuditEvents",
      summary: "Paginar auditoría sanitizada",
      security: [{ bearerAuth: [] }],
      parameters: operationsPageParameters,
      responses: {
        200: success({ $ref: "#/components/schemas/OperationsPageResponse" }),
        400: errorResponses[400],
        401: errorResponses[401],
        403: bearerErrors[403],
        429: errorResponses[429],
      },
    },
  },
  "/api/operations/feature-flags": {
    get: {
      tags: ["Operations"],
      operationId: "listFeatureFlags",
      summary: "Listar configuración de rollout",
      security: [{ bearerAuth: [] }],
      responses: {
        200: success({ $ref: "#/components/schemas/FeatureFlagsResponse" }),
        401: errorResponses[401],
        403: bearerErrors[403],
        429: errorResponses[429],
      },
    },
  },
  "/api/operations/feature-flags/{flagId}": {
    patch: {
      tags: ["Operations"],
      operationId: "updateFeatureFlag",
      summary: "Actualizar rollout con auditoría",
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "flagId", in: "path", required: true, schema: { type: "string", minLength: 3 } },
      ],
      requestBody: body("FeatureFlagUpdateRequest"),
      responses: {
        200: success({ $ref: "#/components/schemas/FeatureFlagResponse" }),
        400: errorResponses[400],
        401: errorResponses[401],
        403: bearerErrors[403],
        404: { description: "Feature flag inexistente", content: json },
        429: errorResponses[429],
      },
    },
  },
  "/api/operations/product-metrics": {
    get: {
      tags: ["Operations"],
      operationId: "getProductMetrics",
      summary: "Obtener embudo agregado sin PII",
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: "days",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1, maximum: 90, default: 7 },
        },
      ],
      responses: {
        200: success({ type: "object" }),
        401: errorResponses[401],
        403: bearerErrors[403],
        429: errorResponses[429],
      },
    },
  },
  "/api/operations/zones/{zoneId}/readiness": {
    get: {
      tags: ["Operations"],
      operationId: "getZoneReadiness",
      summary: "Evaluar condiciones reales para habilitar una zona",
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "zoneId", in: "path", required: true, schema: { type: "string", minLength: 3 } },
      ],
      responses: {
        200: success({ type: "object" }),
        401: errorResponses[401],
        403: bearerErrors[403],
        404: { description: "Zona inexistente", content: json },
        429: errorResponses[429],
      },
    },
  },
  "/api/operations/zones/{zoneId}/readiness-assessments": {
    post: {
      tags: ["Operations"],
      operationId: "createZoneReadinessAssessment",
      summary: "Persistir decisión de readiness auditable",
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "zoneId", in: "path", required: true, schema: { type: "string", minLength: 3 } },
      ],
      requestBody: {
        required: false,
        content: {
          "application/json": { schema: { type: "object", additionalProperties: false } },
        },
      },
      responses: {
        201: success({ type: "object" }),
        401: errorResponses[401],
        403: bearerErrors[403],
        404: { description: "Zona inexistente", content: json },
        429: errorResponses[429],
      },
    },
  },
  "/api/dietary-preferences": {
    get: {
      tags: ["Dietary"],
      operationId: "getDietaryPreferences",
      summary: "Obtener preferencias alimentarias propias",
      security: [{ bearerAuth: [] }],
      responses: {
        200: success({ $ref: "#/components/schemas/DietaryPreferencesResponse" }),
        401: errorResponses[401],
        404: { description: "Usuario inexistente", content: json },
        429: errorResponses[429],
      },
    },
    put: {
      tags: ["Dietary"],
      operationId: "updateDietaryPreferences",
      summary: "Reemplazar preferencias alimentarias propias",
      security: [{ bearerAuth: [] }],
      requestBody: body("DietaryPreferencesInput"),
      responses: {
        200: success({ $ref: "#/components/schemas/DietaryPreferencesResponse" }),
        400: errorResponses[400],
        401: errorResponses[401],
        404: { description: "Usuario inexistente", content: json },
        429: errorResponses[429],
        503: { description: "Requiere PostgreSQL", content: json },
      },
    },
  },
  "/api/restaurants/{restaurantId}/menu/{itemId}/dietary": {
    put: {
      tags: ["Dietary"],
      operationId: "replaceCatalogItemDietary",
      summary: "Reemplazar declaraciones normalizadas de un producto propio",
      description:
        "La ausencia de una declaración nunca implica que el producto sea seguro para alergias.",
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: "restaurantId",
          in: "path",
          required: true,
          schema: { type: "string", minLength: 3 },
        },
        { name: "itemId", in: "path", required: true, schema: { type: "string", minLength: 3 } },
      ],
      requestBody: body("CatalogItemDietaryInput"),
      responses: {
        200: success({ type: "object" }),
        400: errorResponses[400],
        401: errorResponses[401],
        403: bearerErrors[403],
        404: { description: "Producto inexistente o ajeno", content: json },
        429: errorResponses[429],
        503: { description: "Requiere PostgreSQL", content: json },
      },
    },
  },
};
