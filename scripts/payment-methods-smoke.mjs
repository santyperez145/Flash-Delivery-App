import crypto from "node:crypto";
import { createPool } from "./db-client.mjs";

const base = process.env.API_URL || "http://127.0.0.1:4000/api";
const pool = createPool();
const providerToken = `pm_test_${crypto.randomBytes(12).toString("hex")}`;
let paymentMethodId = null;
const auditRequestIds = [];
const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
async function login(email) {
  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo123", deviceName: "payment-methods-smoke" }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message);
  return body.token;
}
async function request(path, token, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  return { status: response.status, body: await response.json() };
}

try {
  const stale = (
    await pool.query(
      "SELECT id::text FROM payment_methods WHERE provider='sandbox' AND last4='4242' AND provider_payment_method_id LIKE 'pm_test_%' AND created_at>now()-interval '30 minutes'",
    )
  ).rows.map((row) => row.id);
  if (stale.length) {
    await pool.query(
      "DELETE FROM audit_events WHERE entity_type='payment_method' AND entity_id=ANY($1)",
      [stale],
    );
    await pool.query("DELETE FROM payment_methods WHERE id=ANY($1::uuid[])", [stale]);
  }
  const customerToken = await login("cliente@flash.app"),
    adminToken = await login("ops@flash.app");
  const expiryYear = new Date().getUTCFullYear() + 2;
  const created = await request("/payment-methods/sandbox", customerToken, {
    method: "POST",
    body: JSON.stringify({
      providerToken,
      brand: "visa",
      last4: "4242",
      expiryMonth: 12,
      expiryYear,
      isDefault: false,
    }),
  });
  paymentMethodId = created.body.paymentMethod?.id;
  auditRequestIds.push(created.body.requestId);
  assert(
    created.status === 201 && paymentMethodId && created.body.paymentMethod.last4 === "4242",
    "customer stores a tokenized sandbox method without PAN or CVV",
  );
  const duplicate = await request("/payment-methods/sandbox", customerToken, {
    method: "POST",
    body: JSON.stringify({
      providerToken,
      brand: "visa",
      last4: "4242",
      expiryMonth: 12,
      expiryYear,
    }),
  });
  assert(duplicate.status === 409, "provider token cannot be registered twice");
  const expired = await request("/payment-methods/sandbox", customerToken, {
    method: "POST",
    body: JSON.stringify({
      providerToken: `pm_test_${crypto.randomBytes(12).toString("hex")}`,
      brand: "visa",
      last4: "1111",
      expiryMonth: 1,
      expiryYear: new Date().getUTCFullYear() - 1,
    }),
  });
  assert(expired.status === 400, "expired cards are rejected before persistence");
  const foreignDefault = await request(`/payment-methods/${paymentMethodId}/default`, adminToken, {
    method: "PATCH",
    body: "{}",
  });
  const foreignDelete = await request(`/payment-methods/${paymentMethodId}`, adminToken, {
    method: "DELETE",
  });
  assert(
    foreignDefault.status === 404 && foreignDelete.status === 404,
    "another account cannot mutate a payment method by object id",
  );
  const selected = await request(`/payment-methods/${paymentMethodId}/default`, customerToken, {
    method: "PATCH",
    body: "{}",
  });
  auditRequestIds.push(selected.body.requestId);
  assert(
    selected.status === 200 && selected.body.paymentMethod?.isDefault,
    "owner changes the default method atomically",
  );
  const state = await request("/me", customerToken);
  const serialized = JSON.stringify(state.body);
  assert(
    state.body.account?.paymentMethods?.some(
      (entry) => entry.id === paymentMethodId && entry.isDefault,
    ) && !serialized.includes(providerToken),
    "private account exposes masked metadata but never the provider token",
  );
  const removed = await request(`/payment-methods/${paymentMethodId}`, customerToken, {
    method: "DELETE",
  });
  auditRequestIds.push(removed.body.requestId);
  assert(
    removed.status === 200 &&
      !removed.body.paymentMethods.some((entry) => entry.id === paymentMethodId),
    "owner revokes the method and receives the remaining active methods",
  );
  const row = (
    await pool.query("SELECT revoked_at,is_default FROM payment_methods WHERE id=$1", [
      paymentMethodId,
    ])
  ).rows[0];
  const audit = JSON.stringify(
    (
      await pool.query("SELECT action,after_data FROM audit_events WHERE request_id=ANY($1)", [
        auditRequestIds.filter(Boolean),
      ])
    ).rows,
  );
  assert(
    row?.revoked_at &&
      !row.is_default &&
      audit.includes("payment_method.created") &&
      audit.includes("payment_method.revoked") &&
      !audit.includes(providerToken),
    "revocation and non-sensitive audit trail persist in PostgreSQL",
  );
} finally {
  if (paymentMethodId) {
    await pool.query(
      "DELETE FROM audit_events WHERE entity_type='payment_method' AND entity_id=$1",
      [paymentMethodId],
    );
    await pool.query("DELETE FROM payment_methods WHERE id=$1", [paymentMethodId]);
  }
  await pool.end();
}
