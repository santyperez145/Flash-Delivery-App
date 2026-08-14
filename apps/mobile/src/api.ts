import type { AppState, Driver, GeoPoint, Order, Restaurant, Ride, RideQuote, RideService, ServiceMode } from "./types";

declare const process: { env?: { EXPO_PUBLIC_API_URL?: string } };

const API_BASE = process.env?.EXPO_PUBLIC_API_URL || "http://127.0.0.1:4000/api";

let token = "";

type Envelope<T> = T & { ok: boolean; message?: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {})
    }
  });
  const payload = (await response.json()) as Envelope<T>;
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "No se pudo completar la accion");
  }
  return payload as T;
}

export const demoAccounts = {
  customer: "cliente@flash.app",
  merchant: "comercio@flash.app",
  driver: "conductor@flash.app"
};

export const api = {
  async login(email: string) {
    const session = await request<{ token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: "demo123" })
    });
    token = session.token;
  },
  async state() {
    return request<{ state: AppState }>("/state");
  },
  async createOrder(payload: {
    customerId: string;
    restaurantId: string;
    deliveryAddress: string;
    paymentMethod: string;
    items: Array<{ menuItemId: string; quantity: number; extras: string[]; note: string }>;
  }) {
    return request<{ order: Order }>("/orders", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  async setOrderStatus(orderId: string, status: Order["status"]) {
    return request<{ order: Order }>(`/orders/${orderId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
  },
  async quoteRide(payload: {
    pickup: string;
    destination: string;
    service: RideService;
    pickupCoords?: GeoPoint | null;
    destinationCoords?: GeoPoint | null;
  }) {
    return request<{ quote: RideQuote }>("/rides/quote", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  async createRide(payload: {
    customerId: string;
    pickup: string;
    destination: string;
    service: RideService;
    pickupCoords?: GeoPoint | null;
    destinationCoords?: GeoPoint | null;
    paymentMethod: string;
  }) {
    return request<{ ride: Ride }>("/rides", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  async setRideStatus(rideId: string, status: Ride["status"]) {
    return request<{ ride: Ride }>(`/rides/${rideId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
  },
  async updateRestaurant(restaurantId: string, payload: { open?: boolean; etaMin?: number }) {
    return request(`/restaurants/${restaurantId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },
  async updateMenuStock(restaurantId: string, itemId: string, stock: boolean) {
    return request<{ restaurant: Restaurant }>(`/restaurants/${restaurantId}/menu/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ stock })
    });
  },
  async addMenuItem(
    restaurantId: string,
    payload: { name: string; description: string; category: string; price: number }
  ) {
    return request<{ restaurant: Restaurant }>(`/restaurants/${restaurantId}/menu`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  async updateDriver(driverId: string, payload: { online?: boolean; activeService?: ServiceMode }) {
    return request<{ driver: Driver }>(`/drivers/${driverId}/availability`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },
  async updateDriverLocation(driverId: string, payload: GeoPoint & { label?: string }) {
    return request<{ driver: Driver }>(`/drivers/${driverId}/location`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },
  async acceptDelivery(orderId: string, driverId: string) {
    return request<{ order: Order }>(`/orders/${orderId}/accept-delivery`, {
      method: "POST",
      body: JSON.stringify({ driverId })
    });
  },
  async advanceOrder(orderId: string) {
    return request<{ order: Order }>(`/orders/${orderId}/advance`, { method: "POST" });
  },
  async acceptRide(rideId: string, driverId: string) {
    return request<{ ride: Ride }>(`/rides/${rideId}/accept`, {
      method: "POST",
      body: JSON.stringify({ driverId })
    });
  },
  async advanceRide(rideId: string) {
    return request<{ ride: Ride }>(`/rides/${rideId}/advance`, { method: "POST" });
  }
};
