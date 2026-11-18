// Contrato OpenAPI de las ganancias del repartidor (RES-05).
//
// Vive aparte de `openapi.js` porque ese archivo es un monolito identificado en
// el hallazgo H-08: sumar el desglose por servicio adentro lo habría hecho crecer.
export const driverEarningsSchemas = {
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
      breakdown: {
        description:
          "Viajes y envíos: lo cobrado y lo que retuvo Flash, del mismo asiento contable.",
        oneOf: [
          { type: "null" },
          {
            type: "object",
            required: ["customerPaid", "platformFee"],
            properties: { customerPaid: { type: "number" }, platformFee: { type: "number" } },
          },
        ],
      },
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
};
