// Comercio y pedidos web (ARC-001).
import type { AppState, CartLine, Restaurant } from "../types";
import { request } from "./http";

async function quoteFoodCheckout(payload: {
  customerId: string;
  restaurantId: string;
  deliveryAddressId: string;
  branchId?: string;
  paymentMethod: string;
  paymentMethodId?: string;
  promotionCode?: string;
  items: Array<Pick<CartLine, "quantity" | "extras" | "note"> & { menuItemId: string }>;
}) {
  return request<{ quote: import("../types").FoodCheckoutQuote }>("/orders/quote", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function createOrder(payload: {
  customerId: string;
  restaurantId: string;
  deliveryAddressId?: string;
  branchId?: string;
  deliveryAddress: string;
  paymentMethod: string;
  paymentMethodId?: string;
  providerPayment?: { cardToken: string; paymentMethodId: string; installments: number };
  promotionCode?: string;
  quoteToken?: string;
  // En centavos y entera: en pesos con decimales cada cliente redondea
  // distinto, y esto es dinero.
  tipCents?: number;
  /** Reserva de horario en ISO. Ausente es «lo antes posible». */
  scheduledFor?: string;
  items: Array<Pick<CartLine, "quantity" | "extras" | "note"> & { menuItemId: string }>;
}) {
  if (!payload.deliveryAddressId)
    throw new Error("Selecciona una dirección guardada antes de confirmar");
  const quoteToken =
    payload.quoteToken ||
    (
      await quoteFoodCheckout({
        customerId: payload.customerId,
        restaurantId: payload.restaurantId,
        deliveryAddressId: payload.deliveryAddressId,
        branchId: payload.branchId,
        paymentMethod: payload.paymentMethod,
        paymentMethodId: payload.paymentMethodId,
        promotionCode: payload.promotionCode,
        items: payload.items,
      })
    ).quote.quoteToken;
  return request<{ order: AppState["orders"][number]; label: string }>("/orders", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ ...payload, quoteToken }),
  });
}

export const commerceApi = {
  quoteFoodCheckout,
  createOrder,
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
  async getActivity(cursor?: string, limit = 20) {
    const params = new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) });
    return request<{
      items: Array<{
        id: string;
        kind: "order" | "ride" | "shipment";
        createdAt: string;
        resource: unknown;
      }>;
      nextCursor: string | null;
    }>(`/me/activity?${params}`);
  },
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
  async setFavorite(restaurantId: string, favorite: boolean) {
    return request<{ restaurantIds: string[] }>(`/favorites/${restaurantId}`, {
      method: "PUT",
      body: JSON.stringify({ favorite }),
    });
  },
  async createRating(
    jobId: string,
    subjectType: "driver" | "merchant" | "customer",
    score: number,
    comment = "",
  ) {
    return request<{ rating: AppState["ratings"][number] }>("/ratings", {
      method: "POST",
      body: JSON.stringify({ jobId, subjectType, score, tags: [], comment }),
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
  async resolveOrderIssue(
    issueId: string,
    payload: {
      status: "approved" | "rejected";
      approvedRefund: number;
      resolutionNote: string;
    },
  ) {
    return request<{ issue: import("../types").OrderIssue }>(`/order-issues/${issueId}/resolve`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  async proposeOrderSubstitution(
    orderId: string,
    payload: {
      originalMenuItemId: string;
      replacementMenuItemId: string;
      reason: string;
    },
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
  async cart() {
    return request<{ cart: CartLine[] }>("/cart");
  },
  async saveCart(restaurantId: string, cart: CartLine[]) {
    return request<{ cart: CartLine[] }>("/cart", {
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
  async advanceOrder(orderId: string) {
    return request<{ order: AppState["orders"][number]; label: string }>(
      `/orders/${orderId}/advance`,
      {
        method: "POST",
      },
    );
  },
  async acceptDelivery(orderId: string, driverId: string) {
    return request<{ order: AppState["orders"][number]; label: string }>(
      `/orders/${orderId}/accept-delivery`,
      {
        method: "POST",
        body: JSON.stringify({ driverId }),
      },
    );
  },
  async setOrderStatus(orderId: string, status: string, reason = "changed_mind") {
    return request<{ order: AppState["orders"][number]; label: string }>(
      `/orders/${orderId}/status`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status,
          ...(status === "cancelled" ? { reason } : {}),
        }),
      },
    );
  },
  async updateRestaurant(
    restaurantId: string,
    payload: Partial<Pick<Restaurant, "open" | "etaMin">>,
  ) {
    return request<{ restaurant: Restaurant }>(`/restaurants/${restaurantId}`, {
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
    payload: {
      name: string;
      description: string;
      category: string;
      price: number;
    },
  ) {
    return request<{ restaurant: Restaurant }>(`/restaurants/${restaurantId}/menu`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  async replaceItemModifiers(
    restaurantId: string,
    itemId: string,
    groups: NonNullable<Restaurant["menu"][number]["modifierGroups"]>,
  ) {
    return request<{ restaurant: Restaurant }>(
      `/restaurants/${restaurantId}/menu/${itemId}/modifiers`,
      {
        method: "PUT",
        body: JSON.stringify({
          groups: groups.map((group) => ({ ...group, active: true })),
        }),
      },
    );
  },
  async replaceItemDietary(
    restaurantId: string,
    itemId: string,
    payload: {
      dietaryLabels: string[];
      allergens: Array<{ code: string; presence: "contains" | "may_contain" }>;
    },
  ) {
    return request<{ restaurant: Restaurant }>(
      `/restaurants/${restaurantId}/menu/${itemId}/dietary`,
      { method: "PUT", body: JSON.stringify(payload) },
    );
  },
};
