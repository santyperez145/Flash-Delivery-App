// Contratos de dominio idénticos entre web y mobile (ARC-001 paso 6).
//
// Sólo entran tipos byte-a-byte iguales y autocontenidos. User, Order,
// Restaurant y el resto de divergencias reales se unifican en entregas
// posteriores; reexportar una mentira compartida sería peor que duplicar.

export type DietaryPreferences = {
  dietaryLabels: Array<{ code: string; name: string }>;
  avoidedAllergens: Array<{ code: string; name: string }>;
  hideIncompatible: boolean;
};

export type GeoPoint = {
  lat: number;
  lng: number;
};

export type DeliveryEvidence = {
  id: string;
  shipmentId: string;
  type: "photo" | "signature";
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  sha256: string;
  sizeBytes: number;
  capturedLocation: GeoPoint | null;
  capturedAt: string;
  createdAt: string;
  signerName?: string | null;
  signerRelationship?: "recipient" | "authorized_person" | null;
  consentVersion?: string | null;
};

export type AppNotification = {
  id: string;
  channel: "push" | "email" | "sms" | "in_app";
  template: string;
  payload: Record<string, unknown>;
  status: string;
  createdAt: string;
  readAt: string | null;
};

export type NotificationPreference = {
  category: "service_updates" | "promotions" | "support" | "wallet" | "account";
  pushEnabled: boolean;
  emailEnabled: boolean;
  updatedAt: string | null;
};

export type OrderIssue = {
  id: string;
  orderId: string;
  category: "missing_item" | "wrong_item" | "damaged_item" | "quality" | "late" | "other";
  description: string;
  status: "open" | "approved" | "rejected";
  requestedRefund: number;
  approvedRefund: number;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type OrderSubstitution = {
  id: string;
  orderId: string;
  status: "pending" | "accepted" | "rejected" | "cancelled";
  quantity: number;
  reason: string;
  original: { id: string; name: string; unitPrice: number };
  replacement: { id: string; name: string; unitPrice: number };
  refundAmount: number;
  createdAt: string;
  decidedAt: string | null;
};

export type UserAddress = {
  id: string;
  userId: string;
  label: string;
  address: string;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
  geocodingProvider: string | null;
  providerPlaceId: string | null;
  geocodeType: string | null;
  validatedAt: string | null;
  isValidated: boolean;
};

/** Lo que las dos formas de recibir un pedido comparten: el precio firmado. */
type FoodCheckoutQuoteBase = {
  quoteId: string;
  quoteToken: string;
  expiresAt: string;
  customerId: string;
  restaurantId: string;
  branchId: string;
  deliveryFee: number;
  serviceFee: number;
  subtotal: number;
  discount: number;
  /** Envío cubierto por la suscripción. Va aparte de `discount` porque no lo
   *  financia el comercio sino Flash, y el resumen tiene que poder nombrarlo. */
  subscriptionDiscount: number;
  subscriptionPlan: string | null;
  promotionCode: string | null;
  total: number;
  etaMin: number;
  paymentMethod: string;
  paymentMethodId: string | null;
  pricingVersion: string;
  currency: string;
  items: Array<{
    menuItemId: string;
    name: string;
    quantity: number;
    baseUnitPrice: number;
    unitPrice: number;
    modifiers: Array<{
      id: string;
      name: string;
      price: number;
      groupId: string;
      groupName: string;
    }>;
    note: string;
  }>;
};

/**
 * La cotizacion del checkout de comida, en sus dos modos (GTM-002).
 *
 * **Es una union discriminada y no un tipo con campos opcionales.** En retiro no
 * existe direccion del cliente ni distancia: no es que falten, es que no tienen
 * sentido. Con campos opcionales, `quote.deliveryAddress` compila en los dos
 * modos y en retiro imprime `undefined` en pantalla — que es exactamente el
 * defecto que este tipo existe para impedir. Con la union, el compilador obliga
 * a cada pantalla que lea la direccion a decir primero cual de los dos modos
 * esta mostrando.
 */
/**
 * Cómo se entrega un pedido de comida (P-02). Modo cerrado —en mano o en la
 * puerta—, indicaciones para quien reparte y si lleva cubiertos.
 */
export type DropoffMode = "hand_to_me" | "leave_at_door";
export type DeliveryPreferences = {
  dropoff: DropoffMode;
  /** Hasta 300 caracteres. Sólo las ven el cliente, quien reparte y operaciones. */
  instructions: string;
  cutlery: boolean;
};
/**
 * Lo que llega de un pedido según quién lo mira: el comercio recibe sólo
 * `cutlery`; un repartidor sin asignar, `dropoff` y `hasInstructions`.
 */
export type DeliveryPreferencesView = Partial<DeliveryPreferences> & { hasInstructions?: boolean };

/** Rubro de un comercio: el CHECK de `merchants.vertical` (migración 001). */
export type MerchantVertical = "restaurant" | "grocery" | "pharmacy" | "kiosk" | "retail";

/** Un rubro con comercios activos, como lo devuelve `/api/catalog/verticals`. */
export type CatalogVertical = { vertical: MerchantVertical; merchants: number };

export type FoodCheckoutQuote =
  | (FoodCheckoutQuoteBase & {
      fulfillment: "delivery";
      deliveryAddressId: string;
      deliveryAddress: string;
      distanceKm: number;
    })
  | (FoodCheckoutQuoteBase & {
      fulfillment: "pickup";
      /** La direccion del local: es a donde va el cliente, y lo que queda en el
       *  comprobante. */
      pickupAddress: string;
      merchantName: string;
      pickupCoords: { lat: number; lng: number };
    });

export type ShipmentReturn = {
  id: string;
  shipmentId: string;
  reason: string;
  status: "requested" | "approved" | "rejected" | "in_transit" | "completed";
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ShipmentClaimEvidence = {
  id: string;
  fileName: string;
  mimeType: "image/jpeg" | "image/png" | "application/pdf";
  sha256: string;
  sizeBytes: number;
  createdAt: string;
};

export type DriverDocument = {
  id: string;
  type: "identity" | "driver_license" | "vehicle_registration" | "insurance" | "background_check";
  mimeType: string;
  sha256: string;
  sizeBytes: number;
  expiresAt: string | null;
  status: "pending" | "approved" | "rejected" | "expired" | "superseded";
  rejectionReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type DriverCompliance = {
  driverId: string;
  status: "pending" | "in_review" | "approved" | "rejected" | "suspended";
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  requiredTypes: DriverDocument["type"][];
  documents: DriverDocument[];
};

export type ServiceTip = {
  id: string;
  jobId: string;
  customerId: string;
  driverId: string;
  amount: number;
  createdAt: string;
};

export type DispatchScoreBreakdown = {
  rating: number;
  distancePenalty: number;
  loadPenalty: number;
  freshnessPenalty: number;
  acceptancePoints: number;
  responsePoints: number;
  acceptanceRate: number;
  averageResponseSeconds: number;
};

export type MerchantOperationsMetrics = {
  activeOrders: number;
  needsAction: number;
  preparing: number;
  readyForPickup: number;
  courierFlow: number;
  lateOrders: number;
  untrackedPrepOrders: number;
  oldestActiveMinutes: number;
  completedToday: number;
  cancelledToday: number;
  grossSalesToday: number;
  averageTicketToday: number;
  unavailableItems: number;
};

export type SubscriptionPlan = {
  id: string;
  planKey: string;
  planName: string;
  description: string;
  priceCents: number;
  currency: string;
  billingPeriodDays: number;
  freeDeliveryMinSubtotalCents: number | null;
  rideDiscountBps: number;
  dispatchPriorityBoost: number;
};

export type Subscription = SubscriptionPlan & {
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  /** `false` después de cancelar: los beneficios siguen hasta el fin del período. */
  renews: boolean;
  /** `false` mientras el cobro recurrente (PAY-001) no tenga credenciales. */
  billed: boolean;
};

/** Pedido grupal (GTM-001). Cada participante tiene su propia canasta; el
 *  anfitrión cierra y confirma, y el grupo se vuelve un pedido normal. */

export type GroupOrderParticipant = {
  userId: string;
  name: string;
  isHost: boolean;
  items: Array<{
    menuItemId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    extras: string[];
    note: string;
  }>;
  subtotal: number;
};

export type GroupOrder = {
  id: string;
  /** Seis caracteres para compartir. Sólo lo ve quien ya está adentro. */
  joinCode: string;
  status: "open" | "locked" | "placed" | "cancelled";
  restaurantId: string;
  restaurantName: string;
  branchId: string;
  hostId: string;
  hostName: string;
  /** Tope de gasto por persona. `null` es sin tope. */
  spendLimit: number | null;
  closesAt: string | null;
  orderId: string | null;
  createdAt: string;
  participants: GroupOrderParticipant[];
  subtotal: number;
};

/** Respuesta rápida de soporte in-app (cuerpo + audiencia + alcance). */
export type ServiceQuickReply = {
  id: string;
  serviceScope: "all" | "food" | "ride" | "shipment";
  audience: "customer" | "driver" | "merchant";
  locale: string;
  body: string;
  position: number;
  active: boolean;
  updatedAt: string;
};

/** Reclamo de envío protegido (pérdida / daño / robo). */
export type ShipmentClaim = {
  id: string;
  shipmentId: string;
  claimType: "lost" | "damaged" | "stolen";
  description: string;
  requestedAmount: number;
  eligibleAmount: number;
  approvedAmount: number | null;
  status: "submitted" | "under_review" | "approved" | "rejected" | "settlement_pending" | "settled";
  resolutionNote: string | null;
  evidence: ShipmentClaimEvidence[];
  createdAt: string;
  updatedAt: string;
};

/** Oferta de despacho pendiente para un conductor. */
export type DispatchOffer = {
  id: string;
  jobId: string;
  kind: "ride" | "delivery";
  subtype: string | null;
  serviceLevel: string;
  pickup: string;
  destination: string;
  fare: number;
  distanceKm: number;
  durationMin: number;
  score: number;
  scoreBreakdown?: DispatchScoreBreakdown;
  expiresAt: string;
  status: "pending";
  /** Antes de aceptar: si es sin contacto y si trae indicaciones, nunca el texto (P-02). */
  leaveAtDoor?: boolean;
  hasInstructions?: boolean;
  /** PAG-01: el viaje se cobra en efectivo. */
  cash?: boolean;
};

/** SEG-01: una señal del control del viaje que el pasajero todavía no contestó. */
export type RideTripCheckKind = "long_stop" | "signal_lost" | "route_deviation" | "early_end";
export type RideTripCheck = { id: string; kind: RideTripCheckKind; detectedAt: string };

/** PAG-02: una persona con la que se divide la tarifa de un viaje. */
export type FareSplit = {
  id: string;
  name: string;
  status: "invited" | "accepted" | "declined" | "cancelled";
  paid: number;
};

/** PAG-02: una invitación pendiente a dividir un viaje, con la parte que tocaría. */
export type FareSplitInvitation = {
  id: string;
  rideId: string;
  inviterName: string;
  destination: string;
  share: number;
};

/** PAG-04: una tarjeta de regalo que compró la persona. El código, sólo mientras está vigente. */
export type GiftCard = {
  id: string;
  amount: number;
  status: "active" | "redeemed" | "cancelled";
  code: string | null;
  last4: string;
  recipientEmail: string | null;
  message: string | null;
  createdAt: string;
  redeemedAt: string | null;
  cancelledAt: string | null;
};

/** PAG-04: una tarjeta dirigida a la cuenta, para canjear sin escribir el código. */
export type ReceivedGiftCard = {
  id: string;
  amount: number;
  fromName: string;
  message: string | null;
  createdAt: string;
};

/** PAG-05: la etiqueta del medio de pago «Perfil familiar» en pedidos, viajes y envíos. */
export type FamilyPaymentLabel = "Perfil familiar";

/** PAG-05: una persona del perfil familiar, vista por quien organiza. */
export type FamilyMember = {
  id: string;
  /** Primer nombre; `null` mientras la invitación no se aceptó. */
  name: string | null;
  /** El email que escribió quien organiza. */
  email?: string | null;
  status: "invited" | "active";
  /** Tope por mes en pesos; `null` es sin tope. */
  monthlyLimit: number | null;
  spentThisMonth: number;
};

/** PAG-05: un cobro pagado con el perfil familiar. */
export type FamilyCharge = {
  jobId: string;
  service: "order" | "ride" | "shipment";
  memberName: string;
  amount: number;
  /** Lo devuelto a quien organiza por cancelación o reclamo. */
  refunded: number;
  /** Estado del servicio: el comprobante está cuando es «completed». */
  status: string;
  createdAt: string;
};

/** PAG-05: el perfil familiar desde el punto de vista de la persona. */
export type FamilyProfile = {
  role: "organizer" | "member" | "none";
  organizer: {
    id: string;
    members: FamilyMember[];
    activeMembers: number;
    maxMembers: number;
    /** Lo que se pagó con el perfil: el comprobante de cada cobro, para quien organiza. */
    charges: FamilyCharge[];
  } | null;
  /** Si es miembro: quién paga, su tope y lo que le queda. Nunca el saldo de quien organiza. */
  membership: {
    id: string;
    organizerName: string;
    monthlyLimit: number | null;
    spentThisMonth: number;
    remaining: number | null;
  } | null;
  invitations: {
    id: string;
    organizerName: string;
    monthlyLimit: number | null;
    createdAt: string;
  }[];
};

/** SEG-08: la verificación en dos pasos de la cuenta. */
export type MfaStatus = {
  enabled: boolean;
  method: string;
  confirmedAt: string | null;
  lockedUntil: string | null;
  recoveryCodesRemaining: number;
};

/** SEG-08: lo que se muestra una sola vez al empezar a activarla. */
export type MfaEnrollment = { secret: string; otpauthUri: string; recoveryCodes: string[] };
