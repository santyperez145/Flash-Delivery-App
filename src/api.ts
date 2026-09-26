// Mapa de recursos HTTP web (ARC-001).
//
// El transporte vive en `http.ts`. Cuenta, comercio, movilidad y operaciones
// tienen módulos propios; acá sólo se componen y se arma el bootstrap.
import type { AppState, Driver, Restaurant, User } from "./types";
import { accountApi } from "./api/account";
import { commerceApi } from "./api/commerce";
import { getActiveAudience, request } from "./api/http";
import { mobilityApi } from "./api/mobility";
import { operationsApi } from "./api/operations";

export { clearAuthToken, setAuthToken, subscribeToEvents } from "./api/http";

export const api = {
  ...accountApi,
  ...commerceApi,
  ...mobilityApi,
  ...operationsApi,
  async state() {
    const [
      bootstrap,
      activity,
      catalog,
      driverContext,
      merchantContext,
      assignedDrivers,
      operationsRestaurants,
      operationsDrivers,
      operationsUsers,
      operationsSupport,
      configuration,
      operationsAudit,
      accountContext,
      notifications,
      notificationPreferences,
    ] = await Promise.all([
      request<{
        state: Omit<AppState, "orders" | "rides" | "shipments"> & {
          restaurants?: Restaurant[];
          drivers?: Driver[];
          users?: User[];
          supportTickets?: import("./types").SupportTicket[];
          zones?: AppState["zones"];
          promotions?: AppState["promotions"];
          auditEvents?: AppState["auditEvents"];
        };
        audience: string;
      }>(`/bootstrap/${getActiveAudience()}`),
      getActiveAudience() === "support"
        ? Promise.resolve({ items: [], nextCursor: null })
        : this.getActivity(undefined, 50),
      ["customer", "driver"].includes(getActiveAudience())
        ? this.getCatalog(undefined, 50)
        : Promise.resolve(null),
      getActiveAudience() === "driver" ? this.getCurrentDriver() : Promise.resolve(null),
      getActiveAudience() === "merchant" ? this.getCurrentMerchant() : Promise.resolve(null),
      ["customer", "merchant"].includes(getActiveAudience())
        ? this.getAssignedDrivers()
        : Promise.resolve(null),
      getActiveAudience() === "operations"
        ? this.getOperationsRestaurants(undefined, 100)
        : Promise.resolve(null),
      getActiveAudience() === "operations"
        ? this.getOperationsDrivers(undefined, 100)
        : Promise.resolve(null),
      getActiveAudience() === "operations"
        ? this.getOperationsUsers(undefined, 100)
        : Promise.resolve(null),
      ["operations", "support"].includes(getActiveAudience())
        ? this.getOperationsSupportTickets(undefined, 100)
        : Promise.resolve(null),
      this.getRuntimeConfiguration(),
      getActiveAudience() === "operations"
        ? this.getOperationsAuditEvents(undefined, 100)
        : Promise.resolve(null),
      this.getAccountContext(),
      this.getNotifications(),
      this.getNotificationPreferences(),
    ]);
    const account = accountContext.account;
    return {
      ...bootstrap,
      state: {
        ...bootstrap.state,
        addresses: account.addresses,
        paymentMethods: account.paymentMethods,
        walletTransactions: account.walletTransactions,
        ratings: account.ratings,
        favoriteRestaurantIds: account.favoriteRestaurantIds || [],
        tips: account.tips || [],
        zones: configuration.zones,
        promotions: configuration.promotions,
        auditEvents: operationsAudit?.events || bootstrap.state.auditEvents || [],
        users:
          getActiveAudience() === "support"
            ? [account.user]
            : operationsUsers?.users || bootstrap.state.users || [],
        supportTickets: operationsSupport?.tickets || account.supportTickets || [],
        notifications: notifications.notifications,
        notificationPreferences: notificationPreferences.preferences,
        restaurants:
          operationsRestaurants?.restaurants ||
          merchantContext?.restaurants ||
          catalog?.restaurants ||
          bootstrap.state.restaurants ||
          [],
        drivers:
          operationsDrivers?.drivers ||
          (driverContext
            ? [driverContext.driver]
            : assignedDrivers?.drivers || bootstrap.state.drivers || []),
        orders: activity.items
          .filter((item) => item.kind === "order")
          .map((item) => item.resource) as AppState["orders"],
        rides: activity.items
          .filter((item) => item.kind === "ride")
          .map((item) => item.resource) as AppState["rides"],
        shipments: activity.items
          .filter((item) => item.kind === "shipment")
          .map((item) => item.resource) as AppState["shipments"],
      } as AppState,
    };
  },
};
