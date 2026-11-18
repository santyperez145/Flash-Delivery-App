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
] = await Promise.all([
  readWebSource(),
  readMobileSource(),
  fs.readFile("src/api.ts", "utf8"),
  fs.readFile("src/types.ts", "utf8"),
  fs.readFile("apps/mobile/src/api.ts", "utf8"),
  fs.readFile("apps/mobile/src/types.ts", "utf8"),
  fs.readFile("packages/domain-contracts/src/index.ts", "utf8"),
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
    // El comercio maneja su cocina y, en un retiro (GTM-002), también la entrega
    // en el mostrador: no hay conductor que la haga. Las etapas del reparto
    // (`courier_assigned`, `picked_up`, `delivering`) siguen sin ser suyas.
    containsAll(desktopMerchant, [
      '["accepted", "preparing"].includes(order.status) ||',
      '(order.fulfillment === "pickup" && order.status === "ready_for_pickup")',
    ]) &&
    !/canAdvance=\{[^}]*(courier_assigned|picked_up|delivering)/.test(desktopMerchant) &&
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

// RES-07: pausa con tiempo y motivo, como Uber Eats Orders. La base la hace valer
// (vence sola), el servidor exige motivo, y la app ofrece motivo, duración y
// reanudar, sin perder el cierre sin fecha.
const pausaMigracion = await fs.readFile("database/migrations/140_branch_timed_pause.sql", "utf8");
const pausaRuta = await fs.readFile("server/http/catalog-router.js", "utf8");
const pausaMovil = await fs.readFile("apps/mobile/src/MerchantPause.tsx", "utf8");
assert(
  containsAll(pausaMigracion, [
    "IF EXISTS(SELECT 1 FROM merchant_branches WHERE id=target_branch AND paused_until>at_time) THEN RETURN false; END IF;",
    "CHECK ((paused_until IS NULL) = (pause_reason IS NULL))",
  ]),
  "a timed pause is enforced where every open check already asks, and always carries its reason",
);
assert(
  containsAll(pausaRuta, [
    ".refine((value) => value.pauseMinutes === 0 || Boolean(value.pauseReason));",
    'return fail(res, 503, "La pausa con tiempo requiere PostgreSQL");',
  ]),
  "the pause endpoint requires a reason and refuses to fake a pause without PostgreSQL",
);
assert(
  containsAll(pausaMovil, [
    "disabled={busy || !motivo}",
    'rotulo="Reanudar ahora"',
    "Cerrar sin fecha",
    "Vuelve a recibir pedidos solo, a esa hora.",
  ]) &&
    containsAll(mobile, ["<MerchantPause", "pauseMinutes: minutes"]) &&
    // El estado mostrado se recarga apenas la pausa cambia.
    containsAll(mobile, ["pauseReason: reason, }); await loadOperations();"]),
  "the merchant app pauses with reason and duration, resumes early, and keeps the open-ended close",
);
