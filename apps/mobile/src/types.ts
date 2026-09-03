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
  UserRole,
  UserStatus,
  User,
  OrderStatus,
  OrderItem,
  Order as SharedOrder,
  RestaurantSummary,
  MenuModifier,
  MenuModifierGroup,
  MenuItemSummary,
  RestaurantBranch,
  RideStatus,
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
  UserRole,
  UserStatus,
  User,
  OrderStatus,
  OrderItem,
  RestaurantSummary,
  MenuModifier,
  MenuModifierGroup,
  MenuItemSummary,
  RestaurantBranch,
  RideStatus,
};

export type Mode = "customer" | "merchant" | "driver";
export type ServiceMode = "delivery" | "ride";
export type RideService = "economy" | "comfort" | "moto" | "xl";

export type Restaurant = RestaurantSummary & {
  branches?: RestaurantBranch[];
  menu: MenuItemSummary[];
};

export type Driver = {
  id: string;
  userId: string;
  name: string;
  online: boolean;
  serviceModes: ServiceMode[];
  activeService: ServiceMode;
  vehicle: string;
  plate: string;
  vehicleKind?: "bicycle" | "motorcycle" | "car" | "van" | null;
  vehicleStatus?: "pending" | "approved" | "rejected" | null;
  rating: number;
  earningsToday: number;
  location: GeoPoint & {
    label: string;
    updatedAt?: string | null;
    source?: "foreground" | "background" | "legacy" | null;
    accuracyM?: number | null;
  };
};

/** Pedido mobile: núcleo compartido + cancelación de servicio. */
export type Order = SharedOrder & {
  cancellation?: ServiceCancellation | null;
};

export type Ride = {
  id: string;
  customerId: string;
  driverId: string | null;
  status: RideStatus;
  service?: RideService;
  pickup: string;
  destination: string;
  pickupLocation?: GeoPoint | null;
  destinationLocation?: GeoPoint | null;
  distanceKm: number;
  etaMin?: number;
  durationMin: number;
  fare: number;
  scheduledFor?: string | null;
  cancellation?: ServiceCancellation | null;
};

export type DriverEarningsPeriod = {
  amount: number;
  serviceEarnings: number;
  tips: number;
  adjustments: number;
  services: number;
  onlineSeconds: number | null;
  activeSeconds: number | null;
  periodStart: string;
  periodEnd: string;
};

export type DriverEarningsDay = Omit<DriverEarningsPeriod, "periodStart" | "periodEnd"> & {
  date: string;
};

export type DriverEarnings = {
  driverId: string;
  currency: "ARS";
  timezone: string;
  source: "postgres-ledger" | "sqlite-test-fallback";
  walletBalance: number;
  today: DriverEarningsPeriod;
  week: DriverEarningsPeriod;
  days: DriverEarningsDay[];
  recent: Array<{
    id: string;
    category: "food" | "ride" | "shipment" | "tip" | "adjustment";
    jobId: string | null;
    description: string;
    amount: number;
    createdAt: string;
  }>;
  timeTracking:
    | { status: "available"; source: "postgres-operational-sessions"; observedAt: string }
    | { status: "unavailable"; reason: "postgres_required" };
  cashout: { status: "not_configured"; reason: "external_payout_provider_required" };
};

export type DriverPreferences = {
  driverId: string;
  navigationProvider: "system" | "google_maps" | "apple_maps";
  updatedAt: string | null;
};

export type DriverDemandZone = {
  id: string;
  name: string;
  level: "low" | "medium" | "high";
  openJobs: number;
  eligibleDrivers: number;
  containsDriver: boolean;
  boundary: GeoPoint[];
};
export type DriverDemand = {
  driverId: string;
  service: "delivery" | "ride" | "shopping";
  online: boolean;
  city: { id: string; slug: string; name: string; timezone: string };
  observedAt: string;
  source: "postgres-live-window";
  methodology: {
    openJobs: "dispatchable_unassigned";
    scheduledHorizonMinutes: 15;
    supplyFreshnessMinutes: 5;
    maximumLocationAccuracyM: 100;
    forecast: false;
    pricingImpact: false;
  };
  zones: DriverDemandZone[];
};

export type DriverVehicle = {
  id: string;
  driverId: string;
  kind: "bicycle" | "motorcycle" | "car" | "van";
  model: string;
  plate: string;
  color: string | null;
  seats: number | null;
  serviceModes: ServiceMode[];
  active: boolean;
  status: "pending" | "approved" | "rejected";
  rejectionReason: string | null;
  reviewedAt: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type RideDestination = {
  id: string;
  label: string;
  address: string;
  point: GeoPoint;
  useCount: number;
  lastUsedAt: string;
};

export type RideQuote = {
  service: RideService;
  distanceKm: number;
  etaMin: number;
  durationMin: number;
  fare: number;
  estimated: boolean;
  routingMode: "coordinates" | "text-estimate";
  label?: string;
  description?: string;
  capacity?: number;
  pickupEtaMin?: number;
  availableDrivers?: number;
  available?: boolean;
  quoteId?: string;
  quoteToken?: string;
  expiresAt?: string;
  pricingVersion?: string;
  breakdown?: {
    baseFare: number;
    distanceFare: number;
    timeFare: number;
    serviceFee: number;
    tolls: number;
    demandAdjustment: number;
    demandMultiplier: number;
    serviceMultiplier: number;
  };
};

export type CartLine = {
  restaurantId: string;
  item: Restaurant["menu"][number];
  quantity: number;
  extras: string[];
  note: string;
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
  cancellation?: ServiceCancellation | null;
};

export type ShipmentQuote = {
  packageSize: Shipment["packageSize"];
  distanceKm: number;
  etaMin: number;
  fare: number;
  declaredValue?: number;
  protection?: "none" | "standard";
  protectionPremium?: number;
  deductible?: number;
  itemCategory?: Shipment["itemCategory"];
  itemCategoryName?: string;
  handlingInstructions?: string;
  serviceLevel?: Shipment["serviceLevel"];
  serviceLevelName?: string;
  estimated: boolean;
  routingMode: "coordinates" | "text-estimate";
  pricingVersion?: string;
  quoteId?: string;
  quoteToken?: string;
  expiresAt?: string;
};
export type ShipmentOptions = {
  categories: Array<{
    code: NonNullable<Shipment["itemCategory"]>;
    name: string;
    handlingInstructions: string;
    surcharge: number;
    maximumWeightKg: number;
  }>;
  serviceLevels: Array<{
    code: NonNullable<Shipment["serviceLevel"]>;
    name: string;
    transportMultiplier: number;
    etaMultiplier: number;
    maximumDistanceKm: number | null;
  }>;
};

export type Promotion = {
  id: string;
  code?: string;
  title: string;
  description: string;
  service: "food" | "ride" | "shipment";
  discountPercent: number;
  kind?: "percentage" | "fixed" | "free_delivery" | "wallet_credit";
  value?: number;
  maxDiscount?: number;
  minSubtotal?: number;
  active: boolean;
  startsAt?: string;
  endsAt?: string;
};

export type AppState = {
  users: User[];
  addresses: UserAddress[];
  paymentMethods: PaymentMethod[];
  supportTickets: SupportTicket[];
  restaurants: Restaurant[];
  drivers: Driver[];
  orders: Order[];
  rides: Ride[];
  shipments: Shipment[];
  tips?: ServiceTip[];
  promotions?: Promotion[];
  favoriteRestaurantIds?: string[];
  metrics: {
    activeOrders: number;
    activeRides: number;
    onlineDrivers: number;
    openRestaurants: number;
    openTickets: number;
    avgOrderEta: number;
    avgRideEta: number;
  };
};

export type PaymentMethod = {
  id: string;
  userId: string;
  type: "card" | "bank_account" | "wallet" | "cash";
  label: string;
  brand: string | null;
  last4: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  isDefault: boolean;
};
export type AccountSession = {
  id: string;
  deviceName: string;
  createdAt: string;
  expiresAt: string;
};
export type ReferralSummary = {
  code: string;
  campaign: { name: string; advocateReward: number; friendReward: number; currency: string } | null;
  invited: number;
  rewarded: number;
  attribution: {
    status: "pending" | "rewarded" | "rejected";
    code: string;
    attributedAt: string;
    rewardedAt: string | null;
  } | null;
};
export type RideTrustedContact = {
  id: string;
  name: string;
  relationship: "family" | "friend" | "partner" | "coworker" | "other";
  phone: string;
  last4: string;
  active: boolean;
  createdAt: string;
};
export type ServiceAttachment = {
  id: string;
  fileName: string;
  mimeType: "image/jpeg" | "image/png" | "application/pdf";
  sizeBytes: number;
  createdAt: string;
};
export type ServiceMessage = {
  id: string;
  jobId: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
  readBy: Array<{ userId: string; readAt: string }>;
  attachments: ServiceAttachment[];
};
export type SupportTicket = {
  id: string;
  userId: string;
  jobId: string | null;
  service: string;
  status: "open" | "waiting_customer" | "waiting_operations" | "resolved" | "closed";
  title: string;
  priority: "low" | "medium" | "high" | "urgent";
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  firstResponseDueAt: string;
  resolutionDueAt: string;
  firstRespondedAt: string | null;
  slaStatus: "on_track" | "first_response_breached" | "resolution_breached" | "met";
  messages: Array<{
    id: string;
    senderId: string | null;
    body: string;
    internal: boolean;
    createdAt: string;
  }>;
};

export type ServiceCancellation = {
  id: string;
  reason: string;
  refundAmount: number;
  fee: number;
  createdAt: string;
};

export type ServiceReceipt = {
  id: string;
  number: string;
  jobId: string;
  serviceKind: "ride" | "delivery";
  serviceSubtype: string | null;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  serviceFee: number;
  total: number;
  currency: string;
  lineItems: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    total: number;
    extras?: string[];
  }>;
  payment: {
    provider?: string;
    status: string;
    amount?: number;
    capturedAmount?: number;
    currency: string;
  };
  issuedAt: string;
  fiscal: false;
  documentType: "service_receipt";
  metadata: { pickup?: string; dropoff?: string; serviceLevel?: string };
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

// --- Tipos de dominio que vivían en el entrypoint (ARC-001, paso 11) ---------
//
// Los tres los comparten `App.tsx` y las pantallas extraídas. `RoadStep` había
// quedado en `format.ts` en el paso 10, y era el lugar equivocado: describe un
// dato del proveedor cartográfico, no una forma de mostrarlo.

/** Un paso de la ruta vial, tal como lo devuelve el proveedor cartográfico. */
export type RoadStep = {
  type: string;
  modifier: string;
  street: string;
  distanceM: number;
  durationSec: number;
  location: GeoPoint;
};

/** Una ruta vial completa: geometría para dibujar más pasos para narrar. */
export type RoadRoute = {
  distanceKm: number;
  durationMin: number;
  coordinates: GeoPoint[];
  steps: RoadStep[];
};

/**
 * Una línea del carrito en el cliente móvil.
 *
 * `lineId` existe además de `menuItemId` porque el mismo producto con distintos
 * extras o nota es otra línea, no una cantidad mayor.
 */
export type MobileCartLine = {
  lineId: string;
  restaurantId: string;
  menuItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  extras: string[];
  note: string;
};

/** Plan de suscripción ofrecido. Los beneficios vienen del servidor: la pantalla
 *  no puede inventar un umbral que la tarifa no vaya a aplicar. */
