import fs from "node:fs";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url),factory=require("../apps/mobile/app.config.js"),eas=JSON.parse(fs.readFileSync(new URL("../apps/mobile/eas.json",import.meta.url),"utf8")),api=fs.readFileSync(new URL("../apps/mobile/src/api.ts",import.meta.url),"utf8");
const assert=(condition,label)=>{if(!condition)throw new Error(`failed: ${label}`);console.log(`ok - ${label}`);};
const configs={};for(const variant of["customer","driver","merchant"]){process.env.EXPO_PUBLIC_APP_VARIANT=variant;configs[variant]=factory();}
delete process.env.EXPO_PUBLIC_APP_VARIANT;
process.env.GOOGLE_MAPS_ANDROID_API_KEY="maps-smoke-restricted-key";const mapConfigured=factory();delete process.env.GOOGLE_MAPS_ANDROID_API_KEY;const mapUnconfigured=factory();
assert(new Set(Object.values(configs).map(config=>config.android.package)).size===3&&new Set(Object.values(configs).map(config=>config.ios.bundleIdentifier)).size===3,"three variants use independent Android and iOS application identities");
assert(configs.driver.android.permissions.includes("ACCESS_BACKGROUND_LOCATION")&&!configs.customer.android.permissions.includes("ACCESS_BACKGROUND_LOCATION")&&!configs.merchant.android.permissions.includes("ACCESS_BACKGROUND_LOCATION"),"only Flash Driver requests background location permission");
assert(configs.driver.plugins.some(plugin=>Array.isArray(plugin)&&plugin[0]==="expo-location"&&plugin[1].isIosBackgroundLocationEnabled)&&!configs.customer.plugins.some(plugin=>Array.isArray(plugin)&&plugin[1]?.isIosBackgroundLocationEnabled),"only driver build declares native background location tasks");
assert(mapConfigured.plugins.some(plugin=>Array.isArray(plugin)&&plugin[0]==="react-native-maps"&&plugin[1].androidGoogleMapsApiKey==="maps-smoke-restricted-key")&&mapConfigured.extra.maps.androidGoogleMapsConfigured===true,"Android build injects the native Maps key without publishing it in Expo extra");
assert(mapUnconfigured.plugins.includes("react-native-maps")&&mapUnconfigured.extra.maps.androidGoogleMapsConfigured===false,"build without Android Maps credentials exposes an honest readiness gate");
for(const variant of["customer","driver","merchant"])assert(eas.build[`production-${variant}`]?.env?.EXPO_PUBLIC_APP_VARIANT===variant,`EAS production profile pins ${variant} variant`);
assert(api.includes("allowsVariant(session.user)")&&api.includes("allowsVariant(account.account.user)"),"login and restored sessions are gated by the installed app variant");
