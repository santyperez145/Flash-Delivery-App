// Contrato OpenAPI del perfil familiar (PAG-05).
export function familyProfilePaths({ success, json, errorResponses }) {
  const memberId = { name: "memberId", in: "path", required: true, schema: { type: "string" } };
  const comun = {
    401: errorResponses[401],
    429: errorResponses[429],
    503: { description: "Requiere PostgreSQL", content: json },
  };
  const miembro = success(
    { type: "object", properties: { member: { type: "object" } } },
    "Miembro",
  );
  const tope = {
    type: ["integer", "null"],
    minimum: 1000,
    description: "Tope por mes calendario, en pesos enteros; null es sin tope",
  };
  const respuesta = (accion) => ({
    post: {
      tags: ["Finance"],
      operationId: `${accion}FamilyInvitation`,
      summary:
        accion === "accept"
          ? "Quien fue invitado se suma al perfil familiar"
          : "Quien fue invitado rechaza el perfil familiar",
      description:
        "Al aceptar, desde el próximo pago puede elegir «Perfil familiar». Quien ya es miembro " +
        "de otro perfil, u organiza uno con personas, recibe 409.",
      security: [{ bearerAuth: [] }],
      parameters: [memberId],
      responses: {
        200: miembro,
        404: { description: "Invitación inexistente o para otra cuenta", content: json },
        409: { description: "Ya respondida, o la persona está en otro perfil", content: json },
        ...comun,
      },
    },
  });
  return {
    "/api/me/family": {
      get: {
        tags: ["Finance"],
        operationId: "getMyFamilyProfile",
        summary:
          "El perfil familiar de la persona: lo que organiza, del que es miembro y sus invitaciones",
        description:
          "Quien organiza ve a sus miembros con el email que escribió, el tope y lo gastado en el mes. " +
          "Un miembro ve quién paga, su tope y lo que le queda, nunca el saldo de quien organiza.",
        security: [{ bearerAuth: [] }],
        responses: {
          200: success({ type: "object", properties: { family: { type: "object" } } }, "Perfil"),
          ...comun,
        },
      },
    },
    "/api/family/members": {
      post: {
        tags: ["Finance"],
        operationId: "inviteFamilyMember",
        summary: "Quien organiza invita a otra cuenta Flash por email",
        description:
          "El perfil se crea con la primera invitación. Hasta nueve personas además de quien " +
          "organiza. Un email que no es de un cliente activo se guarda igual y responde lo mismo: " +
          "invitar no dice qué emails tienen cuenta. Con la verificación en dos pasos activa, pide `mfaCode`.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                properties: {
                  email: { type: "string", format: "email" },
                  monthlyLimit: tope,
                  mfaCode: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          201: miembro,
          400: errorResponses[400],
          403: { description: "Falta el código de la verificación en dos pasos", content: json },
          409: {
            description: "Repetido, perfil completo, o quien invita es miembro de otro",
            content: json,
          },
          ...comun,
        },
      },
    },
    "/api/family/members/{memberId}": {
      patch: {
        tags: ["Finance"],
        operationId: "setFamilyMemberLimit",
        summary: "Quien organiza cambia el tope por mes de un miembro",
        description: "Con la verificación en dos pasos activa, pide `mfaCode`.",
        security: [{ bearerAuth: [] }],
        parameters: [memberId],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["monthlyLimit"],
                properties: { monthlyLimit: tope, mfaCode: { type: "string" } },
              },
            },
          },
        },
        responses: {
          200: miembro,
          400: errorResponses[400],
          403: { description: "Falta el código de la verificación en dos pasos", content: json },
          404: { description: "No es un miembro del perfil de quien llama", content: json },
          ...comun,
        },
      },
      delete: {
        tags: ["Finance"],
        operationId: "removeFamilyMember",
        summary: "Quien organiza saca a un miembro o retira una invitación",
        security: [{ bearerAuth: [] }],
        parameters: [memberId],
        responses: {
          200: miembro,
          404: { description: "No es un miembro del perfil de quien llama", content: json },
          ...comun,
        },
      },
    },
    "/api/family/invitations/{memberId}/accept": respuesta("accept"),
    "/api/family/invitations/{memberId}/decline": respuesta("decline"),
    "/api/family/leave": {
      post: {
        tags: ["Finance"],
        operationId: "leaveFamilyProfile",
        summary: "El miembro deja el perfil; sus próximos pagos salen de su propia Wallet",
        security: [{ bearerAuth: [] }],
        responses: {
          200: miembro,
          404: { description: "No es miembro de un perfil", content: json },
          ...comun,
        },
      },
    },
  };
}
