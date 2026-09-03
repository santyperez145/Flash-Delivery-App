import crypto from "node:crypto";
import { createPool } from "./db-client.mjs";
import { readDb } from "../server/store.js";
import { processPostgresDispatchBatch } from "../server/dispatch-repository.js";
import { closePostgres } from "../server/postgres.js";
import { issueGeocodeValidation } from "../server/geocoding-validation.js";
import { config } from "../server/config.js";

const base = process.env.API_URL || "http://127.0.0.1:4000/api";
const pool = createPool();
let token = "";
let customerToken = "";
let driverToken = "";
let runtimeDriverId = "";
let dispatchDriverOriginalOnline = null;
let supportTicketId = null;
let registeredUserId = null;
let registeredEmail = null;
let registeredToken = null;
let registeredRefreshToken = null;
let unvalidatedAddressId = null;
let registeredRideId = null;
let registeredRideKey = null;
let moderationDriverId = null;
let createdPromotionId = null;
let originalZoneMultiplier = null;
let ratingId = null;
let deviceId = null;
let deviceAuditRequestId = null;
let rideDestinationId = null;
let trustedContactId = null;
const feedbackAuditRequestIds = [];
let orderId = null;
let grupoPublicId = null;
let idempotencyKey = null;
let walletKey = null;
let rideId = null;
let rideKey = null;
let scheduledRideId = null;
let scheduledRideKey = null;
let shipmentId = null;
let shipmentKey = null;
let proofShipmentId = null;
let proofShipmentKey = null;
let tipKey = null;
let insufficientTipJobId = null;
let receiptId = null;
let settlementOrderId = null;
let settlementOrderKey = null;
let merchantPayoutKey = null;
let merchantPayoutId = null;
let orderIssueId = null;
let substitutionId = null;
let originalCart = [];
const webhookIds = [];
const realtimeFixtureIds = [];
const sqliteFingerprint = () =>
  crypto.createHash("sha256").update(JSON.stringify(readDb())).digest("hex");
const sqliteBefore = sqliteFingerprint();

function assert(condition, label) {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
}

function addressValidationToken({ userPublicId, label, lat, lng, placeId = null }) {
  return issueGeocodeValidation({
    result: { label, point: { lat, lng }, type: "street_address", placeId },
    provider: config.maps.provider,
    userPublicId,
    cache: "postgres-smoke",
  });
}

async function request(path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await response.json();
  return { status: response.status, body };
}

async function readSseUntil(reader, needle, timeoutMs = 4000) {
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const chunk = await Promise.race([
      reader.read(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`SSE timeout: ${needle}`)), remaining),
      ),
    ]);
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
    if (text.includes(needle)) return text;
  }
  throw new Error(`SSE event not received: ${needle}`);
}

try {
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
  token = login.body.token;
  customerToken = token;
  const liveController = new AbortController(),
    liveResponse = await fetch(`${base}/events`, {
      headers: { Authorization: `Bearer ${customerToken}` },
      signal: liveController.signal,
    }),
    liveReader = liveResponse.body.getReader();
  const connectedFrame = await readSseUntil(liveReader, "event: connected");
  assert(connectedFrame.includes("cursor"), "realtime connects with a durable PostgreSQL cursor");
  const liveEventId = `EVT-SMOKE-LIVE-${Date.now()}`;
  realtimeFixtureIds.push(liveEventId);
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
  realtimeFixtureIds.push(privateEventId, replayEventId);
  await pool.query(
    `INSERT INTO realtime_events(public_id,type,audience_user_ids) VALUES($1,'private_admin_fixture',ARRAY['usr_admin']),($2,'replay_customer_fixture',ARRAY['usr_customer'])`,
    [privateEventId, replayEventId],
  );
  const replayController = new AbortController(),
    replayResponse = await fetch(`${base}/events`, {
      headers: {
        Authorization: `Bearer ${customerToken}`,
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
  deviceId = deviceRegistration.body.device?.id;
  deviceAuditRequestId = deviceRegistration.body.requestId;
  const devices = await request("/devices");
  assert(
    deviceRegistration.status === 201 &&
      deviceId &&
      devices.body.devices?.some((entry) => entry.id === deviceId) &&
      !JSON.stringify(devices.body).includes("smoke-"),
    "device registry persists metadata without exposing push tokens",
  );
  const protectedToken = (
    await pool.query(
      "SELECT push_token,push_token_ciphertext,push_token_hash FROM user_devices WHERE public_id=$1",
      [deviceId],
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
  originalZoneMultiplier = centroZone?.deliveryMultiplier;
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
  feedbackAuditRequestIds.push(favoriteAdded.body.requestId);
  // Se lee del snapshot de cuenta, que es de donde los lee el frente.
  // `GET /favorites` se retiró el 28 de agosto: servía las mismas filas, desde el
  // mismo repositorio, sin que ningún cliente la llamara.
  const favoriteRead = await request("/me");
  const favoriteRemoved = await request("/favorites/rest_roja", {
    method: "PUT",
    body: JSON.stringify({ favorite: false }),
  });
  feedbackAuditRequestIds.push(favoriteRemoved.body.requestId);
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
  registeredEmail = `runtime-${crypto.randomUUID()}@flash.test`;
  const registration = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: "Runtime New User",
      email: registeredEmail,
      password: "runtime123",
      phone: "+5491100000011",
      deviceName: "postgres-smoke-registration",
    }),
  });
  registeredUserId = registration.body.user?.id;
  assert(
    registration.status === 200 &&
      registeredUserId &&
      registration.body.verificationRequired &&
      !registration.body.token,
    "new user registers unverified only in PostgreSQL runtime",
  );
  const unverifiedLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: registeredEmail, password: "runtime123" }),
  });
  const verified = await request("/auth/email-verification/confirm", {
    method: "POST",
    body: JSON.stringify({
      email: registeredEmail,
      code: registration.body.developmentCode,
    }),
  });
  assert(
    unverifiedLogin.status === 403 &&
      unverifiedLogin.body.verificationRequired &&
      verified.status === 200,
    "new account cannot authenticate before its one-time email verification",
  );
  token = "";
  for (let attempt = 0; attempt < 5; attempt += 1)
    await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: registeredEmail,
        password: "wrong-runtime-password",
      }),
    });
  const lockedLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: registeredEmail, password: "runtime123" }),
  });
  const lockState = (
    await pool.query(
      "SELECT failed_login_attempts,login_locked_until>now() locked FROM users WHERE public_id=$1",
      [registeredUserId],
    )
  ).rows[0];
  assert(
    lockedLogin.status === 401 && lockState.failed_login_attempts >= 5 && lockState.locked,
    "five invalid passwords persistently lock the account without revealing its state",
  );
  await pool.query(
    "UPDATE users SET login_locked_until=now()-interval '1 second' WHERE public_id=$1",
    [registeredUserId],
  );
  const recoveredLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: registeredEmail, password: "runtime123" }),
  });
  const recoveredState = (
    await pool.query(
      "SELECT failed_login_attempts,login_locked_until,last_login_at FROM users WHERE public_id=$1",
      [registeredUserId],
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
  registeredToken = recoveredLogin.body.token;
  registeredRefreshToken = recoveredLogin.body.refreshToken;
  token = registeredToken;
  const registeredState = await request("/me");
  assert(
    registeredState.status === 200 && registeredState.body.account.user?.id === registeredUserId,
    "new PostgreSQL user appears in private account context",
  );
  token = customerToken;
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
  token = registeredToken;
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
  token = customerToken;
  await request("/dietary-preferences", {
    method: "PUT",
    body: JSON.stringify({
      dietaryLabels: [],
      avoidedAllergens: [],
      hideIncompatible: false,
    }),
  });
  token = registeredToken;
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
        userPublicId: registeredUserId,
        label: homeLabel,
        lat: -34.6037,
        lng: -58.3938,
      }),
    }),
  });
  const workLabel = "Av. Santa Fe 1800, Buenos Aires";
  feedbackAuditRequestIds.push(homeAddress.body.requestId);
  const workAddress = await request("/addresses", {
    method: "POST",
    body: JSON.stringify({
      label: "Trabajo",
      address: workLabel,
      lat: -34.5942,
      lng: -58.3959,
      isDefault: false,
      validationToken: addressValidationToken({
        userPublicId: registeredUserId,
        label: workLabel,
        lat: -34.5942,
        lng: -58.3959,
      }),
    }),
  });
  feedbackAuditRequestIds.push(workAddress.body.requestId);
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
  const workId = workAddress.body.address.id,
    homeId = homeAddress.body.address.id;
  const defaultChanged = await request(`/addresses/${workId}/default`, {
    method: "PATCH",
    body: "{}",
  });
  feedbackAuditRequestIds.push(defaultChanged.body.requestId);
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
  token = customerToken;
  const grupoCreado = await request("/group-orders", {
    method: "POST",
    body: JSON.stringify({ restaurantId: "rest_roja", spendLimitCents: 900000 }),
  });
  grupoPublicId = grupoCreado.body.group?.id;
  assert(
    grupoCreado.status === 200 &&
      grupoPublicId &&
      grupoCreado.body.group.participants.length === 1 &&
      grupoCreado.body.group.participants[0].isHost === true &&
      /^[A-Z0-9]{6}$/.test(grupoCreado.body.group.joinCode || ""),
    "abrir un grupo deja al anfitrion adentro con un codigo compartible",
  );
  const codigoGrupo = grupoCreado.body.group.joinCode;

  // Sin ser parte no se ve, ni siquiera conociendo el id. El codigo es para
  // entrar, no para leer: al reves, cualquiera con un codigo filtrado leeria
  // quien pidio que en una oficina.
  token = registeredToken;
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

  token = customerToken;
  await request(`/group-orders/${grupoPublicId}/items`, {
    method: "PUT",
    body: JSON.stringify({
      items: [{ menuItemId: "item_burger_brava", quantity: 1, extras: [], note: "bien cocida" }],
    }),
  });
  // Cerrar es del anfitrion. Sin esto, cualquiera del grupo podria cortar el
  // agregado de los demas.
  token = registeredToken;
  const cierreAjeno = await request(`/group-orders/${grupoPublicId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "locked" }),
  });
  token = customerToken;
  const cierre = await request(`/group-orders/${grupoPublicId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "locked" }),
  });
  assert(
    cierreAjeno.status === 409 && cierre.status === 200 && cierre.body.group.status === "locked",
    "solo el anfitrion cierra el grupo",
  );
  token = registeredToken;
  const agregarCerrado = await request(`/group-orders/${grupoPublicId}/items`, {
    method: "PUT",
    body: JSON.stringify({ items: [] }),
  });
  assert(agregarCerrado.status === 409, "con el grupo cerrado ya no se agrega ni se saca");

  token = customerToken;
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
  token = customerToken;
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
  token = registeredToken;
  const homeUpdated = await request(`/addresses/${homeId}`, {
    method: "PUT",
    body: JSON.stringify({
      label: "Casa familiar",
      address: "Av. Corrientes 1234, CABA",
      lat: -34.6037,
      lng: -58.3938,
      isDefault: false,
      validationToken: addressValidationToken({
        userPublicId: registeredUserId,
        label: "Av. Corrientes 1234, CABA",
        lat: -34.6037,
        lng: -58.3938,
      }),
    }),
  });
  feedbackAuditRequestIds.push(homeUpdated.body.requestId);
  const homeDeleted = await request(`/addresses/${homeId}`, {
    method: "DELETE",
  });
  feedbackAuditRequestIds.push(homeDeleted.body.requestId);
  assert(
    homeUpdated.body.address.label === "Casa familiar" && homeDeleted.body.addresses.length === 1,
    "owner updates and deletes a saved address",
  );
  token = customerToken;
  const firstRecentDestination = await request("/ride-destinations", {
    method: "POST",
    body: JSON.stringify({
      label: "Aeroparque",
      address: "Aeroparque Jorge Newbery, CABA",
      lat: -34.5592,
      lng: -58.4156,
    }),
  });
  rideDestinationId = firstRecentDestination.body.destination?.id;
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
  token = registeredToken;
  const foreignRecentDestinations = await request("/ride-destinations"),
    foreignRecentDelete = await request(`/ride-destinations/${rideDestinationId}`, {
      method: "DELETE",
    });
  token = customerToken;
  const deletedRecentDestination = await request(`/ride-destinations/${rideDestinationId}`, {
    method: "DELETE",
  });
  feedbackAuditRequestIds.push(deletedRecentDestination.body.requestId);
  rideDestinationId = null;
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
  trustedContactId = createdTrustedContact.body.contact?.id;
  feedbackAuditRequestIds.push(createdTrustedContact.body.requestId);
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
      [trustedContactId],
    );
  token = registeredToken;
  const foreignTrustedContacts = await request("/ride-trusted-contacts"),
    foreignTrustedDelete = await request(`/ride-trusted-contacts/${trustedContactId}`, {
      method: "DELETE",
    });
  token = customerToken;
  const ownTrustedContacts = await request("/ride-trusted-contacts"),
    deletedTrustedContact = await request(`/ride-trusted-contacts/${trustedContactId}`, {
      method: "DELETE",
    });
  feedbackAuditRequestIds.push(
    repeatedTrustedContact.body.requestId,
    deletedTrustedContact.body.requestId,
  );
  trustedContactId = null;
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
  token = registeredToken;
  registeredRideKey = `registered-ride-${crypto.randomUUID()}`;
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
    headers: { "Idempotency-Key": registeredRideKey },
    body: JSON.stringify({
      customerId: registeredUserId,
      ...registeredRideInput,
      paymentMethod: "Efectivo",
      quoteToken: registeredRideQuote?.quoteToken,
    }),
  });
  registeredRideId = registeredRide.body.ride?.id;
  assert(
    registeredRide.status === 200 &&
      registeredRideId &&
      Number(
        (
          await pool.query(
            "SELECT count(*)::int count FROM jobs WHERE public_id=$1 AND customer_id=(SELECT id FROM users WHERE public_id=$2)",
            [registeredRideId, registeredUserId],
          )
        ).rows[0].count,
      ) === 1,
    "PostgreSQL-only registered user creates a ride without SQLite identity coupling",
  );
  token = customerToken;
  originalCart = (await request("/cart")).body.cart || [];
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
  const customerAccount = (await request("/me")).body.account;
  const checkoutAddress = customerAccount.addresses.find(
    (entry) =>
      entry.isDefault &&
      !entry.id.startsWith("profile-") &&
      entry.lat !== null &&
      entry.lng !== null,
  );
  let payload = {
    customerId: "usr_customer",
    restaurantId: "rest_roja",
    deliveryAddressId: checkoutAddress?.id,
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
  assert(checkoutAddress, "food checkout has a saved geocoded delivery address");
  unvalidatedAddressId = (
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
    body: JSON.stringify({ ...payload, deliveryAddressId: unvalidatedAddressId }),
  });
  assert(
    unvalidatedFoodQuote.status === 404,
    "food checkout rejects legacy coordinates without signed provider provenance",
  );
  const foodQuote = await request("/orders/quote", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  assert(
    foodQuote.status === 200 &&
      foodQuote.body.quote?.quoteToken &&
      foodQuote.body.quote?.addressValidation?.validatedAt &&
      foodQuote.body.quote?.pricingVersion === "AR-BA-FOOD-2026.08" &&
      foodQuote.body.quote?.distanceKm > 0,
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
    body: JSON.stringify(payload),
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
  payload = { ...payload, quoteToken: foodQuote.body.quote.quoteToken };
  const foreignAddressKey = `foreign-address-${crypto.randomUUID()}`;
  const foreignQuote = await request("/orders/quote", {
    method: "POST",
    body: JSON.stringify({ ...payload, deliveryAddressId: workId }),
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
    body: JSON.stringify({ ...payload, deliveryAddressId: workId }),
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
  const orderWalletBefore = customerAccount.user.wallet;
  const missingKey = await request("/orders", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  assert(missingKey.status === 400, "order rejects missing idempotency key");
  idempotencyKey = `runtime-${crypto.randomUUID()}`;
  const first = await request("/orders", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload),
  });
  const second = await request("/orders", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload),
  });
  if (first.status !== 200) console.error("branch checkout diagnostic", first, second);
  orderId = first.body.order?.id;
  assert(
    first.status === 200 && orderId && second.body.order?.id === orderId,
    "order idempotency returns one result",
  );
  const count = await pool.query("SELECT count(*)::int AS count FROM jobs WHERE public_id = $1", [
    orderId,
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
    [orderId],
  );
  assert(
    Number(foodRoute.rows[0].distance_m) > 0 &&
      first.body.order.pickupLocation &&
      first.body.order.deliveryLocation &&
      Math.abs(Number(foodRoute.rows[0].lat) - checkoutAddress.lat) < 0.0001 &&
      Math.abs(Number(foodRoute.rows[0].lng) - checkoutAddress.lng) < 0.0001 &&
      foodRoute.rows[0].location_estimated === "false" &&
      foodRoute.rows[0].address_id === checkoutAddress.id &&
      foodRoute.rows[0].quote_id === checkoutQuote.body.quote.quoteId &&
      foodRoute.rows[0].pricing_version === checkoutQuote.body.quote.pricingVersion &&
      first.body.order.deliveryFee === checkoutQuote.body.quote.deliveryFee,
    "food order persists and exposes its PostGIS route with exact signed pricing provenance",
  );
  const redemption = await pool.query(
    "SELECT count(*)::int count FROM promotion_redemptions pr JOIN jobs j ON j.id=pr.job_id WHERE j.public_id=$1",
    [orderId],
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
    [orderId],
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
    [orderId, `refund-${orderId}`],
  );
  assert(
    cancelledOrder.status === 200 &&
      cancelledOrder.body.order.status === "cancelled" &&
      refundedWallet === orderWalletBefore,
    "order cancellation refunds wallet atomically",
  );
  const cancelledOrderOffers = await pool.query(
    "SELECT count(*) FILTER(WHERE o.status='pending')::int pending FROM dispatch_offers o JOIN jobs j ON j.id=o.job_id WHERE j.public_id=$1",
    [orderId],
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
  walletKey = `wallet-${crypto.randomUUID()}`;
  const walletFirst = await request("/wallet/topup", {
    method: "POST",
    headers: { "Idempotency-Key": walletKey },
    body: JSON.stringify({ amount: 1234 }),
  });
  const walletSecond = await request("/wallet/topup", {
    method: "POST",
    headers: { "Idempotency-Key": walletKey },
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
    [walletKey],
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
  const rideWalletBefore = (await request("/me")).body.account.user.wallet;
  assert(
    (
      await request("/rides", {
        method: "POST",
        body: JSON.stringify(ridePayload),
      })
    ).status === 400,
    "ride rejects missing idempotency key",
  );
  rideKey = `ride-${crypto.randomUUID()}`;
  const rideWithoutQuote = await request("/rides", {
    method: "POST",
    headers: { "Idempotency-Key": `ride-unquoted-${crypto.randomUUID()}` },
    body: JSON.stringify({ ...ridePayload, quoteToken: undefined }),
  });
  assert(
    rideWithoutQuote.status === 400,
    "PostgreSQL ride rejects creation without a signed quote",
  );
  const rideFirst = await request("/rides", {
    method: "POST",
    headers: { "Idempotency-Key": rideKey },
    body: JSON.stringify(ridePayload),
  });
  const rideSecond = await request("/rides", {
    method: "POST",
    headers: { "Idempotency-Key": rideKey },
    body: JSON.stringify(ridePayload),
  });
  rideId = rideFirst.body.ride?.id;
  assert(
    rideFirst.status === 200 &&
      rideId &&
      rideSecond.body.ride?.id === rideId &&
      !rideFirst.body.ride?.driverId,
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
  scheduledRideKey = `scheduled-${crypto.randomUUID()}`;
  const scheduledFor = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const scheduledRide = await request("/rides", {
    method: "POST",
    headers: { "Idempotency-Key": scheduledRideKey },
    body: JSON.stringify({
      ...ridePayload,
      paymentMethod: "Efectivo",
      scheduledFor,
    }),
  });
  scheduledRideId = scheduledRide.body.ride?.id;
  const scheduledStored = await pool.query(
    `SELECT scheduled_for,
      (SELECT count(*)::int FROM dispatch_offers o WHERE o.job_id=j.id) offers,
      (SELECT count(*)::int FROM notifications n
        WHERE n.user_id=j.customer_id AND n.payload->>'jobId'=j.public_id
          AND n.template='ride_reminder'
      ) reminders
    FROM jobs j WHERE public_id=$1`,
    [scheduledRideId],
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
    await pool.query("SELECT scheduled_for FROM jobs WHERE public_id=$1", [scheduledRideId])
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
          [scheduledRideId],
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
    [scheduledRideId],
  );
  await processPostgresDispatchBatch({ limit: 20 });
  const activatedOffers = Number(
    (
      await pool.query(
        "SELECT count(*)::int count FROM dispatch_offers o JOIN jobs j ON j.id=o.job_id WHERE j.public_id=$1 AND o.status='pending'",
        [scheduledRideId],
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
        [scheduledRideId],
      )
    ).rows[0].count,
  );
  assert(
    cancelledScheduled.status === 200 && withdrawnScheduled === activatedOffers,
    "scheduled ride cancellation withdraws all pending offers",
  );
  await pool.query("UPDATE jobs SET created_at=now()-interval '2 hours' WHERE public_id=ANY($1)", [
    [orderId, rideId, scheduledRideId].filter(Boolean),
  ]);
  const merchantBalanceBefore = Number(
    (
      await pool.query(
        `SELECT COALESCE(sum(CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END),0)::bigint balance FROM merchants m LEFT JOIN ledger_accounts a ON a.owner_type='merchant' ,
          AND a.owner_id=m.id AND a.account_type='payable' LEFT JOIN ledger_entries e ON e.account_id=a.id WHERE m.public_id='rest_roja'`,
      )
    ).rows[0].balance,
  );
  settlementOrderKey = `settlement-${crypto.randomUUID()}`;
  const settlementPayload = {
    ...payload,
    promotionCode: undefined,
    quoteToken: undefined,
  };
  const settlementQuote = await request("/orders/quote", {
    method: "POST",
    body: JSON.stringify(settlementPayload),
  });
  // Propina tomada en el checkout (GTM-001). Va sobre el pedido que se liquida
  // porque el riesgo esta justo ahi: que el comercio o la plataforma se queden
  // con parte de ella. Es un error silencioso — nadie reclama una propina que
  // llego a la cuenta equivocada, porque nadie la ve.
  const propinaCents = 120000;
  const settlementOrder = await request("/orders", {
    method: "POST",
    headers: { "Idempotency-Key": settlementOrderKey },
    body: JSON.stringify({
      ...settlementPayload,
      quoteToken: settlementQuote.body.quote?.quoteToken,
      tipCents: propinaCents,
    }),
  });
  settlementOrderId = settlementOrder.body.order?.id;
  if (settlementOrder.status !== 200 || !settlementOrderId)
    console.error("settlement order diagnostic", settlementOrder);
  assert(
    settlementOrder.status === 200 && settlementOrderId,
    "captured food order is ready for settlement",
  );
  const preReadyDispatchOffers = Number(
    (
      await pool.query(
        "SELECT count(*)::int count FROM dispatch_offers offer JOIN jobs job ON job.id=offer.job_id WHERE job.public_id=$1",
        [settlementOrderId],
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
      [settlementOrderId],
    )
  ).rows[0];
  assert(
    propinaRetenida?.status === "held" &&
      Number(propinaRetenida.amount_cents) === propinaCents &&
      // Sin conductor asignado todavia: en el checkout no hay a quien pagarle, y
      // por eso la propina se retiene en vez de transferirse.
      propinaRetenida.driver_id === null,
    "la propina del checkout queda retenida y sin destinatario hasta que haya conductor",
  );
  assert(
    Number(propinaRetenida.charged_cents) ===
      Math.round(settlementQuote.body.quote.total * 100) + propinaCents,
    "se cobra el pedido y la propina en un solo cargo, no en dos",
  );
  const substitutionWalletBefore = (await request("/me")).body.account.user.wallet;
  const merchantSubLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "comercio@flash.app",
      password: "demo123",
      deviceName: "postgres-smoke-substitution",
    }),
  });
  token = customerToken;
  const forbiddenModifiers = await request(
    "/restaurants/rest_roja/menu/item_burger_brava/modifiers",
    { method: "PUT", body: JSON.stringify({ groups: [] }) },
  );
  token = merchantSubLogin.body.token;
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
  token = customerToken;
  const forbiddenDietary = await request("/restaurants/rest_roja/menu/item_burger_brava/dietary", {
    method: "PUT",
    body: JSON.stringify({ dietaryLabels: [], allergens: [] }),
  });
  token = merchantSubLogin.body.token;
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
  token = customerToken;
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
  token = merchantSubLogin.body.token;
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
  token = customerToken;
  const closedScheduleQuote = await request("/orders/quote", {
    method: "POST",
    body: JSON.stringify({ ...payload, branchId: "branch_rest_roja" }),
  });
  token = merchantSubLogin.body.token;
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
  token = customerToken;
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
  token = customerToken;
  assert(
    (
      await request("/restaurants/rest_roja/branches/branch_rest_roja", {
        method: "PATCH",
        body: JSON.stringify({ open: false }),
      })
    ).status === 403,
    "customer cannot manage merchant branches",
  );
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
  token = opsLoginSuspension.body.token;
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
  token = customerToken;
  const cotizacionSuspendida = await request("/orders/quote", {
    method: "POST",
    body: JSON.stringify(payload),
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
  token = opsLoginSuspension.body.token;
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

  token = merchantSubLogin.body.token;
  const pausedBranch = await request("/restaurants/rest_roja/branches/branch_rest_roja", {
    method: "PATCH",
    body: JSON.stringify({ open: false, etaMin: 31 }),
  });
  token = customerToken;
  const pausedBranchQuote = await request("/orders/quote", {
    method: "POST",
    body: JSON.stringify({ ...payload, branchId: "branch_rest_roja" }),
  });
  token = merchantSubLogin.body.token;
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
  substitutionId = proposedSubstitution.body.substitution?.id;
  const blockedAdvance = await request(`/orders/${settlementOrderId}/advance`, {
    method: "POST",
    body: "{}",
  });
  assert(
    proposedSubstitution.status === 201 && substitutionId && blockedAdvance.status === 409,
    "merchant proposes a lower-priced in-stock replacement and pending decision blocks order progress",
  );
  token = customerToken;
  const customerSubstitutions = await request(`/orders/${settlementOrderId}/substitutions`);
  const acceptedSubstitution = await request(`/order-substitutions/${substitutionId}`, {
    method: "PATCH",
    body: JSON.stringify({ decision: "accepted" }),
  });
  const substitutionOrder = (await request("/me/activity?limit=50")).body.items.find(
      (entry) => entry.id === settlementOrderId,
    )?.resource,
    substitutionLedger = await pool.query(
      `SELECT b.entry_count,b.imbalance_cents FROM ledger_transaction_balances b JOIN ledger_transactions t ON t.id=b.transaction_id WHERE t.idempotency_key=$1`,
      [`substitution-refund-${substitutionId}`],
    ),
    substitutionWalletAfter = (await request("/me")).body.account.user.wallet;
  const substitutionOk =
    customerSubstitutions.body.substitutions?.some(
      (entry) => entry.id === substitutionId && entry.status === "pending",
    ) &&
    acceptedSubstitution.status === 200 &&
    acceptedSubstitution.body.substitution.refundAmount === 3300 &&
    substitutionOrder.items.some((entry) => entry.menuItemId === "item_papas_trufa") &&
    substitutionWalletAfter === substitutionWalletBefore + 3300 &&
    Number(substitutionLedger.rows[0]?.imbalance_cents) === 0 &&
    Number(substitutionLedger.rows[0]?.entry_count) === 2;
  if (!substitutionOk)
    console.error("substitution diagnostic", {
      customerSubstitutions,
      acceptedSubstitution,
      items: substitutionOrder?.items,
      walletBefore: substitutionWalletBefore,
      walletAfter: substitutionWalletAfter,
      ledger: substitutionLedger.rows,
    });
  assert(
    substitutionOk,
    "customer accepts substitution, order snapshot changes and Wallet receives the exact balanced price difference",
  );
  token = merchantSubLogin.body.token;
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
  driverToken = driverLogin.body.token;
  runtimeDriverId = driverLogin.body.user?.driverId;
  token = driverToken;
  const settlementOffers = await request("/driver/offers"),
    settlementOffer = settlementOffers.body.offers?.find(
      (entry) => entry.jobId === settlementOrderId,
    );
  assert(
    settlementOffer &&
      (
        await request(`/orders/${settlementOrderId}/accept-delivery`, {
          method: "POST",
          body: JSON.stringify({ driverId: runtimeDriverId }),
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
  token = opsLoginRelease.body.token;
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
      [settlementOrderId],
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
    [settlementOrderId, runtimeDriverId],
  );
  assert(
    (
      await pool.query(
        "SELECT driver_id IS NOT NULL AS asignado, status FROM jobs WHERE public_id=$1",
        [settlementOrderId],
      )
    ).rows[0]?.asignado === true,
    "el pedido queda reasignado para que la liquidacion siga su curso",
  );
  token = driverToken;
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
    merchantBalanceAfter > merchantBalanceBefore;
  if (!settlementOk)
    console.error("settlement diagnostic", {
      settledOrder,
      ledger: settlementLedger.rows,
      merchantBalanceBefore,
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
      [settlementOrderId],
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
      Math.round(settlementQuote.body.quote.deliveryFee * 100) + propinaCents,
    "el conductor cobra el envio mas la propina entera, sin que nadie retenga una parte",
  );
  token = registeredToken;
  const foreignReorder = await request(`/orders/${settlementOrderId}/reorder`, {
    method: "POST",
    body: "{}",
  });
  token = customerToken;
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
  token = merchantSubLogin.body.token;
  await request("/restaurants/rest_roja/branches/branch_rest_roja/inventory/item_papas_trufa", {
    method: "PATCH",
    body: JSON.stringify({ available: false, stockQuantity: 0 }),
  });
  token = customerToken;
  const unavailableReorder = await request(`/orders/${settlementOrderId}/reorder`, {
    method: "POST",
    body: "{}",
  });
  token = merchantSubLogin.body.token;
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
  token = merchantFinanceLogin.body.token;
  const merchantFinance = await request("/merchant/finance?merchantId=rest_roja");
  assert(
    merchantFinance.status === 200 &&
      merchantFinance.body.finance.availableBalance === merchantBalanceAfter / 100 &&
      merchantFinance.body.finance.movements.some((entry) => entry.kind === "merchant_settlement"),
    "merchant reads its PostgreSQL balance and settlement movements",
  );
  merchantPayoutKey = `payout-${crypto.randomUUID()}`;
  const payoutAmount = Math.max(
    0.01,
    Math.floor((merchantBalanceAfter - merchantBalanceBefore) / 2) / 100,
  );
  const payoutAuthorization = await request("/merchant/payouts/authorize", {
    method: "POST",
    body: JSON.stringify({ merchantId: "rest_roja", amount: payoutAmount, password: "demo123" }),
  });
  const payoutFirst = await request("/merchant/payouts", {
    method: "POST",
    headers: { "Idempotency-Key": merchantPayoutKey },
    body: JSON.stringify({
      merchantId: "rest_roja",
      amount: payoutAmount,
      authorizationToken: payoutAuthorization.body.authorizationToken,
    }),
  });
  const payoutSecond = await request("/merchant/payouts", {
    method: "POST",
    headers: { "Idempotency-Key": merchantPayoutKey },
    body: JSON.stringify({
      merchantId: "rest_roja",
      amount: payoutAmount,
      authorizationToken: payoutAuthorization.body.authorizationToken,
    }),
  });
  merchantPayoutId = payoutFirst.body.finance?.payouts?.find(
    (entry) => entry.amount === payoutAmount,
  )?.id;
  feedbackAuditRequestIds.push(payoutFirst.body.requestId, payoutSecond.body.requestId);
  const payoutRows = await pool.query(
    "SELECT count(*)::int count FROM payouts WHERE idempotency_key=$1",
    [merchantPayoutKey],
  );
  assert(
    payoutFirst.status === 201 &&
      payoutSecond.status === 201 &&
      merchantPayoutId &&
      payoutRows.rows[0].count === 1 &&
      payoutSecond.body.finance.availableBalance === payoutFirst.body.finance.availableBalance,
    "merchant payout reservation is authorized, funded and idempotent",
  );
  token = customerToken;
  assert(
    (await request("/merchant/finance?merchantId=rest_roja")).status === 403,
    "customer cannot read merchant finances",
  );
  token = driverToken;
  const rideOffers = await request("/driver/offers");
  assert(
    rideOffers.status === 200 &&
      rideOffers.body.offers?.some((entry) => entry.jobId === rideId && entry.kind === "ride"),
    "PostGIS dispatch creates a private expiring ride offer",
  );
  const concurrentAccepts = await Promise.all([
    request(`/rides/${rideId}/accept`, {
      method: "POST",
      body: JSON.stringify({ driverId: runtimeDriverId }),
    }),
    request(`/rides/${rideId}/accept`, {
      method: "POST",
      body: JSON.stringify({ driverId: runtimeDriverId }),
    }),
  ]);
  assert(
    concurrentAccepts.filter((entry) => entry.status === 200).length === 1 &&
      concurrentAccepts.filter((entry) => entry.status === 409).length === 1,
    "dispatch acceptance is atomic under concurrent requests",
  );
  const privateMessage = `Ubicación privada ${crypto.randomUUID()}`;
  token = customerToken;
  const customerMessage = await request(`/jobs/${rideId}/messages`, {
    method: "POST",
    body: JSON.stringify({ body: privateMessage }),
  });
  feedbackAuditRequestIds.push(customerMessage.body.requestId);
  const storedMessage = await pool.query(
    "SELECT body_ciphertext,body_sha256 FROM service_messages WHERE public_id=$1",
    [customerMessage.body.message?.id],
  );
  token = registeredToken;
  const foreignMessages = await request(`/jobs/${rideId}/messages`);
  token = merchantSubLogin.body.token;
  const unrelatedMerchantMessages = await request(`/jobs/${rideId}/messages`);
  token = driverToken;
  const driverMessages = await request(`/jobs/${rideId}/messages`),
    driverReply = await request(`/jobs/${rideId}/messages`, {
      method: "POST",
      body: JSON.stringify({ body: "Estoy llegando al punto indicado" }),
    });
  feedbackAuditRequestIds.push(driverReply.body.requestId);
  token = customerToken;
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
  token = driverToken;
  const driverCannotReadRidePin = await request(`/rides/${rideId}/pickup-code`),
    driverArriving = await request(`/rides/${rideId}/advance`, {
      method: "POST",
      body: "{}",
    }),
    unverifiedStart = await request(`/rides/${rideId}/advance`, {
      method: "POST",
      body: "{}",
    });
  token = customerToken;
  const customerRidePin = await request(`/rides/${rideId}/pickup-code`),
    customerCannotVerify = await request(`/rides/${rideId}/verify-pickup`, {
      method: "POST",
      body: JSON.stringify({ pin: customerRidePin.body.pickupCode }),
    });
  token = registeredToken;
  const foreignRidePin = await request(`/rides/${rideId}/pickup-code`);
  token = driverToken;
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
    [rideId],
  );
  await pool.query(
    "UPDATE ride_pickup_verifications SET locked_until=now()-interval '1 second' WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1)",
    [rideId],
  );
  const verifiedPickup = await request(`/rides/${rideId}/verify-pickup`, {
      method: "POST",
      body: JSON.stringify({ pin: customerRidePin.body.pickupCode }),
    }),
    startedRide = await request(`/rides/${rideId}/advance`, {
      method: "POST",
      body: "{}",
    });
  feedbackAuditRequestIds.push(verifiedPickup.body.requestId);
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
  token = customerToken;
  const ridePayment = await pool.query(
    "SELECT p.status,p.captured_amount_cents FROM payment_intents p JOIN jobs j ON j.id=p.job_id WHERE j.public_id=$1",
    [rideId],
  );
  assert(
    ridePayment.rows[0]?.status === "captured" &&
      (await request("/me")).body.account.user.wallet ===
        rideWalletBefore -
          rideFirst.body.ride.fare -
          substitutionOrder.total -
          // `substitutionOrder` **es** el pedido de liquidacion, y desde GTM-001
          // lleva propina: la billetera se debita `total + propina` en un solo
          // cargo. Restar solo el total dejaba la cuenta corta por exactamente
          // la propina, y afirmarla aca prueba de paso que se cobro una vez y no
          // dos.
          propinaCents / 100,
    "ride captures wallet atomically",
  );
  await pool.query("UPDATE jobs SET status='completed' WHERE public_id=$1", [rideId]);
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
    [rideId],
  );
  assert(
    completedFixture.rows[0]?.status === "completed",
    "rating fixture reaches completed state",
  );
  const ratingCreated = await request("/ratings", {
    method: "POST",
    body: JSON.stringify({
      jobId: rideId,
      subjectType: "driver",
      score: 5,
      tags: ["seguro", "puntual"],
      comment: "Calificación runtime",
    }),
  });
  ratingId = ratingCreated.body.rating?.id;
  feedbackAuditRequestIds.push(ratingCreated.body.requestId);
  const duplicateRating = await request("/ratings", {
    method: "POST",
    body: JSON.stringify({
      jobId: rideId,
      subjectType: "driver",
      score: 4,
      tags: [],
      comment: "duplicada",
    }),
  });
  assert(
    ratingCreated.status === 201 && ratingId && duplicateRating.status === 409,
    "completed service accepts one server-scoped rating",
  );
  await pool.query("UPDATE jobs SET status='driver_assigned' WHERE public_id=$1", [rideId]);
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
        rideWalletBefore - substitutionOrder.total - propinaCents / 100,
    "ride cancellation refunds wallet atomically",
  );
  dispatchDriverOriginalOnline =
    (await pool.query("SELECT online FROM drivers WHERE public_id='drv_nico'")).rows[0]?.online ??
    null;
  await pool.query("UPDATE drivers SET online=false WHERE public_id='drv_nico'");
  const shipmentPayload = {
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
      body: JSON.stringify(shipmentPayload),
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
  const slaShipmentPayload = {
      ...shipmentPayload,
      itemCategory: "fragile",
      serviceLevel: "priority",
    },
    slaShipmentQuote = await request("/shipments/quote", {
      method: "POST",
      body: JSON.stringify(slaShipmentPayload),
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
    body: JSON.stringify(slaShipmentPayload),
  });
  await pool.query(
    "UPDATE shipment_item_categories SET surcharge_cents=35000 WHERE code='fragile'",
  );
  assert(
    configuredSlaQuote.body.quote?.fare === slaShipmentQuote.body.quote?.fare + 125,
    "shipment quote reacts to PostgreSQL category pricing instead of code constants",
  );
  const shipmentWalletBefore = (await request("/me")).body.account.user.wallet;
  assert(
    (
      await request("/shipments", {
        method: "POST",
        body: JSON.stringify(lockedShipmentPayload),
      })
    ).status === 400,
    "shipment rejects missing idempotency key",
  );
  shipmentKey = `shipment-${crypto.randomUUID()}`;
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
  const shipmentFirst = await request("/shipments", {
    method: "POST",
    headers: { "Idempotency-Key": shipmentKey },
    body: JSON.stringify(lockedShipmentPayload),
  });
  const shipmentSecond = await request("/shipments", {
    method: "POST",
    headers: { "Idempotency-Key": shipmentKey },
    body: JSON.stringify(lockedShipmentPayload),
  });
  shipmentId = shipmentFirst.body.shipment?.id;
  assert(
    shipmentFirst.status === 200 &&
      shipmentId &&
      shipmentSecond.body.shipment?.id === shipmentId &&
      /^\d{4}$/.test(shipmentFirst.body.shipment?.deliveryPin || ""),
    "shipment idempotency returns delivery PIN once",
  );
  const storedIdempotency = await pool.query(
    "SELECT response_body FROM idempotency_keys WHERE key=$1",
    [shipmentKey],
  );
  assert(
    !storedIdempotency.rows[0]?.response_body?.shipment?.deliveryPin &&
      !shipmentSecond.body.shipment?.deliveryPin,
    "idempotent retry and persisted response never retain delivery PIN",
  );
  token = driverToken;
  const shipmentOffers = await request("/driver/offers");
  const shipmentOffer = shipmentOffers.body.offers?.find((entry) => entry.jobId === shipmentId);
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
      [shipmentId],
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
  token = customerToken;
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
    [`OFR-HISTORY-${Date.now()}`, orderId],
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
    [shipmentId],
  );
  await pool.query(
    "UPDATE jobs SET metadata=jsonb_set(metadata,'{dispatchNextAttemptAt}',to_jsonb('1970-01-01T00:00:00.000Z'::text),true) WHERE public_id=$1",
    [shipmentId],
  );
  const dispatchAdminLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "ops@flash.app",
      password: "demo123",
      deviceName: "postgres-smoke-dispatch",
    }),
  });
  token = dispatchAdminLogin.body.token;
  const reassignedBatch = await request("/admin/dispatch/process", {
    method: "POST",
    body: JSON.stringify({ limit: 20 }),
  });
  const reassignedOffer = await pool.query(
    "SELECT o.score_breakdown FROM dispatch_offers o JOIN jobs j ON j.id=o.job_id JOIN drivers d ON d.id=o.driver_id WHERE j.public_id=$1 AND d.public_id='drv_nico' AND o.status='pending'",
    [shipmentId],
  );
  const driverAlert = await pool.query(
    `SELECT count(*)::int count FROM notifications n
    JOIN users u ON u.id=n.user_id JOIN drivers d ON d.user_id=u.id
    WHERE d.public_id='drv_nico' AND n.template='dispatch_offer' AND n.payload->>'jobId'=$1`,
    [shipmentId],
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
  token = customerToken;
  assert(
    shipmentFirst.body.shipment.fareBreakdown?.deliveryMultiplier >= 1.08 &&
      shipmentFirst.body.shipment.pickupLocation &&
      shipmentFirst.body.shipment.destinationLocation,
    "shipment exposes its PostGIS route and applies the zone multiplier",
  );
  const pin = await pool.query(
    "SELECT delivery_pin_hash FROM shipment_details sd JOIN jobs j ON j.id=sd.job_id WHERE j.public_id=$1",
    [shipmentId],
  );
  assert(
    pin.rows[0]?.delivery_pin_hash?.startsWith("$2b$") &&
      pin.rows[0].delivery_pin_hash !== shipmentFirst.body.shipment.deliveryPin,
    "shipment stores only bcrypt PIN hash",
  );
  const shipmentPayment = await pool.query(
    "SELECT p.status FROM payment_intents p JOIN jobs j ON j.id=p.job_id WHERE j.public_id=$1",
    [shipmentId],
  );
  assert(
    shipmentPayment.rows[0]?.status === "captured" &&
      (await request("/me")).body.account.user.wallet ===
        shipmentWalletBefore - shipmentFirst.body.shipment.fare,
    "shipment captures wallet atomically",
  );
  const shipmentCancelled = await request(`/shipments/${shipmentId}/status`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "cancelled",
      reason: "recipient_unavailable",
    }),
  });
  assert(
    shipmentCancelled.status === 200 &&
      shipmentCancelled.body.shipment.status === "cancelled" &&
      (await request("/me")).body.account.user.wallet === shipmentWalletBefore,
    "shipment cancellation refunds wallet atomically",
  );
  const cancellationRecords = await pool.query(
    `SELECT j.public_id,c.reason_code,c.refund_amount_cents FROM job_cancellations c JOIN jobs j ON j.id=c.job_id WHERE j.public_id=ANY($1)`,
    [[orderId, rideId, shipmentId]],
  );
  const cancellationState = await request("/me/activity?limit=50");
  assert(
    cancellationRecords.rowCount === 3 &&
      cancellationRecords.rows.find((row) => row.public_id === rideId)?.reason_code ===
        "long_wait" &&
      cancellationRecords.rows.find((row) => row.public_id === shipmentId)?.reason_code ===
        "recipient_unavailable" &&
      cancellationRecords.rows.every((row) => Number(row.refund_amount_cents) > 0) &&
      cancellationState.body.items.find((entry) => entry.id === rideId)?.resource?.cancellation
        ?.refundAmount === rideFirst.body.ride.fare,
    "cancellations persist actor reason and exact refund outcome for every vertical",
  );
  const proofPayload = {
      ...shipmentPayload,
      paymentMethod: "Flash Wallet",
      destination: "Obelisco, Buenos Aires",
      destinationCoords: { lat: -34.6037, lng: -58.3816 },
      signatureRequired: true,
    },
    proofQuote = await request("/shipments/quote", {
      method: "POST",
      body: JSON.stringify(proofPayload),
    });
  proofShipmentKey = `proof-${crypto.randomUUID()}`;
  const proofCreated = await request("/shipments", {
    method: "POST",
    headers: { "Idempotency-Key": proofShipmentKey },
    body: JSON.stringify({
      ...proofPayload,
      quoteToken: proofQuote.body.quote?.quoteToken,
    }),
  });
  proofShipmentId = proofCreated.body.shipment?.id;
  const proofPin = proofCreated.body.shipment?.deliveryPin;
  assert(
    proofCreated.body.shipment?.signatureRequired === true,
    "signed shipment quote persists the required receipt signature",
  );
  const ownerCode = await request(`/shipments/${proofShipmentId}/delivery-code`);
  assert(
    ownerCode.status === 200 && ownerCode.body.deliveryCode === proofPin,
    "shipment owner retrieves derivable delivery code without plaintext storage",
  );
  token = registeredToken;
  assert(
    (await request(`/shipments/${proofShipmentId}/delivery-code`)).status === 403,
    "another customer cannot read the delivery code",
  );
  token = driverToken;
  assert(
    (await request(`/shipments/${proofShipmentId}/delivery-code`)).status === 403,
    "driver cannot read the customer delivery code",
  );
  const proofOffers = await request("/driver/offers"),
    proofOffer = proofOffers.body.offers?.find((entry) => entry.jobId === proofShipmentId);
  assert(
    proofOffer &&
      (
        await request(`/shipments/${proofShipmentId}/accept`, {
          method: "POST",
          body: JSON.stringify({ driverId: runtimeDriverId }),
        })
      ).status === 200,
    "driver accepts proof-of-delivery shipment",
  );
  await request(`/shipments/${proofShipmentId}/advance`, {
    method: "POST",
    body: "{}",
  });
  await request(`/shipments/${proofShipmentId}/advance`, {
    method: "POST",
    body: "{}",
  });
  const deliveringProof = await request(`/shipments/${proofShipmentId}/advance`, {
    method: "POST",
    body: "{}",
  });
  assert(
    deliveringProof.body.shipment?.status === "delivering" &&
      (
        await request(`/shipments/${proofShipmentId}/advance`, {
          method: "POST",
          body: "{}",
        })
      ).status === 409,
    "shipment cannot complete without delivery PIN",
  );
  const missingPhotoProof = await request(`/shipments/${proofShipmentId}/verify-delivery`, {
    method: "POST",
    body: JSON.stringify({ pin: proofPin }),
  });
  assert(
    missingPhotoProof.status === 409,
    "shipment requires encrypted photo evidence before PIN verification",
  );
  token = registeredToken;
  assert(
    (await request(`/shipments/${proofShipmentId}/delivery-evidence`)).status === 403,
    "unrelated customer cannot inspect empty delivery evidence",
  );
  token = driverToken;
  const invalidEvidence = await request(`/shipments/${proofShipmentId}/delivery-evidence`, {
    method: "POST",
    body: JSON.stringify({
      type: "photo",
      mimeType: "image/jpeg",
      contentBase64: Buffer.from("not-an-image").toString("base64"),
    }),
  });
  assert(invalidEvidence.status === 400, "delivery evidence rejects MIME spoofing");
  const photoContent = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from(`flash-proof-${crypto.randomUUID()}`),
    ]),
    photoHash = crypto.createHash("sha256").update(photoContent).digest("hex"),
    uploadedEvidence = await request(`/shipments/${proofShipmentId}/delivery-evidence`, {
      method: "POST",
      body: JSON.stringify({
        type: "photo",
        mimeType: "image/jpeg",
        contentBase64: photoContent.toString("base64"),
        capturedAt: new Date().toISOString(),
        location: { lat: -34.6037, lng: -58.3816 },
      }),
    }),
    evidenceId = uploadedEvidence.body.evidence?.id,
    storedEvidence = await pool.query(
      "SELECT content_ciphertext,content_sha256 FROM shipment_delivery_evidence WHERE public_id=$1",
      [evidenceId],
    );
  assert(
    uploadedEvidence.status === 201 &&
      evidenceId &&
      storedEvidence.rows[0]?.content_sha256 === photoHash &&
      !storedEvidence.rows[0]?.content_ciphertext.includes(photoContent.toString("base64")),
    "assigned driver stores geolocated delivery photo encrypted at rest",
  );
  token = registeredToken;
  assert(
    (await request(`/shipment-delivery-evidence/${evidenceId}/content`)).status === 403,
    "unrelated customer cannot decrypt delivery evidence",
  );
  token = customerToken;
  const ownerEvidence = await request(`/shipments/${proofShipmentId}/delivery-evidence`),
    ownerEvidenceContent = await request(`/shipment-delivery-evidence/${evidenceId}/content`);
  assert(
    ownerEvidence.body.evidence?.[0]?.sha256 === photoHash &&
      ownerEvidenceContent.body.contentBase64 === photoContent.toString("base64"),
    "shipment owner verifies evidence metadata and authorized content",
  );
  token = driverToken;
  const missingSignatureProof = await request(`/shipments/${proofShipmentId}/verify-delivery`, {
    method: "POST",
    body: JSON.stringify({ pin: proofPin }),
  });
  assert(
    missingSignatureProof.status === 409,
    "shipment configured for signed receipt cannot complete with photo and PIN alone",
  );
  const signatureContent = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(`flash-signature-${crypto.randomUUID()}`),
  ]);
  assert(
    (
      await request(`/shipments/${proofShipmentId}/delivery-evidence`, {
        method: "POST",
        body: JSON.stringify({
          type: "signature",
          mimeType: "image/png",
          contentBase64: signatureContent.toString("base64"),
        }),
      })
    ).status === 400,
    "signature evidence rejects missing signer identity and consent",
  );
  const uploadedSignature = await request(`/shipments/${proofShipmentId}/delivery-evidence`, {
      method: "POST",
      body: JSON.stringify({
        type: "signature",
        mimeType: "image/png",
        contentBase64: signatureContent.toString("base64"),
        capturedAt: new Date().toISOString(),
        location: { lat: -34.6037, lng: -58.3816 },
        signerName: "Runtime Recipient",
        signerRelationship: "recipient",
        consentVersion: "shipment-receipt-v1",
      }),
    }),
    signatureRow = await pool.query(
      "SELECT signer_name,signer_relationship,consent_version,content_ciphertext FROM shipment_delivery_evidence WHERE public_id=$1",
      [uploadedSignature.body.evidence?.id],
    );
  assert(
    uploadedSignature.status === 201 &&
      signatureRow.rows[0]?.signer_name === "Runtime Recipient" &&
      signatureRow.rows[0]?.consent_version === "shipment-receipt-v1" &&
      !signatureRow.rows[0]?.content_ciphertext.includes(signatureContent.toString("base64")),
    "assigned driver stores signer identity, consent and encrypted handwritten evidence",
  );
  const wrongProof = await request(`/shipments/${proofShipmentId}/verify-delivery`, {
    method: "POST",
    body: JSON.stringify({ pin: proofPin === "0000" ? "9999" : "0000" }),
  });
  const failedProof = await pool.query(
    "SELECT delivery_pin_failed_attempts,delivery_verified_at FROM shipment_details sd JOIN jobs j ON j.id=sd.job_id WHERE j.public_id=$1",
    [proofShipmentId],
  );
  assert(
    wrongProof.status === 400 &&
      failedProof.rows[0]?.delivery_pin_failed_attempts === 1 &&
      !failedProof.rows[0]?.delivery_verified_at,
    "wrong delivery PIN is counted without exposing the secret",
  );
  await pool.query(
    "UPDATE shipment_details SET delivery_pin_failed_attempts=4 WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1)",
    [proofShipmentId],
  );
  const lockProof = await request(`/shipments/${proofShipmentId}/verify-delivery`, {
      method: "POST",
      body: JSON.stringify({ pin: "0000" }),
    }),
    blockedCorrect = await request(`/shipments/${proofShipmentId}/verify-delivery`, {
      method: "POST",
      body: JSON.stringify({ pin: proofPin }),
    });
  assert(
    lockProof.status === 429 && blockedCorrect.status === 429,
    "five failed PIN attempts lock verification even for a later correct code",
  );
  await pool.query(
    "UPDATE shipment_details SET delivery_pin_failed_attempts=0,delivery_pin_locked_until=NULL WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1)",
    [proofShipmentId],
  );
  const verifiedProof = await request(`/shipments/${proofShipmentId}/verify-delivery`, {
    method: "POST",
    body: JSON.stringify({ pin: proofPin }),
  });
  const proofLedger = await pool.query(
    "SELECT b.entry_count,b.imbalance_cents,t.metadata FROM ledger_transactions t JOIN ledger_transaction_balances b ON b.transaction_id=t.id WHERE t.idempotency_key=$1",
    [`driver-earning-envio-${proofShipmentId}`],
  );
  const repeatedProof = await request(`/shipments/${proofShipmentId}/verify-delivery`, {
    method: "POST",
    body: JSON.stringify({ pin: proofPin }),
  });
  if (verifiedProof.status !== 200 || !proofLedger.rows[0])
    console.error("mobility settlement diagnostic", verifiedProof, proofLedger.rows, repeatedProof);
  assert(
    verifiedProof.status === 200 &&
      verifiedProof.body.proof?.type === "pin+photo+signature" &&
      verifiedProof.body.shipment?.status === "delivered" &&
      Number(proofLedger.rows[0]?.entry_count) === 3 &&
      Number(proofLedger.rows[0]?.imbalance_cents) === 0 &&
      Number(proofLedger.rows[0]?.metadata?.driverCents) > 0 &&
      Number(proofLedger.rows[0]?.metadata?.platformCents) > 0 &&
      repeatedProof.status === 409,
    "correct PIN, photo and signature record proof and settle driver/platform exactly once with a balanced ledger",
  );
  token = customerToken;
  assert(
    (await request(`/shipments/${proofShipmentId}/delivery-code`)).status === 409,
    "delivery code becomes unavailable after completion",
  );
  token = registeredToken;
  assert(
    (
      await request(`/shipments/${proofShipmentId}/returns`, {
        method: "POST",
        body: JSON.stringify({ reason: "Intento sobre un envío ajeno" }),
      })
    ).status === 404,
    "another customer cannot request a return for a foreign shipment",
  );
  token = customerToken;
  const createdReturn = await request(`/shipments/${proofShipmentId}/returns`, {
      method: "POST",
      body: JSON.stringify({ reason: "El destinatario rechazó el paquete" }),
    }),
    shipmentReturnId = createdReturn.body.return?.id;
  assert(
    createdReturn.status === 201 &&
      shipmentReturnId &&
      (
        await request(`/shipments/${proofShipmentId}/returns`, {
          method: "POST",
          body: JSON.stringify({ reason: "Solicitud duplicada" }),
        })
      ).status === 409,
    "shipment owner creates exactly one return request",
  );
  const customerReturns = await request("/shipment-returns");
  assert(
    customerReturns.body.returns?.some((entry) => entry.id === shipmentReturnId),
    "shipment owner lists the return request",
  );
  token = registeredToken;
  assert(
    !(await request("/shipment-returns")).body.returns?.some(
      (entry) => entry.id === shipmentReturnId,
    ),
    "return listing is isolated between customers",
  );
  const returnsAdminLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "ops@flash.app",
      password: "demo123",
      deviceName: "postgres-smoke-returns",
    }),
  });
  token = returnsAdminLogin.body.token;
  assert(
    (
      await request(`/shipment-returns/${shipmentReturnId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "completed",
          resolution: "Salto inválido",
        }),
      })
    ).status === 409,
    "shipment return rejects invalid state transitions",
  );
  for (const [status, resolution] of [
    ["approved", "Retiro autorizado"],
    ["in_transit", "Paquete retirado"],
    ["completed", "Devuelto al remitente"],
  ]) {
    const transition = await request(`/shipment-returns/${shipmentReturnId}`, {
      method: "PATCH",
      body: JSON.stringify({ status, resolution }),
    });
    assert(
      transition.status === 200 && transition.body.return?.status === status,
      `shipment return transitions to ${status}`,
    );
  }
  token = customerToken;
  assert(
    (
      await request(`/jobs/${proofShipmentId}/tips`, {
        method: "POST",
        body: JSON.stringify({ amount: 500 }),
      })
    ).status === 400,
    "tip requires an idempotency key",
  );
  const excessiveTip = await request(`/jobs/${proofShipmentId}/tips`, {
    method: "POST",
    headers: { "Idempotency-Key": `tip-high-${crypto.randomUUID()}` },
    body: JSON.stringify({ amount: 100000 }),
  });
  assert(excessiveTip.status === 409, "tip is capped relative to service fare");
  insufficientTipJobId = `RIDE-TIP-FUNDS-${Date.now()}`;
  await pool.query(
    `INSERT INTO jobs(
      public_id,kind,customer_id,driver_id,status,pickup_address,pickup_location,
      dropoff_address,dropoff_location,service_level,quoted_amount_cents,
      final_amount_cents,distance_m,estimated_duration_s,metadata
    ) SELECT $1,'ride',u.id,d.id,'completed','A',
      ST_SetSRID(ST_MakePoint(-58.4,-34.6),4326)::geography,'B',
      ST_SetSRID(ST_MakePoint(-58.41,-34.61),4326)::geography,'economy',
      100000,100000,1000,600,'{}'
    FROM users u CROSS JOIN drivers d WHERE u.public_id=$2 AND d.public_id=$3`,
    [insufficientTipJobId, registeredUserId, runtimeDriverId],
  );
  token = registeredToken;
  const insufficientTip = await request(`/jobs/${insufficientTipJobId}/tips`, {
    method: "POST",
    headers: { "Idempotency-Key": `tip-funds-${crypto.randomUUID()}` },
    body: JSON.stringify({ amount: 100 }),
  });
  assert(
    insufficientTip.status === 402 &&
      Number(
        (
          await pool.query(
            "SELECT count(*)::int count FROM service_tips t JOIN jobs j ON j.id=t.job_id WHERE j.public_id=$1",
            [insufficientTipJobId],
          )
        ).rows[0].count,
      ) === 0,
    "tip with insufficient Wallet balance leaves no financial records",
  );
  assert(
    (
      await request(`/jobs/${proofShipmentId}/tips`, {
        method: "POST",
        headers: { "Idempotency-Key": `tip-foreign-${crypto.randomUUID()}` },
        body: JSON.stringify({ amount: 500 }),
      })
    ).status === 404,
    "another customer cannot tip a foreign service",
  );
  token = driverToken;
  assert(
    (
      await request(`/jobs/${proofShipmentId}/tips`, {
        method: "POST",
        headers: { "Idempotency-Key": `tip-driver-${crypto.randomUUID()}` },
        body: JSON.stringify({ amount: 500 }),
      })
    ).status === 403,
    "driver cannot create a customer tip",
  );
  token = customerToken;
  const walletBalancesBeforeTip = await pool.query(
    `SELECT u.public_id,
      COALESCE(sum(CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END),0)::bigint balance
    FROM users u
    LEFT JOIN ledger_accounts a
      ON a.owner_type='user' AND a.owner_id=u.id AND a.account_type='wallet'
    LEFT JOIN ledger_entries e ON e.account_id=a.id
    WHERE u.public_id=ANY($1) GROUP BY u.public_id`,
    [["usr_customer", "usr_driver"]],
  );
  tipKey = `tip-${crypto.randomUUID()}`;
  const firstTip = await request(`/jobs/${proofShipmentId}/tips`, {
      method: "POST",
      headers: { "Idempotency-Key": tipKey },
      body: JSON.stringify({ amount: 500 }),
    }),
    secondTip = await request(`/jobs/${proofShipmentId}/tips`, {
      method: "POST",
      headers: { "Idempotency-Key": tipKey },
      body: JSON.stringify({ amount: 500 }),
    });
  const walletBalancesAfterTip = await pool.query(
    `SELECT u.public_id,
      COALESCE(sum(CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END),0)::bigint balance
    FROM users u
    LEFT JOIN ledger_accounts a
      ON a.owner_type='user' AND a.owner_id=u.id AND a.account_type='wallet'
    LEFT JOIN ledger_entries e ON e.account_id=a.id
    WHERE u.public_id=ANY($1) GROUP BY u.public_id`,
    [["usr_customer", "usr_driver"]],
  );
  const tipLedger = await pool.query(
    "SELECT b.entry_count,b.imbalance_cents FROM ledger_transaction_balances b JOIN ledger_transactions t ON t.id=b.transaction_id WHERE t.idempotency_key=$1",
    [`tip-${tipKey}`],
  );
  const beforeTip = Object.fromEntries(
      walletBalancesBeforeTip.rows.map((row) => [row.public_id, Number(row.balance)]),
    ),
    afterTip = Object.fromEntries(
      walletBalancesAfterTip.rows.map((row) => [row.public_id, Number(row.balance)]),
    );
  assert(
    firstTip.status === 201 &&
      secondTip.body.tip?.id === firstTip.body.tip?.id &&
      afterTip.usr_customer === beforeTip.usr_customer - 50000 &&
      afterTip.usr_driver === beforeTip.usr_driver + 50000 &&
      Number(tipLedger.rows[0]?.imbalance_cents) === 0 &&
      Number(tipLedger.rows[0]?.entry_count) === 2,
    "tip transfers Wallet funds exactly once with a balanced ledger",
  );
  assert(
    (
      await request(`/jobs/${proofShipmentId}/tips`, {
        method: "POST",
        headers: { "Idempotency-Key": `tip-second-${crypto.randomUUID()}` },
        body: JSON.stringify({ amount: 500 }),
      })
    ).status === 409,
    "service accepts only one tip",
  );
  const customerTipState = await request("/me");
  assert(
    customerTipState.body.account.tips?.some(
      (entry) => entry.jobId === proofShipmentId && entry.amount === 500,
    ),
    "customer account persists the service tip",
  );
  const firstReceipt = await request(`/jobs/${proofShipmentId}/receipt`),
    secondReceipt = await request(`/jobs/${proofShipmentId}/receipt`);
  receiptId = firstReceipt.body.receipt?.id;
  const storedReceipt = await pool.query(
    "SELECT count(*)::int count,total_cents,payment_summary FROM service_receipts WHERE public_id=$1 GROUP BY total_cents,payment_summary",
    [receiptId],
  );
  if (firstReceipt.status !== 200) console.error("receipt diagnostic", firstReceipt, secondReceipt);
  assert(
    firstReceipt.status === 200 &&
      receiptId &&
      secondReceipt.body.receipt?.id === receiptId &&
      firstReceipt.body.receipt.fiscal === false &&
      storedReceipt.rows[0]?.count === 1 &&
      Number(storedReceipt.rows[0]?.total_cents) ===
        Math.round(firstReceipt.body.receipt.total * 100),
    "completed service issues one stable non-fiscal receipt snapshot",
  );
  token = registeredToken;
  assert(
    (await request(`/jobs/${proofShipmentId}/receipt`)).status === 404,
    "another customer cannot read a foreign receipt",
  );
  token = driverToken;
  assert(
    (await request(`/jobs/${proofShipmentId}/receipt`)).status === 403,
    "driver cannot read the customer receipt",
  );
  const driverTipState = await request("/me");
  assert(
    driverTipState.body.account.tips?.some((entry) => entry.jobId === proofShipmentId),
    "driver sees received tip without customer wallet data",
  );
  token = customerToken;
  const operationalAudit = await pool.query(
    `SELECT entity_type,entity_id,array_agg(action ORDER BY occurred_at) actions FROM audit_events WHERE entity_id=ANY($1) GROUP BY entity_type,entity_id`,
    [[orderId, rideId, shipmentId]],
  );
  assert(
    [orderId, rideId, shipmentId].every((id) =>
      operationalAudit.rows.some(
        (row) =>
          row.entity_id === id &&
          row.actions.some((action) => action.endsWith("created")) &&
          row.actions.some((action) => action.includes("status") || action.includes("cancelled")),
      ),
    ),
    "orders rides and shipments persist operational audit in PostgreSQL",
  );
  const webhookBody = JSON.stringify({
    id: `evt_${crypto.randomUUID()}`,
    type: "payment_intent.captured",
    data: { reference: "runtime-smoke" },
  });
  webhookIds.push(JSON.parse(webhookBody).id);
  const webhookSignature = crypto
    .createHmac("sha256", process.env.PAYMENT_WEBHOOK_SECRET)
    .update(webhookBody)
    .digest("hex");
  const webhookFirst = await request("/payments/webhooks/sandbox", {
    method: "POST",
    headers: { "X-Flash-Signature": webhookSignature },
    body: webhookBody,
  });
  const webhookSecond = await request("/payments/webhooks/sandbox", {
    method: "POST",
    headers: { "X-Flash-Signature": webhookSignature },
    body: webhookBody,
  });
  assert(
    webhookFirst.status === 200 && webhookFirst.body.processed && webhookSecond.body.duplicate,
    "signed payment webhook is processed once",
  );
  const invalidBody = JSON.stringify({
    id: `evt_${crypto.randomUUID()}`,
    type: "payment_intent.failed",
  });
  webhookIds.push(JSON.parse(invalidBody).id);
  const invalidWebhook = await request("/payments/webhooks/sandbox", {
    method: "POST",
    headers: { "X-Flash-Signature": "00".repeat(32) },
    body: invalidBody,
  });
  assert(invalidWebhook.status === 401, "invalid payment webhook signature is rejected");
  const supportCreated = await request("/support/tickets", {
    method: "POST",
    headers: { "Idempotency-Key": `runtime-support-${crypto.randomUUID()}` },
    body: JSON.stringify({
      category: "payment",
      priority: "high",
      subject: "Consulta runtime de pago",
      body: "Necesito revisar el reintegro de prueba",
    }),
  });
  supportTicketId = supportCreated.body.ticket?.id;
  assert(
    supportCreated.status === 201 &&
      supportTicketId &&
      supportCreated.body.ticket.messages?.length === 1,
    "customer creates persistent support ticket",
  );
  const notifications = await request("/notifications");
  const supportNotification = notifications.body.notifications?.find(
    (entry) => entry.payload?.ticketId === supportTicketId,
  );
  assert(supportNotification?.status === "sent", "support action creates user notification");
  const readNotification = await request(`/notifications/${supportNotification.id}/read`, {
    method: "PATCH",
    body: "{}",
  });
  assert(
    readNotification.status === 200 &&
      readNotification.body.notifications.find((entry) => entry.id === supportNotification.id)
        ?.status === "read",
    "customer marks own notification read",
  );
  const merchantLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "comercio@flash.app",
      password: "demo123",
      deviceName: "postgres-smoke-merchant",
    }),
  });
  token = merchantLogin.body.token;
  const foreignReply = await request(`/support/tickets/${supportTicketId}/messages`, {
    method: "POST",
    headers: { "Idempotency-Key": `runtime-support-foreign-${crypto.randomUUID()}` },
    body: JSON.stringify({ body: "No debería poder responder" }),
  });
  assert(foreignReply.status === 403, "another user cannot access customer support ticket");
  token = customerToken;
  const issueWalletBefore = (await request("/me")).body.account.user.wallet;
  const createdIssue = await request(`/orders/${settlementOrderId}/issues`, {
    method: "POST",
    body: JSON.stringify({
      category: "missing_item",
      description: "Faltó un producto confirmado en la entrega",
      requestedRefund: 400,
    }),
  });
  orderIssueId = createdIssue.body.issue?.id;
  const visibleIssue = await request(`/orders/${settlementOrderId}/issues`);
  assert(
    createdIssue.status === 201 &&
      orderIssueId &&
      visibleIssue.body.issues?.some(
        (entry) => entry.id === orderIssueId && entry.status === "open",
      ),
    "customer reports and reads a persisted food-order incident",
  );
  const adminLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "ops@flash.app",
      password: "demo123",
      deviceName: "postgres-smoke-ops",
    }),
  });
  token = adminLogin.body.token;
  const resolvedIssue = await request(`/order-issues/${orderIssueId}/resolve`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "approved",
      approvedRefund: 300,
      resolutionNote: "Reintegro parcial validado por operaciones",
    }),
  });
  const issueBalances = await pool.query(
    `SELECT b.imbalance_cents,b.entry_count FROM ledger_transaction_balances b JOIN ledger_transactions t ON t.id=b.transaction_id WHERE t.idempotency_key IN($1,$2) ORDER BY t.idempotency_key`,
    [`issue-refund-${orderIssueId}`, `issue-reversal-${orderIssueId}`],
  );
  token = customerToken;
  const issueWalletAfter = (await request("/me")).body.account.user.wallet;
  assert(
    resolvedIssue.status === 200 &&
      resolvedIssue.body.issue.approvedRefund === 300 &&
      issueWalletAfter === issueWalletBefore + 300 &&
      issueBalances.rowCount === 2 &&
      issueBalances.rows.every(
        (row) => Number(row.imbalance_cents) === 0 && Number(row.entry_count) >= 2,
      ),
    "operations approves one partial refund and reverses settlement with balanced double-entry transactions",
  );
  assert(
    (
      await request(`/order-issues/${orderIssueId}/resolve`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "approved",
          approvedRefund: 300,
          resolutionNote: "Duplicado",
        }),
      })
    ).status === 403,
    "customer cannot resolve an incident",
  );
  token = adminLogin.body.token;
  const selfSuspension = await request("/admin/users/usr_admin/status", {
    method: "PATCH",
    body: JSON.stringify({
      status: "suspended",
      reason: "Prueba de autoprotección",
    }),
  });
  assert(selfSuspension.status === 409, "admin cannot suspend its own account");
  moderationDriverId = `DRV-MOD-${Date.now()}`;
  await pool.query(
    `INSERT INTO user_roles(user_id,role) SELECT id,'driver' FROM users WHERE public_id=$1 ON CONFLICT DO NOTHING`,
    [registeredUserId],
  );
  await pool.query(
    `INSERT INTO drivers(public_id,user_id,online,active_mode,service_modes,current_location,location_updated_at) SELECT $1,
      id,
      true,
      'ride',
      ARRAY['ride']::job_kind[],
      ST_SetSRID(ST_MakePoint(-58.39,-34.60),4326)::geography,
      now() FROM users WHERE public_id=$2`,
    [moderationDriverId, registeredUserId],
  );
  await pool.query(
    `INSERT INTO dispatch_offers(public_id,job_id,driver_id,score,expires_at) SELECT $1,
      j.id,
      d.id,
      100,
      now()+interval '5 minutes' FROM jobs j CROSS JOIN drivers d WHERE j.public_id=$2 AND d.public_id=$3 ON CONFLICT(job_id,driver_id) DO UPDATE SET status='pending',
      expires_at=excluded.expires_at`,
    [`OFR-MOD-${Date.now()}`, registeredRideId, moderationDriverId],
  );
  const suspendedUser = await request(`/admin/users/${registeredUserId}/status`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "suspended",
      reason: "Revisión automatizada de seguridad",
    }),
  });
  const adminToken = token;
  token = registeredToken;
  const suspendedAccess = await request("/me");
  token = "";
  const suspendedRefresh = await request("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({
      refreshToken: registeredRefreshToken,
      deviceName: "suspended-runtime",
    }),
  });
  token = adminToken;
  const suspendedAdminState = await request(
    `/operations/users?q=${encodeURIComponent(registeredUserId)}&limit=10`,
  );
  const suspensionAudit = await pool.query(
    "SELECT after_data FROM audit_events WHERE entity_type='user' AND entity_id=$1 AND action='user.suspended' ORDER BY occurred_at DESC LIMIT 1",
    [registeredUserId],
  );
  const suspendedSupply = (
    await pool.query(
      `SELECT d.online,o.status offer_status FROM drivers d JOIN dispatch_offers o ON o.driver_id=d.id WHERE d.public_id=$1`,
      [moderationDriverId],
    )
  ).rows[0];
  assert(
    suspendedUser.status === 200 &&
      suspendedAccess.status === 401 &&
      suspendedRefresh.status === 401 &&
      suspendedAdminState.body.users.some(
        (entry) => entry.id === registeredUserId && entry.status === "suspended",
      ) &&
      !suspendedSupply.online &&
      suspendedSupply.offer_status === "withdrawn" &&
      suspensionAudit.rows[0]?.after_data.reason,
    "suspension revokes access, removes supply and remains visible and auditable to operations",
  );
  const reactivatedUser = await request(`/admin/users/${registeredUserId}/status`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "active",
      reason: "Revisión completada sin hallazgos",
    }),
  });
  token = "";
  const loginAfterReactivation = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: registeredEmail, password: "runtime123" }),
  });
  registeredToken = loginAfterReactivation.body.token;
  registeredRefreshToken = loginAfterReactivation.body.refreshToken;
  token = adminToken;
  assert(
    reactivatedUser.status === 200 && loginAfterReactivation.status === 200 && registeredToken,
    "reactivation restores credential access without restoring revoked sessions",
  );
  const adminDashboard = await request("/admin/dashboard"),
    postedRevenue =
      Number(
        (
          await pool.query(
            `SELECT COALESCE(sum(CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END),0)::bigint cents FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id=a.id ,
              WHERE a.owner_type='platform' AND a.owner_id IS NULL AND a.account_type='revenue'`,
          )
        ).rows[0].cents,
      ) / 100;
  assert(
    adminDashboard.status === 200 &&
      adminDashboard.body.dashboard.marketplace.estimatedPlatformRevenue === postedRevenue &&
      adminDashboard.body.dashboard.investor.monthlyBurn === null &&
      adminDashboard.body.dashboard.marketplace.financial.revenueCoverage === "wallet_settlements",
    "admin finance uses ledger facts and exposes no fabricated burn or runway",
  );
  const originalShipmentOptions = await request("/shipment-options"),
    originalFragile = originalShipmentOptions.body.categories.find(
      (entry) => entry.code === "fragile",
    ),
    originalPriority = originalShipmentOptions.body.serviceLevels.find(
      (entry) => entry.code === "priority",
    ),
    adminShipmentQuoteBefore = await request("/shipments/quote", {
      method: "POST",
      body: JSON.stringify(slaShipmentPayload),
    });
  const invalidCategoryLimit = await request("/admin/shipment-item-categories/fragile", {
      method: "PATCH",
      body: JSON.stringify({ maximumWeightKg: 25 }),
    }),
    updatedFragile = await request("/admin/shipment-item-categories/fragile", {
      method: "PATCH",
      body: JSON.stringify({ surcharge: originalFragile.surcharge + 1 }),
    }),
    adminShipmentQuoteAfter = await request("/shipments/quote", {
      method: "POST",
      body: JSON.stringify(slaShipmentPayload),
    }),
    restoredFragile = await request("/admin/shipment-item-categories/fragile", {
      method: "PATCH",
      body: JSON.stringify({ surcharge: originalFragile.surcharge }),
    }),
    updatedPriority = await request("/admin/shipment-service-levels/priority", {
      method: "PATCH",
      body: JSON.stringify({ etaMultiplier: 0.8, maximumDistanceKm: 25 }),
    }),
    restoredPriority = await request("/admin/shipment-service-levels/priority", {
      method: "PATCH",
      body: JSON.stringify({
        etaMultiplier: originalPriority.etaMultiplier,
        maximumDistanceKm: originalPriority.maximumDistanceKm,
      }),
    }),
    shipmentConfigAudit = await pool.query(
      "SELECT before_data,after_data FROM audit_events WHERE action='shipment.category_updated' AND entity_id='fragile' ORDER BY occurred_at DESC LIMIT 1",
    );
  assert(
    invalidCategoryLimit.status === 400 &&
      updatedFragile.status === 200 &&
      adminShipmentQuoteAfter.body.quote?.breakdown?.categorySurcharge ===
        originalFragile.surcharge + 1 &&
      adminShipmentQuoteAfter.body.quote?.fare > adminShipmentQuoteBefore.body.quote?.fare &&
      restoredFragile.status === 200 &&
      updatedPriority.status === 200 &&
      restoredPriority.status === 200 &&
      shipmentConfigAudit.rows[0]?.before_data &&
      shipmentConfigAudit.rows[0]?.after_data,
    "operations safely configures shipment limits, pricing and SLA with audit history used by live quotes",
  );
  const disabledElectronics = await request("/admin/shipment-item-categories/electronics", {
      method: "PATCH",
      body: JSON.stringify({ active: false }),
    }),
    publicOptionsWhileDisabled = await request("/shipment-options"),
    adminOptionsWhileDisabled = await request("/admin/shipment-options"),
    reactivatedElectronics = await request("/admin/shipment-item-categories/electronics", {
      method: "PATCH",
      body: JSON.stringify({ active: true }),
    });
  assert(
    disabledElectronics.status === 200 &&
      !publicOptionsWhileDisabled.body.categories.some((entry) => entry.code === "electronics") &&
      adminOptionsWhileDisabled.body.categories.some(
        (entry) => entry.code === "electronics" && entry.active === false,
      ) &&
      reactivatedElectronics.status === 200,
    "admin can deactivate and reactivate shipment options without exposing inactive choices to customers",
  );
  const originalShipmentPlan = (
    await pool.query(
      "SELECT id,version,config FROM pricing_plans WHERE service='shipment' AND active",
    )
  ).rows[0];
  const pricingStamp = Date.now(),
    publishedVersion = `AR-BA-SHIP-TEST-${pricingStamp}`,
    scheduledVersion = `AR-BA-SHIP-SCHEDULED-${pricingStamp}`,
    riskVersion = `AR-BA-SHIP-RISK-${pricingStamp}`,
    rollbackVersion = `AR-BA-SHIP-ROLLBACK-${pricingStamp}`;
  const publishedConfig = {
      ...originalShipmentPlan.config,
      baseFare: Number(originalShipmentPlan.config.baseFare) + 111,
    },
    scheduledConfig = {
      ...originalShipmentPlan.config,
      baseFare: Number(originalShipmentPlan.config.baseFare) + 222,
    },
    riskConfig = {
      ...originalShipmentPlan.config,
      baseFare: Number(originalShipmentPlan.config.baseFare) * 2,
    },
    pricingPayload = {
      pickup: "Defensa 982, San Telmo",
      destination: "Obelisco, Buenos Aires",
      packageSize: "small",
      weightKg: 1,
      pickupCoords: { lat: -34.6177, lng: -58.3621 },
      destinationCoords: { lat: -34.6037, lng: -58.3816 },
    };
  const publishedRequest = await request("/admin/pricing/shipment", {
      method: "POST",
      body: JSON.stringify({
        version: publishedVersion,
        config: publishedConfig,
      }),
    }),
    pricingRequestId = publishedRequest.body.changeRequest?.id;
  feedbackAuditRequestIds.push(publishedRequest.body.requestId);
  const selfApproval = await request(`/admin/pricing-changes/${pricingRequestId}/review`, {
    method: "PATCH",
    body: JSON.stringify({
      decision: "approved",
      note: "Aprobación propia inválida",
    }),
  });
  await pool.query(
    `INSERT INTO user_roles(user_id,role) SELECT id,'admin' FROM users WHERE public_id=$1 ON CONFLICT DO NOTHING`,
    [registeredUserId],
  );
  token = "";
  const pricingReviewerLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: registeredEmail,
      password: "runtime123",
      deviceName: "postgres-smoke-pricing-reviewer",
    }),
  });
  token = pricingReviewerLogin.body.token;
  const approvedPricing = await request(`/admin/pricing-changes/${pricingRequestId}/review`, {
      method: "PATCH",
      body: JSON.stringify({
        decision: "approved",
        note: "Comparación de costos y márgenes validada",
      }),
    }),
    publishedQuote = await request("/shipments/quote", {
      method: "POST",
      body: JSON.stringify(pricingPayload),
    });
  feedbackAuditRequestIds.push(approvedPricing.body.requestId);
  token = adminToken;
  const scheduledRequest = await request("/admin/pricing/shipment", {
      method: "POST",
      body: JSON.stringify({
        version: scheduledVersion,
        config: scheduledConfig,
        effectiveAt: new Date(Date.now() + 3600000).toISOString(),
      }),
    }),
    scheduledRequestId = scheduledRequest.body.changeRequest?.id;
  feedbackAuditRequestIds.push(scheduledRequest.body.requestId);
  token = pricingReviewerLogin.body.token;
  const approvedScheduled = await request(`/admin/pricing-changes/${scheduledRequestId}/review`, {
      method: "PATCH",
      body: JSON.stringify({
        decision: "approved",
        note: "Vigencia futura validada para ventana operativa",
      }),
    }),
    quoteBeforeSchedule = await request("/shipments/quote", {
      method: "POST",
      body: JSON.stringify(pricingPayload),
    });
  feedbackAuditRequestIds.push(approvedScheduled.body.requestId);
  await pool.query(
    "UPDATE pricing_plans SET effective_from=now()-interval '2 hours' WHERE service='shipment' AND version=$1",
    [publishedVersion],
  );
  await pool.query(
    "UPDATE pricing_change_requests SET effective_at=now()-interval '1 second' WHERE public_id=$1",
    [scheduledRequestId],
  );
  const quoteAfterSchedule = await request("/shipments/quote", {
    method: "POST",
    body: JSON.stringify(pricingPayload),
  });
  token = adminToken;
  const riskRequest = await request("/admin/pricing/shipment", {
      method: "POST",
      body: JSON.stringify({ version: riskVersion, config: riskConfig }),
    }),
    riskRequestId = riskRequest.body.changeRequest?.id;
  feedbackAuditRequestIds.push(riskRequest.body.requestId);
  token = pricingReviewerLogin.body.token;
  const shortRiskReview = await request(`/admin/pricing-changes/${riskRequestId}/review`, {
      method: "PATCH",
      body: JSON.stringify({ decision: "approved", note: "Muy corto" }),
    }),
    rejectedRisk = await request(`/admin/pricing-changes/${riskRequestId}/review`, {
      method: "PATCH",
      body: JSON.stringify({
        decision: "rejected",
        note: "Variación extraordinaria rechazada por impacto al usuario",
      }),
    });
  feedbackAuditRequestIds.push(rejectedRisk.body.requestId);
  token = adminToken;
  const rollbackRequest = await request("/admin/pricing/shipment/rollback", {
      method: "POST",
      body: JSON.stringify({
        targetVersion: originalShipmentPlan.version,
        version: rollbackVersion,
      }),
    }),
    rollbackRequestId = rollbackRequest.body.changeRequest?.id;
  feedbackAuditRequestIds.push(rollbackRequest.body.requestId);
  token = pricingReviewerLogin.body.token;
  const approvedRollback = await request(`/admin/pricing-changes/${rollbackRequestId}/review`, {
      method: "PATCH",
      body: JSON.stringify({
        decision: "approved",
        note: "Rollback validado contra la versión estable anterior",
      }),
    }),
    rollbackQuote = await request("/shipments/quote", {
      method: "POST",
      body: JSON.stringify(pricingPayload),
    });
  feedbackAuditRequestIds.push(approvedRollback.body.requestId);
  token = adminToken;
  const pricingQueue = await request("/admin/pricing-changes");
  await pool.query("DELETE FROM pricing_plans WHERE service='shipment' AND version=ANY($1)", [
    [publishedVersion, scheduledVersion, rollbackVersion],
  ]);
  await pool.query("UPDATE pricing_plans SET active=true,effective_until=NULL WHERE id=$1", [
    originalShipmentPlan.id,
  ]);
  await pool.query("DELETE FROM pricing_change_requests WHERE public_id=ANY($1)", [
    [pricingRequestId, scheduledRequestId, riskRequestId, rollbackRequestId],
  ]);
  const pricingDiagnostic = {
    publishedStatus: publishedRequest.status,
    selfApproval: selfApproval.status,
    reviewer: pricingReviewerLogin.status,
    approved: approvedPricing.body.changeRequest?.status,
    publishedVersion: publishedQuote.body.quote?.pricingVersion,
    scheduledStatus: scheduledRequest.status,
    scheduledReview: approvedScheduled.body.changeRequest?.status,
    beforeVersion: quoteBeforeSchedule.body.quote?.pricingVersion,
    afterVersion: quoteAfterSchedule.body.quote?.pricingVersion,
    risk: riskRequest.body.changeRequest?.riskLevel,
    warnings: riskRequest.body.changeRequest?.riskWarnings?.length,
    shortReview: shortRiskReview.status,
    rejected: rejectedRisk.body.changeRequest?.status,
    rollbackKind: rollbackRequest.body.changeRequest?.changeKind,
    rollbackSource: rollbackRequest.body.changeRequest?.sourceVersion,
    rollbackReview: approvedRollback.body.changeRequest?.status,
    rollbackVersion: rollbackQuote.body.quote?.pricingVersion,
    rollbackBase: rollbackQuote.body.quote?.breakdown?.base,
    expectedBase: Number(originalShipmentPlan.config.baseFare),
    queueHas: pricingQueue.body.requests?.some(
      (entry) => entry.id === rollbackRequestId && entry.status === "activated",
    ),
  };
  assert(
    publishedRequest.status === 201 &&
      selfApproval.status === 409 &&
      pricingReviewerLogin.status === 200 &&
      approvedPricing.body.changeRequest?.status === "activated" &&
      publishedQuote.body.quote?.pricingVersion === publishedVersion &&
      scheduledRequest.status === 201 &&
      approvedScheduled.body.changeRequest?.status === "approved" &&
      quoteBeforeSchedule.body.quote?.pricingVersion === publishedVersion &&
      quoteAfterSchedule.body.quote?.pricingVersion === scheduledVersion &&
      riskRequest.body.changeRequest?.riskLevel === "high" &&
      riskRequest.body.changeRequest?.riskWarnings?.length > 0 &&
      shortRiskReview.status === 400 &&
      rejectedRisk.body.changeRequest?.status === "rejected" &&
      rollbackRequest.body.changeRequest?.changeKind === "rollback" &&
      rollbackRequest.body.changeRequest?.sourceVersion === originalShipmentPlan.version &&
      approvedRollback.body.changeRequest?.status === "activated" &&
      rollbackQuote.body.quote?.pricingVersion === rollbackVersion &&
      rollbackQuote.body.quote?.breakdown.base === Number(originalShipmentPlan.config.baseFare) &&
      pricingQueue.body.requests?.some(
        (entry) => entry.id === rollbackRequestId && entry.status === "activated",
      ),
    `pricing detects risky variation, requires reinforced review and performs a second-approved rollback from immutable history (${JSON.stringify(pricingDiagnostic)})`,
  );
  const createdPromotion = await request("/promotions", {
    method: "POST",
    body: JSON.stringify({
      code: `RUNTIME${Date.now()}`,
      title: "Promoción runtime",
      description: "Prueba transaccional",
      service: "food",
      kind: "percentage",
      value: 7,
      maxDiscount: 1000,
      minSubtotal: 0,
      usageLimit: 10,
      perUserLimit: 1,
      startsAt: new Date(Date.now() - 60000).toISOString(),
      endsAt: new Date(Date.now() + 86400000).toISOString(),
      rules: {},
      active: true,
    }),
  });
  createdPromotionId = createdPromotion.body.promotion?.id;
  assert(
    createdPromotion.status === 201 && createdPromotionId,
    "admin creates PostgreSQL promotion",
  );
  const disabledPromotion = await request(`/promotions/${createdPromotionId}`, {
    method: "PATCH",
    body: JSON.stringify({ active: false }),
  });
  assert(
    disabledPromotion.status === 200 && !disabledPromotion.body.promotion.active,
    "admin updates PostgreSQL promotion",
  );
  const updatedZone = await request("/zones/zone_centro", {
    method: "PATCH",
    body: JSON.stringify({
      deliveryMultiplier: Number((originalZoneMultiplier + 0.01).toFixed(2)),
    }),
  });
  assert(
    updatedZone.status === 200 &&
      updatedZone.body.zone.deliveryMultiplier !== originalZoneMultiplier,
    "admin updates PostGIS service zone configuration",
  );
  const supportQueue = await request("/support/tickets");
  assert(
    supportQueue.body.tickets?.some((entry) => entry.id === supportTicketId),
    "operations reads support queue",
  );
  const internalReply = await request(`/support/tickets/${supportTicketId}/messages`, {
    method: "POST",
    headers: { "Idempotency-Key": `runtime-support-internal-${crypto.randomUUID()}` },
    body: JSON.stringify({ body: "Nota interna runtime", internal: true }),
  });
  assert(
    internalReply.status === 200 &&
      internalReply.body.ticket.messages.some((entry) => entry.internal),
    "operations adds internal support note",
  );
  const resolved = await request(`/support/tickets/${supportTicketId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "resolved" }),
  });
  assert(
    resolved.status === 200 && resolved.body.ticket.status === "resolved",
    "operations resolves support ticket",
  );
  const processedNotifications = await request("/admin/notifications/process", {
    method: "POST",
    body: JSON.stringify({ limit: 100 }),
  });
  const delivered = await pool.query(
    "SELECT count(*)::int count FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id JOIN user_devices ud ON ud.id=d.device_id WHERE ud.public_id=$1 AND n.status='delivered'",
    [deviceId],
  );
  assert(
    processedNotifications.status === 200 &&
      Number.isInteger(processedNotifications.body.result?.claimed) &&
      delivered.rows[0].count >= 1,
    "notification worker processes outbox events and records sandbox delivery",
  );
  token = customerToken;
  const customerTickets = await request("/support/tickets");
  const customerTicket = customerTickets.body.tickets.find((entry) => entry.id === supportTicketId);
  assert(
    customerTicket.status === "resolved" &&
      !customerTicket.messages.some((entry) => entry.internal),
    "internal support notes stay hidden from customer",
  );
  const supportAudit = await pool.query(
    "SELECT action,after_data FROM audit_events WHERE entity_type='support_ticket' AND entity_id=$1 ORDER BY occurred_at",
    [supportTicketId],
  );
  assert(
    supportAudit.rowCount === 3 &&
      !supportAudit.rows.some((entry) =>
        JSON.stringify(entry.after_data).includes("Nota interna runtime"),
      ),
    "support mutations are audited without private message bodies",
  );
  const finalReady = await request("/ready");
  assert(
    finalReady.body.fallbackDiagnostics?.sqliteReads === 0,
    "PostgreSQL runtime performs zero SQLite fallback reads across the full smoke suite",
  );
  assert(
    sqliteFingerprint() === sqliteBefore,
    "PostgreSQL runtime smoke performs no SQLite writes",
  );
} finally {
  const runtimeJobIds = [
    orderId,
    settlementOrderId,
    rideId,
    scheduledRideId,
    shipmentId,
    proofShipmentId,
  ].filter(Boolean);
  if (runtimeJobIds.length)
    await pool.query("DELETE FROM notifications WHERE payload->>'jobId'=ANY($1)", [runtimeJobIds]);
  if (runtimeJobIds.length)
    await pool.query(
      "DELETE FROM job_cancellations WHERE job_id IN(SELECT id FROM jobs WHERE public_id=ANY($1))",
      [runtimeJobIds],
    );
  if (orderId) {
    await pool.query("DELETE FROM audit_events WHERE entity_id=$1", [orderId]);
    await pool.query(
      "DELETE FROM promotion_redemptions WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1)",
      [orderId],
    );
    await pool.query(
      "DELETE FROM refunds WHERE payment_intent_id=(SELECT p.id FROM payment_intents p JOIN jobs j ON j.id=p.job_id WHERE j.public_id=$1)",
      [orderId],
    );
    await pool.query(
      "DELETE FROM payment_intents WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1)",
      [orderId],
    );
    await pool.query(
      "DELETE FROM ledger_entries WHERE transaction_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)",
      [`refund-${orderId}`],
    );
    await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key=$1", [
      `refund-${orderId}`,
    ]);
    await pool.query(
      "DELETE FROM ledger_entries WHERE transaction_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)",
      [`payment-${idempotencyKey}`],
    );
    await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key=$1", [
      `payment-${idempotencyKey}`,
    ]);
    await pool.query("DELETE FROM jobs WHERE public_id = $1", [orderId]);
  }
  if (idempotencyKey)
    await pool.query("DELETE FROM idempotency_keys WHERE key = $1", [idempotencyKey]);
  if (scheduledRideId) {
    await pool.query("DELETE FROM audit_events WHERE entity_id=$1", [scheduledRideId]);
    await pool.query("DELETE FROM notifications WHERE payload->>'jobId'=$1", [scheduledRideId]);
    await pool.query("DELETE FROM jobs WHERE public_id=$1", [scheduledRideId]);
  }
  if (scheduledRideKey)
    await pool.query("DELETE FROM idempotency_keys WHERE key=$1", [scheduledRideKey]);
  if (insufficientTipJobId)
    await pool.query("DELETE FROM jobs WHERE public_id=$1", [insufficientTipJobId]);
  if (proofShipmentId) {
    await pool.query("DELETE FROM audit_events WHERE entity_id=$1", [proofShipmentId]);
    await pool.query("DELETE FROM realtime_events WHERE entity_id=$1", [proofShipmentId]);
    await pool.query(
      "DELETE FROM service_receipts WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1)",
      [proofShipmentId],
    );
    if (tipKey) {
      await pool.query("DELETE FROM service_tips WHERE idempotency_key=$1", [tipKey]);
      await pool.query(
        "DELETE FROM ledger_entries WHERE transaction_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)",
        [`tip-${tipKey}`],
      );
      await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key=$1", [
        `tip-${tipKey}`,
      ]);
    }
    for (const transactionKey of [
      `driver-earning-envio-${proofShipmentId}`,
      `payment-${proofShipmentKey}`,
    ]) {
      await pool.query(
        "DELETE FROM ledger_entries WHERE transaction_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)",
        [transactionKey],
      );
      await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key=$1", [
        transactionKey,
      ]);
    }
    await pool.query(
      "DELETE FROM payment_intents WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1)",
      [proofShipmentId],
    );
    await pool.query("DELETE FROM jobs WHERE public_id=$1", [proofShipmentId]);
  }
  if (proofShipmentKey)
    await pool.query("DELETE FROM idempotency_keys WHERE key=$1", [proofShipmentKey]);
  if (merchantPayoutKey) {
    await pool.query(
      "DELETE FROM ledger_entries WHERE transaction_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)",
      [`payout-reserve-${merchantPayoutKey}`],
    );
    await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key=$1", [
      `payout-reserve-${merchantPayoutKey}`,
    ]);
    await pool.query("DELETE FROM payouts WHERE idempotency_key=$1", [merchantPayoutKey]);
  }
  if (settlementOrderId) {
    await pool.query(
      "DELETE FROM audit_events WHERE entity_id=$1 OR(entity_type='order_issue' AND entity_id=$2) OR(entity_type='order_substitution' AND entity_id=$3)",
      [settlementOrderId, orderIssueId, substitutionId],
    );
    if (orderIssueId) {
      await pool.query("DELETE FROM refunds WHERE provider_refund_id=$1", [orderIssueId]);
      await pool.query("DELETE FROM order_issues WHERE public_id=$1", [orderIssueId]);
      for (const transactionKey of [
        `issue-refund-${orderIssueId}`,
        `issue-reversal-${orderIssueId}`,
      ]) {
        await pool.query(
          "DELETE FROM ledger_entries WHERE transaction_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)",
          [transactionKey],
        );
        await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key=$1", [
          transactionKey,
        ]);
      }
    }
    const cleanupSubstitutions = (
      await pool.query(
        "SELECT s.public_id FROM order_item_substitutions s JOIN jobs j ON j.id=s.job_id WHERE j.public_id=$1",
        [settlementOrderId],
      )
    ).rows.map((row) => row.public_id);
    for (const cleanupSubstitutionId of cleanupSubstitutions) {
      await pool.query("DELETE FROM refunds WHERE provider_refund_id=$1", [cleanupSubstitutionId]);
      await pool.query(
        "DELETE FROM ledger_entries WHERE transaction_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)",
        [`substitution-refund-${cleanupSubstitutionId}`],
      );
      await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key=$1", [
        `substitution-refund-${cleanupSubstitutionId}`,
      ]);
    }
    await pool.query(
      "DELETE FROM order_item_substitutions WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1)",
      [settlementOrderId],
    );
    await pool.query(
      "DELETE FROM payment_intents WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1)",
      [settlementOrderId],
    );
    // Antes que los asientos y que el pedido: `service_tips` referencia a los dos
    // sin cascada, asi que borrarlos primero fallaria por clave foranea y el
    // pedido del smoke quedaria para la corrida siguiente.
    await pool.query(
      "DELETE FROM service_tips WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1)",
      [settlementOrderId],
    );
    for (const transactionKey of [
      `settlement-${settlementOrderId}`,
      `payment-${settlementOrderKey}`,
    ]) {
      await pool.query(
        "DELETE FROM ledger_entries WHERE transaction_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)",
        [transactionKey],
      );
      await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key=$1", [
        transactionKey,
      ]);
    }
    await pool.query("DELETE FROM jobs WHERE public_id=$1", [settlementOrderId]);
    // El plan del smoke y la suscripcion que abrio. En este orden: `plan_id` es
    // ON DELETE RESTRICT, asi que borrar el plan primero fallaria y dejaria a
    // `usr_customer` suscripto en la corrida siguiente.
    await pool.query(
      "DELETE FROM user_subscriptions WHERE plan_id IN(SELECT id FROM subscription_plans WHERE key='smoke_plan')",
    );
    await pool.query("DELETE FROM subscription_plans WHERE key='smoke_plan'");
    // El grupo del smoke. Participantes e items caen por cascada; el grupo no,
    // porque nada lo referencia y borrarlo explicitamente deja claro que la
    // corrida no ensucia el padron.
    //
    // Los eventos de auditoria van primero y son la parte que importa:
    // `audit_events.actor_id` referencia a `users` sin cascada, asi que un
    // evento de grupo a nombre del usuario registrado bloquea su borrado mas
    // abajo. Lo encontro CI con un error de clave foranea, no una asercion.
    if (grupoPublicId) {
      await pool.query("DELETE FROM audit_events WHERE entity_id=$1", [grupoPublicId]);
      await pool.query("DELETE FROM group_orders WHERE public_id=$1", [grupoPublicId]);
    }
    // Red de seguridad: si el bloque de suspension corta antes de restituir, el
    // comercio queda suspendido y la corrida siguiente no puede cotizar nada.
    // Restituirlo dos veces no cuesta nada; no restituirlo cuesta la corrida.
    await pool.query("UPDATE merchants SET status='active' WHERE public_id='rest_roja'");
    await pool.query("UPDATE catalog_items SET available=true WHERE public_id='item_burger_brava'");
    await pool.query(
      "UPDATE catalog_branch_inventory SET available=true,stock_quantity=NULL WHERE catalog_item_id=(SELECT id FROM catalog_items WHERE public_id='item_burger_brava')",
    );
    await pool.query(
      "UPDATE merchant_branches SET open=true,status='active',eta_min=22 WHERE public_id='branch_rest_roja'",
    );
  }
  if (settlementOrderKey)
    await pool.query("DELETE FROM idempotency_keys WHERE key=$1", [settlementOrderKey]);
  if (walletKey) {
    await pool.query(
      "DELETE FROM ledger_entries WHERE transaction_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)",
      [walletKey],
    );
    await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key=$1", [walletKey]);
  }
  for (const [jobId, key] of [
    [rideId, rideKey],
    [shipmentId, shipmentKey],
  ]) {
    if (jobId) {
      await pool.query("DELETE FROM audit_events WHERE entity_id=$1", [jobId]);
      await pool.query(
        "DELETE FROM refunds WHERE payment_intent_id=(SELECT p.id FROM payment_intents p JOIN jobs j ON j.id=p.job_id WHERE j.public_id=$1)",
        [jobId],
      );
      await pool.query(
        "DELETE FROM payment_intents WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1)",
        [jobId],
      );
      for (const transactionKey of [`refund-${jobId}`, `payment-${key}`]) {
        await pool.query(
          "DELETE FROM ledger_entries WHERE transaction_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)",
          [transactionKey],
        );
        await pool.query("DELETE FROM ledger_transactions WHERE idempotency_key=$1", [
          transactionKey,
        ]);
      }
      await pool.query("DELETE FROM jobs WHERE public_id=$1", [jobId]);
    }
    if (key) await pool.query("DELETE FROM idempotency_keys WHERE key=$1", [key]);
  }
  if (webhookIds.length)
    await pool.query(
      "DELETE FROM webhook_events WHERE provider='sandbox' AND provider_event_id=ANY($1)",
      [webhookIds],
    );
  if (realtimeFixtureIds.length)
    await pool.query("DELETE FROM realtime_events WHERE public_id=ANY($1)", [realtimeFixtureIds]);
  if (ratingId) {
    await pool.query("DELETE FROM audit_events WHERE entity_type='rating' AND entity_id=$1", [
      ratingId,
    ]);
    await pool.query("DELETE FROM ratings WHERE public_id=$1", [ratingId]);
  }
  if (feedbackAuditRequestIds.filter(Boolean).length) {
    await pool.query("DELETE FROM audit_events WHERE request_id=ANY($1)", [
      feedbackAuditRequestIds.filter(Boolean),
    ]);
    await pool.query("DELETE FROM realtime_events WHERE request_id=ANY($1)", [
      feedbackAuditRequestIds.filter(Boolean),
    ]);
  }
  if (deviceAuditRequestId)
    await pool.query("DELETE FROM audit_events WHERE request_id=$1", [deviceAuditRequestId]);
  if (deviceId) await pool.query("DELETE FROM user_devices WHERE public_id=$1", [deviceId]);
  if (rideDestinationId)
    await pool.query("DELETE FROM ride_destination_history WHERE id=$1", [rideDestinationId]);
  if (trustedContactId)
    await pool.query("DELETE FROM ride_trusted_contacts WHERE id=$1", [trustedContactId]);
  if (supportTicketId) {
    await pool.query(
      "DELETE FROM audit_events WHERE entity_type='support_ticket' AND entity_id=$1",
      [supportTicketId],
    );
    await pool.query("DELETE FROM notifications WHERE payload->>'ticketId'=$1", [supportTicketId]);
    await pool.query("DELETE FROM support_tickets WHERE public_id=$1", [supportTicketId]);
  }
  if (createdPromotionId) {
    await pool.query("DELETE FROM audit_events WHERE entity_type='promotion' AND entity_id=$1", [
      createdPromotionId,
    ]);
    await pool.query("DELETE FROM promotions WHERE public_id=$1", [createdPromotionId]);
  }
  if (originalZoneMultiplier !== null) {
    await pool.query("UPDATE service_zones SET delivery_multiplier=$2 WHERE public_id=$1", [
      "zone_centro",
      originalZoneMultiplier,
    ]);
    await pool.query(
      "DELETE FROM audit_events WHERE entity_type='service_zone' AND entity_id='zone_centro'",
    );
  }
  if (dispatchDriverOriginalOnline !== null)
    await pool.query("UPDATE drivers SET online=$2 WHERE public_id=$1", [
      "drv_nico",
      dispatchDriverOriginalOnline,
    ]);
  if (registeredRideId) {
    await pool.query("DELETE FROM audit_events WHERE entity_id=$1", [registeredRideId]);
    await pool.query("DELETE FROM notifications WHERE payload->>'jobId'=$1", [registeredRideId]);
    await pool.query("DELETE FROM jobs WHERE public_id=$1", [registeredRideId]);
  }
  if (registeredRideKey)
    await pool.query("DELETE FROM idempotency_keys WHERE key=$1", [registeredRideKey]);
  if (unvalidatedAddressId)
    await pool.query("DELETE FROM addresses WHERE id=$1", [unvalidatedAddressId]);
  if (moderationDriverId)
    await pool.query("DELETE FROM drivers WHERE public_id=$1", [moderationDriverId]);
  const riskKeys = [
    idempotencyKey,
    rideKey,
    scheduledRideKey,
    shipmentKey,
    proofShipmentKey,
    settlementOrderKey,
    registeredRideKey,
  ].filter(Boolean);
  if (riskKeys.length)
    await pool.query("DELETE FROM transaction_risk_assessments WHERE idempotency_key=ANY($1)", [
      riskKeys,
    ]);
  if (registeredUserId) {
    await pool.query("DELETE FROM audit_events WHERE entity_type='user' AND entity_id=$1", [
      registeredUserId,
    ]);
    await pool.query(
      "DELETE FROM transaction_risk_assessments WHERE customer_id=(SELECT id FROM users WHERE public_id=$1)",
      [registeredUserId],
    );
    // Barrido por actor antes de borrar la persona. La limpieza puntual de cada
    // entidad de arriba cubre lo que esta corrida creo, pero vive dentro de sus
    // propios `if`: si el smoke corta antes, esos bloques no corren y el borrado
    // del usuario falla por clave foranea con un mensaje que no dice cual evento
    // sobro. Esto cierra esa clase entera en vez de la instancia de hoy.
    await pool.query(
      "DELETE FROM audit_events WHERE actor_id=(SELECT id FROM users WHERE public_id=$1)",
      [registeredUserId],
    );
    await pool.query("DELETE FROM users WHERE public_id=$1", [registeredUserId]);
  }
  token = customerToken || token;
  if (token) {
    const restaurantId = originalCart[0]?.restaurantId || "empty";
    await request("/cart", {
      method: "PUT",
      body: JSON.stringify({
        restaurantId,
        items: originalCart.map((line) => ({
          menuItemId: line.item.id,
          quantity: line.quantity,
          extras: line.extras,
          note: line.note,
        })),
      }),
    });
  }
  await pool.end();
  await closePostgres();
}
