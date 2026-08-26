import fs from "node:fs";
import { contains, readMobileSource } from "./source-contract.mjs";
import nodeAssert from "node:assert/strict";
import { buildExternalNavigationUrl } from "../apps/mobile/src/navigation-links.ts";

// La fuente se lee por audiencia y no por archivo (ARC-001 paso 8): la mitad del
// trabajo que queda del ticket es partir `App.tsx`, y un contrato con la ruta
// fija se rompe —o se vacía— en cuanto un componente cambia de archivo.
const { source: app } = await readMobileSource();
const map = fs.readFileSync("apps/mobile/src/FlashNativeMap.native.tsx", "utf8");
const webMap = fs.readFileSync("apps/mobile/src/FlashNativeMap.web.tsx", "utf8");
const demandMap = fs.readFileSync("apps/mobile/src/DriverDemandMap.native.tsx", "utf8");
const demandWebMap = fs.readFileSync("apps/mobile/src/DriverDemandMap.web.tsx", "utf8");
const config = fs.readFileSync("apps/mobile/app.config.js", "utf8");
const manifest = JSON.parse(fs.readFileSync("apps/mobile/app.base.json", "utf8"));
const pkg = JSON.parse(fs.readFileSync("apps/mobile/package.json", "utf8"));
const customerRideTracking = app.slice(
  app.indexOf("function RideTrackingSheet"),
  app.indexOf("function ServiceChatModal"),
);
const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};

assert(
  pkg.dependencies["react-native-maps"] === "1.27.2" &&
    manifest.expo.plugins.includes("react-native-maps"),
  "Expo-compatible native map runtime and config plugin are pinned",
);
assert(
  !contains(webMap, "react-native-maps") && contains(webMap, "no simula el SDK nativo"),
  "Expo web never evaluates native map code and degrades explicitly",
);
assert(
  !contains(demandWebMap, "react-native-maps") &&
    contains(demandWebMap, "no simula el mapa nativo"),
  "driver demand web fallback never loads or simulates the native SDK",
);
assert(
  (app.match(/<FlashNativeMap\b/g) || []).length === 7,
  "customer quotes/tracking plus driver preview and cockpit share the native map",
);
assert(
  contains(map, "fitToCoordinates") &&
    contains(map, "Polyline") &&
    contains(map, "validRoute.length > 1"),
  "map supports pan, zoom, recenter and draws only a real routed polyline",
);
assert(
  contains(demandMap, "<Polygon") &&
    contains(demandMap, "fitToCoordinates") &&
    contains(demandMap, "zone.boundary.map(coordinate)"),
  "driver demand renders and fits real PostGIS polygons on the native map",
);
assert(
  contains(app, "api.getDriverDemand()") &&
    contains(app, "Actividad, no promesa") &&
    contains(app, "zone.openJobs") &&
    contains(app, "zone.eligibleDrivers"),
  "driver home consumes the private demand snapshot and labels its limits without hardcoded hotspots",
);
assert(
  contains(map, 'mapType={Platform.OS === "ios" ? "mutedStandard" : "standard"}') &&
    contains(map, 'customMapStyle={Platform.OS === "android" ? flashGoogleMapStyle : undefined}'),
  "Android and iOS use their native base-map provider with an explicit visual treatment",
);
assert(
  contains(map, "driver = null") && contains(app, "driver={driver?.location||null}"),
  "driver marker is sourced only from a persisted location",
);
assert(
  !contains(app, "buildTrackingMap") &&
    !contains(app, "tile.openstreetmap.org") &&
    !contains(app, "routeOverlay") &&
    !contains(app, "Santa Fe 1800"),
  "manual tiles, projection and fictional shipment destination were removed",
);
assert(
  contains(app, "api.route(pickupPoint,destinationPoint).catch(()=>null)") &&
    contains(app, "setShipmentRoadRoute(routed?.route||null)"),
  "shipment quote requests its real road geometry without making provider failure dishonest",
);
assert(
  contains(config, "GOOGLE_MAPS_ANDROID_API_KEY") &&
    contains(config, "androidGoogleMapsConfigured") &&
    contains(map, "Mapa Android pendiente de configuración"),
  "Android key is build-time configured and missing credentials degrade explicitly",
);
assert(
  contains(app, 'originRole="driver"') &&
    contains(app, "buildExternalNavigationUrl") &&
    contains(app, "setDriverRoute(null)"),
  "driver app maps the live GPS route and hands turn-by-turn navigation to a supported provider without retaining stale geometry",
);
assert(
  contains(app, "function DriverNavigationModal") &&
    contains(app, "setDriverView(value)") &&
    contains(app, "Abrir guía giro a giro"),
  "driver navigation lives in a segmented operational cockpit with explicit external handoff",
);
assert(
  contains(app, "driverScrollRef.current?.scrollTo") &&
    contains(app, 'driverView==="inbox"') &&
    contains(app, "api.getNotifications()"),
  "driver tabs reset their viewport and Inbox consumes private persisted notifications",
);
assert(
  !customerRideTracking.includes("navigationInstruction") &&
    !customerRideTracking.includes("nextStep"),
  "customer ride tracking keeps map and ETA but never exposes driving maneuvers",
);
assert(
  contains(app, "defaultLocationSeededForUser") &&
    contains(app, "setPickupCoords(point)") &&
    contains(app, "setShipmentPickupCoords(point)"),
  "customer ride and shipment maps seed the real geocoded default address instead of opening with an empty origin",
);
nodeAssert.equal(
  buildExternalNavigationUrl("ios", { lat: -34.6037, lng: -58.3816 }, "driving"),
  "http://maps.apple.com/?daddr=-34.6037%2C-58.3816&dirflg=d",
  "iOS driving opens the documented Apple Maps link",
);
nodeAssert.equal(
  buildExternalNavigationUrl("android", { lat: -34.6037, lng: -58.3816 }, "bicycling"),
  "https://www.google.com/maps/dir/?api=1&destination=-34.6037%2C-58.3816&travelmode=bicycling&dir_action=navigate",
  "Android/bicycle uses the documented universal Google navigation URL",
);
nodeAssert.equal(
  buildExternalNavigationUrl("ios", { lat: -34.6037, lng: -58.3816 }, "driving", "google_maps"),
  "https://www.google.com/maps/dir/?api=1&destination=-34.6037%2C-58.3816&travelmode=driving&dir_action=navigate",
  "persisted Google preference overrides the iOS system default",
);
nodeAssert.equal(
  buildExternalNavigationUrl("ios", { lat: -34.6037, lng: -58.3816 }, "driving", "apple_maps"),
  "http://maps.apple.com/?daddr=-34.6037%2C-58.3816&dirflg=d",
  "persisted Apple preference keeps the documented Apple Maps handoff",
);
nodeAssert.equal(
  buildExternalNavigationUrl("ios", { lat: 120, lng: 0 }, "driving"),
  null,
  "invalid job coordinates never open external navigation",
);
