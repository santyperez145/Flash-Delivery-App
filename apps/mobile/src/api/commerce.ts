// Comercio y pedidos mobile (ARC-001).
import type { FoodCheckoutQuote, Order, Restaurant, Ride, Shipment } from "../types";
import { request } from "./http";

export const commerceApi = {
  async getPaymentClientConfiguration(merchantId?: string) {
    return request<{
      provider: "mercadopago" | "disabled";
      publicKey: string | null;
      merchantReady: boolean;
      cardDataHandling: "provider_tokenization_only";
    }>(
      `/payment-provider/client-configuration${merchantId ? `?merchantId=${encodeURIComponent(merchantId)}` : ""}`,
    );
  },
  async getActivity(cursor?: string, limit = 20) {
    const params = new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) });
    return request<{
      items: Array<{
        id: string;
        kind: "order" | "ride" | "shipment";
        createdAt: string;
        resource: Order | Ride | Shipment;
      }>;
      nextCursor: string | null;
    }>(`/me/activity?${params}`);
  },
  async getCatalog(cursor?: string, limit = 20, query = "") {
    const params = new URLSearchParams({
      limit: String(limit),
      ...(cursor ? { cursor } : {}),
      ...(query ? { q: query } : {}),
    });
    return request<{ restaurants: Restaurant[]; nextCursor: string | null }>(
      `/catalog/restaurants?${params}`,
    );
  },
  async getPromotions() {
    return request<{ promotions: import("../types").Promotion[] }>("/promotions");
  },
  async setFavorite(restaurantId: string, favorite: boolean) {
    return request<{ restaurantIds: string[] }>(`/favorites/${restaurantId}`, {
      method: "PUT",
      body: JSON.stringify({ favorite }),
    });
  },
  async searchCatalog(query: string, offset = 0, limit = 20) {
    return request<{
      results: Array<{
        restaurantId: string;
        restaurantName: string;
        cuisine: string;
        image: string;
        cover: string;
        etaMin: number;
        deliveryFee: number;
        matchedItems: Array<{ id: string; name: string; category: string }>;
        matchCount: number;
        score: number;
      }>;
      total: number;
      limit: number;
      offset: number;
      nextOffset: number | null;
    }>(`/catalog/search?q=${encodeURIComponent(query)}&offset=${offset}&limit=${limit}`);
  },
  async rescheduleJob(jobId: string, scheduledFor: string) {
    return request<{
      job: {
        id: string;
        kind: string;
        status: string;
        previousScheduledFor: string;
        scheduledFor: string;
      };
    }>(`/jobs/${jobId}/schedule`, {
      method: "PATCH",
      body: JSON.stringify({ scheduledFor }),
    });
  },
  // Pedidos grupales (GTM-001). Confirmar no vive acá: se piden los ítems
  // juntos, se crean por `/orders` como cualquier pedido, y se avisa con
  // `markGroupOrderPlaced`. Un camino de creación paralelo habría duplicado
  // idempotencia, riesgo y cotización firmada sólo para el caso grupal.,
  async getGroupOrders() {
    return request<{ groups: import("../types").GroupOrder[] }>("/group-orders");
  },
  async getGroupOrder(groupId: string) {
    return request<{ group: import("../types").GroupOrder }>(`/group-orders/${groupId}`);
  },
  async createGroupOrder(payload: {
    restaurantId: string;
    branchId?: string;
    spendLimitCents?: number;
    closesAt?: string;
  }) {
    return request<{ group: import("../types").GroupOrder }>("/group-orders", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  async joinGroupOrder(joinCode: string) {
    return request<{ group: import("../types").GroupOrder }>("/group-orders/join", {
      method: "POST",
      body: JSON.stringify({ joinCode }),
    });
  },
  async setGroupOrderItems(
    groupId: string,
    items: Array<{ menuItemId: string; quantity: number; extras: string[]; note: string }>,
  ) {
    return request<{ group: import("../types").GroupOrder }>(`/group-orders/${groupId}/items`, {
      method: "PUT",
      body: JSON.stringify({ items }),
    });
  },
  async setGroupOrderStatus(groupId: string, status: "open" | "locked" | "cancelled") {
    return request<{ group: import("../types").GroupOrder }>(`/group-orders/${groupId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  },
  async getGroupOrderCheckout(groupId: string) {
    return request<{
      merchantPublicId: string;
      branchPublicId: string;
      items: Array<{ menuItemId: string; quantity: number; extras: string[]; note: string }>;
    }>(`/group-orders/${groupId}/checkout`);
  },
  async markGroupOrderPlaced(groupId: string, orderId: string) {
    return request<{ group: import("../types").GroupOrder }>(`/group-orders/${groupId}/placed`, {
      method: "POST",
      body: JSON.stringify({ orderId }),
    });
  },
  async createOrder(payload: {
    customerId: string;
    restaurantId: string;
    deliveryAddressId?: string;
    branchId?: string;
    deliveryAddress: string;
    paymentMethod: string;
    paymentMethodId?: string;
    providerPayment?: { cardToken: string; paymentMethodId: string; installments: number };
    promotionCode?: string;
    quoteToken: string;
    // Propina del checkout (GTM-001), en centavos y entera: en pesos con
    // decimales cada cliente redondea distinto, y esto es dinero.
    tipCents?: number;
    /** Reserva de horario en ISO. Ausente es «lo antes posible». */
    scheduledFor?: string;
    items: Array<{ menuItemId: string; quantity: number; extras: string[]; note: string }>;
  }) {
    if (!payload.deliveryAddressId)
      throw new Error("Selecciona una dirección guardada antes de confirmar");
    return request<{ order: Order }>("/orders", {
      method: "POST",
      headers: { "Idempotency-Key": `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}` },
      body: JSON.stringify(payload),
    });
  },
  async reorder(orderId: string) {
    return request<{
      sourceOrderId: string;
      restaurantId: string;
      cart: import("../types").CartLine[];
    }>(`/orders/${orderId}/reorder`, { method: "POST", body: "{}" });
  },
  async quoteFoodCheckout(payload: {
    customerId: string;
    restaurantId: string;
    deliveryAddressId: string;
    branchId?: string;
    paymentMethod: string;
    paymentMethodId: string;
    promotionCode?: string;
    items: Array<{ menuItemId: string; quantity: number; extras: string[]; note: string }>;
  }) {
    return request<{ quote: FoodCheckoutQuote }>("/orders/quote", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  async setOrderStatus(orderId: string, status: Order["status"], reason = "changed_mind") {
    return request<{ order: Order }>(`/orders/${orderId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, ...(status === "cancelled" ? { reason } : {}) }),
    });
  },
  async createOrderIssue(
    orderId: string,
    payload: {
      category: "missing_item" | "wrong_item" | "damaged_item" | "quality" | "late" | "other";
      description: string;
      requestedRefund: number;
    },
  ) {
    return request<{ issue: import("../types").OrderIssue }>(`/orders/${orderId}/issues`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  async getOrderIssues(orderId: string) {
    return request<{ issues: import("../types").OrderIssue[] }>(`/orders/${orderId}/issues`);
  },
  async proposeOrderSubstitution(
    orderId: string,
    payload: { originalMenuItemId: string; replacementMenuItemId: string; reason: string },
  ) {
    return request<{ substitution: import("../types").OrderSubstitution }>(
      `/orders/${orderId}/substitutions`,
      { method: "POST", body: JSON.stringify(payload) },
    );
  },
  async getOrderSubstitutions(orderId: string) {
    return request<{ substitutions: import("../types").OrderSubstitution[] }>(
      `/orders/${orderId}/substitutions`,
    );
  },
  async decideOrderSubstitution(substitutionId: string, decision: "accepted" | "rejected") {
    return request<{ substitution: import("../types").OrderSubstitution }>(
      `/order-substitutions/${substitutionId}`,
      { method: "PATCH", body: JSON.stringify({ decision }) },
    );
  },
  async cart() {
    return request<{ cart: import("../types").CartLine[] }>("/cart");
  },
  async saveCart(restaurantId: string, cart: import("../types").CartLine[]) {
    return request<{ cart: import("../types").CartLine[] }>("/cart", {
      method: "PUT",
      body: JSON.stringify({
        restaurantId,
        items: cart.map((line) => ({
          menuItemId: line.item.id,
          quantity: line.quantity,
          extras: line.extras,
          note: line.note,
        })),
      }),
    });
  },
  async saveMobileCart(
    restaurantId: string | undefined,
    items: Array<{ menuItemId: string; quantity: number; extras: string[]; note: string }>,
  ) {
    return request<{ cart: import("../types").CartLine[] }>("/cart", {
      method: "PUT",
      body: JSON.stringify({ restaurantId, items }),
    });
  },
  async updateRestaurant(restaurantId: string, payload: { open?: boolean; etaMin?: number }) {
    return request(`/restaurants/${restaurantId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  async updateMenuStock(restaurantId: string, itemId: string, stock: boolean) {
    return request<{ restaurant: Restaurant }>(`/restaurants/${restaurantId}/menu/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ stock }),
    });
  },
  async addMenuItem(
    restaurantId: string,
    payload: { name: string; description: string; category: string; price: number },
  ) {
    return request<{ restaurant: Restaurant }>(`/restaurants/${restaurantId}/menu`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  async acceptDelivery(orderId: string, driverId: string) {
    return request<{ order: Order }>(`/orders/${orderId}/accept-delivery`, {
      method: "POST",
      body: JSON.stringify({ driverId }),
    });
  },
  async advanceOrder(orderId: string) {
    return request<{ order: Order }>(`/orders/${orderId}/advance`, { method: "POST" });
  },
};
