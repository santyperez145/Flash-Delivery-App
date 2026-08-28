// Cuando el pedido no salió como se pidió: incidencias y sustituciones
// (ticket ARC-001, paso 2).
//
// Cuatro rutas con repositorios propios y un ciclo de vida propio, distinto del
// ciclo de compra: acá no se compra ni se entrega nada, se tramita lo que salió
// distinto de lo pedido. La incidencia la abre el cliente y la resuelve
// soporte; la sustitución la propone el comercio y la decide el cliente. Son
// las dos direcciones del mismo problema.
//
// `orderIssueResolutionSchema` rechaza reintegro sobre incidencia rechazada en
// el esquema mismo: que la combinación imposible muera en la validación y no
// dependa de que el handler la recuerde.
import { Router } from "express";
import { z } from "zod";

import { requireAuth } from "./authentication.js";
import { isAdmin, requireAnyRole } from "./authorization.js";
import { recordPostgresAudit } from "../operations-repository.js";
import { createOrderIssue, getOrderIssues, resolveOrderIssue } from "../order-issue-repository.js";
import { usesPostgresCommerce } from "../postgres.js";
import { publishRealtimeEvent } from "./realtime.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";
import {
  decideOrderSubstitution,
  getOrderSubstitutions,
  proposeOrderSubstitution,
} from "../substitution-repository.js";

const orderIssueSchema = z.object({
  category: z.enum(["missing_item", "wrong_item", "damaged_item", "quality", "late", "other"]),
  description: z.string().trim().min(5).max(1000),
  requestedRefund: z.coerce.number().nonnegative().max(1000000),
});
const orderIssueResolutionSchema = z
  .object({
    status: z.enum(["approved", "rejected"]),
    approvedRefund: z.coerce.number().nonnegative().max(1000000).default(0),
    resolutionNote: z.string().trim().min(3).max(1000),
  })
  .superRefine((value, ctx) => {
    if (value.status === "rejected" && value.approvedRefund !== 0)
      ctx.addIssue({
        code: "custom",
        path: ["approvedRefund"],
        message: "Una incidencia rechazada no puede reintegrar dinero",
      });
  });
const substitutionProposalSchema = z.object({
  originalMenuItemId: z.string().min(3).max(100),
  replacementMenuItemId: z.string().min(3).max(100),
  reason: z.string().trim().min(3).max(500),
});
const substitutionDecisionSchema = z.object({
  decision: z.enum(["accepted", "rejected"]),
});

export const orderIssuesRouter = Router();
const router = orderIssuesRouter;

router.post(
  "/api/orders/:orderId/issues",
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return fail(res, 503, "Las incidencias requieren PostgreSQL");
    const parsed = parseOrFail(orderIssueSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const issue = await createOrderIssue({
        orderPublicId: req.params.orderId,
        customerPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "order_issue.created",
        entityType: "order_issue",
        entityId: issue.id,
        requestId: req.requestId,
        afterData: {
          orderId: req.params.orderId,
          category: issue.category,
          requestedRefund: issue.requestedRefund,
        },
      });
      await publishRealtimeEvent({
        req,
        type: "order.issue_updated",
        entityType: "order",
        entityId: req.params.orderId,
        action: "order_issue.created",
      });
      return res.status(201).json({ ok: true, requestId: req.requestId, issue });
    } catch (error) {
      return failFrom(res, error, "No se pudo crear la incidencia");
    }
  },
);
router.get("/api/orders/:orderId/issues", requireAuth, async (req, res) => {
  try {
    return ok(res, {
      issues: await getOrderIssues({
        orderPublicId: req.params.orderId,
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
      }),
    });
  } catch (error) {
    return failFrom(res, error, "No se pudieron cargar las incidencias");
  }
});
router.patch(
  "/api/order-issues/:issueId/resolve",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const parsed = parseOrFail(orderIssueResolutionSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const issue = await resolveOrderIssue({
        issuePublicId: req.params.issueId,
        actorPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: `order_issue.${issue.status}`,
        entityType: "order_issue",
        entityId: issue.id,
        requestId: req.requestId,
        afterData: {
          orderId: issue.orderId,
          approvedRefund: issue.approvedRefund,
          reason: parsed.data.resolutionNote,
        },
      });
      await publishRealtimeEvent({
        req,
        type: "order.issue_updated",
        entityType: "order",
        entityId: issue.orderId,
        action: `order_issue.${issue.status}`,
      });
      return ok(res, { issue });
    } catch (error) {
      return failFrom(res, error, "No se pudo resolver la incidencia");
    }
  },
);
router.post(
  "/api/orders/:orderId/substitutions",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(substitutionProposalSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const substitution = await proposeOrderSubstitution({
        orderPublicId: req.params.orderId,
        merchantOwnerPublicId: req.auth.userId,
        admin: isAdmin(req),
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "order_substitution.proposed",
        entityType: "order_substitution",
        entityId: substitution.id,
        requestId: req.requestId,
        afterData: {
          orderId: req.params.orderId,
          original: substitution.original.id,
          replacement: substitution.replacement.id,
        },
      });
      await publishRealtimeEvent({
        req,
        type: "order.substitution_updated",
        entityType: "order",
        entityId: req.params.orderId,
        action: "order_substitution.proposed",
      });
      return res.status(201).json({ ok: true, requestId: req.requestId, substitution });
    } catch (error) {
      return failFrom(res, error, "No se pudo proponer la sustitución");
    }
  },
);
router.get("/api/orders/:orderId/substitutions", requireAuth, async (req, res) => {
  try {
    return ok(res, {
      substitutions: await getOrderSubstitutions({
        orderPublicId: req.params.orderId,
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
      }),
    });
  } catch (error) {
    return failFrom(res, error, "No se pudieron cargar las sustituciones");
  }
});

router.patch(
  "/api/order-substitutions/:substitutionId",
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    const parsed = parseOrFail(substitutionDecisionSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const substitution = await decideOrderSubstitution({
        substitutionPublicId: req.params.substitutionId,
        customerPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: `order_substitution.${substitution.status}`,
        entityType: "order_substitution",
        entityId: substitution.id,
        requestId: req.requestId,
        afterData: {
          orderId: substitution.orderId,
          refundAmount: substitution.refundAmount,
        },
      });
      await publishRealtimeEvent({
        req,
        type: "order.substitution_updated",
        entityType: "order",
        entityId: substitution.orderId,
        action: `order_substitution.${substitution.status}`,
      });
      return ok(res, { substitution });
    } catch (error) {
      return failFrom(res, error, "No se pudo responder la sustitución");
    }
  },
);
