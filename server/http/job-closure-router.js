// Lo que queda del trabajo cuando termina: la propina y el recibo
// (ticket ARC-001, paso 2).
//
// Cinco rutas que cuelgan de `/api/jobs/:jobId` y ocurren todas después de que
// el pedido, el viaje o el envío se completó. Antes no hay nada que agradecer
// ni nada que documentar.
//
// El recibo es una sola ruta y viaja acá en vez de quedarse solo. Comparte con
// la propina el momento y el sujeto —el trabajo cerrado—, que es más de lo que
// comparte con cualquier otro grupo: no es del comercio, ni del conductor, ni
// del cliente en particular, sino de los tres a la vez.
//
// **La propina se ajusta, no se edita.** Una vez dada se acredita al conductor,
// así que corregirla es una solicitud que otra persona revisa —el mismo control
// de doble firma que las tarifas—. La diferencia con las tarifas es a quién
// protege: ahí, a todos los clientes de la ciudad; acá, al conductor que ya
// cobró y no debería perder plata por una corrección unilateral.
import { Router } from "express";
import { z } from "zod";

import { requireAuth } from "./authentication.js";
import { isAdmin, requireAnyRole } from "./authorization.js";
import { recordPostgresAudit } from "../operations-repository.js";
import { usesPostgresCommerce } from "../postgres.js";
import { publishRealtimeEvent } from "./realtime.js";
import { getOrCreatePostgresReceipt } from "../receipt-repository.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";
import {
  createPostgresTip,
  getTipAdjustments,
  requestTipAdjustment,
  reviewTipAdjustment,
} from "../tip-repository.js";

const tipSchema = z.object({
  amount: z.coerce.number().int().min(100).max(100000),
});
const tipAdjustmentRequestSchema = z.object({
  tipId: z.string().trim().min(8).max(80),
  amount: z.coerce.number().positive().max(100000),
  reason: z.string().trim().min(5).max(1000),
});
const tipAdjustmentReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().min(5).max(1000),
});

export const jobClosureRouter = Router();
const router = jobClosureRouter;

router.post("/api/jobs/:jobId/tips", requireAuth, requireAnyRole("customer"), async (req, res) => {
  if (!usesPostgresCommerce()) return fail(res, 503, "Las propinas requieren PostgreSQL");
  const parsed = parseOrFail(tipSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const idempotencyKey = String(req.get("idempotency-key") || "");
  if (!/^[a-zA-Z0-9._:-]{16,128}$/.test(idempotencyKey))
    return fail(res, 400, "Idempotency-Key válido es obligatorio");
  try {
    const tip = await createPostgresTip({
      jobPublicId: req.params.jobId,
      customerPublicId: req.auth.userId,
      amount: parsed.data.amount,
      idempotencyKey,
    });
    await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "service.tip_created",
      entityType: "job",
      entityId: req.params.jobId,
      requestId: req.requestId,
      afterData: { tipId: tip.id, amount: tip.amount },
    });
    await publishRealtimeEvent({
      req,
      type: "wallet.updated",
      entityType: "job",
      entityId: req.params.jobId,
      action: "service.tip_created",
    });
    return res.status(201).json({ ok: true, requestId: req.requestId, tip });
  } catch (error) {
    return failFrom(res, error, "No se pudo enviar la propina");
  }
});
router.get(
  "/api/admin/tip-adjustments",
  requireAuth,
  requireAnyRole("admin"),
  async (_req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "Los ajustes de propina requieren PostgreSQL");
    try {
      return ok(res, { adjustments: await getTipAdjustments() });
    } catch (error) {
      return failFrom(res, error, "No se pudieron cargar los ajustes de propinas");
    }
  },
);
router.post(
  "/api/admin/tip-adjustments",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const parsed = parseOrFail(tipAdjustmentRequestSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    const idempotencyKey = String(req.get("idempotency-key") || "");
    if (!/^[a-zA-Z0-9._:-]{16,128}$/.test(idempotencyKey))
      return fail(res, 400, "Idempotency-Key válido es obligatorio");
    try {
      const adjustment = await requestTipAdjustment({
        actorPublicId: req.auth.userId,
        idempotencyKey,
        ...parsed.data,
        tipPublicId: parsed.data.tipId,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "service.tip_adjustment_requested",
        entityType: "tip_adjustment",
        entityId: adjustment.id,
        requestId: req.requestId,
        afterData: {
          tipId: adjustment.tipId,
          amount: adjustment.amount,
          reason: adjustment.reason,
        },
      });
      return res.status(201).json({ ok: true, requestId: req.requestId, adjustment });
    } catch (error) {
      return failFrom(res, error, "No se pudo solicitar el ajuste");
    }
  },
);
router.patch(
  "/api/admin/tip-adjustments/:adjustmentId/review",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const parsed = parseOrFail(tipAdjustmentReviewSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const adjustment = await reviewTipAdjustment({
        adjustmentPublicId: req.params.adjustmentId,
        actorPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: `service.tip_adjustment_${parsed.data.decision}`,
        entityType: "tip_adjustment",
        entityId: adjustment.id,
        requestId: req.requestId,
        afterData: {
          tipId: adjustment.tipId,
          amount: adjustment.amount,
          status: adjustment.status,
        },
      });
      await publishRealtimeEvent({
        req,
        type: "wallet.updated",
        entityType: "job",
        entityId: adjustment.jobId,
        action: `service.tip_adjustment_${parsed.data.decision}`,
      });
      return ok(res, { adjustment });
    } catch (error) {
      return failFrom(res, error, "No se pudo revisar el ajuste");
    }
  },
);
router.get(
  "/api/jobs/:jobId/receipt",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return fail(res, 503, "Los comprobantes requieren PostgreSQL");
    try {
      const result = await getOrCreatePostgresReceipt({
        jobPublicId: req.params.jobId,
        actorPublicId: req.auth.userId,
        admin: isAdmin(req),
      });
      if (result.created)
        await recordPostgresAudit({
          actorPublicId: req.auth.userId,
          roles: req.auth.roles,
          action: "service.receipt_issued",
          entityType: "job",
          entityId: req.params.jobId,
          requestId: req.requestId,
          afterData: {
            receiptId: result.receipt.id,
            receiptNumber: result.receipt.number,
          },
        });
      return ok(res, { receipt: result.receipt });
    } catch (error) {
      return failFrom(res, error, "No se pudo obtener el comprobante");
    }
  },
);
