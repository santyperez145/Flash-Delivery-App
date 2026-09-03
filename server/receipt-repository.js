import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
import { pesos } from "./money.js";

const mapReceipt = (row) => ({
  id: row.public_id,
  number: row.receipt_number,
  jobId: row.job_public_id,
  serviceKind: row.service_kind,
  serviceSubtype: row.service_subtype || null,
  subtotal: pesos(row.subtotal_cents),
  discount: pesos(row.discount_cents),
  deliveryFee: pesos(row.delivery_fee_cents),
  serviceFee: pesos(row.service_fee_cents),
  total: pesos(row.total_cents),
  currency: row.currency,
  lineItems: row.line_items || [],
  payment: row.payment_summary || {},
  issuedAt: new Date(row.issued_at).toISOString(),
  fiscal: false,
  documentType: "service_receipt",
  metadata: row.metadata || {},
});

export async function getOrCreatePostgresReceipt({ jobPublicId, actorPublicId, admin = false }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const job = (
      await client.query(
        `SELECT j.*,u.public_id customer_public_id
      FROM jobs j JOIN users u ON u.id=j.customer_id
      WHERE j.public_id=$1 AND ($2::boolean OR u.public_id=$3) FOR UPDATE OF j`,
        [jobPublicId, admin, actorPublicId],
      )
    ).rows[0];
    if (!job) throw Object.assign(new Error("Servicio no encontrado o ajeno"), { status: 404 });
    if (job.status !== "completed")
      throw Object.assign(
        new Error("El comprobante estará disponible cuando finalice el servicio"),
        { status: 409 },
      );
    const existing = (
      await client.query(
        "SELECT r.*,j.public_id job_public_id FROM service_receipts r JOIN jobs j ON j.id=r.job_id WHERE r.job_id=$1",
        [job.id],
      )
    ).rows[0];
    if (existing) {
      await client.query("COMMIT");
      return { receipt: mapReceipt(existing), created: false };
    }
    const metadata = job.metadata || {},
      totalCents = Number(job.final_amount_cents ?? job.quoted_amount_cents ?? 0);
    let subtotalCents = totalCents,
      deliveryFeeCents = 0,
      serviceFeeCents = 0,
      discountCents = 0;
    const itemRows = (
      await client.query(
        "SELECT name,quantity,unit_price_cents,metadata FROM job_items WHERE job_id=$1 ORDER BY id",
        [job.id],
      )
    ).rows;
    let lineItems = itemRows.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unitPrice: pesos(item.unit_price_cents),
      total: pesos(Number(item.unit_price_cents) * item.quantity),
      extras: item.metadata?.extras || [],
    }));
    if (metadata.subtype === "food_order") {
      subtotalCents = Math.round(Number(metadata.subtotal || 0) * 100);
      deliveryFeeCents = Math.round(Number(metadata.deliveryFee || 0) * 100);
      serviceFeeCents = Math.round(Number(metadata.serviceFee || 0) * 100);
      discountCents = Math.round(Number(metadata.discount || 0) * 100);
    } else if (!lineItems.length) {
      lineItems = [
        {
          name: job.kind === "ride" ? "Viaje Flash" : "Envío Flash",
          quantity: 1,
          unitPrice: pesos(totalCents),
          total: pesos(totalCents),
        },
      ];
    }
    const payment = (
      await client.query(
        "SELECT provider,status,amount_cents,captured_amount_cents,currency FROM payment_intents WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1",
        [job.id],
      )
    ).rows[0];
    const number = (
      await client.query(
        "SELECT 'FL-'||to_char(CURRENT_DATE,'YYYYMMDD')||'-'||lpad(nextval('service_receipt_number_seq')::text,8,'0') number",
      )
    ).rows[0].number;
    const publicId = `RCT-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
    const inserted = (
      await client.query(
        `INSERT INTO service_receipts(
          public_id, receipt_number, job_id, customer_id, service_kind, service_subtype,
          subtotal_cents, discount_cents, delivery_fee_cents, service_fee_cents, total_cents,
          currency, line_items, payment_summary, metadata
        )
        VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15)
        RETURNING *`,
        [
          publicId,
          number,
          job.id,
          job.customer_id,
          job.kind,
          metadata.subtype || null,
          subtotalCents,
          discountCents,
          deliveryFeeCents,
          serviceFeeCents,
          totalCents,
          payment?.currency || "ARS",
          JSON.stringify(lineItems),
          payment
            ? {
                provider: payment.provider,
                status: payment.status,
                amount: pesos(payment.amount_cents),
                capturedAmount: pesos(payment.captured_amount_cents),
                currency: payment.currency,
              }
            : { status: "not_recorded", currency: "ARS" },
          {
            pickup: job.pickup_address,
            dropoff: job.dropoff_address,
            serviceLevel: job.service_level,
          },
        ],
      )
    ).rows[0];
    await client.query("COMMIT");
    return { receipt: mapReceipt({ ...inserted, job_public_id: jobPublicId }), created: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
