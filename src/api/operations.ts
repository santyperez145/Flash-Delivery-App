// Operaciones, dinero y comercio backoffice web (ARC-001).
import type {
  AdminDashboard,
  AppState,
  Driver,
  MerchantFinance,
  MerchantOperationsDashboard,
  Restaurant,
  User,
} from "../types";
import { request } from "./http";

export const operationsApi = {
  async getCurrentMerchant() {
    return request<{ restaurants: Restaurant[] }>("/merchant/me");
  },
  async getOperationsRestaurants(cursor?: string, limit = 50, query = "") {
    const params = new URLSearchParams({
      limit: String(limit),
      ...(cursor ? { cursor } : {}),
      ...(query ? { q: query } : {}),
    });
    return request<{ restaurants: Restaurant[]; nextCursor: string | null }>(
      `/operations/restaurants?${params}`,
    );
  },
  async getOperationsDrivers(cursor?: string, limit = 50, query = "") {
    const params = new URLSearchParams({
      limit: String(limit),
      ...(cursor ? { cursor } : {}),
      ...(query ? { q: query } : {}),
    });
    return request<{ drivers: Driver[]; nextCursor: string | null }>(
      `/operations/drivers?${params}`,
    );
  },
  async getOperationsUsers(cursor?: string, limit = 50, query = "") {
    const params = new URLSearchParams({
      limit: String(limit),
      ...(cursor ? { cursor } : {}),
      ...(query ? { q: query } : {}),
    });
    return request<{ users: User[]; nextCursor: string | null }>(`/operations/users?${params}`);
  },
  async getOperationsSupportTickets(cursor?: string, limit = 50, query = "") {
    const params = new URLSearchParams({
      limit: String(limit),
      ...(cursor ? { cursor } : {}),
      ...(query ? { q: query } : {}),
    });
    return request<{ tickets: import("../types").SupportTicket[]; nextCursor: string | null }>(
      `/operations/support-tickets?${params}`,
    );
  },
  async getOperationsAuditEvents(cursor?: string, limit = 50, query = "") {
    const params = new URLSearchParams({
      limit: String(limit),
      ...(cursor ? { cursor } : {}),
      ...(query ? { q: query } : {}),
    });
    return request<{ events: AppState["auditEvents"]; nextCursor: string | null }>(
      `/operations/audit-events?${params}`,
    );
  },
  async getRuntimeConfiguration() {
    const [zones, promotions] = await Promise.all([
      request<{ zones: AppState["zones"] }>("/zones"),
      request<{ promotions: AppState["promotions"] }>("/promotions"),
    ]);
    return { zones: zones.zones, promotions: promotions.promotions };
  },
  async adminDashboard() {
    return request<{ dashboard: AdminDashboard }>("/admin/dashboard");
  },
  async getMerchantFinance(merchantId: string) {
    return request<{ finance: MerchantFinance }>(
      `/merchant/finance?merchantId=${encodeURIComponent(merchantId)}`,
    );
  },
  async getMerchantPaymentConnection(merchantId: string) {
    return request<{
      connection: import("../types").MerchantPaymentConnection | null;
      configured: boolean;
    }>(`/merchant/payment-provider?merchantId=${encodeURIComponent(merchantId)}`);
  },
  async beginMerchantPaymentConnection(merchantId: string) {
    return request<{ authorizationUrl: string; expiresAt: string }>(
      "/merchant/payment-provider/connect",
      { method: "POST", body: JSON.stringify({ merchantId }) },
    );
  },
  async disconnectMerchantPaymentConnection(merchantId: string, password: string) {
    return request<{ connection: import("../types").MerchantPaymentConnection }>(
      "/merchant/payment-provider/disconnect",
      { method: "POST", body: JSON.stringify({ merchantId, password }) },
    );
  },
  async authorizeMerchantPayout(merchantId: string, amount: number, password: string) {
    return request<{
      authorizationToken: string;
      expiresAt: string;
      merchantId: string;
      amount: number;
    }>("/merchant/payouts/authorize", {
      method: "POST",
      body: JSON.stringify({ merchantId, amount, password }),
    });
  },
  async requestMerchantPayout(merchantId: string, amount: number, authorizationToken: string) {
    return request<{ finance: MerchantFinance }>("/merchant/payouts", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ merchantId, amount, authorizationToken }),
    });
  },
  async getAdminPayouts() {
    return request<{ payouts: import("../types").PayoutReview[] }>("/admin/payouts");
  },
  async reviewPayout(id: string, decision: "approved" | "rejected", note: string) {
    return request<{ payout: import("../types").PayoutReview }>(`/admin/payouts/${id}/review`, {
      method: "PATCH",
      body: JSON.stringify({ decision, note }),
    });
  },
  async getTipAdjustments() {
    return request<{ adjustments: import("../types").TipAdjustment[] }>("/admin/tip-adjustments");
  },
  async requestTipAdjustment(tipId: string, amount: number, reason: string) {
    return request<{ adjustment: import("../types").TipAdjustment }>("/admin/tip-adjustments", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ tipId, amount, reason }),
    });
  },
  async reviewTipAdjustment(id: string, decision: "approved" | "rejected", note: string) {
    return request<{ adjustment: import("../types").TipAdjustment }>(
      `/admin/tip-adjustments/${id}/review`,
      { method: "PATCH", body: JSON.stringify({ decision, note }) },
    );
  },
  async getSupportAgents() {
    return request<{ agents: import("../types").SupportAgent[] }>("/admin/support/agents");
  },
  async updateSupportAgent(
    userId: string,
    payload: {
      availability?: import("../types").SupportAgent["availability"];
      maxActiveTickets?: number;
      skills?: string[];
    },
  ) {
    return request<{ agent: import("../types").SupportAgent }>(`/admin/support/agents/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  async processSupportQueue(limit = 50) {
    return request<{
      result: {
        assigned: Array<{ ticketId: string; agentId: string }>;
        escalated: Array<{
          ticketId: string;
          level: number;
          breachKind: string;
        }>;
      };
    }>("/admin/support/process", {
      method: "POST",
      body: JSON.stringify({ limit }),
    });
  },
  async updateSupportTicket(
    ticketId: string,
    payload: {
      status?: import("../types").SupportTicket["status"];
      priority?: "low" | "normal" | "high" | "urgent";
      assignedTo?: string;
    },
  ) {
    return request<{ ticket: import("../types").SupportTicket }>(`/support/tickets/${ticketId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  async getNotificationDeadLetters() {
    return request<{ deadLetters: import("../types").NotificationDeadLetter[] }>(
      "/admin/notifications/dead-letters",
    );
  },
  async processNotifications(limit = 100) {
    return request<{
      result: { claimed: number; outcomes: Array<Record<string, unknown>> };
    }>("/admin/notifications/process", {
      method: "POST",
      body: JSON.stringify({ limit }),
    });
  },
  async replayNotificationDeadLetter(id: string) {
    return request<{ deadLetter: import("../types").NotificationDeadLetter }>(
      `/admin/notifications/dead-letters/${id}/replay`,
      { method: "POST", body: "{}" },
    );
  },
  async getMerchantDashboard(merchantId: string) {
    return request<{ dashboard: MerchantOperationsDashboard }>(
      `/merchant/dashboard?restaurantId=${encodeURIComponent(merchantId)}`,
    );
  },
  async getMerchantActiveOrders(merchantId: string, limit = 100) {
    return request<{
      generatedAt: string;
      source: "postgres-live-operations" | "sqlite-test-fallback";
      orders: AppState["orders"];
      hasMore: boolean;
    }>(`/merchant/orders/active?restaurantId=${encodeURIComponent(merchantId)}&limit=${limit}`);
  },
  async updateBranch(
    restaurantId: string,
    branchId: string,
    payload: {
      open?: boolean;
      etaMin?: number;
      status?: "active" | "paused" | "closed";
    },
  ) {
    return request<{ restaurant: Restaurant }>(
      `/restaurants/${restaurantId}/branches/${branchId}`,
      { method: "PATCH", body: JSON.stringify(payload) },
    );
  },
  async replaceBranchSchedule(
    restaurantId: string,
    branchId: string,
    payload: {
      timezone: string;
      hours: Array<{
        weekday: number;
        opensAt: string;
        closesAt: string;
        enabled: boolean;
      }>;
    },
  ) {
    return request<{ restaurant: Restaurant }>(
      `/restaurants/${restaurantId}/branches/${branchId}/schedule`,
      { method: "PUT", body: JSON.stringify(payload) },
    );
  },
  async upsertBranchScheduleException(
    restaurantId: string,
    branchId: string,
    payload: {
      date: string;
      isOpen: boolean;
      opensAt?: string;
      closesAt?: string;
      reason?: string;
    },
  ) {
    return request<{ restaurant: Restaurant }>(
      `/restaurants/${restaurantId}/branches/${branchId}/schedule-exceptions`,
      { method: "PUT", body: JSON.stringify(payload) },
    );
  },
  async updateBranchInventory(
    restaurantId: string,
    branchId: string,
    itemId: string,
    payload: { available: boolean; stockQuantity?: number | null },
  ) {
    return request<{ restaurant: Restaurant }>(
      `/restaurants/${restaurantId}/branches/${branchId}/inventory/${itemId}`,
      { method: "PATCH", body: JSON.stringify(payload) },
    );
  },
  async updateUserStatus(userId: string, status: "active" | "suspended", reason: string) {
    return request<{
      moderation: {
        id: string;
        status: string;
        revokedSessions: number;
        withdrawnOffers: number;
      };
    }>(`/admin/users/${userId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, reason }),
    });
  },
  async getAdminServiceQuickReplies() {
    return request<{ quickReplies: import("../types").ServiceQuickReply[] }>(
      "/admin/service-chat/quick-replies",
    );
  },
  async createServiceQuickReply(
    input: Omit<import("../types").ServiceQuickReply, "id" | "updatedAt">,
  ) {
    return request<{ quickReply: import("../types").ServiceQuickReply }>(
      "/admin/service-chat/quick-replies",
      { method: "POST", body: JSON.stringify(input) },
    );
  },
  async updateServiceQuickReply(
    id: string,
    input: Partial<Omit<import("../types").ServiceQuickReply, "id" | "updatedAt">>,
  ) {
    return request<{ quickReply: import("../types").ServiceQuickReply }>(
      `/admin/service-chat/quick-replies/${id}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
  },
  // Devoluciones de envío. El móvil ya las listaba y nadie podía resolverlas: la
  // cola se miraba y no se tocaba.
  // Catálogo de ciudades habilitadas. El producto asumía `buenos-aires` fijo en
  // todas partes; esto es la base para que la expansión a otra ciudad no sea un
  // cambio de código.,
  async getCities() {
    return request<{
      cities: Array<{ id: string; slug: string; name: string; currency: string }>;
    }>("/cities");
  },
  async getZonesByCity(citySlug: string) {
    return request<{ city: string; zones: import("../types").Zone[] }>(
      `/zones?city=${encodeURIComponent(citySlug)}`,
    );
  },
  async getRealtimeAudienceHealth(hours = 24) {
    return request<import("../types").RealtimeAudienceHealth>(
      `/admin/realtime-audience?hours=${hours}`,
    );
  },
  // Palancas de demanda. Ambas mueven dinero, así que el llamado es explícito y
  // no se dispara al escribir: la pantalla junta el cambio y lo confirma.,
  async updatePromotion(
    promotionId: string,
    patch: Partial<Pick<import("../types").Promotion, "active">>,
  ) {
    return request<{ promotion: import("../types").Promotion }>(`/promotions/${promotionId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },
  async updateZone(
    zoneId: string,
    patch: Partial<
      Pick<import("../types").Zone, "demandLevel" | "deliveryMultiplier" | "rideMultiplier">
    >,
  ) {
    return request<{ zone: import("../types").Zone }>(`/zones/${zoneId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },
  // Flags evaluados para la sesión actual. Es la mitad que faltaba del sistema
  // de release control: el panel de operaciones podía encender un flag y nadie
  // lo leía, así que encenderlo no hacía nada.,
  async getZoneReadiness(zoneId: string) {
    return request<{ readiness: import("../types").ZoneReadiness }>(
      `/operations/zones/${zoneId}/readiness`,
    );
  },
  // La evaluación no lleva cuerpo: el servidor la calcula y la deja registrada
  // con su actor. Sirve para dejar constancia de una decisión, no para dictarla.,
  async recordZoneAssessment(zoneId: string) {
    return request<{ assessment: { id: string; decision: string; assessedAt: string } }>(
      `/operations/zones/${zoneId}/readiness-assessments`,
      { method: "POST" },
    );
  },
  async getPaymentReconciliation() {
    return request<import("../types").PaymentReconciliation>("/admin/payment-reconciliation");
  },
  async scanPaymentReconciliation() {
    return request<import("../types").PaymentReconciliation>("/admin/payment-reconciliation/scan", {
      method: "POST",
    });
  },
  async resolvePaymentReconciliationCase(
    id: string,
    status: "resolved" | "ignored",
    resolutionNote: string,
  ) {
    return request<{ case: import("../types").PaymentReconciliationCase }>(
      `/admin/payment-reconciliation/${id}`,
      { method: "PATCH", body: JSON.stringify({ status, resolutionNote }) },
    );
  },
  async getTransactionRisks() {
    return request<{
      assessments: import("../types").TransactionRiskAssessment[];
    }>("/admin/transaction-risks");
  },
  async reviewTransactionRisk(
    id: string,
    reviewStatus: "confirmed_fraud" | "false_positive" | "cleared",
    reviewNote: string,
  ) {
    return request<{ assessment: import("../types").TransactionRiskAssessment }>(
      `/admin/transaction-risks/${id}`,
      { method: "PATCH", body: JSON.stringify({ reviewStatus, reviewNote }) },
    );
  },
  async getPricingPlans() {
    return request<{ plans: import("../types").PricingPlan[] }>("/pricing");
  },
  async getPricingChanges() {
    return request<{ requests: import("../types").PricingChangeRequest[] }>(
      "/admin/pricing-changes",
    );
  },
  async requestPricingChange(
    service: import("../types").PricingService,
    payload: {
      version: string;
      config: Record<string, unknown>;
      effectiveAt: string;
    },
  ) {
    return request<{ changeRequest: import("../types").PricingChangeRequest }>(
      `/admin/pricing/${service}`,
      { method: "POST", body: JSON.stringify(payload) },
    );
  },
  async requestPricingRollback(
    service: import("../types").PricingService,
    payload: { targetVersion: string; version: string; effectiveAt: string },
  ) {
    return request<{ changeRequest: import("../types").PricingChangeRequest }>(
      `/admin/pricing/${service}/rollback`,
      { method: "POST", body: JSON.stringify(payload) },
    );
  },
  async reviewPricingChange(requestId: string, decision: "approved" | "rejected", note: string) {
    return request<{ changeRequest: import("../types").PricingChangeRequest }>(
      `/admin/pricing-changes/${requestId}/review`,
      { method: "PATCH", body: JSON.stringify({ decision, note }) },
    );
  },
  async setMerchantStatus(merchantId: string, status: "active" | "suspended", reason: string) {
    return request<{
      merchant: {
        id: string;
        name: string;
        previousStatus: string;
        status: string;
        openJobs: number;
      };
    }>(`/admin/merchants/${merchantId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, reason }),
    });
  },
  async releaseJob(jobId: string, reason: string) {
    return request<{
      job: { id: string; kind: string; releasedFrom: string; status: string };
    }>(`/admin/jobs/${jobId}/release`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  },
  async assignJob(jobId: string, driverId: string, reason: string) {
    return request<{
      job: { id: string; kind: string; assignedTo: string; status: string };
    }>(`/admin/jobs/${jobId}/assign`, {
      method: "POST",
      body: JSON.stringify({ driverId, reason }),
    });
  },
  async getWorkQueues() {
    return request<{
      generatedAt: string;
      alerting: number;
      stalledJobs: number;
      queues: Array<{
        key: string;
        label: string;
        owner: "job" | "human";
        pending: number;
        oldestMinutes: number;
        oldestAt: string | null;
        severity: "ok" | "atencion" | "alarma";
      }>;
    }>("/operations/work-queues");
  },
  async reset() {
    return request<{ state: AppState }>("/reset", {
      method: "POST",
    });
  },
};
