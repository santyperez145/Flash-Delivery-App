import { createPool } from "./db-client.mjs";
import { config } from "../server/config.js";
import { createMapCacheKey } from "../server/map-cache-repository.js";
import { verifyGeocodeValidation } from "../server/geocoding-validation.js";
// La clave de caché se deriva del proveedor, no de su URL: cambiar de proveedor
// no debe servir una entrada cacheada por otro con criterios distintos.
import { mapsProvider } from "../server/maps-provider.js";

const apiBase = process.env.API_URL || "http://127.0.0.1:4000/api";
const pool = createPool();
const keys = [];
const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};

try {
  const loginResponse = await fetch(`${apiBase}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "cliente@flash.app",
      password: "demo123",
      deviceName: "maps-smoke",
    }),
  });
  const login = await loginResponse.json();
  assert(loginResponse.ok && login.token, "authenticated maps smoke session");
  const headers = { Authorization: `Bearer ${login.token}` };

  const query = "Fixture privada avenida 123";
  const normalized = query.normalize("NFKC").toLocaleLowerCase("es-AR").replace(/\s+/g, " ");
  const provider = mapsProvider();
  const geocodeKey = createMapCacheKey(`${provider.name}|geocode|${normalized}`);
  keys.push(geocodeKey);
  const geocodePayload = {
    results: [
      {
        label: "Resultado cacheado",
        point: { lat: -34.6037, lng: -58.3816 },
        type: "address",
        placeId: "fixture:map:result",
      },
    ],
  };
  await pool.query(
    `INSERT INTO map_provider_cache(cache_key,kind,provider,payload,expires_at)
     VALUES($1,'geocode',$2,$3,now()+interval '5 minutes')`,
    [geocodeKey, provider.name, geocodePayload],
  );
  const geocodeResponse = await fetch(`${apiBase}/maps/geocode?q=${encodeURIComponent(query)}`, {
    headers,
  });
  const geocode = await geocodeResponse.json();
  assert(
    geocodeResponse.ok &&
      geocode.cache === "hit" &&
      geocode.results?.[0]?.label === "Resultado cacheado",
    "geocoder serves durable PostgreSQL cache without provider access",
  );
  const signedAddress = verifyGeocodeValidation(geocode.results[0].validationToken, login.user.id);
  assert(
    signedAddress.providerPlaceId === "fixture:map:result" &&
      signedAddress.address === "Resultado cacheado",
    "geocoder signs the provider identity and authoritative address",
  );
  let rejectedForAnotherUser = false;
  try {
    verifyGeocodeValidation(geocode.results[0].validationToken, "usr_other_customer");
  } catch (error) {
    rejectedForAnotherUser = error.status === 409;
  }
  assert(rejectedForAnotherUser, "geocode validation is bound to the authenticated customer");

  const coordinates = [-34.6037, -58.3816, -34.6158, -58.4333];
  const routeIdentity = coordinates.map((value) => value.toFixed(5)).join(",");
  const routeKey = createMapCacheKey(`${provider.routingName}|driving|${routeIdentity}`);
  keys.push(routeKey);
  const route = {
    distanceKm: 6.4,
    durationMin: 18,
    coordinates: [
      { lat: coordinates[0], lng: coordinates[1] },
      { lat: coordinates[2], lng: coordinates[3] },
    ],
    steps: [],
  };
  await pool.query(
    `INSERT INTO map_provider_cache(cache_key,kind,provider,payload,expires_at) VALUES($1,'route','smoke',$2,now()+interval '5 minutes')`,
    [routeKey, { route }],
  );
  const params = new URLSearchParams({
    fromLat: String(coordinates[0]),
    fromLng: String(coordinates[1]),
    toLat: String(coordinates[2]),
    toLng: String(coordinates[3]),
  });
  const routeResponse = await fetch(`${apiBase}/maps/route?${params}`, { headers });
  const routed = await routeResponse.json();
  assert(
    routeResponse.ok && routed.cache === "hit" && routed.route?.distanceKm === 6.4,
    "router serves durable PostgreSQL cache without provider access",
  );
  const invalidResponse = await fetch(
    `${apiBase}/maps/route?fromLat=190&fromLng=0&toLat=0&toLng=0`,
    { headers },
  );
  assert(
    invalidResponse.status === 400,
    "router rejects out-of-range coordinates before provider access",
  );
  const stored = JSON.stringify(
    (
      await pool.query(
        "SELECT cache_key,kind,provider FROM map_provider_cache WHERE cache_key=ANY($1)",
        [keys],
      )
    ).rows,
  );
  assert(!stored.includes(query), "cache keys do not persist the queried address in clear text");
} finally {
  if (keys.length)
    await pool.query("DELETE FROM map_provider_cache WHERE cache_key=ANY($1)", [keys]);
  await pool.end();
}
