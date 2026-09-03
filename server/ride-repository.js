// Viajes (rides): listar, crear y avanzar estado (ARC-001).
//
// Separado de envíos (`mobility-repository.js` / shipments) porque el ciclo del
// pasajero —PIN de abordaje, wallet, ofertas de dispatch modo ride— no comparte
// dueño de dato con POD, claims ni protección de paquetes.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { postgresPool } from "./postgres.js";
import { captureWalletPayment } from "./wallet-repository.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";
import { acceptDispatchOffer, createDispatchOffers } from "./dispatch-repository.js";
import { deriveRidePickupPin } from "./secret-envelope.js";
import { pesos } from "./money.js";

export async function getPostgresRides() {
  const result = await postgresPool.query(`
    SELECT j.*, customer.public_id customer_public_id, driver.public_id driver_public_id,
      ST_Y(j.pickup_location::geometry) pickup_lat, ST_X(j.pickup_location::geometry) pickup_lng,
      ST_Y(j.dropoff_location::geometry) dropoff_lat, ST_X(j.dropoff_location::geometry) dropoff_lng,
      (SELECT jsonb_build_object(
        'id', c.public_id, 'reason', c.reason_code,
        'refundAmount', c.refund_amount_cents / 100.0, 'fee', c.cancellation_fee_cents / 100.0,
        'createdAt', c.created_at
      ) FROM job_cancellations c WHERE c.job_id = j.id) cancellation,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('status',je.status::text,'at',je.occurred_at) ORDER BY je.occurred_at)
        FROM job_events je WHERE je.job_id=j.id),'[]') timeline
    FROM jobs j JOIN users customer ON customer.id=j.customer_id
    LEFT JOIN drivers driver ON driver.id=j.driver_id WHERE j.kind='ride' ORDER BY j.created_at DESC`);
  return result.rows.map((row) => ({
    id: row.public_id,
    customerId: row.customer_public_id,
    driverId: row.driver_public_id || null,
    status: row.status,
    service: row.service_level,
    pickup: row.pickup_address,
    destination: row.dropoff_address,
    pickupLocation: { lat: Number(row.pickup_lat), lng: Number(row.pickup_lng) },
    destinationLocation: { lat: Number(row.dropoff_lat), lng: Number(row.dropoff_lng) },
    distanceKm: Number((row.distance_m / 1000).toFixed(1)),
    etaMin: Number(row.metadata?.etaMin || 0),
    durationMin: Math.round(row.estimated_duration_s / 60),
    fare: pesos(row.final_amount_cents ?? row.quoted_amount_cents),
    paymentMethod: row.payment_method_label || "",
    scheduledFor: row.scheduled_for ? new Date(row.scheduled_for).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    timeline: row.timeline || [],
    cancellation: row.cancellation || null,
  }));
}

export async function createPostgresRide({
  publicId,
  customerPublicId,
  pickup,
  destination,
  service,
  pickupCoords,
  destinationCoords,
  quote,
  paymentMethod,
  idempotencyKey,
  scheduledFor = null,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const customer = (
      await client.query("SELECT id FROM users WHERE public_id=$1", [customerPublicId])
    ).rows[0];
    if (!customer) throw Object.assign(new Error("Cliente no encontrado"), { status: 404 });
    if (!pickupCoords || !destinationCoords)
      throw Object.assign(new Error("Origen y destino deben tener coordenadas reales"), {
        status: 400,
      });
    const hash = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          customerPublicId,
          pickup,
          destination,
          service,
          pickupCoords,
          destinationCoords,
          quote: quote.fare,
          paymentMethod,
          scheduledFor,
        }),
      )
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
      if (old?.response_body?.ride) {
        await client.query("ROLLBACK");
        return old.response_body.ride;
      }
      throw Object.assign(new Error("Solicitud en proceso"), { status: 409 });
    }
    const status = "requested";
    const inserted = await client.query(
      `INSERT INTO jobs(public_id,kind,customer_id,driver_id,status,pickup_address,pickup_location,dropoff_address,dropoff_location,
      service_level,quoted_amount_cents,final_amount_cents,distance_m,estimated_duration_s,payment_method_label,scheduled_for,metadata)
      VALUES($1,'ride',$2,$3,$4,$5,ST_SetSRID(ST_MakePoint($6,$7),4326)::geography,$8,ST_SetSRID(ST_MakePoint($9,$10),4326)::geography,$11,$12,$12,$13,$14,$15,$16,$17) RETURNING id,created_at`,
      [
        publicId,
        customer.id,
        null,
        status,
        pickup,
        pickupCoords.lng,
        pickupCoords.lat,
        destination,
        destinationCoords.lng,
        destinationCoords.lat,
        service,
        Math.round(quote.fare * 100),
        Math.round(quote.distanceKm * 1000),
        quote.durationMin * 60,
        paymentMethod,
        scheduledFor,
        {
          etaMin: quote.etaMin,
          subtype: "passenger_ride",
          zoneId: quote.zoneId || null,
          demandMultiplier: quote.breakdown?.demandMultiplier || 1,
          fareBreakdown: quote.breakdown || {},
        },
      ],
    );
    await client.query("INSERT INTO job_events(job_id,actor_id,status) VALUES($1,$2,'requested')", [
      inserted.rows[0].id,
      customer.id,
    ]);
    await client.query("INSERT INTO ride_pickup_verifications(job_id,pin_hash) VALUES($1,$2)", [
      inserted.rows[0].id,
      await bcrypt.hash(deriveRidePickupPin(publicId), 10),
    ]);
    const scheduledDate = scheduledFor ? new Date(scheduledFor) : null;
    if (!scheduledDate || scheduledDate.getTime() <= Date.now() + 15 * 60 * 1000)
      await createDispatchOffers(client, { jobId: inserted.rows[0].id, mode: "ride" });
    await enqueueNotificationForInternalUser(client, {
      userId: customer.id,
      template: scheduledDate ? "ride_scheduled" : "ride_status",
      payload: { kind: "ride", jobId: publicId, status, scheduledFor: scheduledFor || null },
      deduplicationKey: `ride:${publicId}:${status}`,
    });
    if (scheduledDate)
      await enqueueNotificationForInternalUser(client, {
        userId: customer.id,
        template: "ride_reminder",
        payload: { kind: "ride", jobId: publicId, scheduledFor },
        deduplicationKey: `ride:${publicId}:reminder`,
        scheduledAt: new Date(scheduledDate.getTime() - 30 * 60 * 1000),
      });
    if (String(paymentMethod).toLowerCase().includes("wallet"))
      await captureWalletPayment(client, {
        jobId: inserted.rows[0].id,
        customerId: customer.id,
        amountCents: Math.round(quote.fare * 100),
        idempotencyKey,
        description: `Viaje ${publicId}`,
        metadata: { publicId, kind: "ride" },
      });
    const ride = {
      id: publicId,
      customerId: customerPublicId,
      driverId: null,
      status,
      service,
      pickup,
      destination,
      pickupLocation: pickupCoords,
      destinationLocation: destinationCoords,
      distanceKm: quote.distanceKm,
      etaMin: quote.etaMin,
      durationMin: quote.durationMin,
      fare: quote.fare,
      paymentMethod,
      scheduledFor: scheduledFor || null,
      createdAt: new Date(inserted.rows[0].created_at).toISOString(),
      timeline: [{ status: "requested", at: new Date().toISOString() }],
    };
    await client.query(
      "UPDATE idempotency_keys SET response_status=200,response_body=$2 WHERE key=$1",
      [idempotencyKey, { ride }],
    );
    await client.query("COMMIT");
    return ride;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function setPostgresRideStatus(
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
    if (status === "in_progress") {
      const verification = (
        await client.query(
          `SELECT v.verified_at, v.job_id IS NOT NULL verification_required, j.created_at,
            (SELECT applied_at FROM schema_migrations
             WHERE version = '073_ride_pickup_verification.sql') rollout_at
           FROM jobs j
           LEFT JOIN ride_pickup_verifications v ON v.job_id = j.id
           WHERE j.public_id = $1 AND j.kind = 'ride'
           FOR UPDATE OF j`,
          [publicId],
        )
      ).rows[0];
      const postRollout =
        verification?.rollout_at &&
        new Date(verification.created_at) >= new Date(verification.rollout_at);
      if ((verification?.verification_required || postRollout) && !verification?.verified_at)
        throw Object.assign(new Error("Verifica el PIN del pasajero antes de iniciar el viaje"), {
          status: 409,
        });
    }
    let driverId = null;
    if (driverPublicId)
      driverId =
        (
          await client.query("SELECT id FROM drivers WHERE public_id=$1 AND online", [
            driverPublicId,
          ])
        ).rows[0]?.id || null;
    const result =
      driverPublicId && status === "driver_assigned"
        ? {
            rows: [
              await acceptDispatchOffer(client, {
                jobPublicId: publicId,
                driverPublicId,
                actorUserId: actor?.id || null,
                status,
              }),
            ],
          }
        : await client.query(
            `WITH changed AS (
              UPDATE jobs SET status = $1, driver_id = COALESCE($4, driver_id), version = version + 1,
                updated_at = now(),
                metadata = CASE WHEN $1::job_status = 'completed'
                  THEN jsonb_set(metadata, '{etaMin}', '0') ELSE metadata END
              WHERE public_id = $2 AND kind = 'ride'
                AND status NOT IN ('completed', 'cancelled')
              RETURNING id, customer_id
            )
            INSERT INTO job_events (job_id, actor_id, status)
            SELECT id, $3, $1 FROM changed
            RETURNING job_id`,
            [status, publicId, actor?.id || null, driverId],
          );
    if (!result.rows[0])
      throw Object.assign(new Error("El viaje no puede cambiar de estado"), { status: 409 });
    const customer = (
      await client.query("SELECT customer_id FROM jobs WHERE public_id=$1", [publicId])
    ).rows[0];
    await enqueueNotificationForInternalUser(client, {
      userId: customer.customer_id,
      template: "ride_status",
      payload: { kind: "ride", jobId: publicId, status },
      deduplicationKey: `ride:${publicId}:${status}`,
    });
    await client.query("COMMIT");
    return (await getPostgresRides()).find((ride) => ride.id === publicId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
