// Cuenta y sesión web (ARC-001).
import type { AppState, User } from "../types";
import type { AnalyticsEvent } from "../analytics";
import {
  audienceForUser,
  clearAuthToken,
  hasAuthToken,
  persistRefreshToken,
  refreshAccessToken,
  request,
  revokeSession,
  setActiveAudience,
  setAuthToken,
} from "./http";

export const accountApi = {
  async updateProfile(payload: { name: string; phone: string; defaultAddress: string }) {
    return request<{ account: { user: User } }>("/me", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  async topUpWallet(amount: number) {
    return request<{ account: { user: User } }>("/wallet/topup", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ amount }),
    });
  },
  async login(email: string, password: string) {
    const session = await request<{
      user: User;
      token?: string;
      refreshToken?: string;
      mfaRequired?: boolean;
      mfaChallenge?: string;
    }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (session.token) {
      setAuthToken(session.token);
      persistRefreshToken(session.refreshToken || "");
      if (session.user) setActiveAudience(audienceForUser(session.user));
    }
    return session;
  },
  async createAddress(payload: {
    label: string;
    address: string;
    lat: number;
    lng: number;
    isDefault: boolean;
    validationToken: string;
  }) {
    return request<{
      address: AppState["addresses"][number];
      addresses: AppState["addresses"];
    }>("/addresses", { method: "POST", body: JSON.stringify(payload) });
  },
  async updateAddress(
    addressId: string,
    payload: {
      label: string;
      address: string;
      lat: number;
      lng: number;
      isDefault: boolean;
      validationToken: string;
    },
  ) {
    return request<{
      address: AppState["addresses"][number];
      addresses: AppState["addresses"];
    }>(`/addresses/${addressId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  async setDefaultAddress(addressId: string) {
    return request<{
      address: AppState["addresses"][number];
      addresses: AppState["addresses"];
    }>(`/addresses/${addressId}/default`, { method: "PATCH", body: "{}" });
  },
  async deleteAddress(addressId: string) {
    return request<{ deleted: boolean; addresses: AppState["addresses"] }>(
      `/addresses/${addressId}`,
      { method: "DELETE" },
    );
  },
  async completeMfa(challenge: string, code: string) {
    const session = await request<{
      user: User;
      token: string;
      refreshToken?: string;
    }>("/auth/mfa/complete", {
      method: "POST",
      body: JSON.stringify({ challenge, code, deviceName: "Flash Web" }),
    });
    setAuthToken(session.token);
    setActiveAudience(audienceForUser(session.user));
    persistRefreshToken(session.refreshToken || "");
    return session;
  },
  async getMfaStatus() {
    return request<{
      mfa: {
        enabled: boolean;
        method: string;
        confirmedAt: string | null;
        lockedUntil: string | null;
        recoveryCodesRemaining: number;
      };
    }>("/auth/mfa/status");
  },
  async enrollMfa() {
    return request<{
      enrollment: {
        secret: string;
        otpauthUri: string;
        recoveryCodes: string[];
      };
    }>("/auth/mfa/enroll", { method: "POST", body: "{}" });
  },
  async confirmMfa(code: string) {
    const session = await request<{
      mfa: {
        enabled: boolean;
        method: string;
        confirmedAt: string | null;
        lockedUntil: string | null;
        recoveryCodesRemaining: number;
      };
      token: string;
      refreshToken?: string;
    }>("/auth/mfa/confirm", {
      method: "POST",
      body: JSON.stringify({ code, deviceName: "Flash Web" }),
    });
    setAuthToken(session.token);
    persistRefreshToken(session.refreshToken || "");
    return session;
  },
  async getAccountContext() {
    return request<{
      account: {
        user: User;
        addresses: AppState["addresses"];
        paymentMethods: AppState["paymentMethods"];
        walletTransactions: AppState["walletTransactions"];
        supportTickets: AppState["supportTickets"];
        ratings: AppState["ratings"];
        favoriteRestaurantIds: string[];
        tips: NonNullable<AppState["tips"]>;
      };
    }>("/me");
  },
  async getNotifications() {
    return request<{ notifications: import("../types").AppNotification[] }>("/notifications");
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
  async restoreSession() {
    if (!hasAuthToken() && !(await refreshAccessToken())) return null;
    try {
      const account = await request<{ account: { user: User } }>("/me");
      setActiveAudience(audienceForUser(account.account.user));
      return account.account.user;
    } catch (_error) {
      clearAuthToken();
      return null;
    }
  },
  async logout() {
    await revokeSession();
  },

  // Mover el horario de un servicio reservado (GTM-001). Vale para pedidos y
  // viajes: los dos son trabajos con horario, y la ruta es la misma.,
  async getDietaryPreferences() {
    return request<{ preferences: import("../types").DietaryPreferences }>("/dietary-preferences");
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
  async sendAnalyticsEvents(events: AnalyticsEvent[]) {
    return request<{ accepted: number; duplicates: number }>("/analytics/events", {
      method: "POST",
      body: JSON.stringify({ events }),
    });
  },
  async getFeatures() {
    return request<{
      features: Record<string, { active: boolean; variant: Record<string, unknown> }>;
    }>("/features");
  },
  async getProductMetrics(days = 7) {
    return request<{ metrics: import("../types").ProductMetrics }>(
      `/operations/product-metrics?days=${days}`,
    );
  },
  async getFeatureFlags() {
    return request<{ flags: import("../types").FeatureFlag[] }>("/operations/feature-flags");
  },
  async updateFeatureFlag(
    flagId: string,
    patch: Partial<Pick<import("../types").FeatureFlag, "enabled" | "rolloutPercentage">>,
  ) {
    return request<{ flag: import("../types").FeatureFlag }>(
      `/operations/feature-flags/${flagId}`,
      {
        method: "PATCH",
        body: JSON.stringify(patch),
      },
    );
  },
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
