// Métricas de producto y Prometheus (ARC-001).
//
// `/api/metrics` es la vista admin del snapshot; `/api/internal/metrics` es el
// scrape de Prometheus con token de servicio. Ninguna es dominio de un
// vertical: son observabilidad del monolito.
import crypto from "node:crypto";
import { Router } from "express";

import { config } from "../config.js";
import { mapProviderBudgetSnapshot } from "../maps-route-service.js";
import { renderPrometheus } from "../observability.js";
import { postgresPool } from "../postgres.js";
import { loadRuntimeState, metrics } from "../runtime-snapshot.js";
import { requireAuth } from "./authentication.js";
import { requireAnyRole } from "./authorization.js";
import { realtimeClients } from "./realtime.js";
import { fail, ok } from "./responses.js";

const processStartedAt = Date.now();

export const metricsRouter = Router();

metricsRouter.get("/api/metrics", requireAuth, requireAnyRole("admin"), async (req, res) => {
  ok(res, { metrics: metrics(await loadRuntimeState(req)) });
});

metricsRouter.get("/api/internal/metrics", async (req, res) => {
  const supplied = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const expected = Buffer.from(config.metricsToken),
    actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected))
    return fail(res, 401, "Token de métricas inválido");
  if (!postgresPool) return fail(res, 503, "PostgreSQL no configurado");
  const rows = await postgresPool.query(`SELECT
  count(*) FILTER(WHERE kind='delivery' AND metadata->>'subtype'='food_order' AND status NOT IN('completed','cancelled'))::int active_food,
  count(*) FILTER(WHERE kind='ride' AND status NOT IN('completed','cancelled'))::int active_rides,
  count(*) FILTER(WHERE kind='delivery' AND metadata->>'subtype'='shipment' AND status NOT IN('completed','cancelled'))::int active_shipments FROM jobs`);
  const tickets = await postgresPool.query(
      "SELECT count(*)::int count FROM support_tickets WHERE status NOT IN('resolved','closed')",
    ),
    payments = await postgresPool.query(
      "SELECT status::text,count(*)::int count FROM payment_intents GROUP BY status ORDER BY status",
    ),
    notifications = await postgresPool.query(
      "SELECT status,count(*)::int count FROM notifications GROUP BY status ORDER BY status",
    ),
    dispatchOffers = await postgresPool.query(
      "SELECT status,count(*)::int count FROM dispatch_offers GROUP BY status ORDER BY status",
    ),
    realtimeEvents = await postgresPool.query("SELECT count(*)::int count FROM realtime_events"),
    payouts = await postgresPool.query(
      "SELECT status,count(*)::int count FROM payouts GROUP BY status ORDER BY status",
    ),
    merchantPayable = await postgresPool.query(
      `SELECT COALESCE(
         sum(CASE WHEN e.direction = 'credit' THEN e.amount_cents ELSE -e.amount_cents END),
         0
       )::bigint cents
       FROM ledger_accounts a
       JOIN ledger_entries e ON e.account_id = a.id
       WHERE a.owner_type = 'merchant' AND a.account_type = 'payable'`,
    ),
    tips = await postgresPool.query(
      "SELECT count(*)::int count,COALESCE(sum(amount_cents),0)::bigint cents FROM service_tips",
    ),
    paymentOAuthConnections = await postgresPool.query(
      `SELECT status,count(*)::int count FROM (
        SELECT CASE
          WHEN revoked_at IS NOT NULL THEN 'revoked'
          WHEN refresh_failures>=5 OR token_expires_at IS NULL OR token_expires_at<=now() THEN 'reconnect_required'
          WHEN token_expires_at<now()+interval '30 days' THEN 'renewal_due'
          ELSE 'connected'
        END status
        FROM merchant_payment_connections
      ) connections GROUP BY status ORDER BY status`,
    ),
    idempotencyKeys = await postgresPool.query(
      `SELECT CASE WHEN expires_at<=now() THEN 'expired' ELSE 'active' END status,count(*)::int count
       FROM idempotency_keys GROUP BY 1 ORDER BY 1`,
    );
  res.type("text/plain; version=0.0.4; charset=utf-8").send(
    renderPrometheus({
      pool: postgresPool,
      business: {
        activeFood: rows.rows[0].active_food,
        activeRides: rows.rows[0].active_rides,
        activeShipments: rows.rows[0].active_shipments,
        openTickets: tickets.rows[0].count,
        payments: payments.rows,
        notifications: notifications.rows,
        dispatchOffers: dispatchOffers.rows,
        realtimeEvents: realtimeEvents.rows[0].count,
        payouts: payouts.rows,
        merchantPayableCents: merchantPayable.rows[0].cents,
        tipsCount: tips.rows[0].count,
        tipsCents: tips.rows[0].cents,
        paymentOAuthConnections: paymentOAuthConnections.rows,
        idempotencyKeys: idempotencyKeys.rows,
      },
      startedAt: processStartedAt,
      realtimeConnections: realtimeClients.size,
      mapProviderBudget: mapProviderBudgetSnapshot(),
    }),
  );
});
