const json = { "application/json": { schema: { $ref: "#/components/schemas/Error" } } };
const errorResponses = {
  400: { description: "Solicitud inválida", content: json },
  401: { description: "Autenticación ausente, inválida o vencida", content: json },
  429: { description: "Límite de solicitudes excedido", content: json },
  500: { description: "Error interno", content: json },
};
const success = (schema, description = "Operación exitosa") => ({
  description,
  content: { "application/json": { schema } },
});

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Flash Platform API",
    version: "0.1.0",
    description:
      "Contrato incremental del núcleo operativo. La ausencia de una ruta en este documento significa que todavía no tiene cobertura OpenAPI y no que esté lista para terceros.",
  },
  servers: [{ url: "/", description: "Mismo origen" }],
  tags: [
    { name: "Platform", description: "Estado técnico y expansión geográfica" },
    { name: "Auth", description: "Identidad y ciclo de sesiones rotativas" },
  ],
  paths: {
    "/api/health": {
      get: {
        tags: ["Platform"],
        operationId: "getHealth",
        summary: "Liveness del proceso",
        responses: { 200: success({ $ref: "#/components/schemas/HealthResponse" }) },
      },
    },
    "/api/ready": {
      get: {
        tags: ["Platform"],
        operationId: "getReadiness",
        summary: "Readiness de dependencias",
        responses: {
          200: success({ $ref: "#/components/schemas/ReadyResponse" }),
          503: {
            description: "Dependencia requerida o postura de privilegios no disponible",
            content: json,
          },
        },
      },
    },
    "/api/cities": {
      get: {
        tags: ["Platform"],
        operationId: "listCities",
        summary: "Ciudades públicamente habilitadas",
        responses: {
          200: success({ $ref: "#/components/schemas/CitiesResponse" }),
          500: errorResponses[500],
        },
      },
    },
    "/api/zones": {
      get: {
        tags: ["Platform"],
        operationId: "listZones",
        summary: "Zonas públicas de una ciudad",
        parameters: [
          {
            name: "city",
            in: "query",
            required: false,
            schema: { type: "string", pattern: "^[a-z0-9-]{2,40}$", default: "buenos-aires" },
          },
        ],
        responses: {
          200: success({ $ref: "#/components/schemas/ZonesResponse" }),
          400: errorResponses[400],
          404: { description: "Ciudad no habilitada", content: json },
          500: errorResponses[500],
        },
      },
    },
    "/api/auth/login": {
      post: {
        tags: ["Auth"],
        operationId: "login",
        summary: "Iniciar sesión",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/LoginRequest" } },
          },
        },
        responses: {
          200: success({ $ref: "#/components/schemas/AuthResponse" }),
          400: errorResponses[400],
          401: errorResponses[401],
          403: { description: "Email pendiente de verificación", content: json },
          429: errorResponses[429],
        },
      },
    },
    "/api/auth/register": {
      post: {
        tags: ["Auth"],
        operationId: "register",
        summary: "Crear una cuenta customer",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/RegisterRequest" } },
          },
        },
        responses: {
          200: success({ $ref: "#/components/schemas/RegisterResponse" }),
          400: errorResponses[400],
          409: { description: "Email existente", content: json },
          429: errorResponses[429],
        },
      },
    },
    "/api/auth/refresh": {
      post: {
        tags: ["Auth"],
        operationId: "refreshSession",
        summary: "Rotar refresh token",
        security: [{ cookieAuth: [] }, {}],
        description:
          "Web usa cookie HttpOnly y X-Flash-Client: web; clientes nativos envían refreshToken en JSON.",
        requestBody: {
          required: false,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/RefreshRequest" } },
          },
        },
        responses: {
          200: success({ $ref: "#/components/schemas/AuthResponse" }),
          400: errorResponses[400],
          401: errorResponses[401],
          429: errorResponses[429],
        },
      },
    },
    "/api/auth/logout": {
      post: {
        tags: ["Auth"],
        operationId: "logout",
        summary: "Revocar una sesión",
        security: [{ cookieAuth: [] }, {}],
        requestBody: {
          required: false,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/RefreshTokenRequest" } },
          },
        },
        responses: {
          200: success({
            type: "object",
            required: ["ok", "requestId", "loggedOut"],
            properties: {
              ok: { const: true },
              requestId: { type: "string" },
              loggedOut: { const: true },
            },
          }),
          400: errorResponses[400],
          429: errorResponses[429],
        },
      },
    },
    "/api/me/sessions": {
      get: {
        tags: ["Auth"],
        operationId: "listSessions",
        summary: "Inventario de sesiones propias",
        security: [{ bearerAuth: [] }],
        responses: {
          200: success({
            type: "object",
            required: ["ok", "requestId", "sessions"],
            properties: {
              ok: { const: true },
              requestId: { type: "string" },
              sessions: { type: "array", items: { $ref: "#/components/schemas/Session" } },
            },
          }),
          401: errorResponses[401],
          429: errorResponses[429],
        },
      },
    },
    "/api/me/phone-verification/request": {
      post: {
        tags: ["Auth"],
        operationId: "requestPhoneVerification",
        summary: "Enviar OTP al teléfono guardado",
        security: [{ bearerAuth: [] }],
        responses: {
          200: success({ $ref: "#/components/schemas/PhoneVerificationRequestResponse" }),
          401: errorResponses[401],
          409: { description: "Teléfono ausente o ya verificado", content: json },
          429: errorResponses[429],
          503: { description: "Proveedor no configurado", content: json },
        },
      },
    },
    "/api/me/phone-verification/confirm": {
      post: {
        tags: ["Auth"],
        operationId: "confirmPhoneVerification",
        summary: "Confirmar posesión del teléfono",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["code"],
                properties: { code: { type: "string", pattern: "^[0-9]{6}$", writeOnly: true } },
              },
            },
          },
        },
        responses: {
          200: success({
            type: "object",
            required: ["ok", "requestId", "verified", "phone"],
            properties: {
              ok: { const: true },
              requestId: { type: "string" },
              verified: { const: true },
              phone: { type: "string" },
            },
          }),
          400: errorResponses[400],
          401: errorResponses[401],
          429: errorResponses[429],
        },
      },
    },
    "/api/me/sessions/{sessionId}": {
      delete: {
        tags: ["Auth"],
        operationId: "revokeSession",
        summary: "Revocar una sesión propia",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "sessionId",
            in: "path",
            required: true,
            schema: { type: "string", minLength: 3 },
          },
        ],
        responses: {
          200: success({ type: "object" }),
          401: errorResponses[401],
          404: { description: "Sesión no encontrada", content: json },
          429: errorResponses[429],
          503: { description: "Requiere PostgreSQL", content: json },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "__Host-flash_refresh",
        description: "Cookie web productiva HttpOnly, Secure y SameSite=Strict.",
      },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["ok", "requestId", "message"],
        properties: {
          ok: { const: false },
          requestId: { type: "string" },
          message: { type: "string" },
        },
      },
      Coordinate: {
        type: "object",
        required: ["lat", "lng"],
        properties: {
          lat: { type: "number", minimum: -90, maximum: 90 },
          lng: { type: "number", minimum: -180, maximum: 180 },
        },
      },
      HealthResponse: {
        type: "object",
        required: ["ok", "requestId", "service", "environment", "storageMode", "timestamp"],
        properties: {
          ok: { const: true },
          requestId: { type: "string" },
          service: { const: "flash-fullstack-api" },
          environment: { enum: ["development", "test", "production"] },
          storageMode: { enum: ["postgres-primary", "sqlite-demo"] },
          timestamp: { type: "string", format: "date-time" },
        },
      },
      ReadyResponse: {
        type: "object",
        required: ["ok", "requestId", "service", "database", "redis", "runtimeStore"],
        properties: {
          ok: { const: true },
          requestId: { type: "string" },
          service: { type: "string" },
          database: { type: "object" },
          redis: { type: "object" },
          runtimeStore: { type: "string" },
        },
      },
      City: {
        type: "object",
        required: [
          "id",
          "slug",
          "name",
          "countryCode",
          "currency",
          "timezone",
          "status",
          "enabledServices",
          "center",
        ],
        properties: {
          id: { type: "string" },
          slug: { type: "string" },
          name: { type: "string" },
          countryCode: { type: "string", minLength: 2, maxLength: 2 },
          currency: { type: "string", minLength: 3, maxLength: 3 },
          timezone: { type: "string" },
          status: { enum: ["beta", "active"] },
          enabledServices: { type: "array", items: { type: "string" } },
          center: { $ref: "#/components/schemas/Coordinate" },
        },
      },
      CitiesResponse: {
        type: "object",
        required: ["ok", "requestId", "cities"],
        properties: {
          ok: { const: true },
          requestId: { type: "string" },
          cities: { type: "array", items: { $ref: "#/components/schemas/City" } },
        },
      },
      ZonesResponse: {
        type: "object",
        required: ["ok", "requestId", "city", "zones"],
        properties: {
          ok: { const: true },
          requestId: { type: "string" },
          city: { type: "string" },
          zones: { type: "array", items: { type: "object" } },
        },
      },
      User: {
        type: "object",
        required: ["id", "name", "email", "roles"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          email: { type: "string", format: "email" },
          roles: {
            type: "array",
            items: { enum: ["customer", "merchant", "driver", "admin", "support", "auditor"] },
          },
          phone: { type: "string", pattern: "^\\+[1-9][0-9]{7,14}$" },
          phoneVerifiedAt: { type: ["string", "null"], format: "date-time" },
        },
      },
      LoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 4 },
          deviceName: { type: "string", maxLength: 160 },
          audience: {
            enum: ["customer", "driver", "merchant"],
            description:
              "Variante nativa solicitante; el servidor valida el rol antes de emitir sesión.",
          },
        },
      },
      RegisterRequest: {
        type: "object",
        required: ["name", "email", "password"],
        properties: {
          name: { type: "string", minLength: 2 },
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 8, maxLength: 128, format: "password" },
          phone: { type: "string", maxLength: 30 },
          deviceName: { type: "string", maxLength: 160 },
        },
      },
      RefreshTokenRequest: {
        type: "object",
        required: ["refreshToken"],
        properties: { refreshToken: { type: "string", minLength: 32, writeOnly: true } },
      },
      RefreshRequest: {
        type: "object",
        properties: {
          refreshToken: {
            type: "string",
            minLength: 32,
            writeOnly: true,
            description: "Sólo clientes nativos.",
          },
          deviceName: { type: "string", maxLength: 160 },
        },
      },
      AuthResponse: {
        type: "object",
        required: ["ok", "requestId", "user"],
        properties: {
          ok: { const: true },
          requestId: { type: "string" },
          user: { $ref: "#/components/schemas/User" },
          token: { type: "string", writeOnly: true },
          refreshToken: { type: "string", writeOnly: true },
          refreshExpiresAt: { type: "string", format: "date-time" },
          mfaRequired: { type: "boolean" },
          mfaChallenge: { type: "string", writeOnly: true },
        },
      },
      RegisterResponse: {
        type: "object",
        required: ["ok", "requestId", "user"],
        properties: {
          ok: { const: true },
          requestId: { type: "string" },
          user: { $ref: "#/components/schemas/User" },
          verificationRequired: { type: "boolean" },
        },
      },
      Session: {
        type: "object",
        required: ["id", "deviceName", "createdAt", "expiresAt"],
        properties: {
          id: { type: "string" },
          deviceName: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          expiresAt: { type: "string", format: "date-time" },
        },
      },
      PhoneVerificationRequestResponse: {
        type: "object",
        required: ["ok", "requestId", "expiresAt", "retryAfterSeconds"],
        properties: {
          ok: { const: true },
          requestId: { type: "string" },
          expiresAt: { type: "string", format: "date-time" },
          retryAfterSeconds: { type: "integer", minimum: 30 },
          developmentCode: {
            type: "string",
            pattern: "^[0-9]{6}$",
            writeOnly: true,
            description: "Sólo sandbox fuera de producción.",
          },
        },
      },
    },
  },
};

const bearerErrors = {
  400: errorResponses[400],
  401: errorResponses[401],
  403: { description: "La identidad no puede actuar por el customer solicitado", content: json },
  409: { description: "Cotización vencida o no correspondiente", content: json },
  429: errorResponses[429],
};
const idempotencyHeader = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  description: "Clave única por intento lógico; 16 a 128 caracteres ASCII seguros.",
  schema: { type: "string", pattern: "^[a-zA-Z0-9._:-]{16,128}$" },
};
const operationsPageParameters = [
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
const groupResponse = {
  type: "object",
  required: ["group"],
  properties: { group: { $ref: "#/components/schemas/GroupOrder" } },
};
const body = (schema) => ({
  required: true,
  content: { "application/json": { schema: { $ref: `#/components/schemas/${schema}` } } },
});

Object.assign(openApiDocument.paths, {
  "/api/orders/quote": {
    post: {
      tags: ["Commerce"],
      operationId: "quoteFoodOrder",
      summary: "Cotizar carrito y última milla",
      security: [{ bearerAuth: [] }],
      requestBody: body("FoodQuoteRequest"),
      responses: {
        200: success({ $ref: "#/components/schemas/QuoteResponse" }),
        ...bearerErrors,
        503: { description: "La cotización geográfica requiere PostgreSQL", content: json },
      },
    },
  },
  "/api/orders": {
    post: {
      tags: ["Commerce"],
      operationId: "createFoodOrder",
      summary: "Crear pedido con cotización firmada",
      security: [{ bearerAuth: [] }],
      parameters: [idempotencyHeader],
      requestBody: body("FoodOrderRequest"),
      responses: { 200: success({ type: "object" }), ...bearerErrors },
    },
  },
  // Suscripcion de Flash (GTM-001). Va en el contrato publico porque es una
  // relacion recurrente con la persona: quien integre o audite la API tiene que
  // poder ver que se cobra, que devuelve y como se da de baja.
  // Mover el horario de un servicio reservado (GTM-001). Vale para pedidos y
  // viajes: los dos son trabajos con horario, y una ruta por servicio serian dos
  // versiones de la misma politica de cuando se puede mover algo.
  "/api/jobs/{jobId}/schedule": {
    patch: {
      tags: ["Commerce"],
      operationId: "rescheduleJob",
      summary: "Mover el horario de un servicio reservado",
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "jobId", in: "path", required: true, schema: { type: "string", maxLength: 100 } },
      ],
      requestBody: body("RescheduleRequest"),
      responses: {
        200: success({
          type: "object",
          required: ["job"],
          properties: {
            job: {
              type: "object",
              required: ["id", "scheduledFor", "previousScheduledFor"],
              properties: {
                id: { type: "string" },
                kind: { type: "string" },
                status: { type: "string" },
                // Se devuelve el horario anterior: quien reprograma tiene que
                // poder ver desde donde se movio, y sin esto la pantalla tendria
                // que recordarlo por su cuenta.
                previousScheduledFor: { type: "string", format: "date-time" },
                scheduledFor: { type: "string", format: "date-time" },
                version: { type: "integer" },
              },
            },
          },
        }),
        ...bearerErrors,
        // 409, no 403: el servicio es tuyo y existe, lo que ya no se puede es
        // moverlo. El comercio empezo a cocinar o hay un conductor en camino, y
        // ahi la salida correcta es cancelar con su politica, no mover la hora.
        409: {
          description: "El servicio no esta reservado o ya esta en curso",
          content: json,
        },
      },
    },
  },
  // Pedidos grupales (GTM-001). Se publica el ciclo entero porque es una
  // relacion entre varias personas y un comercio: quien integre tiene que poder
  // ver quien puede hacer que, y sobre todo que **confirmar no vive aca** — el
  // grupo cerrado se convierte en un pedido normal por /api/orders.
  "/api/group-orders": {
    get: {
      tags: ["Commerce"],
      operationId: "listGroupOrders",
      summary: "Listar los pedidos grupales propios abiertos",
      security: [{ bearerAuth: [] }],
      responses: {
        200: success({
          type: "object",
          required: ["groups"],
          properties: {
            groups: { type: "array", items: { $ref: "#/components/schemas/GroupOrder" } },
          },
        }),
        ...bearerErrors,
      },
    },
    post: {
      tags: ["Commerce"],
      operationId: "createGroupOrder",
      summary: "Abrir un pedido grupal en un comercio",
      security: [{ bearerAuth: [] }],
      requestBody: body("GroupOrderCreateRequest"),
      responses: { 200: success(groupResponse), ...bearerErrors },
    },
  },
  // Sumarse no lleva el id del grupo: quien comparte un enlace comparte el
  // codigo, no la direccion interna de nada.
  "/api/group-orders/join": {
    post: {
      tags: ["Commerce"],
      operationId: "joinGroupOrder",
      summary: "Sumarse a un pedido grupal con su codigo",
      security: [{ bearerAuth: [] }],
      requestBody: body("GroupOrderJoinRequest"),
      responses: {
        200: success(groupResponse),
        ...bearerErrors,
        409: { description: "El grupo ya esta cerrado o vencido", content: json },
      },
    },
  },
  "/api/group-orders/{groupId}": {
    parameters: [
      { name: "groupId", in: "path", required: true, schema: { type: "string", maxLength: 100 } },
    ],
    get: {
      tags: ["Commerce"],
      operationId: "getGroupOrder",
      summary: "Ver un pedido grupal del que se forma parte",
      security: [{ bearerAuth: [] }],
      // 404 y no 403 para un grupo ajeno: decir «existe pero no es tuyo» ya
      // filtra que ese codigo corresponde a algo.
      responses: { 200: success(groupResponse), ...bearerErrors },
    },
    patch: {
      tags: ["Commerce"],
      operationId: "setGroupOrderStatus",
      summary: "Cerrar, reabrir o cancelar un pedido grupal",
      security: [{ bearerAuth: [] }],
      requestBody: body("GroupOrderStatusRequest"),
      responses: {
        200: success(groupResponse),
        ...bearerErrors,
        409: { description: "Solo el anfitrion, y solo si sigue abierto", content: json },
      },
    },
  },
  "/api/group-orders/{groupId}/items": {
    put: {
      tags: ["Commerce"],
      operationId: "setGroupOrderItems",
      summary: "Reemplazar la canasta propia dentro del grupo",
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "groupId", in: "path", required: true, schema: { type: "string", maxLength: 100 } },
      ],
      requestBody: body("GroupOrderItemsRequest"),
      responses: {
        200: success(groupResponse),
        ...bearerErrors,
        // El tope de gasto se verifica contra los precios de la base, no contra
        // los que manda el cliente.
        409: { description: "Grupo cerrado, vencido, o por encima del tope", content: json },
      },
    },
  },
  "/api/group-orders/{groupId}/checkout": {
    get: {
      tags: ["Commerce"],
      operationId: "getGroupOrderCheckout",
      summary: "Obtener los items del grupo juntos, para cotizar y confirmar",
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "groupId", in: "path", required: true, schema: { type: "string", maxLength: 100 } },
      ],
      responses: {
        200: success({
          type: "object",
          required: ["merchantPublicId", "branchPublicId", "items"],
          properties: {
            merchantPublicId: { type: "string" },
            branchPublicId: { type: "string" },
            // Las lineas vienen sumadas por producto y opciones: dos personas
            // que piden lo mismo son una linea de cantidad dos, y las notas de
            // las dos sobreviven.
            items: {
              type: "array",
              items: {
                type: "object",
                required: ["menuItemId", "quantity"],
                properties: {
                  menuItemId: { type: "string" },
                  quantity: { type: "integer", minimum: 1 },
                  extras: { type: "array", items: { type: "string" } },
                  note: { type: "string", maxLength: 500 },
                },
              },
            },
          },
        }),
        ...bearerErrors,
        409: { description: "El grupo no esta cerrado o no tiene productos", content: json },
      },
    },
  },
  "/api/group-orders/{groupId}/placed": {
    post: {
      tags: ["Commerce"],
      operationId: "markGroupOrderPlaced",
      summary: "Atar el grupo al pedido ya creado",
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "groupId", in: "path", required: true, schema: { type: "string", maxLength: 100 } },
      ],
      requestBody: body("GroupOrderPlacedRequest"),
      responses: { 200: success(groupResponse), ...bearerErrors },
    },
  },
  "/api/subscription/plans": {
    get: {
      tags: ["Commerce"],
      operationId: "listSubscriptionPlans",
      summary: "Listar planes de suscripcion y sus beneficios",
      // Sin `security`: el precio tiene que poder verse antes de crear la
      // cuenta, o la suscripcion solo se descubre despues de decidir usar la app.
      responses: {
        200: success({
          type: "object",
          required: ["plans"],
          properties: {
            plans: { type: "array", items: { $ref: "#/components/schemas/SubscriptionPlan" } },
          },
        }),
        503: { description: "La suscripcion requiere PostgreSQL", content: json },
      },
    },
  },
  "/api/subscription": {
    get: {
      tags: ["Commerce"],
      operationId: "getSubscription",
      summary: "Ver la suscripcion propia",
      security: [{ bearerAuth: [] }],
      responses: {
        // `subscription: null` y no 404: no estar suscripto es una respuesta
        // valida a la pregunta, y un 404 obligaria a cada cliente a tratar la
        // ausencia como un error.
        200: success({
          type: "object",
          required: ["subscription"],
          properties: {
            subscription: {
              oneOf: [{ $ref: "#/components/schemas/Subscription" }, { type: "null" }],
            },
          },
        }),
        ...bearerErrors,
      },
    },
    post: {
      tags: ["Commerce"],
      operationId: "subscribe",
      summary: "Activar o reactivar la suscripcion propia",
      security: [{ bearerAuth: [] }],
      requestBody: body("SubscribeRequest"),
      responses: {
        200: success({
          type: "object",
          required: ["subscription"],
          properties: { subscription: { $ref: "#/components/schemas/Subscription" } },
        }),
        ...bearerErrors,
        409: { description: "Ya existe una suscripcion vigente", content: json },
      },
    },
    delete: {
      tags: ["Commerce"],
      operationId: "cancelSubscription",
      summary: "Cancelar la renovacion, conservando el periodo pago",
      security: [{ bearerAuth: [] }],
      responses: {
        200: success({
          type: "object",
          required: ["cancelled", "benefitsUntil"],
          properties: {
            id: { type: "string" },
            cancelled: { type: "boolean" },
            // El periodo ya pagado se respeta: cortar los beneficios el dia de
            // la baja seria cobrar un mes y entregar menos.
            benefitsUntil: { type: "string", format: "date-time" },
          },
        }),
        ...bearerErrors,
        409: { description: "No hay suscripcion vigente para cancelar", content: json },
      },
    },
  },
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
        "Sólo Comercio u Operaciones puede proponer durante preparación. El original debe estar agotado y el reemplazo debe tener stock suficiente en la sucursal, ser distinto y no superar el precio original.",
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
});

openApiDocument.tags.push(
  { name: "Commerce", description: "Cotización y creación de pedidos de comida" },
  { name: "Mobility", description: "Cotización y solicitud de viajes" },
  { name: "Shipments", description: "Cotización y creación de envíos" },
  { name: "Finance", description: "Autorización transaccional y reserva de retiros" },
  { name: "Activity", description: "Actividad y comprobantes de servicios propios" },
  { name: "Tracking", description: "Seguimiento temporal con minimización de datos" },
  { name: "Dispatch", description: "Ofertas privadas, temporales y propias del conductor" },
  { name: "Support", description: "Tickets persistentes, mensajes y operación por roles" },
  {
    name: "Operations",
    description: "Backoffice administrativo paginado, auditable y sin secretos",
  },
  {
    name: "Dietary",
    description: "Dietas y alérgenos normalizados; sin garantías por ausencia de datos",
  },
  { name: "Merchant Operations", description: "Cola y métricas locales privadas para comercios" },
);

Object.assign(openApiDocument.components.schemas, {
  // Los beneficios se publican como valores y no como texto: quien integre tiene
  // que poder calcular el mismo precio que calcula Flash. Un plan descrito en
  // prosa obliga a adivinar el umbral, y la primera diferencia es un cobro mal
  // mostrado.
  SubscriptionPlan: {
    type: "object",
    required: ["id", "planKey", "planName", "priceCents", "billingPeriodDays"],
    properties: {
      id: { type: "string" },
      planKey: { type: "string" },
      planName: { type: "string" },
      description: { type: "string" },
      priceCents: { type: "integer", minimum: 1 },
      currency: { type: "string", minLength: 3, maxLength: 3 },
      billingPeriodDays: { type: "integer", minimum: 7, maximum: 366 },
      // `null` significa que el plan no da envio sin cargo, que no es lo mismo
      // que darlo desde cero.
      freeDeliveryMinSubtotalCents: { type: "integer", minimum: 0, nullable: true },
      rideDiscountBps: { type: "integer", minimum: 0, maximum: 5000 },
      dispatchPriorityBoost: { type: "integer", minimum: 0, maximum: 100 },
    },
  },
  Subscription: {
    allOf: [
      { $ref: "#/components/schemas/SubscriptionPlan" },
      {
        type: "object",
        required: ["status", "currentPeriodEnd", "renews", "billed"],
        properties: {
          status: { type: "string", enum: ["active", "expired"] },
          currentPeriodStart: { type: "string", format: "date-time" },
          currentPeriodEnd: { type: "string", format: "date-time" },
          // `false` despues de cancelar. Los beneficios siguen hasta que el
          // periodo termine: cancelar no es perder lo que ya se pago.
          renews: { type: "boolean" },
          // `false` mientras el cobro recurrente (PAY-001) no tenga
          // credenciales del proveedor. Se publica en vez de disimularse.
          billed: { type: "boolean" },
        },
      },
    ],
  },
  GroupOrder: {
    type: "object",
    required: ["id", "joinCode", "status", "hostId", "participants", "subtotal"],
    properties: {
      id: { type: "string" },
      // Solo viaja a quien ya es parte. El codigo es para entrar, no para leer.
      joinCode: { type: "string", minLength: 6, maxLength: 6 },
      status: { type: "string", enum: ["open", "locked", "placed", "cancelled"] },
      restaurantId: { type: "string" },
      restaurantName: { type: "string" },
      branchId: { type: "string" },
      hostId: { type: "string" },
      hostName: { type: "string" },
      // Tope por persona. `null` es sin tope.
      spendLimit: { type: "number", nullable: true },
      closesAt: { type: "string", format: "date-time", nullable: true },
      orderId: { type: "string", nullable: true },
      subtotal: { type: "number" },
      participants: {
        type: "array",
        items: {
          type: "object",
          required: ["userId", "name", "isHost", "items", "subtotal"],
          properties: {
            userId: { type: "string" },
            name: { type: "string" },
            isHost: { type: "boolean" },
            subtotal: { type: "number" },
            items: { type: "array", items: { type: "object" } },
          },
        },
      },
    },
  },
  GroupOrderCreateRequest: {
    type: "object",
    required: ["restaurantId"],
    properties: {
      restaurantId: { type: "string", maxLength: 100 },
      branchId: { type: "string", maxLength: 100 },
      spendLimitCents: { type: "integer", minimum: 10000, maximum: 100000000 },
      closesAt: { type: "string", format: "date-time" },
    },
  },
  GroupOrderJoinRequest: {
    type: "object",
    required: ["joinCode"],
    properties: { joinCode: { type: "string", pattern: "^[A-Za-z0-9]{6}$" } },
  },
  GroupOrderItemsRequest: {
    type: "object",
    required: ["items"],
    properties: {
      // La lista vacia es valida: es como alguien se saca de un pedido sin
      // abandonar el grupo.
      items: { type: "array", maxItems: 50, items: { type: "object" } },
    },
  },
  GroupOrderStatusRequest: {
    type: "object",
    required: ["status"],
    properties: { status: { type: "string", enum: ["open", "locked", "cancelled"] } },
  },
  GroupOrderPlacedRequest: {
    type: "object",
    required: ["orderId"],
    properties: { orderId: { type: "string", maxLength: 100 } },
  },
  RescheduleRequest: {
    type: "object",
    required: ["scheduledFor"],
    // La ventana la aplica `server/scheduling.js`: al menos 30 minutos de
    // anticipacion —lo que tarda el despacho en conseguir a alguien— y hasta 30
    // dias —mas alla el precio cotizado deja de significar algo—.
    properties: { scheduledFor: { type: "string", format: "date-time" } },
  },
  SubscribeRequest: {
    type: "object",
    required: ["planKey"],
    properties: { planKey: { type: "string", pattern: "^[a-z][a-z0-9_]{2,40}$" } },
  },
  CartItemInput: {
    type: "object",
    required: ["menuItemId", "quantity"],
    properties: {
      menuItemId: { type: "string", minLength: 1 },
      quantity: { type: "integer", minimum: 1, maximum: 30 },
      extras: {
        type: "array",
        maxItems: 20,
        items: { type: "string", minLength: 1, maxLength: 100 },
        default: [],
      },
      note: { type: "string", maxLength: 500, default: "" },
    },
  },
  FoodQuoteRequest: {
    type: "object",
    required: ["customerId", "restaurantId", "deliveryAddressId"],
    properties: {
      customerId: { type: "string" },
      restaurantId: { type: "string" },
      deliveryAddressId: { type: "string", format: "uuid" },
      branchId: { type: "string" },
      paymentMethod: { type: "string" },
      paymentMethodId: { type: "string", format: "uuid" },
      promotionCode: { type: "string", minLength: 3, maxLength: 40 },
      items: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        items: { $ref: "#/components/schemas/CartItemInput" },
      },
    },
  },
  FoodOrderRequest: {
    allOf: [
      { $ref: "#/components/schemas/FoodQuoteRequest" },
      {
        type: "object",
        required: ["items", "deliveryAddress", "paymentMethod", "quoteToken"],
        properties: {
          deliveryAddress: { type: "string", minLength: 3 },
          quoteToken: { type: "string", minLength: 20, writeOnly: true },
          // Propina del checkout (GTM-001). **No viaja en la cotizacion
          // firmada**: cambiarla no deberia obligar a recotizar el pedido
          // entero, y no hay nada que proteger firmandola —es plata del cliente
          // hacia quien reparte, no un precio que el cliente pueda bajar—. Los
          // topes se aplican contra el total del pedido, del lado del servidor.
          //
          // Se cobra junto con el pedido, en un solo cargo, y queda retenida
          // hasta que hay conductor y el servicio se completa. Si el pedido se
          // reintegra, vuelve entera.
          tipCents: { type: "integer", minimum: 0, maximum: 10000000, default: 0 },
          // Reserva de horario (GTM-001). Ausente es «lo antes posible». Los
          // pedidos de comida no se podian programar: `jobs.scheduled_for`
          // existia desde la migracion 001 y solo lo escribia el alta de viajes.
          scheduledFor: { type: "string", format: "date-time" },
          providerPayment: { $ref: "#/components/schemas/ProviderPaymentInput" },
        },
      },
    ],
  },
  ProviderPaymentInput: {
    type: "object",
    required: ["cardToken", "paymentMethodId"],
    additionalProperties: false,
    properties: {
      cardToken: {
        type: "string",
        minLength: 8,
        maxLength: 256,
        writeOnly: true,
        description: "Token efímero generado por Mercado Pago; nunca PAN/CVV.",
      },
      paymentMethodId: { type: "string", minLength: 2, maxLength: 64 },
      installments: { type: "integer", minimum: 1, maximum: 48, default: 1 },
    },
  },
  PaymentClientConfigurationResponse: {
    type: "object",
    required: ["ok", "requestId", "provider", "publicKey", "merchantReady", "cardDataHandling"],
    properties: {
      ok: { const: true },
      requestId: { type: "string" },
      provider: { enum: ["mercadopago", "disabled"] },
      publicKey: { type: ["string", "null"] },
      merchantReady: { type: "boolean" },
      cardDataHandling: { const: "provider_tokenization_only" },
    },
  },
  RideQuoteRequest: {
    type: "object",
    required: ["pickup", "destination"],
    properties: {
      pickup: { type: "string", minLength: 3 },
      destination: { type: "string", minLength: 3 },
      service: { enum: ["economy", "comfort", "moto", "xl"], default: "economy" },
      pickupCoords: { $ref: "#/components/schemas/Coordinate" },
      destinationCoords: { $ref: "#/components/schemas/Coordinate" },
    },
  },
  RideCreateRequest: {
    allOf: [
      { $ref: "#/components/schemas/RideQuoteRequest" },
      {
        type: "object",
        required: ["customerId", "paymentMethod", "quoteToken"],
        properties: {
          customerId: { type: "string" },
          paymentMethod: { type: "string", minLength: 2 },
          quoteToken: { type: "string", minLength: 20, writeOnly: true },
          scheduledFor: {
            type: "string",
            format: "date-time",
            description: "Entre 30 minutos y 30 días en el futuro.",
          },
        },
      },
    ],
  },
  RideOption: {
    type: "object",
    required: ["service", "fare", "quoteId", "quoteToken", "expiresAt"],
    properties: {
      service: { enum: ["economy", "comfort", "moto", "xl"] },
      fare: { type: "number", minimum: 0 },
      etaMin: { type: "integer", minimum: 0 },
      pickupEtaMin: { type: "integer", minimum: 0 },
      availableDrivers: { type: "integer", minimum: 0 },
      available: { type: "boolean" },
      quoteId: { type: "string" },
      quoteToken: { type: "string", writeOnly: true },
      expiresAt: { type: "string", format: "date-time" },
      breakdown: { type: "object" },
    },
  },
  RideOptionsResponse: {
    type: "object",
    required: ["ok", "requestId", "options"],
    properties: {
      ok: { const: true },
      requestId: { type: "string" },
      options: { type: "array", items: { $ref: "#/components/schemas/RideOption" } },
    },
  },
  ShipmentQuoteRequest: {
    type: "object",
    required: ["pickup", "destination", "packageSize", "weightKg"],
    properties: {
      pickup: { type: "string", minLength: 3 },
      destination: { type: "string", minLength: 3 },
      packageSize: { enum: ["small", "medium", "large"] },
      weightKg: { type: "number", exclusiveMinimum: 0, maximum: 20 },
      declaredValue: { type: "number", minimum: 0, maximum: 1000000, default: 0 },
      protection: { enum: ["none", "standard"], default: "none" },
      signatureRequired: { type: "boolean", default: false },
      itemCategory: { type: "string", pattern: "^[a-z][a-z0-9_]{1,31}$", default: "standard" },
      serviceLevel: { type: "string", pattern: "^[a-z][a-z0-9_]{1,31}$", default: "standard" },
      pickupCoords: { $ref: "#/components/schemas/Coordinate" },
      destinationCoords: { $ref: "#/components/schemas/Coordinate" },
    },
  },
  ShipmentCreateRequest: {
    allOf: [
      { $ref: "#/components/schemas/ShipmentQuoteRequest" },
      {
        type: "object",
        required: [
          "customerId",
          "recipientName",
          "recipientPhone",
          "description",
          "paymentMethod",
          "termsAccepted",
          "quoteToken",
        ],
        properties: {
          customerId: { type: "string" },
          recipientName: { type: "string", minLength: 2, maxLength: 120 },
          recipientPhone: { type: "string", minLength: 6, maxLength: 40 },
          description: { type: "string", minLength: 2, maxLength: 180 },
          deliveryNotes: { type: "string", maxLength: 300 },
          paymentMethod: { type: "string", minLength: 2 },
          termsAccepted: { const: true },
          quoteToken: { type: "string", minLength: 20, writeOnly: true },
        },
      },
    ],
  },
  QuoteResponse: {
    type: "object",
    required: ["ok", "requestId", "quote"],
    properties: {
      ok: { const: true },
      requestId: { type: "string" },
      quote: {
        type: "object",
        required: ["quoteId", "quoteToken", "expiresAt"],
        properties: {
          quoteId: { type: "string" },
          quoteToken: { type: "string", writeOnly: true },
          expiresAt: { type: "string", format: "date-time" },
          fare: { type: "number", minimum: 0 },
          total: { type: "number", minimum: 0 },
          breakdown: { type: "object" },
        },
      },
    },
  },
  PayoutAuthorizeRequest: {
    type: "object",
    required: ["merchantId", "amount", "password"],
    properties: {
      merchantId: { type: "string" },
      amount: { type: "number", exclusiveMinimum: 0, maximum: 100000000 },
      password: { type: "string", minLength: 4, maxLength: 128, writeOnly: true },
    },
  },
  PayoutRequest: {
    type: "object",
    required: ["merchantId", "amount", "authorizationToken"],
    properties: {
      merchantId: { type: "string" },
      amount: { type: "number", exclusiveMinimum: 0, maximum: 100000000 },
      authorizationToken: { type: "string", minLength: 20, writeOnly: true },
    },
  },
  PayoutAuthorizationResponse: {
    type: "object",
    required: ["ok", "requestId", "authorizationToken", "expiresAt", "merchantId", "amount"],
    properties: {
      ok: { const: true },
      requestId: { type: "string" },
      authorizationToken: { type: "string", writeOnly: true },
      expiresAt: { type: "string", format: "date-time" },
      merchantId: { type: "string" },
      amount: { type: "number" },
    },
  },
  MerchantPaymentConnection: {
    type: "object",
    required: ["provider", "externalAccountId", "liveMode", "connectedAt", "status"],
    properties: {
      provider: { const: "mercadopago" },
      externalAccountId: { type: "string" },
      liveMode: { type: "boolean" },
      scope: { type: ["string", "null"] },
      connectedAt: { type: "string", format: "date-time" },
      tokenExpiresAt: { type: ["string", "null"], format: "date-time" },
      status: { enum: ["connected", "reconnect_required", "revoked"] },
    },
  },
  PaymentConnectionResponse: {
    type: "object",
    required: ["ok", "requestId", "configured", "connection"],
    properties: {
      ok: { const: true },
      requestId: { type: "string" },
      configured: { type: "boolean" },
      connection: {
        oneOf: [{ $ref: "#/components/schemas/MerchantPaymentConnection" }, { type: "null" }],
      },
    },
  },
  MercadoPagoWebhook: {
    type: "object",
    required: ["id", "type", "data"],
    properties: {
      id: { oneOf: [{ type: "string" }, { type: "number" }] },
      type: {
        enum: [
          "order",
          "orders",
          "payment",
          "mp-connect",
          "topic_claims_integration_wh",
          "topic_chargebacks_wh",
          "stop_delivery_op_wh",
        ],
      },
      action: { type: "string", maxLength: 120 },
      live_mode: { type: "boolean" },
      date_created: { type: "string", format: "date-time" },
      user_id: { oneOf: [{ type: "string" }, { type: "number" }] },
      data: {
        type: "object",
        required: ["id"],
        properties: { id: { oneOf: [{ type: "string" }, { type: "number" }] } },
      },
    },
  },
  ServiceReceipt: {
    type: "object",
    required: [
      "id",
      "number",
      "jobId",
      "serviceKind",
      "total",
      "currency",
      "lineItems",
      "payment",
      "issuedAt",
      "fiscal",
      "documentType",
    ],
    properties: {
      id: { type: "string" },
      number: { type: "string" },
      jobId: { type: "string" },
      serviceKind: { enum: ["delivery", "ride"] },
      serviceSubtype: { type: ["string", "null"] },
      subtotal: { type: "number", minimum: 0 },
      discount: { type: "number", minimum: 0 },
      deliveryFee: { type: "number", minimum: 0 },
      serviceFee: { type: "number", minimum: 0 },
      total: { type: "number", minimum: 0 },
      currency: { type: "string", minLength: 3, maxLength: 3 },
      lineItems: { type: "array", items: { type: "object" } },
      payment: { type: "object" },
      issuedAt: { type: "string", format: "date-time" },
      fiscal: { const: false },
      documentType: { const: "service_receipt" },
      metadata: { type: "object" },
    },
  },
  ServiceReceiptResponse: {
    type: "object",
    required: ["ok", "requestId", "receipt"],
    properties: {
      ok: { const: true },
      requestId: { type: "string" },
      receipt: { $ref: "#/components/schemas/ServiceReceipt" },
    },
  },
  RideTrackingLinkRequest: {
    type: "object",
    properties: { ttlMinutes: { type: "integer", minimum: 15, maximum: 1440, default: 120 } },
  },
  RideTrackingLinkResponse: {
    type: "object",
    required: ["ok", "requestId", "link"],
    properties: {
      ok: { const: true },
      requestId: { type: "string" },
      link: {
        type: "object",
        required: ["id", "trackingUrl", "expiresAt"],
        properties: {
          id: { type: "string" },
          trackingUrl: { type: "string", format: "uri", writeOnly: true },
          expiresAt: { type: "string", format: "date-time" },
        },
      },
    },
  },
  PublicRideTrackingResponse: {
    type: "object",
    required: ["ok", "requestId", "tracking"],
    properties: {
      ok: { const: true },
      requestId: { type: "string" },
      tracking: {
        type: "object",
        description:
          "Snapshot minimizado: estado, ruta general, vehículo y posición cuando corresponde; nunca teléfono, email ni payment data.",
      },
    },
  },
  DispatchOffer: {
    type: "object",
    required: [
      "id",
      "jobId",
      "kind",
      "pickup",
      "destination",
      "fare",
      "distanceKm",
      "durationMin",
      "expiresAt",
      "status",
    ],
    properties: {
      id: { type: "string" },
      jobId: { type: "string" },
      kind: { enum: ["delivery", "ride"] },
      serviceLevel: { type: "string" },
      pickup: { type: "string" },
      destination: { type: "string" },
      fare: { type: "number", minimum: 0 },
      distanceKm: { type: "number", minimum: 0 },
      durationMin: { type: "integer", minimum: 0 },
      score: { type: "number" },
      scoreBreakdown: { type: "object" },
      expiresAt: { type: "string", format: "date-time" },
      status: { const: "pending" },
      subtype: { type: ["string", "null"] },
    },
  },
  DispatchOffersResponse: {
    type: "object",
    required: ["ok", "requestId", "offers"],
    properties: {
      ok: { const: true },
      requestId: { type: "string" },
      offers: { type: "array", items: { $ref: "#/components/schemas/DispatchOffer" } },
    },
  },
  DriverDemandZone: {
    type: "object",
    required: ["id", "name", "level", "openJobs", "eligibleDrivers", "containsDriver", "boundary"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      level: { enum: ["low", "medium", "high"] },
      openJobs: { type: "integer", minimum: 0 },
      eligibleDrivers: { type: "integer", minimum: 0 },
      containsDriver: { type: "boolean" },
      boundary: { type: "array", minItems: 4, items: { $ref: "#/components/schemas/Coordinate" } },
    },
  },
  DriverDemand: {
    type: "object",
    required: [
      "driverId",
      "service",
      "online",
      "city",
      "observedAt",
      "source",
      "methodology",
      "zones",
    ],
    properties: {
      driverId: { type: "string" },
      service: { enum: ["delivery", "ride", "shopping"] },
      online: { type: "boolean" },
      city: {
        type: "object",
        required: ["id", "slug", "name", "timezone"],
        properties: {
          id: { type: "string" },
          slug: { type: "string" },
          name: { type: "string" },
          timezone: { type: "string" },
        },
      },
      observedAt: { type: "string", format: "date-time" },
      source: { const: "postgres-live-window" },
      methodology: {
        type: "object",
        required: [
          "openJobs",
          "scheduledHorizonMinutes",
          "supplyFreshnessMinutes",
          "maximumLocationAccuracyM",
          "forecast",
          "pricingImpact",
        ],
        properties: {
          openJobs: { const: "dispatchable_unassigned" },
          scheduledHorizonMinutes: { const: 15 },
          supplyFreshnessMinutes: { const: 5 },
          maximumLocationAccuracyM: { const: 100 },
          forecast: { const: false },
          pricingImpact: { const: false },
        },
      },
      zones: { type: "array", items: { $ref: "#/components/schemas/DriverDemandZone" } },
    },
  },
  DriverDemandResponse: {
    type: "object",
    required: ["ok", "requestId", "demand"],
    properties: {
      ok: { const: true },
      requestId: { type: "string" },
      demand: { $ref: "#/components/schemas/DriverDemand" },
    },
  },
  DriverEarningsPeriod: {
    type: "object",
    required: [
      "amount",
      "serviceEarnings",
      "tips",
      "adjustments",
      "services",
      "onlineSeconds",
      "activeSeconds",
      "periodStart",
      "periodEnd",
    ],
    properties: {
      amount: { type: "number" },
      serviceEarnings: { type: "number" },
      tips: { type: "number" },
      adjustments: { type: "number" },
      services: { type: "integer", minimum: 0 },
      onlineSeconds: { type: ["integer", "null"], minimum: 0 },
      activeSeconds: { type: ["integer", "null"], minimum: 0 },
      periodStart: { type: "string", format: "date-time" },
      periodEnd: { type: "string", format: "date-time" },
    },
  },
  DriverEarningsDay: {
    type: "object",
    required: [
      "date",
      "amount",
      "serviceEarnings",
      "tips",
      "adjustments",
      "services",
      "onlineSeconds",
      "activeSeconds",
    ],
    properties: {
      date: { type: "string", format: "date" },
      amount: { type: "number" },
      serviceEarnings: { type: "number" },
      tips: { type: "number" },
      adjustments: { type: "number" },
      services: { type: "integer", minimum: 0 },
      onlineSeconds: { type: ["integer", "null"], minimum: 0 },
      activeSeconds: { type: ["integer", "null"], minimum: 0 },
    },
  },
  DriverEarningEntry: {
    type: "object",
    required: ["id", "category", "jobId", "description", "amount", "createdAt"],
    properties: {
      id: { type: "string" },
      category: { enum: ["food", "ride", "shipment", "tip", "adjustment"] },
      jobId: { type: ["string", "null"] },
      description: { type: "string" },
      amount: { type: "number" },
      createdAt: { type: "string", format: "date-time" },
    },
  },
  DriverEarnings: {
    type: "object",
    required: [
      "driverId",
      "currency",
      "timezone",
      "source",
      "walletBalance",
      "today",
      "week",
      "days",
      "recent",
      "timeTracking",
      "cashout",
    ],
    properties: {
      driverId: { type: "string" },
      currency: { const: "ARS" },
      timezone: { type: "string" },
      source: { enum: ["postgres-ledger", "sqlite-test-fallback"] },
      walletBalance: { type: "number" },
      today: { $ref: "#/components/schemas/DriverEarningsPeriod" },
      week: { $ref: "#/components/schemas/DriverEarningsPeriod" },
      days: {
        type: "array",
        minItems: 1,
        maxItems: 7,
        items: { $ref: "#/components/schemas/DriverEarningsDay" },
      },
      recent: {
        type: "array",
        maxItems: 100,
        items: { $ref: "#/components/schemas/DriverEarningEntry" },
      },
      timeTracking: {
        oneOf: [
          {
            type: "object",
            required: ["status", "source", "observedAt"],
            properties: {
              status: { const: "available" },
              source: { const: "postgres-operational-sessions" },
              observedAt: { type: "string", format: "date-time" },
            },
          },
          {
            type: "object",
            required: ["status", "reason"],
            properties: {
              status: { const: "unavailable" },
              reason: { const: "postgres_required" },
            },
          },
        ],
      },
      cashout: {
        type: "object",
        required: ["status", "reason"],
        properties: {
          status: { const: "not_configured" },
          reason: { const: "external_payout_provider_required" },
        },
      },
    },
  },
  DriverEarningsResponse: {
    type: "object",
    required: ["ok", "requestId", "earnings"],
    properties: {
      ok: { const: true },
      requestId: { type: "string" },
      earnings: { $ref: "#/components/schemas/DriverEarnings" },
    },
  },
  MerchantOperationsMetrics: {
    type: "object",
    required: [
      "activeOrders",
      "needsAction",
      "preparing",
      "readyForPickup",
      "courierFlow",
      "lateOrders",
      "untrackedPrepOrders",
      "oldestActiveMinutes",
      "completedToday",
      "cancelledToday",
      "grossSalesToday",
      "averageTicketToday",
      "unavailableItems",
    ],
    properties: {
      activeOrders: { type: "integer", minimum: 0 },
      needsAction: { type: "integer", minimum: 0 },
      preparing: { type: "integer", minimum: 0 },
      readyForPickup: { type: "integer", minimum: 0 },
      courierFlow: { type: "integer", minimum: 0 },
      lateOrders: { type: "integer", minimum: 0 },
      untrackedPrepOrders: {
        type: "integer",
        minimum: 0,
        description: "Pedidos activos heredados sin plazo de preparación observado.",
      },
      oldestActiveMinutes: { type: "integer", minimum: 0 },
      completedToday: { type: "integer", minimum: 0 },
      cancelledToday: { type: "integer", minimum: 0 },
      grossSalesToday: { type: "number", minimum: 0 },
      averageTicketToday: { type: "number", minimum: 0 },
      unavailableItems: { type: "integer", minimum: 0 },
    },
  },
  MerchantOperationsDashboard: {
    type: "object",
    required: [
      "generatedAt",
      "source",
      "timezone",
      "restaurantId",
      "branch",
      "restaurant",
      "metrics",
    ],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      source: { enum: ["postgres-live-operations", "sqlite-test-fallback"] },
      timezone: { type: "string" },
      restaurantId: { type: "string" },
      branch: {
        oneOf: [
          {
            type: "object",
            required: ["id", "name", "timezone", "open", "manualOpen", "status", "etaMin"],
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              timezone: { type: "string" },
              open: { type: "boolean" },
              manualOpen: { type: "boolean" },
              status: { enum: ["active", "paused", "closed"] },
              etaMin: { type: "integer", minimum: 5, maximum: 240 },
            },
          },
          { type: "null" },
        ],
      },
      restaurant: { type: "object" },
      metrics: { $ref: "#/components/schemas/MerchantOperationsMetrics" },
    },
  },
  MerchantDashboardResponse: {
    type: "object",
    required: ["ok", "requestId", "dashboard"],
    properties: {
      ok: { const: true },
      requestId: { type: "string" },
      dashboard: { $ref: "#/components/schemas/MerchantOperationsDashboard" },
    },
  },
  MerchantActiveOrdersResponse: {
    type: "object",
    required: ["ok", "requestId", "generatedAt", "source", "orders", "hasMore"],
    properties: {
      ok: { const: true },
      requestId: { type: "string" },
      generatedAt: { type: "string", format: "date-time" },
      source: { enum: ["postgres-live-operations", "sqlite-test-fallback"] },
      orders: { type: "array", maxItems: 100, items: { type: "object" } },
      hasMore: { type: "boolean" },
    },
  },
  OrderSubstitutionProposal: {
    type: "object",
    additionalProperties: false,
    required: ["originalMenuItemId", "replacementMenuItemId", "reason"],
    properties: {
      originalMenuItemId: { type: "string", minLength: 3, maxLength: 100 },
      replacementMenuItemId: { type: "string", minLength: 3, maxLength: 100 },
      reason: { type: "string", minLength: 3, maxLength: 500 },
    },
  },
  OrderSubstitutionDecision: {
    type: "object",
    additionalProperties: false,
    required: ["decision"],
    properties: { decision: { enum: ["accepted", "rejected"] } },
  },
  OrderSubstitutionProduct: {
    type: "object",
    required: ["id", "name", "unitPrice"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      unitPrice: { type: "number", minimum: 0 },
    },
  },
  OrderSubstitution: {
    type: "object",
    required: [
      "id",
      "orderId",
      "status",
      "quantity",
      "reason",
      "original",
      "replacement",
      "refundAmount",
      "createdAt",
      "decidedAt",
    ],
    properties: {
      id: { type: "string" },
      orderId: { type: "string" },
      status: { enum: ["pending", "accepted", "rejected", "cancelled"] },
      quantity: { type: "integer", minimum: 1 },
      reason: { type: "string" },
      original: { $ref: "#/components/schemas/OrderSubstitutionProduct" },
      replacement: { $ref: "#/components/schemas/OrderSubstitutionProduct" },
      refundAmount: { type: "number", minimum: 0 },
      createdAt: { type: "string", format: "date-time" },
      decidedAt: { type: ["string", "null"], format: "date-time" },
    },
  },
  OrderSubstitutionResponse: {
    type: "object",
    required: ["ok", "requestId", "substitution"],
    properties: {
      ok: { const: true },
      requestId: { type: "string" },
      substitution: { $ref: "#/components/schemas/OrderSubstitution" },
    },
  },
  OrderSubstitutionsResponse: {
    type: "object",
    required: ["ok", "requestId", "substitutions"],
    properties: {
      ok: { const: true },
      requestId: { type: "string" },
      substitutions: { type: "array", items: { $ref: "#/components/schemas/OrderSubstitution" } },
    },
  },
  DriverPreferencesInput: {
    type: "object",
    additionalProperties: false,
    required: ["navigationProvider"],
    properties: { navigationProvider: { enum: ["system", "google_maps", "apple_maps"] } },
  },
  DriverPreferences: {
    type: "object",
    required: ["driverId", "navigationProvider", "updatedAt"],
    properties: {
      driverId: { type: "string" },
      navigationProvider: { enum: ["system", "google_maps", "apple_maps"] },
      updatedAt: { type: ["string", "null"], format: "date-time" },
    },
  },
  DriverPreferencesResponse: {
    type: "object",
    required: ["ok", "requestId", "preferences"],
    properties: {
      ok: { const: true },
      requestId: { type: "string" },
      preferences: { $ref: "#/components/schemas/DriverPreferences" },
    },
  },
  SupportTicketCreateRequest: {
    type: "object",
    additionalProperties: false,
    required: ["category", "subject", "body"],
    properties: {
      category: { enum: ["food", "ride", "shipment", "payment", "account", "safety", "other"] },
      priority: { enum: ["low", "normal", "high", "urgent"], default: "normal" },
      subject: { type: "string", minLength: 4, maxLength: 160 },
      body: { type: "string", minLength: 4, maxLength: 5000 },
      jobId: { type: "string", maxLength: 64 },
    },
  },
  SupportMessageRequest: {
    type: "object",
    additionalProperties: false,
    required: ["body"],
    properties: {
      body: { type: "string", minLength: 1, maxLength: 5000 },
      internal: {
        type: "boolean",
        default: false,
        description: "Sólo roles support/admin pueden crear notas internas.",
      },
    },
  },
  SupportTicketUpdateRequest: {
    type: "object",
    minProperties: 1,
    additionalProperties: false,
    properties: {
      status: { enum: ["open", "waiting_customer", "waiting_operations", "resolved", "closed"] },
      priority: { enum: ["low", "normal", "high", "urgent"] },
      assignedTo: { type: "string", maxLength: 64 },
    },
  },
  SupportTicket: {
    type: "object",
    required: ["id", "service", "priority", "title", "status", "messages"],
    properties: {
      id: { type: "string" },
      service: { enum: ["food", "ride", "shipment", "payment", "account", "safety", "other"] },
      priority: { enum: ["low", "medium", "high", "urgent"] },
      title: { type: "string" },
      status: { enum: ["open", "waiting_customer", "waiting_operations", "resolved", "closed"] },
      messages: { type: "array", items: { type: "object" } },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  SupportTicketResponse: {
    type: "object",
    required: ["ok", "requestId", "ticket"],
    properties: {
      ok: { const: true },
      requestId: { type: "string" },
      ticket: { $ref: "#/components/schemas/SupportTicket" },
    },
  },
  SupportTicketsResponse: {
    type: "object",
    required: ["ok", "requestId", "tickets"],
    properties: {
      ok: { const: true },
      requestId: { type: "string" },
      tickets: { type: "array", items: { $ref: "#/components/schemas/SupportTicket" } },
    },
  },
  OperationsPageResponse: {
    type: "object",
    required: ["ok", "requestId"],
    properties: {
      ok: { const: true },
      requestId: { type: "string" },
      nextCursor: { type: ["string", "null"] },
      restaurants: { type: "array", items: { type: "object" } },
      drivers: { type: "array", items: { type: "object" } },
      users: { type: "array", items: { type: "object" } },
      tickets: { type: "array", items: { type: "object" } },
      events: { type: "array", items: { type: "object" } },
    },
  },
  FeatureFlag: {
    type: "object",
    required: [
      "id",
      "key",
      "description",
      "enabled",
      "rolloutPercentage",
      "allowedRoles",
      "variant",
      "updatedAt",
    ],
    properties: {
      id: { type: "string" },
      key: { type: "string" },
      description: { type: "string" },
      enabled: { type: "boolean" },
      rolloutPercentage: { type: "integer", minimum: 0, maximum: 100 },
      allowedRoles: {
        type: "array",
        items: { enum: ["customer", "merchant", "driver", "admin", "support"] },
      },
      city: { type: ["string", "null"] },
      startsAt: { type: ["string", "null"], format: "date-time" },
      endsAt: { type: ["string", "null"], format: "date-time" },
      variant: { type: "object" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  FeatureFlagUpdateRequest: {
    type: "object",
    minProperties: 1,
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean" },
      rolloutPercentage: { type: "integer", minimum: 0, maximum: 100 },
      allowedRoles: {
        type: "array",
        maxItems: 5,
        items: { enum: ["customer", "merchant", "driver", "admin", "support"] },
      },
      startsAt: { type: ["string", "null"], format: "date-time" },
      endsAt: { type: ["string", "null"], format: "date-time" },
      variant: {
        type: "object",
        additionalProperties: {
          oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }],
        },
      },
    },
  },
  FeatureFlagResponse: {
    type: "object",
    required: ["ok", "requestId", "flag"],
    properties: {
      ok: { const: true },
      requestId: { type: "string" },
      flag: { $ref: "#/components/schemas/FeatureFlag" },
    },
  },
  FeatureFlagsResponse: {
    type: "object",
    required: ["ok", "requestId", "flags"],
    properties: {
      ok: { const: true },
      requestId: { type: "string" },
      flags: { type: "array", items: { $ref: "#/components/schemas/FeatureFlag" } },
    },
  },
  DietaryCode: { enum: ["vegetarian", "vegan", "gluten_free", "halal", "kosher"] },
  AllergenCode: {
    enum: ["gluten", "milk", "eggs", "peanuts", "tree_nuts", "soy", "fish", "shellfish", "sesame"],
  },
  DietaryPreferencesInput: {
    type: "object",
    additionalProperties: false,
    required: ["dietaryLabels", "avoidedAllergens", "hideIncompatible"],
    properties: {
      dietaryLabels: {
        type: "array",
        uniqueItems: true,
        maxItems: 5,
        items: { $ref: "#/components/schemas/DietaryCode" },
      },
      avoidedAllergens: {
        type: "array",
        uniqueItems: true,
        maxItems: 9,
        items: { $ref: "#/components/schemas/AllergenCode" },
      },
      hideIncompatible: { type: "boolean" },
    },
  },
  DietaryPreferences: {
    type: "object",
    required: ["dietaryLabels", "avoidedAllergens", "hideIncompatible"],
    properties: {
      dietaryLabels: {
        type: "array",
        items: {
          type: "object",
          required: ["code", "name"],
          properties: {
            code: { $ref: "#/components/schemas/DietaryCode" },
            name: { type: "string" },
          },
        },
      },
      avoidedAllergens: {
        type: "array",
        items: {
          type: "object",
          required: ["code", "name"],
          properties: {
            code: { $ref: "#/components/schemas/AllergenCode" },
            name: { type: "string" },
          },
        },
      },
      hideIncompatible: { type: "boolean" },
    },
  },
  DietaryPreferencesResponse: {
    type: "object",
    required: ["ok", "requestId", "preferences"],
    properties: {
      ok: { const: true },
      requestId: { type: "string" },
      preferences: { $ref: "#/components/schemas/DietaryPreferences" },
    },
  },
  CatalogItemDietaryInput: {
    type: "object",
    additionalProperties: false,
    required: ["dietaryLabels", "allergens"],
    properties: {
      dietaryLabels: {
        type: "array",
        uniqueItems: true,
        maxItems: 5,
        items: { $ref: "#/components/schemas/DietaryCode" },
      },
      allergens: {
        type: "array",
        maxItems: 9,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["code", "presence"],
          properties: {
            code: { $ref: "#/components/schemas/AllergenCode" },
            presence: { enum: ["contains", "may_contain"] },
          },
        },
      },
    },
  },
});
