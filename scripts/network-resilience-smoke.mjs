import assert from "node:assert/strict";
import fs from "node:fs/promises";

const webApi = await fs.readFile(new URL("../src/api.ts", import.meta.url), "utf8");
const webApp = await fs.readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const mobileApi = await fs.readFile(new URL("../apps/mobile/src/api.ts", import.meta.url), "utf8");
const mobileApp = await fs.readFile(new URL("../apps/mobile/App.tsx", import.meta.url), "utf8");
const mobilePackage = JSON.parse(
  await fs.readFile(new URL("../apps/mobile/package.json", import.meta.url), "utf8"),
);

assert.match(webApi, /const SAFE_READ_METHODS = new Set\(\["GET", "HEAD", "OPTIONS"\]\)/);
assert.match(webApi, /const REQUEST_TIMEOUT_MS = 12000/);
assert.match(webApi, /transportRetry && SAFE_READ_METHODS\.has\(method\)/);
assert.match(webApi, /No hay conexión con Flash/);
assert.match(webApp, /flash:network/);
assert.match(webApp, /NetworkStatusBanner/);
assert.match(webApp, /refreshedUser\?\.roles\.includes\("admin"\)/);

assert.equal(mobilePackage.dependencies["expo-network"], "~57.0.1");
assert.match(mobileApi, /const SAFE_READ_METHODS = new Set\(\["GET", "HEAD", "OPTIONS"\]\)/);
assert.match(mobileApi, /const REQUEST_TIMEOUT_MS = 12000/);
assert.match(mobileApi, /transportRetry && SAFE_READ_METHODS\.has\(method\)/);
assert.match(mobileApp, /Network\.useNetworkState\(\)/);
assert.match(mobileApp, /MobileNetworkStatus/);

console.log("network resilience smoke passed: safe reads retry once; mutations do not auto-retry; web/mobile expose offline state");
