// Disparadores de colas: empujar el trabajo diferido y mirar lo que se cayó
// (ticket ARC-001, paso 2).
//
// Tercer corte de `/api/admin`. Estas cinco rutas estaban en dos lugares
// distintos del archivo, separadas por búsqueda de catálogo y ofertas a
// conductores, y lo único que las separaba era en qué orden se habían escrito.
//
// Lo que las agrupa es que **ninguna hace el trabajo: lo empuja**. El despacho,
// las notificaciones y el SLA de soporte corren por su cuenta —`worker:dispatch`,
// `worker:notifications` y `worker:support`, cada uno con su bucle, su backoff y
// su apagado ordenado—; estas rutas existen para que un cron externo o una
// persona de operaciones haga avanzar el lote sin esperar al tick, que es lo que
// hace falta cuando algo se atascó.
//
// > **Nota del 28-08.** Un cambio anterior de ese mismo día reemplazó este
// > párrafo por una «corrección» que afirmaba que los tres lotes no corrían.
// > Era falso, y el párrafo original era correcto: los workers existen desde
// > antes y están documentados en `docs/operations.md`. Queda anotado porque el
// > error fue exactamente el que este repositorio viene persiguiendo —una
// > búsqueda que confirma lo que espera— y borrarlo sin decirlo lo repetiría.
//
// Por eso todas aceptan `limit` y todas lo acotan del lado del servidor. Un
// `limit` sin techo convierte un pedido de operaciones en un lote que toma la
// base durante minutos.
//
// La cola de descarte va acá y no en `notifications-router.js` a propósito. Ese
// router es la vista del destinatario —qué se te notifica, qué se te notificó, a
// dónde se entrega—. Una carta muerta es la vista del operador: la notificación
// que ya falló todos sus reintentos y necesita que alguien decida. Misma tabla,
// otro dueño.
//
// El procesamiento de notificaciones responde 503 y no 500 cuando los dos
// proveedores están deshabilitados: no es una falla, es una configuración que
// dice que nadie va a entregar nada.
import { Router } from "express";
import { z } from "zod";

import { config } from "../config.js";
import { processPostgresDispatchBatch } from "../dispatch-repository.js";
import {
  getNotificationDeadLetters,
  processPostgresNotificationBatch,
  replayNotificationDeadLetter,
} from "../notification-delivery-repository.js";
import { processSupportQueue } from "../support-agent-repository.js";
import { recordPostgresAudit } from "../audit-repository.js";
import { usesPostgresCommerce } from "../postgres.js";
import { requireAuth } from "./authentication.js";
import { requireAnyRole } from "./authorization.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

const supportQueueProcessSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const queueTriggersRouter = Router();
const router = queueTriggersRouter;

router.post(
  "/api/admin/support/process",
  requireAuth,
  requireAnyRole("support", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(supportQueueProcessSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const result = await processSupportQueue(parsed.data);
      for (const escalation of result.escalated)
        await recordPostgresAudit({
          actorPublicId: req.auth.userId,
          roles: req.auth.roles,
          action: "support.sla_escalated",
          entityType: "support_ticket",
          entityId: escalation.ticketId,
          requestId: req.requestId,
          afterData: {
            level: escalation.level,
            breachKind: escalation.breachKind,
          },
        });
      return ok(res, { result });
    } catch (error) {
      return failFrom(res, error, "No se pudo procesar la cola de soporte");
    }
  },
);

router.post(
  "/api/admin/dispatch/process",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    try {
      return ok(res, {
        result: await processPostgresDispatchBatch({
          limit: Math.min(100, Math.max(1, Number(req.body?.limit) || 20)),
        }),
      });
    } catch (_error) {
      return fail(res, 500, "No se pudo procesar el dispatch");
    }
  },
);
router.post(
  "/api/admin/notifications/process",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    if (config.notificationProvider === "disabled" && config.emailProvider === "disabled")
      return fail(res, 503, "Los proveedores de notificaciones están deshabilitados");
    try {
      return ok(res, {
        result: await processPostgresNotificationBatch({
          workerId: `api-${process.pid}`,
          limit: Math.min(100, Math.max(1, Number(req.body?.limit) || 25)),
          provider: config.notificationProvider,
        }),
      });
    } catch (_error) {
      return fail(res, 500, "No se pudo procesar la cola de notificaciones");
    }
  },
);
router.get(
  "/api/admin/notifications/dead-letters",
  requireAuth,
  requireAnyRole("admin"),
  async (_req, res) => {
    if (!usesPostgresCommerce()) return fail(res, 503, "La cola de descarte requiere PostgreSQL");
    try {
      return ok(res, { deadLetters: await getNotificationDeadLetters() });
    } catch (error) {
      return failFrom(res, error, "No se pudo cargar la cola de descarte");
    }
  },
);
router.post(
  "/api/admin/notifications/dead-letters/:notificationId/replay",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    try {
      const deadLetter = await replayNotificationDeadLetter({
        notificationPublicId: req.params.notificationId,
        actorPublicId: req.auth.userId,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "notification.dead_letter_replayed",
        entityType: "notification",
        entityId: req.params.notificationId,
        requestId: req.requestId,
        afterData: {
          reason: deadLetter.reason,
          replayCount: deadLetter.replayCount,
        },
      });
      return ok(res, { deadLetter });
    } catch (error) {
      return failFrom(res, error, "No se pudo reintentar la notificación");
    }
  },
);
