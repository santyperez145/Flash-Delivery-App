// Mapa de recursos HTTP mobile (ARC-001).
//
// El transporte vive en `http.ts`. Cuenta, comercio, movilidad y operaciones
// tienen módulos propios; acá sólo se componen y se arma el bootstrap.
import type { AppState, Driver, Order, Restaurant, Ride, Shipment } from "./types";
import { mobileSessionStorage } from "./session-storage";
import { accountApi } from "./api/account";
import { commerceApi } from "./api/commerce";
import { getActiveAudience, request } from "./api/http";
import { mobilityApi } from "./api/mobility";
import { operationsApi } from "./api/operations";

export { mobileAppVariant } from "./api/http";

export const api = {
  ...accountApi,
  ...commerceApi,
  ...mobilityApi,
  ...operationsApi,
  sessionStorage: mobileSessionStorage,
  async state() {
    const [
      bootstrap,
      activity,
      catalog,
      driverContext,
      merchantContext,
      assignedDrivers,
      accountContext,
      promotionContext,
    ] = await Promise.all([
      request<{
        state: Omit<AppState, "orders" | "rides" | "shipments"> & {
          restaurants?: Restaurant[];
          drivers?: Driver[];
        };
        audience: string;
      }>(`/bootstrap/${getActiveAudience()}`),
      this.getActivity(undefined, 50),
      getActiveAudience() === "merchant" ? Promise.resolve(null) : this.getCatalog(undefined, 50),
      getActiveAudience() === "driver" ? this.getCurrentDriver() : Promise.resolve(null),
      getActiveAudience() === "merchant" ? this.getCurrentMerchant() : Promise.resolve(null),
      ["customer", "merchant"].includes(getActiveAudience())
        ? this.getAssignedDrivers()
        : Promise.resolve(null),
      this.getAccountContext(),
      this.getPromotions(),
    ]);
    const account = accountContext.account;
    return {
      ...bootstrap,
      state: {
        ...bootstrap.state,
        addresses: account.addresses,
        paymentMethods: account.paymentMethods,
        supportTickets: account.supportTickets,
        tips: account.tips || [],
        promotions: promotionContext.promotions || [],
        favoriteRestaurantIds: account.favoriteRestaurantIds || [],
        restaurants:
          merchantContext?.restaurants || catalog?.restaurants || bootstrap.state.restaurants || [],
        drivers: driverContext
          ? [driverContext.driver]
          : assignedDrivers?.drivers || bootstrap.state.drivers || [],
        orders: activity.items
          .filter((item) => item.kind === "order")
          .map((item) => item.resource as Order),
        rides: activity.items
          .filter((item) => item.kind === "ride")
          .map((item) => item.resource as Ride),
        shipments: activity.items
          .filter((item) => item.kind === "shipment")
          .map((item) => item.resource as Shipment),
      } as AppState,
    };
  },
};
