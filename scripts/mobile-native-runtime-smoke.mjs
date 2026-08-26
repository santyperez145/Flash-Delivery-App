import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve("apps/mobile"),
  require = createRequire(import.meta.url),
  factory = require(path.join(root, "app.config.js"));
process.env.EXPO_PUBLIC_APP_VARIANT = "driver";
const app = factory();
process.env.EXPO_PUBLIC_APP_VARIANT = "customer";
const customerApp = factory();
delete process.env.EXPO_PUBLIC_APP_VARIANT;
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")),
  api = fs.readFileSync(path.join(root, "src/api.ts"), "utf8"),
  session = fs.readFileSync(path.join(root, "src/session-storage.ts"), "utf8"),
  background = fs.readFileSync(path.join(root, "src/background-location.ts"), "utf8");
const assert = (value, label) => {
  if (!value) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
const locationPlugin =
  app.plugins.find((entry) => Array.isArray(entry) && entry[0] === "expo-location")?.[1] || {};
assert(
  pkg.dependencies["expo-task-manager"] && pkg.dependencies["expo-secure-store"],
  "native runtime declares SDK-compatible background and secure-storage modules",
);
assert(
  locationPlugin.isIosBackgroundLocationEnabled === true &&
    locationPlugin.isAndroidBackgroundLocationEnabled === true &&
    locationPlugin.isAndroidForegroundServiceEnabled === true,
  "Expo config enables native background modes on iOS and Android",
);
assert(
  app.android.permissions.includes("ACCESS_BACKGROUND_LOCATION") &&
    app.android.permissions.includes("FOREGROUND_SERVICE_LOCATION") &&
    app.ios.infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription,
  "platform manifests explain and request persistent location explicitly",
);
assert(
  !customerApp.android.permissions.includes("ACCESS_BACKGROUND_LOCATION") &&
    !customerApp.ios.infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription,
  "customer build excludes driver-only background location privilege",
);
assert(
  background.includes("TaskManager.defineTask(TASK_NAME") &&
    background.indexOf("TaskManager.defineTask(TASK_NAME") <
      background.indexOf("export async function startDriverBackgroundLocation"),
  "location task is defined in module scope before registration",
);
assert(
  background.includes("Flash Driver Background") &&
    background.includes("/auth/refresh") &&
    background.includes('source:"background"') &&
    background.includes("stopLocationUpdatesAsync"),
  "background task rotates sessions, attributes fixes and supports explicit shutdown",
);
assert(
  session.includes("WHEN_UNLOCKED_THIS_DEVICE_ONLY") &&
    session.includes('Platform.OS==="web"') &&
    api.includes("loadMobileSession") &&
    !api.includes("AsyncStorage"),
  "native refresh credentials use device-only Keychain/Keystore with isolated web fallback",
);
