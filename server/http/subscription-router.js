// Suscripción de Flash (ticket GTM-001).
//
// Uber One, DashPass y PedidosYa Plus son el motor de retención de la categoría:
// quien se suscribe pide más seguido y compara menos. Flash no tenía nada de
// eso, y era el hueco comercial más grande medido contra la competencia.
//
// Cuatro rutas y ninguna de más: ver planes, ver la propia, suscribirse, y
// cancelar. El alta y la baja las hace la persona sobre sí misma —el `userId`
// sale de la sesión y no del cuerpo— así que no hay forma de suscribir a otro.
//
// **Ninguna cobra todavía.** El cobro recurrente depende de PAY-001, que espera
// credenciales del proveedor. Está dicho en la respuesta, en el campo `billed`,
// en vez de disimulado: el día que el cobro exista se sabe quién pagó y quién
// entró antes.
import { Router } from "express";
import { z } from "zod";

import { recordPostgresAudit } from "../audit-repository.js";

import {
  cancelSubscription,
  getActiveSubscription,
  getSubscriptionPlans,
  subscribe,
} from "../subscription-repository.js";
import { usesPostgresCommerce } from "../postgres.js";
import { requireAuth } from "./authentication.js";
import { requireAnyRole } from "./authorization.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

const subscribeSchema = z.object({
  planKey: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{2,40}$/, "Plan inválido"),
});

export const subscriptionRouter = Router();
const router = subscriptionRouter;

// El catálogo es público a propósito: el precio y los beneficios tienen que
// poder mostrarse antes de crear la cuenta, o la suscripción sólo se descubre
// después de decidir usar la app.
router.get("/api/subscription/plans", async (_req, res) => {
  if (!usesPostgresCommerce()) return fail(res, 503, "La suscripción requiere PostgreSQL");
  try {
    return ok(res, { plans: await getSubscriptionPlans() });
  } catch (error) {
    return failFrom(res, error, "No se pudieron listar los planes");
  }
});

router.get("/api/subscription", requireAuth, async (req, res) => {
  if (!usesPostgresCommerce()) return fail(res, 503, "La suscripción requiere PostgreSQL");
  try {
    // `null` y no 404: no estar suscripto es una respuesta válida a «¿cuál es
    // mi suscripción?», y un 404 obligaría a cada pantalla a tratar la ausencia
    // como un error.
    return ok(res, { subscription: await getActiveSubscription(req.auth.userId) });
  } catch (error) {
    return failFrom(res, error, "No se pudo leer la suscripción");
  }
});

router.post(
  "/api/subscription",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return fail(res, 503, "La suscripción requiere PostgreSQL");
    const parsed = parseOrFail(subscribeSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const subscription = await subscribe({
        userPublicId: req.auth.userId,
        planKey: parsed.data.planKey,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "subscription.subscribe",
        entityType: "user_subscription",
        entityId: subscription.id,
        requestId: req.requestId,
        // Queda escrito que el período se otorgó sin cobrar. Es la diferencia
        // entre un suscriptor que pagó y uno que entró mientras PAY-001 no tenía
        // credenciales, y sin este dato el día del corte no se puede distinguir.
        afterData: { planKey: subscription.planKey, billed: subscription.billed },
      });
      return ok(res, { subscription });
    } catch (error) {
      return failFrom(res, error, "No se pudo activar la suscripción");
    }
  },
);

router.delete("/api/subscription", requireAuth, async (req, res) => {
  if (!usesPostgresCommerce()) return fail(res, 503, "La suscripción requiere PostgreSQL");
  try {
    const cancelled = await cancelSubscription(req.auth.userId);
    await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "subscription.cancel",
      entityType: "user_subscription",
      entityId: cancelled.id,
      requestId: req.requestId,
      afterData: { benefitsUntil: cancelled.benefitsUntil },
    });
    return ok(res, cancelled);
  } catch (error) {
    return failFrom(res, error, "No se pudo cancelar la suscripción");
  }
});
