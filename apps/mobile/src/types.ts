export type Mode = "customer" | "merchant" | "driver";
export type ServiceMode = "delivery" | "ride";

export type GeoPoint = {
  lat: number;
  lng: number;
};

export type User = {
  id: string;
  name: string;
  email: string;
  wallet: number;
  defaultAddress?: string;
  restaurantId?: string;
  driverId?: string;
};

export type Restaurant = {
  id: string;
  ownerId: string;
  name: string;
  cuisine: string;
  rating: number;
  etaMin: number;
  deliveryFee: number;
  open: boolean;
  address: string;
  menu: Array<{
    id: string;
    name: string;
    price: number;
    stock: boolean;
  }>;
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
  rating: number;
  earningsToday: number;
  location: GeoPoint & { label: string; updatedAt?: string | null };
};

export type Order = {
  id: string;
  customerId: string;
  restaurantId: string;
  courierId: string | null;
  status: string;
  deliveryAddress: string;
  total: number;
  etaMin: number;
  items: Array<{ name: string; quantity: number }>;
};

export type Ride = {
  id: string;
  customerId: string;
  driverId: string | null;
  status: string;
  pickup: string;
  destination: string;
  distanceKm: number;
  durationMin: number;
  fare: number;
};

export type AppState = {
  users: User[];
  restaurants: Restaurant[];
  drivers: Driver[];
  orders: Order[];
  rides: Ride[];
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
