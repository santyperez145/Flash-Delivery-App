import fs from "node:fs";
import { contains } from "./source-contract.mjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  factory = require("../apps/mobile/app.config.js"),
  eas = JSON.parse(fs.readFileSync(new URL("../apps/mobile/eas.json", import.meta.url), "utf8")),
  api = fs.readFileSync(new URL("../apps/mobile/src/api.ts", import.meta.url), "utf8"),
  app = fs.readFileSync(new URL("../apps/mobile/App.tsx", import.meta.url), "utf8");
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
  api.includes("allowsVariant(session.user)") &&
    api.includes("allowsVariant(account.account.user)"),
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
  api.includes("user.roles.includes(mobileAppVariant)"),
  "login still refuses a user without the role the installed variant needs",
);
