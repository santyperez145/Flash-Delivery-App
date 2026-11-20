// Contrato OpenAPI del alta de repartidores y conductores (FE-06, OPS-W01 y OPS-W21).
export function driverApplicationPaths({ success, json, errorResponses }) {
  const servicios = {
    type: "array",
    items: { type: "string", enum: ["delivery", "ride"] },
    minItems: 1,
    maxItems: 2,
  };
  const estadoLegajo = {
    type: "string",
    enum: ["pending", "in_review", "approved", "rejected", "suspended"],
    description: "El estado del legajo: approved permite conectarse con un vehículo aprobado",
  };
  const tipoDocumento = {
    type: "string",
    enum: ["identity", "driver_license", "vehicle_registration", "insurance", "background_check"],
  };
  const postulacion = {
    type: "object",
    required: ["driverId", "services", "status", "rejectionReason", "city", "createdAt"],
    properties: {
      driverId: { type: "string" },
      services: servicios,
      status: estadoLegajo,
      rejectionReason: { type: ["string", "null"] },
      city: {
        type: ["object", "null"],
        properties: { id: { type: "string" }, name: { type: "string" } },
      },
      createdAt: { type: "string", format: "date-time" },
    },
  };
  const comun = {
    401: errorResponses[401],
    429: errorResponses[429],
    503: { description: "Requiere PostgreSQL", content: json },
  };
  return {
    "/api/applications/driver": {
      post: {
        tags: ["Mobility"],
        operationId: "submitDriverApplication",
        summary: "Postularse para repartir o manejar",
        description:
          "Cualquier cuenta con sesión y teléfono verificado (si no, 409 con " +
          "code=phone_verification_required). Crea en una transacción el conductor desconectado, " +
          "el legajo pendiente, el vehículo en revisión y el rol driver. Una bicicleta no lleva " +
          "patente; moto y auto sí. Llevar pasajeros exige auto con asientos. Una persona que ya " +
          "es conductor recibe 409 con su driverId; una patente repetida, 409 sin crear nada.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["cityId", "services", "vehicle"],
                properties: {
                  cityId: { type: "string", description: "Una ciudad en beta o activa" },
                  services: servicios,
                  vehicle: {
                    type: "object",
                    required: ["kind", "model"],
                    properties: {
                      kind: { type: "string", enum: ["bicycle", "motorcycle", "car"] },
                      model: { type: "string", minLength: 2, maxLength: 80 },
                      plate: { type: ["string", "null"], pattern: "^[A-Za-z0-9 -]{3,16}$" },
                      color: { type: ["string", "null"], maxLength: 40 },
                      seats: { type: ["integer", "null"], minimum: 1, maximum: 8 },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          201: success(
            {
              type: "object",
              properties: { application: postulacion, vehicleId: { type: "string" } },
            },
            "Postulación recibida: el conductor existe y no puede conectarse todavía",
          ),
          400: errorResponses[400],
          409: {
            description: "Sin teléfono verificado, ya registrado o patente repetida",
            content: json,
          },
          ...comun,
        },
      },
    },
    "/api/applications/driver/me": {
      get: {
        tags: ["Mobility"],
        operationId: "getMyDriverApplication",
        summary: "La postulación propia, o null si no hay",
        security: [{ bearerAuth: [] }],
        responses: {
          200: success(
            {
              type: "object",
              properties: { application: { oneOf: [postulacion, { type: "null" }] } },
            },
            "Postulación",
          ),
          ...comun,
        },
      },
    },
    "/api/admin/driver-applications": {
      get: {
        tags: ["Operations"],
        operationId: "listDriverApplicationsForReview",
        summary: "La cola de legajos, de a 25, el más viejo primero",
        description:
          "Admin y soporte. pending trae a quien tiene un documento o un vehículo esperando " +
          "revisión; approved y rejected, por el estado del legajo. Cada conductor viene con sus " +
          "documentos vigentes (el más nuevo de cada tipo, sin contenido) y sus vehículos: la " +
          "revisión no hace un pedido por fila. El contenido se pide en " +
          "/api/driver-documents/{documentId}/content.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "status",
            in: "query",
            required: false,
            schema: {
              type: "string",
              enum: ["pending", "approved", "rejected"],
              default: "pending",
            },
          },
          { name: "cursor", in: "query", required: false, schema: { type: "string" } },
        ],
        responses: {
          200: success(
            {
              type: "object",
              properties: {
                drivers: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      status: estadoLegajo,
                      requiredTypes: { type: "array", items: tipoDocumento },
                      documents: { type: "array", items: { type: "object" } },
                      vehicles: { type: "array", items: { type: "object" } },
                    },
                  },
                },
                nextCursor: { type: ["string", "null"] },
              },
            },
            "Página de legajos",
          ),
          400: errorResponses[400],
          403: { description: "La sesión no es de admin ni de soporte", content: json },
          ...comun,
        },
      },
    },
  };
}
