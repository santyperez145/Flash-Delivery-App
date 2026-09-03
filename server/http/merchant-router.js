// El comercio mirando su negocio y cobrando (ticket ARC-001, paso 2).
//
// Seis rutas: el perfil, el tablero, los pedidos activos, las finanzas y las dos
// de retiro de plata.
//
// Se separa a propósito de `payment-provider-router.js`, que salió del mismo
// bloque contiguo. Acá el comercio mira lo que ganó y pide que se lo giren; allá
// se establece y se mantiene el vínculo con Mercado Pago. Son dos ciclos de vida
// distintos: uno ocurre todos los días, el otro una vez y después sólo cuando se
// rompe.
//
// **Pedir un retiro exige un segundo factor.** `payouts/authorize` emite un
// step-up con `payoutStepUpLimiter`, que es el presupuesto más bajo de todos los
// limitadores del sistema —diez intentos— porque acá el daño es dinero saliendo.
// Es la misma razón por la que `payouts` audita con actor y `requestId`: un giro
// sin quién lo pidió no se puede reconstruir después.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Router } from "express";
import { z } from "zod";

import { config } from "../config.js";
import { requireAuth } from "./authentication.js";
import { canManageRestaurant, isAdmin, requireAnyRole } from "./authorization.js";
import { getPostgresRestaurants } from "../catalog-repository.js";
import { readDb } from "../fallback-runtime.js";
import { getPostgresMerchantDashboard } from "../merchant-dashboard-repository.js";
import {
  createPayoutStepUp,
  getMerchantFinance,
  requestMerchantPayout,
} from "../merchant-payout-repository.js";
import { recordPostgresAudit } from "../audit-repository.js";
import { getPostgresMerchantActiveOrderPage } from "../order-repository.js";
import { usesPostgresCommerce } from "../postgres.js";
import { payoutStepUpLimiter } from "./rate-limits.js";
import { publishRealtimeEvent } from "./realtime.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";
import { getTimestamp } from "../store.js";

const payoutRequestSchema = z.object({
  amount: z.coerce.number().positive().max(100000000),
  merchantId: z.string().optional(),
  authorizationToken: z.string().min(20),
});
const payoutAuthorizeSchema = payoutRequestSchema
  .omit({ authorizationToken: true })
  .extend({ password: z.string().min(4).max(128) });

const jwtSecret = config.jwtSecret;

export const merchantRouter = Router();
const router = merchantRouter;

router.get("/api/merchant/me", requireAuth, requireAnyRole("merchant"), async (req, res) => {
  try {
    const restaurants = usesPostgresCommerce()
      ? await getPostgresRestaurants({ ownerPublicId: req.auth.userId })
      : readDb().restaurants.filter((entry) => entry.ownerId === req.auth.userId);
    res.set("Cache-Control", "no-store, private");
    return ok(res, { restaurants });
  } catch (error) {
    return failFrom(res, error, "No se pudo cargar el comercio");
  }
});

router.get(
  "/api/merchant/dashboard",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    res.set("Cache-Control", "no-store, private");
    if (usesPostgresCommerce()) {
      try {
        const dashboard = await getPostgresMerchantDashboard({
          actorPublicId: req.auth.userId,
          merchantPublicId: String(req.query.restaurantId || "") || null,
          admin: isAdmin(req),
        });
        const restaurant = (
          await getPostgresRestaurants({ publicIds: [dashboard.restaurantId] })
        )[0];
        return ok(res, { dashboard: { ...dashboard, restaurant } });
      } catch (error) {
        return failFrom(res, error, "No se pudo cargar la operación del comercio");
      }
    }
    const db = usesPostgresCommerce() ? {} : readDb();
    const restaurant = isAdmin(req)
      ? db.restaurants.find((entry) => entry.id === req.query.restaurantId)
      : db.restaurants.find((entry) => entry.ownerId === req.auth.userId);
    if (!restaurant) return fail(res, 404, "Comercio no encontrado");
    const orders = db.orders.filter((order) => order.restaurantId === restaurant.id);
    const timezone = "America/Argentina/Buenos_Aires";
    const dateKey = (value) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(value));
    const todayKey = dateKey(getTimestamp());
    const terminalToday = (order, status) =>
      (order.timeline || []).some(
        (event) => event.status === status && dateKey(event.at) === todayKey,
      );
    const activeOrders = orders.filter((order) =>
      [
        "accepted",
        "preparing",
        "ready_for_pickup",
        "courier_assigned",
        "picked_up",
        "delivering",
      ].includes(order.status),
    );
    const completedOrders = orders.filter(
      (order) => order.status === "delivered" && terminalToday(order, "delivered"),
    );
    const cancelledOrders = orders.filter(
      (order) => order.status === "cancelled" && terminalToday(order, "cancelled"),
    );
    const grossSales = completedOrders.reduce((sum, order) => sum + order.total, 0);
    return ok(res, {
      dashboard: {
        generatedAt: getTimestamp(),
        source: "sqlite-test-fallback",
        timezone,
        restaurantId: restaurant.id,
        branch: null,
        restaurant,
        orders,
        metrics: {
          activeOrders: activeOrders.length,
          needsAction: activeOrders.filter((order) => order.status === "accepted").length,
          preparing: activeOrders.filter((order) => order.status === "preparing").length,
          readyForPickup: activeOrders.filter((order) => order.status === "ready_for_pickup")
            .length,
          courierFlow: activeOrders.filter((order) =>
            ["courier_assigned", "picked_up", "delivering"].includes(order.status),
          ).length,
          lateOrders: 0,
          untrackedPrepOrders: activeOrders.filter((order) =>
            ["accepted", "preparing"].includes(order.status),
          ).length,
          oldestActiveMinutes: Math.max(
            0,
            ...activeOrders
              .map((order) =>
                Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000),
              )
              .filter(Number.isFinite),
          ),
          completedToday: completedOrders.length,
          cancelledToday: cancelledOrders.length,
          grossSalesToday: grossSales,
          averageTicketToday: completedOrders.length
            ? Math.round(grossSales / completedOrders.length)
            : 0,
          unavailableItems: restaurant.menu.filter((item) => !item.stock).length,
        },
      },
    });
  },
);

router.get(
  "/api/merchant/orders/active",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const restaurantId = String(req.query.restaurantId || "").trim(),
      limit = Math.min(100, Math.max(1, Number(req.query.limit) || 100));
    if (!restaurantId) return fail(res, 400, "Indicá el comercio a consultar");
    res.set("Cache-Control", "no-store, private");
    try {
      if (usesPostgresCommerce())
        return ok(
          res,
          await getPostgresMerchantActiveOrderPage({
            actorPublicId: req.auth.userId,
            merchantPublicId: restaurantId,
            admin: isAdmin(req),
            limit,
          }),
        );
      const db = readDb(),
        restaurant = db.restaurants.find((entry) => entry.id === restaurantId);
      if (!restaurant || !canManageRestaurant(req, restaurant))
        return fail(res, 404, "Comercio no encontrado o no autorizado");
      const activeStatuses = new Set([
          "accepted",
          "preparing",
          "ready_for_pickup",
          "courier_assigned",
          "picked_up",
          "delivering",
        ]),
        all = db.orders.filter(
          (order) => order.restaurantId === restaurantId && activeStatuses.has(order.status),
        );
      return ok(res, {
        generatedAt: getTimestamp(),
        source: "sqlite-test-fallback",
        orders: all.slice(0, limit),
        hasMore: all.length > limit,
      });
    } catch (error) {
      return failFrom(res, error, "No se pudo cargar la cola activa");
    }
  },
);

router.get(
  "/api/merchant/finance",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "Las finanzas del comercio requieren PostgreSQL");
    const merchantId = String(req.query.merchantId || req.auth.user.restaurantId || "");
    if (!merchantId) return fail(res, 400, "Falta el comercio");
    try {
      return ok(res, {
        finance: await getMerchantFinance({
          merchantPublicId: merchantId,
          actorPublicId: req.auth.userId,
          admin: isAdmin(req),
        }),
      });
    } catch (error) {
      return failFrom(res, error, "No se pudieron cargar las finanzas");
    }
  },
);
router.post(
  "/api/merchant/payouts/authorize",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  payoutStepUpLimiter,
  async (req, res) => {
    const parsed = parseOrFail(payoutAuthorizeSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    const merchantId = parsed.data.merchantId || req.auth.user.restaurantId;
    if (!merchantId) return fail(res, 400, "Falta el comercio");
    if (!bcrypt.compareSync(parsed.data.password, req.auth.user.password))
      return fail(res, 401, "La contraseña actual no es válida");
    try {
      const jti = crypto.randomUUID(),
        expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      await createPayoutStepUp({
        jti,
        merchantPublicId: merchantId,
        actorPublicId: req.auth.userId,
        admin: isAdmin(req),
        amount: parsed.data.amount,
        expiresAt,
      });
      const authorizationToken = jwt.sign(
        {
          sub: req.auth.userId,
          purpose: "merchant_payout",
          merchantId,
          amountCents: Math.round(parsed.data.amount * 100),
          jti,
        },
        jwtSecret,
        { expiresIn: "5m" },
      );
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "merchant.payout_authorized",
        entityType: "merchant",
        entityId: merchantId,
        requestId: req.requestId,
        afterData: { amount: parsed.data.amount, expiresAt: expiresAt.toISOString() },
      });
      return ok(res, {
        authorizationToken,
        expiresAt: expiresAt.toISOString(),
        merchantId,
        amount: parsed.data.amount,
      });
    } catch (error) {
      return failFrom(res, error, "No se pudo autorizar el retiro");
    }
  },
);

router.post(
  "/api/merchant/payouts",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(payoutRequestSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    const idempotencyKey = String(req.get("idempotency-key") || "");
    if (idempotencyKey.length < 16) return fail(res, 400, "Idempotency-Key es obligatorio");
    const merchantId = parsed.data.merchantId || req.auth.user.restaurantId;
    if (!merchantId) return fail(res, 400, "Falta el comercio");
    try {
      let stepUp;
      try {
        stepUp = jwt.verify(parsed.data.authorizationToken, jwtSecret);
      } catch {
        return fail(res, 403, "Autorización reforzada inválida o vencida");
      }
      if (
        stepUp.sub !== req.auth.userId ||
        stepUp.purpose !== "merchant_payout" ||
        stepUp.merchantId !== merchantId ||
        stepUp.amountCents !== Math.round(parsed.data.amount * 100) ||
        typeof stepUp.jti !== "string"
      )
        return fail(res, 403, "La autorización no corresponde a este retiro");
      const finance = await requestMerchantPayout({
        merchantPublicId: merchantId,
        actorPublicId: req.auth.userId,
        admin: isAdmin(req),
        amount: parsed.data.amount,
        idempotencyKey,
        stepUpJti: stepUp.jti,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "merchant.payout_requested",
        entityType: "merchant",
        entityId: merchantId,
        requestId: req.requestId,
        afterData: { amount: parsed.data.amount },
      });
      await publishRealtimeEvent({
        req,
        type: "merchant.finance.updated",
        entityType: "restaurant",
        entityId: merchantId,
        action: "merchant.payout_requested",
      });
      return res.status(201).json({ ok: true, requestId: req.requestId, finance });
    } catch (error) {
      return failFrom(res, error, "No se pudo solicitar el payout");
    }
  },
);
