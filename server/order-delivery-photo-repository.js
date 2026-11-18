// Foto de entrega de un pedido dejado en la puerta (P-02b).
//
// DoorDash la exige y Uber Eats la usa: si el cliente pidió que le dejen el pedido
// en la puerta, quien reparte saca una foto antes de cerrarlo. Es lo que contesta
// «no me llegó» sin depender de la palabra de nadie.
//
// Reusa la evidencia de los envíos (migraciones 023, 054, 063): misma tabla, mismo
// cifrado y mismo hash. La tabla se llama `shipment_delivery_evidence` por su
// origen, pero cuelga de `jobs`: un pedido de comida es un trabajo más.
import crypto from "node:crypto";

import { decryptDeliveryProof, encryptDeliveryProof } from "./delivery-proof-envelope.js";
import { postgresPool } from "./postgres.js";

const pedido = (client, publicId) =>
  client.query(
    `SELECT j.id,j.status,j.customer_id,d.user_id driver_user_id FROM jobs j
       LEFT JOIN drivers d ON d.id=j.driver_id
      WHERE j.public_id=$1 AND j.kind='delivery' AND j.metadata->>'subtype'='food_order'`,
    [publicId],
  );

export async function addPostgresOrderDeliveryPhoto({
  orderPublicId,
  actorPublicId,
  mimeType,
  contentBase64,
  capturedAt,
  location,
}) {
  const content = Buffer.from(contentBase64, "base64");
  if (!content.length || content.length > 1500000)
    throw Object.assign(new Error("La foto tiene que pesar menos de 1,5 MB"), { status: 400 });
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const actor = (await client.query("SELECT id FROM users WHERE public_id=$1", [actorPublicId]))
      .rows[0];
    const job = (await pedido(client, orderPublicId)).rows[0];
    if (!job) throw Object.assign(new Error("Pedido no encontrado"), { status: 404 });
    if (job.driver_user_id !== actor?.id)
      throw Object.assign(new Error("Sólo quien reparte el pedido puede sacar la foto"), {
        status: 403,
      });
    if (job.status !== "delivering")
      throw Object.assign(new Error("La foto se saca al llegar a la puerta"), { status: 409 });
    const sha256 = crypto.createHash("sha256").update(content).digest("hex");
    const row = (
      await client.query(
        `INSERT INTO shipment_delivery_evidence(public_id,job_id,created_by,evidence_type,mime_type,
           content_ciphertext,content_sha256,size_bytes,captured_location,captured_at)
         VALUES($1,$2,$3,'photo',$4,$5,$6,$7,
           CASE WHEN $8::double precision IS NULL THEN NULL
                ELSE ST_SetSRID(ST_MakePoint($9,$8),4326)::geography END,$10)
         ON CONFLICT(job_id,evidence_type) DO UPDATE SET public_id=excluded.public_id,
           created_by=excluded.created_by,mime_type=excluded.mime_type,
           content_ciphertext=excluded.content_ciphertext,content_sha256=excluded.content_sha256,
           size_bytes=excluded.size_bytes,captured_location=excluded.captured_location,
           captured_at=excluded.captured_at,created_at=now()
         RETURNING public_id,content_sha256,size_bytes,captured_at`,
        [
          `POD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
          job.id,
          actor.id,
          mimeType,
          encryptDeliveryProof(content),
          sha256,
          content.length,
          location?.lat ?? null,
          location?.lng ?? null,
          capturedAt || new Date(),
        ],
      )
    ).rows[0];
    await client.query("COMMIT");
    return {
      id: row.public_id,
      sha256: row.content_sha256,
      sizeBytes: Number(row.size_bytes),
      capturedAt: new Date(row.captured_at).toISOString(),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function orderHasDeliveryPhoto(orderPublicId) {
  const result = await postgresPool.query(
    `SELECT 1 FROM shipment_delivery_evidence e JOIN jobs j ON j.id=e.job_id
      WHERE j.public_id=$1 AND e.evidence_type='photo'`,
    [orderPublicId],
  );
  return result.rowCount > 0;
}

/** La foto, para quien pidió, quien repartió u operaciones. */
export async function getPostgresOrderDeliveryPhoto({ orderPublicId, actorPublicId, admin }) {
  const client = await postgresPool.connect();
  try {
    const actor = (await client.query("SELECT id FROM users WHERE public_id=$1", [actorPublicId]))
      .rows[0];
    const job = (await pedido(client, orderPublicId)).rows[0];
    if (!job) throw Object.assign(new Error("Pedido no encontrado"), { status: 404 });
    if (!admin && actor?.id !== job.customer_id && actor?.id !== job.driver_user_id)
      throw Object.assign(new Error("No podés ver la foto de este pedido"), { status: 403 });
    const row = (
      await client.query(
        `SELECT mime_type,content_ciphertext FROM shipment_delivery_evidence
          WHERE job_id=$1 AND evidence_type='photo'`,
        [job.id],
      )
    ).rows[0];
    if (!row) throw Object.assign(new Error("El pedido no tiene foto de entrega"), { status: 404 });
    return { mimeType: row.mime_type, content: decryptDeliveryProof(row.content_ciphertext) };
  } finally {
    client.release();
  }
}
