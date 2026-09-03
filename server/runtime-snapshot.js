// El estado agregado de la plataforma (ticket ARC-001).
//
// Cuatro funciones que responden «cómo viene todo»: el estado que se carga del
// runtime activo, las métricas derivadas y los dos redondeos que las expresan.
//
// Se extrajeron al sacar el panel administrativo, porque son lo único que ese
// panel comparte con lo que se queda en `server/index.js`: el bootstrap por
// audiencia y los dos endpoints de métricas. Tres consumidores que no se
// conocen entre sí y una definición sola: eso es un módulo.
//
// `ratio` y `average` devuelven 0 cuando el denominador es 0, y no `NaN`. Acá
// esa elección es la correcta y no la discutible que quedó anotada en
// `money.js`: un promedio sobre cero pedidos **es** cero para un tablero, y un
// `NaN` propagado rompería el JSON entero por una división vacía.
import { usesPostgresCommerce } from "./postgres.js";

import {
  getPostgresAddresses,
  getPostgresPaymentMethods,
  getPostgresUsers,
} from "./auth-repository.js";
import { isAdmin } from "./http/authorization.js";
import { getPostgresRestaurants } from "./catalog-repository.js";
import { getPostgresPromotions, getPostgresZones } from "./configuration-repository.js";
import { getPostgresDrivers } from "./driver-roster-repository.js";
import { getPostgresFavoriteMerchantIds, getPostgresRatings } from "./feedback-repository.js";
import { getPostgresRides } from "./ride-repository.js";
import { getPostgresShipments } from "./mobility-repository.js";
import { getPostgresAuditEvents, getPostgresSupportTickets } from "./operations-repository.js";
import { getPostgresOrders } from "./order-repository.js";
import { getPublicState, getTimestamp } from "./store.js";
import { getPostgresTips } from "./tip-repository.js";
import { getPostgresWalletTransactions, getWalletBalances } from "./wallet-repository.js";

export async function loadRuntimeState(req) {
  if (!usesPostgresCommerce()) return getPublicState();
  const state = {
    meta: { version: 65, updatedAt: getTimestamp(), database: "postgres" },
    users: [],
    addresses: [],
    paymentMethods: [],
    walletTransactions: [],
    restaurants: [],
    drivers: [],
    orders: [],
    rides: [],
    shipments: [],
    promotions: [],
    supportTickets: [],
    ratings: [],
    zones: [],
    auditEvents: [],
    favoriteRestaurantIds: [],
    tips: [],
  };
  [
    state.users,
    state.addresses,
    state.paymentMethods,
    state.walletTransactions,
    state.restaurants,
    state.orders,
    state.drivers,
    state.rides,
    state.shipments,
    state.supportTickets,
    state.promotions,
    state.zones,
    state.auditEvents,
    state.ratings,
    state.favoriteRestaurantIds,
    state.tips,
  ] = await Promise.all([
    getPostgresUsers({ includeInactive: isAdmin(req) }),
    getPostgresAddresses(),
    getPostgresPaymentMethods(),
    getPostgresWalletTransactions({
      userPublicId: req.auth.userId,
      includeAll: isAdmin(req),
    }),
    getPostgresRestaurants(),
    getPostgresOrders(),
    getPostgresDrivers(),
    getPostgresRides(),
    getPostgresShipments(),
    getPostgresSupportTickets({
      userPublicId: req.auth.userId,
      roles: req.auth.roles,
    }),
    getPostgresPromotions({ includeInactive: isAdmin(req) }),
    getPostgresZones(),
    isAdmin(req) ? getPostgresAuditEvents(100) : Promise.resolve([]),
    getPostgresRatings({
      userPublicId: req.auth.userId,
      includeAll: isAdmin(req),
    }),
    getPostgresFavoriteMerchantIds(req.auth.userId),
    getPostgresTips({ userPublicId: req.auth.userId, roles: req.auth.roles }),
  ]);
  const balances = await getWalletBalances();
  state.users = state.users.map((user) => {
    const {
      password: _password,
      internalId: _internalId,
      loginLockedUntil: _loginLockedUntil,
      ...safeUser
    } = user;
    return { ...safeUser, wallet: balances.get(user.id) || 0 };
  });
  return state;
}

export function metrics(db) {
  const activeOrderStatuses = [
    "accepted",
    "preparing",
    "ready_for_pickup",
    "courier_assigned",
    "picked_up",
    "delivering",
  ];
  const activeRideStatuses = ["requested", "driver_assigned", "arriving", "in_progress"];
  const activeOrders = db.orders.filter((order) => activeOrderStatuses.includes(order.status));
  const activeRides = db.rides.filter((ride) => activeRideStatuses.includes(ride.status));
  const completedRevenue = [
    ...db.orders.filter((order) => order.status === "delivered").map((order) => order.total),
    ...db.rides.filter((ride) => ride.status === "completed").map((ride) => ride.fare),
  ].reduce((sum, value) => sum + value, 0);
  const openTickets = db.supportTickets.filter((ticket) => ticket.status === "open").length;
  return {
    activeOrders: activeOrders.length,
    activeRides: activeRides.length,
    onlineDrivers: db.drivers.filter((driver) => driver.online).length,
    openRestaurants: db.restaurants.filter((restaurant) => restaurant.open).length,
    completedRevenue,
    openTickets,
    avgOrderEta: activeOrders.length
      ? Math.round(activeOrders.reduce((sum, order) => sum + order.etaMin, 0) / activeOrders.length)
      : 0,
    avgRideEta: activeRides.length
      ? Math.round(activeRides.reduce((sum, ride) => sum + ride.etaMin, 0) / activeRides.length)
      : 0,
  };
}

export function ratio(part, total) {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(1));
}

export function average(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}
