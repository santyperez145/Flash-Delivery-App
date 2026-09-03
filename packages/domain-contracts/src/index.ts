// Contratos de dominio idénticos entre web y mobile (ARC-001 paso 6).
//
// Sólo entran tipos byte-a-byte iguales y autocontenidos, o la intersección /
// proyección autoritativa del servidor cuando ambas superficies ya la consumen.
// `Order`/`OrderItem`, `RestaurantSummary`, `MenuItemSummary`, `RestaurantBranch`,
// `DriverSummary`/`DriverServiceMode` y `MerchantOperationsDashboardCore` son
// núcleos compartidos; web/mobile extienden con vitrina, GPS KYC o `Restaurant`
// local. Extras del comercio siguen locales (sólo web).

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

export type FoodCheckoutQuote = {
  quoteId: string;
  quoteToken: string;
  expiresAt: string;
  customerId: string;
  restaurantId: string;
  branchId: string;
  deliveryAddressId: string;
  deliveryAddress: string;
  distanceKm: number;
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
  /** Penalización por incidentes reales (no false_alarm) en 30 días. */
  incidentPenalty?: number;
  /** Radio espacial usado en la oleada (metros). */
  searchRadiusM?: number;
  /** True si el radio se expandió respecto del configurado. */
  radiusExpanded?: boolean;
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

/**
 * Núcleo del dashboard merchant sin `restaurant` tipado (ARC-001).
 * Web/mobile lo extienden con su `Restaurant` local todavía divergente.
 */
export type MerchantOperationsDashboardCore = {
  generatedAt: string;
  source: "postgres-live-operations" | "sqlite-test-fallback";
  timezone: string;
  restaurantId: string;
  branch: null | {
    id: string;
    name: string;
    timezone: string;
    open: boolean;
    manualOpen: boolean;
    status: "active" | "paused" | "closed";
    etaMin: number;
  };
  metrics: MerchantOperationsMetrics;
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
};

/** Roles del enum PostgreSQL `user_role`. No incluye roles inventados en OpenAPI. */
export type UserRole = "customer" | "merchant" | "driver" | "admin" | "support";

/** Estado de cuenta en `users.status`. */
export type UserStatus = "active" | "suspended" | "pending";

/**
 * Proyección pública de usuario (`sanitizeUser` / `mapUser`).
 *
 * Incluye lo que el servidor expone tras quitar hash, id interno y lock de
 * login. `phone` es string (puede ser vacío); la verificación vive aparte.
 */
export type User = {
  id: string;
  name: string;
  email: string;
  roles: UserRole[];
  phone: string;
  wallet: number;
  defaultAddress?: string;
  restaurantId?: string;
  driverId?: string;
  status?: UserStatus;
  emailVerifiedAt?: string | null;
  phoneVerifiedAt?: string | null;
};

/** Ciclo de cocina / entrega de un pedido de comida. */
export type OrderStatus =
  | "requested"
  | "accepted"
  | "preparing"
  | "ready_for_pickup"
  | "courier_assigned"
  | "picked_up"
  | "delivering"
  | "delivered"
  | "cancelled";

/** Línea de pedido tal como la devuelve el servidor tras checkout/cocina. */
export type OrderItem = {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  extras: string[];
  note: string;
};

/** Núcleo compartido de un pedido de comida entre web y mobile. */
export type Order = {
  id: string;
  customerId: string;
  restaurantId: string;
  branchId?: string | null;
  courierId: string | null;
  status: OrderStatus;
  deliveryAddress: string;
  pickupLocation?: GeoPoint | null;
  deliveryLocation?: GeoPoint | null;
  paymentMethod?: string;
  /** Horario reservado. `null` es «lo antes posible». */
  scheduledFor?: string | null;
  total: number;
  etaMin: number;
  createdAt?: string;
  items: OrderItem[];
};

/**
 * Modo de servicio del conductor — idéntico en web y mobile.
 */
export type DriverServiceMode = "delivery" | "ride";

/**
 * Núcleo de conductor compartido (ARC-001).
 * Mobile añade vehículo KYC y frescura GPS (source/accuracy).
 */
export type DriverSummary = {
  id: string;
  userId: string;
  name: string;
  online: boolean;
  serviceModes: DriverServiceMode[];
  activeService: DriverServiceMode;
  vehicle: string;
  plate: string;
  rating: number;
  earningsToday: number;
  location: GeoPoint & {
    label: string;
    updatedAt?: string | null;
  };
};

/**
 * Vehículo KYC del conductor — idéntico en web (ops) y mobile (cuenta).
 */
export type DriverVehicle = {
  id: string;
  driverId: string;
  kind: "bicycle" | "motorcycle" | "car" | "van";
  model: string;
  plate: string;
  color: string | null;
  seats: number | null;
  serviceModes: DriverServiceMode[];
  active: boolean;
  status: "pending" | "approved" | "rejected";
  rejectionReason: string | null;
  reviewedAt: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Ítem de catálogo: intersección operativa web/mobile (ARC-001).
 * Web añade rating/ETA/kcal/imagen/tags; mobile consume el núcleo.
 */
export type MenuModifier = {
  id: string;
  name: string;
  price: number;
  available: boolean;
};

export type MenuModifierGroup = {
  id: string;
  name: string;
  min: number;
  max: number;
  required: boolean;
  modifiers: MenuModifier[];
};

export type MenuItemSummary = {
  id: string;
  name: string;
  price: number;
  stock: boolean;
  description?: string;
  category?: string;
  modifierGroups?: MenuModifierGroup[];
  dietaryLabels?: Array<{ code: string; name: string }>;
  allergens?: Array<{
    code: string;
    name: string;
    presence: "contains" | "may_contain";
  }>;
};

/** Sucursal con horario e inventario por ítem — idéntica en web y mobile. */
export type RestaurantBranch = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  open: boolean;
  manualOpen: boolean;
  status: "active" | "paused" | "closed";
  etaMin: number;
  isPrimary: boolean;
  timezone: string;
  weeklyHours: Array<{
    weekday: number;
    opensAt: string;
    closesAt: string;
    enabled: boolean;
  }>;
  scheduleExceptions: Array<{
    date: string;
    isOpen: boolean;
    opensAt: string | null;
    closesAt: string | null;
    reason: string | null;
  }>;
  inventory: Record<string, { available: boolean; stockQuantity: number | null; version: number }>;
};

/**
 * Proyección de restaurante compartida entre web y mobile (listados, cards, quote).
 *
 * Menú/sucursales: `MenuItemSummary` y `RestaurantBranch`. Web añade extras,
 * coordenadas y campos de vitrina del ítem; mobile usa el núcleo del menú.
 */
export type RestaurantSummary = {
  id: string;
  ownerId: string;
  name: string;
  cuisine: string;
  rating: number;
  etaMin: number;
  deliveryFee: number;
  open: boolean;
  manualOpen?: boolean;
  address: string;
  image: string;
  cover: string;
  badge: string;
  distanceKm: number;
};

/** Ciclo de un viaje. */
export type RideStatus =
  | "requested"
  | "driver_assigned"
  | "arriving"
  | "in_progress"
  | "completed"
  | "cancelled";

/** Nivel de servicio de un viaje — idéntico en web y mobile. */
export type RideService = "economy" | "comfort" | "moto" | "xl";

/**
 * Núcleo de viaje compartido (ARC-001).
 * Web añade pago, createdAt y timeline; mobile añade cancelación.
 */
export type RideSummary = {
  id: string;
  customerId: string;
  driverId: string | null;
  status: RideStatus;
  service: RideService;
  pickup: string;
  destination: string;
  pickupLocation?: GeoPoint | null;
  destinationLocation?: GeoPoint | null;
  distanceKm: number;
  etaMin: number;
  durationMin: number;
  fare: number;
  scheduledFor?: string | null;
};

/** Ciclo de un envío. */
export type ShipmentStatus =
  | "requested"
  | "driver_assigned"
  | "arriving"
  | "picked_up"
  | "delivering"
  | "delivered"
  | "cancelled";

export type ShipmentPackageSize = "small" | "medium" | "large";
export type ShipmentProtection = "none" | "standard";
export type ShipmentItemCategory = "documents" | "standard" | "fragile" | "electronics";
export type ShipmentServiceLevel = "economy" | "standard" | "priority" | "express";

/**
 * Núcleo de envío compartido (ARC-001).
 * Mobile añade cancelación de servicio; el resto es byte-a-byte.
 */
export type ShipmentSummary = {
  id: string;
  customerId: string;
  driverId: string | null;
  status: ShipmentStatus;
  pickup: string;
  destination: string;
  pickupLocation?: GeoPoint | null;
  destinationLocation?: GeoPoint | null;
  recipientName: string;
  recipientPhone: string;
  packageSize: ShipmentPackageSize;
  description: string;
  weightKg: number;
  deliveryNotes: string;
  declaredValue?: number;
  protection?: ShipmentProtection;
  protectionPremium?: number;
  signatureRequired?: boolean;
  itemCategory?: ShipmentItemCategory;
  serviceLevel?: ShipmentServiceLevel;
  handlingInstructions?: string;
  distanceKm: number;
  etaMin: number;
  fare: number;
  deliveryPin?: string;
  deliveryEvidenceCount?: number;
  deliveryVerifiedAt?: string | null;
  timeline?: Array<{ status: string; at: string }>;
};
