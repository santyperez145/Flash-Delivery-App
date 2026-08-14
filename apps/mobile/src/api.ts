import type { AppState, Driver, Order, Ride, ServiceMode } from "./types";

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
  async updateRestaurant(restaurantId: string, payload: { open?: boolean; etaMin?: number }) {
    return request(`/restaurants/${restaurantId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },
  async updateDriver(driverId: string, payload: { online?: boolean; activeService?: ServiceMode }) {
    return request<{ driver: Driver }>(`/drivers/${driverId}/availability`, {
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
