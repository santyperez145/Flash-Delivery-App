// Alta del pedido de comida (ARC-001).
//
// Orquesta validación, idempotencia, persistencia del job y retención de
// propina. Precio autoritativo → `order-create-pricing.js`. Cobro wallet/MP →
// `order-create-checkout-payment.js`. Lecturas → `order-repository.js`.
// Avance/asignación → `order-lifecycle-repository.js`.
import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
import { holdCheckoutTip } from "./tip-repository.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";
import { pesos } from "./money.js";
import { config } from "./config.js";
import { resolveDrivingRoute } from "./maps-route-service.js";
import { buildCheckoutLineSnapshots, resolveCheckoutTotals } from "./order-create-pricing.js";
import { settleCheckoutPayment } from "./order-create-checkout-payment.js";

export async function createPostgresOrder({
  publicId,
  customerPublicId,
  merchantPublicId,
  deliveryAddressId,
  deliveryAddress,
  paymentMethod,
  paymentMethodId,
  providerPayment,
  promotionCode,
  items,
  serviceFee,
  lockedQuote,
  tipCents = 0,
  scheduledFor = null,
  idempotencyKey,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const customer = await client.query(
      "SELECT id FROM users WHERE public_id = $1 AND status = 'active'",
      [customerPublicId],
    );
    const merchant = await client.query(
      `SELECT m.*, b.id branch_id, b.public_id branch_public_id, b.address branch_address,
        b.location branch_location, b.eta_min branch_eta_min
       FROM merchants m
       JOIN merchant_branches b ON b.merchant_id = m.id AND b.public_id = $2
         AND b.status = 'active' AND b.open AND app.branch_is_scheduled_open(b.id, now())
       WHERE m.public_id = $1 AND m.status = 'active'`,
      [merchantPublicId, lockedQuote?.branchId],
    );
    if (!customer.rows[0]) throw Object.assign(new Error("Cliente no encontrado"), { status: 404 });
    if (!merchant.rows[0])
      throw Object.assign(new Error("Restaurante no disponible"), { status: 404 });
    if (paymentMethodId) {
      const method = (
        await client.query(
          "SELECT kind,brand,last4 FROM payment_methods WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL",
          [paymentMethodId, customer.rows[0].id],
        )
      ).rows[0];
      if (!method) throw Object.assign(new Error("Método de pago no disponible"), { status: 404 });
      const authoritativeLabel =
        method.kind === "wallet"
          ? "Flash Wallet"
          : `${method.brand || method.kind} •••• ${method.last4 || ""}`.trim();
      if (authoritativeLabel !== paymentMethod || lockedQuote.paymentMethodId !== paymentMethodId)
        throw Object.assign(new Error("El método de pago no coincide con la cotización"), {
          status: 409,
        });
    }
    if (!deliveryAddressId)
      throw Object.assign(new Error("Selecciona una dirección guardada con coordenadas reales"), {
        status: 400,
      });
    const address = (
      await client.query(
        `SELECT a.id,a.formatted_address,a.location,a.geocoding_provider,a.provider_place_id,a.geocoded_at,
        ST_Y(a.location::geometry) lat,ST_X(a.location::geometry) lng,
        ST_Y($3::geometry) branch_lat,ST_X($3::geometry) branch_lng,
        ST_Distance(a.location,$3::geography) distance_m
      FROM addresses a JOIN users u ON u.id=a.user_id WHERE a.id=$1 AND u.id=$2 AND a.geocoded_at IS NOT NULL
        AND (NOT $4::boolean OR (a.geocoding_provider=$5 AND a.provider_place_id IS NOT NULL))`,
        [
          deliveryAddressId,
          customer.rows[0].id,
          merchant.rows[0].branch_location,
          config.isProduction,
          config.maps.provider,
        ],
      )
    ).rows[0];
    if (!address)
      throw Object.assign(
        new Error("La dirección no pertenece al cliente o necesita volver a validarse"),
        { status: 404 },
      );
    deliveryAddress = address.formatted_address;
    if (
      lockedQuote?.addressValidation?.provider !== address.geocoding_provider ||
      lockedQuote?.addressValidation?.providerPlaceId !== (address.provider_place_id || null) ||
      lockedQuote?.addressValidation?.validatedAt !== address.geocoded_at.toISOString()
    )
      throw Object.assign(new Error("La dirección cambió; actualiza la cotización"), {
        status: 409,
      });
    let currentDistanceKm;
    if (lockedQuote?.distanceSource === "road") {
      const routeResult = await resolveDrivingRoute({
        fromLat: Number(address.branch_lat),
        fromLng: Number(address.branch_lng),
        toLat: Number(address.lat),
        toLng: Number(address.lng),
      });
      currentDistanceKm = routeResult.route.distanceKm;
    } else {
      currentDistanceKm =
        (Number(address.distance_m) / 1000) * Number(lockedQuote?.roadFactor || 1);
    }
    if (!lockedQuote || Math.abs(currentDistanceKm - Number(lockedQuote.distanceKm)) > 0.1)
      throw Object.assign(new Error("La ruta cambió; actualiza la cotización"), { status: 409 });
    const walletPayment = String(paymentMethod).toLowerCase().includes("wallet");
    if (!walletPayment && !providerPayment)
      throw Object.assign(
        new Error("El pago debe tokenizarse con Mercado Pago antes de confirmar"),
        { status: 402 },
      );
    const requestHash = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          customerPublicId,
          merchantPublicId,
          deliveryAddressId,
          deliveryAddress,
          paymentMethod,
          paymentMethodId: paymentMethodId || null,
          providerPayment: providerPayment
            ? {
                paymentMethodId: providerPayment.paymentMethodId,
                installments: providerPayment.installments,
              }
            : null,
          promotionCode: promotionCode || null,
          items,
          quoteId: lockedQuote.quoteId,
        }),
      )
      .digest("hex");
    const claimed = await client.query(
      `INSERT INTO idempotency_keys(key, user_id, request_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '24 hours')
       ON CONFLICT (key) DO NOTHING RETURNING key`,
      [idempotencyKey, customer.rows[0].id, requestHash],
    );
    if (!claimed.rows[0]) {
      const existing = await client.query(
        "SELECT request_hash, response_body FROM idempotency_keys WHERE key = $1",
        [idempotencyKey],
      );
      if (existing.rows[0]?.request_hash !== requestHash) {
        throw Object.assign(new Error("La clave de idempotencia ya fue usada con otra solicitud"), {
          status: 409,
        });
      }
      if (existing.rows[0]?.response_body?.order) {
        await client.query("ROLLBACK");
        return existing.rows[0].response_body.order;
      }
      throw Object.assign(new Error("La solicitud con esta clave todavía está procesándose"), {
        status: 409,
      });
    }
    const snapshots = await buildCheckoutLineSnapshots(client, {
      items,
      merchantId: merchant.rows[0].id,
      branchId: merchant.rows[0].branch_id,
    });
    const {
      promotion,
      subscription,
      subtotalCents,
      deliveryFeeCents,
      serviceFeeCents,
      discountCents,
      subscriptionDiscountCents,
      totalCents,
      chargedCents,
    } = await resolveCheckoutTotals(client, {
      snapshots,
      lockedQuote,
      serviceFee,
      promotionCode,
      paymentMethod,
      customerId: customer.rows[0].id,
      customerPublicId,
      tipCents,
    });
    const travelMinutes = Math.max(8, Math.ceil(Number(address.distance_m) / 350));
    const metadata = {
      subtype: "food_order",
      subtotal: pesos(subtotalCents),
      deliveryFee: pesos(deliveryFeeCents),
      serviceFee,
      discount: pesos(discountCents),
      subscriptionDiscount: pesos(subscriptionDiscountCents),
      subscriptionPlan: subscriptionDiscountCents > 0 ? subscription.planKey : null,
      // Lo cobrado al cliente es `total + tip`. Guardar la propina aca es lo que
      // despues le permite a la liquidacion repartir sobre el total sin ella.
      tip: pesos(tipCents),
      scheduledFor: scheduledFor || null,
      promotionCode: promotion?.code || null,
      etaMin: merchant.rows[0].branch_eta_min + travelMinutes,
      locationEstimated: false,
      deliveryAddressId: String(address.id),
      quoteId: lockedQuote.quoteId,
      pricingVersion: lockedQuote.pricingVersion,
      quotedDistanceKm: lockedQuote.distanceKm,
      zoneId: lockedQuote.zoneId,
      zoneMultiplier: lockedQuote.zoneMultiplier,
    };
    const initialStatus = walletPayment ? "accepted" : "requested";
    const job = await client.query(
      // `merchant_ready_due_at` cuenta desde el horario reservado, no desde
      // ahora: un pedido para mañana con vencimiento de cocina para dentro de 20
      // minutos aparece atrasado apenas se crea, y ensucia la métrica de
      // demoras del comercio con trabajo que todavía no le toca hacer.
      `INSERT INTO jobs(public_id, kind, customer_id, merchant_id, branch_id, status, pickup_address, pickup_location,
        dropoff_address, dropoff_location, service_level, quoted_amount_cents, final_amount_cents,
        distance_m, estimated_duration_s, payment_method_label, metadata, merchant_prep_minutes,
        scheduled_for, merchant_ready_due_at)
       VALUES ($1, 'delivery', $2, $3, $4, $14, $5, $6, $7, $8, 'food', $9, $9, $10, $11, $12, $13, $15::smallint,
         $16::timestamptz,
         CASE WHEN $14::job_status='accepted'
           THEN COALESCE($16::timestamptz, now()) + make_interval(mins=>$15::integer)
           ELSE NULL END)
       RETURNING id,
         ST_Y(pickup_location::geometry) AS pickup_lat,
         ST_X(pickup_location::geometry) AS pickup_lng,
         ST_Y(dropoff_location::geometry) AS dropoff_lat,
         ST_X(dropoff_location::geometry) AS dropoff_lng`,
      [
        publicId,
        customer.rows[0].id,
        merchant.rows[0].id,
        merchant.rows[0].branch_id,
        merchant.rows[0].branch_address,
        merchant.rows[0].branch_location,
        deliveryAddress,
        address.location,
        totalCents,
        Math.round(Number(address.distance_m)),
        metadata.etaMin * 60,
        paymentMethod,
        metadata,
        initialStatus,
        Number(merchant.rows[0].branch_eta_min),
        scheduledFor,
      ],
    );
    for (const { entry, item, selection, unitPriceCents } of snapshots) {
      await client.query(
        `INSERT INTO job_items(job_id, catalog_item_id, name, quantity, unit_price_cents, customer_note, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          job.rows[0].id,
          item.id,
          item.name,
          entry.quantity,
          unitPriceCents,
          entry.note || null,
          {
            publicId: item.public_id,
            extras: selection.modifiers.map((modifier) => modifier.name),
            modifiers: selection.modifiers,
            baseUnitPrice: pesos(item.unit_price_cents),
          },
        ],
      );
    }
    if (promotion)
      await client.query(
        `INSERT INTO promotion_redemptions(promotion_id,user_id,job_id,discount_cents) VALUES($1,$2,$3,$4)`,
        [promotion.id, customer.rows[0].id, job.rows[0].id, discountCents],
      );
    const paymentStatus = await settleCheckoutPayment(client, {
      walletPayment,
      customerId: customer.rows[0].id,
      jobId: job.rows[0].id,
      publicId,
      chargedCents,
      subtotalCents,
      discountCents,
      deliveryFeeCents,
      subscriptionDiscountCents,
      serviceFeeCents,
      tipCents,
      commissionBps: merchant.rows[0].commission_bps,
      idempotencyKey,
      providerPayment,
    });
    // Retenida, no pagada: en el checkout todavia no hay conductor asignado. Se
    // libera al liquidar el pedido completado, y si el pedido nunca llega a
    // completarse vuelve con el reintegro.
    await holdCheckoutTip(client, {
      jobId: job.rows[0].id,
      customerId: customer.rows[0].id,
      amountCents: tipCents,
      idempotencyKey,
    });
    await client.query("INSERT INTO job_events(job_id, actor_id, status) VALUES ($1, $2, $3)", [
      job.rows[0].id,
      customer.rows[0].id,
      initialStatus,
    ]);
    if (walletPayment)
      await enqueueNotificationForInternalUser(client, {
        userId: customer.rows[0].id,
        template: "order_status",
        payload: { kind: "food_order", jobId: publicId, status: "accepted" },
        deduplicationKey: `food_order:${publicId}:accepted`,
      });
    const responseOrder = {
      id: publicId,
      customerId: customerPublicId,
      restaurantId: merchantPublicId,
      courierId: null,
      status: initialStatus,
      deliveryAddress,
      paymentMethod,
      pickupLocation: { lat: Number(job.rows[0].pickup_lat), lng: Number(job.rows[0].pickup_lng) },
      deliveryLocation: {
        lat: Number(job.rows[0].dropoff_lat),
        lng: Number(job.rows[0].dropoff_lng),
      },
      items: snapshots.map(({ entry, item, selection, unitPriceCents }) => ({
        menuItemId: item.public_id,
        name: item.name,
        quantity: entry.quantity,
        unitPrice: pesos(unitPriceCents),
        extras: selection.modifiers.map((modifier) => modifier.name),
        modifiers: selection.modifiers,
        note: entry.note || "",
      })),
      subtotal: metadata.subtotal,
      deliveryFee: metadata.deliveryFee,
      serviceFee,
      discount: metadata.discount,
      promotionCode: metadata.promotionCode,
      total: pesos(totalCents),
      etaMin: metadata.etaMin,
      createdAt: new Date().toISOString(),
      timeline: [{ status: initialStatus, at: new Date().toISOString() }],
      paymentStatus,
    };
    await client.query(
      "UPDATE idempotency_keys SET response_status = 200, response_body = $2 WHERE key = $1",
      [idempotencyKey, { order: responseOrder }],
    );
    await client.query("COMMIT");
    return responseOrder;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
