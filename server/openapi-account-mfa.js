// Contrato OpenAPI de la verificación en dos pasos de cualquier cuenta (SEG-08).
//
// Las rutas existían sólo para administradores y no estaban documentadas. Ahora
// las usan clientes, conductores y comercios desde la web y la app.
export function accountMfaPaths({ success, json, errorResponses }) {
  const estado = {
    type: "object",
    required: ["enabled", "method", "confirmedAt", "lockedUntil", "recoveryCodesRemaining"],
    properties: {
      enabled: { type: "boolean" },
      method: { const: "totp" },
      confirmedAt: { type: ["string", "null"], format: "date-time" },
      lockedUntil: { type: ["string", "null"], format: "date-time" },
      recoveryCodesRemaining: { type: "integer", minimum: 0 },
    },
  };
  const conCodigo = (extra = {}) => ({
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["code", ...Object.keys(extra.required || {})],
          properties: {
            code: {
              type: "string",
              minLength: 6,
              maxLength: 32,
              writeOnly: true,
              description: "Seis dígitos de la app autenticadora, o un código de recuperación",
            },
            ...extra.properties,
          },
        },
      },
    },
  });
  const sinPostgres = { description: "Requiere PostgreSQL", content: json };
  const bloqueado = {
    description: "Cinco códigos inválidos seguidos: bloqueado quince minutos",
    content: json,
  };
  return {
    "/api/auth/mfa/status": {
      get: {
        tags: ["Auth"],
        operationId: "getMfaStatus",
        summary: "Estado de la verificación en dos pasos de la cuenta",
        security: [{ bearerAuth: [] }],
        responses: {
          200: success({ type: "object", properties: { mfa: estado } }),
          401: errorResponses[401],
        },
      },
    },
    "/api/auth/mfa/enroll": {
      post: {
        tags: ["Auth"],
        operationId: "beginMfaEnrollment",
        summary: "Empezar a activar la verificación en dos pasos",
        description:
          "Devuelve una sola vez el secreto TOTP, la URI `otpauth` y ocho códigos de recuperación. " +
          "No se activa hasta confirmar un código.",
        security: [{ bearerAuth: [] }],
        responses: {
          200: success({
            type: "object",
            properties: {
              enrollment: {
                type: "object",
                properties: {
                  secret: { type: "string", writeOnly: true },
                  otpauthUri: { type: "string", writeOnly: true },
                  recoveryCodes: { type: "array", items: { type: "string" }, writeOnly: true },
                },
              },
            },
          }),
          401: errorResponses[401],
          409: { description: "Ya está activa", content: json },
          503: sinPostgres,
        },
      },
    },
    "/api/auth/mfa/confirm": {
      post: {
        tags: ["Auth"],
        operationId: "confirmMfaEnrollment",
        summary: "Confirmar con un código y activar",
        description:
          "Emite una sesión que ya pasó el segundo factor y cierra todas las demás sesiones de la cuenta.",
        security: [{ bearerAuth: [] }],
        requestBody: conCodigo({ properties: { deviceName: { type: "string", maxLength: 160 } } }),
        responses: {
          200: success({
            type: "object",
            properties: {
              mfa: estado,
              revokedSessions: { type: "integer", minimum: 0 },
              token: { type: "string", writeOnly: true },
              refreshToken: { type: "string", writeOnly: true },
            },
          }),
          400: { description: "Código inválido", content: json },
          401: errorResponses[401],
          409: { description: "Ya está activa, o la activación cambió", content: json },
          503: sinPostgres,
        },
      },
    },
    "/api/auth/mfa/complete": {
      post: {
        tags: ["Auth"],
        operationId: "completeMfaLogin",
        summary: "Segundo paso del ingreso",
        description:
          "Cambia el desafío de cinco minutos que devolvió el ingreso (o la renovación) por una sesión. " +
          "Esa sesión recuerda que pasó el segundo factor y se renueva sin volver a pedirlo, salvo en " +
          "cuentas de administración, que lo vuelven a pasar en cada renovación.",
        requestBody: conCodigo({
          required: { challenge: true },
          properties: {
            challenge: { type: "string", minLength: 20, writeOnly: true },
            deviceName: { type: "string", maxLength: 160 },
          },
        }),
        responses: {
          200: success({ $ref: "#/components/schemas/AuthResponse" }),
          401: { description: "Desafío vencido o inválido, o código inválido", content: json },
          409: { description: "La verificación ya no está activa", content: json },
          429: bloqueado,
        },
      },
    },
    "/api/auth/mfa/disable": {
      post: {
        tags: ["Auth"],
        operationId: "disableMfa",
        summary: "Desactivar la verificación en dos pasos",
        description:
          "Pide un código vigente. Avisa por push y por email. Con `REQUIRE_ADMIN_MFA` una cuenta de " +
          "administración no puede desactivarla.",
        security: [{ bearerAuth: [] }],
        requestBody: conCodigo(),
        responses: {
          200: success({ type: "object", properties: { mfa: estado } }),
          401: errorResponses[401],
          403: {
            description: "Código inválido, o la política exige MFA para administradores",
            content: json,
          },
          409: { description: "No está activa", content: json },
          429: bloqueado,
          503: sinPostgres,
        },
      },
    },
    "/api/auth/mfa/recovery-codes": {
      post: {
        tags: ["Auth"],
        operationId: "regenerateMfaRecoveryCodes",
        summary: "Generar ocho códigos de recuperación nuevos",
        description:
          "Pide un código vigente; los anteriores dejan de servir. Avisa por push y email.",
        security: [{ bearerAuth: [] }],
        requestBody: conCodigo(),
        responses: {
          200: success({
            type: "object",
            properties: {
              mfa: estado,
              recoveryCodes: { type: "array", items: { type: "string" }, writeOnly: true },
            },
          }),
          401: errorResponses[401],
          403: { description: "Código inválido", content: json },
          409: { description: "No está activa", content: json },
          429: bloqueado,
          503: sinPostgres,
        },
      },
    },
  };
}
