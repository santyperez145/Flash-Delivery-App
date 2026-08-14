export type Mode = "customer" | "merchant" | "driver" | "ops";
export type UserRole = "customer" | "merchant" | "driver" | "admin";
export type Service = "food" | "ride";
export type DriverService = "delivery" | "ride";
export type CustomerTab = "home" | "activity" | "wallet" | "profile";
export type OrderStatus =
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
  rating: number;
  timeMin: number;
  kcal: number;
  stock: boolean;
  image: string;
  tags: string[];
};

export type GeoPoint = {
  lat: number;
  lng: number;
};

export type RideForm = {
  pickup: string;
  destination: string;
  service: Ride["service"];
  pickupCoords: GeoPoint | null;
  destinationCoords: GeoPoint | null;
};

export type Restaurant = {
  id: string;
  ownerId: string;
  name: string;
  cuisine: string;
  rating: number;
  distanceKm: number;
  etaMin: number;
  deliveryFee: number;
  open: boolean;
  image: string;
  cover: string;
  badge: string;
  address: string;
  lat?: number | null;
  lng?: number | null;
  menu: MenuItem[];
  extras: Extra[];
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
  location: {
    lat: number;
    lng: number;
    label: string;
    updatedAt?: string | null;
  };
  earningsToday: number;
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
  restaurantId: string;
  courierId: string | null;
  status: OrderStatus;
  deliveryAddress: string;
  paymentMethod: string;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  total: number;
  etaMin: number;
  createdAt: string;
  timeline: TimelineEntry<OrderStatus>[];
};

export type Ride = {
  id: string;
  customerId: string;
  driverId: string | null;
  status: RideStatus;
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
  createdAt: string;
  timeline: TimelineEntry<RideStatus>[];
};

export type Promotion = {
  id: string;
  title: string;
  description: string;
  service: Service;
  discountPercent: number;
  active: boolean;
};

export type SupportTicket = {
  id: string;
  service: Service;
  status: "open" | "closed";
  title: string;
  priority: "low" | "medium" | "high";
  userId?: string;
};

export type UserAddress = {
  id: string;
  userId: string;
  label: string;
  address: string;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
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
    openRestaurants: number;
    onlineDrivers: number;
  };
  investor: {
    seedTarget: number;
    monthlyBurn: number;
    runwayMonths: number;
    netRevenueRunRate: number;
    contributionMargin: number;
    contributionMarginPercent: number;
    readinessScore: number;
    milestones: Array<{
      label: string;
      status: "done" | "in_progress" | "next";
      value: string;
    }>;
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
  promotions: Promotion[];
  supportTickets: SupportTicket[];
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

export type RideQuote = Pick<
  Ride,
  "service" | "distanceKm" | "etaMin" | "durationMin" | "fare"
> & {
  estimated: boolean;
  routingMode: "coordinates" | "text-estimate";
};

export type RealtimeEvent = {
  id: string;
  type: string;
  entityType?: string | null;
  entityId?: string | null;
  action?: string | null;
  requestId?: string | null;
  at: string;
};
