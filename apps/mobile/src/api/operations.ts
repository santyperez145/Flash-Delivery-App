// Comercio backoffice mobile (ARC-001).
import type { Order, Restaurant } from "../types";
import { request } from "./http";

export const operationsApi = {
  async getCurrentMerchant() {
    return request<{ restaurants: Restaurant[] }>("/merchant/me");
  },
  async getMerchantDashboard(merchantId: string) {
    return request<{ dashboard: import("../types").MerchantOperationsDashboard }>(
      `/merchant/dashboard?restaurantId=${encodeURIComponent(merchantId)}`,
    );
  },
  async getMerchantActiveOrders(merchantId: string, limit = 100) {
    return request<{
      generatedAt: string;
      source: "postgres-live-operations" | "sqlite-test-fallback";
      orders: Order[];
      hasMore: boolean;
    }>(`/merchant/orders/active?restaurantId=${encodeURIComponent(merchantId)}&limit=${limit}`);
  },
  async updateBranchInventory(
    restaurantId: string,
    branchId: string,
    itemId: string,
    input: { available: boolean; stockQuantity?: number | null },
  ) {
    return request<{ restaurant: Restaurant }>(
      `/restaurants/${restaurantId}/branches/${branchId}/inventory/${itemId}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
  },
};
