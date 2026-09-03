import { json, errorResponses, success } from "./primitives.js";

export const baseOpenApiDocument = {
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
