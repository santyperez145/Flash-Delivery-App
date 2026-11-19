// Contrato OpenAPI del alta de comercios (FE-05, OPS-W01).
export function merchantApplicationPaths({ success, json, errorResponses }) {
  const estado = {
    type: "string",
    enum: ["pending", "needs_changes", "approved", "rejected"],
    description:
      "pending espera revisión; needs_changes es la observada (operaciones pidió cambios); " +
      "approved y rejected son finales",
  };
  const solicitud = {
    type: "object",
    required: [
      "id",
      "status",
      "businessName",
      "legalName",
      "taxId",
      "vertical",
      "contactPhone",
      "address",
      "lat",
      "lng",
      "notes",
      "decisionReason",
      "createdAt",
      "decidedAt",
      "merchantId",
    ],
    properties: {
      id: { type: "string" },
      status: estado,
      businessName: { type: "string" },
      legalName: { type: "string" },
      taxId: { type: "string", pattern: "^[0-9]{11}$", description: "CUIT sin guiones" },
      vertical: { type: "string", enum: ["restaurant", "grocery", "pharmacy", "kiosk", "retail"] },
      contactPhone: { type: "string", pattern: "^\\+54[0-9]{10,11}$" },
      address: { type: "string" },
      lat: { type: "number" },
      lng: { type: "number" },
      notes: { type: ["string", "null"] },
      decisionReason: { type: ["string", "null"] },
      createdAt: { type: "string", format: "date-time" },
      decidedAt: { type: ["string", "null"], format: "date-time" },
      merchantId: {
        type: ["string", "null"],
        description: "El comercio que nació al aprobarla",
      },
    },
  };
  const solicitudAdmin = {
    allOf: [
      solicitud,
      {
        type: "object",
        required: ["applicant"],
        properties: {
          applicant: {
            type: "object",
            required: ["id", "name", "email"],
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              email: { type: "string", format: "email" },
            },
          },
        },
      },
    ],
  };
  const comun = {
    401: errorResponses[401],
    429: errorResponses[429],
    503: { description: "Requiere PostgreSQL", content: json },
  };
  const sinPermiso = { description: "La sesión no tiene el rol que la ruta exige", content: json };
  return {
    "/api/applications/merchant": {
      post: {
        tags: ["Commerce"],
        operationId: "submitMerchantApplication",
        summary: "Postular un comercio a Flash",
        description:
          "Cualquier cuenta con sesión. El CUIT se valida con su dígito verificador. Una persona " +
          "tiene a lo sumo una solicitud abierta (pending o needs_changes): otra responde 409, " +
          "igual que quien ya tiene un comercio.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: [
                  "businessName",
                  "legalName",
                  "taxId",
                  "vertical",
                  "contactPhone",
                  "address",
                  "lat",
                  "lng",
                ],
                properties: {
                  businessName: { type: "string", minLength: 2, maxLength: 120 },
                  legalName: { type: "string", minLength: 2, maxLength: 160 },
                  taxId: { type: "string", description: "11 números, con o sin guiones" },
                  vertical: solicitud.properties.vertical,
                  contactPhone: solicitud.properties.contactPhone,
                  address: { type: "string", minLength: 5, maxLength: 240 },
                  lat: { type: "number", minimum: -90, maximum: 90 },
                  lng: { type: "number", minimum: -180, maximum: 180 },
                  notes: { type: "string", maxLength: 500 },
                },
              },
            },
          },
        },
        responses: {
          201: success(
            { type: "object", properties: { application: solicitud } },
            "Solicitud recibida",
          ),
          400: errorResponses[400],
          409: { description: "Ya hay una solicitud en curso o un comercio", content: json },
          ...comun,
        },
      },
    },
    "/api/applications/me": {
      get: {
        tags: ["Commerce"],
        operationId: "getMyMerchantApplications",
        summary: "Las solicitudes de la persona, la más nueva primero",
        description: "Con el motivo de la última decisión, para saber qué cambiar.",
        security: [{ bearerAuth: [] }],
        responses: {
          200: success(
            {
              type: "object",
              properties: { applications: { type: "array", items: solicitud } },
            },
            "Solicitudes",
          ),
          ...comun,
        },
      },
    },
    "/api/admin/merchant-applications": {
      get: {
        tags: ["Operations"],
        operationId: "listAdminMerchantApplications",
        summary: "La cola de solicitudes de comercio, de a 25",
        description:
          "Admin y soporte. Abiertas, la más vieja primero; resueltas, la más nueva primero. " +
          "Paginada por cursor sobre (created_at, id).",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "status",
            in: "query",
            required: false,
            schema: { ...estado, default: "pending" },
          },
          { name: "cursor", in: "query", required: false, schema: { type: "string" } },
        ],
        responses: {
          200: success(
            {
              type: "object",
              properties: {
                applications: { type: "array", items: solicitudAdmin },
                nextCursor: { type: ["string", "null"] },
              },
            },
            "Página de solicitudes",
          ),
          400: errorResponses[400],
          403: sinPermiso,
          ...comun,
        },
      },
    },
    "/api/admin/merchant-applications/{applicationId}/decision": {
      post: {
        tags: ["Operations"],
        operationId: "decideMerchantApplication",
        summary: "Aprobar, pedir cambios o rechazar una solicitud",
        description:
          "Sólo admin. Aprobar crea, en una transacción con la solicitud bloqueada, el comercio " +
          "(activo y cerrado) y su sucursal principal sin horario, y recién ahí otorga el rol " +
          "merchant; queda auditado y quien se postuló recibe un aviso. Pedir cambios y rechazar " +
          "exigen motivo. Una solicitud ya resuelta responde 409.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "applicationId", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["decision"],
                properties: {
                  decision: { type: "string", enum: ["approve", "reject", "needs_changes"] },
                  reason: {
                    type: "string",
                    minLength: 5,
                    maxLength: 500,
                    description: "Obligatorio para reject y needs_changes",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: success(
            {
              type: "object",
              properties: {
                application: solicitudAdmin,
                merchant: {
                  type: "object",
                  description: "Sólo al aprobar",
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    status: { type: "string" },
                    open: { type: "boolean" },
                  },
                },
              },
            },
            "Decisión registrada",
          ),
          400: errorResponses[400],
          403: sinPermiso,
          404: { description: "Solicitud inexistente", content: json },
          409: {
            description:
              "Ya resuelta, cuenta inactiva, ya tiene comercio o la dirección queda fuera de las ciudades",
            content: json,
          },
          ...comun,
        },
      },
    },
  };
}
