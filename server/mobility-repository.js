// Envíos (shipments): listar, crear y avanzar estado (ARC-001).
//
// Viajes → `ride-repository.js`. Opciones → `shipment-options-repository.js`.
// Claims/devoluciones → `shipment-claims-repository.js`. POD →
// `shipment-delivery-repository.js`.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { postgresPool } from "./postgres.js";
import { captureWalletPayment } from "./wallet-repository.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";
import { acceptDispatchOffer, createDispatchOffers } from "./dispatch-repository.js";
import { deriveDeliveryPin } from "./secret-envelope.js";
import { pesos } from "./money.js";

const shipmentApiStatus = (status) => (status === "completed" ? "delivered" : status);
const shipmentDbStatus = (status) => (status === "delivered" ? "completed" : status);

export async function getPostgresShipments() {
  const result = await postgresPool.query(`
    SELECT j.*, u.public_id customer_public_id, d.public_id driver_public_id, sd.*,
      ST_Y(j.pickup_location::geometry) pickup_lat, ST_X(j.pickup_location::geometry) pickup_lng,
      ST_Y(j.dropoff_location::geometry) dropoff_lat, ST_X(j.dropoff_location::geometry) dropoff_lng,
      (SELECT jsonb_build_object(
        'id', c.public_id, 'reason', c.reason_code,
        'refundAmount', c.refund_amount_cents / 100.0, 'fee', c.cancellation_fee_cents / 100.0,
        'createdAt', c.created_at
      ) FROM job_cancellations c WHERE c.job_id = j.id) cancellation,
      (SELECT count(*)::int FROM shipment_delivery_evidence e WHERE e.job_id = j.id)
        delivery_evidence_count,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'status', CASE WHEN je.status = 'completed' THEN 'delivered' ELSE je.status::text END,
          'at', je.occurred_at
        ) ORDER BY je.occurred_at)
        FROM job_events je WHERE je.job_id = j.id
      ), '[]') timeline
    FROM jobs j
    JOIN users u ON u.id = j.customer_id
    JOIN shipment_details sd ON sd.job_id = j.id
    JOIN shipment_item_categories sic ON sic.id = sd.item_category_id
    JOIN shipment_service_levels ssl ON ssl.id = sd.service_level_id
    LEFT JOIN drivers d ON d.id = j.driver_id
    WHERE j.kind = 'delivery' AND j.metadata->>'subtype' = 'shipment'
    ORDER BY j.created_at DESC`);
  return result.rows.map((row) => ({
    id: row.public_id,
    customerId: row.customer_public_id,
    driverId: row.driver_public_id || null,
    status: shipmentApiStatus(row.status),
    pickup: row.pickup_address,
    destination: row.dropoff_address,
    pickupLocation: { lat: Number(row.pickup_lat), lng: Number(row.pickup_lng) },
    destinationLocation: { lat: Number(row.dropoff_lat), lng: Number(row.dropoff_lng) },
    recipientName: row.recipient_name,
    recipientPhone: row.recipient_phone,
    packageSize: row.package_size,
    description: row.description,
    weightKg: row.weight_grams / 1000,
    deliveryNotes: row.delivery_notes || "",
    declaredValue: pesos(row.declared_value_cents),
    protection: row.protection_plan_id ? "standard" : "none",
    protectionPremium: pesos(row.protection_premium_cents),
    signatureRequired: Boolean(row.signature_required),
    itemCategory: row.metadata?.itemCategory || "standard",
    serviceLevel: row.metadata?.shipmentServiceLevel || "standard",
    handlingInstructions: row.metadata?.handlingInstructions || "",
    distanceKm: Number((row.distance_m / 1000).toFixed(1)),
    etaMin: Number(row.metadata?.etaMin || 0),
    fare: pesos(row.final_amount_cents ?? row.quoted_amount_cents),
    quoteId: row.metadata?.quoteId || null,
    pricingVersion: row.metadata?.pricingVersion || "",
    fareBreakdown: row.metadata?.fareBreakdown || {},
    paymentMethod: row.payment_method_label || "",
    deliveryEvidenceCount: Number(row.delivery_evidence_count || 0),
    deliveryVerifiedAt: row.delivery_verified_at
      ? new Date(row.delivery_verified_at).toISOString()
      : null,
    createdAt: new Date(row.created_at).toISOString(),
    timeline: row.timeline || [],
    cancellation: row.cancellation || null,
  }));
}

export async function createPostgresShipment({
  publicId,
  customerPublicId,
  data,
  quote,
  idempotencyKey,
}) {
  const client = await postgresPool.connect();
  const deliveryPin = deriveDeliveryPin(publicId);
  try {
    await client.query("BEGIN");
    const customer = (
      await client.query("SELECT id FROM users WHERE public_id=$1", [customerPublicId])
    ).rows[0];
    if (!customer) throw Object.assign(new Error("Cliente no encontrado"), { status: 404 });
    if (!data.pickupCoords || !data.destinationCoords)
      throw Object.assign(new Error("Origen y destino deben tener coordenadas reales"), {
        status: 400,
      });
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify({ customerPublicId, ...data, quote: quote.fare }))
      .digest("hex");
    const claim = await client.query(
      `INSERT INTO idempotency_keys(key,user_id,request_hash,expires_at) VALUES($1,$2,$3,now()+interval '24 hours') ON CONFLICT DO NOTHING RETURNING key`,
      [idempotencyKey, customer.id, hash],
    );
    if (!claim.rows[0]) {
      const old = (
        await client.query("SELECT request_hash,response_body FROM idempotency_keys WHERE key=$1", [
          idempotencyKey,
        ])
      ).rows[0];
      if (old?.request_hash !== hash)
        throw Object.assign(new Error("Clave de idempotencia reutilizada con otra solicitud"), {
          status: 409,
        });
      if (old?.response_body?.shipment) {
        await client.query("ROLLBACK");
        return old.response_body.shipment;
      }
      throw Object.assign(new Error("Solicitud en proceso"), { status: 409 });
    }
    const status = "requested";
    const metadata = {
      subtype: "shipment",
      etaMin: quote.etaMin,
      quoteId: quote.quoteId || null,
      pricingVersion: quote.pricingVersion,
      fareBreakdown: quote.breakdown,
      zoneId: quote.zoneId || null,
      deliveryMultiplier: quote.deliveryMultiplier || 1,
      itemCategory: data.itemCategory,
      shipmentServiceLevel: data.serviceLevel,
      handlingInstructions: quote.handlingInstructions,
    };
    const job = (
      await client.query(
        `INSERT INTO jobs(
          public_id, kind, customer_id, driver_id, status, pickup_address, pickup_location,
          dropoff_address, dropoff_location, service_level, quoted_amount_cents,
          final_amount_cents, distance_m, estimated_duration_s, payment_method_label, metadata
        )
        VALUES (
          $1, 'delivery', $2, $3, $4, $5,
          ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography, $8,
          ST_SetSRID(ST_MakePoint($9, $10), 4326)::geography, $16,
          $11, $11, $12, $13, $14, $15
        )
        RETURNING id, created_at`,
        [
          publicId,
          customer.id,
          null,
          status,
          data.pickup,
          data.pickupCoords.lng,
          data.pickupCoords.lat,
          data.destination,
          data.destinationCoords.lng,
          data.destinationCoords.lat,
          Math.round(quote.fare * 100),
          Math.round(quote.distanceKm * 1000),
          quote.etaMin * 60,
          data.paymentMethod,
          metadata,
          data.serviceLevel,
        ],
      )
    ).rows[0];
    await client.query(
      `INSERT INTO shipment_details(
        job_id, recipient_name, recipient_phone, package_size, description, weight_grams,
        delivery_notes, delivery_pin_hash, terms_accepted_at, declared_value_cents,
        protection_plan_id, protection_premium_cents, signature_required,
        item_category_id, service_level_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9, $10, $11, $12, $13, $14)`,
      [
        job.id,
        data.recipientName,
        data.recipientPhone,
        data.packageSize,
        data.description,
        Math.round(data.weightKg * 1000),
        data.deliveryNotes || null,
        bcrypt.hashSync(deliveryPin, 10),
        Math.round((data.declaredValue || 0) * 100),
        quote.protectionPlanId || null,
        Math.round((quote.protectionPremium || 0) * 100),
        Boolean(data.signatureRequired),
        quote.itemCategoryId,
        quote.serviceLevelId,
      ],
    );
    await client.query("INSERT INTO job_events(job_id,actor_id,status) VALUES($1,$2,'requested')", [
      job.id,
      customer.id,
    ]);
    await createDispatchOffers(client, { jobId: job.id, mode: "delivery" });
    await enqueueNotificationForInternalUser(client, {
      userId: customer.id,
      template: "shipment_status",
      payload: { kind: "shipment", jobId: publicId, status },
      deduplicationKey: `shipment:${publicId}:${status}`,
    });
    if (String(data.paymentMethod).toLowerCase().includes("wallet"))
      await captureWalletPayment(client, {
        jobId: job.id,
        customerId: customer.id,
        amountCents: Math.round(quote.fare * 100),
        idempotencyKey,
        description: `Envío ${publicId}`,
        metadata: { publicId, kind: "shipment" },
      });
    const shipment = {
      id: publicId,
      customerId: customerPublicId,
      driverId: null,
      status,
      pickup: data.pickup,
      destination: data.destination,
      pickupLocation: data.pickupCoords,
      destinationLocation: data.destinationCoords,
      recipientName: data.recipientName,
      recipientPhone: data.recipientPhone,
      packageSize: data.packageSize,
      description: data.description,
      weightKg: data.weightKg,
      deliveryNotes: data.deliveryNotes || "",
      declaredValue: data.declaredValue || 0,
      protection: data.protection || "none",
      protectionPremium: quote.protectionPremium || 0,
      signatureRequired: Boolean(data.signatureRequired),
      itemCategory: data.itemCategory,
      serviceLevel: data.serviceLevel,
      handlingInstructions: quote.handlingInstructions,
      distanceKm: quote.distanceKm,
      etaMin: quote.etaMin,
      fare: quote.fare,
      quoteId: quote.quoteId || null,
      pricingVersion: quote.pricingVersion,
      fareBreakdown: quote.breakdown,
      paymentMethod: data.paymentMethod,
      deliveryPin,
      createdAt: new Date(job.created_at).toISOString(),
      timeline: [{ status: "requested", at: new Date().toISOString() }],
    };
    const idempotentShipment = { ...shipment };
    delete idempotentShipment.deliveryPin;
    await client.query(
      "UPDATE idempotency_keys SET response_status=200,response_body=$2 WHERE key=$1",
      [idempotencyKey, { shipment: idempotentShipment }],
    );
    await client.query("COMMIT");
    return shipment;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function setPostgresShipmentStatus(
  publicId,
  status,
  actorPublicId,
  driverPublicId = null,
) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const actor = (await client.query("SELECT id FROM users WHERE public_id=$1", [actorPublicId]))
      .rows[0];
    let driverId = null;
    if (driverPublicId)
      driverId =
        (
          await client.query("SELECT id FROM drivers WHERE public_id=$1 AND online", [
            driverPublicId,
          ])
        ).rows[0]?.id || null;
    const changed =
      driverPublicId && status === "driver_assigned"
        ? {
            rows: [
              await acceptDispatchOffer(client, {
                jobPublicId: publicId,
                driverPublicId,
                actorUserId: actor?.id || null,
                status: "driver_assigned",
              }),
            ],
          }
        : await client.query(
            `WITH changed AS (
              UPDATE jobs SET status = $1, driver_id = COALESCE($4, driver_id), version = version + 1,
                updated_at = now(),
                metadata = CASE WHEN $1::job_status = 'completed'
                  THEN jsonb_set(metadata, '{etaMin}', '0') ELSE metadata END
              WHERE public_id = $2 AND metadata->>'subtype' = 'shipment'
                AND status NOT IN ('completed', 'cancelled')
              RETURNING id, customer_id
            )
            INSERT INTO job_events (job_id, actor_id, status)
            SELECT id, $3, $1 FROM changed
            RETURNING job_id`,
            [shipmentDbStatus(status), publicId, actor?.id || null, driverId],
          );
    if (!changed.rows[0])
      throw Object.assign(new Error("El envío no puede cambiar de estado"), { status: 409 });
    const customer = (
      await client.query("SELECT customer_id FROM jobs WHERE public_id=$1", [publicId])
    ).rows[0];
    await enqueueNotificationForInternalUser(client, {
      userId: customer.customer_id,
      template: "shipment_status",
      payload: { kind: "shipment", jobId: publicId, status },
      deduplicationKey: `shipment:${publicId}:${status}`,
    });
    await client.query("COMMIT");
    return (await getPostgresShipments()).find((entry) => entry.id === publicId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
