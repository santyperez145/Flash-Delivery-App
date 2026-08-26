import crypto from "node:crypto";
import { createPool } from "./db-client.mjs";
const base = process.env.API_URL || "http://127.0.0.1:4000/api",
  pool = createPool(),
  documents = [];
let driverId = null,
  internalDriverId = null,
  originalCompliance = null,
  originalOnline = false;
const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
async function login(email) {
  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo123", deviceName: "driver-kyc-smoke" }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message);
  return body;
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
  const driverSession = await login("conductor@flash.app"),
    adminSession = await login("ops@flash.app"),
    customerSession = await login("cliente@flash.app");
  driverId = driverSession.user.driverId;
  const driverRow = (
    await pool.query("SELECT id,online FROM drivers WHERE public_id=$1", [driverId])
  ).rows[0];
  internalDriverId = driverRow.id;
  originalOnline = driverRow.online;
  originalCompliance = (
    await pool.query("SELECT * FROM driver_compliance WHERE driver_id=$1", [internalDriverId])
  ).rows[0];
  const foreign = await request(`/drivers/${driverId}/compliance`, customerSession.token);
  assert(foreign.status === 403, "customer role cannot inspect a driver compliance file");
  const types = [
    "identity",
    "driver_license",
    "vehicle_registration",
    "insurance",
    "background_check",
  ];
  for (const type of types) {
    const plaintext = Buffer.from(`fixture-${type}-${crypto.randomUUID()}`),
      input = {
        type,
        mimeType: "application/pdf",
        contentBase64: plaintext.toString("base64"),
        expiresAt: ["driver_license", "vehicle_registration", "insurance"].includes(type)
          ? "2099-12-31"
          : null,
      };
    const submitted = await request(`/drivers/${driverId}/documents`, driverSession.token, {
      method: "POST",
      body: JSON.stringify(input),
    });
    const id = submitted.body.document?.id;
    documents.push(id);
    assert(
      submitted.status === 201 &&
        id &&
        submitted.body.document.sha256 ===
          crypto.createHash("sha256").update(plaintext).digest("hex"),
      `${type} upload persists hash and metadata`,
    );
    const stored = (
      await pool.query("SELECT content_ciphertext FROM driver_documents WHERE public_id=$1", [id])
    ).rows[0].content_ciphertext;
    assert(
      !stored.includes(plaintext.toString("base64")) && !stored.includes(plaintext.toString()),
      `${type} content is encrypted at rest`,
    );
    const ownerView = await request(`/driver-documents/${id}/content`, driverSession.token);
    assert(
      ownerView.status === 200 && ownerView.body.contentBase64 === plaintext.toString("base64"),
      `${type} decrypts only through an authorized endpoint`,
    );
    const driverReview = await request(
      `/admin/driver-documents/${id}/review`,
      driverSession.token,
      { method: "PATCH", body: JSON.stringify({ status: "approved" }) },
    );
    assert(driverReview.status === 403, "driver cannot self-approve KYC");
    const reviewed = await request(`/admin/driver-documents/${id}/review`, adminSession.token, {
      method: "PATCH",
      body: JSON.stringify({ status: "approved" }),
    });
    assert(reviewed.status === 200, `${type} accepts one manual operations review`);
  }
  const compliance = await request(`/drivers/${driverId}/compliance`, driverSession.token);
  assert(
    compliance.body.compliance.status === "approved" &&
      types.every((type) =>
        compliance.body.compliance.documents.some(
          (doc) => doc.type === type && doc.status === "approved",
        ),
      ),
    "all current required documents produce approved compliance",
  );
  const online = await request(`/drivers/${driverId}/availability`, driverSession.token, {
    method: "PATCH",
    body: JSON.stringify({ online: true }),
  });
  assert(online.status === 200 && online.body.driver.online, "approved driver can go online");
  await pool.query("UPDATE driver_documents SET expires_at=current_date-1 WHERE public_id=$1", [
    documents.find(Boolean),
  ]);
  const blocked = await request(`/drivers/${driverId}/availability`, driverSession.token, {
    method: "PATCH",
    body: JSON.stringify({ online: true }),
  });
  assert(blocked.status === 409, "expired approved document blocks supply activation");
} finally {
  if (documents.filter(Boolean).length) {
    await pool.query(
      "DELETE FROM audit_events WHERE entity_type='driver_document' AND entity_id=ANY($1)",
      [documents.filter(Boolean)],
    );
    await pool.query("DELETE FROM driver_documents WHERE public_id=ANY($1)", [
      documents.filter(Boolean),
    ]);
  }
  if (internalDriverId && originalCompliance) {
    await pool.query(
      `UPDATE driver_compliance SET status=$2,submitted_at=$3,reviewed_at=$4,reviewed_by=$5,rejection_reason=$6,updated_at=$7 WHERE driver_id=$1`,
      [
        internalDriverId,
        originalCompliance.status,
        originalCompliance.submitted_at,
        originalCompliance.reviewed_at,
        originalCompliance.reviewed_by,
        originalCompliance.rejection_reason,
        originalCompliance.updated_at,
      ],
    );
    await pool.query("UPDATE drivers SET online=$2 WHERE id=$1", [
      internalDriverId,
      originalOnline,
    ]);
  }
  await pool.end();
}
