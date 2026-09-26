// Prueba de entrega (POD) de envíos (ARC-001).
//
// PIN, foto y verificación viven aparte del ciclo create/status y de claims:
// es la evidencia de que el paquete llegó, no el trámite de lo que falló.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { postgresPool } from "./postgres.js";
import { deriveDeliveryPin } from "./secret-envelope.js";
import { encryptDeliveryProof, decryptDeliveryProof } from "./delivery-proof-envelope.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";
import { getPostgresShipments } from "./mobility-repository.js";

const evidenceId = () =>
  `POD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const mapDeliveryEvidence = (row) => ({
  id: row.public_id,
  shipmentId: row.shipment_public_id,
  type: row.evidence_type,
  mimeType: row.mime_type,
  sha256: row.content_sha256,
  sizeBytes: Number(row.size_bytes),
  capturedLocation:
    row.captured_lat === null || row.captured_lat === undefined
      ? null
      : { lat: Number(row.captured_lat), lng: Number(row.captured_lng) },
  capturedAt: new Date(row.captured_at).toISOString(),
  createdAt: new Date(row.created_at).toISOString(),
  signerName: row.signer_name || null,
  signerRelationship: row.signer_relationship || null,
  consentVersion: row.consent_version || null,
});
const matchesImageMime = (content, mimeType) =>
  mimeType === "image/jpeg"
    ? content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff
    : mimeType === "image/png"
      ? content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : mimeType === "image/webp"
        ? content.subarray(0, 4).toString("ascii") === "RIFF" &&
          content.subarray(8, 12).toString("ascii") === "WEBP"
        : false;

export async function getPostgresShipmentDeliveryCode({
  publicId,
  customerPublicId,
  admin = false,
}) {
  const result = await postgresPool.query(
    `SELECT j.status,u.public_id customer_public_id FROM jobs j JOIN users u ON u.id=j.customer_id WHERE j.public_id=$1 AND j.metadata->>'subtype'='shipment'`,
    [publicId],
  );
  const job = result.rows[0];
  if (!job) throw Object.assign(new Error("Envío no encontrado"), { status: 404 });
  if (!admin && job.customer_public_id !== customerPublicId)
    throw Object.assign(new Error("No puedes consultar este código"), { status: 403 });
  if (["completed", "cancelled"].includes(job.status))
    throw Object.assign(new Error("El código ya no está disponible"), { status: 409 });
  return deriveDeliveryPin(publicId);
}

const evidenceSelect = `
  SELECT e.*, j.public_id shipment_public_id, j.customer_id, d.user_id driver_user_id,
    ST_Y(e.captured_location::geometry) captured_lat,
    ST_X(e.captured_location::geometry) captured_lng
  FROM shipment_delivery_evidence e
  JOIN jobs j ON j.id = e.job_id
  LEFT JOIN drivers d ON d.id = j.driver_id
`;

export async function addPostgresShipmentDeliveryEvidence({
  publicId,
  actorPublicId,
  type,
  mimeType,
  contentBase64,
  capturedAt,
  location,
  signerName,
  signerRelationship,
  consentVersion,
  admin = false,
}) {
  const content = Buffer.from(contentBase64, "base64");
  if (!content.length || content.length > 1500000)
    throw Object.assign(new Error("La evidencia debe pesar entre 1 byte y 1,5 MB"), {
      status: 400,
    });
  const normalized = content.toString("base64").replace(/=+$/, ""),
    input = contentBase64.replace(/\s/g, "").replace(/=+$/g, "");
  if (normalized !== input)
    throw Object.assign(new Error("Contenido base64 inválido"), { status: 400 });
  if (!matchesImageMime(content, mimeType))
    throw Object.assign(new Error("El contenido no coincide con el tipo de imagen declarado"), {
      status: 400,
    });
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const actor = (await client.query("SELECT id FROM users WHERE public_id=$1", [actorPublicId]))
      .rows[0];
    const job = (
      await client.query(
        `SELECT j.id,j.status,d.user_id driver_user_id FROM jobs j LEFT JOIN drivers d ON d.id=j.driver_id WHERE j.public_id=$1 AND j.metadata->>'subtype'='shipment' FOR UPDATE OF j`,
        [publicId],
      )
    ).rows[0];
    if (!job) throw Object.assign(new Error("Envío no encontrado"), { status: 404 });
    if (!admin && job.driver_user_id !== actor?.id)
      throw Object.assign(new Error("Sólo el repartidor asignado puede registrar evidencia"), {
        status: 403,
      });
    if (job.status !== "delivering")
      throw Object.assign(new Error("La evidencia se registra al llegar al destino"), {
        status: 409,
      });
    const id = evidenceId(),
      hash = crypto.createHash("sha256").update(content).digest("hex");
    const row = (
      await client.query(
        `INSERT INTO shipment_delivery_evidence(
          public_id, job_id, created_by, evidence_type, mime_type, content_ciphertext,
          content_sha256, size_bytes, captured_location, captured_at,
          signer_name, signer_relationship, consent_version
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          CASE WHEN $9::double precision IS NULL THEN NULL
            ELSE ST_SetSRID(ST_MakePoint($10, $9), 4326)::geography END,
          $11, $12, $13, $14
        )
        ON CONFLICT (job_id, evidence_type) DO UPDATE SET
          public_id = excluded.public_id,
          created_by = excluded.created_by,
          mime_type = excluded.mime_type,
          content_ciphertext = excluded.content_ciphertext,
          content_sha256 = excluded.content_sha256,
          size_bytes = excluded.size_bytes,
          captured_location = excluded.captured_location,
          captured_at = excluded.captured_at,
          signer_name = excluded.signer_name,
          signer_relationship = excluded.signer_relationship,
          consent_version = excluded.consent_version,
          created_at = now()
        RETURNING *`,
        [
          id,
          job.id,
          actor.id,
          type,
          mimeType,
          encryptDeliveryProof(content),
          hash,
          content.length,
          location?.lat ?? null,
          location?.lng ?? null,
          capturedAt || new Date(),
          signerName || null,
          signerRelationship || null,
          consentVersion || null,
        ],
      )
    ).rows[0];
    await client.query("COMMIT");
    return mapDeliveryEvidence({
      ...row,
      shipment_public_id: publicId,
      captured_lat: location?.lat ?? null,
      captured_lng: location?.lng ?? null,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getPostgresShipmentDeliveryEvidence({
  publicId,
  actorPublicId,
  admin = false,
}) {
  const result = await postgresPool.query(
    `${evidenceSelect} WHERE j.public_id=$1 AND j.metadata->>'subtype'='shipment' ORDER BY e.created_at`,
    [publicId],
  );
  if (!result.rows.length) {
    const job = (
      await postgresPool.query(
        `SELECT j.customer_id,d.user_id driver_user_id FROM jobs j LEFT JOIN drivers d ON d.id=j.driver_id WHERE j.public_id=$1 AND j.metadata->>'subtype'='shipment'`,
        [publicId],
      )
    ).rows[0];
    if (!job) throw Object.assign(new Error("Envío no encontrado"), { status: 404 });
    const actor = (
      await postgresPool.query("SELECT id FROM users WHERE public_id=$1", [actorPublicId])
    ).rows[0];
    if (!admin && job.customer_id !== actor?.id && job.driver_user_id !== actor?.id)
      throw Object.assign(new Error("No puedes consultar esta evidencia"), { status: 403 });
    return [];
  }
  const actor = (
    await postgresPool.query("SELECT id FROM users WHERE public_id=$1", [actorPublicId])
  ).rows[0];
  const first = result.rows[0];
  if (!admin && first.customer_id !== actor?.id && first.driver_user_id !== actor?.id)
    throw Object.assign(new Error("No puedes consultar esta evidencia"), { status: 403 });
  return result.rows.map(mapDeliveryEvidence);
}

export async function getPostgresShipmentDeliveryEvidenceContent({
  evidencePublicId,
  actorPublicId,
  admin = false,
}) {
  const row = (
    await postgresPool.query(`${evidenceSelect} WHERE e.public_id=$1`, [evidencePublicId])
  ).rows[0];
  if (!row) throw Object.assign(new Error("Evidencia no encontrada"), { status: 404 });
  const actor = (
    await postgresPool.query("SELECT id FROM users WHERE public_id=$1", [actorPublicId])
  ).rows[0];
  if (!admin && row.customer_id !== actor?.id && row.driver_user_id !== actor?.id)
    throw Object.assign(new Error("No puedes consultar esta evidencia"), { status: 403 });
  return {
    evidence: mapDeliveryEvidence(row),
    contentBase64: decryptDeliveryProof(row.content_ciphertext).toString("base64"),
  };
}

export async function verifyPostgresShipmentDelivery({
  publicId,
  actorPublicId,
  pin,
  admin = false,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT j.id, j.status, j.customer_id, j.driver_id,
        sd.delivery_pin_hash, sd.delivery_pin_failed_attempts, sd.delivery_pin_locked_until,
        sd.signature_required, d.user_id driver_user_id, u.public_id driver_user_public_id
       FROM jobs j
       JOIN shipment_details sd ON sd.job_id = j.id
       LEFT JOIN drivers d ON d.id = j.driver_id
       LEFT JOIN users u ON u.id = d.user_id
       WHERE j.public_id = $1 AND j.metadata->>'subtype' = 'shipment'
       FOR UPDATE OF j, sd`,
      [publicId],
    );
    const job = result.rows[0];
    if (!job) throw Object.assign(new Error("Envío no encontrado"), { status: 404 });
    if (!admin && job.driver_user_public_id !== actorPublicId)
      throw Object.assign(new Error("No puedes verificar este envío"), { status: 403 });
    if (job.status !== "delivering")
      throw Object.assign(new Error("El envío debe estar en camino para verificarlo"), {
        status: 409,
      });
    const evidenceCounts = (
        await client.query(
          "SELECT count(*) FILTER(WHERE evidence_type='photo')::int photo_count,count(*) FILTER(WHERE evidence_type='signature')::int signature_count FROM shipment_delivery_evidence WHERE job_id=$1",
          [job.id],
        )
      ).rows[0],
      photoCount = Number(evidenceCounts.photo_count),
      signatureCount = Number(evidenceCounts.signature_count);
    if (photoCount < 1)
      throw Object.assign(new Error("Tomá una foto de entrega antes de validar el PIN"), {
        status: 409,
      });
    if (job.signature_required && signatureCount < 1)
      throw Object.assign(
        new Error("Este envío requiere la firma del receptor antes de validar el PIN"),
        { status: 409 },
      );
    if (job.delivery_pin_locked_until && new Date(job.delivery_pin_locked_until) > new Date()) {
      await client.query("COMMIT");
      return {
        verified: false,
        lockedUntil: new Date(job.delivery_pin_locked_until).toISOString(),
        attemptsRemaining: 0,
      };
    }
    const actor = (await client.query("SELECT id FROM users WHERE public_id=$1", [actorPublicId]))
      .rows[0];
    if (!bcrypt.compareSync(String(pin), job.delivery_pin_hash)) {
      const attempts = Math.min(5, Number(job.delivery_pin_failed_attempts) + 1),
        lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
      await client.query(
        "UPDATE shipment_details SET delivery_pin_failed_attempts=$2,delivery_pin_locked_until=$3 WHERE job_id=$1",
        [job.id, attempts, lockedUntil],
      );
      await client.query("COMMIT");
      return {
        verified: false,
        attemptsRemaining: Math.max(0, 5 - attempts),
        lockedUntil: lockedUntil?.toISOString() || null,
      };
    }
    const verifiedAt = new Date(),
      proofType = job.signature_required ? "pin+photo+signature" : "pin+photo",
      evidenceCount = photoCount + signatureCount;
    await client.query(
      "UPDATE shipment_details SET delivery_pin_failed_attempts=0,delivery_pin_locked_until=NULL,delivery_verified_at=$2,delivery_verified_by=$3 WHERE job_id=$1",
      [job.id, verifiedAt, actor?.id || null],
    );
    await client.query(
      `UPDATE jobs SET status='completed',version=version+1,updated_at=now(),metadata=jsonb_set(metadata,'{deliveryProof}',$2::jsonb,true) WHERE id=$1`,
      [
        job.id,
        JSON.stringify({ type: proofType, verifiedAt: verifiedAt.toISOString(), evidenceCount }),
      ],
    );
    await client.query(
      "INSERT INTO job_events(job_id,actor_id,status,payload) VALUES($1,$2,'completed',$3)",
      [job.id, actor?.id || null, { proofType, evidenceCount }],
    );
    await enqueueNotificationForInternalUser(client, {
      userId: job.customer_id,
      template: "shipment_status",
      payload: { kind: "shipment", jobId: publicId, status: "delivered", proofType },
      deduplicationKey: `shipment:${publicId}:delivered`,
    });
    await client.query("COMMIT");
    return {
      verified: true,
      shipment: (await getPostgresShipments()).find((entry) => entry.id === publicId),
      proofType,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
