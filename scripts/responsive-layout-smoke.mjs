import fs from "node:fs";
import { contains, readMobileSource, readWebSource, squeeze } from "./source-contract.mjs";

// La fuente se lee por audiencia y no por archivo (ARC-001 paso 8): la mitad del
// trabajo que queda del ticket es partir `App.tsx`, y un contrato con la ruta
// fija se rompe —o se vacía— en cuanto un componente cambia de archivo.
const { source: mobile } = await readMobileSource();
const customerCoordinator = fs.readFileSync("apps/mobile/src/screens/CustomerScreen.tsx", "utf8");
const customerAccount = fs.readFileSync(
  "apps/mobile/src/screens/CustomerAccountScreen.tsx",
  "utf8",
);
const customerShipment = fs.readFileSync(
  "apps/mobile/src/screens/CustomerShipmentScreen.tsx",
  "utf8",
);
const customerRide = fs.readFileSync("apps/mobile/src/screens/CustomerRideScreen.tsx", "utf8");
const { source: webApp } = await readWebSource();
const mobilePackage = JSON.parse(fs.readFileSync("apps/mobile/package.json", "utf8"));
const rootPackage = JSON.parse(fs.readFileSync("package.json", "utf8"));
const desktop = fs.readFileSync("src/styles.css", "utf8");
const foundation = fs.readFileSync("src/styles/foundation.css", "utf8");
const authStyles = fs.readFileSync("src/styles/auth.css", "utf8");
const stateStyles = fs.readFileSync("src/styles/states.css", "utf8");
const adaptive = fs.readFileSync("src/adaptive.css", "utf8");
const entry = fs.readFileSync("src/main.tsx", "utf8");
const guidelines = fs.readFileSync("docs/ui-layout-guidelines.md", "utf8");
const agents = fs.readFileSync("AGENTS.md", "utf8");
const browserSmoke = fs.readFileSync("scripts/responsive-browser-smoke.mjs", "utf8");

function assert(condition, label) {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
}

assert(
  mobilePackage.dependencies?.["react-native-safe-area-context"] &&
    contains(mobile, "<SafeAreaProvider initialMetrics={initialWindowMetrics}>") &&
    contains(mobile, "SafeAreaView"),
  "mobile uses the Expo-compatible native safe-area provider",
);

assert(
  contains(mobile, "customerViewport: { maxWidth: 430") &&
    contains(mobile, "operationsViewport: { maxWidth: 620") &&
    contains(mobile, "appViewport"),
  "customer, driver and merchant share bounded mobile web viewports",
);

assert(
  ["issueModalSheet", "productCustomizerSheet", "trackingSheet", "signatureSheet"].every((name) =>
    // Se busca sobre la fuente comprimida y se acota al objeto con [^}]*. La
    // versión anterior limitaba la búsqueda a una línea, así que asumía que la
    // hoja de estilos estaba escrita sin saltos.
    new RegExp(`${name}:\\{[^}]*width:"100%"[^}]*maxWidth:620`).test(squeeze(mobile)),
  ),
  "shared task sheets stay bounded instead of stretching across wide windows",
);

assert(
  contains(mobile, "export function MobileTaskSheet") &&
    contains(mobile, "useSafeAreaInsets()") &&
    contains(mobile, "Math.max(insets.bottom, 18)") &&
    contains(mobile, "KeyboardAvoidingView") &&
    (mobile.match(/<MobileTaskSheet\b/g) || []).length === 4,
  "food, ride, shipment and chat sheets share safe-area and keyboard containment",
);

assert(
  contains(mobile, "export function CustomerTrackingProgress") &&
    contains(mobile, 'activeColor="#ff6a21"') &&
    contains(mobile, 'activeColor="#7c3cff"') &&
    contains(mobile, 'activeColor="#087a50"') &&
    (mobile.match(/<CustomerTrackingProgress\b/g) || []).length === 3 &&
    !contains(mobile, "trackingStageDotActive"),
  "food, ride and shipment timelines share one accessible component with vertical accents",
);

assert(
  contains(mobile, "Abrir seguimiento del pedido") &&
    contains(mobile, "Abrir seguimiento del viaje") &&
    contains(mobile, "Abrir seguimiento del envío"),
  "activity tracking cards expose named button semantics across all three verticals",
);

assert(
  ["foodBottomNav", "merchantBottomNav", "driverBottomNav"].every((name) =>
    contains(mobile, `${name}:`),
  ) &&
    ["merchantBottomItem", "driverBottomItem", "foodBottomItem"].every((name) =>
      contains(mobile, `${name}:`),
    ),
  "every mobile audience retains a dedicated bottom navigation contract",
);

assert(
  contains(mobile, "onLogout={logout}") &&
    contains(mobile, 'accessibilityLabel="Cerrar sesión"') &&
    contains(mobile, "customerAccountHeading"),
  "the customer account keeps an accessible session exit in its adaptive header",
);

assert(
  customerCoordinator.trimEnd().split(/\r?\n/).length <= 3165 &&
    contains(customerCoordinator, "<CustomerAccountScreen") &&
    !contains(customerCoordinator, "Teléfono de seguridad") &&
    contains(customerAccount, "export function CustomerAccountScreen") &&
    contains(customerAccount, "if (!visible) return null") &&
    contains(customerAccount, "onUseAddress(item.address, point)"),
  "customer account stays outside the shrinking coordinator and keeps address selection wired",
);

assert(
  contains(customerCoordinator, "<CustomerShipmentScreen") &&
    !contains(customerCoordinator, "Mandá algo hoy") &&
    contains(customerShipment, "export function CustomerShipmentScreen") &&
    contains(customerShipment, "if (!visible) return null") &&
    contains(customerShipment, "api.quoteShipment") &&
    contains(customerShipment, "api.createShipment") &&
    contains(customerShipment, "setShipmentPickup(selectedAddress.address)"),
  "shipment quote and request stay outside the coordinator with shared address wiring",
);

assert(
  contains(customerCoordinator, "<CustomerRideScreen") &&
    !contains(customerCoordinator, "¿A dónde vamos?") &&
    contains(customerRide, "export function CustomerRideScreen") &&
    contains(customerRide, "if (!visible) return null") &&
    contains(customerRide, "api.quoteRideOptions") &&
    contains(customerRide, "api.createRide") &&
    contains(customerRide, "setPickup(selectedAddress.address)") &&
    contains(customerRide, "invalidateQuote()"),
  "ride quote and request stay outside the coordinator and invalidate stale prices",
);

assert(
  contains(mobile, 'merchantDetailFacts:{flexDirection:"row",flexWrap:"wrap"') &&
    contains(mobile, 'paymentCompactFields:{flexDirection:"row",flexWrap:"wrap"') &&
    contains(mobile, 'driverPeriodGrid: { flexDirection: "row", flexWrap: "wrap"'),
  "dense mobile facts, forms and finance cards wrap on compact widths",
);

assert(
  contains(desktop, "--layout-safe-bottom") &&
    contains(desktop, "min-height: 100dvh") &&
    !contains(desktop, "100vh"),
  "web surfaces use dynamic viewport and shared safe-area tokens",
);

assert(
  contains(entry, 'import "./styles/foundation.css"') &&
    contains(entry, 'import "./styles/auth.css"') &&
    contains(entry, 'import "./styles/states.css"') &&
    contains(entry, 'import "./adaptive.css"') &&
    webApp.match(/window\.matchMedia\("\(min-width: 620px\)"\)/g)?.length === 2 &&
    contains(adaptive, "@media (max-width: 900px)") &&
    contains(adaptive, "@media (max-width: 620px)") &&
    contains(adaptive, ".admin-nav::-webkit-scrollbar") &&
    contains(adaptive, "prefers-reduced-motion"),
  "desktop operations provide compact navigation, single-column collapse and reduced motion",
);

assert(
  contains(foundation, "--brand: #7c3cff") &&
    contains(foundation, "--food: #ff6a21") &&
    contains(foundation, "--ride: #6d35e0") &&
    contains(foundation, "--shipment: #087a50") &&
    contains(foundation, "min-height: var(--layout-touch)") &&
    contains(authStyles, "grid-template-columns: minmax(420px, 1.08fr)") &&
    contains(authStyles, "@media (max-width: 900px)") &&
    contains(authStyles, "min-height: 100dvh"),
  "web auth and shared surfaces consume the Flash visual system across breakpoints",
);

assert(
  contains(webApp, "SystemStateScreen") &&
    contains(webApp, "DesktopAccessGate") &&
    contains(stateStyles, ".system-state-shell") &&
    contains(stateStyles, ".role-gate-shell") &&
    contains(stateStyles, "min-height: 100dvh") &&
    contains(stateStyles, "var(--layout-safe-bottom)"),
  "loading, error and role boundaries share an adaptive honest-state composition",
);

assert(
  contains(guidelines, "Compact | 320–619 px") &&
    contains(guidelines, "Customer") &&
    contains(guidelines, "Driver") &&
    contains(guidelines, "Merchant") &&
    contains(guidelines, "Operaciones") &&
    contains(agents, "docs/ui-layout-guidelines.md"),
  "the responsive contract is documented and mandatory for future deliveries",
);

assert(
  rootPackage.scripts?.["test:responsive-browser"] ===
    "node scripts/responsive-browser-smoke.mjs" &&
    ["320, height: 568", "390, height: 844", "768, height: 1024", "1440, height: 900"].every(
      (viewport) => contains(browserSmoke, viewport),
    ) &&
    contains(browserSmoke, "assertNoPageOverflow"),
  "a real Chromium matrix guards compact, medium and wide compositions",
);
