import fs from "node:fs";
import nodeAssert from "node:assert/strict";
import { buildExternalNavigationUrl } from "../apps/mobile/src/navigation-links.ts";

const app = fs.readFileSync("apps/mobile/App.tsx", "utf8");
const map = fs.readFileSync("apps/mobile/src/FlashNativeMap.native.tsx", "utf8");
const webMap = fs.readFileSync("apps/mobile/src/FlashNativeMap.web.tsx", "utf8");
const config = fs.readFileSync("apps/mobile/app.config.js", "utf8");
const manifest = JSON.parse(fs.readFileSync("apps/mobile/app.base.json", "utf8"));
const pkg = JSON.parse(fs.readFileSync("apps/mobile/package.json", "utf8"));
const customerRideTracking = app.slice(app.indexOf("function RideTrackingSheet"), app.indexOf("function ServiceChatModal"));
const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};

assert(pkg.dependencies["react-native-maps"] === "1.27.2" && manifest.expo.plugins.includes("react-native-maps"), "Expo-compatible native map runtime and config plugin are pinned");
assert(!webMap.includes("react-native-maps") && webMap.includes("no simula el SDK nativo"), "Expo web never evaluates native map code and degrades explicitly");
assert((app.match(/<FlashNativeMap\b/g) || []).length === 7, "customer quotes/tracking plus driver preview and cockpit share the native map");
assert(map.includes("fitToCoordinates") && map.includes("Polyline") && map.includes("validRoute.length > 1"), "map supports pan, zoom, recenter and draws only a real routed polyline");
assert(map.includes('mapType={Platform.OS === "ios" ? "mutedStandard" : "standard"}') && map.includes('customMapStyle={Platform.OS === "android" ? flashGoogleMapStyle : undefined}'), "Android and iOS use their native base-map provider with an explicit visual treatment");
assert(map.includes("driver = null") && app.includes('driver={driver?.location||null}'), "driver marker is sourced only from a persisted location");
assert(!app.includes("buildTrackingMap") && !app.includes("tile.openstreetmap.org") && !app.includes("routeOverlay") && !app.includes("Santa Fe 1800"), "manual tiles, projection and fictional shipment destination were removed");
assert(app.includes("api.route(pickupPoint,destinationPoint).catch(()=>null)") && app.includes("setShipmentRoadRoute(routed?.route||null)"), "shipment quote requests its real road geometry without making provider failure dishonest");
assert(config.includes("GOOGLE_MAPS_ANDROID_API_KEY") && config.includes("androidGoogleMapsConfigured") && map.includes("Mapa Android pendiente de configuración"), "Android key is build-time configured and missing credentials degrade explicitly");
assert(app.includes('originRole="driver"') && app.includes("buildExternalNavigationUrl") && app.includes("setDriverRoute(null)"), "driver app maps the live GPS route and hands turn-by-turn navigation to a supported provider without retaining stale geometry");
assert(app.includes("function DriverNavigationModal") && app.includes('setDriverView(value)') && app.includes('Abrir guía giro a giro'), "driver navigation lives in a segmented operational cockpit with explicit external handoff");
assert(app.includes("driverScrollRef.current?.scrollTo") && app.includes('driverView==="inbox"') && app.includes("api.getNotifications()"), "driver tabs reset their viewport and Inbox consumes private persisted notifications");
assert(!customerRideTracking.includes("navigationInstruction") && !customerRideTracking.includes("nextStep"), "customer ride tracking keeps map and ETA but never exposes driving maneuvers");
assert(app.includes("defaultLocationSeededForUser") && app.includes("setPickupCoords(point)") && app.includes("setShipmentPickupCoords(point)"), "customer ride and shipment maps seed the real geocoded default address instead of opening with an empty origin");
nodeAssert.equal(buildExternalNavigationUrl("ios",{lat:-34.6037,lng:-58.3816},"driving"),"http://maps.apple.com/?daddr=-34.6037%2C-58.3816&dirflg=d","iOS driving opens the documented Apple Maps link");
nodeAssert.equal(buildExternalNavigationUrl("android",{lat:-34.6037,lng:-58.3816},"bicycling"),"https://www.google.com/maps/dir/?api=1&destination=-34.6037%2C-58.3816&travelmode=bicycling&dir_action=navigate","Android/bicycle uses the documented universal Google navigation URL");
nodeAssert.equal(buildExternalNavigationUrl("ios",{lat:-34.6037,lng:-58.3816},"driving","google_maps"),"https://www.google.com/maps/dir/?api=1&destination=-34.6037%2C-58.3816&travelmode=driving&dir_action=navigate","persisted Google preference overrides the iOS system default");
nodeAssert.equal(buildExternalNavigationUrl("ios",{lat:-34.6037,lng:-58.3816},"driving","apple_maps"),"http://maps.apple.com/?daddr=-34.6037%2C-58.3816&dirflg=d","persisted Apple preference keeps the documented Apple Maps handoff");
nodeAssert.equal(buildExternalNavigationUrl("ios",{lat:120,lng:0},"driving"),null,"invalid job coordinates never open external navigation");
