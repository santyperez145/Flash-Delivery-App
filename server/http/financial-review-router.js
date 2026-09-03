// Revisión financiera: lo que operaciones mira después de que el dinero se movió
// (ticket ARC-001, paso 2).
//
// Segundo corte de `/api/admin`. Las cinco rutas de conciliación y riesgo vivían
// juntas por casualidad de posición; las dos de payouts estaban ochocientas
// líneas más abajo, entre rutas de viajes. Lo que las agrupa no es el prefijo
// sino el momento: **todas actúan sobre plata que ya se movió**, y ninguna
// mueve plata por su cuenta.
//
// Esa es la línea que separa este router de `payment-methods-router.js`. Acá no
// se cobra ni se paga: se marca un caso como resuelto, se clasifica un riesgo,
// se aprueba o rechaza un pago a comercio. El efecto es un asiento y una
// decisión registrada, no una transferencia.
//
// Por eso las tres operaciones de decisión exigen nota y dejan auditoría con el
// actor: una conciliación sin quién ni por qué no sirve para lo único que la
// conciliación existe para hacer, que es reconstruir después qué pasó con una
// diferencia de plata.
import { Router } from "express";
import { z } from "zod";

import { getPayoutReviewQueue, reviewMerchantPayout } from "../merchant-finance-repository.js";
import { recordPostgresAudit } from "../audit-repository.js";
import {
  getPaymentReconciliation,
  resolvePaymentReconciliationCase,
  scanPaymentReconciliation,
} from "../payment-repository.js";
import { getTransactionRisks, reviewTransactionRisk } from "../risk-repository.js";
import { usesPostgresCommerce } from "../postgres.js";
import { requireAuth } from "./authentication.js";
import { requireAnyRole } from "./authorization.js";
import { publishRealtimeEvent } from "./realtime.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

// Las tres decisiones piden nota obligatoria de al menos cinco caracteres. No es
// validación de forma: es el mínimo para que la auditoría diga algo.
const paymentReconciliationResolutionSchema = z.object({
  status: z.enum(["resolved", "ignored"]),
  resolutionNote: z.string().trim().min(5).max(1000),
});
const transactionRiskReviewSchema = z.object({
  reviewStatus: z.enum(["confirmed_fraud", "false_positive", "cleared"]),
  reviewNote: z.string().trim().min(5).max(1000),
});
const payoutReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().min(5).max(1000),
});

export const financialReviewRouter = Router();
const router = financialReviewRouter;

router.get(
  "/api/admin/payment-reconciliation",
  requireAuth,
  requireAnyRole("support", "admin"),
  async (_req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "La conciliación de pagos requiere PostgreSQL");
    try {
      return ok(res, await getPaymentReconciliation());
    } catch (error) {
      return failFrom(res, error, "No se pudo cargar la conciliación");
    }
  },
);
router.post(
  "/api/admin/payment-reconciliation/scan",
  requireAuth,
  requireAnyRole("support", "admin"),
  async (req, res) => {
    try {
      const reconciliation = await scanPaymentReconciliation();
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "payment.reconciliation_scanned",
        entityType: "payment_reconciliation",
        entityId: "scan",
        requestId: req.requestId,
        afterData: {
          openCount: reconciliation.summary.openCount,
          urgentCount: reconciliation.summary.urgentCount,
        },
      });
      return ok(res, reconciliation);
    } catch (error) {
      return failFrom(res, error, "No se pudo ejecutar la conciliación");
    }
  },
);
router.patch(
  "/api/admin/payment-reconciliation/:caseId",
  requireAuth,
  requireAnyRole("support", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(paymentReconciliationResolutionSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const reconciliationCase = await resolvePaymentReconciliationCase({
        casePublicId: req.params.caseId,
        actorPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "payment.reconciliation_resolved",
        entityType: "payment_reconciliation",
        entityId: reconciliationCase.id,
        requestId: req.requestId,
        afterData: {
          status: reconciliationCase.status,
          caseType: reconciliationCase.caseType,
          // El motivo va en la auditoría y no sólo en la tabla del caso. Durante
          // un incidente se lee el log, y un log que dice quién cerró qué sin
          // decir por qué obliga a reconstruirlo desde otra fuente que además
          // pudo cambiar después.
          reason: parsed.data.resolutionNote,
        },
      });
      return ok(res, { case: reconciliationCase });
    } catch (error) {
      return failFrom(res, error, "No se pudo resolver el caso");
    }
  },
);
router.get(
  "/api/admin/transaction-risks",
  requireAuth,
  requireAnyRole("support", "admin"),
  async (_req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "Las evaluaciones de riesgo requieren PostgreSQL");
    try {
      return ok(res, { assessments: await getTransactionRisks() });
    } catch (error) {
      return failFrom(res, error, "No se pudieron cargar las evaluaciones");
    }
  },
);
router.patch(
  "/api/admin/transaction-risks/:assessmentId",
  requireAuth,
  requireAnyRole("support", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(transactionRiskReviewSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const assessment = await reviewTransactionRisk({
        assessmentPublicId: req.params.assessmentId,
        actorPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "risk.assessment_reviewed",
        entityType: "risk_assessment",
        entityId: assessment.id,
        requestId: req.requestId,
        afterData: {
          decision: assessment.decision,
          reason: parsed.data.reviewNote,
          reviewStatus: assessment.reviewStatus,
          score: assessment.score,
        },
      });
      return ok(res, { assessment });
    } catch (error) {
      return failFrom(res, error, "No se pudo revisar la evaluación");
    }
  },
);

router.get("/api/admin/payouts", requireAuth, requireAnyRole("admin"), async (_req, res) => {
  if (!usesPostgresCommerce()) return fail(res, 503, "La cola de payouts requiere PostgreSQL");
  try {
    return ok(res, { payouts: await getPayoutReviewQueue() });
  } catch (error) {
    return failFrom(res, error, "No se pudieron cargar los payouts");
  }
});
router.patch(
  "/api/admin/payouts/:payoutId/review",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const parsed = parseOrFail(payoutReviewSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const payout = await reviewMerchantPayout({
        payoutPublicId: req.params.payoutId,
        actorPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: `merchant.payout_${parsed.data.decision}`,
        entityType: "payout",
        entityId: payout.id,
        requestId: req.requestId,
        afterData: {
          merchantId: payout.merchantId,
          amount: payout.amount,
          status: payout.status,
          reason: parsed.data.note,
        },
      });
      await publishRealtimeEvent({
        req,
        type: "merchant.finance.updated",
        entityType: "restaurant",
        entityId: payout.merchantId,
        action: `merchant.payout_${parsed.data.decision}`,
      });
      return ok(res, { payout });
    } catch (error) {
      return failFrom(res, error, "No se pudo revisar el payout");
    }
  },
);
