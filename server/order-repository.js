// El ciclo del pedido: crear, cobrar y avanzar (ticket ARC-001).
//
// Cotización → `order-quote-repository.js`. Cobro MP → `order-marketplace-payment-repository.js`.
// Carrito/reorder → `cart-repository.js`.
// Selección de agregados → `order-selection.js`.
//
// `apiStatus`/`databaseStatus` traducen entre los estados que guarda la base
// (`driver_assigned`, `completed`) y los que expone la API (`courier_assigned`,
// `delivered`). Son un par: cada entrada de una es la inversa de la otra, y por
// eso viven juntas al principio del archivo.
import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
import { getActiveSubscription, splitOrderDiscounts } from "./subscription-repository.js";
import { CHECKOUT_TIP_MIN_CENTS, checkoutTipMaxCents, holdCheckoutTip } from "./tip-repository.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";
import { acceptDispatchOffer, createDispatchOffers } from "./dispatch-repository.js";
import { settleCapturedFoodOrder } from "./merchant-finance-repository.js";
import { pesos } from "./money.js";
import { marketplacePaymentKey } from "./order-marketplace-payment-repository.js";
import { config } from "./config.js";
import { resolveDrivingRoute } from "./maps-route-service.js";
import { resolveModifierSelection } from "./order-selection.js";
const apiStatus = (status) =>
  ({ driver_assigned: "courier_assigned", completed: "delivered" })[status] || status;
const databaseStatus = (status) =>
  ({ courier_assigned: "driver_assigned", delivered: "completed" })[status] || status;

function rowsToOrders(rows) {
  const orders = new Map();
  for (const row of rows) {
    if (!orders.has(row.public_id)) {
      const metadata = row.job_metadata || {};
      orders.set(row.public_id, {
        id: row.public_id,
        customerId: row.customer_public_id,
        restaurantId: row.merchant_public_id,
        branchId: row.branch_public_id || null,
        courierId: row.driver_public_id || null,
        status: apiStatus(row.status),
        deliveryAddress: row.dropoff_address,
        pickupLocation: { lat: Number(row.pickup_lat), lng: Number(row.pickup_lng) },
        deliveryLocation: { lat: Number(row.dropoff_lat), lng: Number(row.dropoff_lng) },
        paymentMethod: row.payment_method_label || "",
        items: [],
        subtotal: Number(metadata.subtotal || 0),
        deliveryFee: Number(metadata.deliveryFee || 0),
        serviceFee: Number(metadata.serviceFee || 0),
        discount: Number(metadata.discount || 0),
        subscriptionDiscount: Number(metadata.subscriptionDiscount || 0),
        tip: Number(metadata.tip || 0),
        promotionCode: metadata.promotionCode || null,
        // Se lee de la columna y no del metadata: reprogramar actualiza las dos,
        // pero la columna es la que manda para el despacho, y una pantalla que
        // mostrara el metadata podria prometer un horario que el despacho ignora.
        scheduledFor: row.scheduled_for ? new Date(row.scheduled_for).toISOString() : null,
        total: pesos(row.final_amount_cents ?? row.quoted_amount_cents),
        etaMin: Number(metadata.etaMin ?? Math.round(row.estimated_duration_s / 60)),
        createdAt: new Date(row.created_at).toISOString(),
        version: row.version,
        timeline: row.timeline || [],
        cancellation: row.cancellation || null,
      });
    }
    if (row.item_id) {
      const metadata = row.item_metadata || {};
      orders.get(row.public_id).items.push({
        menuItemId: metadata.publicId || row.catalog_public_id || row.item_id,
        name: row.item_name,
        quantity: row.quantity,
        unitPrice: pesos(row.unit_price_cents),
        extras: metadata.extras || [],
        note: row.customer_note || "",
      });
    }
  }
  return [...orders.values()];
}

export async function getPostgresOrders({ publicIds = null } = {}) {
  const result = await postgresPool.query(
    `
    SELECT j.*, j.metadata AS job_metadata, customer.public_id AS customer_public_id,
      ST_Y(j.pickup_location::geometry) pickup_lat,ST_X(j.pickup_location::geometry) pickup_lng,
      ST_Y(j.dropoff_location::geometry) dropoff_lat,ST_X(j.dropoff_location::geometry) dropoff_lng,
      merchant.public_id AS merchant_public_id, branch.public_id AS branch_public_id,
      driver.public_id AS driver_public_id,
      ji.id AS item_id, ji.name AS item_name, ji.quantity, ji.unit_price_cents,
      ji.customer_note, ji.metadata AS item_metadata, catalog.public_id AS catalog_public_id,
      (SELECT jsonb_build_object(
        'id', c.public_id, 'reason', c.reason_code,
        'refundAmount', c.refund_amount_cents / 100.0, 'fee', c.cancellation_fee_cents / 100.0,
        'createdAt', c.created_at
      ) FROM job_cancellations c WHERE c.job_id = j.id) cancellation,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('status',
        CASE WHEN je.status = 'driver_assigned' THEN 'courier_assigned'
             WHEN je.status = 'completed' THEN 'delivered' ELSE je.status::text END,
        'at', je.occurred_at) ORDER BY je.occurred_at) FROM job_events je WHERE je.job_id = j.id), '[]') AS timeline
    FROM jobs j
    JOIN users customer ON customer.id = j.customer_id
    JOIN merchants merchant ON merchant.id = j.merchant_id
    LEFT JOIN merchant_branches branch ON branch.id = j.branch_id
    LEFT JOIN drivers driver ON driver.id = j.driver_id
    LEFT JOIN job_items ji ON ji.job_id = j.id
    LEFT JOIN catalog_items catalog ON catalog.id = ji.catalog_item_id
    WHERE j.kind = 'delivery' AND j.metadata->>'subtype' = 'food_order'
      AND ($1::text[] IS NULL OR j.public_id=ANY($1::text[]))
    ORDER BY j.created_at DESC, ji.id
  `,
    [publicIds],
  );
  return rowsToOrders(result.rows);
}

export async function getPostgresMerchantActiveOrderPage({
  actorPublicId,
  merchantPublicId,
  admin = false,
  limit = 100,
}) {
  const selected = (
    await postgresPool.query(
      `SELECT m.id FROM merchants m JOIN users owner ON owner.id=m.owner_id WHERE m.status='active' AND m.public_id=$2 AND ($3::boolean OR owner.public_id=$1)`,
      [actorPublicId, merchantPublicId, admin],
    )
  ).rows[0];
  if (!selected)
    throw Object.assign(new Error("Comercio no encontrado o no autorizado"), { status: 404 });
  const page = await postgresPool.query(
    `SELECT j.public_id
     FROM jobs j
     WHERE j.merchant_id = $1 AND j.kind = 'delivery'
       AND j.metadata->>'subtype' = 'food_order'
       AND j.status = ANY($2::job_status[])
     ORDER BY CASE j.status
       WHEN 'accepted' THEN 0 WHEN 'preparing' THEN 1 WHEN 'ready_for_pickup' THEN 2
       WHEN 'driver_assigned' THEN 3 WHEN 'picked_up' THEN 4 WHEN 'delivering' THEN 5
       ELSE 6 END,
       j.merchant_ready_due_at NULLS LAST, j.created_at
     LIMIT $3`,
    [
      selected.id,
      ["accepted", "preparing", "ready_for_pickup", "driver_assigned", "picked_up", "delivering"],
      limit + 1,
    ],
  );
  const hasMore = page.rows.length > limit,
    publicIds = page.rows.slice(0, limit).map((row) => row.public_id),
    orders = await getPostgresOrders({ publicIds }),
    byId = new Map(orders.map((order) => [order.id, order]));
  return {
    generatedAt: new Date().toISOString(),
    source: "postgres-live-operations",
    orders: publicIds.map((id) => byId.get(id)).filter(Boolean),
    hasMore,
  };
}

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
    const snapshots = [];
    for (const entry of items) {
      const item = await client.query(
        `SELECT c.*
         FROM catalog_items c
         JOIN catalog_branch_inventory i ON i.catalog_item_id = c.id AND i.branch_id = $3
         WHERE c.public_id = $1 AND c.merchant_id = $2
           AND c.available AND i.available AND COALESCE(i.stock_quantity, 1) > 0
         FOR SHARE OF c, i`,
        [entry.menuItemId, merchant.rows[0].id, merchant.rows[0].branch_id],
      );
      if (!item.rows[0]) throw Object.assign(new Error("Producto no disponible"), { status: 409 });
      const selection = await resolveModifierSelection(client, {
        catalogItemId: item.rows[0].id,
        selectedIds: entry.extras || [],
      });
      snapshots.push({
        entry,
        item: item.rows[0],
        selection,
        unitPriceCents: Number(item.rows[0].unit_price_cents) + selection.priceCents,
      });
    }
    const subtotalCents = snapshots.reduce(
      (sum, { entry, unitPriceCents }) => sum + unitPriceCents * entry.quantity,
      0,
    );
    const deliveryFeeCents = Math.round(Number(lockedQuote.deliveryFee) * 100);
    const serviceFeeCents = Math.round(serviceFee * 100);
    let promotion = null,
      discountCents = 0,
      subscriptionDiscountCents = 0;
    if (promotionCode) {
      promotion = (
        await client.query(
          `SELECT * FROM promotions WHERE code=$1 AND active AND now() BETWEEN starts_at AND ends_at FOR UPDATE`,
          [promotionCode],
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
          [promotion.id, customer.rows[0].id],
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
      else if (promotion.kind === "wallet_credit") discountCents = 0;
      if (promotion.max_discount_cents !== null)
        discountCents = Math.min(discountCents, Number(promotion.max_discount_cents));
      discountCents = Math.min(discountCents, subtotalCents + deliveryFeeCents);
    }
    // Se relee dentro de la transaccion, no se toma del token: el token dice lo
    // que se prometio y esto dice lo que corresponde ahora. Si alguien firmara
    // un token con un beneficio que no le toca, la comparacion de abajo lo
    // rechaza en vez de aplicarlo.
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
    if (
      lockedQuote.total !== undefined &&
      (Math.round(Number(lockedQuote.subtotal) * 100) !== subtotalCents ||
        Math.round(Number(lockedQuote.discount || 0) * 100) !== discountCents ||
        // Se compara aparte y no solo por el total. Dos errores que se cancelan
        // —una promocion que crece justo lo que el beneficio deja de aplicar—
        // darian el mismo total y pasarian el control cobrando mal el desglose.
        Math.round(Number(lockedQuote.subscriptionDiscount || 0) * 100) !==
          subscriptionDiscountCents ||
        Math.round(Number(lockedQuote.total) * 100) !== totalCents ||
        String(lockedQuote.paymentMethod) !== String(paymentMethod) ||
        String(lockedQuote.promotionCode || "") !== String(promotion?.code || ""))
    )
      throw Object.assign(
        new Error("El precio final cambió; revisa y acepta una nueva cotización"),
        { status: 409 },
      );
    // La propina no viaja en la cotizacion firmada a proposito: cambiarla no
    // deberia obligar a recotizar el pedido entero, y no hay nada que proteger
    // firmandola — es plata del cliente hacia el repartidor, no un precio que el
    // cliente pueda bajar. Lo que si se valida es que este dentro de los topes,
    // que es lo que atrapa un error de tipeo de tres ceros de mas.
    if (tipCents) {
      const topeDePropina = checkoutTipMaxCents(totalCents);
      if (tipCents < CHECKOUT_TIP_MIN_CENTS)
        throw Object.assign(
          new Error(`La propina mínima es $${(CHECKOUT_TIP_MIN_CENTS / 100).toFixed(0)}`),
          { status: 409 },
        );
      if (tipCents > topeDePropina)
        throw Object.assign(
          new Error(`La propina máxima para este pedido es $${(topeDePropina / 100).toFixed(0)}`),
          { status: 409 },
        );
    }
    // **Un solo cargo, no dos.** La propina se cobra junto con el pedido; lo que
    // se reparte sigue siendo `totalCents`, porque la propina no es del comercio
    // ni de la plataforma.
    const chargedCents = totalCents + tipCents;
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
    let paymentStatus = "pending";
    if (walletPayment) {
      const walletAccount = await client.query(
        `SELECT id FROM ledger_accounts WHERE owner_type='user' AND owner_id=$1 AND currency='ARS' AND account_type='wallet' FOR UPDATE`,
        [customer.rows[0].id],
      );
      const walletBalance = walletAccount.rows[0]
        ? await client.query(
            `SELECT COALESCE(sum(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END),0)::bigint AS balance FROM ledger_entries WHERE account_id=$1`,
            [walletAccount.rows[0].id],
          )
        : { rows: [] };
      // Contra `chargedCents` y no contra el total: si el saldo alcanza para el
      // pedido pero no para la propina, el cobro fallaria a mitad de camino.
      if (!walletAccount.rows[0] || Number(walletBalance.rows[0]?.balance || 0) < chargedCents) {
        throw Object.assign(new Error("Saldo insuficiente en Flash Wallet"), { status: 402 });
      }
      const clearing =
        await client.query(`INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type)
        VALUES('platform',NULL,'ARS','cash_clearing') ON CONFLICT(owner_type,currency,account_type) WHERE owner_id IS NULL
        DO UPDATE SET owner_type=EXCLUDED.owner_type RETURNING id`);
      const paymentTransaction = await client.query(
        `INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description,metadata)
         VALUES($1,'payment',$2,$3,$4) RETURNING id`,
        [
          `payment-${idempotencyKey}`,
          customer.rows[0].id,
          `Pago pedido ${publicId}`,
          { jobPublicId: publicId },
        ],
      );
      await client.query(
        `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES
        ($1,$2,'debit',$4,'food_order',$3,$5),($1,$6,'credit',$4,'food_order',$3,$5)`,
        [
          paymentTransaction.rows[0].id,
          walletAccount.rows[0].id,
          job.rows[0].id,
          chargedCents,
          { jobPublicId: publicId },
          clearing.rows[0].id,
        ],
      );
      await client.query(
        `INSERT INTO payment_intents(job_id,customer_id,provider,status,amount_cents,captured_amount_cents,currency,idempotency_key,provider_payload)
        VALUES($1,$2,'flash_wallet','captured',$3,$3,'ARS',$4,$5)`,
        [
          job.rows[0].id,
          customer.rows[0].id,
          chargedCents,
          `payment-${idempotencyKey}`,
          { ledgerTransactionId: paymentTransaction.rows[0].id },
        ],
      );
      paymentStatus = "captured";
    } else {
      const merchantCommissionCents = Math.round(
          (Math.max(0, subtotalCents - discountCents) * Number(merchant.rows[0].commission_bps)) /
            10000,
        ),
        // El envio que regala la suscripcion sale del margen de Flash, no del
        // comercio: se descuenta de la comision de aplicacion y no de lo que se
        // le liquida. Sumarlo entero aca le cobraria al comercio un beneficio
        // que no vendio ni financio.
        // `+ tipCents`: con split de marketplace el comercio recibe lo cobrado
        // menos la comision de aplicacion. Sin sumar la propina ahi, la propina
        // del repartidor terminaria en la cuenta del comercio.
        applicationFeeCents =
          deliveryFeeCents -
          subscriptionDiscountCents +
          serviceFeeCents +
          merchantCommissionCents +
          tipCents;
      if (applicationFeeCents >= chargedCents)
        throw Object.assign(new Error("La comisión configurada no permite procesar este pedido"), {
          status: 409,
        });
      await client.query(
        `INSERT INTO payment_intents(
          job_id, customer_id, provider, status, amount_cents, captured_amount_cents,
          currency, idempotency_key, provider_payload
        ) VALUES ($1, $2, 'mercadopago', 'requires_confirmation', $3, 0, 'ARS', $4, $5)`,
        [
          job.rows[0].id,
          customer.rows[0].id,
          chargedCents,
          marketplacePaymentKey(idempotencyKey),
          {
            applicationFeeCents,
            paymentMethodId: providerPayment.paymentMethodId,
            installments: providerPayment.installments,
          },
        ],
      );
      paymentStatus = "requires_confirmation";
    }
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

export async function assignPostgresOrderDriver(orderPublicId, driverPublicId, actorPublicId) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const actor = await client.query("SELECT id FROM users WHERE public_id = $1", [actorPublicId]);
    const job = await acceptDispatchOffer(client, {
      jobPublicId: orderPublicId,
      driverPublicId,
      actorUserId: actor.rows[0]?.id || null,
    });
    const customer = { customer_id: job.customer_id };
    await enqueueNotificationForInternalUser(client, {
      userId: customer.customer_id,
      template: "order_status",
      payload: { kind: "food_order", jobId: orderPublicId, status: "driver_assigned" },
      deduplicationKey: `food_order:${orderPublicId}:driver_assigned`,
    });
    await client.query("COMMIT");
    return (await getPostgresOrders()).find((order) => order.id === orderPublicId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function setPostgresOrderStatus(orderPublicId, status, actorPublicId) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const actor = await client.query("SELECT id FROM users WHERE public_id = $1", [actorPublicId]);
    const databaseTarget = databaseStatus(status),
      expectedStatus = {
        preparing: "accepted",
        ready_for_pickup: "preparing",
        picked_up: "driver_assigned",
        delivering: "picked_up",
        completed: "delivering",
      }[databaseTarget];
    if (!expectedStatus)
      throw Object.assign(new Error("Transición de pedido no permitida"), { status: 409 });
    const result = await client.query(
      `WITH changed AS (
      UPDATE jobs SET status = $1, version = version + 1, updated_at = now(),
        metadata = CASE WHEN $1::job_status = 'completed' THEN jsonb_set(metadata, '{etaMin}', '0') ELSE metadata END
      WHERE public_id = $2 AND kind = 'delivery' AND status = $4::job_status
        AND NOT (metadata ? 'refundPending')
        AND NOT EXISTS(SELECT 1 FROM order_item_substitutions s WHERE s.job_id=jobs.id AND s.status='pending') RETURNING id,customer_id
    ) INSERT INTO job_events(job_id, actor_id, status) SELECT id, $3, $1 FROM changed RETURNING job_id`,
      [databaseTarget, orderPublicId, actor.rows[0]?.id || null, expectedStatus],
    );
    if (!result.rows[0])
      throw Object.assign(new Error("El pedido no puede cambiar de estado"), { status: 409 });
    const customer = (
      await client.query("SELECT customer_id FROM jobs WHERE public_id=$1", [orderPublicId])
    ).rows[0];
    if (databaseTarget === "ready_for_pickup")
      await createDispatchOffers(client, { jobId: result.rows[0].job_id, mode: "delivery" });
    if (databaseTarget === "completed")
      await settleCapturedFoodOrder(client, {
        jobId: result.rows[0].job_id,
        actorId: actor.rows[0]?.id || null,
      });
    await enqueueNotificationForInternalUser(client, {
      userId: customer.customer_id,
      template: "order_status",
      payload: { kind: "food_order", jobId: orderPublicId, status },
      deduplicationKey: `food_order:${orderPublicId}:${status}`,
    });
    await client.query("COMMIT");
    return (await getPostgresOrders()).find((order) => order.id === orderPublicId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
