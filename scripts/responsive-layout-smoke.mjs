import fs from "node:fs";
import { contains, readMobileSource, readWebSource, squeeze } from "./source-contract.mjs";

// La fuente se lee por audiencia y no por archivo (ARC-001 paso 8): la mitad del
// trabajo que queda del ticket es partir `App.tsx`, y un contrato con la ruta
// fija se rompe —o se vacía— en cuanto un componente cambia de archivo.
const { source: mobile } = await readMobileSource();
const customerCoordinator = fs.readFileSync("apps/mobile/src/screens/CustomerScreen.tsx", "utf8");
const customerFoodSession = fs.readFileSync("apps/mobile/src/screens/useCustomerFood.tsx", "utf8");
const customerAccount = fs.readFileSync(
  "apps/mobile/src/screens/CustomerAccountScreen.tsx",
  "utf8",
);
const customerAccountAddresses = fs.readFileSync(
  "apps/mobile/src/screens/CustomerAccountAddresses.tsx",
  "utf8",
);
const customerAccountSecurity = fs.readFileSync(
  "apps/mobile/src/screens/CustomerAccountSecurity.tsx",
  "utf8",
);
const customerAccountPayments = fs.readFileSync(
  "apps/mobile/src/screens/CustomerAccountPayments.tsx",
  "utf8",
);
const customerShipment = fs.readFileSync(
  "apps/mobile/src/screens/CustomerShipmentScreen.tsx",
  "utf8",
);
const customerRide = fs.readFileSync("apps/mobile/src/screens/CustomerRideScreen.tsx", "utf8");
const customerIssues = fs.readFileSync(
  "apps/mobile/src/screens/CustomerServiceIssueModals.tsx",
  "utf8",
);
const { source: webApp } = await readWebSource();
const webAppEntry = fs.readFileSync("src/App.tsx", "utf8");
const webCustomerCommerce = fs.readFileSync("src/customer/useCustomerCommerce.tsx", "utf8");
const webCustomerCoordinator = fs.readFileSync("src/customer/CustomerSurface.tsx", "utf8");
const webWallet = fs.readFileSync("src/customer/WalletScreen.tsx", "utf8");
const webCustomerProfile = fs.readFileSync("src/customer/CustomerProfileScreen.tsx", "utf8");
const webCustomerAddressBook = fs.readFileSync("src/customer/CustomerAddressBook.tsx", "utf8");
const webCustomerDietary = fs.readFileSync("src/customer/CustomerDietaryPreferences.tsx", "utf8");
const webCustomerShipment = fs.readFileSync("src/customer/ShipmentHome.tsx", "utf8");
const webFoodCart = fs.readFileSync("src/customer/FoodCartScreen.tsx", "utf8");
const webQuantityCounter = fs.readFileSync("src/customer/QuantityCounter.tsx", "utf8");
const webEmptyState = fs.readFileSync("src/customer/EmptyState.tsx", "utf8");
const webFoodCatalog = fs.readFileSync("src/customer/FoodCatalogComponents.tsx", "utf8");
const webFoodRestaurant = fs.readFileSync("src/customer/FoodRestaurantScreen.tsx", "utf8");
const webFoodItemSheet = fs.readFileSync("src/customer/FoodItemSheet.tsx", "utf8");
const webFoodDiscovery = fs.readFileSync("src/customer/FoodDiscoveryHome.tsx", "utf8");
const webCustomerNavigation = fs.readFileSync("src/customer/CustomerNavigation.tsx", "utf8");
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
  customerCoordinator.trimEnd().split(/\r?\n/).length <= 950 &&
    contains(customerFoodSession, "export function useCustomerFood") &&
    customerAccount.trimEnd().split(/\r?\n/).length <= 240 &&
    contains(customerCoordinator, "<CustomerAccountScreen") &&
    !contains(customerCoordinator, "Teléfono de seguridad") &&
    contains(customerAccount, "export function CustomerAccountScreen") &&
    contains(customerAccount, "if (!visible) return null") &&
    contains(customerAccount, "<CustomerAccountAddresses") &&
    contains(customerAccount, "<CustomerAccountSecurity") &&
    contains(customerAccount, "<CustomerAccountPayments") &&
    contains(customerAccountAddresses, "onUseAddress(item.address, point)") &&
    contains(customerAccountSecurity, "Teléfono de seguridad") &&
    contains(customerAccountPayments, "api.createSandboxPaymentMethod"),
  "customer account stays a shell with security, address and payment modules wired",
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
  contains(customerCoordinator, "<CustomerServiceIssueModals") &&
    !contains(customerCoordinator, "No se mueve dinero hasta que operaciones valide") &&
    contains(customerIssues, "export type CustomerServiceIssueState") &&
    contains(customerIssues, "api.requestShipmentReturn") &&
    contains(customerIssues, "api.createShipmentClaim") &&
    contains(customerIssues, "api.createOrderIssue"),
  "customer issue, return and claim dialogs stay outside the coordinator with real API wiring",
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
    contains(authStyles, "min-height: 100dvh") &&
    contains(authStyles, ".web-auth-nav") &&
    contains(authStyles, ".flash-landing-hero") &&
    contains(webApp, "Andá a cualquier lado con Flash") &&
    contains(webApp, "PublicLanding") &&
    contains(webApp, 'setSurface("login")') &&
    !contains(webApp, "Pickup location") &&
    !contains(webApp, "See prices") &&
    !contains(fs.readFileSync("src/auth/PublicLanding.tsx", "utf8"), 'type="password"'),
  "web landing follows Uber-style hierarchy without embedding login or fake quotes",
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
  webAppEntry.trimEnd().split(/\r?\n/).length <= 720 &&
    contains(webAppEntry, "useCustomerCommerce") &&
    contains(webCustomerCommerce, "export function useCustomerCommerce") &&
    contains(webCustomerCommerce, "const [rideForm") &&
    !contains(webAppEntry, "const [rideForm"),
  "web App stays a session shell; food, cart and ride state live in useCustomerCommerce",
);

assert(
  webCustomerCoordinator.trimEnd().split(/\r?\n/).length <= 375 &&
    contains(webCustomerCoordinator, "<WalletScreen") &&
    contains(webCustomerCoordinator, "<CustomerProfileScreen") &&
    !contains(webCustomerCoordinator, "function WalletScreen") &&
    !contains(webCustomerCoordinator, "function ProfileScreen") &&
    contains(webWallet, "export function WalletScreen") &&
    contains(webWallet, "parsedAmount < 1000") &&
    contains(webWallet, "parsedAmount > 200000") &&
    contains(webCustomerProfile, "export function CustomerProfileScreen") &&
    webCustomerProfile.trimEnd().split(/\r?\n/).length <= 130 &&
    contains(webCustomerProfile, "<CustomerAddressBook") &&
    contains(webCustomerProfile, "<CustomerDietaryPreferences") &&
    webCustomerAddressBook.trimEnd().split(/\r?\n/).length <= 315 &&
    contains(webCustomerAddressBook, "export type CustomerAddressPayload") &&
    contains(webCustomerAddressBook, "await api.geocode(query)") &&
    contains(webCustomerAddressBook, "onCreateAddress(payload)") &&
    contains(webCustomerAddressBook, "onUpdateAddress(editingAddressId, payload)") &&
    webCustomerDietary.trimEnd().split(/\r?\n/).length <= 165 &&
    contains(webCustomerDietary, "api.updateDietaryPreferences"),
  "web wallet, profile, addresses and dietary settings keep bounded ownership and API wiring",
);

assert(
  contains(webCustomerCoordinator, "<ShipmentHome") &&
    !contains(webCustomerCoordinator, "function ShipmentHome") &&
    webCustomerShipment.trimEnd().split(/\r?\n/).length <= 575 &&
    contains(webCustomerShipment, "api.getShipmentOptions") &&
    contains(webCustomerShipment, "api.geocode") &&
    contains(webCustomerShipment, "api.quoteShipment") &&
    contains(webCustomerShipment, "quoteToken: quote.quoteToken") &&
    contains(webCustomerShipment, "await onCreateShipment"),
  "web shipment keeps options, geocoding, signed quote and creation outside the coordinator",
);

assert(
  contains(webCustomerCoordinator, "<CartScreen") &&
    !contains(webCustomerCoordinator, "function CartScreen") &&
    !contains(webCustomerCoordinator, "function Counter") &&
    !contains(webCustomerCoordinator, "function EmptyState") &&
    webFoodCart.trimEnd().split(/\r?\n/).length <= 690 &&
    webQuantityCounter.trimEnd().split(/\r?\n/).length <= 35 &&
    webEmptyState.trimEnd().split(/\r?\n/).length <= 25,
  "web cart, checkout and their shared primitives keep bounded ownership",
);

assert(
  contains(webCustomerCoordinator, "<RestaurantDetail") &&
    !contains(webCustomerCoordinator, "function RestaurantDetail") &&
    !contains(webCustomerCoordinator, "function RestaurantCard") &&
    !contains(webCustomerCoordinator, "function ItemSheet") &&
    webFoodCatalog.trimEnd().split(/\r?\n/).length <= 155 &&
    webFoodRestaurant.trimEnd().split(/\r?\n/).length <= 95 &&
    webFoodItemSheet.trimEnd().split(/\r?\n/).length <= 110 &&
    contains(webFoodRestaurant, "itemMatchesDietary") &&
    contains(webFoodRestaurant, "<CategoryRail") &&
    contains(webFoodRestaurant, "<FoodRow") &&
    contains(webFoodItemSheet, "<QuantityCounter") &&
    contains(webApp, 'import("./customer/FoodItemSheet")'),
  "web restaurant, catalog cards and item customization keep bounded ownership",
);

assert(
  contains(webCustomerCoordinator, "<FoodDiscoveryHome") &&
    !contains(webCustomerCoordinator, "function FoodDiscoveryHome") &&
    webFoodDiscovery.trimEnd().split(/\r?\n/).length <= 130 &&
    contains(webFoodDiscovery, "featuredRestaurant?.cover") &&
    !contains(webFoodDiscovery, "images.unsplash.com") &&
    contains(webFoodDiscovery, "<RestaurantCard") &&
    contains(webFoodDiscovery, "<FoodRow") &&
    contains(webCustomerCoordinator, "api.setFavorite"),
  "web food discovery owns real catalog composition without a hardcoded hero asset",
);

assert(
  contains(webCustomerCoordinator, "<ServiceToggle") &&
    contains(webCustomerCoordinator, "<CustomerBottomNav") &&
    !contains(webCustomerCoordinator, "function ServiceToggle") &&
    !contains(webCustomerCoordinator, "function BottomNav") &&
    webCustomerNavigation.trimEnd().split(/\r?\n/).length <= 95 &&
    contains(webCustomerNavigation, "features?.shipment_beta?.active") &&
    contains(webCustomerNavigation, "features?.public_rides?.active") &&
    contains(webCustomerNavigation, 'label: "Actividad"'),
  "web service flags and stable customer navigation keep bounded ownership",
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
