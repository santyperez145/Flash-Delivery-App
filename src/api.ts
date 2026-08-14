import type { AppState, CartLine, Driver, Restaurant, Ride, RideQuote, User } from "./types";

const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:4000/api";
const TOKEN_KEY = "flash_platform_token";

const storedToken = () =>
  typeof window === "undefined" ? "" : window.localStorage.getItem(TOKEN_KEY) || "";

let authToken = storedToken();

type ApiEnvelope<T> = T & {
  ok: boolean;
  message?: string;
};

export function setAuthToken(token: string) {
  authToken = token;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(TOKEN_KEY, token);
  }
}

export function clearAuthToken() {
  authToken = "";
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(TOKEN_KEY);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { headers, ...requestInit } = init || {};
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has("Content-Type")) {
    requestHeaders.set("Content-Type", "application/json");
  }
  if (authToken && !requestHeaders.has("Authorization")) {
    requestHeaders.set("Authorization", `Bearer ${authToken}`);
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...requestInit,
    headers: requestHeaders
  });
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "No se pudo completar la accion");
  }
  return payload as T;
}

export const api = {
  async state() {
    return request<{ state: AppState }>("/state");
  },

  async adminDashboard() {
    return request<{ dashboard: unknown }>("/admin/dashboard");
  },

  async login(email: string, password = "demo123") {
    const session = await request<{ user: User; token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    setAuthToken(session.token);
    return session;
  },

  async createOrder(payload: {
    customerId: string;
    restaurantId: string;
    deliveryAddress: string;
    paymentMethod: string;
    items: Array<Pick<CartLine, "quantity" | "extras" | "note"> & { menuItemId: string }>;
  }) {
    return request<{ order: AppState["orders"][number]; label: string }>("/orders", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  async advanceOrder(orderId: string) {
    return request<{ order: AppState["orders"][number]; label: string }>(`/orders/${orderId}/advance`, {
      method: "POST"
    });
  },

  async acceptDelivery(orderId: string, driverId: string) {
    return request<{ order: AppState["orders"][number]; label: string }>(
      `/orders/${orderId}/accept-delivery`,
      {
        method: "POST",
        body: JSON.stringify({ driverId })
      }
    );
  },

  async setOrderStatus(orderId: string, status: string) {
    return request<{ order: AppState["orders"][number]; label: string }>(`/orders/${orderId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
  },

  async quoteRide(payload: { pickup: string; destination: string; service: Ride["service"] }) {
    return request<{ quote: RideQuote }>("/rides/quote", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  async createRide(payload: {
    customerId: string;
    pickup: string;
    destination: string;
    service: Ride["service"];
    paymentMethod: string;
  }) {
    return request<{ ride: Ride; label: string }>("/rides", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  async acceptRide(rideId: string, driverId: string) {
    return request<{ ride: Ride; label: string }>(`/rides/${rideId}/accept`, {
      method: "POST",
      body: JSON.stringify({ driverId })
    });
  },

  async advanceRide(rideId: string) {
    return request<{ ride: Ride; label: string }>(`/rides/${rideId}/advance`, {
      method: "POST"
    });
  },

  async setRideStatus(rideId: string, status: string) {
    return request<{ ride: Ride; label: string }>(`/rides/${rideId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
  },

  async updateDriver(driverId: string, payload: Partial<Pick<Driver, "online" | "activeService">>) {
    return request<{ driver: Driver }>(`/drivers/${driverId}/availability`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },

  async updateRestaurant(
    restaurantId: string,
    payload: Partial<Pick<Restaurant, "open" | "etaMin">>
  ) {
    return request<{ restaurant: Restaurant }>(`/restaurants/${restaurantId}`, {
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

  async reset() {
    return request<{ state: AppState }>("/reset", {
      method: "POST"
    });
  }
};
