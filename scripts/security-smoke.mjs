import { spawn } from "node:child_process";

const port = process.env.TEST_PORT || "4199";
const base = `http://127.0.0.1:${port}/api`;
const server = spawn(process.execPath, ["server/start.js"], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: "test", LOG_LEVEL: "silent", PORT: port },
  stdio: ["ignore", "pipe", "pipe"]
});

server.stderr.on("data", (data) => process.stderr.write(data));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch (_error) {
    // Keep the raw text for useful assertion failures.
  }
  return { status: response.status, body, text };
}

function assert(condition, label, detail) {
  if (!condition) {
    throw new Error(`${label} failed: ${detail || "no detail"}`);
  }
  console.log(`ok - ${label}`);
}

async function readRealtimeUntil(reader, expected) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const frame = new TextDecoder().decode((await reader.read()).value || new Uint8Array());
    if (frame.includes(expected)) return frame;
  }
  return "";
}

async function login(email) {
  const response = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "demo123" })
  });
  assert(response.status === 200 && response.body?.token, `login ${email}`, response.text);
  return response.body.token;
}

async function waitForApi() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const health = await request("/health");
      if (health.status === 200) return;
    } catch (_error) {
      await sleep(200);
    }
  }
  throw new Error("backend did not start");
}

async function run() {
  await waitForApi();

  const ready = await request("/ready");
  assert(
    ready.status === 200 && ready.body?.requestId && ready.body?.database && ["sqlite-demo", "transition"].includes(ready.body?.runtimeStore),
    "ready endpoint exposes request id",
    ready.text
  );

  const stateNoToken = await request("/bootstrap/customer");
  assert(stateNoToken.status === 401, "bootstrap rejects anonymous", stateNoToken.text);

  const retiredStateNoToken = await request("/state");
  assert(retiredStateNoToken.status === 401, "retired global state still rejects anonymous", retiredStateNoToken.text);

  const eventsNoToken = await request("/events");
  assert(eventsNoToken.status === 401, "realtime rejects anonymous", eventsNoToken.text);

  const resetNoToken = await request("/reset", { method: "POST" });
  assert(resetNoToken.status === 401, "reset rejects anonymous", resetNoToken.text);

  const customerToken = await login("cliente@flash.app");
  const merchantToken = await login("comercio@flash.app");
  const driverToken = await login("conductor@flash.app");
  const adminToken = await login("ops@flash.app");
  const metricsWithoutToken=await request("/internal/metrics"),metricsWithAdminJwt=await request("/internal/metrics",{headers:auth(adminToken)});
  assert(metricsWithoutToken.status===401&&metricsWithAdminJwt.status===401,"metrics require dedicated scrape token",metricsWithAdminJwt.text);

  const sessionLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "cliente@flash.app", password: "demo123", deviceName: "security-smoke" })
  });
  assert(sessionLogin.status === 200 && sessionLogin.body?.refreshToken, "login issues refresh session", sessionLogin.text);
  const firstRefreshToken = sessionLogin.body.refreshToken;
  const rotatedSession = await request("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken: firstRefreshToken, deviceName: "security-smoke" })
  });
  assert(rotatedSession.status === 200 && rotatedSession.body?.refreshToken !== firstRefreshToken, "refresh token rotates", rotatedSession.text);
  const reusedSession = await request("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken: firstRefreshToken })
  });
  assert(reusedSession.status === 401, "rotated refresh token cannot be reused", reusedSession.text);
  const logoutSession = await request("/auth/logout", {
    method: "POST",
    body: JSON.stringify({ refreshToken: rotatedSession.body.refreshToken })
  });
  assert(logoutSession.status === 200, "logout revokes session", logoutSession.text);
  const refreshAfterLogout = await request("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken: rotatedSession.body.refreshToken })
  });
  assert(refreshAfterLogout.status === 401, "revoked session cannot refresh", refreshAfterLogout.text);

  const account = await request("/me", { headers: auth(customerToken) });
  assert(
    account.status === 200 && account.body?.account?.user?.email === "cliente@flash.app",
    "customer reads own account",
    account.text
  );

  const profile = await request("/me", {
    method: "PATCH",
    headers: auth(customerToken),
    body: JSON.stringify({
      name: "Lucia Flash",
      phone: "+5491100000000",
      defaultAddress: "Defensa 982, San Telmo"
    })
  });
  assert(profile.status === 200 && profile.body?.account?.user?.name === "Lucia Flash", "customer updates own profile", profile.text);

  const topUp = await request("/wallet/topup", {
    method: "POST",
    headers: auth(customerToken),
    body: JSON.stringify({ amount: 10000 })
  });
  assert(
    topUp.status === 200 && topUp.body?.account?.user?.wallet >= 28600 && topUp.body?.account?.walletTransactions?.[0]?.kind === "credit",
    "customer tops up wallet in sandbox",
    topUp.text
  );

  const savedAddress = await request("/addresses", {
    method: "POST",
    headers: auth(customerToken),
    body: JSON.stringify({
      label: "Prueba",
      address: "Av. Corrientes 1234",
      lat: -34.6037,
      lng: -58.3816,
      isDefault: false
    })
  });
  assert(savedAddress.status === 201 && savedAddress.body?.address?.userId === "usr_customer", "customer creates owned address", savedAddress.text);
  const savedAddressId = savedAddress.body.address.id;
  const foreignAddressUpdate = await request(`/addresses/${savedAddressId}`, {
    method: "PUT",
    headers: auth(merchantToken),
    body: JSON.stringify({
      label: "Intrusa",
      address: "Av. Corrientes 1234",
      lat: -34.6037,
      lng: -58.3816,
      isDefault: false
    })
  });
  assert(foreignAddressUpdate.status === 404, "address ownership rejects foreign update", foreignAddressUpdate.text);
  const updatedAddress = await request(`/addresses/${savedAddressId}`, {
    method: "PUT",
    headers: auth(customerToken),
    body: JSON.stringify({
      label: "Trabajo",
      address: "Av. Corrientes 1234, CABA",
      lat: -34.6037,
      lng: -58.3816,
      isDefault: false
    })
  });
  assert(updatedAddress.status === 200 && updatedAddress.body?.address?.label === "Trabajo", "customer edits owned address", updatedAddress.text);
  const defaultAddress = await request(`/addresses/${savedAddressId}/default`, {
    method: "PATCH",
    headers: auth(customerToken),
    body: "{}"
  });
  assert(defaultAddress.status === 200 && defaultAddress.body?.addresses?.find((entry) => entry.id === savedAddressId)?.isDefault === true, "customer selects default address", defaultAddress.text);
  const deletedAddress = await request(`/addresses/${savedAddressId}`, {
    method: "DELETE",
    headers: auth(customerToken)
  });
  assert(deletedAddress.status === 200 && deletedAddress.body?.deleted === true, "customer deletes owned address", deletedAddress.text);

  const state = await request("/bootstrap/customer", { headers: auth(customerToken) });
  const customerActivity=await request("/me/activity?limit=50",{headers:auth(customerToken)}),customerCatalog=await request("/catalog/restaurants?limit=50",{headers:auth(customerToken)});
  assert(
    state.status === 200 && customerCatalog.body?.restaurants?.length > 0,
    "segmented resources accept authenticated user",
    state.text
  );

  const retiredState = await request("/state", { headers: auth(customerToken) });
  assert(retiredState.status === 410, "authenticated clients cannot regress to global state", retiredState.text);
  assert(state.body?.state?.meta?.version >= 4, "database schema version is current", state.text);
  assert(state.body?.state?.users?.length === 1 && state.body.state.users[0].id === "usr_customer", "customer state hides other users", state.text);
  assert(customerActivity.body?.items?.every(entry=>entry.resource?.customerId==="usr_customer"), "customer activity enforces job ownership", customerActivity.text);

  const merchantState = await request("/merchant/me", { headers: auth(merchantToken) });
  const merchantActivity=await request("/me/activity?limit=50",{headers:auth(merchantToken)});
  assert(merchantState.body?.restaurants?.every((entry) => entry.ownerId === "usr_merchant")&&merchantActivity.body?.items?.every(entry=>entry.kind==="order"), "merchant resources are scoped to owned commerce", merchantState.text);
  const driverState = await request("/me/activity?limit=50", { headers: auth(driverToken) });
  const unassignedOffer=driverState.body?.items?.find(entry=>entry.kind==="order"&&!entry.resource?.courierId);
  assert(driverState.status===200&&(!unassignedOffer||unassignedOffer.resource.customerId==="private"), "driver offers redact customer identity", driverState.text);

  const customerDashboard = await request("/admin/dashboard", { headers: auth(customerToken) });
  assert(customerDashboard.status === 403, "customer cannot read admin dashboard", customerDashboard.text);

  const adminDashboard = await request("/admin/dashboard", { headers: auth(adminToken) });
  assert(
    adminDashboard.status === 200 && adminDashboard.body?.dashboard?.investor?.readinessScore,
    "admin reads investor dashboard",
    adminDashboard.text
  );

  const coordinateQuote = await request("/rides/quote", {
    method: "POST",
    body: JSON.stringify({
      pickup: "Defensa 982, San Telmo",
      destination: "Aeroparque Jorge Newbery",
      service: "economy",
      pickupCoords: { lat: -34.6177, lng: -58.3621 },
      destinationCoords: { lat: -34.5596, lng: -58.4156 }
    })
  });
  assert(
    coordinateQuote.status === 200 && coordinateQuote.body?.quote?.routingMode === "coordinates" && coordinateQuote.body.quote.quoteToken && coordinateQuote.body.quote.expiresAt,
    "ride quote uses coordinates and returns a signed expiring token",
    coordinateQuote.text
  );

  const forbiddenLocation = await request("/drivers/drv_lautaro/location", {
    method: "PATCH",
    headers: auth(customerToken),
    body: JSON.stringify({ lat: -34.6, lng: -58.4, label: "Intento" })
  });
  assert(forbiddenLocation.status === 403, "customer cannot update driver location", forbiddenLocation.text);

  const driverLocation = await request("/drivers/drv_lautaro/location", {
    method: "PATCH",
    headers: auth(driverToken),
    body: JSON.stringify({ lat: -34.6177, lng: -58.3621, label: "San Telmo GPS" })
  });
  assert(
    driverLocation.status === 200 && driverLocation.body?.driver?.location?.label === "San Telmo GPS",
    "driver updates own location",
    driverLocation.text
  );

  const realtimeController = new AbortController();
  const realtimeResponse = await fetch(`${base}/events`, {
    headers: auth(adminToken),
    signal: realtimeController.signal
  });
  assert(
    realtimeResponse.status === 200 && realtimeResponse.headers.get("content-type")?.includes("text/event-stream"),
    "admin opens realtime stream",
    `status=${realtimeResponse.status}`
  );
  const realtimeReader = realtimeResponse.body.getReader();
  const firstRealtimeFrame = new TextDecoder().decode((await realtimeReader.read()).value || new Uint8Array());
  assert(firstRealtimeFrame.includes("event: connected"), "realtime sends connected frame", firstRealtimeFrame);

  const forbiddenRestaurant = await request("/restaurants/rest_roja", {
    method: "PATCH",
    headers: auth(customerToken),
    body: JSON.stringify({ open: false })
  });
  assert(forbiddenRestaurant.status === 403, "customer cannot manage restaurant", forbiddenRestaurant.text);

  const merchantRestaurant = await request("/restaurants/rest_roja", {
    method: "PATCH",
    headers: auth(merchantToken),
    body: JSON.stringify({ open: true, etaMin: 24 })
  });
  assert(merchantRestaurant.status === 200, "merchant manages owned restaurant", merchantRestaurant.text);

  const merchantDashboard = await request("/merchant/dashboard", { headers: auth(merchantToken) });
  assert(
    merchantDashboard.status === 200 && merchantDashboard.body?.dashboard?.restaurant?.id === "rest_roja",
    "merchant reads owned operational dashboard",
    merchantDashboard.text
  );

  const forbiddenOrder = await request("/orders", {
    method: "POST",
    headers: auth(driverToken),
    body: JSON.stringify({
      customerId: "usr_customer",
      restaurantId: "rest_roja",
      deliveryAddress: "Defensa 982",
      paymentMethod: "Flash Wallet",
      items: [{ menuItemId: "item_burger_brava", quantity: 1, extras: [], note: "" }]
    })
  });
  assert(forbiddenOrder.status === 403, "driver cannot create customer order", forbiddenOrder.text);

  const order = await request("/orders", {
    method: "POST",
    headers: auth(customerToken),
    body: JSON.stringify({
      customerId: "usr_customer",
      restaurantId: "rest_roja",
      deliveryAddress: "Defensa 982",
      paymentMethod: "Flash Wallet",
      items: [{ menuItemId: "item_burger_brava", quantity: 1, extras: [], note: "sin cebolla" }]
    })
  });
  assert(order.status === 200 && order.body?.order?.id, "customer creates order", order.text);

  const orderRealtimeFrame = await readRealtimeUntil(realtimeReader, "order.created");
  assert(orderRealtimeFrame.includes("order.created"), "realtime publishes order mutation", orderRealtimeFrame);
  realtimeController.abort();

  const accepted = await request(`/orders/${order.body.order.id}/accept-delivery`, {
    method: "POST",
    headers: auth(driverToken),
    body: JSON.stringify({ driverId: "drv_lautaro" })
  });
  assert(accepted.status === 200, "driver accepts delivery", accepted.text);

  const advanced = await request(`/orders/${order.body.order.id}/advance`, {
    method: "POST",
    headers: auth(driverToken)
  });
  assert(
    advanced.status === 200 && advanced.body?.order?.status === "picked_up",
    "assigned driver advances order",
    advanced.text
  );

  await request(`/orders/${order.body.order.id}/advance`, { method: "POST", headers: auth(driverToken) });
  const delivered = await request(`/orders/${order.body.order.id}/advance`, { method: "POST", headers: auth(driverToken) });
  assert(delivered.status === 200 && delivered.body?.order?.status === "delivered", "driver completes delivery", delivered.text);
  const driverAccount = await request("/me", { headers: auth(driverToken) });
  assert(
    driverAccount.status === 200 && driverAccount.body?.account?.user?.wallet > 38200 && driverAccount.body?.account?.walletTransactions?.[0]?.kind === "credit",
    "completed delivery credits driver wallet",
    driverAccount.text
  );

  const shipmentQuote = await request("/shipments/quote", {
    method: "POST",
    body: JSON.stringify({
      pickup: "Defensa 982, San Telmo",
      destination: "Av. Santa Fe 1800, Recoleta",
      packageSize: "small",
      weightKg: 2
    })
  });
  assert(shipmentQuote.status === 200 && shipmentQuote.body?.quote?.fare > 0, "shipment quote calculates fare", shipmentQuote.text);

  const forbiddenShipment = await request("/shipments", {
    method: "POST",
    headers: auth(driverToken),
    body: JSON.stringify({ customerId: "usr_customer" })
  });
  assert(forbiddenShipment.status === 403, "driver cannot create customer shipment", forbiddenShipment.text);

  const shipment = await request("/shipments", {
    method: "POST",
    headers: auth(customerToken),
    body: JSON.stringify({
      customerId: "usr_customer",
      pickup: "Defensa 982, San Telmo",
      destination: "Av. Santa Fe 1800, Recoleta",
      recipientName: "Martin Demo",
      recipientPhone: "+5491100000001",
      packageSize: "small",
      description: "Documentos cerrados",
      weightKg: 1.5,
      deliveryNotes: "Entregar en mano",
      paymentMethod: "Flash Wallet",
      termsAccepted: true
    })
  });
  assert(shipment.status === 200 && shipment.body?.shipment?.deliveryPin, "customer creates tracked shipment", shipment.text);

  const cancelShipment = await request(`/shipments/${shipment.body.shipment.id}/status`, {
    method: "PATCH",
    headers: auth(customerToken),
    body: JSON.stringify({ status: "cancelled", reason: "changed_mind" })
  });
  assert(cancelShipment.status === 200 && cancelShipment.body?.shipment?.status === "cancelled", "customer cancels own shipment", cancelShipment.text);

  const customerReset = await request("/reset", { method: "POST", headers: auth(customerToken) });
  assert(customerReset.status === 403, "customer cannot reset platform", customerReset.text);

  const adminReset = await request("/reset", { method: "POST", headers: auth(adminToken) });
  assert(adminReset.status === 200, "admin resets platform", adminReset.text);
}

try {
  await run();
} finally {
  server.kill();
}
