// Cotización de comida (delivery + checkout) — ARC-001.
//
// Separada de crear/cobrar/avanzar el pedido: la ruta `/api/orders/quote` firma
// este precio y `createPostgresOrder` sólo lo valida. Así el ciclo de vida del
// pedido no arrastra el cálculo de distancia, promociones y suscripción.
import { postgresPool } from "./postgres.js";
import { getActiveSubscription, splitOrderDiscounts } from "./subscription-repository.js";
import { getPostgresPricingPlan } from "./pricing-repository.js";
import { pesos } from "./money.js";
import { config } from "./config.js";
import {
  requiresRoadRouting,
  resolveDrivingRoute,
  resolveQuoteDistanceKm,
} from "./maps-route-service.js";
import { resolveModifierSelection } from "./order-selection.js";

export async function getPostgresFoodDeliveryQuote({
  customerPublicId,
  merchantPublicId,
  deliveryAddressId,
  branchPublicId,
}) {
  const [plan, result] = await Promise.all([
    getPostgresPricingPlan("food"),
    postgresPool.query(
      `SELECT a.id address_id,a.formatted_address,a.geocoding_provider,a.provider_place_id,a.geocoded_at,ST_Y(a.location::geometry) lat,ST_X(a.location::geometry) lng,
    m.public_id merchant_id,b.public_id branch_id,ST_Y(b.location::geometry) branch_lat,ST_X(b.location::geometry) branch_lng,
    ST_Distance(b.location,a.location) air_distance_m,COALESCE(z.delivery_multiplier,1) zone_multiplier,z.public_id zone_id
    FROM users u JOIN addresses a ON a.user_id=u.id JOIN merchants m ON m.public_id=$2 AND m.status='active'
    JOIN merchant_branches b ON b.merchant_id=m.id AND b.status='active' AND b.open AND app.branch_is_scheduled_open(b.id,now()) AND (($4::text IS NULL AND b.is_primary) OR b.public_id=$4)
    LEFT JOIN LATERAL(SELECT public_id,delivery_multiplier FROM service_zones WHERE active AND ST_Covers(boundary::geometry,b.location::geometry) ORDER BY ST_Area(boundary) LIMIT 1) z ON true
    WHERE u.public_id=$1 AND u.status='active' AND a.id=$3 AND a.geocoded_at IS NOT NULL
      AND (NOT $5::boolean OR (a.geocoding_provider=$6 AND a.provider_place_id IS NOT NULL))`,
      [
        customerPublicId,
        merchantPublicId,
        deliveryAddressId,
        branchPublicId || null,
        config.isProduction,
        config.maps.provider,
      ],
    ),
  ]);
  const row = result.rows[0];
  if (!row)
    throw Object.assign(
      new Error("La dirección o el comercio no están disponibles para este cliente"),
      { status: 404 },
    );
  const planConfig = plan.config;
  const allowGeodesicFallback = !requiresRoadRouting();
  let roadDistanceKm = null;
  if (!allowGeodesicFallback) {
    const routeResult = await resolveDrivingRoute({
      fromLat: Number(row.branch_lat),
      fromLng: Number(row.branch_lng),
      toLat: Number(row.lat),
      toLng: Number(row.lng),
    });
    roadDistanceKm = routeResult.route.distanceKm;
  }
  const { distanceKm, distanceSource } = resolveQuoteDistanceKm({
    allowGeodesicFallback,
    airDistanceM: Number(row.air_distance_m),
    roadFactor: Number(planConfig.roadFactor),
    roadDistanceKm,
  });
  if (distanceKm > Number(planConfig.maximumDistanceKm))
    throw Object.assign(new Error("La dirección está fuera del radio máximo de entrega"), {
      status: 409,
    });
  const raw = Math.max(
    Number(planConfig.minimumDeliveryFee),
    Number(planConfig.baseDeliveryFee) + distanceKm * Number(planConfig.distancePerKm),
  );
  const deliveryFee = Math.round(
    Math.min(Number(planConfig.maximumDeliveryFee), raw * Number(row.zone_multiplier)),
  );
  return {
    customerId: customerPublicId,
    restaurantId: merchantPublicId,
    branchId: row.branch_id,
    deliveryAddressId: String(row.address_id),
    deliveryAddress: row.formatted_address,
    addressValidation: {
      provider: row.geocoding_provider,
      providerPlaceId: row.provider_place_id || null,
      validatedAt: row.geocoded_at.toISOString(),
    },
    destinationCoords: { lat: Number(row.lat), lng: Number(row.lng) },
    distanceKm: Number(distanceKm.toFixed(2)),
    distanceSource,
    deliveryFee,
    serviceFee: Number(planConfig.serviceFee),
    roadFactor: Number(planConfig.roadFactor),
    zoneId: row.zone_id || null,
    zoneMultiplier: Number(row.zone_multiplier),
    pricingVersion: plan.version,
    currency: plan.currency,
  };
}

export async function getPostgresFoodCheckoutQuote({
  customerPublicId,
  merchantPublicId,
  deliveryAddressId,
  branchPublicId,
  items,
  paymentMethod,
  paymentMethodId,
  promotionCode,
}) {
  const delivery = await getPostgresFoodDeliveryQuote({
    customerPublicId,
    merchantPublicId,
    deliveryAddressId,
    branchPublicId,
  });
  const client = await postgresPool.connect();
  try {
    const context = (
      await client.query(
        `SELECT u.id user_id, m.id merchant_id, b.id branch_id, b.eta_min
         FROM users u
         JOIN merchants m ON m.public_id = $2
         JOIN merchant_branches b ON b.merchant_id = m.id AND b.public_id = $3
         WHERE u.public_id = $1`,
        [customerPublicId, merchantPublicId, delivery.branchId],
      )
    ).rows[0];
    if (!context)
      throw Object.assign(new Error("No se pudo cotizar este comercio"), { status: 404 });
    if (paymentMethodId) {
      const method = (
        await client.query(
          `SELECT pm.kind,pm.brand,pm.last4 FROM payment_methods pm WHERE pm.id=$1 AND pm.user_id=$2 AND pm.revoked_at IS NULL`,
          [paymentMethodId, context.user_id],
        )
      ).rows[0];
      if (!method) throw Object.assign(new Error("Método de pago no disponible"), { status: 404 });
      paymentMethod =
        method.kind === "wallet"
          ? "Flash Wallet"
          : `${method.brand || method.kind} •••• ${method.last4 || ""}`.trim();
    }
    let subtotalCents = 0;
    const snapshot = [];
    for (const entry of items) {
      const item = (
        await client.query(
          `SELECT c.id, c.public_id, c.name, c.unit_price_cents
           FROM catalog_items c
           JOIN catalog_branch_inventory i ON i.catalog_item_id = c.id AND i.branch_id = $3
           WHERE c.public_id = $1 AND c.merchant_id = $2
             AND c.available AND i.available AND COALESCE(i.stock_quantity, 1) > 0`,
          [entry.menuItemId, context.merchant_id, context.branch_id],
        )
      ).rows[0];
      if (!item)
        throw Object.assign(new Error("Un producto ya no está disponible"), { status: 409 });
      const selection = await resolveModifierSelection(client, {
          catalogItemId: item.id,
          selectedIds: entry.extras || [],
        }),
        unitPriceCents = Number(item.unit_price_cents) + selection.priceCents;
      subtotalCents += unitPriceCents * entry.quantity;
      snapshot.push({
        menuItemId: item.public_id,
        name: item.name,
        quantity: entry.quantity,
        baseUnitPrice: pesos(item.unit_price_cents),
        unitPrice: pesos(unitPriceCents),
        modifiers: selection.modifiers,
        note: entry.note || "",
      });
    }
    const deliveryFeeCents = Math.round(Number(delivery.deliveryFee) * 100),
      serviceFeeCents = Math.round(Number(delivery.serviceFee) * 100);
    let promotion = null,
      discountCents = 0,
      subscriptionDiscountCents = 0;
    if (promotionCode) {
      promotion = (
        await client.query(
          `SELECT * FROM promotions WHERE code=$1 AND active AND now() BETWEEN starts_at AND ends_at`,
          [promotionCode.trim().toUpperCase()],
        )
      ).rows[0];
      if (!promotion)
        throw Object.assign(new Error("Promoción inválida o vencida"), { status: 409 });
      if (promotion.rules?.service && promotion.rules.service !== "food")
        throw Object.assign(new Error("La promoción no aplica a comida"), { status: 409 });
      if (subtotalCents < Number(promotion.min_subtotal_cents))
        throw Object.assign(new Error("No alcanzas el subtotal mínimo de la promoción"), {
          status: 409,
        });
      if (
        promotion.rules?.paymentMethod === "flash_wallet" &&
        !String(paymentMethod).toLowerCase().includes("wallet")
      )
        throw Object.assign(new Error("La promoción requiere Flash Wallet"), { status: 409 });
      const usage = (
        await client.query(
          `SELECT count(*)::int total,count(*) FILTER(WHERE user_id=$2)::int user_total FROM promotion_redemptions WHERE promotion_id=$1`,
          [promotion.id, context.user_id],
        )
      ).rows[0];
      if (promotion.usage_limit !== null && usage.total >= promotion.usage_limit)
        throw Object.assign(new Error("La promoción agotó su cupo"), { status: 409 });
      if (usage.user_total >= promotion.per_user_limit)
        throw Object.assign(new Error("Ya utilizaste esta promoción"), { status: 409 });
      if (promotion.kind === "percentage")
        discountCents = Math.round((subtotalCents * promotion.value) / 100);
      else if (promotion.kind === "fixed") discountCents = promotion.value;
      else if (promotion.kind === "free_delivery") discountCents = deliveryFeeCents;
      if (promotion.max_discount_cents !== null)
        discountCents = Math.min(discountCents, Number(promotion.max_discount_cents));
      discountCents = Math.min(discountCents, subtotalCents + deliveryFeeCents);
    }
    // El beneficio de la suscripcion se aplica ACA, antes de que la ruta firme
    // el token: `/api/orders/quote` firma lo calculado y la creacion del pedido
    // solo acepta ese precio. Un descuento aplicado despues no sobrevive.
    //
    // Va aparte de `discountCents` a proposito. La comision del comercio se
    // calcula sobre `subtotalCents - discountCents`: meter aca un envio que
    // regala Flash le bajaria la comision al comercio por un beneficio que no
    // financio, y ademas quedaria registrado como canje de promocion.
    const subscription = await getActiveSubscription(customerPublicId, client);
    ({ discountCents, subscriptionDiscountCents } = splitOrderDiscounts({
      subscription,
      subtotalCents,
      deliveryFeeCents,
      promotionKind: promotion?.kind || null,
      promotionDiscountCents: discountCents,
    }));
    const totalCents =
      subtotalCents +
      deliveryFeeCents +
      serviceFeeCents -
      discountCents -
      subscriptionDiscountCents;
    return {
      ...delivery,
      items: snapshot,
      subtotal: pesos(subtotalCents),
      discount: pesos(discountCents),
      subscriptionDiscount: pesos(subscriptionDiscountCents),
      subscriptionPlan: subscriptionDiscountCents > 0 ? subscription.planKey : null,
      promotionCode: promotion?.code || null,
      total: pesos(totalCents),
      etaMin:
        Number(context.eta_min) +
        Math.max(8, Math.ceil((Number(delivery.distanceKm) * 1000) / 350)),
      paymentMethod,
      paymentMethodId: paymentMethodId || null,
    };
  } finally {
    client.release();
  }
}
