// Mesa de ayuda (ticket ARC-001, paso 7).
//
// Décimocuarto grupo de rutas extraído de `server/index.js`. Es el canal por el
// que un cliente reporta que algo salió mal y por el que operaciones responde.
//
// Las cuatro rutas comparten una frontera de privacidad que no es obvia desde
// la URL: **el cliente ve su ticket y sus mensajes, pero nunca las notas
// internas**. La misma ruta devuelve distinto según quién pregunte, y esa
// diferencia se decide acá, no en la base.
//
// Cada cambio de estado publica un evento realtime para que la app del cliente
// se entere sin preguntar, y queda auditado porque un ticket es la evidencia de
// cómo se resolvió un problema con dinero o con una entrega de por medio.
import { Router } from "express";
import { z } from "zod";

import { usesPostgresCommerce } from "../postgres.js";
import { scopeStateForRequest } from "../fallback-runtime.js";
import { getPublicState } from "../store.js";
import {
  addPostgresSupportMessage,
  createPostgresSupportTicket,
  getPostgresSupportTickets,
  recordPostgresAudit,
  updatePostgresSupportTicket,
} from "../operations-repository.js";
import { requireAuth } from "./authentication.js";
import { isAdmin, requireAnyRole } from "./authorization.js";
import { publishRealtimeEvent } from "./realtime.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

const supportTicketCreateSchema = z.object({
  category: z.enum(["food", "ride", "shipment", "payment", "account", "safety", "other"]),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  subject: z.string().trim().min(4).max(160),
  body: z.string().trim().min(4).max(5000),
  jobId: z.string().trim().max(64).optional(),
});
const supportMessageSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  internal: z.boolean().default(false),
});
const supportTicketUpdateSchema = z
  .object({
    status: z
      .enum(["open", "waiting_customer", "waiting_operations", "resolved", "closed"])
      .optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    assignedTo: z.string().trim().max(64).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Debes indicar un cambio");

export const supportRouter = Router();
const router = supportRouter;

router.get("/api/support/tickets", requireAuth, async (req, res) => {
  if (!usesPostgresCommerce())
    return ok(res, {
      tickets: scopeStateForRequest(getPublicState(), req).supportTickets || [],
    });
  try {
    return ok(res, {
      tickets: await getPostgresSupportTickets({
        userPublicId: req.auth.userId,
        roles: req.auth.roles,
      }),
    });
  } catch (error) {
    return failFrom(res, error, "No se pudo cargar soporte");
  }
});
router.post("/api/support/tickets", requireAuth, async (req, res) => {
  if (!usesPostgresCommerce()) return fail(res, 503, "Soporte real requiere PostgreSQL");
  const idempotencyKey = String(req.get("idempotency-key") || "");
  if (!/^[a-zA-Z0-9._:-]{16,128}$/.test(idempotencyKey))
    return fail(res, 400, "Idempotency-Key válido es obligatorio");
  const parsed = parseOrFail(supportTicketCreateSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    const created = await createPostgresSupportTicket({
      userPublicId: req.auth.userId,
      idempotencyKey,
      ...parsed.data,
      jobPublicId: parsed.data.jobId,
    });
    const ticket = created.ticket;
    if (!created.replayed)
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "support.created",
        entityType: "support_ticket",
        entityId: ticket.id,
        requestId: req.requestId,
        afterData: {
          category: parsed.data.category,
          priority: parsed.data.priority,
        },
      });
    if (!created.replayed)
      await publishRealtimeEvent({
        req,
        type: "support.updated",
        entityType: "support_ticket",
        entityId: ticket.id,
        action: "support.created",
      });
    return res.status(201).json({ ok: true, requestId: res.locals.requestId, ticket });
  } catch (error) {
    return failFrom(res, error, "No se pudo crear el ticket");
  }
});
router.post("/api/support/tickets/:ticketId/messages", requireAuth, async (req, res) => {
  if (!usesPostgresCommerce()) return fail(res, 503, "Soporte real requiere PostgreSQL");
  const idempotencyKey = String(req.get("idempotency-key") || "");
  if (!/^[a-zA-Z0-9._:-]{16,128}$/.test(idempotencyKey))
    return fail(res, 400, "Idempotency-Key válido es obligatorio");
  const parsed = parseOrFail(supportMessageSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    const created = await addPostgresSupportMessage({
      ticketPublicId: req.params.ticketId,
      senderPublicId: req.auth.userId,
      roles: req.auth.roles,
      idempotencyKey,
      ...parsed.data,
    });
    const ticket = created.ticket;
    if (!created.replayed)
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: parsed.data.internal ? "support.internal_note_created" : "support.message_created",
        entityType: "support_ticket",
        entityId: ticket.id,
        requestId: req.requestId,
        afterData: { internal: parsed.data.internal },
      });
    if (!created.replayed)
      await publishRealtimeEvent({
        req,
        type: "support.updated",
        entityType: "support_ticket",
        entityId: ticket.id,
        action: "support.message_created",
      });
    return ok(res, { ticket });
  } catch (error) {
    return failFrom(res, error, "No se pudo enviar el mensaje");
  }
});
router.patch(
  "/api/support/tickets/:ticketId",
  requireAuth,
  requireAnyRole("support", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(supportTicketUpdateSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const ticket = await updatePostgresSupportTicket({
        ticketPublicId: req.params.ticketId,
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "support.updated",
        entityType: "support_ticket",
        entityId: ticket.id,
        requestId: req.requestId,
        afterData: parsed.data,
      });
      return ok(res, { ticket });
    } catch (error) {
      return failFrom(res, error, "No se pudo actualizar el ticket");
    }
  },
);
