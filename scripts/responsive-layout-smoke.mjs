import fs from "node:fs";

const mobile = fs.readFileSync("apps/mobile/App.tsx", "utf8");
const mobilePackage = JSON.parse(
  fs.readFileSync("apps/mobile/package.json", "utf8"),
);
const desktop = fs.readFileSync("src/styles.css", "utf8");
const adaptive = fs.readFileSync("src/adaptive.css", "utf8");
const entry = fs.readFileSync("src/main.tsx", "utf8");
const guidelines = fs.readFileSync("docs/ui-layout-guidelines.md", "utf8");
const agents = fs.readFileSync("AGENTS.md", "utf8");

function assert(condition, label) {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
}

assert(
  mobilePackage.dependencies?.["react-native-safe-area-context"] &&
    mobile.includes("<SafeAreaProvider initialMetrics={initialWindowMetrics}>") &&
    mobile.includes("SafeAreaView"),
  "mobile uses the Expo-compatible native safe-area provider",
);

assert(
  mobile.includes("customerViewport: { maxWidth: 430") &&
    mobile.includes("operationsViewport: { maxWidth: 620") &&
    mobile.includes("appViewport"),
  "customer, driver and merchant share bounded mobile web viewports",
);

assert(
  ["issueModalSheet", "productCustomizerSheet", "trackingSheet", "signatureSheet"].every(
    (name) =>
      new RegExp(`${name}:\\{[^\\n]*width:\"100%\"[^\\n]*maxWidth:620`).test(
        mobile,
      ),
  ),
  "shared task sheets stay bounded instead of stretching across wide windows",
);

assert(
  ["foodBottomNav", "merchantBottomNav", "driverBottomNav"].every((name) =>
    mobile.includes(`${name}:`),
  ) &&
    ["merchantBottomItem", "driverBottomItem", "foodBottomItem"].every(
      (name) => mobile.includes(`${name}:`),
    ),
  "every mobile audience retains a dedicated bottom navigation contract",
);

assert(
  mobile.includes("onLogout={logout}") &&
    mobile.includes('accessibilityLabel="Cerrar sesión"') &&
    mobile.includes("customerAccountHeading"),
  "the customer account keeps an accessible session exit in its adaptive header",
);

assert(
  mobile.includes('merchantDetailFacts:{flexDirection:"row",flexWrap:"wrap"') &&
    mobile.includes('paymentCompactFields:{flexDirection:"row",flexWrap:"wrap"') &&
    mobile.includes('driverPeriodGrid: { flexDirection: "row", flexWrap: "wrap"'),
  "dense mobile facts, forms and finance cards wrap on compact widths",
);

assert(
  desktop.includes("--layout-safe-bottom") &&
    desktop.includes("min-height: 100dvh") &&
    !desktop.includes("100vh"),
  "web surfaces use dynamic viewport and shared safe-area tokens",
);

assert(
  entry.includes('import "./adaptive.css"') &&
    adaptive.includes("@media (max-width: 900px)") &&
    adaptive.includes("@media (max-width: 620px)") &&
    adaptive.includes(".admin-nav::-webkit-scrollbar") &&
    adaptive.includes("prefers-reduced-motion"),
  "desktop operations provide compact navigation, single-column collapse and reduced motion",
);

assert(
  guidelines.includes("Compact | 320–619 px") &&
    guidelines.includes("Customer") &&
    guidelines.includes("Driver") &&
    guidelines.includes("Merchant") &&
    guidelines.includes("Operaciones") &&
    agents.includes("docs/ui-layout-guidelines.md"),
  "the responsive contract is documented and mandatory for future deliveries",
);
