import {
  json,
  errorResponses,
  success,
  bearerErrors,
  idempotencyHeader,
  body,
  groupResponse,
} from "./primitives.js";

export const commercePaths = {
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
  // Las dos intervenciones de operaciones (OPS-001). Se publican porque son
  // acciones sobre el registro de un tercero: quien audite tiene que poder ver
  // que exigen motivo y que alcance tienen.
  "/api/admin/merchants/{merchantId}/status": {
    patch: {
      tags: ["Operations"],
      operationId: "setMerchantStatus",
      summary: "Suspender o reactivar el ingreso de pedidos de un comercio",
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: "merchantId",
          in: "path",
          required: true,
          schema: { type: "string", maxLength: 100 },
        },
      ],
      requestBody: body("MerchantStatusRequest"),
      responses: {
        200: success({
          type: "object",
          required: ["merchant"],
          properties: {
            merchant: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                previousStatus: { type: "string" },
                status: { type: "string", enum: ["active", "suspended"] },
                // Suspender frena lo nuevo y no cancela lo que esta en curso.
                // Este numero es lo que decide que hace el operador despues.
                openJobs: { type: "integer", minimum: 0 },
              },
            },
          },
        }),
        ...bearerErrors,
        409: { description: "El comercio ya esta en ese estado", content: json },
      },
    },
  },
  "/api/admin/jobs/{jobId}/release": {
    post: {
      tags: ["Operations"],
      operationId: "releaseJob",
      summary: "Devolver al despacho un servicio asignado que el conductor no retiro",
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "jobId", in: "path", required: true, schema: { type: "string", maxLength: 100 } },
      ],
      requestBody: body("JobReleaseRequest"),
      responses: {
        200: success({
          type: "object",
          required: ["job"],
          properties: {
            job: {
              type: "object",
              properties: {
                id: { type: "string" },
                kind: { type: "string" },
                releasedFrom: { type: "string" },
                status: { type: "string" },
              },
            },
          },
        }),
        ...bearerErrors,
        // Despues de retirar, el conductor tiene la comida encima: ahi la salida
        // es cancelar con su politica o abrir una incidencia, no reasignar.
        409: {
          description: "El servicio no tiene conductor, o el conductor ya lo retiro",
          content: json,
        },
      },
    },
  },
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
};
