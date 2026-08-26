import crypto from "node:crypto";
import { verifyMercadoPagoWebhook } from "../server/mercadopago-webhook.js";
const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
const secret = "test-webhook-secret-at-least-32-characters",
  now = Date.now(),
  ts = String(now),
  dataId = "ABC123",
  requestId = "provider-request-123",
  manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`,
  signature = crypto.createHmac("sha256", secret).update(manifest).digest("hex"),
  header = `ts=${ts},v1=${signature}`;
assert(
  verifyMercadoPagoWebhook({ xSignature: header, xRequestId: requestId, dataId, secret, now }),
  "official Mercado Pago manifest validates with constant-time HMAC",
);
assert(
  !verifyMercadoPagoWebhook({
    xSignature: header,
    xRequestId: `${requestId}-tampered`,
    dataId,
    secret,
    now,
  }),
  "request-id tampering invalidates signature",
);
assert(
  !verifyMercadoPagoWebhook({
    xSignature: header,
    xRequestId: requestId,
    dataId: "OTHER",
    secret,
    now,
  }),
  "resource tampering invalidates signature",
);
assert(
  !verifyMercadoPagoWebhook({
    xSignature: header,
    xRequestId: requestId,
    dataId,
    secret,
    now: now + 11 * 60 * 1000,
  }),
  "stale signed notification is rejected outside replay window",
);
assert(
  !verifyMercadoPagoWebhook({
    xSignature: "ts=bad,v1=short",
    xRequestId: requestId,
    dataId,
    secret,
    now,
  }),
  "malformed signature fails closed without throwing",
);
