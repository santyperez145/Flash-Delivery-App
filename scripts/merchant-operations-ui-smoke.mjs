import fs from "node:fs/promises";
import {
  containsAll,
  containsNone,
  readMobileSource,
  readWebSource,
  section,
} from "./source-contract.mjs";

// La fuente se lee por audiencia y no por archivo (ARC-001 paso 8): la mitad del
// trabajo que queda del ticket es partir `App.tsx`, y un contrato con la ruta
// fija se rompe —o se vacía— en cuanto un componente cambia de archivo.
const [
  { source: desktop },
  { source: mobile },
  desktopApi,
  desktopTypes,
  mobileApi,
  mobileTypes,
  sharedContracts,
  styles,
  merchantConsole,
  merchantKitchen,
  merchantFinance,
  merchantOrderDetail,
  mobileMerchantScreen,
  mobileMerchantToday,
  mobileMerchantOrders,
  mobileMerchantDetail,
] = await Promise.all([
  readWebSource(),
  readMobileSource(),
  fs.readFile("src/api.ts", "utf8"),
  fs.readFile("src/types.ts", "utf8"),
  fs.readFile("apps/mobile/src/api.ts", "utf8"),
  fs.readFile("apps/mobile/src/types.ts", "utf8"),
  fs.readFile("packages/domain-contracts/src/index.ts", "utf8"),
  fs.readFile("src/styles.css", "utf8"),
  fs.readFile("src/merchant/MerchantConsole.tsx", "utf8"),
  fs.readFile("src/merchant/MerchantKitchenPanel.tsx", "utf8"),
  fs.readFile("src/merchant/MerchantFinancePanel.tsx", "utf8"),
  fs.readFile("src/merchant/MerchantOrderDetail.tsx", "utf8"),
  fs.readFile("apps/mobile/src/screens/MerchantScreen.tsx", "utf8"),
  fs.readFile("apps/mobile/src/screens/MerchantTodayPanel.tsx", "utf8"),
  fs.readFile("apps/mobile/src/screens/MerchantStoreOrders.tsx", "utf8"),
  fs.readFile("apps/mobile/src/screens/MerchantOrderDetailModal.tsx", "utf8"),
]);
const lineCount = (source) => source.trimEnd().split(/\r?\n/).length;
const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
const desktopMerchant = section(
  desktop,
  "function MerchantDesktopConsole",
  "function SuperAdminConsole",
);
const mobileMerchant = section(mobile, "function MerchantScreen", "function DriverScreen");

assert(
  containsAll(sharedContracts, ["export type MerchantOperationsMetrics"]) &&
    containsAll(desktopTypes, [
      "export type MerchantOperationsDashboard",
      "MerchantOperationsMetrics",
      'from "@flash/domain-contracts"',
    ]) &&
    containsAll(mobileTypes, [
      "export type MerchantOperationsDashboard",
      "MerchantOperationsMetrics",
      'from "@flash/domain-contracts"',
    ]),
  "desktop and Merchant App share the authoritative operations contract",
);
assert(
  containsAll(desktopApi, ["getMerchantDashboard"]) &&
    containsAll(mobileApi, ["getMerchantDashboard"]) &&
    containsAll(desktopMerchant, ["api.getMerchantDashboard"]) &&
    containsAll(mobileMerchant, ["api.getMerchantDashboard"]),
  "both merchant surfaces consume the private dashboard endpoint",
);
assert(
  containsAll(desktopApi, ["getMerchantActiveOrders"]) &&
    containsAll(mobileApi, ["getMerchantActiveOrders"]) &&
    containsAll(desktopMerchant, ["merchantActiveOrders"]) &&
    containsAll(mobileMerchant, ["setActiveOrders(queue.orders)"]),
  "desktop and Merchant App render the dedicated active queue instead of a partial activity slice",
);
assert(
  containsAll(desktopMerchant, ["30_000", "orderStatusSignature"]) &&
    containsAll(mobileMerchant, ["30_000", "orderStatusSignature"]),
  "live dashboards poll within a bounded interval and refresh on workflow changes",
);
assert(
  containsNone(desktopMerchant, ["deliveredOrders.reduce", "restaurantOrders.reduce"]) &&
    containsNone(mobileMerchant, ["restaurantOrders.reduce"]),
  "merchant KPIs never reconstruct sales from a partial client activity list",
);
assert(
  containsAll(desktopMerchant, ["grossSalesToday", "averageTicketToday"]) &&
    containsAll(mobileMerchant, ["grossSalesToday", "averageTicketToday"]),
  "daily sales and ticket values come from the local-day PostgreSQL aggregate",
);
assert(
  containsAll(desktopMerchant, ["operationsError", "operationsLoading"]) &&
    containsAll(mobileMerchant, ["operationsError", "operationsLoading"]),
  "loading and transport failures remain visible instead of becoming false zeroes",
);
assert(
  containsAll(desktopMerchant, ["Última lectura conservada"]) &&
    containsAll(mobileMerchant, ["Última lectura conservada"]),
  "a failed refresh labels retained data as stale instead of silently presenting it as live",
);
assert(
  containsAll(desktopMerchant, ["untrackedPrepOrders", "lateOrders"]) &&
    containsAll(mobileMerchant, ["untrackedPrepOrders", "lateOrders"]),
  "both surfaces expose observed SLA debt and overdue preparation",
);
assert(
  containsAll(mobileMerchant, ['["accepted", "preparing"].includes(order.status)']) &&
    containsAll(desktopMerchant, [
      'canAdvance={["accepted", "preparing"].includes(order.status)}',
    ]) &&
    containsAll(mobile, ["mobileOrderStatusLabel[order.status]"]),
  "merchant surfaces only offer owned kitchen transitions and render human workflow labels",
);
assert(
  containsAll(mobileMerchant, [
    '"today" | "orders" | "catalog" | "account"',
    "styles.merchantBottomNav",
    'accessibilityRole="tab"',
  ]),
  "Merchant App separates Today, Orders, Catalog and Account behind a fixed accessible navigation shell",
);
assert(
  containsAll(desktop, ["function MerchantOrderDetailDialog", "api.proposeOrderSubstitution"]) &&
    containsAll(mobile, ["function MerchantOrderDetailModal", "api.proposeOrderSubstitution"]),
  "desktop and Merchant App expose a real order detail with persisted substitutions",
);
assert(
  lineCount(merchantConsole) <= 280 &&
    lineCount(merchantKitchen) <= 130 &&
    lineCount(merchantFinance) <= 240 &&
    lineCount(merchantOrderDetail) <= 360 &&
    containsAll(merchantConsole, [
      "<MerchantKitchenPanel",
      "<MerchantFinancePanel",
      "<MerchantOrderDetailDialog",
      "<MerchantStoreCatalog",
      "<MerchantStoreHours",
      "<MerchantStoreAnalytics",
      "<MerchantOperationsPulse",
    ]) &&
    containsNone(merchantConsole, [
      "api.proposeOrderSubstitution",
      "api.getMerchantFinance",
      "canAdvance={",
    ]) &&
    containsAll(merchantKitchen, [
      'canAdvance={["accepted", "preparing"].includes(order.status)}',
    ]) &&
    containsAll(merchantFinance, ["api.getMerchantFinance", "api.authorizeMerchantPayout"]) &&
    containsAll(merchantOrderDetail, ["api.proposeOrderSubstitution", "api.updateBranchInventory"]),
  "desktop merchant console stays a navigation shell with ratcheted kitchen, finance and substitution modules",
);
assert(
  lineCount(mobileMerchantScreen) <= 240 &&
    lineCount(mobileMerchantToday) <= 200 &&
    lineCount(mobileMerchantOrders) <= 120 &&
    lineCount(mobileMerchantDetail) <= 450 &&
    containsAll(mobileMerchantScreen, [
      "<MerchantTodayPanel",
      "<MerchantStoreOrders",
      "<MerchantStoreMenu",
      "<MerchantStoreAccount",
      "<MerchantOrderDetailModal",
    ]) &&
    containsNone(mobileMerchantScreen, [
      "api.proposeOrderSubstitution",
      "grossSalesToday",
      '["accepted", "preparing"].includes(order.status)',
    ]) &&
    containsAll(mobileMerchantToday, ["grossSalesToday", "Última lectura conservada"]) &&
    containsAll(mobileMerchantOrders, ['["accepted", "preparing"].includes(order.status)']) &&
    containsAll(mobileMerchantDetail, [
      "api.proposeOrderSubstitution",
      "api.updateBranchInventory",
    ]),
  "Merchant App stays a navigation shell with ratcheted today, orders and substitution modules",
);
assert(
  containsAll(desktop, ["api.updateBranchInventory", "order.branchId"]) &&
    containsAll(mobile, ["api.updateBranchInventory", "order.branchId"]),
  "out-of-stock actions are scoped to the persisted order branch instead of global client state",
);
assert(
  containsAll(desktop, ["item.note", "item.extras"]) &&
    containsAll(mobile, ["item.note", "item.extras"]),
  "both order details preserve kitchen notes and configured extras",
);
assert(
  containsAll(styles, ["merchant-pulse-stages", "@media (max-width: 720px)"]),
  "desktop operations pulse has explicit narrow-layout behavior",
);
