// Adapter de proveedor cartográfico (ticket GEO-001, hallazgo H-07).
//
// Hasta el 26 de agosto de 2026 los valores por defecto eran Nominatim y OSRM
// públicos. Es aceptable para desarrollo e inaceptable para una plataforma
// comercial: la política de uso de Nominatim prohíbe autocomplete de cliente
// contra la instancia pública y advierte a las aplicaciones comerciales que no
// dependan de ella. El demo público de OSRM está en la misma situación.
//
// Además, sin routing vial real toda tarifa se calcula sobre distancia
// geodésica, que el cliente percibe como incorrecta en cuanto el trayecto tenga
// un río, una mano única o una autopista.
//
// Diseño: cada proveedor expone funciones PURAS `describe*` y `parse*`. El
// `describe` arma la petición y el `parse` normaliza la respuesta; ninguna toca
// la red. Así el caché, el circuit breaker, el presupuesto y las métricas siguen
// viviendo donde ya estaban, el proveedor es intercambiable sin tocar dominio, y
// el contrato se puede verificar entero sin credenciales.
import { config } from "./config.js";

const GOOGLE_ROUTES = "https://routes.googleapis.com";
const GOOGLE_PLACES = "https://places.googleapis.com";
const GOOGLE_GEOCODE = "https://maps.googleapis.com/maps/api/geocode/json";

// --- OpenStreetMap: sólo desarrollo -----------------------------------------

const openstreetmap = {
  name: "openstreetmap",
  routingName: "osrm",
  commercial: false,

  describeGeocode(query) {
    const url = new URL("/search", config.geocodingUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "5");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("countrycodes", "ar");
    return {
      url,
      headers: { "User-Agent": "FlashDeliveryApp/0.1 (operations@flash.local)" },
    };
  },

  parseGeocode(payload) {
    if (!Array.isArray(payload)) return [];
    return payload
      .map((entry) => ({
        label: entry.display_name,
        point: { lat: Number(entry.lat), lng: Number(entry.lon) },
        type: entry.type || "address",
        // Nominatim no da un identificador estable reutilizable como place_id.
        placeId: null,
      }))
      .filter((entry) => Number.isFinite(entry.point.lat) && Number.isFinite(entry.point.lng));
  },

  describeRoute({ fromLat, fromLng, toLat, toLng }) {
    const url = new URL(
      `/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}`,
      config.routingUrl,
    );
    url.searchParams.set("overview", "full");
    url.searchParams.set("geometries", "geojson");
    url.searchParams.set("steps", "true");
    return { url, headers: {} };
  },

  parseRoute(payload) {
    const route = payload?.routes?.[0];
    if (!route) return null;
    return {
      distanceKm: Number((route.distance / 1000).toFixed(1)),
      durationMin: Math.max(1, Math.round(route.duration / 60)),
      coordinates: (route.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng })),
      steps: (route.legs || [])
        .flatMap((leg) => leg.steps || [])
        .map((step) => ({
          type: step.maneuver?.type || "continue",
          modifier: step.maneuver?.modifier || "straight",
          street: step.name || "calle sin nombre",
          distanceM: Math.round(step.distance),
          durationSec: Math.round(step.duration),
          location: {
            lat: Number(step.maneuver.location[1]),
            lng: Number(step.maneuver.location[0]),
          },
        })),
      // OSRM del demo público no modela tráfico.
      trafficAware: false,
    };
  },

  describeRouteMatrix() {
    // El demo público no ofrece matriz utilizable. Dejar que el dispatch caiga
    // en distancia geodésica en silencio sería peor que decir que no está.
    throw Object.assign(
      new Error("El proveedor de desarrollo no ofrece matriz de rutas"),
      { status: 503 },
    );
  },

  parseRouteMatrix() {
    throw new Error("El proveedor de desarrollo no ofrece matriz de rutas");
  },
};

// --- Google: Places + Routes -------------------------------------------------

function googleKey() {
  const key = config.maps?.googleServerApiKey;
  if (!key) throw Object.assign(new Error("Falta la API key de servidor de Google Maps"), { status: 503 });
  return key;
}

const google = {
  name: "google",
  routingName: "google",
  commercial: true,

  describeGeocode(query) {
    const url = new URL(GOOGLE_GEOCODE);
    url.searchParams.set("address", query);
    url.searchParams.set("region", "ar");
    url.searchParams.set("language", "es-419");
    url.searchParams.set("key", googleKey());
    return { url, headers: { accept: "application/json" } };
  },

  parseGeocode(payload) {
    if (payload?.status && payload.status !== "OK" && payload.status !== "ZERO_RESULTS") {
      throw Object.assign(new Error(`Google Geocoding devolvió ${payload.status}`), { status: 502 });
    }
    return (payload?.results ?? [])
      .map((entry) => ({
        label: entry.formatted_address,
        point: {
          lat: Number(entry.geometry?.location?.lat),
          lng: Number(entry.geometry?.location?.lng),
        },
        type: entry.types?.[0] || "address",
        // Guardar el place_id evita reinterpretar una dirección ambigua en
        // cada uso posterior. Es la diferencia entre una dirección estable y
        // un texto que cada consulta puede resolver distinto.
        placeId: entry.place_id ?? null,
      }))
      .filter((entry) => Number.isFinite(entry.point.lat) && Number.isFinite(entry.point.lng));
  },

  describeRoute({ fromLat, fromLng, toLat, toLng }) {
    return {
      url: new URL("/directions/v2:computeRoutes", GOOGLE_ROUTES),
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": googleKey(),
        // Sin field mask Google cobra la respuesta completa. Pedir sólo lo que
        // se usa es una decisión de costo, no un detalle.
        "x-goog-fieldmask": [
          "routes.distanceMeters",
          "routes.duration",
          "routes.polyline.encodedPolyline",
          "routes.legs.steps.navigationInstruction",
          "routes.legs.steps.distanceMeters",
          "routes.legs.steps.staticDuration",
          "routes.legs.steps.startLocation",
        ].join(","),
      },
      body: {
        origin: { location: { latLng: { latitude: fromLat, longitude: fromLng } } },
        destination: { location: { latLng: { latitude: toLat, longitude: toLng } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        languageCode: "es-419",
        units: "METRIC",
      },
    };
  },

  parseRoute(payload) {
    const route = payload?.routes?.[0];
    if (!route) return null;
    const seconds = Number(String(route.duration ?? "0s").replace("s", ""));
    return {
      distanceKm: Number((Number(route.distanceMeters ?? 0) / 1000).toFixed(1)),
      durationMin: Math.max(1, Math.round(seconds / 60)),
      coordinates: decodePolyline(route.polyline?.encodedPolyline ?? ""),
      steps: (route.legs || [])
        .flatMap((leg) => leg.steps || [])
        .map((step) => ({
          type: step.navigationInstruction?.maneuver || "continue",
          modifier: "straight",
          street: step.navigationInstruction?.instructions || "calle sin nombre",
          distanceM: Math.round(Number(step.distanceMeters ?? 0)),
          durationSec: Math.round(Number(String(step.staticDuration ?? "0s").replace("s", ""))),
          location: {
            lat: Number(step.startLocation?.latLng?.latitude),
            lng: Number(step.startLocation?.latLng?.longitude),
          },
        })),
      trafficAware: true,
    };
  },

  /**
   * Matriz de rutas: es la dependencia de la etapa 2 del dispatch v2.
   * Permite pedir ETA vial de varios conductores a un pickup en una sola llamada
   * en lugar de una por candidato.
   */
  describeRouteMatrix({ origins, destinations }) {
    if (!origins?.length || !destinations?.length) throw new Error("La matriz necesita orígenes y destinos");
    // Google factura por elemento: orígenes × destinos.
    if (origins.length * destinations.length > 625)
      throw new Error("La matriz de rutas admite hasta 625 elementos");
    return {
      url: new URL("/distanceMatrix/v2:computeRouteMatrix", GOOGLE_ROUTES),
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": googleKey(),
        "x-goog-fieldmask":
          "originIndex,destinationIndex,duration,distanceMeters,condition",
      },
      body: {
        origins: origins.map((point) => ({
          waypoint: { location: { latLng: { latitude: point.lat, longitude: point.lng } } },
        })),
        destinations: destinations.map((point) => ({
          waypoint: { location: { latLng: { latitude: point.lat, longitude: point.lng } } },
        })),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
      },
    };
  },

  parseRouteMatrix(payload) {
    const rows = Array.isArray(payload) ? payload : (payload?.rows ?? []);
    return rows
      .filter((entry) => entry?.condition !== "ROUTE_NOT_FOUND")
      .map((entry) => ({
        originIndex: Number(entry.originIndex ?? 0),
        destinationIndex: Number(entry.destinationIndex ?? 0),
        distanceM: Math.round(Number(entry.distanceMeters ?? 0)),
        durationSec: Math.round(Number(String(entry.duration ?? "0s").replace("s", ""))),
      }));
  },
};

/** Polilínea codificada de Google, formato estándar de precisión 1e-5. */
export function decodePolyline(encoded) {
  const points = [];
  let index = 0,
    lat = 0,
    lng = 0;
  while (index < encoded.length) {
    let result = 0,
      shift = 0,
      byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

const PROVIDERS = { openstreetmap, google };

export function mapsProvider(name = config.maps?.provider ?? "openstreetmap") {
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`Proveedor cartográfico desconocido: ${name}`);
  return provider;
}

/** Un proveedor no comercial no puede sostener tarifas productivas. */
export function isCommercialProvider(name = config.maps?.provider ?? "openstreetmap") {
  return Boolean(PROVIDERS[name]?.commercial);
}
