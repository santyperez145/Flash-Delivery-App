// Rutas de mapas (ticket ARC-001, paso 2).
//
// Primer grupo de rutas extraído de `server/index.js`. Se eligió éste porque es
// el más autocontenido: dos rutas, una responsabilidad, y toda su lógica de
// proveedor ya vive detrás del adapter de GEO-001.
//
// El módulo expone una **factory** en lugar de importar de vuelta a
// `server/index.js`. Ahí siguen viviendo el middleware de autenticación y el
// circuit breaker, así que se reciben como dependencias explícitas: eso evita un
// import circular y deja escrito qué necesita este grupo para funcionar, en
// lugar de que dependa de todo lo que el archivo grande tuviera a mano.
import { Router } from "express";

import { config } from "../config.js";
import {
  createMapCacheKey,
  getCachedMapResponse,
  getStaleCachedMapResponse,
  putCachedMapResponse,
} from "../map-cache-repository.js";
import { mapsProvider } from "../maps-provider.js";
import { observeProviderCall } from "../observability.js";
import { fail, ok, parseOrFail } from "./responses.js";

export function createMapsRouter({ requireAuth, mapProviderCircuit }) {
  const router = Router();

  router.get("/api/maps/geocode", requireAuth, async (req, res) => {
    const query = String(req.query.q || "").trim();
    if (query.length < 3 || query.length > 180)
      return fail(res, 400, "La direccion debe tener entre 3 y 180 caracteres");
    let cacheKey;
    try {
      const normalizedQuery = query
        .normalize("NFKC")
        .toLocaleLowerCase("es-AR")
        .replace(/\s+/g, " ");
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
          results: cached.payload.results,
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
      return ok(res, { results, provider: provider.name, cache: "miss" });
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
          results: stale.payload.results,
          provider: stale.provider,
          cache: "stale",
          degraded: true,
        });
      return fail(res, 503, "El servicio de geocodificacion no esta disponible");
    }
  });

  router.get("/api/maps/route", requireAuth, async (req, res) => {
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
  return router;
}
