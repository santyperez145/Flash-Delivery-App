// Contrato OpenAPI de los pedidos grupales (GTM-001).
//
// Se publica el ciclo entero porque es una relación entre varias personas y un
// comercio: quien integre tiene que poder ver quién puede hacer qué, y sobre todo
// que **confirmar no vive acá**: el grupo cerrado se convierte en un pedido
// normal por /api/orders.
//
// Vive aparte de `openapi.js` porque ese archivo es un monolito identificado en
// el hallazgo H-08: recibe los ayudantes del documento en lugar de duplicarlos.
export function groupOrderPaths({ success, body, bearerErrors, json, groupResponse }) {
  return {
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
          {
            name: "groupId",
            in: "path",
            required: true,
            schema: { type: "string", maxLength: 100 },
          },
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
          {
            name: "groupId",
            in: "path",
            required: true,
            schema: { type: "string", maxLength: 100 },
          },
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
          {
            name: "groupId",
            in: "path",
            required: true,
            schema: { type: "string", maxLength: 100 },
          },
        ],
        requestBody: body("GroupOrderPlacedRequest"),
        responses: { 200: success(groupResponse), ...bearerErrors },
      },
    },
  };
}
