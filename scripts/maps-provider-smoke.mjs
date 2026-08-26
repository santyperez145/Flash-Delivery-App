// Contrato del adapter cartográfico (ticket GEO-001).
//
// `describe*` y `parse*` son funciones puras: este contrato se verifica entero
// sin credenciales ni red. Lo que NO puede verificar es la calidad real de las
// rutas ni el costo por consulta, que exigen una API key y tráfico real.
import assert from "node:assert/strict";

process.env.MAPS_PROVIDER = "google";
process.env.GOOGLE_MAPS_SERVER_API_KEY = "AIza-clave-de-prueba-no-real-000";

const { mapsProvider, isCommercialProvider, decodePolyline } = await import(
  "../server/maps-provider.js"
);

const ok = (label) => console.log(`ok - ${label}`);
const punto = { fromLat: -34.6037, fromLng: -58.3816, toLat: -34.5592, toLng: -58.4156 };

// --- Selección de proveedor --------------------------------------------------

assert.equal(mapsProvider("openstreetmap").name, "openstreetmap");
assert.equal(mapsProvider("google").name, "google");
assert.throws(() => mapsProvider("inventado"), /Proveedor cartográfico desconocido/);
ok("el proveedor se elige por nombre y uno desconocido falla en lugar de degradar");

assert.equal(isCommercialProvider("openstreetmap"), false);
assert.equal(isCommercialProvider("google"), true);
ok("el adapter distingue un proveedor comercial de una instancia pública");

// --- OpenStreetMap: forma normalizada ---------------------------------------

const osm = mapsProvider("openstreetmap");

const osmGeocode = osm.describeGeocode("Av. Corrientes 1234");
assert.equal(osmGeocode.url.searchParams.get("countrycodes"), "ar");
assert.ok(osmGeocode.headers["User-Agent"].includes("FlashDeliveryApp"));
ok("Nominatim recibe el User-Agent que su política de uso exige");

const osmResults = osm.parseGeocode([
  { display_name: "Av. Corrientes 1234", lat: "-34.60", lon: "-58.38", type: "road" },
  { display_name: "Sin coordenadas", lat: "no", lon: "no" },
]);
assert.equal(osmResults.length, 1);
assert.deepEqual(osmResults[0].point, { lat: -34.6, lng: -58.38 });
assert.equal(osmResults[0].placeId, null);
ok("un resultado sin coordenadas válidas se descarta en lugar de propagarse");

const osmRoute = osm.parseRoute({
  routes: [
    {
      distance: 5400,
      duration: 900,
      geometry: { coordinates: [[-58.38, -34.6], [-58.41, -34.55]] },
      legs: [
        {
          steps: [
            {
              name: "Av. Corrientes",
              distance: 200,
              duration: 30,
              maneuver: { type: "turn", modifier: "left", location: [-58.38, -34.6] },
            },
          ],
        },
      ],
    },
  ],
});
assert.equal(osmRoute.distanceKm, 5.4);
assert.equal(osmRoute.durationMin, 15);
assert.equal(osmRoute.coordinates.length, 2);
assert.equal(osmRoute.steps[0].street, "Av. Corrientes");
assert.equal(osmRoute.trafficAware, false);
ok("la ruta OSRM se normaliza y se declara sin conciencia de tráfico");

assert.equal(osm.parseRoute({ routes: [] }), null);
ok("sin ruta transitable devuelve null en lugar de inventar una recta");

// El demo público no ofrece matriz: decirlo es mejor que caer en silencio a
// distancia geodésica, que es lo que el dispatch hace hoy.
assert.throws(() => osm.describeRouteMatrix({ origins: [{}], destinations: [{}] }), /no ofrece matriz/);
ok("el proveedor de desarrollo declara que no tiene matriz en lugar de degradar callado");

// --- Google: peticiones ------------------------------------------------------

const g = mapsProvider("google");

const gGeocode = g.describeGeocode("Av. Corrientes 1234");
assert.ok(gGeocode.url.href.startsWith("https://maps.googleapis.com/maps/api/geocode/json"));
assert.equal(gGeocode.url.searchParams.get("region"), "ar");
assert.equal(gGeocode.url.searchParams.get("key"), "AIza-clave-de-prueba-no-real-000");
ok("el geocoding de Google va autenticado y acotado a Argentina");

const gRoute = g.describeRoute(punto);
assert.equal(gRoute.method, "POST");
assert.equal(gRoute.headers["x-goog-api-key"], "AIza-clave-de-prueba-no-real-000");
assert.equal(gRoute.body.routingPreference, "TRAFFIC_AWARE");
assert.equal(gRoute.body.origin.location.latLng.latitude, -34.6037);
ok("la ruta de Google pide preferencia con tráfico");

// Sin field mask Google factura la respuesta completa: no es un detalle.
assert.ok(gRoute.headers["x-goog-fieldmask"].includes("routes.distanceMeters"));
assert.ok(!gRoute.headers["x-goog-fieldmask"].includes("*"));
ok("la field mask limita lo que se pide y por lo tanto lo que se paga");

// --- Google: respuestas ------------------------------------------------------

const gResults = g.parseGeocode({
  status: "OK",
  results: [
    {
      formatted_address: "Av. Corrientes 1234, CABA",
      geometry: { location: { lat: -34.6037, lng: -58.3816 } },
      types: ["street_address"],
      place_id: "ChIJ-place-id-estable",
    },
  ],
});
assert.equal(gResults[0].placeId, "ChIJ-place-id-estable");
assert.equal(gResults[0].label, "Av. Corrientes 1234, CABA");
ok("el place_id se conserva: una dirección estable no se reinterpreta en cada uso");

assert.deepEqual(g.parseGeocode({ status: "ZERO_RESULTS", results: [] }), []);
assert.throws(() => g.parseGeocode({ status: "REQUEST_DENIED" }), /REQUEST_DENIED/);
ok("una respuesta sin resultados es vacío y un rechazo del proveedor es un error");

const gParsed = g.parseRoute({
  routes: [
    {
      distanceMeters: 5400,
      duration: "900s",
      polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC" },
      legs: [
        {
          steps: [
            {
              navigationInstruction: { maneuver: "TURN_LEFT", instructions: "Doblá en Corrientes" },
              distanceMeters: 200,
              staticDuration: "30s",
              startLocation: { latLng: { latitude: -34.6, longitude: -58.38 } },
            },
          ],
        },
      ],
    },
  ],
});
assert.equal(gParsed.distanceKm, 5.4);
assert.equal(gParsed.durationMin, 15);
assert.equal(gParsed.trafficAware, true);
assert.equal(gParsed.steps[0].street, "Doblá en Corrientes");
assert.ok(gParsed.coordinates.length > 0);
ok("la ruta de Google produce la MISMA forma normalizada que OSRM");

// La forma normalizada es lo que hace intercambiable al proveedor.
assert.deepEqual(Object.keys(gParsed).sort(), Object.keys(osmRoute).sort());
ok("ambos proveedores devuelven exactamente las mismas claves");

// --- Matriz de rutas: dependencia del dispatch v2 ---------------------------

const matrix = g.describeRouteMatrix({
  origins: [{ lat: -34.6, lng: -58.38 }, { lat: -34.61, lng: -58.39 }],
  destinations: [{ lat: -34.55, lng: -58.41 }],
});
assert.equal(matrix.body.origins.length, 2);
assert.equal(matrix.body.destinations.length, 1);
assert.ok(matrix.headers["x-goog-fieldmask"].includes("duration"));
ok("la matriz pide varios orígenes contra un destino en una sola llamada");

assert.throws(
  () => g.describeRouteMatrix({ origins: new Array(626).fill({ lat: 0, lng: 0 }), destinations: [{ lat: 0, lng: 0 }] }),
  /625 elementos/,
);
ok("la matriz corta en el límite facturable antes de salir a la red");

const parsedMatrix = g.parseRouteMatrix([
  { originIndex: 0, destinationIndex: 0, distanceMeters: 4200, duration: "600s", condition: "ROUTE_EXISTS" },
  { originIndex: 1, destinationIndex: 0, condition: "ROUTE_NOT_FOUND" },
]);
assert.equal(parsedMatrix.length, 1);
assert.deepEqual(parsedMatrix[0], { originIndex: 0, destinationIndex: 0, distanceM: 4200, durationSec: 600 });
ok("un par sin ruta se descarta en lugar de contarse como alcanzable");

// --- Polilínea ---------------------------------------------------------------

const decoded = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
assert.equal(decoded.length, 3);
assert.ok(Math.abs(decoded[0].lat - 38.5) < 0.001);
assert.ok(Math.abs(decoded[0].lng + 120.2) < 0.001);
ok("la polilínea codificada de Google se decodifica a coordenadas");

// --- La clave nunca viaja en un error ---------------------------------------

delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
const { config } = await import("../server/config.js");
config.maps.googleServerApiKey = null;
assert.throws(() => g.describeRoute(punto), /Falta la API key/);
ok("sin API key el proveedor falla explícito y no expone la clave");

console.log("\nok - contrato del adapter cartográfico verificado");
console.log("     pendiente: calidad real de rutas y costo por consulta con una API key habilitada");
