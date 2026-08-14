import { spawn } from "node:child_process";

const port = process.env.TEST_PORT || "4199";
const base = `http://127.0.0.1:${port}/api`;
const server = spawn(process.execPath, ["server/index.js"], {
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
  for (let attempt = 0; attempt < 30; attempt += 1) {
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
    ready.status === 200 && ready.body?.requestId && ready.body?.database === "ready",
    "ready endpoint exposes request id",
    ready.text
  );

  const stateNoToken = await request("/state");
  assert(stateNoToken.status === 401, "state rejects anonymous", stateNoToken.text);

  const eventsNoToken = await request("/events");
  assert(eventsNoToken.status === 401, "realtime rejects anonymous", eventsNoToken.text);

  const resetNoToken = await request("/reset", { method: "POST" });
  assert(resetNoToken.status === 401, "reset rejects anonymous", resetNoToken.text);

  const customerToken = await login("cliente@flash.app");
  const merchantToken = await login("comercio@flash.app");
  const driverToken = await login("conductor@flash.app");
  const adminToken = await login("ops@flash.app");

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

  const state = await request("/state", { headers: auth(customerToken) });
  assert(
    state.status === 200 && state.body?.state?.restaurants?.length > 0,
    "state accepts authenticated user",
    state.text
  );
  assert(state.body?.state?.meta?.version >= 4, "database schema version is current", state.text);

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
    coordinateQuote.status === 200 && coordinateQuote.body?.quote?.routingMode === "coordinates",
    "ride quote uses coordinates",
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
