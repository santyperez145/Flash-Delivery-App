import fs from "node:fs";
import { contains } from "./source-contract.mjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  factory = require("../apps/mobile/app.config.js"),
  eas = JSON.parse(fs.readFileSync(new URL("../apps/mobile/eas.json", import.meta.url), "utf8")),
  api = [
    fs.readFileSync(new URL("../apps/mobile/src/api/http.ts", import.meta.url), "utf8"),
    fs.readFileSync(new URL("../apps/mobile/src/api/account.ts", import.meta.url), "utf8"),
  ].join("\n"),
  app = fs.readFileSync(new URL("../apps/mobile/App.tsx", import.meta.url), "utf8"),
  metro = fs.readFileSync(new URL("../apps/mobile/metro.config.js", import.meta.url), "utf8"),
  appConfig = fs.readFileSync(new URL("../apps/mobile/app.config.js", import.meta.url), "utf8");
const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
const configs = {};
for (const variant of ["customer", "driver", "merchant"]) {
  process.env.EXPO_PUBLIC_APP_VARIANT = variant;
  configs[variant] = factory();
}
delete process.env.EXPO_PUBLIC_APP_VARIANT;
process.env.GOOGLE_MAPS_ANDROID_API_KEY = "maps-smoke-restricted-key";
const mapConfigured = factory();
delete process.env.GOOGLE_MAPS_ANDROID_API_KEY;
const mapUnconfigured = factory();
assert(
  new Set(Object.values(configs).map((config) => config.android.package)).size === 3 &&
    new Set(Object.values(configs).map((config) => config.ios.bundleIdentifier)).size === 3,
  "three variants use independent Android and iOS application identities",
);
assert(
  configs.driver.android.permissions.includes("ACCESS_BACKGROUND_LOCATION") &&
    !configs.customer.android.permissions.includes("ACCESS_BACKGROUND_LOCATION") &&
    !configs.merchant.android.permissions.includes("ACCESS_BACKGROUND_LOCATION"),
  "only Flash Driver requests background location permission",
);
assert(
  configs.driver.plugins.some(
    (plugin) =>
      Array.isArray(plugin) &&
      plugin[0] === "expo-location" &&
      plugin[1].isIosBackgroundLocationEnabled,
  ) &&
    !configs.customer.plugins.some(
      (plugin) => Array.isArray(plugin) && plugin[1]?.isIosBackgroundLocationEnabled,
    ),
  "only driver build declares native background location tasks",
);
assert(
  mapConfigured.plugins.some(
    (plugin) =>
      Array.isArray(plugin) &&
      plugin[0] === "react-native-maps" &&
      plugin[1].androidGoogleMapsApiKey === "maps-smoke-restricted-key",
  ) && mapConfigured.extra.maps.androidGoogleMapsConfigured === true,
  "Android build injects the native Maps key without publishing it in Expo extra",
);
assert(
  mapUnconfigured.plugins.includes("react-native-maps") &&
    mapUnconfigured.extra.maps.androidGoogleMapsConfigured === false,
  "build without Android Maps credentials exposes an honest readiness gate",
);
for (const variant of ["customer", "driver", "merchant"])
  assert(
    eas.build[`production-${variant}`]?.env?.EXPO_PUBLIC_APP_VARIANT === variant,
    `EAS production profile pins ${variant} variant`,
  );
assert(
  contains(api, "allowsVariant(session.user)") &&
    contains(api, "allowsVariant(account.account.user)"),
  "login and restored sessions are gated by the installed app variant",
);

// El modo de la aplicación es la variante instalada, y no la prioridad de roles
// del usuario.
//
// Estaban desacopladas: `allowsVariant` gateaba el login contra la variante,
// pero `App.tsx` elegía la pantalla con `roles.includes("driver") ? ... :
// roles.includes("merchant") ? ...`, sin mirar qué app estaba instalada. Como
// `user_roles` tiene `PRIMARY KEY (user_id, role)`, un mismo usuario puede ser
// conductor y cliente —un conductor que pide comida es lo normal—, y entonces
// Flash le abría el tablero de Flash Driver.
//
// No lo pegó nadie porque los cuatro usuarios sembrados tienen un rol cada uno.
//
// Además de un error de producto, era el obstáculo para los dos criterios de
// ARC-001 que faltan: mientras el modo pueda ser cualquiera de los tres, cada
// build tiene que incluir las tres pantallas. Con el modo fijado a la variante,
// cada entrypoint necesita exactamente una.
assert(
  contains(app, "useState<Mode>(mobileAppVariant)"),
  "the mobile app opens in the mode of the installed variant",
);
assert(
  !contains(app, 'user.roles.includes("driver") ? "driver"'),
  "the screen is not chosen by role priority, which ignored the installed variant",
);
assert(
  contains(api, "user.roles.includes(mobileAppVariant)"),
  "login still refuses a user without the role the installed variant needs",
);

// La variante instalada tiene una sola fuente: `EXPO_PUBLIC_APP_VARIANT`.
//
// `api.ts` la leía de `Constants.expoConfig.extra.appVariant`, y en Expo web ese
// manifiesto no llega al runtime: caía en el fallback "customer". Como
// `allowsVariant` gatea el login contra ese valor, el build web de Flash Driver
// exigía rol `customer` —rechazando al conductor y admitiendo al cliente—
// mientras Metro sí había puesto la pantalla de conductor.
//
// Se comprobó en el navegador: antes del arreglo el build de driver mostraba
// «Entrá a Flash» con los chips de cliente; después, «Entrá a Flash Driver».
//
// Lo que se afirma es que los tres lugares que deciden la variante lean la misma
// variable. Que coincidan por casualidad es lo que ya falló una vez.
assert(
  contains(api, "process.env?.EXPO_PUBLIC_APP_VARIANT ||"),
  "the runtime reads the variant from the same variable Metro and app.config use",
);
assert(
  contains(metro, "process.env.EXPO_PUBLIC_APP_VARIANT") &&
    contains(appConfig, "process.env.EXPO_PUBLIC_APP_VARIANT"),
  "metro and app.config resolve the variant from that variable too",
);

// La audiencia que se pide al backend es la variante instalada, no la prioridad
// de roles. Es el mismo defecto que el PR #23 corrigió en `App.tsx` y que había
// quedado sin tocar acá.
assert(
  contains(api, "setActiveAudience(mobileAppVariant)") &&
    contains(api, 'let activeAudience: "customer" | "merchant" | "driver" = mobileAppVariant') &&
    !contains(api, 'roles.includes("merchant") ? "merchant"'),
  "the bootstrap audience follows the installed variant, not role priority",
);

// El marcador con el que la auditoría de navegador decide que entró no puede
// existir antes de entrar. `readyText: "Comidas"` era también un chip de la
// pantalla de login, así que las cinco afirmaciones de viewport del cliente se
// medían sobre el login y la auditoría pasaba sin autenticarse nunca.
const loginScreen = fs.readFileSync(
  new URL("../apps/mobile/src/screens/LoginScreen.tsx", import.meta.url),
  "utf8",
);
const browserSuite = fs.readFileSync(
  new URL("../scripts/responsive-browser-smoke.mjs", import.meta.url),
  "utf8",
);
for (const [, marcador] of browserSuite.matchAll(/readyText: "([^"]+)"/g)) {
  assert(
    !loginScreen.includes(`"${marcador}"`),
    `the browser audit marker ${JSON.stringify(marcador)} does not exist before logging in`,
  );
}
