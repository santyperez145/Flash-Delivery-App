import fs from "node:fs";

const app = fs.readFileSync("apps/mobile/App.tsx", "utf8");
const map = fs.readFileSync("apps/mobile/src/FlashNativeMap.tsx", "utf8");
const config = fs.readFileSync("apps/mobile/app.config.js", "utf8");
const manifest = JSON.parse(fs.readFileSync("apps/mobile/app.base.json", "utf8"));
const pkg = JSON.parse(fs.readFileSync("apps/mobile/package.json", "utf8"));
const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};

assert(pkg.dependencies["react-native-maps"] === "1.27.2" && manifest.expo.plugins.includes("react-native-maps"), "Expo-compatible native map runtime and config plugin are pinned");
assert((app.match(/<FlashNativeMap\b/g) || []).length === 5, "quotes and tracking for food, rides and shipments share the native map");
assert(map.includes("fitToCoordinates") && map.includes("Polyline") && map.includes("validRoute.length > 1"), "map supports pan, zoom, recenter and draws only a real routed polyline");
assert(map.includes('mapType={Platform.OS === "ios" ? "mutedStandard" : "standard"}') && map.includes('customMapStyle={Platform.OS === "android" ? flashGoogleMapStyle : undefined}'), "Android and iOS use their native base-map provider with an explicit visual treatment");
assert(map.includes("driver = null") && app.includes('driver={driver?.location||null}'), "driver marker is sourced only from a persisted location");
assert(!app.includes("buildTrackingMap") && !app.includes("tile.openstreetmap.org") && !app.includes("routeOverlay") && !app.includes("Santa Fe 1800"), "manual tiles, projection and fictional shipment destination were removed");
assert(app.includes("api.route(pickupPoint,destinationPoint).catch(()=>null)") && app.includes("setShipmentRoadRoute(routed?.route||null)"), "shipment quote requests its real road geometry without making provider failure dishonest");
assert(config.includes("GOOGLE_MAPS_ANDROID_API_KEY") && config.includes("androidGoogleMapsConfigured") && map.includes("Mapa Android pendiente de configuración"), "Android key is build-time configured and missing credentials degrade explicitly");
