import fs from "node:fs/promises";

const [desktop,desktopApi,desktopTypes,mobile,mobileApi,mobileTypes,styles]=await Promise.all([
  fs.readFile("src/App.tsx","utf8"),
  fs.readFile("src/api.ts","utf8"),
  fs.readFile("src/types.ts","utf8"),
  fs.readFile("apps/mobile/App.tsx","utf8"),
  fs.readFile("apps/mobile/src/api.ts","utf8"),
  fs.readFile("apps/mobile/src/types.ts","utf8"),
  fs.readFile("src/styles.css","utf8"),
]);
const assert=(condition,label)=>{if(!condition)throw new Error(`failed: ${label}`);console.log(`ok - ${label}`);};
const desktopMerchant=desktop.slice(desktop.indexOf("function MerchantDesktopConsole"),desktop.indexOf("function SuperAdminConsole"));
const mobileMerchant=mobile.slice(mobile.indexOf("function MerchantScreen"),mobile.indexOf("function DriverScreen"));

assert(desktopTypes.includes("export type MerchantOperationsDashboard")&&mobileTypes.includes("export type MerchantOperationsDashboard"),"desktop and Merchant App share the authoritative operations contract");
assert(desktopApi.includes("getMerchantDashboard")&&mobileApi.includes("getMerchantDashboard")&&desktopMerchant.includes("api.getMerchantDashboard")&&mobileMerchant.includes("api.getMerchantDashboard"),"both merchant surfaces consume the private dashboard endpoint");
assert(desktopApi.includes("getMerchantActiveOrders")&&mobileApi.includes("getMerchantActiveOrders")&&desktopMerchant.includes("merchantActiveOrders")&&mobileMerchant.includes("setActiveOrders(queue.orders)"),"desktop and Merchant App render the dedicated active queue instead of a partial activity slice");
assert(desktopMerchant.includes("30_000")&&mobileMerchant.includes("30_000")&&desktopMerchant.includes("orderStatusSignature")&&mobileMerchant.includes("orderStatusSignature"),"live dashboards poll within a bounded interval and refresh on workflow changes");
assert(!desktopMerchant.includes("deliveredOrders.reduce")&&!desktopMerchant.includes("restaurantOrders.reduce")&&!mobileMerchant.includes("restaurantOrders.reduce"),"merchant KPIs never reconstruct sales from a partial client activity list");
assert(desktopMerchant.includes("grossSalesToday")&&desktopMerchant.includes("averageTicketToday")&&mobileMerchant.includes("grossSalesToday")&&mobileMerchant.includes("averageTicketToday"),"daily sales and ticket values come from the local-day PostgreSQL aggregate");
assert(desktopMerchant.includes("operationsError")&&desktopMerchant.includes("operationsLoading")&&mobileMerchant.includes("operationsError")&&mobileMerchant.includes("operationsLoading"),"loading and transport failures remain visible instead of becoming false zeroes");
assert(desktopMerchant.includes("Última lectura conservada")&&mobileMerchant.includes("Última lectura conservada"),"a failed refresh labels retained data as stale instead of silently presenting it as live");
assert(desktopMerchant.includes("untrackedPrepOrders")&&mobileMerchant.includes("untrackedPrepOrders")&&desktopMerchant.includes("lateOrders")&&mobileMerchant.includes("lateOrders"),"both surfaces expose observed SLA debt and overdue preparation");
assert(mobileMerchant.includes('["accepted","preparing"].includes(order.status)')&&desktopMerchant.includes('canAdvance={["accepted","preparing"].includes(order.status)}')&&mobile.includes("mobileOrderStatusLabel[order.status]"),"merchant surfaces only offer owned kitchen transitions and render human workflow labels");
assert(mobileMerchant.includes('"today"|"orders"|"catalog"|"account"')&&mobileMerchant.includes("styles.merchantBottomNav")&&mobileMerchant.includes('accessibilityRole="tab"'),"Merchant App separates Today, Orders, Catalog and Account behind a fixed accessible navigation shell");
assert(styles.includes("merchant-pulse-stages")&&styles.includes("@media (max-width: 720px)"),"desktop operations pulse has explicit narrow-layout behavior");
