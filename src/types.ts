import type {
  DietaryPreferences,
  GeoPoint,
  DeliveryEvidence,
  AppNotification,
  NotificationPreference,
  OrderIssue,
  OrderSubstitution,
  UserAddress,
  FoodCheckoutQuote,
  MerchantVertical,
  CatalogVertical,
  DeliveryPreferences,
  DeliveryPreferencesView,
  DropoffMode,
  ShipmentReturn,
  ShipmentClaimEvidence,
  DriverDocument,
  DriverCompliance,
  ServiceTip,
  DispatchScoreBreakdown,
  MerchantOperationsMetrics,
  SubscriptionPlan,
  Subscription,
  GroupOrderParticipant,
  GroupOrder,
  ServiceQuickReply,
  ShipmentClaim,
  DispatchOffer,
  RideTripCheck,
  FareSplit,
  FareSplitInvitation,
  GiftCard,
  ReceivedGiftCard,
  FamilyMember,
  CashPayment,
  OrderBatch,
  FamilyCharge,
  FamilyProfile,
  FamilyPaymentLabel,
  MfaStatus,
  MfaEnrollment,
} from "@flash/domain-contracts";

export type {
  DietaryPreferences,
  GeoPoint,
  DeliveryEvidence,
  AppNotification,
  NotificationPreference,
  OrderIssue,
  OrderSubstitution,
  UserAddress,
  FoodCheckoutQuote,
  MerchantVertical,
  CatalogVertical,
  DeliveryPreferences,
  DeliveryPreferencesView,
  DropoffMode,
  ShipmentReturn,
  ShipmentClaimEvidence,
  DriverDocument,
  DriverCompliance,
  ServiceTip,
  DispatchScoreBreakdown,
  MerchantOperationsMetrics,
  SubscriptionPlan,
  Subscription,
  GroupOrderParticipant,
  GroupOrder,
  ServiceQuickReply,
  ShipmentClaim,
  DispatchOffer,
  RideTripCheck,
  FareSplit,
  FareSplitInvitation,
  GiftCard,
  ReceivedGiftCard,
  FamilyMember,
  CashPayment,
  OrderBatch,
  FamilyCharge,
  FamilyProfile,
  FamilyPaymentLabel,
  MfaStatus,
  MfaEnrollment,
};

export type Mode = "customer" | "merchant" | "driver" | "ops";
export type UserRole = "customer" | "merchant" | "driver" | "admin" | "support";
export type Service = "food" | "ride" | "shipment";
export type DriverService = "delivery" | "ride";
export type CustomerTab = "home" | "services" | "activity" | "wallet" | "profile" | "notifications";
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
export type RideStatus =
  | "requested"
  | "driver_assigned"
  | "arriving"
  | "in_progress"
  | "completed"
  | "cancelled";

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
  status?: "active" | "suspended" | "pending" | "deleted";
  emailVerifiedAt?: string | null;
  phoneVerifiedAt?: string | null;
};

export type Extra = {
  id: string;
  name: string;
  price: number;
};

export type MenuItem = {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  // Sin calificación por plato: Flash califica el pedido y el local.
  /** null (o ausente) cuando el comercio no lo declaró; nunca 0 de relleno. */
  timeMin?: number | null;
  kcal?: number | null;
  stock: boolean;
  modifierGroups?: Array<{
    id: string;
    name: string;
    min: number;
    max: number;
    required: boolean;
    modifiers: Array<{
      id: string;
      name: string;
      price: number;
      available: boolean;
    }>;
  }>;
  dietaryLabels?: Array<{ code: string; name: string }>;
  allergens?: Array<{
    code: string;
    name: string;
    presence: "contains" | "may_contain";
  }>;
  image: string;
  tags: string[];
};

export type RoadRoute = {
  distanceKm: number;
  durationMin: number;
  coordinates: GeoPoint[];
  steps: Array<{
    instruction: string;
    distanceM: number;
    durationSec: number;
  }>;
};

export type PublicRideTracking = {
  rideId: string;
  status: RideStatus;
  pickup: string;
  destination: string;
  etaMin: number;
  updatedAt: string;
  expiresAt: string;
  pickupLocation: GeoPoint;
  destinationLocation: GeoPoint;
  driver: {
    firstName: string;
    vehicle: string;
    plate: string | null;
    location: GeoPoint | null;
    locationUpdatedAt: string | null;
  } | null;
};

export type RideForm = {
  pickup: string;
  destination: string;
  service: Ride["service"];
  pickupCoords: GeoPoint | null;
  destinationCoords: GeoPoint | null;
  /** PAG-01: Flash Wallet (por omisión) o efectivo al conductor. PAG-05: o el perfil familiar. */
  paymentMethod?: RidePaymentMethod;
};

export type RidePaymentMethod = "Flash Wallet" | "Efectivo" | FamilyPaymentLabel;

export type Restaurant = {
  id: string;
  ownerId: string;
  name: string;
  /** Rubro (P-01). Ausente en el respaldo SQLite, que sólo tiene restaurantes. */
  vertical?: MerchantVertical;
  cuisine: string;
  /** Promedio de calificaciones reales del local; null si todavía no tiene. */
  rating: number | null;
  /** Cuántas calificaciones lo forman. Ausente en respuestas viejas: se lee como 0. */
  ratingCount?: number;
  distanceKm: number;
  etaMin: number;
  deliveryFee: number;
  open: boolean;
  manualOpen?: boolean;
  /** Estado del comercio para operaciones (FE-05). Sólo lo trae el listado de
   *  `/operations/restaurants`: el catálogo público nunca devuelve un suspendido. */
  status?: "active" | "suspended";
  /** Cuándo y por qué operaciones lo suspendió; null si no está suspendido o si la
   *  base todavía no guarda el dato. Ausente en respuestas que no son de operaciones. */
  suspendedAt?: string | null;
  suspensionReason?: string | null;
  image: string;
  cover: string;
  badge: string;
  address: string;
  lat?: number | null;
  lng?: number | null;
  menu: MenuItem[];
  extras: Extra[];
  branches?: Array<{
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
    /** La sucursal acepta que el cliente retire en el local (GTM-002).
     *  Apagado por omision: exige mostrador y alguien que atienda. */
    pickupEnabled: boolean;
    /** PAG-01: la sucursal acepta efectivo. */
    cashEnabled?: boolean;
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
    inventory: Record<
      string,
      { available: boolean; stockQuantity: number | null; version: number }
    >;
  }>;
};

export type Driver = {
  id: string;
  userId: string;
  name: string;
  online: boolean;
  serviceModes: DriverService[];
  activeService: DriverService;
  vehicle: string;
  plate: string;
  rating: number;
  /**
   * FE-04: cuántas calificaciones reales tiene. Sólo lo trae el perfil propio
   * (`/api/driver/me`); sin él no se sabe si `rating` es una nota o el valor inicial.
   */
  ratingCount?: number;
  location: {
    lat: number;
    lng: number;
    label: string;
    updatedAt?: string | null;
  };
  earningsToday: number;
  /** PAG-01: efectivo cobrado que todavía debe rendir. */
  cashDebt?: number;
};

export type TimelineEntry<TStatus extends string> = {
  status: TStatus;
  at: string;
};

export type OrderItem = {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  extras: string[];
  note: string;
};

export type Order = {
  id: string;
  customerId: string;
  /** PAG-01: en efectivo, cuánto cobrar, con cuánto paga y el vuelto. */
  cashPayment?: CashPayment | null;
  /** P-03: si va en un lote, qué entrega es. */
  batch?: OrderBatch | null;
  restaurantId: string;
  branchId?: string | null;
  courierId: string | null;
  status: OrderStatus;
  /** Cómo lo recibe el cliente (GTM-002). Decide quién puede completarlo, si
   *  hay reparto y qué muestra el seguimiento. */
  fulfillment?: "delivery" | "pickup";
  /** Recortadas según quién mira: el comercio recibe sólo los cubiertos (P-02). */
  deliveryPreferences?: DeliveryPreferencesView;
  deliveryAddress: string;
  pickupLocation?: GeoPoint | null;
  deliveryLocation?: GeoPoint | null;
  paymentMethod: string;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  discount?: number;
  /** Envío cubierto por la suscripción, y propina dejada en el checkout. */
  subscriptionDiscount?: number;
  tip?: number;
  promotionCode?: string | null;
  /** Horario reservado. `null` es «lo antes posible». */
  scheduledFor?: string | null;
  total: number;
  etaMin: number;
  createdAt: string;
  timeline: TimelineEntry<OrderStatus>[];
  /** P-02b: el pedido ya tiene foto de entrega (sólo el dato, no la imagen). */
  deliveryPhoto?: boolean;
  /** SEG-03: se entrega con código y si ya se verificó (nunca el código). */
  deliveryCode?: { required: boolean; verified: boolean } | null;
};

export type Ride = {
  id: string;
  customerId: string;
  driverId: string | null;
  status: RideStatus;
  /** SEG-01: el aviso abierto del control del viaje, si hay uno. */
  tripCheck?: RideTripCheck | null;
  service: "economy" | "comfort" | "moto" | "xl";
  pickup: string;
  destination: string;
  pickupLocation?: GeoPoint | null;
  destinationLocation?: GeoPoint | null;
  distanceKm: number;
  etaMin: number;
  durationMin: number;
  fare: number;
  paymentMethod: string;
  scheduledFor?: string | null;
  createdAt: string;
  timeline: TimelineEntry<RideStatus>[];
};

export type Shipment = {
  id: string;
  customerId: string;
  driverId: string | null;
  status:
    | "requested"
    | "driver_assigned"
    | "arriving"
    | "picked_up"
    | "delivering"
    | "delivered"
    | "cancelled";
  pickup: string;
  destination: string;
  pickupLocation?: GeoPoint | null;
  destinationLocation?: GeoPoint | null;
  recipientName: string;
  recipientPhone: string;
  packageSize: "small" | "medium" | "large";
  description: string;
  weightKg: number;
  deliveryNotes: string;
  declaredValue?: number;
  protection?: "none" | "standard";
  protectionPremium?: number;
  signatureRequired?: boolean;
  itemCategory?: "documents" | "standard" | "fragile" | "electronics";
  serviceLevel?: "economy" | "standard" | "priority" | "express";
  handlingInstructions?: string;
  distanceKm: number;
  etaMin: number;
  fare: number;
  deliveryPin?: string;
  deliveryEvidenceCount?: number;
  deliveryVerifiedAt?: string | null;
  timeline?: Array<{ status: string; at: string }>;
};

export type Promotion = {
  id: string;
  code?: string;
  title: string;
  description: string;
  service: Service;
  discountPercent: number;
  kind?: "percentage" | "fixed" | "free_delivery" | "wallet_credit";
  value?: number;
  maxDiscount?: number;
  minSubtotal?: number;
  active: boolean;
};

export type SupportTicket = {
  id: string;
  service: Service;
  status: "open" | "waiting_customer" | "waiting_operations" | "resolved" | "closed";
  title: string;
  priority: "low" | "medium" | "high" | "urgent";
  userId?: string;
  assignedTo: string | null;
  firstResponseDueAt: string | null;
  resolutionDueAt: string | null;
  firstRespondedAt: string | null;
  slaStatus: "on_track" | "first_response_breached" | "resolution_breached" | "met";
  escalationLevel: number;
  lastEscalatedAt: string | null;
  assignmentHistory: Array<{
    assignedTo: string;
    assignedBy: string | null;
    reason: "auto_create" | "auto_queue" | "manual" | "escalation";
    createdAt: string;
  }>;
  escalations: Array<{
    level: number;
    breachKind: "first_response" | "resolution";
    assignedTo: string | null;
    createdAt: string;
  }>;
  messages: Array<{
    id: string;
    senderId: string | null;
    body: string;
    internal: boolean;
    createdAt: string;
  }>;
};
export type SupportAgent = {
  userId: string;
  name: string;
  availability: "available" | "busy" | "offline";
  maxActiveTickets: number;
  skills: string[];
  activeTickets: number;
  lastAssignedAt: string | null;
  updatedAt: string;
};
export type NotificationDeadLetter = {
  id: string;
  userId: string;
  channel: "push" | "email" | "sms" | "in_app";
  template: string;
  reason: string;
  attempts: number;
  replayCount: number;
  createdAt: string;
  lastReplayedAt: string | null;
};

export type Rating = {
  id: string;
  jobId: string;
  userId: string;
  subjectType: "driver" | "merchant" | "customer";
  score: number;
  tags: string[];
  comment: string;
  createdAt: string;
};

export type PaymentMethod = {
  id: string;
  userId: string;
  type: string;
  label: string;
  last4: string;
  balance: number;
  isDefault: boolean;
};

export type WalletTransaction = {
  id: string;
  userId: string;
  kind: string;
  amount: number;
  description: string;
  createdAt: string;
};

export type Zone = {
  id: string;
  name: string;
  demandLevel: "low" | "medium" | "high";
  deliveryMultiplier: number;
  rideMultiplier: number;
  activeOrders: number;
  activeRides: number;
};

export type AuditEvent = {
  id: string;
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type Metrics = {
  activeOrders: number;
  activeRides: number;
  onlineDrivers: number;
  openRestaurants: number;
  completedRevenue: number;
  openTickets: number;
  avgOrderEta: number;
  avgRideEta: number;
};

export type AdminDashboard = {
  generatedAt: string;
  metrics: Metrics;
  marketplace: {
    grossVolume: number;
    estimatedPlatformRevenue: number;
    takeRatePercent: number;
    averageOrderValue: number;
    averageRideFare: number;
    fillRateDelivery: number;
    fillRateRide: number;
    cancellationRate: number;
    supplyDemandRatio: number;
    unassignedOrders: number;
    unassignedRides: number;
    /** Servicios en total, no la página que tiene el navegador (FE-04). */
    deliveryJobs?: number;
    rideJobs?: number;
    openRestaurants: number;
    onlineDrivers: number;
    financial: {
      grossProcessed: number;
      /** Lo cobrado en efectivo, que entra en `grossProcessed` (PAG-01). */
      cashCollected?: number;
      netCaptured: number;
      paymentCount: number;
      refunded: number;
      refundCount: number;
      postedPlatformRevenue: number;
      merchantPayable: number;
      pendingPayouts: number;
      pendingPayoutCount: number;
      currency: "ARS";
      revenueCoverage: "wallet_settlements";
    } | null;
  };
  investor: {
    dataStatus: "operational_only";
    seedTarget: number | null;
    monthlyBurn: number | null;
    runwayMonths: number | null;
    netRevenueRunRate: number | null;
    contributionMargin: number | null;
    contributionMarginPercent: number | null;
    unitEconomics: Array<{
      label: string;
      value: string;
      detail: string;
    }>;
  };
  riskSignals: Array<{
    id: string;
    level: "low" | "medium" | "high";
    label: string;
    value: number;
  }>;
  zones: Zone[];
  recentAuditEvents: AuditEvent[];
};

export type AppState = {
  meta: {
    name: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  users: User[];
  addresses: UserAddress[];
  paymentMethods: PaymentMethod[];
  walletTransactions: WalletTransaction[];
  restaurants: Restaurant[];
  drivers: Driver[];
  orders: Order[];
  rides: Ride[];
  shipments: Shipment[];
  promotions: Promotion[];
  favoriteRestaurantIds?: string[];
  supportTickets: SupportTicket[];
  notifications: AppNotification[];
  notificationPreferences: NotificationPreference[];
  ratings: Rating[];
  tips?: ServiceTip[];
  zones: Zone[];
  auditEvents: AuditEvent[];
  metrics: Metrics;
};

export type CartLine = {
  restaurantId: string;
  item: MenuItem;
  quantity: number;
  extras: string[];
  note: string;
};

export type RideQuote = Pick<Ride, "service" | "distanceKm" | "etaMin" | "durationMin" | "fare"> & {
  estimated: boolean;
  routingMode: "coordinates" | "text-estimate";
  quoteId: string;
  quoteToken: string;
  expiresAt: string;
  pricingVersion?: string;
  breakdown?: Record<string, number>;
};

export type ShipmentQuote = {
  packageSize: Shipment["packageSize"];
  distanceKm: number;
  etaMin: number;
  fare: number;
  declaredValue?: number;
  protection?: Shipment["protection"];
  protectionPremium?: number;
  deductible?: number;
  itemCategory?: Shipment["itemCategory"];
  itemCategoryName?: string;
  handlingInstructions?: string;
  serviceLevel?: Shipment["serviceLevel"];
  serviceLevelName?: string;
  estimated: boolean;
  routingMode: "coordinates" | "text-estimate";
  quoteId?: string;
  quoteToken?: string;
  expiresAt?: string;
};

export type RealtimeEvent = {
  cursor?: string;
  id: string;
  type: string;
  entityType?: string | null;
  entityId?: string | null;
  action?: string | null;
  requestId?: string | null;
  at: string;
};

export type ShipmentOptions = {
  categories: Array<{
    code: "documents" | "standard" | "fragile" | "electronics";
    name: string;
    handlingInstructions: string;
    surcharge: number;
    maximumWeightKg: number;
    active?: boolean;
  }>;
  serviceLevels: Array<{
    code: "economy" | "standard" | "priority" | "express";
    name: string;
    transportMultiplier: number;
    etaMultiplier: number;
    maximumDistanceKm: number | null;
    active?: boolean;
  }>;
};
export type PricingService = "food" | "ride" | "shipment";
/** Embudo y eventos de producto sobre una ventana de días (ticket ARC-001). */
export type ProductMetrics = {
  windowDays: number;
  events: Record<string, { events: number; users: number }>;
  funnel: {
    homeUsers: number;
    checkoutUsers: number;
    createdUsers: number;
    homeToCheckoutPercent: number;
    checkoutToCreatedPercent: number;
  };
};

export type FeatureFlag = {
  id: string;
  key: string;
  description: string;
  enabled: boolean;
  rolloutPercentage: number;
  allowedRoles: string[];
  city: string | null;
  startsAt: string | null;
  endsAt: string | null;
  variant: Record<string, string | number | boolean>;
  updatedAt: string;
};

/**
 * Go/no-go de una zona.
 *
 * `checks` y `criteria` viajan juntos a propósito: saber que una zona no está
 * lista sirve poco sin el umbral que no alcanzó.
 */
export type ZoneReadiness = {
  zone: { id: string; name: string; city: string };
  decision: "go" | "no_go";
  checks: Record<string, boolean>;
  criteria: Record<string, number>;
  facts: Record<string, number>;
};

export type PaymentReconciliationCase = {
  id: string;
  provider: string;
  caseType:
    | "stale_intent"
    | "capture_mismatch"
    | "refund_mismatch"
    | "orphan_webhook"
    | "webhook_failure"
    // No nace del escaneo: lo abre la reversión de un reintegro cuando deja el
    // saldo de una parte en negativo.
    | "negative_balance";
  severity: "low" | "medium" | "high" | "critical";
  entityType: "payment_intent" | "refund" | "webhook_event" | "ledger_account";
  externalReference: string | null;
  summary: string;
  details: Record<string, unknown>;
  status: "open" | "resolved" | "ignored";
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedBy: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
};
/**
 * Salud de la clasificación de audiencias realtime (SEC-001).
 *
 * `unclassified` y `orphan` se cuentan por separado a propósito: el primero es
 * un `entityType` que la política no contempla —un defecto—, el segundo una
 * entidad que ya no existe, que suele ser un borrado publicando después del
 * commit. Sólo el primero es un problema.
 */
export type RealtimeAudienceHealth = {
  windowHours: number;
  total: number;
  byOutcome: { outcome: string; total: number; lastSeen: string }[];
  unclassified: {
    total: number;
    byEntityType: { entityType: string; total: number; lastSeen: string }[];
    recent: {
      id: string;
      type: string;
      entityType: string | null;
      entityId: string | null;
      at: string;
    }[];
  };
};

export type PaymentReconciliation = {
  summary: { openCount: number; urgentCount: number; resolvedCount: number };
  cases: PaymentReconciliationCase[];
};
export type TransactionRiskAssessment = {
  id: string;
  customerId: string;
  service: "food" | "ride" | "shipment";
  amount: number;
  score: number;
  decision: "allow" | "review" | "block";
  rules: Array<{ code: string; points: number; fact: Record<string, unknown> }>;
  requestId: string | null;
  entityId: string | null;
  createdAt: string;
  reviewedBy: string | null;
  reviewStatus: "confirmed_fraud" | "false_positive" | "cleared" | null;
  reviewNote: string | null;
  reviewedAt: string | null;
};
export type PricingPlan = {
  service: PricingService;
  version: string;
  currency: string;
  config: Record<string, unknown>;
  effectiveFrom: string;
  active: boolean;
};
export type PricingRiskWarning = {
  path: string;
  previous: number;
  next: number;
  changePercent: number;
  direction: "increase" | "decrease";
};
export type PricingChangeRequest = {
  id: string;
  service: PricingService;
  version: string;
  currency: string;
  config: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "activated" | "cancelled";
  changeKind: "update" | "rollback";
  sourceVersion: string | null;
  riskLevel: "low" | "medium" | "high";
  maximumChangePercent: number;
  riskWarnings: PricingRiskWarning[];
  requestedBy: string;
  reviewedBy: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  effectiveAt: string;
  activatedAt: string | null;
  reviewNote: string | null;
};
export type DriverVehicle = {
  id: string;
  driverId: string;
  kind: "bicycle" | "motorcycle" | "car" | "van";
  model: string;
  /** Una bicicleta no tiene patente (FE-06). */
  plate: string | null;
  color: string | null;
  seats: number | null;
  serviceModes: Array<"delivery" | "ride">;
  active: boolean;
  status: "pending" | "approved" | "rejected";
  rejectionReason: string | null;
  reviewedAt: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TipAdjustment = {
  id: string;
  tipId: string;
  jobId: string;
  customerId: string;
  driverId: string;
  tipAmount: number;
  amount: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requestedBy: string;
  requestedAt: string;
  reviewedBy: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
};

/** Dashboard de operaciones del comercio.
 *  Queda local: `restaurant: Restaurant` y `Restaurant` aún diverge entre
 *  web y mobile (ARC-001). No se mueve hasta unificar ese tipo. */
export type MerchantOperationsDashboard = {
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
  restaurant: Restaurant;
  metrics: MerchantOperationsMetrics;
};

export type MerchantFinance = {
  merchantId: string;
  availableBalance: number;
  movements: Array<{
    id: string;
    kind: string;
    description: string;
    direction: "credit" | "debit";
    amount: number;
    createdAt: string;
    metadata: Record<string, unknown>;
  }>;
  payouts: Array<{
    id: string;
    amount: number;
    status: string;
    periodStart: string;
    periodEnd: string;
    createdAt: string;
    paidAt: string | null;
    reviewDecision: string | null;
    reviewNote: string | null;
    reviewedAt: string | null;
  }>;
};
export type MerchantPaymentConnection = {
  provider: "mercadopago";
  externalAccountId: string;
  liveMode: boolean;
  scope: string | null;
  connectedAt: string;
  tokenExpiresAt: string | null;
  status: "connected" | "reconnect_required" | "revoked";
};
export type PayoutReview = {
  id: string;
  merchantId: string;
  merchantName: string;
  amount: number;
  currency: string;
  status: "pending" | "processing" | "paid" | "failed" | "cancelled";
  provider: string;
  providerPayoutId: string | null;
  requestedBy: string | null;
  reviewedBy: string | null;
  reviewDecision: "approved" | "rejected" | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  paidAt: string | null;
};

// --- Formas que vivían en el entrypoint (ARC-001, paso 15) ----------------
//
// Las dos las comparten `App.tsx`, que arma la petición, y la superficie de
// cliente, que la compone en pantalla.

/** Lo que el checkout de comida manda a cotizar. */
export type FoodQuotePayload = {
  customerId: string;
  restaurantId: string;
  /** Ausente en retiro: no hay dirección del cliente que medir. */
  deliveryAddressId?: string;
  branchId?: string;
  /** Retiro en el local (GTM-002). Ausente es `delivery`. */
  fulfillment?: "delivery" | "pickup";
  paymentMethod: string;
  paymentMethodId?: string;
  promotionCode?: string;
  items: Array<Pick<CartLine, "quantity" | "extras" | "note"> & { menuItemId: string }>;
};

/** Lo que el checkout de comida confirma: la cotización firmada y su elección. */
export type FoodCheckoutSelection = {
  /** Como recibe el pedido (GTM-002). Viaja con la eleccion y no se deduce del
   *  resto porque la creacion del pedido lo compara contra el token firmado: si
   *  el cliente cotizo un retiro, no puede crear una entrega. */
  fulfillment: "delivery" | "pickup";
  /** Ausente en retiro: no hay direccion de cliente a la que llevar nada. */
  deliveryAddressId?: string;
  /** En entrega, la direccion del cliente; en retiro, la del local. Siempre hay
   *  una, porque es la que el comprobante y el seguimiento muestran. */
  deliveryAddress: string;
  paymentMethod: string;
  paymentMethodId?: string;
  quoteToken: string;
  /** Propina en centavos, elegida en el checkout. Se cobra con el pedido y se
   *  libera al repartidor cuando el servicio se completa. */
  tipCents?: number;
  /** Horario reservado en ISO, o `null` para «lo antes posible». */
  scheduledFor?: string | null;
  /** Cómo se entrega (P-02): modo, indicaciones y cubiertos. */
  deliveryPreferences?: DeliveryPreferences;
  /** PAG-01: «¿Con cuánto pagás?» en efectivo, en centavos. Ausente si paga justo. */
  cashTenderedCents?: number;
};

/** Lo que la pantalla de envíos manda para crear uno. */
export type ShipmentCreatePayload = {
  pickup: string;
  destination: string;
  recipientName: string;
  recipientPhone: string;
  packageSize: Shipment["packageSize"];
  description: string;
  weightKg: number;
  declaredValue: number;
  protection: NonNullable<Shipment["protection"]>;
  signatureRequired: boolean;
  itemCategory: NonNullable<Shipment["itemCategory"]>;
  serviceLevel: NonNullable<Shipment["serviceLevel"]>;
  deliveryNotes: string;
  paymentMethod: string;
  termsAccepted: true;
  pickupCoords: GeoPoint;
  destinationCoords: GeoPoint;
  quoteToken: string;
};

/** Plan de suscripción ofrecido. Los beneficios vienen del servidor: la pantalla
 *  no puede inventar un umbral ni un porcentaje que la tarifa no vaya a aplicar. */

/** Estado de una solicitud de alta de comercio (FE-05). `needs_changes` es «observada»:
 *  operaciones pidió cambios y la solicitud sigue abierta. */
export type MerchantApplicationStatus = "pending" | "needs_changes" | "approved" | "rejected";

/** Solicitud de alta de comercio, tal como la ve quien la presentó. `merchantId` existe
 *  recién cuando se aprueba: el comercio no se crea antes de la decisión. */
export type MerchantApplication = {
  id: string;
  status: MerchantApplicationStatus;
  businessName: string;
  legalName: string;
  taxId: string;
  vertical: string;
  contactPhone: string;
  address: string;
  lat: number;
  lng: number;
  notes: string | null;
  decisionReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  merchantId: string | null;
};

/** La misma solicitud en la cola de operaciones, con quién la presentó. */
export type AdminMerchantApplication = MerchantApplication & {
  applicant: { id: string; name: string; email: string };
};

/** Lo que manda el formulario «Sumá tu comercio». */
export type MerchantApplicationInput = {
  businessName: string;
  legalName: string;
  taxId: string;
  vertical: MerchantVertical;
  contactPhone: string;
  address: string;
  lat: number;
  lng: number;
  notes?: string;
};

export type MerchantApplicationDecision = "approve" | "reject" | "needs_changes";

/** Con qué se puede postular para repartir o manejar (FE-06). */
export type DriverApplicationVehicleKind = "bicycle" | "motorcycle" | "car";

/** La postulación propia: quien se postula ya es conductor, desconectado, y el estado es
 *  el de su legajo. */
export type DriverApplication = {
  driverId: string;
  services: Array<"delivery" | "ride">;
  status: DriverCompliance["status"];
  rejectionReason: string | null;
  city: { id: string; name: string } | null;
  createdAt: string;
};

/** Lo que manda el formulario «Repartí con Flash». */
export type DriverApplicationInput = {
  cityId: string;
  services: Array<"delivery" | "ride">;
  vehicle: {
    kind: DriverApplicationVehicleKind;
    model: string;
    plate?: string | null;
    color?: string | null;
    seats?: number | null;
  };
};

/** Un conductor en la cola de legajos de operaciones, con sus documentos vigentes (sin
 *  el contenido, que se pide al abrir cada uno) y sus vehículos. */
export type AdminDriverApplication = {
  id: string;
  createdAt: string;
  person: { id: string; name: string; email: string; phone: string | null; phoneVerified: boolean };
  city: string | null;
  services: Array<"delivery" | "ride">;
  status: DriverCompliance["status"];
  rejectionReason: string | null;
  requiredTypes: DriverDocument["type"][];
  documents: Array<{
    id: string;
    type: DriverDocument["type"];
    mimeType: string;
    sizeBytes: number;
    expiresAt: string | null;
    status: "pending" | "approved" | "rejected";
    rejectionReason: string | null;
    createdAt: string;
  }>;
  vehicles: Array<{
    id: string;
    kind: DriverVehicle["kind"];
    model: string;
    plate: string | null;
    color: string | null;
    seats: number | null;
    status: DriverVehicle["status"];
    rejectionReason: string | null;
    active: boolean;
  }>;
};
