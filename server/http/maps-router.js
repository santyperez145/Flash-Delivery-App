// Rutas de mapas (ticket ARC-001, paso 2).
//
// Primer grupo de rutas extraído de `server/index.js`. Se eligió éste porque es
// el más autocontenido: dos rutas, una responsabilidad, y toda su lógica de
// proveedor ya vive detrás del adapter de GEO-001.
//
// Nació como una **factory**, porque el middleware de autenticación y el circuit
// breaker vivían en `server/index.js` y había que recibirlos para no importar de
// vuelta al archivo grande. El paso 5 extrajo el primero y le dio al segundo su
// lugar acá, así que la factory ya no tiene nada que recibir y el módulo exporta
// el router directamente.
//
// Ese recorrido es el patrón, no una particularidad de este grupo: **la factory
// era andamio**. Sirve mientras el núcleo esté en el archivo grande, y se cae
// sola a medida que el núcleo se convierte en módulos.
import { Router } from "express";

import { config } from "../config.js";
import {
  createMapCacheKey,
  getCachedMapResponse,
  getStaleCachedMapResponse,
  putCachedMapResponse,
} from "../map-cache-repository.js";
import { mapsProvider } from "../maps-provider.js";
import { issueGeocodeValidation } from "../geocoding-validation.js";
import { observeProviderCall } from "../observability.js";
import { ProviderCircuit } from "../provider-resilience.js";
import { requireAuth } from "./authentication.js";
import { fail, ok, parseOrFail } from "./responses.js";

// El circuit breaker del proveedor cartográfico vive con sus rutas: es la única
// parte del sistema que lo usa, y tenerlo acá evita que su estado —fallos
// consecutivos, ventana abierta— quede en un archivo que no lo consulta.
const mapProviderCircuit = new ProviderCircuit(config.mapProvider);

function signedGeocodeResults(results, { provider, userPublicId, cache }) {
  return results.map((result) => ({
    ...result,
    validationToken: issueGeocodeValidation({ result, provider, userPublicId, cache }),
  }));
}

export const mapsRouter = Router();

mapsRouter.get("/api/maps/geocode", requireAuth, async (req, res) => {
  const query = String(req.query.q || "").trim();
  if (query.length < 3 || query.length > 180)
    return fail(res, 400, "La direccion debe tener entre 3 y 180 caracteres");
  let cacheKey;
  try {
    const normalizedQuery = query.normalize("NFKC").toLocaleLowerCase("es-AR").replace(/\s+/g, " ");
    const provider = mapsProvider();
    // La clave incluye el proveedor: cambiar de proveedor no debe servir una
    // entrada cacheada por otro con criterios distintos.
    cacheKey = createMapCacheKey(`${provider.name}|geocode|${normalizedQuery}`);
    const cached = await getCachedMapResponse({
      kind: "geocode",
      key: cacheKey,
    });
    if (cached)
      return ok(res, {
        results: signedGeocodeResults(cached.payload.results, {
          provider: cached.provider,
          userPublicId: req.auth.userId,
          cache: "hit",
        }),
        provider: cached.provider,
        cache: "hit",
      });
    const request = provider.describeGeocode(query);
    const { response } = await mapProviderCircuit.execute({
      provider: provider.name,
      operation: "geocode",
      timeoutMs: config.mapProvider.timeoutMs,
      call: (signal) =>
        fetch(request.url, {
          method: request.method ?? "GET",
          headers: request.headers,
          body: request.body ? JSON.stringify(request.body) : undefined,
          signal,
        }),
    });
    observeProviderCall({ provider: provider.name, operation: "geocode", outcome: "success" });
    const payload = await response.json();
    const results = provider.parseGeocode(payload);
    await putCachedMapResponse({
      kind: "geocode",
      key: cacheKey,
      provider: provider.name,
      payload: { results },
      ttlSeconds: config.geocodingCacheTtlSeconds,
    });
    return ok(res, {
      results: signedGeocodeResults(results, {
        provider: provider.name,
        userPublicId: req.auth.userId,
        cache: "miss",
      }),
      provider: provider.name,
      cache: "miss",
    });
  } catch (error) {
    observeProviderCall({
      provider: mapsProvider().name,
      operation: "geocode",
      outcome: error.code || "failure",
    });
    const stale = cacheKey
      ? await getStaleCachedMapResponse({
          kind: "geocode",
          key: cacheKey,
          maxStaleSeconds: config.mapProvider.staleCacheSeconds,
        })
      : null;
    if (stale)
      return ok(res, {
        results: signedGeocodeResults(stale.payload.results, {
          provider: stale.provider,
          userPublicId: req.auth.userId,
          cache: "stale",
        }),
        provider: stale.provider,
        cache: "stale",
        degraded: true,
      });
    return fail(res, 503, "El servicio de geocodificacion no esta disponible");
  }
});

mapsRouter.get("/api/maps/route", requireAuth, async (req, res) => {
  const fromLat = Number(req.query.fromLat);
  const fromLng = Number(req.query.fromLng);
  const toLat = Number(req.query.toLat);
  const toLng = Number(req.query.toLng);
  if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite))
    return fail(res, 400, "Coordenadas invalidas");
  if (
    Math.abs(fromLat) > 90 ||
    Math.abs(toLat) > 90 ||
    Math.abs(fromLng) > 180 ||
    Math.abs(toLng) > 180
  )
    return fail(res, 400, "Coordenadas fuera de rango");
  let cacheKey;
  try {
    const routeIdentity = [fromLat, fromLng, toLat, toLng]
      .map((value) => value.toFixed(5))
      .join(",");
    const provider = mapsProvider();
    cacheKey = createMapCacheKey(`${provider.routingName}|driving|${routeIdentity}`);
    const cached = await getCachedMapResponse({ kind: "route", key: cacheKey });
    if (cached)
      return ok(res, {
        route: cached.payload.route,
        provider: cached.provider,
        cache: "hit",
      });
    const request = provider.describeRoute({ fromLat, fromLng, toLat, toLng });
    const { response } = await mapProviderCircuit.execute({
      provider: provider.routingName,
      operation: "route",
      timeoutMs: config.mapProvider.timeoutMs,
      call: (signal) =>
        fetch(request.url, {
          method: request.method ?? "GET",
          headers: request.headers,
          body: request.body ? JSON.stringify(request.body) : undefined,
          signal,
        }),
    });
    observeProviderCall({
      provider: provider.routingName,
      operation: "route",
      outcome: "success",
    });
    const payload = await response.json();
    const normalizedRoute = provider.parseRoute(payload);
    if (!normalizedRoute) return fail(res, 404, "No se encontro una ruta transitable");
    await putCachedMapResponse({
      kind: "route",
      key: cacheKey,
      provider: provider.routingName,
      payload: { route: normalizedRoute },
      ttlSeconds: config.routingCacheTtlSeconds,
    });
    return ok(res, { route: normalizedRoute, provider: provider.routingName, cache: "miss" });
  } catch (error) {
    observeProviderCall({
      provider: mapsProvider().routingName,
      operation: "route",
      outcome: error.code || "failure",
    });
    const stale = cacheKey
      ? await getStaleCachedMapResponse({
          kind: "route",
          key: cacheKey,
          maxStaleSeconds: config.mapProvider.staleCacheSeconds,
        })
      : null;
    if (stale)
      return ok(res, {
        route: stale.payload.route,
        provider: stale.provider,
        cache: "stale",
        degraded: true,
      });
    return fail(res, 503, "El servicio de rutas no esta disponible");
  }
});
