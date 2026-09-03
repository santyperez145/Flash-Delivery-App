import crypto from "node:crypto";
import { DISPATCH_BATCH_CLAIM_SQL } from "../../server/dispatch-repository.js";

/** @param {import("./context.mjs").PostgresRuntimeContext} ctx */
export async function runSubscriptionsPromotionsSuite(ctx) {
  const { assert, request, readSseUntil, addressValidationToken, pool, base } = ctx;
  // Misma referencia que `ctx.payload`: las aserciones de checkout firman el
  // token sobre este objeto y lo reutilizan en POST /orders. Reasignar sólo
  // `ctx.payload` dejaría el local sin quoteToken y el 409 de dirección
  // alterada se convierte en 400.
  let payload = ctx.payload;
  // -------------------------------------------------------------------------
  // Suscripcion de Flash (GTM-001).
  //
  // Se prueba contra un plan propio del smoke y no contra el sembrado: mover el
  // umbral por encima y por debajo del subtotal real del pedido demuestra las
  // dos mitades sobre la misma orden, y demuestra ademas lo que el diseño
  // afirma —que el beneficio sale de la fila del plan y no del codigo—. Con el
  // plan sembrado habria que adivinar precios de semilla para cruzar el umbral.
  // -------------------------------------------------------------------------
  const planKeySmoke = "smoke_plan";
  const quoteSinPlan = await request("/orders/quote", {
    method: "POST",
    body: JSON.stringify({ ...payload, promotionCode: undefined }),
  });
  assert(
    quoteSinPlan.status === 200 && quoteSinPlan.body.quote.subscriptionDiscount === 0,
    "sin suscripcion la cotizacion no descuenta el envio",
  );
  const subtotalPedido = Math.round(quoteSinPlan.body.quote.subtotal * 100);
  const envioPedido = quoteSinPlan.body.quote.deliveryFee;
  assert(envioPedido > 0, "el pedido del smoke tiene un envio con cargo que descontar");

  await pool.query("DELETE FROM subscription_plans WHERE key=$1", [planKeySmoke]);
  await pool.query(
    `INSERT INTO subscription_plans(public_id, key, name, description, price_cents,
       billing_period_days, free_delivery_min_subtotal_cents, ride_discount_bps, dispatch_priority_boost)
     VALUES('PLAN-SMOKE','smoke_plan','Plan smoke','Plan de prueba del smoke',100000,30,$1,500,5)`,
    [subtotalPedido],
  );

  const planesPublicos = await fetch(`${base}/subscription/plans`).then((r) => r.json());
  assert(
    planesPublicos.plans?.some((plan) => plan.planKey === planKeySmoke),
    "el catalogo de planes se lee sin sesion",
  );

  const alta = await request("/subscription", {
    method: "POST",
    body: JSON.stringify({ planKey: planKeySmoke }),
  });
  assert(
    alta.status === 200 &&
      alta.body.subscription.planKey === planKeySmoke &&
      alta.body.subscription.renews === true &&
      // Se otorga sin cobrar mientras PAY-001 no tenga credenciales, y la
      // respuesta lo dice en vez de disimularlo.
      alta.body.subscription.billed === false,
    "el alta devuelve la suscripcion y declara que el periodo no se cobro",
  );
  const altaDuplicada = await request("/subscription", {
    method: "POST",
    body: JSON.stringify({ planKey: planKeySmoke }),
  });
  assert(altaDuplicada.status === 409, "una segunda alta sobre una suscripcion vigente se rechaza");

  // Umbral exactamente en el subtotal: aplica.
  const quoteConPlan = await request("/orders/quote", {
    method: "POST",
    body: JSON.stringify({ ...payload, promotionCode: undefined }),
  });
  assert(
    quoteConPlan.status === 200 &&
      quoteConPlan.body.quote.subscriptionDiscount === envioPedido &&
      quoteConPlan.body.quote.subscriptionPlan === planKeySmoke &&
      // El total baja exactamente el envio, ni mas ni menos.
      Math.round((quoteSinPlan.body.quote.total - quoteConPlan.body.quote.total) * 100) ===
        Math.round(envioPedido * 100),
    "desde el umbral la suscripcion cubre el envio y el total baja exactamente eso",
  );

  // Mismo pedido, umbral un centavo mas arriba: no aplica. La otra mitad, y sin
  // tocar codigo — solo la fila del plan.
  await pool.query(
    "UPDATE subscription_plans SET free_delivery_min_subtotal_cents=$1 WHERE key=$2",
    [subtotalPedido + 1, planKeySmoke],
  );
  const quoteBajoUmbral = await request("/orders/quote", {
    method: "POST",
    body: JSON.stringify({ ...payload, promotionCode: undefined }),
  });
  assert(
    quoteBajoUmbral.status === 200 && quoteBajoUmbral.body.quote.subscriptionDiscount === 0,
    "un centavo por debajo del umbral el beneficio no se aplica",
  );

  // Un cupon de envio sin cargo no se acumula con el beneficio: el envio se
  // descontaria dos veces y el pedido devolveria plata que nadie cobro.
  await pool.query(
    "UPDATE subscription_plans SET free_delivery_min_subtotal_cents=0 WHERE key=$1",
    [planKeySmoke],
  );
  const quoteConCupon = await request("/orders/quote", {
    method: "POST",
    body: JSON.stringify(ctx.payload),
  });
  assert(
    quoteConCupon.status === 200 &&
      Math.round(quoteConCupon.body.quote.total * 100) >= 0 &&
      quoteConCupon.body.quote.subscriptionDiscount + quoteConCupon.body.quote.discount <=
        quoteConCupon.body.quote.subtotal + quoteConCupon.body.quote.deliveryFee,
    "el alivio combinado de cupon y suscripcion nunca supera lo que se cobra",
  );

  const baja = await request("/subscription", { method: "DELETE" });
  const trasBaja = await request("/subscription");
  assert(
    baja.status === 200 &&
      baja.body.cancelled === true &&
      trasBaja.body.subscription?.renews === false &&
      // **Cancelar no es perder lo pago.** El periodo sigue y el beneficio
      // tambien: cortarlo el dia de la baja seria cobrar un mes y entregar
      // menos.
      new Date(trasBaja.body.subscription.currentPeriodEnd) > new Date(),
    "cancelar deja de renovar y conserva el periodo ya pago",
  );
  const quoteTrasBaja = await request("/orders/quote", {
    method: "POST",
    body: JSON.stringify({ ...payload, promotionCode: undefined }),
  });
  assert(
    quoteTrasBaja.body.quote.subscriptionDiscount === envioPedido,
    "el beneficio sigue aplicando despues de cancelar, hasta que termine el periodo",
  );
  const reactivacion = await request("/subscription", {
    method: "POST",
    body: JSON.stringify({ planKey: planKeySmoke }),
  });
  assert(
    reactivacion.status === 200 && reactivacion.body.subscription.renews === true,
    "reactivar dentro del periodo vuelve a renovar sin abrir un periodo nuevo",
  );
  assert(
    Number(
      (
        await pool.query(
          `SELECT count(*)::int count FROM user_subscriptions s JOIN users u ON u.id=s.user_id
           WHERE u.public_id=$1 AND s.status='active'`,
          ["usr_customer"],
        )
      ).rows[0].count,
    ) === 1,
    "reactivar no deja dos periodos superpuestos cobrandose a la vez",
  );

  // Prioridad de dispatch Flash Más: el boost reordena la cola de jobs (DSP-001),
  // no el score de conductores. Un job más nuevo con boost debe reclamarse antes
  // que uno viejo sin suscripción. Se valida el ORDER BY en una transacción que
  // hace rollback: no deja ofertas ni dispatchRound en el estado compartido.
  await pool.query("UPDATE subscription_plans SET dispatch_priority_boost=50 WHERE key=$1", [
    planKeySmoke,
  ]);
  const suscriptor = (await pool.query("SELECT id FROM users WHERE public_id='usr_customer'"))
    .rows[0];
  const otroCliente = (
    await pool.query(
      `SELECT u.id FROM users u
       WHERE u.id<>$1
         AND NOT EXISTS(
           SELECT 1 FROM user_subscriptions s
           WHERE s.user_id=u.id AND s.status='active' AND s.current_period_end>now())
       LIMIT 1`,
      [suscriptor.id],
    )
  ).rows[0];
  const sucursal = (
    await pool.query(
      `SELECT m.id merchant_id, b.id branch_id, b.location, b.address
       FROM merchants m JOIN merchant_branches b ON b.merchant_id=m.id
       WHERE b.is_primary LIMIT 1`,
    )
  ).rows[0];
  assert(otroCliente && sucursal, "hay contraste FIFO y sucursal para el boost de dispatch");
  const jobFifoId = `JOB-FIFO-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const jobBoostId = `JOB-BOOST-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  await pool.query(
    `INSERT INTO jobs(
       public_id, kind, customer_id, merchant_id, branch_id, status,
       pickup_address, pickup_location, dropoff_address, dropoff_location,
       service_level, quoted_amount_cents, distance_m, estimated_duration_s,
       metadata, created_at)
     VALUES
       ($1,'delivery',$2,$4,$5,'ready_for_pickup',
        $6,$7,'Destino FIFO',$7,'food',10000,500,600,
        '{"subtype":"food_order"}'::jsonb, now()-interval '2 hours'),
       ($3,'delivery',$8,$4,$5,'ready_for_pickup',
        $6,$7,'Destino boost',$7,'food',10000,500,600,
        '{"subtype":"food_order"}'::jsonb, now()-interval '1 minute')`,
    [
      jobFifoId,
      otroCliente.id,
      jobBoostId,
      sucursal.merchant_id,
      sucursal.branch_id,
      sucursal.address,
      sucursal.location,
      suscriptor.id,
    ],
  );
  const claimClient = await pool.connect();
  try {
    await claimClient.query("BEGIN");
    const claimed = (await claimClient.query(DISPATCH_BATCH_CLAIM_SQL, [100])).rows;
    const idxBoost = claimed.findIndex((row) => row.public_id === jobBoostId);
    const idxFifo = claimed.findIndex((row) => row.public_id === jobFifoId);
    assert(
      idxBoost !== -1 && (idxFifo === -1 || idxBoost < idxFifo),
      "Flash Más con boost reclama el job antes que el FIFO más viejo sin suscripción",
    );
    await claimClient.query("ROLLBACK");
  } catch (error) {
    await claimClient.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    claimClient.release();
  }
  await pool.query("DELETE FROM jobs WHERE public_id=ANY($1::text[])", [[jobFifoId, jobBoostId]]);
  await pool.query("UPDATE subscription_plans SET dispatch_priority_boost=5 WHERE key=$1", [
    planKeySmoke,
  ]);

  // **El bloque devuelve el padron como lo encontro.** Dejar a `usr_customer`
  // suscripto con umbral cero le regala el envio a todas las cotizaciones que
  // siguen en este archivo, y la primera que fallo fue una asercion de desglose
  // a doscientas lineas de distancia. Un bloque de prueba que cambia el estado
  // compartido y no lo restituye convierte cualquier agregado posterior en una
  // caceria.
  await pool.query(
    `DELETE FROM user_subscriptions
     WHERE plan_id IN(SELECT id FROM subscription_plans WHERE key=$1)`,
    [planKeySmoke],
  );
  assert(
    (await request("/subscription")).body.subscription === null,
    "el bloque de suscripcion deja al cliente como lo encontro",
  );
  payload = { ...payload, quoteToken: ctx.foodQuote.body.quote.quoteToken };
  ctx.payload = payload;
  const foreignAddressKey = `foreign-address-${crypto.randomUUID()}`;
  const foreignQuote = await request("/orders/quote", {
    method: "POST",
    body: JSON.stringify({ ...payload, deliveryAddressId: ctx.workId }),
  });
  assert(
    foreignQuote.status === 404 &&
      Number(
        (
          await pool.query("SELECT count(*)::int count FROM idempotency_keys WHERE key=$1", [
            foreignAddressKey,
          ])
        ).rows[0].count,
      ) === 0,
    "food quote rejects a delivery address owned by another customer without claiming idempotency",
  );
  const mismatchedQuote = await request("/orders", {
    method: "POST",
    headers: { "Idempotency-Key": foreignAddressKey },
    body: JSON.stringify({ ...payload, deliveryAddressId: ctx.workId }),
  });
  assert(
    mismatchedQuote.status === 409 &&
      Number(
        (
          await pool.query("SELECT count(*)::int count FROM idempotency_keys WHERE key=$1", [
            foreignAddressKey,
          ])
        ).rows[0].count,
      ) === 0,
    "signed food quote rejects a modified delivery address without residue",
  );
  const paymentRows = await pool.query(
      `SELECT pm.id::text,u.public_id FROM payment_methods pm JOIN users u ON u.id=pm.user_id WHERE pm.revoked_at IS NULL AND pm.kind='wallet' AND u.public_id IN('usr_customer','usr_driver')`,
    ),
    ownPaymentId = paymentRows.rows.find((row) => row.public_id === "usr_customer").id,
    foreignPaymentId = paymentRows.rows.find((row) => row.public_id === "usr_driver").id;
  const foreignPaymentQuote = await request("/orders/quote", {
    method: "POST",
    body: JSON.stringify({ ...payload, paymentMethodId: foreignPaymentId }),
  });
  assert(
    foreignPaymentQuote.status === 404,
    "checkout rejects a tokenized payment method owned by another user",
  );
  const checkoutQuote = await request("/orders/quote", {
    method: "POST",
    body: JSON.stringify({ ...payload, paymentMethodId: ownPaymentId }),
  });
  assert(
    checkoutQuote.status === 200 &&
      checkoutQuote.body.quote.paymentMethodId === ownPaymentId &&
      checkoutQuote.body.quote.subtotal > 0 &&
      checkoutQuote.body.quote.total ===
        checkoutQuote.body.quote.subtotal +
          checkoutQuote.body.quote.deliveryFee +
          checkoutQuote.body.quote.serviceFee -
          checkoutQuote.body.quote.discount -
          // El envio cubierto por la suscripcion es un termino propio del
          // desglose desde GTM-001. Sin el, esta asercion se rompe apenas el
          // cliente tiene una suscripcion activa — que es como aparecio.
          checkoutQuote.body.quote.subscriptionDiscount,
    "checkout returns an exact signed server-side breakdown",
  );
  payload = {
    ...payload,
    paymentMethodId: ownPaymentId,
    paymentMethod: checkoutQuote.body.quote.paymentMethod,
    quoteToken: checkoutQuote.body.quote.quoteToken,
  };
  ctx.payload = payload;
  const changedPriceKey = `changed-price-${crypto.randomUUID()}`,
    changedPrice = await request("/orders", {
      method: "POST",
      headers: { "Idempotency-Key": changedPriceKey },
      body: JSON.stringify({
        ...payload,
        items: [{ ...payload.items[0], quantity: 2 }],
      }),
    }),
    changedModifierKey = `changed-modifier-${crypto.randomUUID()}`,
    changedModifier = await request("/orders", {
      method: "POST",
      headers: { "Idempotency-Key": changedModifierKey },
      body: JSON.stringify({
        ...payload,
        items: [{ ...payload.items[0], extras: ["extra_cheddar"] }],
      }),
    });
  const residuo = Number(
    (
      await pool.query("SELECT count(*)::int count FROM idempotency_keys WHERE key=ANY($1)", [
        [changedPriceKey, changedModifierKey],
      ])
    ).rows[0].count,
  );
  if (changedPrice.status !== 409 || changedModifier.status !== 409 || residuo !== 0) {
    console.error(
      `diagnostico checkout firmado: ${JSON.stringify({
        changedPriceStatus: changedPrice.status,
        changedPriceBody: changedPrice.body,
        changedModifierStatus: changedModifier.status,
        changedModifierBody: changedModifier.body,
        residuoIdempotencia: residuo,
      })}`,
    );
  }
  assert(
    changedPrice.status === 409 &&
      changedModifier.status === 409 &&
      Number(
        (
          await pool.query("SELECT count(*)::int count FROM idempotency_keys WHERE key=ANY($1)", [
            [changedPriceKey, changedModifierKey],
          ])
        ).rows[0].count,
      ) === 0,
    "checkout refuses to charge a cart or modifier selection that differs from the accepted signed total",
  );
  const orderWalletBefore = ctx.customerAccount.user.wallet;
  const missingKey = await request("/orders", {
    method: "POST",
    body: JSON.stringify(ctx.payload),
  });
  assert(missingKey.status === 400, "order rejects missing idempotency key");
  ctx.idempotencyKey = `runtime-${crypto.randomUUID()}`;
  const first = await request("/orders", {
    method: "POST",
    headers: { "Idempotency-Key": ctx.idempotencyKey },
    body: JSON.stringify(ctx.payload),
  });
  const second = await request("/orders", {
    method: "POST",
    headers: { "Idempotency-Key": ctx.idempotencyKey },
    body: JSON.stringify(ctx.payload),
  });
  if (first.status !== 200) console.error("branch checkout diagnostic", first, second);
  const orderId = first.body.order?.id;
  ctx.orderId = orderId;
  assert(
    first.status === 200 && orderId && second.body.order?.id === orderId,
    "order idempotency returns one result",
  );
  const count = await pool.query("SELECT count(*)::int AS count FROM jobs WHERE public_id = $1", [
    ctx.orderId,
  ]);
  assert(count.rows[0].count === 1, "order idempotency creates one row");
  const foodRoute = await pool.query(
    `SELECT ST_Distance(pickup_location,dropoff_location) distance_m,
      ST_Y(dropoff_location::geometry) lat,
      ST_X(dropoff_location::geometry) lng,
      metadata->>'locationEstimated' location_estimated,
      metadata->>'deliveryAddressId' address_id,
      metadata->>'quoteId' quote_id,
      metadata->>'pricingVersion' pricing_version FROM jobs WHERE public_id=$1`,
    [ctx.orderId],
  );
  assert(
    Number(foodRoute.rows[0].distance_m) > 0 &&
      first.body.order.pickupLocation &&
      first.body.order.deliveryLocation &&
      Math.abs(Number(foodRoute.rows[0].lat) - ctx.checkoutAddress.lat) < 0.0001 &&
      Math.abs(Number(foodRoute.rows[0].lng) - ctx.checkoutAddress.lng) < 0.0001 &&
      foodRoute.rows[0].location_estimated === "false" &&
      foodRoute.rows[0].address_id === ctx.checkoutAddress.id &&
      foodRoute.rows[0].quote_id === checkoutQuote.body.quote.quoteId &&
      foodRoute.rows[0].pricing_version === checkoutQuote.body.quote.pricingVersion &&
      first.body.order.deliveryFee === checkoutQuote.body.quote.deliveryFee,
    "food order persists and exposes its PostGIS route with exact signed pricing provenance",
  );
  const redemption = await pool.query(
    "SELECT count(*)::int count FROM promotion_redemptions pr JOIN jobs j ON j.id=pr.job_id WHERE j.public_id=$1",
    [ctx.orderId],
  );
  assert(
    first.body.order.discount > 0 &&
      first.body.order.promotionCode === "FLASH40" &&
      redemption.rows[0].count === 1,
    "checkout validates and redeems promotion atomically",
  );

  // El cupo global de una promocion se cuenta sobre las redenciones de todos,
  // y nada lo afirmaba hasta que `promotion_redemptions` recibio politica RLS
  // en la migracion 114.
  //
  // Esta comprobacion va por la API a proposito, que consulta como
  // `flash_runtime`. La lectura de arriba usa el pool del rol migrador, que es
  // duenio del esquema y saltea RLS: no puede demostrar nada sobre visibilidad.
  //
  // Lo que se protege es un fallo silencioso: si el runtime quedara sujeto a la
  // politica por usuario, `usageCount` daria 0 y **un tope de promocion no se
  // agotaria nunca**. No habria error, solo descuentos sin limite.
  const promotionsAfterRedemption = await request("/promotions"),
    flash40 = promotionsAfterRedemption.body.promotions?.find((entry) => entry.code === "FLASH40");
  assert(
    flash40 !== undefined && flash40.usageCount >= 1,
    "the runtime still counts every redemption, so a promotion cap can be reached",
  );
  const captured = await pool.query(
    "SELECT p.status,p.captured_amount_cents FROM payment_intents p JOIN jobs j ON j.id=p.job_id WHERE j.public_id=$1",
    [ctx.orderId],
  );
  const orderWalletAfter = (await request("/me")).body.account.user.wallet;
  assert(
    captured.rows[0]?.status === "captured" &&
      orderWalletAfter === orderWalletBefore - first.body.order.total,
    "wallet payment is captured atomically with order",
  );
  const insufficientKey = `insufficient-${crypto.randomUUID()}`;
  const insufficientPayload = {
    ...payload,
    promotionCode: undefined,
    items: [{ ...payload.items[0], quantity: 30 }],
  };
  const insufficientQuote = await request("/orders/quote", {
    method: "POST",
    body: JSON.stringify(insufficientPayload),
  });
  const insufficient = await request("/orders", {
    method: "POST",
    headers: { "Idempotency-Key": insufficientKey },
    body: JSON.stringify({
      ...insufficientPayload,
      quoteToken: insufficientQuote.body.quote.quoteToken,
    }),
  });
  assert(insufficient.status === 402, "wallet rejects order with insufficient balance");
  const rolledBack = await pool.query(
    "SELECT (SELECT count(*) FROM idempotency_keys WHERE key=$1)::int claims,(SELECT count(*) FROM ledger_transactions WHERE idempotency_key=$2)::int payments",
    [insufficientKey, `payment-${insufficientKey}`],
  );
  assert(
    rolledBack.rows[0].claims === 0 && rolledBack.rows[0].payments === 0,
    "insufficient wallet payment rolls back all financial records",
  );
  const cancelledOrder = await request(`/orders/${orderId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "cancelled", reason: "changed_mind" }),
  });
  const refundedWallet = (await request("/me")).body.account.user.wallet;
  const refundState = await pool.query(
    `SELECT p.status,(SELECT count(*) FROM refunds r WHERE r.payment_intent_id=p.id)::int refunds,
    (SELECT imbalance_cents FROM ledger_transaction_balances b JOIN ledger_transactions t ON t.id=b.transaction_id WHERE t.idempotency_key=$2) refund_imbalance
    FROM payment_intents p JOIN jobs j ON j.id=p.job_id WHERE j.public_id=$1`,
    [ctx.orderId, `refund-${orderId}`],
  );
  assert(
    cancelledOrder.status === 200 &&
      cancelledOrder.body.order.status === "cancelled" &&
      refundedWallet === orderWalletBefore,
    "order cancellation refunds wallet atomically",
  );
  const cancelledOrderOffers = await pool.query(
    "SELECT count(*) FILTER(WHERE o.status='pending')::int pending FROM dispatch_offers o JOIN jobs j ON j.id=o.job_id WHERE j.public_id=$1",
    [ctx.orderId],
  );
  assert(
    cancelledOrderOffers.rows[0].pending === 0,
    "order cancellation withdraws pending dispatch offers",
  );
  assert(
    refundState.rows[0]?.status === "refunded" &&
      refundState.rows[0]?.refunds === 1 &&
      Number(refundState.rows[0]?.refund_imbalance) === 0,
    "refund is recorded and ledger-balanced",
  );
  const walletBefore = (await request("/me")).body.account.user.wallet;
  ctx.walletKey = `wallet-${crypto.randomUUID()}`;
  const walletFirst = await request("/wallet/topup", {
    method: "POST",
    headers: { "Idempotency-Key": ctx.walletKey },
    body: JSON.stringify({ amount: 1234 }),
  });
  const walletSecond = await request("/wallet/topup", {
    method: "POST",
    headers: { "Idempotency-Key": ctx.walletKey },
    body: JSON.stringify({ amount: 1234 }),
  });
  assert(
    walletFirst.body.account.user.wallet === walletBefore + 1234 &&
      walletSecond.body.account.user.wallet === walletFirst.body.account.user.wallet,
    "wallet topup is idempotent",
  );
  const walletState = await request("/me");
  assert(
    walletState.body.account.walletTransactions?.some(
      (entry) => entry.amount === 1234 && entry.userId === "usr_customer",
    ),
    "private wallet history loads from PostgreSQL ledger",
  );
  const ledger = await pool.query(
    `SELECT entry_count,imbalance_cents FROM ledger_transaction_balances b JOIN ledger_transactions t ON t.id=b.transaction_id WHERE t.idempotency_key=$1`,
    [ctx.walletKey],
  );
  assert(
    Number(ledger.rows[0]?.entry_count) === 2 && Number(ledger.rows[0]?.imbalance_cents) === 0,
    "wallet ledger is double-entry balanced",
  );
  const rideOptions = await request("/rides/options", {
      method: "POST",
      body: JSON.stringify({
        pickup: "Defensa 982, San Telmo",
        destination: "Aeroparque Jorge Newbery",
        service: "economy",
        pickupCoords: { lat: -34.6177, lng: -58.3621 },
        destinationCoords: { lat: -34.5596, lng: -58.4156 },
      }),
    }),
    lockedRideQuote = rideOptions.body.options?.find((entry) => entry.service === "economy");
  const ridePayload = {
    customerId: "usr_customer",
    pickup: "Defensa 982, San Telmo",
    destination: "Aeroparque Jorge Newbery",
    service: "economy",
    pickupCoords: { lat: -34.6177, lng: -58.3621 },
    destinationCoords: { lat: -34.5596, lng: -58.4156 },
    paymentMethod: "Flash Wallet",
    quoteToken: lockedRideQuote?.quoteToken,
  };
  ctx.rideWalletBefore = (await request("/me")).body.account.user.wallet;
  assert(
    (
      await request("/rides", {
        method: "POST",
        body: JSON.stringify(ridePayload),
      })
    ).status === 400,
    "ride rejects missing idempotency key",
  );
  ctx.rideKey = `ride-${crypto.randomUUID()}`;
  const rideWithoutQuote = await request("/rides", {
    method: "POST",
    headers: { "Idempotency-Key": `ride-unquoted-${crypto.randomUUID()}` },
    body: JSON.stringify({ ...ridePayload, quoteToken: undefined }),
  });
  assert(
    rideWithoutQuote.status === 400,
    "PostgreSQL ride rejects creation without a signed quote",
  );
  ctx.rideFirst = await request("/rides", {
    method: "POST",
    headers: { "Idempotency-Key": ctx.rideKey },
    body: JSON.stringify(ridePayload),
  });
  const rideSecond = await request("/rides", {
    method: "POST",
    headers: { "Idempotency-Key": ctx.rideKey },
    body: JSON.stringify(ridePayload),
  });
  ctx.rideId = ctx.rideFirst.body.ride?.id;
  assert(
    ctx.rideFirst.status === 200 &&
      ctx.rideId &&
      rideSecond.body.ride?.id === ctx.rideId &&
      !ctx.rideFirst.body.ride?.driverId,
    "ride request and idempotency persist before driver acceptance",
  );
  const tamperedQuote = await request("/rides", {
    method: "POST",
    headers: { "Idempotency-Key": `tampered-${crypto.randomUUID()}` },
    body: JSON.stringify({ ...ridePayload, destination: "Destino alterado" }),
  });
  assert(tamperedQuote.status === 409, "signed ride quote rejects a modified itinerary");
  const tamperedCoordinates = await request("/rides", {
    method: "POST",
    headers: { "Idempotency-Key": `tampered-coords-${crypto.randomUUID()}` },
    body: JSON.stringify({
      ...ridePayload,
      destinationCoords: { lat: -34.7, lng: -58.6 },
    }),
  });
  assert(tamperedCoordinates.status === 409, "signed ride quote rejects modified coordinates");
  ctx.scheduledRideKey = `scheduled-${crypto.randomUUID()}`;
  const scheduledFor = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const scheduledRide = await request("/rides", {
    method: "POST",
    headers: { "Idempotency-Key": ctx.scheduledRideKey },
    body: JSON.stringify({
      ...ridePayload,
      paymentMethod: "Efectivo",
      scheduledFor,
    }),
  });
  const scheduledRideId = scheduledRide.body.ride?.id;
  ctx.scheduledRideId = scheduledRideId;
  const scheduledStored = await pool.query(
    `SELECT scheduled_for,
      (SELECT count(*)::int FROM dispatch_offers o WHERE o.job_id=j.id) offers,
      (SELECT count(*)::int FROM notifications n
        WHERE n.user_id=j.customer_id AND n.payload->>'jobId'=j.public_id
          AND n.template='ride_reminder'
      ) reminders
    FROM jobs j WHERE public_id=$1`,
    [ctx.scheduledRideId],
  );
  assert(
    scheduledRide.status === 200 &&
      scheduledRide.body.ride.scheduledFor === scheduledFor &&
      scheduledStored.rows[0]?.offers === 0 &&
      scheduledStored.rows[0]?.reminders === 1,
    "scheduled ride persists without dispatch and creates a reminder",
  );
  // Reprogramar (GTM-001). Hasta ahora nada podia mover un horario: la unica
  // salida era cancelar y volver a pedir, que ademas le cuenta la cancelacion al
  // cliente. Se prueba sobre el viaje reservado porque ya existe y ya esta fuera
  // de ventana, que es justo el estado en el que mover la hora es legitimo.
  const nuevoHorario = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const reprogramado = await request(`/jobs/${scheduledRideId}/schedule`, {
    method: "PATCH",
    body: JSON.stringify({ scheduledFor: nuevoHorario }),
  });
  const horarioEnBase = (
    await pool.query("SELECT scheduled_for FROM jobs WHERE public_id=$1", [ctx.scheduledRideId])
  ).rows[0];
  assert(
    reprogramado.status === 200 &&
      reprogramado.body.job.scheduledFor === nuevoHorario &&
      // El horario anterior viaja en la respuesta: quien reprograma tiene que
      // poder ver desde donde se movio, y la auditoria lo necesita para el
      // `beforeData`.
      reprogramado.body.job.previousScheduledFor === scheduledFor &&
      new Date(horarioEnBase.scheduled_for).toISOString() === nuevoHorario,
    "reprogramar mueve el horario reservado y devuelve el anterior",
  );
  assert(
    Number(
      (
        await pool.query(
          `SELECT count(*)::int count FROM job_events e JOIN jobs j ON j.id=e.job_id
           WHERE j.public_id=$1 AND e.payload->>'rescheduledFrom' IS NOT NULL`,
          [ctx.scheduledRideId],
        )
      ).rows[0].count,
    ) === 1,
    "el cambio de horario queda en la linea de tiempo del servicio, no solo en auditoria",
  );
  // Las dos mitades del rechazo, que es donde vive el dinero: un servicio sin
  // reserva no se puede "mover", y un horario fuera de la ventana no se acepta.
  const sinReserva = await request(`/jobs/${orderId}/schedule`, {
    method: "PATCH",
    body: JSON.stringify({ scheduledFor: nuevoHorario }),
  });
  const fueraDeVentana = await request(`/jobs/${scheduledRideId}/schedule`, {
    method: "PATCH",
    body: JSON.stringify({ scheduledFor: new Date(Date.now() + 5 * 60 * 1000).toISOString() }),
  });
  assert(
    sinReserva.status === 409 && fueraDeVentana.status === 400,
    "no se reprograma un servicio sin reserva ni a un horario fuera de la ventana",
  );
  await pool.query(
    "UPDATE jobs SET scheduled_for=now()+interval '10 minutes',metadata=metadata-'dispatchNextAttemptAt' WHERE public_id=$1",
    [ctx.scheduledRideId],
  );
  await processPostgresDispatchBatch({ limit: 20 });
  const activatedOffers = Number(
    (
      await pool.query(
        "SELECT count(*)::int count FROM dispatch_offers o JOIN jobs j ON j.id=o.job_id WHERE j.public_id=$1 AND o.status='pending'",
        [ctx.scheduledRideId],
      )
    ).rows[0].count,
  );
  assert(activatedOffers > 0, "scheduled ride enters dispatch inside the lead window");
  // Con oferta pendiente el viaje sigue sin conductor, asi que todavia se puede
  // mover; lo que no se puede es moverlo despues, y eso lo cubre el estado. Aca
  // se afirma que la ventana sigue mandando aunque ya este en despacho: un
  // horario a cinco minutos no se acepta ni siquiera cuando el trabajo ya entro.
  const enDespachoFueraDeVentana = await request(`/jobs/${scheduledRideId}/schedule`, {
    method: "PATCH",
    body: JSON.stringify({ scheduledFor: new Date(Date.now() + 60 * 1000).toISOString() }),
  });
  assert(
    enDespachoFueraDeVentana.status === 400,
    "un trabajo ya en despacho tampoco se mueve a un horario invalido",
  );
  const cancelledScheduled = await request(`/rides/${scheduledRideId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "cancelled", reason: "changed_mind" }),
  });
  const withdrawnScheduled = Number(
    (
      await pool.query(
        "SELECT count(*)::int count FROM dispatch_offers o JOIN jobs j ON j.id=o.job_id WHERE j.public_id=$1 AND o.status='withdrawn'",
        [ctx.scheduledRideId],
      )
    ).rows[0].count,
  );
  assert(
    cancelledScheduled.status === 200 && withdrawnScheduled === activatedOffers,
    "scheduled ride cancellation withdraws all pending offers",
  );
  await pool.query("UPDATE jobs SET created_at=now()-interval '2 hours' WHERE public_id=ANY($1)", [
    [ctx.orderId, ctx.rideId, ctx.scheduledRideId].filter(Boolean),
  ]);
  ctx.merchantBalanceBefore = Number(
    (
      await pool.query(
        `SELECT COALESCE(sum(CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END),0)::bigint balance FROM merchants m LEFT JOIN ledger_accounts a ON a.owner_type='merchant'
          AND a.owner_id=m.id AND a.account_type='payable' LEFT JOIN ledger_entries e ON e.account_id=a.id WHERE m.public_id='rest_roja'`,
      )
    ).rows[0].balance,
  );
  ctx.settlementOrderKey = `settlement-${crypto.randomUUID()}`;
  const settlementPayload = {
    ...payload,
    promotionCode: undefined,
    quoteToken: undefined,
  };
  ctx.settlementQuote = await request("/orders/quote", {
    method: "POST",
    body: JSON.stringify(settlementPayload),
  });
  // Propina tomada en el checkout (GTM-001). Va sobre el pedido que se liquida
  // porque el riesgo esta justo ahi: que el comercio o la plataforma se queden
  // con parte de ella. Es un error silencioso — nadie reclama una propina que
  // llego a la cuenta equivocada, porque nadie la ve.
  ctx.propinaCents = 120000;
  const settlementOrder = await request("/orders", {
    method: "POST",
    headers: { "Idempotency-Key": ctx.settlementOrderKey },
    body: JSON.stringify({
      ...settlementPayload,
      quoteToken: ctx.settlementQuote.body.quote?.quoteToken,
      tipCents: ctx.propinaCents,
    }),
  });
  ctx.settlementOrderId = settlementOrder.body.order?.id;
  if (settlementOrder.status !== 200 || !ctx.settlementOrderId)
    console.error("settlement order diagnostic", settlementOrder);
  assert(
    settlementOrder.status === 200 && ctx.settlementOrderId,
    "captured food order is ready for settlement",
  );
  const preReadyDispatchOffers = Number(
    (
      await pool.query(
        "SELECT count(*)::int count FROM dispatch_offers offer JOIN jobs job ON job.id=offer.job_id WHERE job.public_id=$1",
        [ctx.settlementOrderId],
      )
    ).rows[0].count,
  );
  assert(
    preReadyDispatchOffers === 0,
    "paid food remains out of dispatch until merchant readiness",
  );
  const propinaRetenida = (
    await pool.query(
      `SELECT t.status, t.amount_cents, t.driver_id, p.amount_cents charged_cents
       FROM service_tips t JOIN jobs j ON j.id=t.job_id
       JOIN payment_intents p ON p.job_id=j.id
       WHERE j.public_id=$1`,
      [ctx.settlementOrderId],
    )
  ).rows[0];
  assert(
    propinaRetenida?.status === "held" &&
      Number(propinaRetenida.amount_cents) === ctx.propinaCents &&
      // Sin conductor asignado todavia: en el checkout no hay a quien pagarle, y
      // por eso la propina se retiene en vez de transferirse.
      propinaRetenida.driver_id === null,
    "la propina del checkout queda retenida y sin destinatario hasta que haya conductor",
  );
  assert(
    Number(propinaRetenida.charged_cents) ===
      Math.round(ctx.settlementQuote.body.quote.total * 100) + ctx.propinaCents,
    "se cobra el pedido y la propina en un solo cargo, no en dos",
  );
  ctx.substitutionWalletBefore = (await request("/me")).body.account.user.wallet;
  ctx.merchantSubLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "comercio@flash.app",
      password: "demo123",
      deviceName: "postgres-smoke-substitution",
    }),
  });
  ctx.token = ctx.customerToken;
  const forbiddenModifiers = await request(
    "/restaurants/rest_roja/menu/item_burger_brava/modifiers",
    { method: "PUT", body: JSON.stringify({ groups: [] }) },
  );
  ctx.token = ctx.merchantSubLogin.body.token;
  const merchantCatalog = (await request("/merchant/me")).body.restaurants.find(
      (entry) => entry.id === "rest_roja",
    ),
    burgerModifiers = merchantCatalog.menu
      .find((entry) => entry.id === "item_burger_brava")
      .modifierGroups.map((group) => ({ ...group, active: true }));
  const duplicateModifierId = burgerModifiers[0]?.modifiers[0]?.id;
  const invalidModifiers = await request(
    "/restaurants/rest_roja/menu/item_burger_brava/modifiers",
    {
      method: "PUT",
      body: JSON.stringify({
        groups: duplicateModifierId
          ? [
              ...burgerModifiers,
              {
                id: "duplicate_test_group",
                name: "Duplicado",
                min: 0,
                max: 1,
                active: true,
                modifiers: [
                  {
                    id: duplicateModifierId,
                    name: "Duplicado",
                    price: 0,
                    available: true,
                  },
                ],
              },
            ]
          : burgerModifiers,
      }),
    },
  );
  const savedModifiers = await request("/restaurants/rest_roja/menu/item_burger_brava/modifiers", {
    method: "PUT",
    body: JSON.stringify({ groups: burgerModifiers }),
  });
  const persistedModifierCount = Number(
    (
      await pool.query(
        "SELECT count(*)::int count FROM catalog_modifiers m JOIN catalog_modifier_groups g ON g.id=m.group_id JOIN catalog_items c ON c.id=g.catalog_item_id WHERE c.public_id='item_burger_brava'",
      )
    ).rows[0].count,
  );
  assert(
    forbiddenModifiers.status === 403 &&
      invalidModifiers.status === 400 &&
      savedModifiers.status === 200 &&
      persistedModifierCount ===
        burgerModifiers.reduce((sum, group) => sum + group.modifiers.length, 0),
    "merchant modifier management enforces role, unique IDs and PostgreSQL persistence",
  );
  const burgerFood = merchantCatalog.menu.find((entry) => entry.id === "item_burger_brava"),
    originalDietary = {
      dietaryLabels: burgerFood.dietaryLabels.map((entry) => entry.code),
      allergens: burgerFood.allergens.map((entry) => ({
        code: entry.code,
        presence: entry.presence,
      })),
    };
  ctx.token = ctx.customerToken;
  const forbiddenDietary = await request("/restaurants/rest_roja/menu/item_burger_brava/dietary", {
    method: "PUT",
    body: JSON.stringify({ dietaryLabels: [], allergens: [] }),
  });
  ctx.token = ctx.merchantSubLogin.body.token;
  const invalidDietary = await request("/restaurants/rest_roja/menu/item_burger_brava/dietary", {
      method: "PUT",
      body: JSON.stringify({ dietaryLabels: ["invented"], allergens: [] }),
    }),
    savedDietary = await request("/restaurants/rest_roja/menu/item_burger_brava/dietary", {
      method: "PUT",
      body: JSON.stringify({
        dietaryLabels: ["halal"],
        allergens: [
          { code: "gluten", presence: "contains" },
          { code: "sesame", presence: "may_contain" },
        ],
      }),
    });
  const dietaryStored = await pool.query(
    `SELECT (
        SELECT count(*) FROM catalog_item_dietary_labels d
        JOIN catalog_items c ON c.id=d.catalog_item_id
        WHERE c.public_id='item_burger_brava'
      )::int diets,
      (
        SELECT count(*) FROM catalog_item_allergens a
        JOIN catalog_items c ON c.id=a.catalog_item_id
        WHERE c.public_id='item_burger_brava'
      )::int allergens`,
  );
  await request("/restaurants/rest_roja/menu/item_burger_brava/dietary", {
    method: "PUT",
    body: JSON.stringify(originalDietary),
  });
  assert(
    forbiddenDietary.status === 403 &&
      invalidDietary.status === 400 &&
      savedDietary.status === 200 &&
      savedDietary.body.restaurant.menu
        .find((entry) => entry.id === "item_burger_brava")
        .allergens.some((entry) => entry.code === "sesame" && entry.presence === "may_contain") &&
      dietaryStored.rows[0].diets === 1 &&
      dietaryStored.rows[0].allergens === 2,
    "merchant dietary declarations enforce ownership, controlled vocabularies and normalized persistence",
  );
  const closedWeek = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      opensAt: "09:00",
      closesAt: "18:00",
      enabled: false,
    })),
    alwaysOpen = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      opensAt: "00:00",
      closesAt: "00:00",
      enabled: true,
    }));
  ctx.token = ctx.customerToken;
  const forbiddenSchedule = await request(
    "/restaurants/rest_roja/branches/branch_rest_roja/schedule",
    {
      method: "PUT",
      body: JSON.stringify({
        timezone: "America/Argentina/Buenos_Aires",
        hours: closedWeek,
      }),
    },
  );
  ctx.token = ctx.merchantSubLogin.body.token;
  const closedSchedule = await request(
    "/restaurants/rest_roja/branches/branch_rest_roja/schedule",
    {
      method: "PUT",
      body: JSON.stringify({
        timezone: "America/Argentina/Buenos_Aires",
        hours: closedWeek,
      }),
    },
  );
  ctx.token = ctx.customerToken;
  const closedScheduleQuote = await request("/orders/quote", {
    method: "POST",
    body: JSON.stringify({ ...payload, branchId: "branch_rest_roja" }),
  });
  ctx.token = ctx.merchantSubLogin.body.token;
  const overnight = [...closedWeek.map((entry) => ({ ...entry }))];
  overnight[1] = {
    weekday: 1,
    opensAt: "22:00",
    closesAt: "02:00",
    enabled: true,
  };
  await request("/restaurants/rest_roja/branches/branch_rest_roja/schedule", {
    method: "PUT",
    body: JSON.stringify({ timezone: "UTC", hours: overnight }),
  });
  const branchDbId = (
      await pool.query("SELECT id FROM merchant_branches WHERE public_id='branch_rest_roja'")
    ).rows[0].id,
    overnightResult = (
      await pool.query(
        `SELECT app.branch_is_scheduled_open($1,'2026-08-17 23:00:00+00') monday,
          app.branch_is_scheduled_open($1,'2026-08-18 01:00:00+00') carry,
          app.branch_is_scheduled_open($1,'2026-08-18 03:00:00+00') closed`,
        [branchDbId],
      )
    ).rows[0];
  await request("/restaurants/rest_roja/branches/branch_rest_roja/schedule", {
    method: "PUT",
    body: JSON.stringify({
      timezone: "America/Argentina/Buenos_Aires",
      hours: alwaysOpen,
    }),
  });
  const localDate = (
    await pool.query(
      "SELECT (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date::text date",
    )
  ).rows[0].date;
  await request("/restaurants/rest_roja/branches/branch_rest_roja/schedule-exceptions", {
    method: "PUT",
    body: JSON.stringify({
      date: localDate,
      isOpen: false,
      reason: "Feriado de prueba",
    }),
  });
  ctx.token = ctx.customerToken;
  const exceptionQuote = await request("/orders/quote", {
    method: "POST",
    body: JSON.stringify({ ...payload, branchId: "branch_rest_roja" }),
  });
  await pool.query("DELETE FROM branch_schedule_exceptions WHERE branch_id=$1 AND local_date=$2", [
    branchDbId,
    localDate,
  ]);
  assert(
    forbiddenSchedule.status === 403 &&
      closedSchedule.status === 200 &&
      closedScheduleQuote.status === 404 &&
      overnightResult.monday &&
      overnightResult.carry &&
      !overnightResult.closed &&
      exceptionQuote.status === 404,
    "branch schedules enforce ownership, weekly closures, overnight carry and dated exceptions in the branch timezone",
  );
  ctx.token = ctx.customerToken;
  assert(
    (
      await request("/restaurants/rest_roja/branches/branch_rest_roja", {
        method: "PATCH",
        body: JSON.stringify({ open: false }),
      })
    ).status === 403,
    "customer cannot manage merchant branches",
  );
}
