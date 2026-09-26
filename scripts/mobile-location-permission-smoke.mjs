import fs from "node:fs";
import { createRequire } from "node:module";

import { contains, containsAll, containsNone } from "./source-contract.mjs";

const require = createRequire(import.meta.url),
  factory = require("../apps/mobile/app.config.js"),
  base = fs.readFileSync(new URL("../apps/mobile/app.base.json", import.meta.url), "utf8"),
  appConfig = fs.readFileSync(new URL("../apps/mobile/app.config.js", import.meta.url), "utf8"),
  helper = fs.readFileSync(
    new URL("../apps/mobile/src/locationPermission.ts", import.meta.url),
    "utf8",
  ),
  driverShift = fs.readFileSync(
    new URL("../apps/mobile/src/screens/useDriverShift.tsx", import.meta.url),
    "utf8",
  ),
  customerRide = fs.readFileSync(
    new URL("../apps/mobile/src/screens/CustomerRideScreen.tsx", import.meta.url),
    "utf8",
  ),
  customerScreen = fs.readFileSync(
    new URL("../apps/mobile/src/screens/CustomerScreen.tsx", import.meta.url),
    "utf8",
  ),
  backgroundLocation = fs.readFileSync(
    new URL("../apps/mobile/src/background-location.ts", import.meta.url),
    "utf8",
  );

const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};

assert(
  contains(helper, "export async function explainAndRequestForegroundLocation"),
  "shared location permission helper exists",
);
assert(
  containsAll(helper, [
    "getForegroundPermissionsAsync",
    "Alert.alert",
    "requestForegroundPermissionsAsync",
  ]),
  "helper checks grant, explains in-app, then asks the OS",
);
assert(
  contains(helper, "audience: LocationAudience") || contains(helper, 'audience:"driver"'),
  "helper accepts driver and customer audiences",
);

for (const [source, label] of [
  [driverShift, "driver shift"],
  [customerRide, "customer ride"],
  [customerScreen, "customer screen"],
  [backgroundLocation, "driver background location"],
]) {
  assert(
    contains(source, "explainAndRequestForegroundLocation"),
    `${label} uses in-app location rationale helper`,
  );
  assert(
    containsNone(source, ["Location.requestForegroundPermissionsAsync()"]),
    `${label} does not call OS foreground permission directly`,
  );
}

assert(
  contains(base, "NSLocationWhenInUseUsageDescription") &&
    contains(base, "NSLocationAlwaysAndWhenInUseUsageDescription"),
  "app.base.json declares iOS location usage strings",
);
assert(
  contains(appConfig, "locationWhenInUsePermission") &&
    contains(appConfig, "locationAlwaysAndWhenInUsePermission"),
  "app.config.js declares variant-aware expo-location permission copy",
);

const configs = {};
for (const variant of ["customer", "driver"]) {
  process.env.EXPO_PUBLIC_APP_VARIANT = variant;
  configs[variant] = factory();
}
delete process.env.EXPO_PUBLIC_APP_VARIANT;

for (const variant of ["customer", "driver"]) {
  assert(
    contains(JSON.stringify(configs[variant].ios.infoPlist), "NSLocationWhenInUseUsageDescription"),
    `${variant} variant exposes iOS when-in-use usage string`,
  );
  assert(
    configs[variant].android.permissions.includes("ACCESS_FINE_LOCATION") &&
      configs[variant].android.permissions.includes("ACCESS_COARSE_LOCATION"),
    `${variant} variant declares Android location permissions`,
  );
}

console.log("mobile location permission smoke passed");
