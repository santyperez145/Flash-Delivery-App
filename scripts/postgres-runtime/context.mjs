import crypto from "node:crypto";
import { createPool } from "../db-client.mjs";
import { readDb } from "../../server/store.js";
import { issueGeocodeValidation } from "../../server/geocoding-validation.js";
import { config } from "../../server/config.js";

/**
 * @typedef {ReturnType<typeof createPostgresRuntimeContext>} PostgresRuntimeContext
 */

export function createPostgresRuntimeContext() {
  const ctx = {
    base: process.env.API_URL || "http://127.0.0.1:4000/api",
    pool: createPool(),
    token: "",
    customerToken: "",
    driverToken: "",
    runtimeDriverId: "",
    dispatchDriverOriginalOnline: null,
    supportTicketId: null,
    registeredUserId: null,
    registeredEmail: null,
    registeredToken: null,
    registeredRefreshToken: null,
    unvalidatedAddressId: null,
    registeredRideId: null,
    registeredRideKey: null,
    moderationDriverId: null,
    createdPromotionId: null,
    originalZoneMultiplier: null,
    ratingId: null,
    deviceId: null,
    deviceAuditRequestId: null,
    rideDestinationId: null,
    trustedContactId: null,
    feedbackAuditRequestIds: [],
    orderId: null,
    grupoPublicId: null,
    idempotencyKey: null,
    walletKey: null,
    rideId: null,
    rideKey: null,
    scheduledRideId: null,
    scheduledRideKey: null,
    shipmentId: null,
    shipmentKey: null,
    proofShipmentId: null,
    proofShipmentKey: null,
    tipKey: null,
    insufficientTipJobId: null,
    receiptId: null,
    settlementOrderId: null,
    settlementOrderKey: null,
    merchantPayoutKey: null,
    merchantPayoutId: null,
    orderIssueId: null,
    substitutionId: null,
    originalCart: [],
    webhookIds: [],
    realtimeFixtureIds: [],
    sqliteFingerprint() {
      return crypto.createHash("sha256").update(JSON.stringify(readDb())).digest("hex");
    },
    sqliteBefore: "",
    assert(condition, label) {
      if (!condition) throw new Error(`failed: ${label}`);
      console.log(`ok - ${label}`);
    },
    addressValidationToken({ userPublicId, label, lat, lng, placeId = null }) {
      return issueGeocodeValidation({
        result: { label, point: { lat, lng }, type: "street_address", placeId },
        provider: config.maps.provider,
        userPublicId,
        cache: "postgres-smoke",
      });
    },
    async request(path, init = {}) {
      const response = await fetch(`${ctx.base}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {}),
          ...(init.headers || {}),
        },
      });
      const body = await response.json();
      return { status: response.status, body };
    },
    async readSseUntil(reader, needle, timeoutMs = 4000) {
      const decoder = new TextDecoder();
      let text = "";
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const remaining = deadline - Date.now();
        const chunk = await Promise.race([
          reader.read(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`SSE timeout: ${needle}`)), remaining),
          ),
        ]);
        if (chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
        if (text.includes(needle)) return text;
      }
      throw new Error(`SSE event not received: ${needle}`);
    },
  };
  ctx.sqliteBefore = ctx.sqliteFingerprint();
  return ctx;
}
