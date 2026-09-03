export const domainSchemas = {
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
  MerchantStatusRequest: {
    type: "object",
    required: ["status", "reason"],
    properties: {
      status: { type: "string", enum: ["active", "suspended"] },
      // Obligatorio: es una decision sobre el registro de un tercero, y el dia
      // del reclamo lo que se lee es el log de auditoria.
      reason: { type: "string", minLength: 5, maxLength: 500 },
    },
  },
  JobReleaseRequest: {
    type: "object",
    required: ["reason"],
    properties: { reason: { type: "string", minLength: 5, maxLength: 500 } },
  },
  JobAssignRequest: {
    type: "object",
    required: ["driverId", "reason"],
    properties: {
      driverId: { type: "string", minLength: 3, maxLength: 100 },
      reason: { type: "string", minLength: 5, maxLength: 500 },
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
};
