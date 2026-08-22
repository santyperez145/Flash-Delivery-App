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
    description: "Contrato incremental del núcleo operativo. La ausencia de una ruta en este documento significa que todavía no tiene cobertura OpenAPI y no que esté lista para terceros.",
  },
  servers: [{ url: "/", description: "Mismo origen" }],
  tags: [
    { name: "Platform", description: "Estado técnico y expansión geográfica" },
    { name: "Auth", description: "Identidad y ciclo de sesiones rotativas" },
  ],
  paths: {
    "/api/health": {
      get: {
        tags: ["Platform"], operationId: "getHealth", summary: "Liveness del proceso",
        responses: { 200: success({ $ref: "#/components/schemas/HealthResponse" }) },
      },
    },
    "/api/ready": {
      get: {
        tags: ["Platform"], operationId: "getReadiness", summary: "Readiness de dependencias",
        responses: { 200: success({ $ref: "#/components/schemas/ReadyResponse" }), 503: { description: "Dependencia requerida o postura de privilegios no disponible", content: json } },
      },
    },
    "/api/cities": {
      get: {
        tags: ["Platform"], operationId: "listCities", summary: "Ciudades públicamente habilitadas",
        responses: { 200: success({ $ref: "#/components/schemas/CitiesResponse" }), 500: errorResponses[500] },
      },
    },
    "/api/zones": {
      get: {
        tags: ["Platform"], operationId: "listZones", summary: "Zonas públicas de una ciudad",
        parameters: [{ name: "city", in: "query", required: false, schema: { type: "string", pattern: "^[a-z0-9-]{2,40}$", default: "buenos-aires" } }],
        responses: { 200: success({ $ref: "#/components/schemas/ZonesResponse" }), 400: errorResponses[400], 404: { description: "Ciudad no habilitada", content: json }, 500: errorResponses[500] },
      },
    },
    "/api/auth/login": {
      post: {
        tags: ["Auth"], operationId: "login", summary: "Iniciar sesión",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/LoginRequest" } } } },
        responses: { 200: success({ $ref: "#/components/schemas/AuthResponse" }), 400: errorResponses[400], 401: errorResponses[401], 403: { description: "Email pendiente de verificación", content: json }, 429: errorResponses[429] },
      },
    },
    "/api/auth/register": {
      post: {
        tags: ["Auth"], operationId: "register", summary: "Crear una cuenta customer",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/RegisterRequest" } } } },
        responses: { 200: success({ $ref: "#/components/schemas/RegisterResponse" }), 400: errorResponses[400], 409: { description: "Email existente", content: json }, 429: errorResponses[429] },
      },
    },
    "/api/auth/refresh": {
      post: {
        tags: ["Auth"], operationId: "refreshSession", summary: "Rotar refresh token", security: [{ cookieAuth: [] }, {}],
        description: "Web usa cookie HttpOnly y X-Flash-Client: web; clientes nativos envían refreshToken en JSON.",
        requestBody: { required: false, content: { "application/json": { schema: { $ref: "#/components/schemas/RefreshRequest" } } } },
        responses: { 200: success({ $ref: "#/components/schemas/AuthResponse" }), 400: errorResponses[400], 401: errorResponses[401], 429: errorResponses[429] },
      },
    },
    "/api/auth/logout": {
      post: {
        tags: ["Auth"], operationId: "logout", summary: "Revocar una sesión", security: [{ cookieAuth: [] }, {}],
        requestBody: { required: false, content: { "application/json": { schema: { $ref: "#/components/schemas/RefreshTokenRequest" } } } },
        responses: { 200: success({ type: "object", required: ["ok", "requestId", "loggedOut"], properties: { ok: { const: true }, requestId: { type: "string" }, loggedOut: { const: true } } }), 400: errorResponses[400], 429: errorResponses[429] },
      },
    },
    "/api/me/sessions": {
      get: {
        tags: ["Auth"], operationId: "listSessions", summary: "Inventario de sesiones propias", security: [{ bearerAuth: [] }],
        responses: { 200: success({ type: "object", required: ["ok", "requestId", "sessions"], properties: { ok: { const: true }, requestId: { type: "string" }, sessions: { type: "array", items: { $ref: "#/components/schemas/Session" } } } }), 401: errorResponses[401], 429: errorResponses[429] },
      },
    },
    "/api/me/phone-verification/request": {
      post: {
        tags: ["Auth"], operationId: "requestPhoneVerification", summary: "Enviar OTP al teléfono guardado", security: [{ bearerAuth: [] }],
        responses: { 200: success({ $ref: "#/components/schemas/PhoneVerificationRequestResponse" }), 401: errorResponses[401], 409: { description: "Teléfono ausente o ya verificado", content: json }, 429: errorResponses[429], 503: { description: "Proveedor no configurado", content: json } },
      },
    },
    "/api/me/phone-verification/confirm": {
      post: {
        tags: ["Auth"], operationId: "confirmPhoneVerification", summary: "Confirmar posesión del teléfono", security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["code"], properties: { code: { type: "string", pattern: "^[0-9]{6}$", writeOnly: true } } } } } },
        responses: { 200: success({ type: "object", required: ["ok", "requestId", "verified", "phone"], properties: { ok: { const: true }, requestId: { type: "string" }, verified: { const: true }, phone: { type: "string" } } }), 400: errorResponses[400], 401: errorResponses[401], 429: errorResponses[429] },
      },
    },
    "/api/me/sessions/{sessionId}": {
      delete: {
        tags: ["Auth"], operationId: "revokeSession", summary: "Revocar una sesión propia", security: [{ bearerAuth: [] }],
        parameters: [{ name: "sessionId", in: "path", required: true, schema: { type: "string", minLength: 3 } }],
        responses: { 200: success({ type: "object" }), 401: errorResponses[401], 404: { description: "Sesión no encontrada", content: json }, 429: errorResponses[429], 503: { description: "Requiere PostgreSQL", content: json } },
      },
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" }, cookieAuth: { type: "apiKey", in: "cookie", name: "__Host-flash_refresh", description: "Cookie web productiva HttpOnly, Secure y SameSite=Strict." } },
    schemas: {
      Error: { type: "object", required: ["ok", "requestId", "message"], properties: { ok: { const: false }, requestId: { type: "string" }, message: { type: "string" } } },
      Coordinate: { type: "object", required: ["lat", "lng"], properties: { lat: { type: "number", minimum: -90, maximum: 90 }, lng: { type: "number", minimum: -180, maximum: 180 } } },
      HealthResponse: { type: "object", required: ["ok", "requestId", "service", "environment", "storageMode", "timestamp"], properties: { ok: { const: true }, requestId: { type: "string" }, service: { const: "flash-fullstack-api" }, environment: { enum: ["development", "test", "production"] }, storageMode: { enum: ["postgres-primary", "sqlite-demo"] }, timestamp: { type: "string", format: "date-time" } } },
      ReadyResponse: { type: "object", required: ["ok", "requestId", "service", "database", "redis", "runtimeStore"], properties: { ok: { const: true }, requestId: { type: "string" }, service: { type: "string" }, database: { type: "object" }, redis: { type: "object" }, runtimeStore: { type: "string" } } },
      City: { type: "object", required: ["id", "slug", "name", "countryCode", "currency", "timezone", "status", "enabledServices", "center"], properties: { id: { type: "string" }, slug: { type: "string" }, name: { type: "string" }, countryCode: { type: "string", minLength: 2, maxLength: 2 }, currency: { type: "string", minLength: 3, maxLength: 3 }, timezone: { type: "string" }, status: { enum: ["beta", "active"] }, enabledServices: { type: "array", items: { type: "string" } }, center: { $ref: "#/components/schemas/Coordinate" } } },
      CitiesResponse: { type: "object", required: ["ok", "requestId", "cities"], properties: { ok: { const: true }, requestId: { type: "string" }, cities: { type: "array", items: { $ref: "#/components/schemas/City" } } } },
      ZonesResponse: { type: "object", required: ["ok", "requestId", "city", "zones"], properties: { ok: { const: true }, requestId: { type: "string" }, city: { type: "string" }, zones: { type: "array", items: { type: "object" } } } },
      User: { type: "object", required: ["id", "name", "email", "roles"], properties: { id: { type: "string" }, name: { type: "string" }, email: { type: "string", format: "email" }, roles: { type: "array", items: { enum: ["customer", "merchant", "driver", "admin", "support", "auditor"] } }, phone: { type: "string", pattern: "^\\+[1-9][0-9]{7,14}$" }, phoneVerifiedAt: { type: ["string","null"], format: "date-time" } } },
      LoginRequest: { type: "object", required: ["email", "password"], properties: { email: { type: "string", format: "email" }, password: { type: "string", minLength: 4 }, deviceName: { type: "string", maxLength: 160 } } },
      RegisterRequest: { type: "object", required: ["name", "email", "password"], properties: { name: { type: "string", minLength: 2 }, email: { type: "string", format: "email" }, password: { type: "string", minLength: 8, maxLength: 128, format: "password" }, phone: { type: "string", maxLength: 30 }, deviceName: { type: "string", maxLength: 160 } } },
      RefreshTokenRequest: { type: "object", required: ["refreshToken"], properties: { refreshToken: { type: "string", minLength: 32, writeOnly: true } } },
      RefreshRequest: { type: "object", properties: { refreshToken: { type: "string", minLength: 32, writeOnly: true, description: "Sólo clientes nativos." }, deviceName: { type: "string", maxLength: 160 } } },
      AuthResponse: { type: "object", required: ["ok", "requestId", "user"], properties: { ok: { const: true }, requestId: { type: "string" }, user: { $ref: "#/components/schemas/User" }, token: { type: "string", writeOnly: true }, refreshToken: { type: "string", writeOnly: true }, refreshExpiresAt: { type: "string", format: "date-time" }, mfaRequired: { type: "boolean" }, mfaChallenge: { type: "string", writeOnly: true } } },
      RegisterResponse: { type: "object", required: ["ok", "requestId", "user"], properties: { ok: { const: true }, requestId: { type: "string" }, user: { $ref: "#/components/schemas/User" }, verificationRequired: { type: "boolean" } } },
      Session: { type: "object", required: ["id", "deviceName", "createdAt", "expiresAt"], properties: { id: { type: "string" }, deviceName: { type: "string" }, createdAt: { type: "string", format: "date-time" }, expiresAt: { type: "string", format: "date-time" } } },
      PhoneVerificationRequestResponse: { type: "object", required: ["ok", "requestId", "expiresAt", "retryAfterSeconds"], properties: { ok: { const: true }, requestId: { type: "string" }, expiresAt: { type: "string", format: "date-time" }, retryAfterSeconds: { type: "integer", minimum: 30 }, developmentCode: { type: "string", pattern: "^[0-9]{6}$", writeOnly: true, description: "Sólo sandbox fuera de producción." } } },
    },
  },
};

const bearerErrors = { 400: errorResponses[400], 401: errorResponses[401], 403: { description: "La identidad no puede actuar por el customer solicitado", content: json }, 409: { description: "Cotización vencida o no correspondiente", content: json }, 429: errorResponses[429] };
const idempotencyHeader = { name: "Idempotency-Key", in: "header", required: true, description: "Clave única por intento lógico; 16 a 128 caracteres ASCII seguros.", schema: { type: "string", pattern: "^[a-zA-Z0-9._:-]{16,128}$" } };
const body = (schema) => ({ required: true, content: { "application/json": { schema: { $ref: `#/components/schemas/${schema}` } } } });

Object.assign(openApiDocument.paths, {
  "/api/orders/quote": { post: { tags: ["Commerce"], operationId: "quoteFoodOrder", summary: "Cotizar carrito y última milla", security: [{ bearerAuth: [] }], requestBody: body("FoodQuoteRequest"), responses: { 200: success({ $ref: "#/components/schemas/QuoteResponse" }), ...bearerErrors, 503: { description: "La cotización geográfica requiere PostgreSQL", content: json } } } },
  "/api/orders": { post: { tags: ["Commerce"], operationId: "createFoodOrder", summary: "Crear pedido con cotización firmada", security: [{ bearerAuth: [] }], parameters: [idempotencyHeader], requestBody: body("FoodOrderRequest"), responses: { 200: success({ type: "object" }), ...bearerErrors } } },
  "/api/payment-provider/client-configuration": { get: { tags: ["Payments"], operationId: "getPaymentClientConfiguration", summary: "Obtener configuración pública para tokenización", security: [{ bearerAuth: [] }], parameters: [{name:"merchantId",in:"query",required:false,schema:{type:"string",maxLength:100}}], responses: { 200: success({ $ref: "#/components/schemas/PaymentClientConfigurationResponse" }), ...bearerErrors } } },
  "/api/rides/options": { post: { tags: ["Mobility"], operationId: "quoteRideOptions", summary: "Cotizar todas las categorías de viaje", requestBody: body("RideQuoteRequest"), responses: { 200: success({ $ref: "#/components/schemas/RideOptionsResponse" }), 400: errorResponses[400], 429: errorResponses[429], 503: { description: "Proveedor o configuración no disponible", content: json } } } },
  "/api/rides": { post: { tags: ["Mobility"], operationId: "createRide", summary: "Solicitar o programar un viaje", security: [{ bearerAuth: [] }], parameters: [idempotencyHeader], requestBody: body("RideCreateRequest"), responses: { 200: success({ type: "object" }), ...bearerErrors } } },
  "/api/shipments/quote": { post: { tags: ["Shipments"], operationId: "quoteShipment", summary: "Cotizar un envío y sus protecciones", requestBody: body("ShipmentQuoteRequest"), responses: { 200: success({ $ref: "#/components/schemas/QuoteResponse" }), 400: errorResponses[400], 429: errorResponses[429], 503: { description: "Proveedor o configuración no disponible", content: json } } } },
  "/api/shipments": { post: { tags: ["Shipments"], operationId: "createShipment", summary: "Crear envío con cotización firmada", security: [{ bearerAuth: [] }], parameters: [idempotencyHeader], requestBody: body("ShipmentCreateRequest"), responses: { 200: success({ type: "object" }), ...bearerErrors } } },
  "/api/merchant/payouts/authorize": { post: { tags: ["Finance"], operationId: "authorizeMerchantPayout", summary: "Reautenticar y ligar autorización a un retiro", security: [{ bearerAuth: [] }], requestBody: body("PayoutAuthorizeRequest"), responses: { 200: success({ $ref: "#/components/schemas/PayoutAuthorizationResponse" }), 400:errorResponses[400],401:errorResponses[401],403:bearerErrors[403],429:errorResponses[429] } } },
  "/api/merchant/payouts": { post: { tags: ["Finance"], operationId: "requestMerchantPayout", summary: "Reservar retiro con autorización de un solo uso", security: [{ bearerAuth: [] }], parameters:[idempotencyHeader],requestBody:body("PayoutRequest"),responses:{201:success({type:"object"}),400:errorResponses[400],401:errorResponses[401],403:bearerErrors[403],409:bearerErrors[409],429:errorResponses[429]} } },
  "/api/merchant/payment-provider":{get:{tags:["Finance"],operationId:"getMerchantPaymentConnection",summary:"Consultar conexión PSP sin exponer tokens",security:[{bearerAuth:[]}],parameters:[{name:"merchantId",in:"query",required:true,schema:{type:"string"}}],responses:{200:success({$ref:"#/components/schemas/PaymentConnectionResponse"}),401:errorResponses[401],403:bearerErrors[403]}}},
  "/api/merchant/payment-provider/connect":{post:{tags:["Finance"],operationId:"beginMerchantPaymentConnection",summary:"Crear state OAuth seller de un solo uso",security:[{bearerAuth:[]}],requestBody:{required:true,content:{"application/json":{schema:{type:"object",required:["merchantId"],properties:{merchantId:{type:"string"}}}}}},responses:{200:success({type:"object"}),401:errorResponses[401],403:bearerErrors[403],503:{description:"PSP no configurado",content:json}}}},
  "/api/merchant/payment-provider/disconnect":{post:{tags:["Finance"],operationId:"disconnectMerchantPaymentConnection",summary:"Reautenticar, revocar y borrar credenciales seller",security:[{bearerAuth:[]}],requestBody:{required:true,content:{"application/json":{schema:{type:"object",required:["merchantId","password"],properties:{merchantId:{type:"string"},password:{type:"string",minLength:4,maxLength:128,writeOnly:true}}}}}},responses:{200:success({$ref:"#/components/schemas/PaymentConnectionResponse"}),400:errorResponses[400],401:errorResponses[401],404:{description:"Conexión no encontrada",content:json},429:errorResponses[429]}}},
  "/api/payment-provider/mercadopago/callback":{get:{tags:["Finance"],operationId:"completeMerchantPaymentConnection",summary:"Consumir callback OAuth seller",parameters:[{name:"code",in:"query",required:true,schema:{type:"string"}},{name:"state",in:"query",required:true,schema:{type:"string",minLength:20}}],responses:{303:{description:"Redirección al portal sin credenciales"},429:errorResponses[429],502:{description:"Proveedor no disponible",content:json}}}},
  "/api/webhooks/mercadopago":{post:{tags:["Finance"],operationId:"receiveMercadoPagoWebhook",summary:"Validar firma y deduplicar notificación PSP",parameters:[{name:"data.id",in:"query",required:true,schema:{type:"string"}},{name:"x-signature",in:"header",required:true,schema:{type:"string"}},{name:"x-request-id",in:"header",required:true,schema:{type:"string"}}],requestBody:{required:true,content:{"application/json":{schema:{$ref:"#/components/schemas/MercadoPagoWebhook"}}}},responses:{200:{description:"Duplicado reconocido"},201:{description:"Evento firmado persistido"},400:errorResponses[400],401:errorResponses[401],503:{description:"Secret o PostgreSQL no disponible",content:json}}}},
  "/api/jobs/{jobId}/receipt":{get:{tags:["Activity"],operationId:"getServiceReceipt",summary:"Obtener comprobante no fiscal de un servicio finalizado",security:[{bearerAuth:[]}],parameters:[{name:"jobId",in:"path",required:true,schema:{type:"string",minLength:3}}],responses:{200:success({$ref:"#/components/schemas/ServiceReceiptResponse"}),401:errorResponses[401],403:bearerErrors[403],404:{description:"Servicio inexistente o ajeno",content:json},409:{description:"Servicio todavía no finalizado",content:json},503:{description:"Requiere PostgreSQL",content:json}}}},
  "/api/public/rides/track/{token}":{get:{tags:["Tracking"],operationId:"getPublicRideTracking",summary:"Consultar estado mínimo mediante enlace temporal",parameters:[{name:"token",in:"path",required:true,schema:{type:"string",pattern:"^[A-Za-z0-9_-]{40,64}$",writeOnly:true}}],responses:{200:success({$ref:"#/components/schemas/PublicRideTrackingResponse"}),404:{description:"Enlace inexistente, vencido o revocado",content:json},429:errorResponses[429]}}},
  "/api/rides/{rideId}/tracking-links":{post:{tags:["Tracking"],operationId:"createRideTrackingLink",summary:"Crear enlace temporal para un viaje propio",security:[{bearerAuth:[]}],parameters:[{name:"rideId",in:"path",required:true,schema:{type:"string",minLength:3}}],requestBody:body("RideTrackingLinkRequest"),responses:{201:success({$ref:"#/components/schemas/RideTrackingLinkResponse"}),400:errorResponses[400],401:errorResponses[401],403:bearerErrors[403],404:{description:"Viaje inexistente o ajeno",content:json},429:errorResponses[429]}}},
  "/api/rides/{rideId}/tracking-links/{linkId}":{delete:{tags:["Tracking"],operationId:"revokeRideTrackingLink",summary:"Revocar un enlace temporal propio",security:[{bearerAuth:[]}],parameters:[{name:"rideId",in:"path",required:true,schema:{type:"string",minLength:3}},{name:"linkId",in:"path",required:true,schema:{type:"string",minLength:3}}],responses:{200:success({type:"object"}),401:errorResponses[401],403:bearerErrors[403],404:{description:"Enlace inexistente o ajeno",content:json},429:errorResponses[429]}}},
});

openApiDocument.tags.push(
  { name: "Commerce", description: "Cotización y creación de pedidos de comida" },
  { name: "Mobility", description: "Cotización y solicitud de viajes" },
  { name: "Shipments", description: "Cotización y creación de envíos" },
  { name: "Finance", description: "Autorización transaccional y reserva de retiros" },
  { name: "Activity", description: "Actividad y comprobantes de servicios propios" },
  { name: "Tracking", description: "Seguimiento temporal con minimización de datos" },
);

Object.assign(openApiDocument.components.schemas, {
  CartItemInput: { type: "object", required: ["menuItemId", "quantity"], properties: { menuItemId: { type: "string", minLength: 1 }, quantity: { type: "integer", minimum: 1, maximum: 30 }, extras: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 100 }, default: [] }, note: { type: "string", maxLength: 500, default: "" } } },
  FoodQuoteRequest: { type: "object", required: ["customerId", "restaurantId", "deliveryAddressId"], properties: { customerId: { type: "string" }, restaurantId: { type: "string" }, deliveryAddressId: { type: "string", format: "uuid" }, branchId: { type: "string" }, paymentMethod: { type: "string" }, paymentMethodId: { type: "string", format: "uuid" }, promotionCode: { type: "string", minLength: 3, maxLength: 40 }, items: { type: "array", minItems: 1, maxItems: 50, items: { $ref: "#/components/schemas/CartItemInput" } } } },
  FoodOrderRequest: { allOf: [{ $ref: "#/components/schemas/FoodQuoteRequest" }, { type: "object", required: ["items", "deliveryAddress", "paymentMethod", "quoteToken"], properties: { deliveryAddress: { type: "string", minLength: 3 }, quoteToken: { type: "string", minLength: 20, writeOnly: true }, providerPayment: { $ref: "#/components/schemas/ProviderPaymentInput" } } }] },
  ProviderPaymentInput: { type: "object", required: ["cardToken", "paymentMethodId"], additionalProperties: false, properties: { cardToken: { type: "string", minLength: 8, maxLength: 256, writeOnly: true, description: "Token efímero generado por Mercado Pago; nunca PAN/CVV." }, paymentMethodId: { type: "string", minLength: 2, maxLength: 64 }, installments: { type: "integer", minimum: 1, maximum: 48, default: 1 } } },
  PaymentClientConfigurationResponse: { type: "object", required: ["ok", "requestId", "provider", "publicKey", "merchantReady", "cardDataHandling"], properties: { ok: { const: true }, requestId: { type: "string" }, provider: { enum: ["mercadopago", "disabled"] }, publicKey: { type: ["string", "null"] }, merchantReady:{type:"boolean"}, cardDataHandling: { const: "provider_tokenization_only" } } },
  RideQuoteRequest: { type: "object", required: ["pickup", "destination"], properties: { pickup: { type: "string", minLength: 3 }, destination: { type: "string", minLength: 3 }, service: { enum: ["economy", "comfort", "moto", "xl"], default: "economy" }, pickupCoords: { $ref: "#/components/schemas/Coordinate" }, destinationCoords: { $ref: "#/components/schemas/Coordinate" } } },
  RideCreateRequest: { allOf: [{ $ref: "#/components/schemas/RideQuoteRequest" }, { type: "object", required: ["customerId", "paymentMethod", "quoteToken"], properties: { customerId: { type: "string" }, paymentMethod: { type: "string", minLength: 2 }, quoteToken: { type: "string", minLength: 20, writeOnly: true }, scheduledFor: { type: "string", format: "date-time", description: "Entre 30 minutos y 30 días en el futuro." } } }] },
  RideOption: { type: "object", required: ["service", "fare", "quoteId", "quoteToken", "expiresAt"], properties: { service: { enum: ["economy", "comfort", "moto", "xl"] }, fare: { type: "number", minimum: 0 }, etaMin: { type: "integer", minimum: 0 }, pickupEtaMin: { type: "integer", minimum: 0 }, availableDrivers: { type: "integer", minimum: 0 }, available: { type: "boolean" }, quoteId: { type: "string" }, quoteToken: { type: "string", writeOnly: true }, expiresAt: { type: "string", format: "date-time" }, breakdown: { type: "object" } } },
  RideOptionsResponse: { type: "object", required: ["ok", "requestId", "options"], properties: { ok: { const: true }, requestId: { type: "string" }, options: { type: "array", items: { $ref: "#/components/schemas/RideOption" } } } },
  ShipmentQuoteRequest: { type: "object", required: ["pickup", "destination", "packageSize", "weightKg"], properties: { pickup: { type: "string", minLength: 3 }, destination: { type: "string", minLength: 3 }, packageSize: { enum: ["small", "medium", "large"] }, weightKg: { type: "number", exclusiveMinimum: 0, maximum: 20 }, declaredValue: { type: "number", minimum: 0, maximum: 1000000, default: 0 }, protection: { enum: ["none", "standard"], default: "none" }, signatureRequired: { type: "boolean", default: false }, itemCategory: { type: "string", pattern: "^[a-z][a-z0-9_]{1,31}$", default: "standard" }, serviceLevel: { type: "string", pattern: "^[a-z][a-z0-9_]{1,31}$", default: "standard" }, pickupCoords: { $ref: "#/components/schemas/Coordinate" }, destinationCoords: { $ref: "#/components/schemas/Coordinate" } } },
  ShipmentCreateRequest: { allOf: [{ $ref: "#/components/schemas/ShipmentQuoteRequest" }, { type: "object", required: ["customerId", "recipientName", "recipientPhone", "description", "paymentMethod", "termsAccepted", "quoteToken"], properties: { customerId: { type: "string" }, recipientName: { type: "string", minLength: 2, maxLength: 120 }, recipientPhone: { type: "string", minLength: 6, maxLength: 40 }, description: { type: "string", minLength: 2, maxLength: 180 }, deliveryNotes: { type: "string", maxLength: 300 }, paymentMethod: { type: "string", minLength: 2 }, termsAccepted: { const: true }, quoteToken: { type: "string", minLength: 20, writeOnly: true } } }] },
  QuoteResponse: { type: "object", required: ["ok", "requestId", "quote"], properties: { ok: { const: true }, requestId: { type: "string" }, quote: { type: "object", required: ["quoteId", "quoteToken", "expiresAt"], properties: { quoteId: { type: "string" }, quoteToken: { type: "string", writeOnly: true }, expiresAt: { type: "string", format: "date-time" }, fare: { type: "number", minimum: 0 }, total: { type: "number", minimum: 0 }, breakdown: { type: "object" } } } } },
  PayoutAuthorizeRequest:{type:"object",required:["merchantId","amount","password"],properties:{merchantId:{type:"string"},amount:{type:"number",exclusiveMinimum:0,maximum:100000000},password:{type:"string",minLength:4,maxLength:128,writeOnly:true}}},
  PayoutRequest:{type:"object",required:["merchantId","amount","authorizationToken"],properties:{merchantId:{type:"string"},amount:{type:"number",exclusiveMinimum:0,maximum:100000000},authorizationToken:{type:"string",minLength:20,writeOnly:true}}},
  PayoutAuthorizationResponse:{type:"object",required:["ok","requestId","authorizationToken","expiresAt","merchantId","amount"],properties:{ok:{const:true},requestId:{type:"string"},authorizationToken:{type:"string",writeOnly:true},expiresAt:{type:"string",format:"date-time"},merchantId:{type:"string"},amount:{type:"number"}}},
  MerchantPaymentConnection:{type:"object",required:["provider","externalAccountId","liveMode","connectedAt","status"],properties:{provider:{const:"mercadopago"},externalAccountId:{type:"string"},liveMode:{type:"boolean"},scope:{type:["string","null"]},connectedAt:{type:"string",format:"date-time"},tokenExpiresAt:{type:["string","null"],format:"date-time"},status:{enum:["connected","reconnect_required","revoked"]}}},
  PaymentConnectionResponse:{type:"object",required:["ok","requestId","configured","connection"],properties:{ok:{const:true},requestId:{type:"string"},configured:{type:"boolean"},connection:{oneOf:[{$ref:"#/components/schemas/MerchantPaymentConnection"},{type:"null"}]}}},
  MercadoPagoWebhook:{type:"object",required:["id","type","data"],properties:{id:{oneOf:[{type:"string"},{type:"number"}]},type:{enum:["order","orders","payment","mp-connect","topic_claims_integration_wh","topic_chargebacks_wh","stop_delivery_op_wh"]},action:{type:"string",maxLength:120},live_mode:{type:"boolean"},date_created:{type:"string",format:"date-time"},user_id:{oneOf:[{type:"string"},{type:"number"}]},data:{type:"object",required:["id"],properties:{id:{oneOf:[{type:"string"},{type:"number"}]}}}}},
  ServiceReceipt:{type:"object",required:["id","number","jobId","serviceKind","total","currency","lineItems","payment","issuedAt","fiscal","documentType"],properties:{id:{type:"string"},number:{type:"string"},jobId:{type:"string"},serviceKind:{enum:["delivery","ride"]},serviceSubtype:{type:["string","null"]},subtotal:{type:"number",minimum:0},discount:{type:"number",minimum:0},deliveryFee:{type:"number",minimum:0},serviceFee:{type:"number",minimum:0},total:{type:"number",minimum:0},currency:{type:"string",minLength:3,maxLength:3},lineItems:{type:"array",items:{type:"object"}},payment:{type:"object"},issuedAt:{type:"string",format:"date-time"},fiscal:{const:false},documentType:{const:"service_receipt"},metadata:{type:"object"}}},
  ServiceReceiptResponse:{type:"object",required:["ok","requestId","receipt"],properties:{ok:{const:true},requestId:{type:"string"},receipt:{$ref:"#/components/schemas/ServiceReceipt"}}},
  RideTrackingLinkRequest:{type:"object",properties:{ttlMinutes:{type:"integer",minimum:15,maximum:1440,default:120}}},
  RideTrackingLinkResponse:{type:"object",required:["ok","requestId","link"],properties:{ok:{const:true},requestId:{type:"string"},link:{type:"object",required:["id","trackingUrl","expiresAt"],properties:{id:{type:"string"},trackingUrl:{type:"string",format:"uri",writeOnly:true},expiresAt:{type:"string",format:"date-time"}}}}},
  PublicRideTrackingResponse:{type:"object",required:["ok","requestId","tracking"],properties:{ok:{const:true},requestId:{type:"string"},tracking:{type:"object",description:"Snapshot minimizado: estado, ruta general, vehículo y posición cuando corresponde; nunca teléfono, email ni payment data."}}},
});
