// Routing vial reutilizable (ticket GEO-001).
//
// Extrae la lógica de `GET /api/maps/route` para que las cotizaciones
// productivas usen distancia por carretera en lugar de geodésica × roadFactor.
// El circuit breaker vive acá para compartir estado con el router HTTP.
import { config } from "./config.js";
import {
  createMapCacheKey,
  getCachedMapResponse,
  getStaleCachedMapResponse,
  putCachedMapResponse,
} from "./map-cache-repository.js";
import { mapsProvider } from "./maps-provider.js";
import { observeProviderCall } from "./observability.js";
import { recordSystemAudit } from "./audit-repository.js";
import { ProviderCircuit } from "./provider-resilience.js";

export const mapProviderCircuit = new ProviderCircuit(config.mapProvider);

export function mapProviderBudgetSnapshot() {
  const provider = mapsProvider();
  const names = [...new Set([provider.routingName, provider.name])];
  return names.map((name) => ({ provider: name, ...mapProviderCircuit.snapshot(name) }));
}

export async function noteStaleFallback({ provider, operation, cacheKey }) {
  observeProviderCall({ provider, operation, outcome: "stale_fallback" });
  try {
    await recordSystemAudit({
      action: "maps.stale_fallback",
      entityType: "map_provider_cache",
      entityId: cacheKey?.slice(0, 16) ?? "unknown",
      origin: "maps-stale-fallback",
      afterData: { provider, operation, cacheKeyHash: cacheKey ?? null },
    });
  } catch {
    // La observabilidad ya capturó el evento; sin PostgreSQL no bloqueamos la degradación.
  }
}

function validateRouteCoords({ fromLat, fromLng, toLat, toLng }) {
  if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite))
    throw Object.assign(new Error("Coordenadas invalidas"), { status: 400 });
  if (
    Math.abs(fromLat) > 90 ||
    Math.abs(toLat) > 90 ||
    Math.abs(fromLng) > 180 ||
    Math.abs(toLng) > 180
  )
    throw Object.assign(new Error("Coordenadas fuera de rango"), { status: 400 });
}

/** Producción y proveedor comercial exigen routing vial para tarifas. */
export function requiresRoadRouting() {
  return config.isProduction || mapsProvider().commercial;
}

/**
 * Elige la distancia tarifaria según el entorno.
 * En producción/comercial `roadDistanceKm` es obligatorio salvo que falle el proveedor.
 */
export function resolveQuoteDistanceKm({
  allowGeodesicFallback,
  airDistanceM,
  roadFactor,
  roadDistanceKm = null,
  minDistanceKm = null,
  maxDistanceKm = null,
}) {
  let distanceKm;
  let distanceSource;
  if (roadDistanceKm != null) {
    distanceKm = Number(roadDistanceKm);
    distanceSource = "road";
  } else if (allowGeodesicFallback) {
    distanceKm = (Number(airDistanceM) / 1000) * Number(roadFactor);
    distanceSource = "geodesic_scaled";
  } else {
    throw Object.assign(new Error("El servicio de rutas no esta disponible"), { status: 503 });
  }
  if (minDistanceKm != null) distanceKm = Math.max(minDistanceKm, distanceKm);
  if (maxDistanceKm != null) distanceKm = Math.min(maxDistanceKm, distanceKm);
  return { distanceKm, distanceSource };
}

export async function resolveDrivingRoute({ fromLat, fromLng, toLat, toLng }) {
  validateRouteCoords({ fromLat, fromLng, toLat, toLng });
  let cacheKey;
  try {
    const routeIdentity = [fromLat, fromLng, toLat, toLng]
      .map((value) => value.toFixed(5))
      .join(",");
    const provider = mapsProvider();
    cacheKey = createMapCacheKey(`${provider.routingName}|driving|${routeIdentity}`);
    const cached = await getCachedMapResponse({ kind: "route", key: cacheKey });
    if (cached) return { route: cached.payload.route, provider: cached.provider, cache: "hit" };
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
    if (!normalizedRoute)
      throw Object.assign(new Error("No se encontro una ruta transitable"), { status: 404 });
    await putCachedMapResponse({
      kind: "route",
      key: cacheKey,
      provider: provider.routingName,
      payload: { route: normalizedRoute },
      ttlSeconds: config.routingCacheTtlSeconds,
    });
    return { route: normalizedRoute, provider: provider.routingName, cache: "miss" };
  } catch (error) {
    if (error.status === 400 || error.status === 404) throw error;
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
    if (stale) {
      await noteStaleFallback({
        provider: stale.provider,
        operation: "route",
        cacheKey,
      });
      return {
        route: stale.payload.route,
        provider: stale.provider,
        cache: "stale",
        degraded: true,
      };
    }
    throw Object.assign(new Error("El servicio de rutas no esta disponible"), { status: 503 });
  }
}

export async function fetchRoadDistanceKmIfRequired({ fromCoords, toCoords }) {
  if (!fromCoords || !toCoords || !requiresRoadRouting()) return null;
  const { route } = await resolveDrivingRoute({
    fromLat: fromCoords.lat,
    fromLng: fromCoords.lng,
    toLat: toCoords.lat,
    toLng: toCoords.lng,
  });
  return route.distanceKm;
}
