// Alta del pedido de comida (ARC-001).
//
// Validación de cotización firmada, idempotencia, cobro wallet/MP y retención
// de propina. Lecturas → `order-repository.js`. Avance/asignación →
// `order-lifecycle-repository.js`.
import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
import { getActiveSubscription, splitOrderDiscounts } from "./subscription-repository.js";
import { CHECKOUT_TIP_MIN_CENTS, checkoutTipMaxCents, holdCheckoutTip } from "./tip-repository.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";
import { pesos } from "./money.js";
import { marketplacePaymentKey } from "./order-marketplace-payment-repository.js";
import { config } from "./config.js";
import { resolveDrivingRoute } from "./maps-route-service.js";
import { resolveModifierSelection } from "./order-selection.js";

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
