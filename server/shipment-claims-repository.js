// Devoluciones y siniestros de envíos (ARC-001).
//
// Separado del ciclo create/status y del POD: es la cola cuando el envío salió
// mal —vuelve o se liquida— y comparte cifrado de evidencia con el router de
// protección.
import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
import { decryptShipmentClaimEvidence, encryptShipmentClaimEvidence } from "./secret-envelope.js";
import { pesos } from "./money.js";

const mapShipmentReturn = (row) => ({
  id: row.public_id,
  shipmentId: row.shipment_public_id,
  reason: row.reason,
  status: row.status,
  resolutionNote: row.resolution_note || null,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});
export async function getPostgresShipmentReturns({ customerPublicId, includeAll = false }) {
  const result = await postgresPool.query(
    `SELECT r.*, j.public_id shipment_public_id
     FROM shipment_return_requests r
     JOIN jobs j ON j.id = r.job_id
     JOIN users u ON u.id = r.requested_by
     WHERE $2::boolean OR u.public_id = $1
     ORDER BY r.created_at DESC`,
    [customerPublicId, includeAll],
  );
  return result.rows.map(mapShipmentReturn);
}
export async function createPostgresShipmentReturn({ shipmentPublicId, customerPublicId, reason }) {
  const result = await postgresPool.query(
    `INSERT INTO shipment_return_requests(public_id, job_id, requested_by, reason)
     SELECT $1, j.id, u.id, $4
     FROM jobs j
     JOIN users u ON u.id = j.customer_id
     WHERE j.public_id = $2 AND u.public_id = $3
       AND j.metadata->>'subtype' = 'shipment' AND j.status = 'completed'
       AND j.updated_at >= now() - interval '7 days'
     RETURNING *`,
    [`RET-${crypto.randomUUID()}`, shipmentPublicId, customerPublicId, reason],
  );
  if (!result.rows[0])
    throw Object.assign(new Error("Envío no encontrado o fuera de la ventana de devolución"), {
      status: 404,
    });
  return mapShipmentReturn({ ...result.rows[0], shipment_public_id: shipmentPublicId });
}
export async function updatePostgresShipmentReturn({ returnPublicId, status, resolutionNote }) {
  const result = await postgresPool.query(
    `UPDATE shipment_return_requests SET
      status = $2, resolution_note = $3, updated_at = now()
     WHERE public_id = $1
       AND (
         ($2 = 'approved' AND status = 'requested')
         OR ($2 = 'rejected' AND status = 'requested')
         OR ($2 = 'in_transit' AND status = 'approved')
         OR ($2 = 'completed' AND status = 'in_transit')
       )
     RETURNING *`,
    [returnPublicId, status, resolutionNote || null],
  );
  if (!result.rows[0])
    throw Object.assign(new Error("La devolución no admite esa transición"), { status: 409 });
  const shipment = (
    await postgresPool.query("SELECT public_id FROM jobs WHERE id=$1", [result.rows[0].job_id])
  ).rows[0];
  return mapShipmentReturn({ ...result.rows[0], shipment_public_id: shipment.public_id });
}
const mapClaimEvidence = (row) => ({
  id: row.public_id,
  fileName: row.file_name,
  mimeType: row.mime_type,
  sha256: row.content_sha256,
  sizeBytes: Number(row.size_bytes),
  createdAt: new Date(row.created_at).toISOString(),
});
const mapShipmentClaim = (row) => ({
  id: row.public_id,
  shipmentId: row.shipment_public_id,
  claimType: row.claim_type,
  description: row.description,
  requestedAmount: pesos(row.requested_amount_cents),
  eligibleAmount: pesos(row.eligible_amount_cents),
  approvedAmount: row.approved_amount_cents === null ? null : pesos(row.approved_amount_cents),
  status: row.status,
  resolutionNote: row.resolution_note || null,
  evidence: Array.isArray(row.evidence)
    ? row.evidence.map((entry) => ({
        id: entry.id,
        fileName: entry.fileName,
        mimeType: entry.mimeType,
        sha256: entry.sha256,
        sizeBytes: Number(entry.sizeBytes),
        createdAt: new Date(entry.createdAt).toISOString(),
      }))
    : [],
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});
export async function getPostgresShipmentClaims({ customerPublicId, includeAll = false }) {
  const rows = (
    await postgresPool.query(
      `SELECT c.*, j.public_id shipment_public_id,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', e.public_id, 'fileName', e.file_name, 'mimeType', e.mime_type,
            'sha256', e.content_sha256, 'sizeBytes', e.size_bytes, 'createdAt', e.created_at
          ) ORDER BY e.created_at)
          FROM shipment_claim_evidence e WHERE e.claim_id = c.id
        ), '[]'::jsonb) evidence
       FROM shipment_protection_claims c
       JOIN jobs j ON j.id = c.job_id
       JOIN users u ON u.id = c.customer_id
       WHERE $2::boolean OR u.public_id = $1
       ORDER BY c.created_at DESC`,
      [customerPublicId, includeAll],
    )
  ).rows;
  return rows.map(mapShipmentClaim);
}
export async function createPostgresShipmentClaim({
  shipmentPublicId,
  customerPublicId,
  claimType,
  description,
  requestedAmount,
}) {
  const id = `CLM-${crypto.randomUUID()}`,
    result = await postgresPool.query(
      `INSERT INTO shipment_protection_claims(
        public_id, job_id, customer_id, claim_type, description,
        requested_amount_cents, eligible_amount_cents
      )
      SELECT $1, j.id, j.customer_id, $4, $5, $6,
        LEAST($6, GREATEST(0, sd.declared_value_cents - p.deductible_cents))
      FROM jobs j
      JOIN users u ON u.id = j.customer_id
      JOIN shipment_details sd ON sd.job_id = j.id
      JOIN shipment_protection_plans p ON p.id = sd.protection_plan_id
      WHERE j.public_id = $2 AND u.public_id = $3
        AND j.metadata->>'subtype' = 'shipment'
        AND j.status IN ('completed', 'cancelled')
        AND j.updated_at >= now() - interval '7 days'
      RETURNING *`,
      [
        id,
        shipmentPublicId,
        customerPublicId,
        claimType,
        description,
        Math.round(requestedAmount * 100),
      ],
    );
  if (!result.rows[0])
    throw Object.assign(new Error("Envío sin cobertura elegible o fuera del plazo de 7 días"), {
      status: 404,
    });
  return mapShipmentClaim({ ...result.rows[0], shipment_public_id: shipmentPublicId });
}
export async function updatePostgresShipmentClaim({
  claimPublicId,
  actorPublicId,
  status,
  resolutionNote,
  approvedAmount,
}) {
  const current = (
    await postgresPool.query("SELECT * FROM shipment_protection_claims WHERE public_id=$1", [
      claimPublicId,
    ])
  ).rows[0];
  if (!current) throw Object.assign(new Error("Siniestro no encontrado"), { status: 404 });
  const allowed = {
    submitted: ["under_review", "rejected"],
    under_review: ["approved", "rejected"],
    approved: ["settlement_pending"],
    settlement_pending: ["settled"],
  };
  if (!allowed[current.status]?.includes(status))
    throw Object.assign(new Error("El siniestro no admite esa transición"), { status: 409 });
  const approvedCents =
    status === "approved"
      ? Math.round(Number(approvedAmount) * 100)
      : current.approved_amount_cents;
  if (
    status === "approved" &&
    (!approvedCents || approvedCents > Number(current.eligible_amount_cents))
  )
    throw Object.assign(new Error("El monto aprobado debe respetar el máximo elegible"), {
      status: 400,
    });
  const row = (
      await postgresPool.query(
        `UPDATE shipment_protection_claims SET
          status = $2, resolution_note = $3, approved_amount_cents = $4,
          reviewed_by = (SELECT id FROM users WHERE public_id = $5),
          reviewed_at = now(), updated_at = now()
         WHERE public_id = $1
         RETURNING *`,
        [claimPublicId, status, resolutionNote || null, approvedCents, actorPublicId],
      )
    ).rows[0],
    job = (await postgresPool.query("SELECT public_id FROM jobs WHERE id=$1", [row.job_id]))
      .rows[0];
  return mapShipmentClaim({ ...row, shipment_public_id: job.public_id });
}
const claimEvidenceMime = (content, mime) =>
  mime === "image/jpeg"
    ? content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff
    : mime === "image/png"
      ? content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : mime === "application/pdf"
        ? content.subarray(0, 5).toString("ascii") === "%PDF-"
        : false;
export async function addPostgresShipmentClaimEvidence({
  claimPublicId,
  actorPublicId,
  fileName,
  mimeType,
  contentBase64,
  includeAll = false,
}) {
  const content = Buffer.from(contentBase64, "base64"),
    normalized = content.toString("base64").replace(/=+$/, "");
  if (
    !content.length ||
    content.length > 768000 ||
    normalized !== contentBase64.replace(/\s/g, "").replace(/=+$/, "") ||
    !claimEvidenceMime(content, mimeType)
  )
    throw Object.assign(new Error("Evidencia inválida, demasiado grande o con MIME incorrecto"), {
      status: 400,
    });
  const result = await postgresPool.query(
    `INSERT INTO shipment_claim_evidence(
      public_id, claim_id, uploaded_by, file_name, mime_type,
      content_ciphertext, content_sha256, size_bytes
    )
    SELECT $1, c.id, actor.id, $4, $5, $6, $7, $8
    FROM shipment_protection_claims c
    JOIN users owner ON owner.id = c.customer_id
    JOIN users actor ON actor.public_id = $3
    WHERE c.public_id = $2
      AND ($9::boolean OR owner.public_id = $3)
      AND c.status IN ('submitted', 'under_review')
    RETURNING *`,
    [
      `CEV-${crypto.randomUUID()}`,
      claimPublicId,
      actorPublicId,
      fileName.replace(/[\\/\0]/g, "_").slice(0, 160),
      mimeType,
      encryptShipmentClaimEvidence(content),
      crypto.createHash("sha256").update(content).digest("hex"),
      content.length,
      includeAll,
    ],
  );
  if (!result.rows[0])
    throw Object.assign(new Error("Siniestro no encontrado o cerrado para evidencia"), {
      status: 404,
    });
  return mapClaimEvidence(result.rows[0]);
}
export async function getPostgresShipmentClaimEvidenceContent({
  evidencePublicId,
  actorPublicId,
  includeAll = false,
}) {
  const row = (
    await postgresPool.query(
      `SELECT e.*, owner.public_id owner_public_id
       FROM shipment_claim_evidence e
       JOIN shipment_protection_claims c ON c.id = e.claim_id
       JOIN users owner ON owner.id = c.customer_id
       WHERE e.public_id = $1 AND ($3::boolean OR owner.public_id = $2)`,
      [evidencePublicId, actorPublicId, includeAll],
    )
  ).rows[0];
  if (!row) throw Object.assign(new Error("Evidencia no encontrada"), { status: 404 });
  return {
    evidence: mapClaimEvidence(row),
    contentBase64: decryptShipmentClaimEvidence(row.content_ciphertext).toString("base64"),
  };
}
