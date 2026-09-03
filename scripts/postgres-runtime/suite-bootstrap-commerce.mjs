import crypto from "node:crypto";
import { config } from "../../server/config.js";

/** @param {import("./context.mjs").PostgresRuntimeContext} ctx */
export async function runBootstrapCommerceSuite(ctx) {
  const { assert, request, readSseUntil, addressValidationToken, pool, base } = ctx;
  await pool.query(
    "DELETE FROM transaction_risk_assessments WHERE customer_id IN(SELECT id FROM users WHERE email LIKE 'runtime-%@flash.test')",
  );
  await pool.query(
    "DELETE FROM users WHERE email LIKE 'runtime-%@flash.test' AND NOT EXISTS(SELECT 1 FROM jobs WHERE customer_id=users.id)",
  );
  await pool.query("UPDATE catalog_items SET available=true WHERE public_id='item_burger_brava'");
  await pool.query(
    "UPDATE catalog_branch_inventory SET available=true,stock_quantity=NULL WHERE catalog_item_id=(SELECT id FROM catalog_items WHERE public_id='item_burger_brava')",
  );
  await pool.query(
    "UPDATE merchant_branches SET open=true,status='active',eta_min=22 WHERE public_id='branch_rest_roja'",
  );
  await pool.query(
    "UPDATE drivers SET location_updated_at=now(),location_accuracy_m=20,location_source='foreground' WHERE current_location IS NOT NULL",
  );
  const ready = await request("/ready");
  assert(
    ready.status === 200 && ready.body.database?.ready && ready.body.authStore === "postgres",
    "PostgreSQL runtime ready",
  );
  assert(
    ready.body.fallbackDiagnostics?.sqliteReads === 0,
    "PostgreSQL runtime starts without SQLite fallback reads",
  );
  const metricsDenied = await fetch(`${base}/internal/metrics`),
    metricsAllowed = await fetch(`${base}/internal/metrics`, {
      headers: {
        Authorization: `Bearer ${process.env.METRICS_TOKEN || "local-metrics-token-change-before-prod"}`,
      },
    }),
    metricsText = await metricsAllowed.text();
  assert(
    [401, 429].includes(metricsDenied.status) &&
      metricsAllowed.status === 200 &&
      metricsText.includes("flash_http_requests_total") &&
      metricsText.includes("flash_http_request_duration_seconds_bucket") &&
      metricsText.includes("flash_jobs_active") &&
      metricsText.includes("flash_dispatch_offers") &&
      metricsText.includes("flash_realtime_events_retained") &&
      metricsText.includes("flash_payouts") &&
      metricsText.includes("flash_merchant_payable_cents") &&
      metricsText.includes("flash_service_tips_total") &&
      metricsText.includes("flash_merchant_payment_oauth_connections") &&
      metricsText.includes("flash_idempotency_keys") &&
      !metricsText.includes("cliente@flash.app") &&
      !metricsText.includes("Defensa 982"),
    "protected Prometheus metrics expose non-PII technical, latency, dispatch, realtime and finance signals",
  );
  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "cliente@flash.app",
      password: "demo123",
      deviceName: "postgres-smoke",
    }),
  });
  assert(login.status === 200 && login.body.token, "PostgreSQL login");
  ctx.token = login.body.token;
  ctx.customerToken = ctx.token;
  const liveController = new AbortController(),
    liveResponse = await fetch(`${base}/events`, {
      headers: { Authorization: `Bearer ${ctx.customerToken}` },
      signal: liveController.signal,
    }),
    liveReader = liveResponse.body.getReader();
  const connectedFrame = await readSseUntil(liveReader, "event: connected");
  assert(connectedFrame.includes("cursor"), "realtime connects with a durable PostgreSQL cursor");
  const liveEventId = `EVT-SMOKE-LIVE-${Date.now()}`;
  ctx.realtimeFixtureIds.push(liveEventId);
  await pool.query(
    `INSERT INTO realtime_events(public_id,type,audience_user_ids) VALUES($1,'cross_instance_fixture',ARRAY['usr_customer'])`,
    [liveEventId],
  );
  const externalFrame = await readSseUntil(liveReader, "cross_instance_fixture");
  assert(
    externalFrame.includes(liveEventId),
    "LISTEN/NOTIFY fans out an event written by another PostgreSQL connection",
  );
  liveController.abort();
  const replayCursor = (
    await pool.query("SELECT max(sequence_id)::bigint cursor FROM realtime_events")
  ).rows[0].cursor;
  const privateEventId = `EVT-SMOKE-PRIVATE-${Date.now()}`,
    replayEventId = `EVT-SMOKE-REPLAY-${Date.now()}`;
  ctx.realtimeFixtureIds.push(privateEventId, replayEventId);
  await pool.query(
    `INSERT INTO realtime_events(public_id,type,audience_user_ids) VALUES($1,'private_admin_fixture',ARRAY['usr_admin']),($2,'replay_customer_fixture',ARRAY['usr_customer'])`,
    [privateEventId, replayEventId],
  );
  const replayController = new AbortController(),
    replayResponse = await fetch(`${base}/events`, {
      headers: {
        Authorization: `Bearer ${ctx.customerToken}`,
        "Last-Event-ID": String(replayCursor),
      },
      signal: replayController.signal,
    }),
    replayReader = replayResponse.body.getReader();
  const replayFrame = await readSseUntil(replayReader, "replay_customer_fixture");
  assert(
    replayFrame.includes(replayEventId) && !replayFrame.includes(privateEventId),
    "reconnect replays only events authorized for the current user",
  );
  replayController.abort();
  const rawPushToken = `smoke-${crypto.randomUUID()}`;
  const deviceRegistration = await request("/devices", {
    method: "POST",
    body: JSON.stringify({
      platform: "web",
      pushToken: rawPushToken,
      appVersion: "runtime-smoke",
      deviceFingerprint: `fingerprint-${crypto.randomUUID()}`,
    }),
  });
  ctx.deviceId = deviceRegistration.body.device?.id;
  ctx.deviceAuditRequestId = deviceRegistration.body.requestId;
  const devices = await request("/devices");
  assert(
    deviceRegistration.status === 201 &&
      ctx.deviceId &&
      devices.body.devices?.some((entry) => entry.id === ctx.deviceId) &&
      !JSON.stringify(devices.body).includes("smoke-"),
    "device registry persists metadata without exposing push tokens",
  );
  const protectedToken = (
    await pool.query(
      "SELECT push_token,push_token_ciphertext,push_token_hash FROM user_devices WHERE public_id=$1",
      [ctx.deviceId],
    )
  ).rows[0];
  assert(
    protectedToken?.push_token === null &&
      protectedToken.push_token_ciphertext?.startsWith("v1.") &&
      protectedToken.push_token_hash?.length === 64 &&
      !JSON.stringify(protectedToken).includes(rawPushToken),
    "push token is encrypted at rest and deduplicated by keyed hash",
  );
  // Se pide por la ruta paginada, que es la que usa el producto. `/restaurants`
  // se retiró el 28 de agosto: devolvía la tabla entera sin autenticación ni
  // paginación. `getPostgresRestaurantPage` llama a la misma función con los ids
  // de la página, así que el shape —menú y sucursales incluidos— es idéntico.
  const restaurants = await request("/catalog/restaurants?limit=50");
  assert(
    restaurants.body.restaurants?.length >= 1 &&
      restaurants.body.restaurants[0].menu?.length >= 1 &&
      restaurants.body.restaurants
        .find((entry) => entry.id === "rest_roja")
        ?.branches?.some((branch) => branch.id === "branch_rest_roja" && branch.isPrimary),
    "PostgreSQL catalog exposes real merchant branches",
  );
  const state = await request("/me/activity?limit=50");
  assert(
    state.status === 200 && state.body.items?.length >= 1,
    "PostgreSQL scoped activity aggregation",
  );
  const runtimePromotions = await request("/promotions"),
    runtimeZones = await request("/zones");
  assert(
    runtimePromotions.body.promotions?.some((entry) => entry.code === "FLASH40"),
    "promotions load from PostgreSQL",
  );
  const runtimePricing = await request("/pricing");
  assert(
    runtimePricing.body.plans?.some(
      (entry) => entry.service === "ride" && entry.version === "AR-BA-RIDE-2026.08",
    ) && runtimePricing.body.plans?.some((entry) => entry.service === "shipment"),
    "versioned pricing plans load from PostgreSQL",
  );
  const shipmentOptions = await request("/shipment-options");
  assert(
    shipmentOptions.body.categories?.length === 4 &&
      shipmentOptions.body.serviceLevels?.length === 4 &&
      shipmentOptions.body.categories.some(
        (entry) => entry.code === "fragile" && entry.surcharge === 350,
      ),
    "mobile shipment categories and SLA load from PostgreSQL without hardcoded pricing",
  );
  const centroZone = runtimeZones.body.zones?.find((entry) => entry.id === "zone_centro");
  ctx.originalZoneMultiplier = centroZone?.deliveryMultiplier;
  assert(
    centroZone?.boundary?.length >= 4 && Number.isInteger(centroZone.activeRides),
    "service zones use PostGIS boundaries and live job counts",
  );
  const zonedRideQuote = await request("/rides/quote", {
    method: "POST",
    body: JSON.stringify({
      pickup: "Defensa 982, San Telmo",
      destination: "Aeroparque Jorge Newbery",
      service: "economy",
      pickupCoords: { lat: -34.6177, lng: -58.3621 },
      destinationCoords: { lat: -34.5596, lng: -58.4156 },
    }),
  });
  assert(
    zonedRideQuote.body.quote?.zoneId === "zone_santelmo" &&
      zonedRideQuote.body.quote.breakdown?.demandMultiplier >= 1.04 &&
      zonedRideQuote.body.quote.pricingVersion === "AR-BA-RIDE-2026.08",
    "ride quote applies PostGIS zone and versioned pricing plan",
  );
  const originalPricing = (
    await pool.query("SELECT config FROM pricing_plans WHERE service='ride' AND active")
  ).rows[0].config;
  let repricedQuote;
  try {
    await pool.query(
      "UPDATE pricing_plans SET config=jsonb_set(config,'{baseFare}',to_jsonb((config->>'baseFare')::numeric+123)) WHERE service='ride' AND active",
    );
    repricedQuote = await request("/rides/quote", {
      method: "POST",
      body: JSON.stringify({
        pickup: "Defensa 982, San Telmo",
        destination: "Aeroparque Jorge Newbery",
        service: "economy",
        pickupCoords: { lat: -34.6177, lng: -58.3621 },
        destinationCoords: { lat: -34.5596, lng: -58.4156 },
      }),
    });
  } finally {
    await pool.query("UPDATE pricing_plans SET config=$1 WHERE service='ride' AND active", [
      originalPricing,
    ]);
  }
  assert(
    repricedQuote.body.quote.fare > zonedRideQuote.body.quote.fare,
    "quote runtime reacts to PostgreSQL pricing changes instead of code constants",
  );
  const forbiddenZoneUpdate = await request("/zones/zone_centro", {
    method: "PATCH",
    body: JSON.stringify({ demandLevel: "low" }),
  });
  assert(forbiddenZoneUpdate.status === 403, "customer cannot manage service zones");
  assert(
    (await request("/admin/pricing/ride", { method: "POST", body: "{}" })).status === 403,
    "customer cannot publish pricing plans",
  );
  assert(
    (
      await request("/admin/shipment-item-categories/fragile", {
        method: "PATCH",
        body: JSON.stringify({ surcharge: 999 }),
      })
    ).status === 403,
    "customer cannot manage shipment category pricing",
  );
  assert(
    (
      await request("/admin/shipment-service-levels/priority", {
        method: "PATCH",
        body: JSON.stringify({ etaMultiplier: 0.9 }),
      })
    ).status === 403,
    "customer cannot manage shipment service levels",
  );
  assert(
    (await request("/admin/shipment-options")).status === 403,
    "customer cannot inspect inactive shipment configuration",
  );
  const favoriteAdded = await request("/favorites/rest_roja", {
    method: "PUT",
    body: JSON.stringify({ favorite: true }),
  });
  ctx.feedbackAuditRequestIds.push(favoriteAdded.body.requestId);
  // Se lee del snapshot de cuenta, que es de donde los lee el frente.
  // `GET /favorites` se retiró el 28 de agosto: servía las mismas filas, desde el
  // mismo repositorio, sin que ningún cliente la llamara.
  const favoriteRead = await request("/me");
  const favoriteRemoved = await request("/favorites/rest_roja", {
    method: "PUT",
    body: JSON.stringify({ favorite: false }),
  });
  ctx.feedbackAuditRequestIds.push(favoriteRemoved.body.requestId);
  assert(
    favoriteAdded.body.restaurantIds?.includes("rest_roja") &&
      favoriteRead.body.account?.favoriteRestaurantIds?.includes("rest_roja") &&
      !favoriteRemoved.body.restaurantIds?.includes("rest_roja"),
    "customer favorites persist in PostgreSQL",
  );
  const weakRegistration = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: "Weak Password",
      email: `weak-${crypto.randomUUID()}@flash.test`,
      password: "short",
    }),
  });
  assert(weakRegistration.status === 400, "registration rejects weak passwords");
  ctx.registeredEmail = `runtime-${crypto.randomUUID()}@flash.test`;
  const registration = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: "Runtime New User",
      email: ctx.registeredEmail,
      password: "runtime123",
      phone: "+5491100000011",
      deviceName: "postgres-smoke-registration",
    }),
  });
  ctx.registeredUserId = registration.body.user?.id;
  assert(
    registration.status === 200 &&
      ctx.registeredUserId &&
      registration.body.verificationRequired &&
      !registration.body.token,
    "new user registers unverified only in PostgreSQL runtime",
  );
  const unverifiedLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: ctx.registeredEmail, password: "runtime123" }),
  });
  const verified = await request("/auth/email-verification/confirm", {
    method: "POST",
    body: JSON.stringify({
      email: ctx.registeredEmail,
      code: registration.body.developmentCode,
    }),
  });
  assert(
    unverifiedLogin.status === 403 &&
      unverifiedLogin.body.verificationRequired &&
      verified.status === 200,
    "new account cannot authenticate before its one-time email verification",
  );
  ctx.token = "";
  for (let attempt = 0; attempt < 5; attempt += 1)
    await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: ctx.registeredEmail,
        password: "wrong-runtime-password",
      }),
    });
  const lockedLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: ctx.registeredEmail, password: "runtime123" }),
  });
  const lockState = (
    await pool.query(
      "SELECT failed_login_attempts,login_locked_until>now() locked FROM users WHERE public_id=$1",
      [ctx.registeredUserId],
    )
  ).rows[0];
  assert(
    lockedLogin.status === 401 && lockState.failed_login_attempts >= 5 && lockState.locked,
    "five invalid passwords persistently lock the account without revealing its state",
  );
  await pool.query(
    "UPDATE users SET login_locked_until=now()-interval '1 second' WHERE public_id=$1",
    [ctx.registeredUserId],
  );
  const recoveredLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: ctx.registeredEmail, password: "runtime123" }),
  });
  const recoveredState = (
    await pool.query(
      "SELECT failed_login_attempts,login_locked_until,last_login_at FROM users WHERE public_id=$1",
      [ctx.registeredUserId],
    )
  ).rows[0];
  assert(
    recoveredLogin.status === 200 &&
      recoveredLogin.body.token &&
      !Object.hasOwn(recoveredLogin.body.user, "loginLockedUntil") &&
      recoveredState.failed_login_attempts === 0 &&
      !recoveredState.login_locked_until &&
      recoveredState.last_login_at,
    "expired lock recovers on valid credentials and clears counters without leaking security fields",
  );
  ctx.registeredToken = recoveredLogin.body.token;
  ctx.registeredRefreshToken = recoveredLogin.body.refreshToken;
  ctx.token = ctx.registeredToken;
  const registeredState = await request("/me");
  assert(
    registeredState.status === 200 &&
      registeredState.body.account.user?.id === ctx.registeredUserId,
    "new PostgreSQL user appears in private account context",
  );
  ctx.token = ctx.customerToken;
  const invalidFoodPreferences = await request("/dietary-preferences", {
      method: "PUT",
      body: JSON.stringify({
        dietaryLabels: ["invented"],
        avoidedAllergens: [],
        hideIncompatible: true,
      }),
    }),
    savedFoodPreferences = await request("/dietary-preferences", {
      method: "PUT",
      body: JSON.stringify({
        dietaryLabels: ["vegetarian"],
        avoidedAllergens: ["milk", "peanuts"],
        hideIncompatible: true,
      }),
    }),
    readFoodPreferences = await request("/dietary-preferences"),
    excludedPizzaSearch = await request("/catalog/search?q=pizza"),
    compatibleFoodSearch = await request("/catalog/search?q=papas");
  await request("/dietary-preferences", {
    method: "PUT",
    body: JSON.stringify({
      dietaryLabels: [],
      avoidedAllergens: [],
      hideIncompatible: false,
    }),
  });
  const rankedPizzaSearch = await request("/catalog/search?q=pizza&limit=10"),
    pagedCatalogSearch = await request("/catalog/search?q=&limit=1&offset=0");
  ctx.token = ctx.registeredToken;
  const isolatedFoodPreferences = await request("/dietary-preferences");
  const preferenceRows = await pool.query(
    `SELECT u.public_id,
      p.hide_incompatible,
      (SELECT count(*) FROM user_avoided_allergens a WHERE a.user_id=u.id)::int avoided
    FROM users u JOIN user_dietary_profiles p ON p.user_id=u.id WHERE u.public_id='usr_customer'`,
  );
  assert(
    invalidFoodPreferences.status === 400 &&
      savedFoodPreferences.status === 200 &&
      readFoodPreferences.body.preferences.dietaryLabels[0].code === "vegetarian" &&
      readFoodPreferences.body.preferences.avoidedAllergens.length === 2 &&
      isolatedFoodPreferences.body.preferences.dietaryLabels.length === 0 &&
      preferenceRows.rows[0].avoided === 0,
    "dietary preferences persist per customer with controlled vocabularies and private reads",
  );
  // Cinco condiciones en una sola aserción daban un mensaje opaco: cuando
  // fallaba no se sabía cuál. El detalle hace diagnosticable el fallo sin
  // cambiar lo que se afirma.
  const searchDetail = JSON.stringify({
    excludedPizzaStatus: excludedPizzaSearch.status,
    excludedPizzaTotal: excludedPizzaSearch.body?.total,
    excludedPizzaResults: (excludedPizzaSearch.body?.results ?? []).map((r) => ({
      merchant: r.restaurantName,
      items: (r.matchedItems ?? []).map((i) => i.id),
    })),
    papasEncontradas: (compatibleFoodSearch.body?.results ?? []).some((entry) =>
      (entry.matchedItems ?? []).some((item) => item.id === "item_papas_trufa"),
    ),
    rankedPrimero: rankedPizzaSearch.body?.results?.[0]?.restaurantName ?? null,
    rankedItems: (rankedPizzaSearch.body?.results?.[0]?.matchedItems ?? []).map((i) => i.name),
    pagedLength: pagedCatalogSearch.body?.results?.length,
    pagedTotal: pagedCatalogSearch.body?.total,
  });
  if (
    !(
      excludedPizzaSearch.status === 200 &&
      excludedPizzaSearch.body.total === 0 &&
      compatibleFoodSearch.body.results.some((entry) =>
        entry.matchedItems.some((item) => item.id === "item_papas_trufa"),
      ) &&
      rankedPizzaSearch.body.results[0]?.matchedItems.some((item) =>
        item.name.toLowerCase().includes("pizza"),
      ) &&
      pagedCatalogSearch.body.results.length === 1 &&
      pagedCatalogSearch.body.total >= pagedCatalogSearch.body.results.length
    )
  ) {
    console.error(`diagnostico busqueda catalogo: ${searchDetail}`);
  }
  assert(
    excludedPizzaSearch.status === 200 &&
      excludedPizzaSearch.body.total === 0 &&
      compatibleFoodSearch.body.results.some((entry) =>
        entry.matchedItems.some((item) => item.id === "item_papas_trufa"),
      ) &&
      rankedPizzaSearch.body.results[0]?.matchedItems.some((item) =>
        item.name.toLowerCase().includes("pizza"),
      ) &&
      pagedCatalogSearch.body.results.length === 1 &&
      pagedCatalogSearch.body.total >= pagedCatalogSearch.body.results.length,
    "PostgreSQL catalog search ranks matches, paginates and applies the authenticated dietary profile",
  );
  ctx.token = ctx.customerToken;
  await request("/dietary-preferences", {
    method: "PUT",
    body: JSON.stringify({
      dietaryLabels: [],
      avoidedAllergens: [],
      hideIncompatible: false,
    }),
  });
  ctx.token = ctx.registeredToken;
  const profileUpdated = await request("/me", {
    method: "PATCH",
    body: JSON.stringify({
      name: "Runtime Updated User",
      phone: "+5491100000012",
      defaultAddress: "Av. Corrientes 1234, Buenos Aires",
    }),
  });
  assert(
    profileUpdated.status === 200 &&
      profileUpdated.body.account.user.name === "Runtime Updated User" &&
      profileUpdated.body.account.addresses?.[0]?.address.includes("Corrientes"),
    "new PostgreSQL user updates profile and account address",
  );
  const missingAddressValidation = await request("/addresses", {
    method: "POST",
    body: JSON.stringify({
      label: "Sin validar",
      address: "Texto del cliente",
      lat: -34.6,
      lng: -58.4,
      isDefault: false,
    }),
  });
  const foreignAddressValidation = await request("/addresses", {
    method: "POST",
    body: JSON.stringify({
      label: "Token ajeno",
      address: "Texto del cliente",
      lat: -34.6,
      lng: -58.4,
      isDefault: false,
      validationToken: addressValidationToken({
        userPublicId: "usr_customer",
        label: "Dirección de otro cliente",
        lat: -34.6,
        lng: -58.4,
      }),
    }),
  });
  assert(
    missingAddressValidation.status === 409 && foreignAddressValidation.status === 409,
    "PostgreSQL address writes require a validation bound to the authenticated customer",
  );
  const homeLabel = "Av. Corrientes 1234, Buenos Aires";
  const homeAddress = await request("/addresses", {
    method: "POST",
    body: JSON.stringify({
      label: "Casa",
      address: "Texto manipulado por el cliente",
      lat: 1,
      lng: 2,
      isDefault: true,
      validationToken: addressValidationToken({
        userPublicId: ctx.registeredUserId,
        label: homeLabel,
        lat: -34.6037,
        lng: -58.3938,
      }),
    }),
  });
  const workLabel = "Av. Santa Fe 1800, Buenos Aires";
  ctx.feedbackAuditRequestIds.push(homeAddress.body.requestId);
  const workAddress = await request("/addresses", {
    method: "POST",
    body: JSON.stringify({
      label: "Trabajo",
      address: workLabel,
      lat: -34.5942,
      lng: -58.3959,
      isDefault: false,
      validationToken: addressValidationToken({
        userPublicId: ctx.registeredUserId,
        label: workLabel,
        lat: -34.5942,
        lng: -58.3959,
      }),
    }),
  });
  ctx.feedbackAuditRequestIds.push(workAddress.body.requestId);
  assert(
    homeAddress.status === 201 &&
      homeAddress.body.address.isDefault &&
      homeAddress.body.address.address === homeLabel &&
      homeAddress.body.address.lat === -34.6037 &&
      homeAddress.body.address.isValidated &&
      homeAddress.body.address.geocodingProvider === config.maps.provider &&
      workAddress.status === 201 &&
      workAddress.body.addresses.length === 2,
    "address book persists the signed provider result instead of client-controlled coordinates",
  );
  const workId = workAddress.body.address.id;
  ctx.workId = workId;
  const homeId = homeAddress.body.address.id;
  const defaultChanged = await request(`/addresses/${workId}/default`, {
    method: "PATCH",
    body: "{}",
  });
  ctx.feedbackAuditRequestIds.push(defaultChanged.body.requestId);
  const accountWithAddress = await request("/me");
  assert(
    defaultChanged.status === 200 &&
      defaultChanged.body.address?.isDefault &&
      accountWithAddress.body.account.user.defaultAddress.includes("Santa Fe") &&
      accountWithAddress.body.account.addresses.filter((entry) => entry.isDefault).length === 1,
    `default address changes atomically and synchronizes the account (${defaultChanged.status}: ${defaultChanged.body.error || "unknown"})`,
  );
  const profileCannotDrift = await request("/me", {
    method: "PATCH",
    body: JSON.stringify({
      name: "Runtime Updated User",
      phone: "+5491100000012",
      defaultAddress: "Texto sin coordenadas",
    }),
  });
  assert(
    profileCannotDrift.body.account.user.defaultAddress.includes("Santa Fe"),
    "profile edits cannot desynchronize a geocoded default address",
  );

  // -------------------------------------------------------------------------
  // Pedidos grupales (GTM-001). Se prueban aca porque hay dos identidades
  // vivas: sin una segunda persona, un pedido grupal no prueba nada.
  // -------------------------------------------------------------------------
  ctx.token = ctx.customerToken;
  const grupoCreado = await request("/group-orders", {
    method: "POST",
    body: JSON.stringify({ restaurantId: "rest_roja", spendLimitCents: 900000 }),
  });
  ctx.grupoPublicId = grupoCreado.body.group?.id;
  assert(
    grupoCreado.status === 200 &&
      ctx.grupoPublicId &&
      grupoCreado.body.group.participants.length === 1 &&
      grupoCreado.body.group.participants[0].isHost === true &&
      /^[A-Z0-9]{6}$/.test(grupoCreado.body.group.joinCode || ""),
    "abrir un grupo deja al anfitrion adentro con un codigo compartible",
  );
  const codigoGrupo = grupoCreado.body.group.joinCode;

  // Sin ser parte no se ve, ni siquiera conociendo el id. El codigo es para
  // entrar, no para leer: al reves, cualquiera con un codigo filtrado leeria
  // quien pidio que en una oficina.
  ctx.token = ctx.registeredToken;
  const grupoAjeno = await request(`/group-orders/${grupoPublicId}`);
  const codigoInvalido = await request("/group-orders/join", {
    method: "POST",
    body: JSON.stringify({ joinCode: "ZZZZZZ" }),
  });
  assert(
    grupoAjeno.status === 404 && codigoInvalido.status === 404,
    "un grupo ajeno no se lee y un codigo inexistente no suma",
  );

  const sumado = await request("/group-orders/join", {
    method: "POST",
    body: JSON.stringify({ joinCode: codigoGrupo }),
  });
  const sumadoDeNuevo = await request("/group-orders/join", {
    method: "POST",
    body: JSON.stringify({ joinCode: codigoGrupo }),
  });
  assert(
    sumado.status === 200 &&
      sumado.body.group.participants.length === 2 &&
      // Volver a entrar con el mismo codigo no es un error: pasa cada vez que
      // alguien abre el enlace dos veces.
      sumadoDeNuevo.status === 200 &&
      sumadoDeNuevo.body.group.participants.length === 2,
    "sumarse con el codigo funciona y repetirlo no duplica ni falla",
  );

  // **El tope se verifica contra los precios de la base, no contra los que manda
  // el cliente.** Un tope que se pueda esquivar mandando precios inventados no
  // es un tope. La hamburguesa del padron vale $6.500, asi que dos superan el
  // tope de $9.000 y una no.
  const sobreTope = await request(`/group-orders/${grupoPublicId}/items`, {
    method: "PUT",
    body: JSON.stringify({
      items: [{ menuItemId: "item_burger_brava", quantity: 2, extras: [], note: "" }],
    }),
  });
  const bajoTope = await request(`/group-orders/${grupoPublicId}/items`, {
    method: "PUT",
    body: JSON.stringify({
      items: [{ menuItemId: "item_burger_brava", quantity: 1, extras: [], note: "sin cebolla" }],
    }),
  });
  assert(
    sobreTope.status === 409 &&
      bajoTope.status === 200 &&
      // Y lo rechazado no quedo guardado: la transaccion vuelve atras entera, o
      // el tope habria sido un cartel y no un limite.
      bajoTope.body.group.participants.find((p) => !p.isHost)?.items.length === 1,
    "el tope de gasto se aplica contra los precios de la base y lo rechazado no queda",
  );

  ctx.token = ctx.customerToken;
  await request(`/group-orders/${grupoPublicId}/items`, {
    method: "PUT",
    body: JSON.stringify({
      items: [{ menuItemId: "item_burger_brava", quantity: 1, extras: [], note: "bien cocida" }],
    }),
  });
  // Cerrar es del anfitrion. Sin esto, cualquiera del grupo podria cortar el
  // agregado de los demas.
  ctx.token = ctx.registeredToken;
  const cierreAjeno = await request(`/group-orders/${grupoPublicId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "locked" }),
  });
  ctx.token = ctx.customerToken;
  const cierre = await request(`/group-orders/${grupoPublicId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "locked" }),
  });
  assert(
    cierreAjeno.status === 409 && cierre.status === 200 && cierre.body.group.status === "locked",
    "solo el anfitrion cierra el grupo",
  );
  ctx.token = ctx.registeredToken;
  const agregarCerrado = await request(`/group-orders/${grupoPublicId}/items`, {
    method: "PUT",
    body: JSON.stringify({ items: [] }),
  });
  assert(agregarCerrado.status === 409, "con el grupo cerrado ya no se agrega ni se saca");

  ctx.token = ctx.customerToken;
  const checkoutGrupo = await request(`/group-orders/${grupoPublicId}/checkout`);
  assert(
    checkoutGrupo.status === 200 &&
      // Dos personas que piden lo mismo son **una linea de cantidad dos**: la
      // cocina lee un pedido, no un acta de quien pidio que.
      checkoutGrupo.body.items.length === 1 &&
      checkoutGrupo.body.items[0].quantity === 2 &&
      // Y las notas de las dos sobreviven. Perder «sin cebolla» porque otro
      // pidio lo mismo seria el error caro de esta funcion.
      checkoutGrupo.body.items[0].note.includes("sin cebolla") &&
      checkoutGrupo.body.items[0].note.includes("bien cocida"),
    "el grupo se entrega junto, con las lineas sumadas y sin perder notas",
  );
  ctx.token = ctx.customerToken;
  assert(
    (
      await request(`/addresses/${workId}`, {
        method: "PUT",
        body: JSON.stringify({
          label: "Intrusión",
          address: "Otra",
          lat: -34.6,
          lng: -58.4,
          isDefault: true,
          validationToken: addressValidationToken({
            userPublicId: "usr_customer",
            label: "Otra",
            lat: -34.6,
            lng: -58.4,
          }),
        }),
      })
    ).status === 404,
    "another customer cannot mutate a foreign address",
  );
  ctx.token = ctx.registeredToken;
  const homeUpdated = await request(`/addresses/${homeId}`, {
    method: "PUT",
    body: JSON.stringify({
      label: "Casa familiar",
      address: "Av. Corrientes 1234, CABA",
      lat: -34.6037,
      lng: -58.3938,
      isDefault: false,
      validationToken: addressValidationToken({
        userPublicId: ctx.registeredUserId,
        label: "Av. Corrientes 1234, CABA",
        lat: -34.6037,
        lng: -58.3938,
      }),
    }),
  });
  ctx.feedbackAuditRequestIds.push(homeUpdated.body.requestId);
  const homeDeleted = await request(`/addresses/${homeId}`, {
    method: "DELETE",
  });
  ctx.feedbackAuditRequestIds.push(homeDeleted.body.requestId);
  assert(
    homeUpdated.body.address.label === "Casa familiar" && homeDeleted.body.addresses.length === 1,
    "owner updates and deletes a saved address",
  );
  ctx.token = ctx.customerToken;
  const firstRecentDestination = await request("/ride-destinations", {
    method: "POST",
    body: JSON.stringify({
      label: "Aeroparque",
      address: "Aeroparque Jorge Newbery, CABA",
      lat: -34.5592,
      lng: -58.4156,
    }),
  });
  ctx.rideDestinationId = firstRecentDestination.body.destination?.id;
  const repeatedRecentDestination = await request("/ride-destinations", {
      method: "POST",
      body: JSON.stringify({
        label: "Aeroparque",
        address: "  AEROPARQUE   JORGE NEWBERY, CABA  ",
        lat: -34.5592,
        lng: -58.4156,
      }),
    }),
    customerRecentDestinations = await request("/ride-destinations");
  ctx.token = ctx.registeredToken;
  const foreignRecentDestinations = await request("/ride-destinations"),
    foreignRecentDelete = await request(`/ride-destinations/${rideDestinationId}`, {
      method: "DELETE",
    });
  ctx.token = ctx.customerToken;
  const deletedRecentDestination = await request(`/ride-destinations/${rideDestinationId}`, {
    method: "DELETE",
  });
  ctx.feedbackAuditRequestIds.push(deletedRecentDestination.body.requestId);
  ctx.rideDestinationId = null;
  assert(
    firstRecentDestination.status === 201 &&
      repeatedRecentDestination.body.destination?.id ===
        firstRecentDestination.body.destination?.id &&
      repeatedRecentDestination.body.destination?.useCount === 2 &&
      customerRecentDestinations.body.destinations?.some(
        (entry) => entry.id === firstRecentDestination.body.destination.id,
      ) &&
      foreignRecentDestinations.body.destinations?.length === 0 &&
      foreignRecentDelete.status === 404 &&
      deletedRecentDestination.status === 200,
    "ride destination history deduplicates geocoded recents and isolates ownership in PostgreSQL",
  );
  const trustedPhone = `+54911${String(Date.now()).slice(-8)}`,
    createdTrustedContact = await request("/ride-trusted-contacts", {
      method: "POST",
      body: JSON.stringify({
        name: "Contacto Runtime",
        relationship: "family",
        phone: trustedPhone,
      }),
    });
  ctx.trustedContactId = createdTrustedContact.body.contact?.id;
  ctx.feedbackAuditRequestIds.push(createdTrustedContact.body.requestId);
  const repeatedTrustedContact = await request("/ride-trusted-contacts", {
      method: "POST",
      body: JSON.stringify({
        name: "Familia Runtime",
        relationship: "friend",
        phone: trustedPhone,
      }),
    }),
    contactAtRest = await pool.query(
      "SELECT phone_ciphertext,phone_hash,phone_last4 FROM ride_trusted_contacts WHERE id=$1",
      [ctx.trustedContactId],
    );
  ctx.token = ctx.registeredToken;
  const foreignTrustedContacts = await request("/ride-trusted-contacts"),
    foreignTrustedDelete = await request(`/ride-trusted-contacts/${trustedContactId}`, {
      method: "DELETE",
    });
  ctx.token = ctx.customerToken;
  const ownTrustedContacts = await request("/ride-trusted-contacts"),
    deletedTrustedContact = await request(`/ride-trusted-contacts/${trustedContactId}`, {
      method: "DELETE",
    });
  ctx.feedbackAuditRequestIds.push(
    repeatedTrustedContact.body.requestId,
    deletedTrustedContact.body.requestId,
  );
  ctx.trustedContactId = null;
  assert(
    createdTrustedContact.status === 201 &&
      repeatedTrustedContact.body.contact?.id === createdTrustedContact.body.contact?.id &&
      repeatedTrustedContact.body.contact?.name === "Familia Runtime" &&
      contactAtRest.rows[0]?.phone_ciphertext !== trustedPhone &&
      contactAtRest.rows[0]?.phone_hash.length === 64 &&
      contactAtRest.rows[0]?.phone_last4 === trustedPhone.slice(-4) &&
      foreignTrustedContacts.body.contacts?.length === 0 &&
      foreignTrustedDelete.status === 404 &&
      ownTrustedContacts.body.contacts?.some(
        (entry) => entry.id === createdTrustedContact.body.contact.id,
      ) &&
      deletedTrustedContact.status === 200,
    "trusted ride contacts are encrypted, deduplicated and isolated by ownership",
  );
  ctx.token = ctx.registeredToken;
  ctx.registeredRideKey = `registered-ride-${crypto.randomUUID()}`;
  const registeredRideInput = {
      pickup: "Av. Corrientes 1234, Buenos Aires",
      destination: "Obelisco, Buenos Aires",
      service: "economy",
      pickupCoords: { lat: -34.6037, lng: -58.3938 },
      destinationCoords: { lat: -34.6037, lng: -58.3816 },
    },
    registeredRideOptions = await request("/rides/options", {
      method: "POST",
      body: JSON.stringify(registeredRideInput),
    }),
    registeredRideQuote = registeredRideOptions.body.options?.find(
      (entry) => entry.service === "economy",
    );
  const registeredRide = await request("/rides", {
    method: "POST",
    headers: { "Idempotency-Key": ctx.registeredRideKey },
    body: JSON.stringify({
      customerId: ctx.registeredUserId,
      ...registeredRideInput,
      paymentMethod: "Efectivo",
      quoteToken: registeredRideQuote?.quoteToken,
    }),
  });
  ctx.registeredRideId = registeredRide.body.ride?.id;
  assert(
    registeredRide.status === 200 &&
      ctx.registeredRideId &&
      Number(
        (
          await pool.query(
            "SELECT count(*)::int count FROM jobs WHERE public_id=$1 AND customer_id=(SELECT id FROM users WHERE public_id=$2)",
            [ctx.registeredRideId, ctx.registeredUserId],
          )
        ).rows[0].count,
      ) === 1,
    "PostgreSQL-only registered user creates a ride without SQLite identity coupling",
  );
  ctx.token = ctx.customerToken;
  ctx.originalCart = (await request("/cart")).body.cart || [];
  const testCart = await request("/cart", {
    method: "PUT",
    body: JSON.stringify({
      restaurantId: "rest_roja",
      items: [
        {
          menuItemId: "item_burger_brava",
          quantity: 2,
          extras: ["extra_cheddar"],
          note: "runtime smoke",
        },
      ],
    }),
  });
  const modifierPrice =
    Number(
      (
        await pool.query(
          `SELECT m.price_cents FROM catalog_modifiers m
          JOIN catalog_modifier_groups g ON g.id=m.group_id
          JOIN catalog_items c ON c.id=g.catalog_item_id
          WHERE c.public_id='item_burger_brava' AND m.public_id='extra_cheddar'`,
        )
      ).rows[0]?.price_cents || 0,
    ) / 100;
  assert(
    testCart.status === 200 &&
      testCart.body.cart?.[0]?.quantity === 2 &&
      testCart.body.cart?.[0]?.item.price > modifierPrice,
    "PostgreSQL cart validates modifiers and snapshots the authoritative configured unit price",
  );
  const reloadedCart = await request("/cart");
  const invalidCartModifier = await request("/cart", {
    method: "PUT",
    body: JSON.stringify({
      restaurantId: "rest_roja",
      items: [
        {
          menuItemId: "item_burger_brava",
          quantity: 1,
          extras: ["invented-free-extra"],
          note: "",
        },
      ],
    }),
  });
  assert(
    reloadedCart.body.cart?.[0]?.note === "runtime smoke" && invalidCartModifier.status === 409,
    "PostgreSQL cart reloads selections and rejects invented modifiers",
  );
  ctx.customerAccount = (await request("/me")).body.account;
  ctx.checkoutAddress = ctx.customerAccount.addresses.find(
    (entry) =>
      entry.isDefault &&
      !entry.id.startsWith("profile-") &&
      entry.lat !== null &&
      entry.lng !== null,
  );
  ctx.payload = {
    customerId: "usr_customer",
    restaurantId: "rest_roja",
    deliveryAddressId: ctx.checkoutAddress?.id,
    deliveryAddress: "Defensa 982, San Telmo",
    paymentMethod: "Flash Wallet",
    promotionCode: "FLASH40",
    items: [
      {
        menuItemId: "item_burger_brava",
        quantity: 1,
        extras: [],
        note: "runtime smoke",
      },
    ],
  };
  assert(ctx.checkoutAddress, "food checkout has a saved geocoded delivery address");
  ctx.unvalidatedAddressId = (
    await pool.query(
      `INSERT INTO addresses(user_id,label,formatted_address,location,is_default)
       SELECT id,'Runtime sin validar','Texto legacy',
         ST_SetSRID(ST_MakePoint(-58.3816,-34.6037),4326)::geography,false
       FROM users WHERE public_id='usr_customer'
       RETURNING id::text`,
    )
  ).rows[0].id;
  const unvalidatedFoodQuote = await request("/orders/quote", {
    method: "POST",
    body: JSON.stringify({ ...payload, deliveryAddressId: ctx.unvalidatedAddressId }),
  });
  assert(
    unvalidatedFoodQuote.status === 404,
    "food checkout rejects legacy coordinates without signed provider provenance",
  );
  ctx.foodQuote = await request("/orders/quote", {
    method: "POST",
    body: JSON.stringify(ctx.payload),
  });
  assert(
    ctx.foodQuote.status === 200 &&
      ctx.foodQuote.body.quote?.quoteToken &&
      ctx.foodQuote.body.quote?.addressValidation?.validatedAt &&
      ctx.foodQuote.body.quote?.pricingVersion === "AR-BA-FOOD-2026.08" &&
      ctx.foodQuote.body.quote?.distanceKm > 0,
    "food quote returns a real versioned distance price lock",
  );
  const modifierQuote = await request("/orders/quote", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        promotionCode: undefined,
        items: [
          {
            ...payload.items[0],
            extras: ["extra_cheddar"],
            note: "bien cocida",
          },
        ],
      }),
    }),
    invalidModifierQuote = await request("/orders/quote", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        items: [{ ...payload.items[0], extras: ["invented-free-extra"] }],
      }),
    }),
    duplicateModifierQuote = await request("/orders/quote", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        items: [{ ...payload.items[0], extras: ["extra_cheddar", "extra_cheddar"] }],
      }),
    });
  assert(
    modifierQuote.status === 200 &&
      modifierQuote.body.quote.items[0].modifiers[0].id === "extra_cheddar" &&
      modifierQuote.body.quote.items[0].unitPrice ===
        modifierQuote.body.quote.items[0].baseUnitPrice + modifierPrice &&
      invalidModifierQuote.status === 409 &&
      duplicateModifierQuote.status === 409,
    "checkout prices configured modifiers and rejects unknown or duplicate selections",
  );
}
