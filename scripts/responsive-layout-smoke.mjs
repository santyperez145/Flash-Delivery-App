import fs from "node:fs";
import { contains, squeeze } from "./source-contract.mjs";

const mobile = fs.readFileSync("apps/mobile/App.tsx", "utf8");
const webApp = fs.readFileSync("src/App.tsx", "utf8");
const mobilePackage = JSON.parse(fs.readFileSync("apps/mobile/package.json", "utf8"));
const rootPackage = JSON.parse(fs.readFileSync("package.json", "utf8"));
const desktop = fs.readFileSync("src/styles.css", "utf8");
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
  contains(entry, 'import "./adaptive.css"') &&
    webApp.match(/window\.matchMedia\("\(min-width: 620px\)"\)/g)?.length === 2 &&
    contains(adaptive, "@media (max-width: 900px)") &&
    contains(adaptive, "@media (max-width: 620px)") &&
    contains(adaptive, ".admin-nav::-webkit-scrollbar") &&
    contains(adaptive, "prefers-reduced-motion"),
  "desktop operations provide compact navigation, single-column collapse and reduced motion",
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
