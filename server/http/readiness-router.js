// Readiness del proceso (ARC-001).
//
// Separado de health/OpenAPI porque toca Postgres, Redis, realtime y el
// inventario de stores: es el contrato que usa el balanceador, no el de
// liveness. Comparte el flag de drenado con graceful shutdown.
import { Router } from "express";

import { getPostgresUsers, usesPostgresAuth } from "../auth-repository.js";
import { getPostgresRestaurants } from "../catalog-repository.js";
import { config } from "../config.js";
import { getPostgresDrivers } from "../driver-roster-repository.js";
import { readDb, sqliteReadCount } from "../fallback-runtime.js";
import { postgresReadiness, usesPostgresCommerce } from "../postgres.js";
import { redisReadiness } from "../redis.js";
import { isDraining } from "../runtime-drain.js";
import { getTimestamp } from "../store.js";
import { realtimeBlocksReadiness, realtimeReadiness } from "./realtime.js";
import { fail, ok } from "./responses.js";

export const readinessRouter = Router();

readinessRouter.get("/api/ready", async (_req, res) => {
  try {
    if (isDraining()) return fail(res, 503, "La instancia está drenando conexiones");
    const db = config.databaseUrl ? null : readDb();
    const postgres = await postgresReadiness();
    const redis = await redisReadiness();
    if (config.databaseUrl && !postgres.ready)
      return fail(res, 503, "PostgreSQL/PostGIS no disponible");
    if (config.isProduction && config.databaseUrl && !postgres.least_privilege)
      return fail(
        res,
        503,
        "El rol PostgreSQL del runtime tiene privilegios incompatibles con producción",
      );
    if (config.redis.required && !redis.ready)
      return fail(res, 503, "Redis distribuido no disponible");
    // El escucha de eventos, con tolerancia a parpadeos.
    //
    // **No basta con que la instancia responda.** Si `LISTEN flash_realtime` no
    // logra suscribirse, la instancia sigue viva, sigue aceptando clientes SSE y
    // no entrega ni un evento — tracking congelado, ofertas que no llegan, y
    // ningun error en ningun lado.
    //
    // Falla despues del umbral y no al primer intento porque el listener se
    // reconecta cada segundo: un reintento suelto es una reconexion normal y
    // sacar la instancia del balanceador por eso la haria oscilar. Treinta
    // seguidos son otra cosa — es una conexion que **no puede** escuchar, y el
    // caso tipico es un pooler en modo transaccion, donde `LISTEN` nunca
    // sobrevive y ninguna cantidad de reintentos lo arregla.
    const realtime = realtimeReadiness();
    if (realtimeBlocksReadiness({ isProduction: config.isProduction, realtime }))
      return fail(res, 503, "El escucha de eventos en tiempo real no logra suscribirse");
    const runtimeCounts = usesPostgresCommerce()
      ? await Promise.all([getPostgresUsers(), getPostgresRestaurants(), getPostgresDrivers()])
      : [db.users, db.restaurants, db.drivers];
    return ok(res, {
      service: "flash-fullstack-api",
      database: postgres,
      redis,
      realtime,
      runtimeStore: config.databaseUrl ? "postgres-primary" : "sqlite-demo",
      fallbackDiagnostics: { sqliteReads: sqliteReadCount() },
      authStore: usesPostgresAuth() ? "postgres" : "sqlite-test-fallback",
      domainStores: {
        catalog: usesPostgresCommerce() ? "postgres" : "sqlite-test-fallback",
        carts: usesPostgresCommerce() ? "postgres" : "sqlite-test-fallback",
        foodOrders: usesPostgresCommerce() ? "postgres" : "sqlite-test-fallback",
        drivers: usesPostgresCommerce() ? "postgres-postgis" : "sqlite-test-fallback",
        driverLocations: usesPostgresCommerce()
          ? "postgres-postgis+source+accuracy+freshness-gate"
          : "sqlite-test-fallback",
        driverVehicles: usesPostgresCommerce()
          ? "postgres-verified-registry+mode-eligibility"
          : "sqlite-test-fallback",
        rides: usesPostgresCommerce() ? "postgres-postgis" : "sqlite-test-fallback",
        shipments: usesPostgresCommerce() ? "postgres-postgis" : "sqlite-test-fallback",
        dispatch: usesPostgresCommerce()
          ? "postgres-postgis-expiring-offers+wave-worker"
          : "sqlite-test-fallback",
        wallet: usesPostgresAuth() ? "postgres-double-entry-ledger" : "sqlite-test-fallback",
        payments: usesPostgresAuth()
          ? "wallet-capture-refunds+signed-webhooks+balanced-settlements+tips+dual-control-adjustments+reconciliation-cases+risk-scoring"
          : "sqlite-test-fallback",
        receipts: usesPostgresAuth()
          ? "postgres-immutable-service-snapshots"
          : "sqlite-test-fallback",
        cancellations: usesPostgresAuth()
          ? "postgres-auditable-reasons+refund-outcomes"
          : "sqlite-test-fallback",
        orderIssues: usesPostgresAuth()
          ? "postgres-workflow+partial-refunds+settlement-reversal"
          : "sqlite-test-fallback",
        substitutions: usesPostgresAuth()
          ? "postgres-customer-consent+wallet-price-adjustment"
          : "sqlite-test-fallback",
        merchantBranches: usesPostgresAuth()
          ? "postgres-postgis+branch-inventory"
          : "sqlite-test-fallback",
        merchantFinance: usesPostgresAuth()
          ? "postgres-ledger+payout-reservations+independent-review"
          : "sqlite-test-fallback",
        support: usesPostgresAuth()
          ? // La escalada es automatica en el sentido de que nadie decide a quien
            // escalar; **no** en el sentido de que ocurra sola. La dispara el mismo
            // trabajo programado que el despacho.
            "postgres-conversations+priority-sla+capacity-routing+scheduled-escalation"
          : "sqlite-test-fallback",
        notifications: usesPostgresAuth()
          ? `postgres-outbox+preferences+in-app+invalid-token-revocation+dead-letter-replay+${config.notificationProvider}-worker`
          : "sqlite-test-fallback",
        realtime: usesPostgresAuth()
          ? "postgres-event-log+listen-notify+sse-replay"
          : "memory-test-fallback",
        promotions: usesPostgresCommerce()
          ? "postgres-transactional-redemptions"
          : "sqlite-test-fallback",
        zones: usesPostgresCommerce() ? "postgres-postgis-live-counts" : "sqlite-test-fallback",
        pricing: usesPostgresCommerce()
          ? "postgres-versioned-plans+signed-quotes"
          : "sqlite-test-fallback",
        audit: usesPostgresCommerce() ? "postgres-operational-events" : "sqlite-test-fallback",
        feedback: usesPostgresCommerce() ? "postgres-ratings+favorites" : "sqlite-test-fallback",
        addresses: usesPostgresAuth() ? "postgres-postgis-address-book" : "sqlite-test-fallback",
        rideDestinations: usesPostgresAuth()
          ? "postgres-postgis-private-recents"
          : "sqlite-test-fallback",
        rideTrustedContacts: usesPostgresAuth()
          ? "postgres-rls+aes256gcm-private-contacts"
          : "unavailable",
        ridePickupVerification: usesPostgresAuth() ? "postgres-bcrypt-pin+lockout" : "unavailable",
        serviceChat: usesPostgresAuth()
          ? "postgres-aes256gcm+participant-rls+receipts+attachments+configured-replies"
          : "unavailable",
        maps: usesPostgresAuth() ? "nominatim+osrm+postgres-ttl-cache" : "external-provider-only",
        driverCompliance: usesPostgresAuth()
          ? "postgres-kyc+encrypted-documents+manual-review"
          : "unavailable",
        rideSafety: usesPostgresAuth()
          ? "postgres-expiring-tracking-links+sos-incidents"
          : "unavailable",
        passwordRecovery: usesPostgresAuth()
          ? `postgres-one-time-digests+encrypted-${config.emailProvider}-email+session-revocation`
          : "unavailable",
        emailVerification: usesPostgresAuth()
          ? `postgres-bcrypt-otp+encrypted-${config.emailProvider}-email+login-gate`
          : "unavailable",
        shipmentClaims: usesPostgresAuth()
          ? "postgres-protection-eligibility+encrypted-evidence+auditable-workflow"
          : "unavailable",
      },
      users: runtimeCounts[0].length,
      restaurants: runtimeCounts[1].length,
      drivers: runtimeCounts[2].length,
      timestamp: getTimestamp(),
    });
  } catch (_error) {
    return fail(res, 503, "Base de datos no disponible");
  }
});
