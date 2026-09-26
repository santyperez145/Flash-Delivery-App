// El chat de servicio: hablar durante el trabajo (ticket ARC-001, paso 2).
//
// Ocho rutas contiguas y un solo dominio visto por sus dos lados. El cliente, el
// conductor y el comercio se escriben durante un pedido, un viaje o un envío; la
// administración configura las respuestas rápidas que esos tres tienen a mano.
// Separarlas dejaría la lista de respuestas sin la conversación donde se usan.
//
// **El chat cuelga del trabajo y no de las personas.** La ruta es
// `/api/jobs/:jobId/messages` porque lo que autoriza a escribir es participar de
// ese trabajo: cuando el pedido termina, el permiso termina con él. Un hilo por
// pareja de personas seguiría abierto para siempre.
//
// `serviceChatLimiter` da sesenta mensajes por ventana. Es el presupuesto más
// alto de los tres limitadores, porque acá el abuso es molestar a alguien y no
// vaciarle la cuenta, y un límite bajo rompería una conversación normal.
//
// El adjunto se sirve por ruta propia y con su identificador, nunca incrustado
// en el JSON del mensaje: una foto en base64 dentro de la respuesta queda en
// cada caché y cada log del camino. Es la misma decisión que en la evidencia de
// entrega de `shipment-router.js`.
import { Router } from "express";
import { z } from "zod";

import { usesPostgresCommerce } from "../postgres.js";
import { requireAuth } from "./authentication.js";
import { requireAnyRole } from "./authorization.js";
import { recordPostgresAudit } from "../audit-repository.js";
import { serviceChatLimiter } from "./rate-limits.js";
import { publishRealtimeEvent } from "./realtime.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";
import {
  createServiceMessage,
  createServiceQuickReply,
  getServiceAttachmentContent,
  getServiceMessages,
  getServiceQuickReplies,
  listServiceQuickReplies,
  markServiceMessagesRead,
  updateServiceQuickReply,
} from "../service-chat-repository.js";

const serviceMessageSchema = z
  .object({
    body: z.string().trim().max(1000).optional().default(""),
    attachment: z
      .object({
        fileName: z.string().trim().min(1).max(160),
        mimeType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
        contentBase64: z.string().min(4).max(1024000),
      })
      .optional(),
  })
  .refine(
    (value) => Boolean(value.body || value.attachment),
    "El mensaje requiere texto o adjunto",
  );
const serviceQuickReplyFields = {
  serviceScope: z.enum(["all", "food", "ride", "shipment"]),
  audience: z.enum(["customer", "driver", "merchant"]),
  locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/),
  body: z.string().trim().min(1).max(160),
  position: z.coerce.number().int().min(0).max(1000),
  active: z.boolean(),
};
const serviceQuickReplyCreateSchema = z.object(serviceQuickReplyFields),
  serviceQuickReplyUpdateSchema = z
    .object(
      Object.fromEntries(
        Object.entries(serviceQuickReplyFields).map(([key, value]) => [key, value.optional()]),
      ),
    )
    .refine((value) => Object.keys(value).length > 0, "No hay cambios");

export const serviceChatRouter = Router();
const router = serviceChatRouter;

router.get(
  "/api/jobs/:jobId/messages",
  requireAuth,
  requireAnyRole("customer", "driver", "merchant"),
  async (req, res) => {
    try {
      return ok(
        res,
        await getServiceMessages({
          jobPublicId: req.params.jobId,
          userPublicId: req.auth.userId,
        }),
      );
    } catch (error) {
      return failFrom(res, error, "No se pudo abrir la conversación");
    }
  },
);
router.post(
  "/api/jobs/:jobId/messages/read",
  requireAuth,
  requireAnyRole("customer", "driver", "merchant"),
  async (req, res) => {
    try {
      return ok(res, {
        receipt: await markServiceMessagesRead({
          jobPublicId: req.params.jobId,
          userPublicId: req.auth.userId,
        }),
      });
    } catch (error) {
      return failFrom(res, error, "No se pudo confirmar la lectura");
    }
  },
);
router.post(
  "/api/jobs/:jobId/messages",
  serviceChatLimiter,
  requireAuth,
  requireAnyRole("customer", "driver", "merchant"),
  async (req, res) => {
    const parsed = parseOrFail(serviceMessageSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const message = await createServiceMessage({
        jobPublicId: req.params.jobId,
        userPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "service_message.created",
        entityType: "job",
        entityId: req.params.jobId,
        requestId: req.requestId,
        afterData: {
          messageId: message.id,
          attachmentIds: message.attachments.map((entry) => entry.id),
        },
      });
      await publishRealtimeEvent({
        req,
        type: "service.message_created",
        entityType: "job",
        entityId: req.params.jobId,
        action: "service_message.created",
      });
      return res.status(201).json({ ok: true, requestId: req.requestId, message });
    } catch (error) {
      return failFrom(res, error, "No se pudo enviar el mensaje");
    }
  },
);
router.get(
  "/api/service-message-attachments/:attachmentId/content",
  serviceChatLimiter,
  requireAuth,
  requireAnyRole("customer", "driver", "merchant"),
  async (req, res) => {
    try {
      return ok(
        res,
        await getServiceAttachmentContent({
          attachmentPublicId: req.params.attachmentId,
          userPublicId: req.auth.userId,
        }),
      );
    } catch (error) {
      return failFrom(res, error, "No se pudo abrir el adjunto");
    }
  },
);
router.get(
  "/api/jobs/:jobId/quick-replies",
  requireAuth,
  requireAnyRole("customer", "driver", "merchant"),
  async (req, res) => {
    try {
      return ok(
        res,
        await getServiceQuickReplies({
          jobPublicId: req.params.jobId,
          userPublicId: req.auth.userId,
          locale: String(req.query.locale || "es-AR"),
        }),
      );
    } catch (error) {
      return failFrom(res, error, "No se pudieron cargar respuestas rápidas");
    }
  },
);
router.get(
  "/api/admin/service-chat/quick-replies",
  requireAuth,
  requireAnyRole("admin"),
  async (_req, res) => {
    // Era una arrow concisa sin `try`, así que cualquier fallo escapaba al
    // manejador global y salía como «Error interno del servidor»: un 500 que no
    // dice nada. Sobre el respaldo SQLite fallaba siempre.
    if (!usesPostgresCommerce())
      return fail(res, 503, "Las respuestas rápidas requieren PostgreSQL");
    try {
      return ok(res, { quickReplies: await listServiceQuickReplies() });
    } catch (error) {
      return failFrom(res, error, "No se pudieron cargar las respuestas rápidas");
    }
  },
);
router.post(
  "/api/admin/service-chat/quick-replies",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "Las respuestas rápidas requieren PostgreSQL");
    const parsed = parseOrFail(serviceQuickReplyCreateSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const quickReply = await createServiceQuickReply(parsed.data);
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "service_chat.quick_reply_created",
        entityType: "service_chat_quick_reply",
        entityId: quickReply.id,
        requestId: req.requestId,
        afterData: quickReply,
      });
      return res.status(201).json({ ok: true, requestId: req.requestId, quickReply });
    } catch (error) {
      return failFrom(
        res,
        // Una violación de unicidad es un conflicto del cliente, no una falla
        // del servidor: conserva su 409 y su mensaje propio.
        error.code === "23505" ? { status: 409, message: "La respuesta ya existe" } : error,
        "La respuesta ya existe",
      );
    }
  },
);
router.patch(
  "/api/admin/service-chat/quick-replies/:quickReplyId",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const parsed = parseOrFail(serviceQuickReplyUpdateSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const quickReply = await updateServiceQuickReply({
        publicId: req.params.quickReplyId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "service_chat.quick_reply_updated",
        entityType: "service_chat_quick_reply",
        entityId: quickReply.id,
        requestId: req.requestId,
        afterData: quickReply,
      });
      return ok(res, { quickReply });
    } catch (error) {
      return failFrom(
        res,
        // Una violación de unicidad es un conflicto del cliente, no una falla
        // del servidor: conserva su 409 y su mensaje propio.
        error.code === "23505" ? { status: 409, message: "La respuesta ya existe" } : error,
        "La respuesta ya existe",
      );
    }
  },
);
