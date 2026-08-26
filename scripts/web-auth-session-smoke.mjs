import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createAuthRefreshCoordinator } from "../src/auth-refresh-coordinator.ts";

let token = "expired";
let refreshCalls = 0;
let releaseRefresh;
const pendingRefresh = new Promise((resolve) => {
  releaseRefresh = resolve;
});
const coordinator = createAuthRefreshCoordinator(
  async () => {
    refreshCalls += 1;
    await pendingRefresh;
    token = "rotated";
    return true;
  },
  () => token,
);

const concurrent = Array.from({ length: 12 }, () => coordinator.recoverUnauthorized("expired"));
assert.equal(refreshCalls, 1, "concurrent 401 responses share exactly one refresh request");
releaseRefresh();
assert.deepEqual(await Promise.all(concurrent), Array(12).fill(true));
assert.equal(refreshCalls, 1, "all waiting requests reuse the single rotated session");
assert.equal(await coordinator.recoverUnauthorized("expired"), true);
assert.equal(refreshCalls, 1, "a late 401 from the old access token does not rotate again");

let retryCalls = 0;
const retryable = createAuthRefreshCoordinator(
  async () => {
    retryCalls += 1;
    return retryCalls > 1;
  },
  () => "same-token",
);
assert.equal(await retryable.refresh(), false);
assert.equal(await retryable.refresh(), true);
assert.equal(retryCalls, 2, "a completed failed attempt does not permanently lock the coordinator");

const app = await fs.readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
assert.match(app, /if \(loading \|\| authRequired \|\| !sessionUserId\) return;/);
assert.equal(
  (app.match(/if \(loading \|\| authRequired \|\| !sessionUserId\) return;/g) || []).length,
  2,
  "polling and realtime are both gated by authenticated UI state",
);
assert.match(app, /flash:auth-required/);
assert.match(app, /if \(initialBootstrapStarted\.current\) return;/);

console.log(
  "web auth session smoke passed: refresh is single-flight, stale 401s reuse it, and anonymous polling is disabled",
);
