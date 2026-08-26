import fs from "node:fs/promises";
import { containsAll, containsNone, section } from "./source-contract.mjs";

const [desktop, desktopApi, desktopTypes, mobile, mobileApi, mobileTypes, styles] =
  await Promise.all([
    fs.readFile("src/App.tsx", "utf8"),
    fs.readFile("src/api.ts", "utf8"),
    fs.readFile("src/types.ts", "utf8"),
    fs.readFile("apps/mobile/App.tsx", "utf8"),
    fs.readFile("apps/mobile/src/api.ts", "utf8"),
    fs.readFile("apps/mobile/src/types.ts", "utf8"),
    fs.readFile("src/styles.css", "utf8"),
  ]);
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
  containsAll(desktopTypes, ["export type MerchantOperationsDashboard"]) &&
    containsAll(mobileTypes, ["export type MerchantOperationsDashboard"]),
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
