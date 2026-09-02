// Cuenta y sesión mobile (ARC-001).
import type { AnalyticsEvent } from "../analytics";
import type { UserAddress } from "../types";
import { registrarDispositivoParaPush } from "../push-registration";
import { loadMobileSession } from "../session-storage";
import {
  API_BASE,
  allowsVariant,
  applySession,
  clearSessionTokens,
  fetchWithTimeout,
  getRefreshToken,
  getRegisteredDeviceId,
  mobileAppVariant,
  persistSession,
  refreshAccessToken,
  request,
  setActiveAudience,
  setRegisteredDeviceId,
  setSessionDriverId,
} from "./http";

// Registro y baja del dispositivo para push. La cadena completa —proveedor,
// cola, reintentos y recibos— existía del lado servidor desde el 26 de agosto;
// lo que faltaba era que algún dispositivo se registrara.
async function registerDevice(cuerpo: {
  platform: "ios" | "android";
  pushToken: string;
  appVersion?: string;
  deviceFingerprint: string;
}) {
  return request<{ device: { id: string } }>("/devices", {
    method: "POST",
    body: JSON.stringify(cuerpo),
  });
}

// `GET /api/devices` no se cablea todavía: sin una pantalla de «dispositivos
// conectados» sería un método cliente que nadie llama, y agregarlo sólo para
// que la puerta de cableado no lo cuente sería hacer trampa con la propia
// regla. La pantalla es trabajo de MOB-001, junto con la de sesiones.
async function revokeDevice(deviceId: string) {
  return request<{ ok: boolean }>(`/devices/${deviceId}`, { method: "DELETE" });
}

async function login(email: string, password: string) {
  const session = await request<{
    token: string;
    refreshToken: string;
    user: import("../types").User;
  }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      deviceName: "Flash Mobile",
      audience: mobileAppVariant,
    }),
  });
  if (!allowsVariant(session.user)) {
    await fetchWithTimeout(`${API_BASE}/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    }).catch(() => undefined);
    throw new Error(
      `Esta cuenta no pertenece a ${mobileAppVariant === "driver" ? "Flash Driver" : mobileAppVariant === "merchant" ? "Flash Negocios" : "Flash"}`,
    );
  }
  applySession({
    accessToken: session.token,
    refreshToken: session.refreshToken,
    driverId: session.user.driverId || null,
  });
  setActiveAudience(mobileAppVariant);
  await persistSession();
  // No se espera: pedir permiso de notificaciones abre un diálogo del sistema,
  // y bloquear el login detrás de él haría que la app parezca colgada. Quedarse
  // sin push es una degradación, no una falla de sesión.
  void registrarDispositivoParaPush(async (cuerpo) => {
    const { device } = await registerDevice(cuerpo);
    setRegisteredDeviceId(device.id);
  });
  return session.user;
}

async function restoreSession() {
  const stored = await loadMobileSession();
  if (!stored) return null;
  try {
    applySession({
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      driverId: stored.driverId,
    });
    if (!(await refreshAccessToken())) return null;
    const account = await request<{ account: { user: import("../types").User } }>("/me");
    if (!allowsVariant(account.account.user)) {
      clearSessionTokens();
      await persistSession();
      return null;
    }
    setSessionDriverId(account.account.user.driverId || null);
    await persistSession();
    setActiveAudience(mobileAppVariant);
    return account.account.user;
  } catch (_error) {
    clearSessionTokens();
    await persistSession();
    return null;
  }
}

async function logout() {
  const currentRefreshToken = getRefreshToken();
  // La baja va **antes** de limpiar el token: la ruta exige sesión, y hacerlo
  // después dejaría el dispositivo recibiendo push de una cuenta cerrada.
  const deviceId = getRegisteredDeviceId();
  if (deviceId) {
    await revokeDevice(deviceId).catch(() => undefined);
    setRegisteredDeviceId(null);
  }
  clearSessionTokens();
  await persistSession();
  if (currentRefreshToken) {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: currentRefreshToken }),
    });
  }
}

export const accountApi = {
  registerDevice,
  revokeDevice,
  login,
  restoreSession,
  logout,
  async register(input: { name: string; email: string; password: string; phone?: string }) {
    return request<{
      user: import("../types").User;
      verificationRequired: true;
      developmentCode?: string;
      expiresAt?: string;
    }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ ...input, deviceName: "Flash Mobile" }),
    });
  },
  async resendEmailVerification(email: string) {
    return request<{ message: string; developmentCode?: string; expiresAt?: string }>(
      "/auth/email-verification/resend",
      { method: "POST", body: JSON.stringify({ email }) },
    );
  },
  async confirmEmailVerification(email: string, code: string) {
    return request<{ verified: boolean; user: import("../types").User }>(
      "/auth/email-verification/confirm",
      { method: "POST", body: JSON.stringify({ email, code }) },
    );
  },
  async requestPhoneVerification() {
    return request<{ expiresAt: string; retryAfterSeconds: number; developmentCode?: string }>(
      "/me/phone-verification/request",
      { method: "POST", body: "{}" },
    );
  },
  async confirmPhoneVerification(code: string) {
    return request<{ verified: true; phone: string }>("/me/phone-verification/confirm", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
  },
  async requestPasswordRecovery(email: string) {
    return request<{ message: string; developmentToken?: string; expiresAt?: string }>(
      "/auth/password-recovery/request",
      { method: "POST", body: JSON.stringify({ email }) },
    );
  },
  async confirmPasswordRecovery(token: string, password: string) {
    return request<{ passwordChanged: boolean; revokedSessions: number }>(
      "/auth/password-recovery/confirm",
      { method: "POST", body: JSON.stringify({ token, password }) },
    );
  },
  async getAccountContext() {
    return request<{
      account: {
        user: import("../types").User;
        addresses: import("../types").UserAddress[];
        paymentMethods: import("../types").PaymentMethod[];
        supportTickets: import("../types").SupportTicket[];
        tips: import("../types").ServiceTip[];
        favoriteRestaurantIds: string[];
      };
    }>("/me");
  },
  async createSandboxPaymentMethod(input: {
    providerToken: string;
    brand: "visa" | "mastercard" | "amex" | "cabal";
    last4: string;
    expiryMonth: number;
    expiryYear: number;
    isDefault?: boolean;
  }) {
    return request<{ paymentMethod: import("../types").PaymentMethod }>(
      "/payment-methods/sandbox",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  },
  async setDefaultPaymentMethod(paymentMethodId: string) {
    return request<{ paymentMethod: import("../types").PaymentMethod }>(
      `/payment-methods/${paymentMethodId}/default`,
      { method: "PATCH", body: "{}" },
    );
  },
  async deletePaymentMethod(paymentMethodId: string) {
    return request<{ paymentMethods: import("../types").PaymentMethod[] }>(
      `/payment-methods/${paymentMethodId}`,
      { method: "DELETE" },
    );
  },
  async getNotifications() {
    return request<{ notifications: import("../types").AppNotification[] }>("/notifications");
  },
  async getAccountSessions() {
    return request<{ sessions: import("../types").AccountSession[] }>("/me/sessions");
  },
  async revokeAccountSession(sessionId: string) {
    return request<{ revoked: true; id: string }>(`/me/sessions/${sessionId}`, {
      method: "DELETE",
    });
  },
  async revokeOtherAccountSessions() {
    const currentRefreshToken = getRefreshToken();
    if (!currentRefreshToken) throw new Error("La sesión actual no tiene credencial de renovación");
    return request<{ revokedSessions: number }>("/me/sessions/revoke-others", {
      method: "POST",
      body: JSON.stringify({ refreshToken: currentRefreshToken }),
    });
  },
  async markNotificationRead(notificationId: string) {
    return request<{ notifications: import("../types").AppNotification[] }>(
      `/notifications/${notificationId}/read`,
      { method: "PATCH", body: "{}" },
    );
  },
  async getNotificationPreferences() {
    return request<{ preferences: import("../types").NotificationPreference[] }>(
      "/notification-preferences",
    );
  },
  async updateNotificationPreference(
    category: import("../types").NotificationPreference["category"],
    input: { pushEnabled: boolean; emailEnabled: boolean },
  ) {
    return request<{ preferences: import("../types").NotificationPreference[] }>(
      `/notification-preferences/${category}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
  },
  async getDietaryPreferences() {
    return request<{ preferences: import("../types").DietaryPreferences }>("/dietary-preferences");
  },
  async sendAnalyticsEvents(events: AnalyticsEvent[]) {
    return request<{ accepted: number; duplicates: number }>("/analytics/events", {
      method: "POST",
      body: JSON.stringify({ events }),
    });
  },
  async updateDietaryPreferences(input: {
    dietaryLabels: string[];
    avoidedAllergens: string[];
    hideIncompatible: boolean;
  }) {
    return request<{ preferences: import("../types").DietaryPreferences }>("/dietary-preferences", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },
  async getReferralSummary() {
    return request<{ referral: import("../types").ReferralSummary }>("/referrals/me");
  },
  async claimReferral(code: string) {
    return request<{ referral: import("../types").ReferralSummary }>("/referrals/claim", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
  },
  async createSupportTicket(input: {
    category: "food" | "ride" | "shipment" | "payment" | "account" | "safety" | "other";
    priority: "low" | "normal" | "high" | "urgent";
    subject: string;
    body: string;
    jobId?: string;
  }) {
    return request<{ ticket: import("../types").SupportTicket }>("/support/tickets", {
      method: "POST",
      headers: {
        "Idempotency-Key": `mobile-support-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
      body: JSON.stringify(input),
    });
  },
  async sendSupportMessage(ticketId: string, body: string) {
    return request<{ ticket: import("../types").SupportTicket }>(
      `/support/tickets/${ticketId}/messages`,
      {
        method: "POST",
        headers: {
          "Idempotency-Key": `mobile-support-message-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
        body: JSON.stringify({ body, internal: false }),
      },
    );
  },
  async createAddress(payload: {
    label: string;
    address: string;
    lat: number;
    lng: number;
    isDefault: boolean;
    validationToken: string;
  }) {
    return request<{ address: UserAddress; addresses: UserAddress[] }>("/addresses", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  async setDefaultAddress(addressId: string) {
    return request<{ address: UserAddress; addresses: UserAddress[] }>(
      `/addresses/${addressId}/default`,
      { method: "PATCH", body: "{}" },
    );
  },
  async deleteAddress(addressId: string) {
    return request<{ deleted: boolean; addresses: UserAddress[] }>(`/addresses/${addressId}`, {
      method: "DELETE",
    });
  },
  async createTip(jobId: string, amount: number) {
    return request<{ tip: import("../types").ServiceTip }>(`/jobs/${jobId}/tips`, {
      method: "POST",
      headers: {
        "Idempotency-Key": `mobile-tip-${jobId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
      body: JSON.stringify({ amount }),
    });
  },
  async getReceipt(jobId: string) {
    return request<{ receipt: import("../types").ServiceReceipt }>(`/jobs/${jobId}/receipt`);
  },

  // Suscripción de Flash (GTM-001). El catálogo es público porque el precio
  // tiene que poder verse antes de crear la cuenta; el resto pide sesión y
  // siempre opera sobre la propia.,
  async getSubscriptionPlans() {
    return request<{ plans: import("../types").SubscriptionPlan[] }>("/subscription/plans");
  },
  async getSubscription() {
    return request<{ subscription: import("../types").Subscription | null }>("/subscription");
  },
  async subscribe(planKey: string) {
    return request<{ subscription: import("../types").Subscription }>("/subscription", {
      method: "POST",
      body: JSON.stringify({ planKey }),
    });
  },
  async cancelSubscription() {
    return request<{ id: string; cancelled: true; benefitsUntil: string }>("/subscription", {
      method: "DELETE",
    });
  },
};
