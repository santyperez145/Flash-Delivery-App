import pg from "pg";
const pool = new pg.Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
    ssl: false,
  }),
  base = process.env.API_URL || "http://127.0.0.1:4000/api";
let token = "",
  jobId = `SHIP-CLAIM-${Date.now()}`,
  claimId = null,
  evidenceId = null,
  requestIds = [];
const assert = (value, label) => {
  if (!value) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
const call = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  let body = {};
  try {
    body = await response.json();
  } catch {}
  return { status: response.status, body };
};
const login = async (email) => {
  const result = await call("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "demo123", deviceName: "shipment-claims-smoke" }),
  });
  return result.body.token;
};
try {
  await pool.query("SELECT set_config('app.audit_maintenance','on',false)");
  await pool.query(
    "DELETE FROM audit_events WHERE entity_id LIKE 'CLM-SMOKE-%' OR entity_id LIKE 'SHIP-CLAIM-%'",
  );
  await pool.query("DELETE FROM jobs WHERE public_id LIKE 'SHIP-CLAIM-%'");
  await pool.query(
    `WITH inserted AS (INSERT INTO jobs(public_id,kind,customer_id,status,pickup_address,pickup_location,dropoff_address,dropoff_location,service_level,quoted_amount_cents,final_amount_cents,distance_m,estimated_duration_s,metadata,updated_at) SELECT $1,'delivery',u.id,'completed','A',ST_SetSRID(ST_MakePoint(-58.39,-34.60),4326)::geography,'B',ST_SetSRID(ST_MakePoint(-58.40,-34.61),4326)::geography,'standard',100000,100000,1000,600,'{"subtype":"shipment"}',now() FROM users u WHERE u.public_id='usr_customer' RETURNING id) INSERT INTO shipment_details(job_id,recipient_name,recipient_phone,package_size,description,weight_grams,delivery_pin_hash,terms_accepted_at,declared_value_cents,protection_plan_id,protection_premium_cents,item_category_id,service_level_id) SELECT i.id,'Receptor','+5491100000000','small','Fixture protegido',500,'hash',now(),1000000,p.id,50000,c.id,l.id FROM inserted i CROSS JOIN shipment_protection_plans p CROSS JOIN shipment_item_categories c CROSS JOIN shipment_service_levels l WHERE p.code='standard' AND c.code='standard' AND l.code='standard'`,
    [jobId],
  );
  const customer = await login("cliente@flash.app"),
    admin = await login("ops@flash.app");
  token = customer;
  const created = await call(`/shipments/${jobId}/claims`, {
    method: "POST",
    body: JSON.stringify({
      claimType: "damaged",
      description: "El paquete llegó quebrado y cuento con fotografías",
      requestedAmount: 6000,
    }),
  });
  claimId = created.body.claim?.id;
  requestIds.push(created.body.requestId);
  const deductible =
    Number(
      (
        await pool.query(
          "SELECT deductible_cents FROM shipment_protection_plans WHERE code='standard'",
        )
      ).rows[0].deductible_cents,
    ) / 100;
  assert(
    created.status === 201 &&
      claimId &&
      created.body.claim.eligibleAmount === Math.min(6000, 10000 - deductible),
    "protected shipment opens one claim capped by declared value minus deductible",
  );
  const duplicate = await call(`/shipments/${jobId}/claims`, {
    method: "POST",
    body: JSON.stringify({
      claimType: "lost",
      description: "Intento duplicado de reclamo protegido",
      requestedAmount: 100,
    }),
  });
  assert(duplicate.status === 409, "one shipment cannot open duplicate claims");
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x46, 0x4c, 0x41, 0x53, 0x48, 0xff, 0xd9]),
    invalid = await call(`/shipment-claims/${claimId}/evidence`, {
      method: "POST",
      body: JSON.stringify({
        fileName: "falsa.png",
        mimeType: "image/png",
        contentBase64: jpeg.toString("base64"),
      }),
    }),
    uploaded = await call(`/shipment-claims/${claimId}/evidence`, {
      method: "POST",
      body: JSON.stringify({
        fileName: "daño.jpg",
        mimeType: "image/jpeg",
        contentBase64: jpeg.toString("base64"),
      }),
    });
  evidenceId = uploaded.body.evidence?.id;
  requestIds.push(uploaded.body.requestId);
  const stored = (
      await pool.query(
        "SELECT content_ciphertext,content_sha256 FROM shipment_claim_evidence WHERE public_id=$1",
        [evidenceId],
      )
    ).rows[0],
    listed = await call("/shipment-claims");
  assert(
    invalid.status === 400 &&
      uploaded.status === 201 &&
      evidenceId &&
      stored.content_ciphertext !== jpeg.toString("base64") &&
      listed.body.claims
        ?.find((entry) => entry.id === claimId)
        ?.evidence?.some((entry) => entry.id === evidenceId),
    "claim evidence validates magic bytes, encrypts at rest and is listed as metadata",
  );
  token = admin;
  const downloaded = await call(`/shipment-claim-evidence/${evidenceId}/content`),
    all = await call("/shipment-claims"),
    review = await call(`/shipment-claims/${claimId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "under_review",
        resolutionNote: "Documentación recibida y en revisión",
      }),
    }),
    excessive = await call(`/shipment-claims/${claimId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "approved",
        resolutionNote: "Monto fuera de cobertura",
        approvedAmount: 6000,
      }),
    }),
    approved = await call(`/shipment-claims/${claimId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "approved",
        resolutionNote: "Daño validado dentro de cobertura",
        approvedAmount: created.body.claim.eligibleAmount,
      }),
    });
  requestIds.push(review.body.requestId, approved.body.requestId);
  assert(
    downloaded.body.contentBase64 === jpeg.toString("base64"),
    "authorized operations decrypts the exact evidence bytes",
  );
  assert(
    all.body.claims?.some((entry) => entry.id === claimId) &&
      review.body.claim?.status === "under_review" &&
      excessive.status === 400 &&
      approved.body.claim?.approvedAmount === created.body.claim.eligibleAmount,
    "operations reviews claim and cannot approve above eligible coverage",
  );
  for (const status of ["settlement_pending", "settled"]) {
    const result = await call(`/shipment-claims/${claimId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status,
        resolutionNote:
          status === "settlement_pending"
            ? "Enviado al proveedor habilitado"
            : "Proveedor confirmó liquidación",
      }),
    });
    requestIds.push(result.body.requestId);
    assert(result.body.claim?.status === status, `claim transitions to ${status}`);
  }
  token = customer;
  assert(
    (await call("/shipment-claims")).body.claims?.some(
      (entry) => entry.id === claimId && entry.status === "settled",
    ),
    "customer follows the persisted claim resolution",
  );
  const closedUpload = await call(`/shipment-claims/${claimId}/evidence`, {
    method: "POST",
    body: JSON.stringify({
      fileName: "tarde.jpg",
      mimeType: "image/jpeg",
      contentBase64: jpeg.toString("base64"),
    }),
  });
  assert(closedUpload.status === 404, "closed claim rejects late evidence");
  const auditLeak = await pool.query(
    "SELECT count(*)::int count FROM audit_events WHERE request_id=ANY($1) AND (after_data::text LIKE '%paquete llegó quebrado%' OR after_data::text LIKE $2)",
    [requestIds.filter(Boolean), `%${jpeg.toString("base64")}%`],
  );
  assert(
    auditLeak.rows[0].count === 0,
    "claim narrative and evidence bytes are excluded from audit payloads",
  );
} finally {
  await pool.query("SELECT set_config('app.audit_maintenance','on',false)");
  if (requestIds.filter(Boolean).length)
    await pool.query("DELETE FROM audit_events WHERE request_id=ANY($1)", [
      requestIds.filter(Boolean),
    ]);
  await pool.query("DELETE FROM jobs WHERE public_id=$1", [jobId]);
  await pool.end();
}
