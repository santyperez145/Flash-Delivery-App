import crypto from "node:crypto";

/** @param {import("./context.mjs").PostgresRuntimeContext} ctx */
export async function runDispatchMerchantOpsSuite(ctx) {
  const { assert, request, readSseUntil, addressValidationToken, pool, base } = ctx;
  // -------------------------------------------------------------------------
  // Suspender un comercio (OPS-001).
  //
  // Va junto a la pausa de sucursal porque son dos cosas que se confunden y no
  // son la misma: pausar una sucursal es una decision del local, suspender el
  // comercio es una decision de operaciones sobre el registro de un tercero.
  //
  // El bloque se abre su propia sesion de operaciones y **restituye el comercio
  // antes de salir**: dejarlo suspendido rompe todas las cotizaciones que siguen
  // en este archivo, y la ultima vez que un bloque no restituyo estado la falla
  // aparecio doscientas lineas mas abajo sin conexion visible.
  // -------------------------------------------------------------------------
  const canceladosDeRojaAntes = Number(
    (
      await pool.query(
        `SELECT count(*)::int total FROM jobs j JOIN merchants m ON m.id=j.merchant_id
         WHERE m.public_id='rest_roja' AND j.status='cancelled'`,
      )
    ).rows[0].total,
  );
  const opsLoginSuspension = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "ops@flash.app",
      password: "demo123",
      deviceName: "postgres-smoke-ops-suspension",
    }),
  });
  ctx.token = opsLoginSuspension.body.token;
  const suspensionSinMotivo = await request("/admin/merchants/rest_roja/status", {
    method: "PATCH",
    body: JSON.stringify({ status: "suspended" }),
  });
  const suspension = await request("/admin/merchants/rest_roja/status", {
    method: "PATCH",
    body: JSON.stringify({ status: "suspended", reason: "Prueba de suspension del smoke" }),
  });
  if (suspension.status !== 200)
    console.error("merchant suspension diagnostic", {
      login: opsLoginSuspension.status,
      tieneToken: Boolean(opsLoginSuspension.body.token),
      sinMotivo: suspensionSinMotivo,
      suspension,
    });
  assert(
    // El motivo no es burocracia: es lo que se lee el dia del reclamo. Sin el,
    // el log dice quien suspendio a quien y no por que.
    suspensionSinMotivo.status === 400 &&
      suspension.status === 200 &&
      suspension.body.merchant.status === "suspended" &&
      suspension.body.merchant.previousStatus === "active",
    "suspender un comercio exige motivo y devuelve el estado anterior",
  );
  ctx.token = ctx.customerToken;
  const cotizacionSuspendida = await request("/orders/quote", {
    method: "POST",
    body: JSON.stringify(ctx.payload),
  });
  const catalogoSuspendido = await request("/catalog/restaurants?limit=50");
  assert(
    cotizacionSuspendida.status >= 400 &&
      !(catalogoSuspendido.body.restaurants || []).some((fila) => fila.id === "rest_roja"),
    "un comercio suspendido no cotiza ni aparece en el catalogo",
  );
  // **Lo que ya estaba en curso sigue en curso.** Cancelar en masa castigaria a
  // clientes que no hicieron nada y dejaria comida hecha sin destino.
  //
  // Se compara contra el conteo previo y no contra una ventana de tiempo: el
  // smoke cancela pedidos por su cuenta unas lineas antes, y una ventana de
  // quince segundos los cuenta como si los hubiera cancelado la suspension. Lo
  // que hay que medir es el delta que provoca esta operacion, no el ambiente.
  assert(
    Number(
      (
        await pool.query(
          `SELECT count(*)::int total FROM jobs j JOIN merchants m ON m.id=j.merchant_id
           WHERE m.public_id='rest_roja' AND j.status='cancelled'`,
        )
      ).rows[0].total,
    ) === canceladosDeRojaAntes,
    "suspender no cancela los pedidos que ya estaban en curso",
  );
  ctx.token = opsLoginSuspension.body.token;
  // El tablero de colas, contra la base de verdad, con la sesion de operaciones
  // puesta: la ruta la leen `admin` y `support`, no el cliente.
  //
  // **Su consulta nunca se habia ejecutado.** Son doce subconsultas unidas por
  // `UNION ALL` sobre doce tablas, escritas sin base local: un solo nombre de
  // columna equivocado rompe la consulta entera, y ninguna puerta estatica mira
  // columnas. Llamarlo una vez desde el smoke convierte eso en una falla de CI
  // en vez de un 500 en produccion.
  const colas = await request("/operations/work-queues");
  if (colas.status !== 200) console.error("work queue diagnostic", colas);
  assert(
    colas.status === 200 &&
      colas.body.queues?.length === 12 &&
      colas.body.queues.every(
        (cola) => typeof cola.pending === "number" && typeof cola.oldestMinutes === "number",
      ) &&
      colas.body.queues.some((cola) => cola.key === "dispatch"),
    "el tablero de colas responde las doce colas con profundidad y antiguedad",
  );
  const reactivacionComercio = await request("/admin/merchants/rest_roja/status", {
    method: "PATCH",
    body: JSON.stringify({ status: "active", reason: "Fin de la prueba del smoke" }),
  });
  const reactivacionRepetida = await request("/admin/merchants/rest_roja/status", {
    method: "PATCH",
    body: JSON.stringify({ status: "active", reason: "Fin de la prueba del smoke" }),
  });
  assert(
    reactivacionComercio.status === 200 &&
      reactivacionComercio.body.merchant.status === "active" &&
      // Reactivar lo ya activo es 409 y no un exito silencioso: si alguien creyo
      // suspender y no suspendio, tiene que enterarse.
      reactivacionRepetida.status === 409,
    "reactivar restituye el comercio y repetirlo se rechaza",
  );

  ctx.token = ctx.merchantSubLogin.body.token;
  const pausedBranch = await request("/restaurants/rest_roja/branches/branch_rest_roja", {
    method: "PATCH",
    body: JSON.stringify({ open: false, etaMin: 31 }),
  });
  ctx.token = ctx.customerToken;
  const pausedBranchQuote = await request("/orders/quote", {
    method: "POST",
    body: JSON.stringify({ ...payload, branchId: "branch_rest_roja" }),
  });
  ctx.token = ctx.merchantSubLogin.body.token;
  const restoredBranch = await request("/restaurants/rest_roja/branches/branch_rest_roja", {
    method: "PATCH",
    body: JSON.stringify({ open: true, etaMin: 22, status: "active" }),
  });
  const branchInventory = await request(
    "/restaurants/rest_roja/branches/branch_rest_roja/inventory/item_burger_brava",
    {
      method: "PATCH",
      body: JSON.stringify({ available: false, stockQuantity: 0 }),
    },
  );
  const storedBranch = await pool.query(
    `SELECT b.open,
      b.eta_min,
      i.available,
      i.stock_quantity,
      i.version
    FROM merchant_branches b
    JOIN catalog_branch_inventory i ON i.branch_id=b.id
    JOIN catalog_items c ON c.id=i.catalog_item_id
    WHERE b.public_id='branch_rest_roja' AND c.public_id='item_burger_brava'`,
  );
  assert(
    pausedBranch.status === 200 &&
      pausedBranchQuote.status === 404 &&
      restoredBranch.status === 200 &&
      branchInventory.status === 200 &&
      !storedBranch.rows[0].available &&
      storedBranch.rows[0].stock_quantity === 0 &&
      storedBranch.rows[0].version > 1,
    "merchant controls branch availability, ETA and per-branch inventory used by quoting",
  );
  await request("/restaurants/rest_roja/menu/item_burger_brava", {
    method: "PATCH",
    body: JSON.stringify({ stock: false }),
  });
  const unavailableReplacement = await request(
    "/restaurants/rest_roja/branches/branch_rest_roja/inventory/item_papas_trufa",
    {
      method: "PATCH",
      body: JSON.stringify({ available: false, stockQuantity: 0 }),
    },
  );
  const rejectedUnavailableReplacement = await request(
    `/orders/${settlementOrderId}/substitutions`,
    {
      method: "POST",
      body: JSON.stringify({
        originalMenuItemId: "item_burger_brava",
        replacementMenuItemId: "item_papas_trufa",
        reason: "Burger sin stock durante preparación",
      }),
    },
  );
  const restoredReplacement = await request(
    "/restaurants/rest_roja/branches/branch_rest_roja/inventory/item_papas_trufa",
    {
      method: "PATCH",
      body: JSON.stringify({ available: true }),
    },
  );
  assert(
    unavailableReplacement.status === 200 &&
      rejectedUnavailableReplacement.status === 409 &&
      restoredReplacement.status === 200,
    "merchant cannot propose a replacement without sufficient stock in the order branch",
  );
  const proposedSubstitution = await request(`/orders/${settlementOrderId}/substitutions`, {
    method: "POST",
    body: JSON.stringify({
      originalMenuItemId: "item_burger_brava",
      replacementMenuItemId: "item_papas_trufa",
      reason: "Burger sin stock durante preparación",
    }),
  });
  ctx.substitutionId = proposedSubstitution.body.substitution?.id;
  const blockedAdvance = await request(`/orders/${settlementOrderId}/advance`, {
    method: "POST",
    body: "{}",
  });
  assert(
    proposedSubstitution.status === 201 && ctx.substitutionId && blockedAdvance.status === 409,
    "merchant proposes a lower-priced in-stock replacement and pending decision blocks order progress",
  );
  ctx.token = ctx.customerToken;
  const customerSubstitutions = await request(`/orders/${settlementOrderId}/substitutions`);
  const acceptedSubstitution = await request(`/order-substitutions/${substitutionId}`, {
    method: "PATCH",
    body: JSON.stringify({ decision: "accepted" }),
  });
  const substitutionOrder = (await request("/me/activity?limit=50")).body.items.find(
      (entry) => entry.id === ctx.settlementOrderId,
    )?.resource,
    substitutionLedger = await pool.query(
      `SELECT b.entry_count,b.imbalance_cents FROM ledger_transaction_balances b JOIN ledger_transactions t ON t.id=b.transaction_id WHERE t.idempotency_key=$1`,
      [`substitution-refund-${substitutionId}`],
    ),
    substitutionWalletAfter = (await request("/me")).body.account.user.wallet;
  const substitutionOk =
    customerSubstitutions.body.substitutions?.some(
      (entry) => entry.id === ctx.substitutionId && entry.status === "pending",
    ) &&
    acceptedSubstitution.status === 200 &&
    acceptedSubstitution.body.substitution.refundAmount === 3300 &&
    substitutionOrder.items.some((entry) => entry.menuItemId === "item_papas_trufa") &&
    substitutionWalletAfter === ctx.substitutionWalletBefore + 3300 &&
    Number(substitutionLedger.rows[0]?.imbalance_cents) === 0 &&
    Number(substitutionLedger.rows[0]?.entry_count) === 2;
  if (!substitutionOk)
    console.error("substitution diagnostic", {
      customerSubstitutions,
      acceptedSubstitution,
      items: substitutionOrder?.items,
      walletBefore: ctx.substitutionWalletBefore,
      walletAfter: substitutionWalletAfter,
      ledger: substitutionLedger.rows,
    });
  assert(
    substitutionOk,
    "customer accepts substitution, order snapshot changes and Wallet receives the exact balanced price difference",
  );
  ctx.token = ctx.merchantSubLogin.body.token;
  const merchantPreparing = await request(`/orders/${settlementOrderId}/advance`, {
      method: "POST",
      body: "{}",
    }),
    merchantReady = await request(`/orders/${settlementOrderId}/advance`, {
      method: "POST",
      body: "{}",
    });
  assert(
    merchantPreparing.body.order?.status === "preparing" &&
      merchantReady.body.order?.status === "ready_for_pickup",
    "merchant advances paid food through preparation before dispatch",
  );
  const driverLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "conductor@flash.app",
      password: "demo123",
      deviceName: "postgres-smoke-driver",
    }),
  });
  ctx.driverToken = driverLogin.body.token;
  ctx.runtimeDriverId = driverLogin.body.user?.driverId;
  ctx.token = ctx.driverToken;
  const settlementOffers = await request("/driver/offers"),
    settlementOffer = settlementOffers.body.offers?.find(
      (entry) => entry.jobId === ctx.settlementOrderId,
    );
  assert(
    settlementOffer &&
      (
        await request(`/orders/${settlementOrderId}/accept-delivery`, {
          method: "POST",
          body: JSON.stringify({ driverId: ctx.runtimeDriverId }),
        })
      ).status === 200,
    "driver accepts the settlement order from a private offer",
  );

  // -------------------------------------------------------------------------
  // Soltar un servicio asignado (OPS-001).
  //
  // El telefono que se apaga, la moto que se rompe, el que acepto y desaparecio.
  // Antes el trabajo quedaba con conductor puesto y sin forma de devolverlo al
  // despacho: se arreglaba con un UPDATE a mano.
  //
  // Se prueba justo despues de aceptar porque es el unico estado en que la
  // operacion es legitima, y el pedido se vuelve a tomar enseguida para que el
  // resto del flujo de liquidacion siga igual.
  // -------------------------------------------------------------------------
  const opsLoginRelease = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "ops@flash.app",
      password: "demo123",
      deviceName: "postgres-smoke-ops-release",
    }),
  });
  ctx.token = opsLoginRelease.body.token;
  const soltarSinMotivo = await request(`/admin/jobs/${settlementOrderId}/release`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  const soltado = await request(`/admin/jobs/${settlementOrderId}/release`, {
    method: "POST",
    body: JSON.stringify({ reason: "El conductor del smoke se quedo sin bateria" }),
  });
  const trasSoltar = (
    await pool.query(
      `SELECT j.driver_id, j.status,
              (SELECT count(*)::int FROM dispatch_offers o
                WHERE o.job_id=j.id AND o.status='pending') pendientes
       FROM jobs j WHERE j.public_id=$1`,
      [ctx.settlementOrderId],
    )
  ).rows[0];
  assert(
    soltarSinMotivo.status === 400 &&
      soltado.status === 200 &&
      trasSoltar.driver_id === null &&
      // Un pedido de comida se asigna solo desde `ready_for_pickup`, asi que ahi
      // vuelve: devolverlo a otro estado lo dejaria fuera del alcance del
      // despacho, que es lo contrario de lo que la operacion busca.
      trasSoltar.status === "ready_for_pickup" &&
      trasSoltar.pendientes === 0,
    "soltar exige motivo, quita el conductor, retira las ofertas y devuelve el pedido al despacho",
  );
  // Ya sin conductor, soltarlo otra vez no tiene sentido y se rechaza.
  assert(
    (
      await request(`/admin/jobs/${settlementOrderId}/release`, {
        method: "POST",
        body: JSON.stringify({ reason: "No deberia poder soltarse dos veces" }),
      })
    ).status === 409,
    "un servicio sin conductor no se puede soltar",
  );
  // Restituir la asignacion para que la liquidacion siga su curso.
  //
  // **Por la base y no por el despacho, a proposito.** Volver a ofrecerlo y
  // aceptarlo dependeria de a que conductor elige el despacho, que es una
  // decision de cercania y capacidad y no algo que esta prueba controle: el paso
  // fallaba de forma intermitente por un motivo que no tiene nada que ver con lo
  // que se esta probando. Lo que se afirma —que soltar funciona— ya se afirmo
  // arriba contra la API. Esto es preparacion de estado, y para eso el smoke usa
  // el pool privilegiado en todo el archivo.
  await pool.query(
    `UPDATE jobs SET driver_id=(SELECT id FROM drivers WHERE public_id=$2),
       status='driver_assigned', version=version+1, updated_at=now()
     WHERE public_id=$1`,
    [ctx.settlementOrderId, ctx.runtimeDriverId],
  );
  assert(
    (
      await pool.query(
        "SELECT driver_id IS NOT NULL AS asignado, status FROM jobs WHERE public_id=$1",
        [ctx.settlementOrderId],
      )
    ).rows[0]?.asignado === true,
    "el pedido queda reasignado para que la liquidacion siga su curso",
  );
  ctx.token = ctx.driverToken;
  await request(`/orders/${settlementOrderId}/advance`, {
    method: "POST",
    body: "{}",
  });
  await request(`/orders/${settlementOrderId}/advance`, {
    method: "POST",
    body: "{}",
  });
  const settledOrder = await request(`/orders/${settlementOrderId}/advance`, {
    method: "POST",
    body: "{}",
  });
  const settlementLedger = await pool.query(
    `SELECT b.entry_count,b.imbalance_cents,t.metadata FROM ledger_transaction_balances b JOIN ledger_transactions t ON t.id=b.transaction_id WHERE t.idempotency_key=$1`,
    [`settlement-${settlementOrderId}`],
  );
  const merchantBalanceAfter = Number(
    (
      await pool.query(
        `SELECT COALESCE(sum(
          CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END
        ),0)::bigint balance
        FROM merchants m
        JOIN ledger_accounts a
          ON a.owner_type='merchant' AND a.owner_id=m.id AND a.account_type='payable'
        LEFT JOIN ledger_entries e ON e.account_id=a.id
        WHERE m.public_id='rest_roja'`,
      )
    ).rows[0].balance,
  );
  const settlementOk =
    settledOrder.body.order?.status === "delivered" &&
    Number(settlementLedger.rows[0]?.imbalance_cents) === 0 &&
    Number(settlementLedger.rows[0]?.entry_count) >= 3 &&
    merchantBalanceAfter > ctx.merchantBalanceBefore;
  if (!settlementOk)
    console.error("settlement diagnostic", {
      settledOrder,
      ledger: settlementLedger.rows,
      merchantBalanceBefore: ctx.merchantBalanceBefore,
      merchantBalanceAfter,
    });
  assert(settlementOk, "completed order creates an exact balanced merchant/driver/platform split");
  // La propina, ya liberada. El asiento cuadrado que se afirma arriba es lo que
  // atrapa el error grande: si la liquidacion repartiera la propina en vez de
  // sacarla del total, el trigger `ledger_entries_must_balance` de la migracion
  // 003 rechazaria la transaccion entera al hacer commit.
  const propinaLiberada = (
    await pool.query(
      `SELECT t.status, t.driver_id, t.ledger_transaction_id, t.settled_at,
              (SELECT COALESCE(sum(e.amount_cents),0)::bigint
                 FROM ledger_entries e
                 JOIN ledger_accounts a ON a.id=e.account_id
                 JOIN drivers dr ON dr.user_id=a.owner_id
                WHERE e.transaction_id=t.ledger_transaction_id
                  AND e.direction='credit' AND a.account_type='wallet'
                  AND dr.id=t.driver_id) credito_al_conductor
       FROM service_tips t JOIN jobs j ON j.id=t.job_id WHERE j.public_id=$1`,
      [ctx.settlementOrderId],
    )
  ).rows[0];
  assert(
    propinaLiberada?.status === "released" &&
      propinaLiberada.driver_id !== null &&
      propinaLiberada.ledger_transaction_id !== null &&
      propinaLiberada.settled_at !== null,
    "al liquidar, la propina retenida queda pagada con destinatario y asiento",
  );
  assert(
    // El conductor cobra su parte del envio **mas** la propina completa. Si el
    // comercio o la plataforma se hubieran quedado con una parte, este credito
    // seria mas chico.
    Number(propinaLiberada.credito_al_conductor) ===
      Math.round(ctx.settlementQuote.body.quote.deliveryFee * 100) + ctx.propinaCents,
    "el conductor cobra el envio mas la propina entera, sin que nadie retenga una parte",
  );
  ctx.token = ctx.registeredToken;
  const foreignReorder = await request(`/orders/${settlementOrderId}/reorder`, {
    method: "POST",
    body: "{}",
  });
  ctx.token = ctx.customerToken;
  const reordered = await request(`/orders/${settlementOrderId}/reorder`, {
      method: "POST",
      body: "{}",
    }),
    currentPapasPrice =
      Number(
        (
          await pool.query(
            "SELECT unit_price_cents FROM catalog_items WHERE public_id='item_papas_trufa'",
          )
        ).rows[0].unit_price_cents,
      ) / 100;
  ctx.token = ctx.merchantSubLogin.body.token;
  await request("/restaurants/rest_roja/branches/branch_rest_roja/inventory/item_papas_trufa", {
    method: "PATCH",
    body: JSON.stringify({ available: false, stockQuantity: 0 }),
  });
  ctx.token = ctx.customerToken;
  const unavailableReorder = await request(`/orders/${settlementOrderId}/reorder`, {
    method: "POST",
    body: "{}",
  });
  ctx.token = ctx.merchantSubLogin.body.token;
  await request("/restaurants/rest_roja/branches/branch_rest_roja/inventory/item_papas_trufa", {
    method: "PATCH",
    body: JSON.stringify({ available: true, stockQuantity: null }),
  });
  assert(
    foreignReorder.status === 404 &&
      reordered.status === 200 &&
      reordered.body.cart.some(
        (line) => line.item.id === "item_papas_trufa" && line.item.price === currentPapasPrice,
      ) &&
      unavailableReorder.status === 409,
    "reorder enforces ownership and rebuilds the cart only from current catalog, modifier and branch inventory facts",
  );
  const merchantFinanceLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "comercio@flash.app",
      password: "demo123",
      deviceName: "postgres-smoke-merchant-finance",
    }),
  });
  ctx.token = merchantFinanceLogin.body.token;
  const merchantFinance = await request("/merchant/finance?merchantId=rest_roja");
  assert(
    merchantFinance.status === 200 &&
      merchantFinance.body.finance.availableBalance === merchantBalanceAfter / 100 &&
      merchantFinance.body.finance.movements.some((entry) => entry.kind === "merchant_settlement"),
    "merchant reads its PostgreSQL balance and settlement movements",
  );
  ctx.merchantPayoutKey = `payout-${crypto.randomUUID()}`;
  const payoutAmount = Math.max(
    0.01,
    Math.floor((merchantBalanceAfter - ctx.merchantBalanceBefore) / 2) / 100,
  );
  const payoutAuthorization = await request("/merchant/payouts/authorize", {
    method: "POST",
    body: JSON.stringify({ merchantId: "rest_roja", amount: payoutAmount, password: "demo123" }),
  });
  const payoutFirst = await request("/merchant/payouts", {
    method: "POST",
    headers: { "Idempotency-Key": ctx.merchantPayoutKey },
    body: JSON.stringify({
      merchantId: "rest_roja",
      amount: payoutAmount,
      authorizationToken: payoutAuthorization.body.authorizationToken,
    }),
  });
  const payoutSecond = await request("/merchant/payouts", {
    method: "POST",
    headers: { "Idempotency-Key": ctx.merchantPayoutKey },
    body: JSON.stringify({
      merchantId: "rest_roja",
      amount: payoutAmount,
      authorizationToken: payoutAuthorization.body.authorizationToken,
    }),
  });
  ctx.merchantPayoutId = payoutFirst.body.finance?.payouts?.find(
    (entry) => entry.amount === payoutAmount,
  )?.id;
  ctx.feedbackAuditRequestIds.push(payoutFirst.body.requestId, payoutSecond.body.requestId);
  const payoutRows = await pool.query(
    "SELECT count(*)::int count FROM payouts WHERE idempotency_key=$1",
    [ctx.merchantPayoutKey],
  );
  assert(
    payoutFirst.status === 201 &&
      payoutSecond.status === 201 &&
      ctx.merchantPayoutId &&
      payoutRows.rows[0].count === 1 &&
      payoutSecond.body.finance.availableBalance === payoutFirst.body.finance.availableBalance,
    "merchant payout reservation is authorized, funded and idempotent",
  );
  ctx.token = ctx.customerToken;
  assert(
    (await request("/merchant/finance?merchantId=rest_roja")).status === 403,
    "customer cannot read merchant finances",
  );
  ctx.token = ctx.driverToken;
  const rideOffers = await request("/driver/offers");
  assert(
    rideOffers.status === 200 &&
      rideOffers.body.offers?.some((entry) => entry.jobId === ctx.rideId && entry.kind === "ride"),
    "PostGIS dispatch creates a private expiring ride offer",
  );
  const concurrentAccepts = await Promise.all([
    request(`/rides/${rideId}/accept`, {
      method: "POST",
      body: JSON.stringify({ driverId: ctx.runtimeDriverId }),
    }),
    request(`/rides/${rideId}/accept`, {
      method: "POST",
      body: JSON.stringify({ driverId: ctx.runtimeDriverId }),
    }),
  ]);
  assert(
    concurrentAccepts.filter((entry) => entry.status === 200).length === 1 &&
      concurrentAccepts.filter((entry) => entry.status === 409).length === 1,
    "dispatch acceptance is atomic under concurrent requests",
  );
  const privateMessage = `Ubicación privada ${crypto.randomUUID()}`;
  ctx.token = ctx.customerToken;
  const customerMessage = await request(`/jobs/${rideId}/messages`, {
    method: "POST",
    body: JSON.stringify({ body: privateMessage }),
  });
  ctx.feedbackAuditRequestIds.push(customerMessage.body.requestId);
  const storedMessage = await pool.query(
    "SELECT body_ciphertext,body_sha256 FROM service_messages WHERE public_id=$1",
    [customerMessage.body.message?.id],
  );
  ctx.token = ctx.registeredToken;
  const foreignMessages = await request(`/jobs/${rideId}/messages`);
  ctx.token = ctx.merchantSubLogin.body.token;
  const unrelatedMerchantMessages = await request(`/jobs/${rideId}/messages`);
  ctx.token = ctx.driverToken;
  const driverMessages = await request(`/jobs/${rideId}/messages`),
    driverReply = await request(`/jobs/${rideId}/messages`, {
      method: "POST",
      body: JSON.stringify({ body: "Estoy llegando al punto indicado" }),
    });
  ctx.feedbackAuditRequestIds.push(driverReply.body.requestId);
  ctx.token = ctx.customerToken;
  const customerThread = await request(`/jobs/${rideId}/messages`);
  const leakedOperationalPayload = await pool.query(
      "SELECT count(*)::int count FROM audit_events WHERE request_id=ANY($1) AND after_data::text LIKE $2",
      [[customerMessage.body.requestId, driverReply.body.requestId], `%${privateMessage}%`],
    ),
    leakedRealtimePayload = await pool.query(
      "SELECT count(*)::int count FROM realtime_events WHERE request_id=ANY($1) AND payload::text LIKE $2",
      [[customerMessage.body.requestId, driverReply.body.requestId], `%${privateMessage}%`],
    );
  assert(
    customerMessage.status === 201 &&
      storedMessage.rows[0]?.body_ciphertext !== privateMessage &&
      !storedMessage.rows[0]?.body_ciphertext.includes(privateMessage) &&
      storedMessage.rows[0]?.body_sha256.length === 64 &&
      foreignMessages.status === 403 &&
      unrelatedMerchantMessages.status === 403 &&
      driverMessages.body.messages?.some((entry) => entry.body === privateMessage) &&
      driverReply.status === 201 &&
      customerThread.body.messages?.some(
        (entry) => entry.body === "Estoy llegando al punto indicado",
      ) &&
      leakedOperationalPayload.rows[0].count === 0 &&
      leakedRealtimePayload.rows[0].count === 0,
    "service chat encrypts message bodies, authorizes participants and excludes content from audit/realtime payloads",
  );
  ctx.token = ctx.driverToken;
  const driverCannotReadRidePin = await request(`/rides/${rideId}/pickup-code`),
    driverArriving = await request(`/rides/${rideId}/advance`, {
      method: "POST",
      body: "{}",
    }),
    unverifiedStart = await request(`/rides/${rideId}/advance`, {
      method: "POST",
      body: "{}",
    });
  ctx.token = ctx.customerToken;
  const customerRidePin = await request(`/rides/${rideId}/pickup-code`),
    customerCannotVerify = await request(`/rides/${rideId}/verify-pickup`, {
      method: "POST",
      body: JSON.stringify({ pin: customerRidePin.body.pickupCode }),
    });
  ctx.token = ctx.registeredToken;
  const foreignRidePin = await request(`/rides/${rideId}/pickup-code`);
  ctx.token = ctx.driverToken;
  const wrongPin = customerRidePin.body.pickupCode === "0000" ? "0001" : "0000";
  const wrongAttempts = [];
  for (let attempt = 0; attempt < 5; attempt += 1)
    wrongAttempts.push(
      await request(`/rides/${rideId}/verify-pickup`, {
        method: "POST",
        body: JSON.stringify({ pin: wrongPin }),
      }),
    );
  const lockedCorrect = await request(`/rides/${rideId}/verify-pickup`, {
    method: "POST",
    body: JSON.stringify({ pin: customerRidePin.body.pickupCode }),
  });
  const pinAtRest = await pool.query(
    "SELECT v.pin_hash,v.failed_attempts,v.locked_until FROM ride_pickup_verifications v JOIN jobs j ON j.id=v.job_id WHERE j.public_id=$1",
    [ctx.rideId],
  );
  await pool.query(
    "UPDATE ride_pickup_verifications SET locked_until=now()-interval '1 second' WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1)",
    [ctx.rideId],
  );
  const verifiedPickup = await request(`/rides/${rideId}/verify-pickup`, {
      method: "POST",
      body: JSON.stringify({ pin: customerRidePin.body.pickupCode }),
    }),
    startedRide = await request(`/rides/${rideId}/advance`, {
      method: "POST",
      body: "{}",
    });
  ctx.feedbackAuditRequestIds.push(verifiedPickup.body.requestId);
  assert(
    driverCannotReadRidePin.status === 403 &&
      driverArriving.body.ride?.status === "arriving" &&
      unverifiedStart.status === 409 &&
      customerRidePin.status === 200 &&
      /^\d{4}$/.test(customerRidePin.body.pickupCode) &&
      customerCannotVerify.status === 403 &&
      foreignRidePin.status === 403 &&
      wrongAttempts.slice(0, 4).every((entry) => entry.status === 400) &&
      wrongAttempts[4].status === 429 &&
      lockedCorrect.status === 429 &&
      pinAtRest.rows[0]?.pin_hash !== customerRidePin.body.pickupCode &&
      pinAtRest.rows[0]?.failed_attempts === 5 &&
      pinAtRest.rows[0]?.locked_until &&
      verifiedPickup.body.verification?.verified &&
      startedRide.body.ride?.status === "in_progress",
    "ride pickup PIN blocks start, hides plaintext, enforces ownership and locks repeated failures",
  );
  ctx.token = ctx.customerToken;
  const ridePayment = await pool.query(
    "SELECT p.status,p.captured_amount_cents FROM payment_intents p JOIN jobs j ON j.id=p.job_id WHERE j.public_id=$1",
    [ctx.rideId],
  );
  assert(
    ridePayment.rows[0]?.status === "captured" &&
      (await request("/me")).body.account.user.wallet ===
        ctx.rideWalletBefore -
          ctx.rideFirst.body.ride.fare -
          substitutionOrder.total -
          // `substitutionOrder` **es** el pedido de liquidacion, y desde GTM-001
          // lleva propina: la billetera se debita `total + propina` en un solo
          // cargo. Restar solo el total dejaba la cuenta corta por exactamente
          // la propina, y afirmarla aca prueba de paso que se cobro una vez y no
          // dos.
          ctx.propinaCents / 100,
    "ride captures wallet atomically",
  );
  await pool.query("UPDATE jobs SET status='completed' WHERE public_id=$1", [ctx.rideId]);
  assert(
    (
      await request(`/jobs/${rideId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: "Mensaje tardío" }),
      })
    ).status === 409,
    "completed services close their operational chat",
  );
  const completedFixture = await pool.query(
    "SELECT public_id,status FROM jobs WHERE public_id=$1",
    [ctx.rideId],
  );
  assert(
    completedFixture.rows[0]?.status === "completed",
    "rating fixture reaches completed state",
  );
  const ratingCreated = await request("/ratings", {
    method: "POST",
    body: JSON.stringify({
      jobId: ctx.rideId,
      subjectType: "driver",
      score: 5,
      tags: ["seguro", "puntual"],
      comment: "Calificación runtime",
    }),
  });
  ctx.ratingId = ratingCreated.body.rating?.id;
  ctx.feedbackAuditRequestIds.push(ratingCreated.body.requestId);
  const duplicateRating = await request("/ratings", {
    method: "POST",
    body: JSON.stringify({
      jobId: ctx.rideId,
      subjectType: "driver",
      score: 4,
      tags: [],
      comment: "duplicada",
    }),
  });
  assert(
    ratingCreated.status === 201 && ctx.ratingId && duplicateRating.status === 409,
    "completed service accepts one server-scoped rating",
  );
  await pool.query("UPDATE jobs SET status='driver_assigned' WHERE public_id=$1", [ctx.rideId]);
  const rideCancelled = await request(`/rides/${rideId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "cancelled", reason: "long_wait" }),
  });
  assert(
    rideCancelled.status === 200 &&
      rideCancelled.body.ride.status === "cancelled" &&
      (await request("/me")).body.account.user.wallet ===
        // Misma correccion que en la captura: lo cobrado por el pedido de
        // liquidacion fue `total + propina`, y el reintegro del viaje devuelve
        // solo la tarifa del viaje.
        ctx.rideWalletBefore - substitutionOrder.total - ctx.propinaCents / 100,
    "ride cancellation refunds wallet atomically",
  );
  ctx.dispatchDriverOriginalOnline =
    (await pool.query("SELECT online FROM drivers WHERE public_id='drv_nico'")).rows[0]?.online ??
    null;
  await pool.query("UPDATE drivers SET online=false WHERE public_id='drv_nico'");
  ctx.shipmentPayload = {
    customerId: "usr_customer",
    pickup: "Defensa 982, San Telmo",
    destination: "Plaza Italia, Buenos Aires",
    pickupCoords: { lat: -34.6177, lng: -58.3621 },
    destinationCoords: { lat: -34.5814, lng: -58.4208 },
    recipientName: "Runtime Test",
    recipientPhone: "+5491100000000",
    packageSize: "small",
    description: "Documentos",
    weightKg: 0.5,
    deliveryNotes: "Recepción",
    paymentMethod: "Flash Wallet",
    termsAccepted: true,
  };
  const protectedShipmentPayload = {
      ...shipmentPayload,
      declaredValue: 100000,
      protection: "standard",
    },
    protectedShipmentQuote = await request("/shipments/quote", {
      method: "POST",
      body: JSON.stringify(protectedShipmentPayload),
    });
  assert(
    protectedShipmentQuote.status === 200 &&
      protectedShipmentQuote.body.quote?.protectionPremium === 1500 &&
      protectedShipmentQuote.body.quote?.deductible === 5000 &&
      protectedShipmentQuote.body.quote?.fare ===
        protectedShipmentQuote.body.quote?.breakdown?.transportFare + 1500,
    "shipment protection premium and deductible are calculated by the server",
  );
  const tamperedProtectedShipment = await request("/shipments", {
    method: "POST",
    headers: { "Idempotency-Key": `shipment-tamper-${crypto.randomUUID()}` },
    body: JSON.stringify({
      ...protectedShipmentPayload,
      declaredValue: 120000,
      quoteToken: protectedShipmentQuote.body.quote?.quoteToken,
    }),
  });
  assert(
    tamperedProtectedShipment.status === 409,
    "signed shipment quote rejects declared-value tampering",
  );
  const shipmentLockedQuote = await request("/shipments/quote", {
      method: "POST",
      body: JSON.stringify(ctx.shipmentPayload),
    }),
    lockedShipmentPayload = {
      ...shipmentPayload,
      quoteToken: shipmentLockedQuote.body.quote?.quoteToken,
    };
  assert(
    shipmentLockedQuote.body.quote?.pricingVersion === "AR-BA-SHIPMENT-2026.08" &&
      shipmentLockedQuote.body.quote?.quoteToken,
    "shipment quote returns a versioned signed price lock",
  );
  ctx.slaShipmentPayload = {
      ...shipmentPayload,
      itemCategory: "fragile",
      serviceLevel: "priority",
    },
    slaShipmentQuote = await request("/shipments/quote", {
      method: "POST",
      body: JSON.stringify(ctx.slaShipmentPayload),
    });
  assert(
    slaShipmentQuote.status === 200 &&
      slaShipmentQuote.body.quote?.itemCategory === "fragile" &&
      slaShipmentQuote.body.quote?.serviceLevel === "priority" &&
      slaShipmentQuote.body.quote?.breakdown?.categorySurcharge === 350 &&
      slaShipmentQuote.body.quote?.breakdown?.serviceMultiplier === 1.35 &&
      slaShipmentQuote.body.quote?.etaMin < shipmentLockedQuote.body.quote?.etaMin,
    "shipment category and SLA apply PostgreSQL handling, surcharge, transport multiplier and ETA",
  );
  assert(
    (
      await request("/shipments/quote", {
        method: "POST",
        body: JSON.stringify({
          ...shipmentPayload,
          itemCategory: "documents",
          weightKg: 6,
        }),
      })
    ).status === 400,
    "shipment category enforces its PostgreSQL weight limit",
  );
  assert(
    (
      await request("/shipments/quote", {
        method: "POST",
        body: JSON.stringify({
          ...shipmentPayload,
          serviceLevel: "express",
          destinationCoords: { lat: -34.25, lng: -58.85 },
        }),
      })
    ).status === 400,
    "shipment SLA enforces its PostgreSQL maximum service distance",
  );
  const tamperedSlaShipment = await request("/shipments", {
    method: "POST",
    headers: {
      "Idempotency-Key": `shipment-sla-tamper-${crypto.randomUUID()}`,
    },
    body: JSON.stringify({
      ...slaShipmentPayload,
      serviceLevel: "economy",
      quoteToken: slaShipmentQuote.body.quote?.quoteToken,
    }),
  });
  assert(
    tamperedSlaShipment.status === 409,
    "signed shipment quote rejects item-category or SLA tampering",
  );
  await pool.query(
    "UPDATE shipment_item_categories SET surcharge_cents=47500 WHERE code='fragile'",
  );
  const configuredSlaQuote = await request("/shipments/quote", {
    method: "POST",
    body: JSON.stringify(ctx.slaShipmentPayload),
  });
  await pool.query(
    "UPDATE shipment_item_categories SET surcharge_cents=35000 WHERE code='fragile'",
  );
  assert(
    configuredSlaQuote.body.quote?.fare === slaShipmentQuote.body.quote?.fare + 125,
    "shipment quote reacts to PostgreSQL category pricing instead of code constants",
  );
  ctx.shipmentWalletBefore = (await request("/me")).body.account.user.wallet;
  assert(
    (
      await request("/shipments", {
        method: "POST",
        body: JSON.stringify(lockedShipmentPayload),
      })
    ).status === 400,
    "shipment rejects missing idempotency key",
  );
  ctx.shipmentKey = `shipment-${crypto.randomUUID()}`;
  assert(
    (
      await request("/shipments", {
        method: "POST",
        headers: {
          "Idempotency-Key": `shipment-tamper-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          ...lockedShipmentPayload,
          destination: "Destino alterado",
        }),
      })
    ).status === 409,
    "signed shipment quote rejects a modified destination",
  );
  ctx.shipmentFirst = await request("/shipments", {
    method: "POST",
    headers: { "Idempotency-Key": ctx.shipmentKey },
    body: JSON.stringify(lockedShipmentPayload),
  });
  const shipmentSecond = await request("/shipments", {
    method: "POST",
    headers: { "Idempotency-Key": ctx.shipmentKey },
    body: JSON.stringify(lockedShipmentPayload),
  });
  ctx.shipmentId = ctx.shipmentFirst.body.shipment?.id;
  assert(
    ctx.shipmentFirst.status === 200 &&
      ctx.shipmentId &&
      shipmentSecond.body.shipment?.id === ctx.shipmentId &&
      /^\d{4}$/.test(ctx.shipmentFirst.body.shipment?.deliveryPin || ""),
    "shipment idempotency returns delivery PIN once",
  );
  const storedIdempotency = await pool.query(
    "SELECT response_body FROM idempotency_keys WHERE key=$1",
    [ctx.shipmentKey],
  );
  assert(
    !storedIdempotency.rows[0]?.response_body?.shipment?.deliveryPin &&
      !shipmentSecond.body.shipment?.deliveryPin,
    "idempotent retry and persisted response never retain delivery PIN",
  );
  ctx.token = ctx.driverToken;
  const shipmentOffers = await request("/driver/offers");
  const shipmentOffer = shipmentOffers.body.offers?.find((entry) => entry.jobId === ctx.shipmentId);
  assert(shipmentOffer?.expiresAt, "delivery dispatch exposes a time-bounded offer");
  const rejectedOffer = await request(`/driver/offers/${shipmentOffer.id}/reject`, {
      method: "POST",
      body: "{}",
    }),
    rejectedStatus = await pool.query("SELECT status FROM dispatch_offers WHERE public_id=$1", [
      shipmentOffer.id,
    ]);
  assert(
    rejectedOffer.status === 200 && rejectedStatus.rows[0]?.status === "rejected",
    "driver can reject only its own pending offer",
  );
  const anotherOffer = (
    await pool.query(
      "SELECT o.public_id FROM dispatch_offers o JOIN jobs j ON j.id=o.job_id WHERE j.public_id=$1 AND o.status='pending' LIMIT 1",
      [ctx.shipmentId],
    )
  ).rows[0];
  const expiringOfferId = anotherOffer?.public_id || shipmentOffer.id;
  await pool.query(
    "UPDATE dispatch_offers SET status='pending',expires_at=now()-interval '1 second' WHERE public_id=$1",
    [expiringOfferId],
  );
  await request("/driver/offers");
  const expiredStatus = await pool.query("SELECT status FROM dispatch_offers WHERE public_id=$1", [
    expiringOfferId,
  ]);
  assert(
    expiredStatus.rows[0]?.status === "expired",
    "expired offers are hidden and persisted as expired",
  );
  ctx.token = ctx.customerToken;
  assert(
    (
      await request(`/driver/offers/${shipmentOffer.id}/reject`, {
        method: "POST",
        body: "{}",
      })
    ).status === 403,
    "customers cannot manage driver offers",
  );
  await pool.query(
    "UPDATE drivers SET online=true,location_updated_at=now(),location_accuracy_m=20,location_source='foreground' WHERE public_id='drv_nico'",
  );
  await pool.query(
    `INSERT INTO dispatch_offers(public_id,job_id,driver_id,score,status,created_at,expires_at,responded_at) SELECT $1,
      j.id,
      d.id,
      0,
      'rejected',
      now()-interval '65 seconds',
      now()-interval '20 seconds',
      now()-interval '5 seconds' FROM jobs j CROSS JOIN drivers d WHERE j.public_id=$2 AND d.public_id='drv_nico' ON CONFLICT(job_id,driver_id) DO UPDATE SET status='rejected',
      created_at=now()-interval '65 seconds',
      expires_at=now()-interval '20 seconds',
      responded_at=now()-interval '5 seconds'`,
    [`OFR-HISTORY-${Date.now()}`, ctx.orderId],
  );
  const expectedNicoHistory = (
    await pool.query(
      `SELECT count(*) FILTER(WHERE o.status='accepted')::numeric
        /NULLIF(count(*) FILTER(WHERE o.status IN('accepted','rejected','expired')),0) acceptance_rate,
        avg(EXTRACT(epoch FROM(o.responded_at-o.created_at))) FILTER(
          WHERE o.responded_at IS NOT NULL AND o.status IN('accepted','rejected')
        ) response_seconds
      FROM dispatch_offers o
      JOIN jobs j ON j.id=o.job_id
      JOIN drivers d ON d.id=o.driver_id
      WHERE d.public_id='drv_nico' AND j.kind='delivery'
        AND o.created_at>=now()-interval '30 days'`,
    )
  ).rows[0];
  await pool.query(
    "UPDATE dispatch_offers SET status='expired',responded_at=now() WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1) AND status='pending'",
    [ctx.shipmentId],
  );
  await pool.query(
    "UPDATE jobs SET metadata=jsonb_set(metadata,'{dispatchNextAttemptAt}',to_jsonb('1970-01-01T00:00:00.000Z'::text),true) WHERE public_id=$1",
    [ctx.shipmentId],
  );
  const dispatchAdminLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "ops@flash.app",
      password: "demo123",
      deviceName: "postgres-smoke-dispatch",
    }),
  });
  ctx.token = dispatchAdminLogin.body.token;
  const reassignedBatch = await request("/admin/dispatch/process", {
    method: "POST",
    body: JSON.stringify({ limit: 20 }),
  });
  const reassignedOffer = await pool.query(
    "SELECT o.score_breakdown FROM dispatch_offers o JOIN jobs j ON j.id=o.job_id JOIN drivers d ON d.id=o.driver_id WHERE j.public_id=$1 AND d.public_id='drv_nico' AND o.status='pending'",
    [ctx.shipmentId],
  );
  const driverAlert = await pool.query(
    `SELECT count(*)::int count FROM notifications n
    JOIN users u ON u.id=n.user_id JOIN drivers d ON d.user_id=u.id
    WHERE d.public_id='drv_nico' AND n.template='dispatch_offer' AND n.payload->>'jobId'=$1`,
    [ctx.shipmentId],
  );
  const scoreBreakdown = reassignedOffer.rows[0]?.score_breakdown;
  assert(
    reassignedBatch.status === 200 &&
      reassignedOffer.rowCount === 1 &&
      driverAlert.rows[0].count === 1 &&
      Math.abs(scoreBreakdown.acceptanceRate - Number(expectedNicoHistory.acceptance_rate)) <
        0.0001 &&
      Math.abs(
        scoreBreakdown.averageResponseSeconds - Number(expectedNicoHistory.response_seconds),
      ) < 0.01,
    "dispatch worker ranks a new wave with persisted historical acceptance and response signals even with the background worker active",
  );
  ctx.token = ctx.customerToken;
  assert(
    ctx.shipmentFirst.body.shipment.fareBreakdown?.deliveryMultiplier >= 1.08 &&
      ctx.shipmentFirst.body.shipment.pickupLocation &&
      ctx.shipmentFirst.body.shipment.destinationLocation,
    "shipment exposes its PostGIS route and applies the zone multiplier",
  );
}
