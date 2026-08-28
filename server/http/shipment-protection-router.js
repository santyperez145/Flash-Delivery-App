// Protección de envíos: devoluciones y siniestros (ticket ARC-001, paso 7).
//
// Duodécimo grupo de rutas extraído de `server/index.js`. Los dos subgrupos son
// **qué pasa cuando un envío sale mal**: el cliente quiere que vuelva, o quiere
// que le paguen lo que se perdió, rompió o le robaron.
//
// Van juntos porque comparten la cola operativa que los resuelve y porque la
// frontera entre uno y otro la decide la operación, no la URL: una devolución
// que no llega termina siendo un siniestro.
//
// La evidencia se cifra y se lee por una ruta aparte. El límite de 1 MB en
// base64 y los tres tipos MIME permitidos no son decoración: es una carga de
// archivo autenticada contra un caso que otro usuario no debe poder abrir.
//
// La liquidación externa no se simula: un siniestro aprobado queda en
// `settlement_pending` hasta que exista un proveedor habilitado.
import { Router } from "express";
import { z } from "zod";

import {
  addPostgresShipmentClaimEvidence,
  createPostgresShipmentClaim,
  createPostgresShipmentReturn,
  getPostgresShipmentClaimEvidenceContent,
  getPostgresShipmentClaims,
  getPostgresShipmentReturns,
  updatePostgresShipmentClaim,
  updatePostgresShipmentReturn,
} from "../mobility-repository.js";
import { recordPostgresAudit } from "../operations-repository.js";
import { usesPostgresCommerce } from "../postgres.js";
import { requireAuth } from "./authentication.js";
import { isAdmin, requireAnyRole } from "./authorization.js";
import { deliveryProofLimiter } from "./rate-limits.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

const shipmentReturnSchema = z.object({
    reason: z.string().trim().min(5).max(500),
  }),
  shipmentReturnUpdateSchema = z.object({
    status: z.enum(["approved", "rejected", "in_transit", "completed"]),
    resolutionNote: z.string().trim().min(3).max(500).optional(),
  });
const shipmentClaimSchema = z.object({
    claimType: z.enum(["lost", "damaged", "stolen"]),
    description: z.string().trim().min(10).max(1000),
    requestedAmount: z.coerce.number().positive().max(1000000),
  }),
  shipmentClaimUpdateSchema = z.object({
    status: z.enum(["under_review", "approved", "rejected", "settlement_pending", "settled"]),
    resolutionNote: z.string().trim().min(5).max(1000),
    approvedAmount: z.coerce.number().positive().max(1000000).optional(),
  }),
  shipmentClaimEvidenceSchema = z.object({
    fileName: z.string().trim().min(1).max(160),
    mimeType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
    contentBase64: z.string().min(4).max(1024000),
  });

export const shipmentProtectionRouter = Router();
const router = shipmentProtectionRouter;

router.get(
  "/api/shipment-returns",
  requireAuth,
  requireAnyRole("customer", "support", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "Las devoluciones de envío requieren PostgreSQL");
    try {
      return ok(res, {
        returns: await getPostgresShipmentReturns({
          customerPublicId: req.auth.userId,
          includeAll: isAdmin(req) || req.auth.roles.includes("support"),
        }),
      });
    } catch (error) {
      return failFrom(res, error, "No se pudieron cargar las devoluciones");
    }
  },
);
router.post(
  "/api/shipments/:shipmentId/returns",
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    const parsed = parseOrFail(shipmentReturnSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const shipmentReturn = await createPostgresShipmentReturn({
        shipmentPublicId: req.params.shipmentId,
        customerPublicId: req.auth.userId,
        reason: parsed.data.reason,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "shipment.return_requested",
        entityType: "shipment_return",
        entityId: shipmentReturn.id,
        requestId: req.requestId,
        afterData: { shipmentId: req.params.shipmentId },
      });
      return res.status(201).json({ ok: true, requestId: req.requestId, return: shipmentReturn });
    } catch (error) {
      return failFrom(
        res,
        // Una violación de unicidad es un conflicto del cliente, no una falla
        // del servidor: conserva su 409 y su mensaje propio.
        error.code === "23505"
          ? { status: 409, message: "Ya existe una devolución para este envío" }
          : error,
        "No se pudo solicitar la devolución",
      );
    }
  },
);
router.patch(
  "/api/shipment-returns/:returnId",
  requireAuth,
  requireAnyRole("support", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(shipmentReturnUpdateSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const shipmentReturn = await updatePostgresShipmentReturn({
        returnPublicId: req.params.returnId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "shipment.return_updated",
        entityType: "shipment_return",
        entityId: shipmentReturn.id,
        requestId: req.requestId,
        afterData: {
          status: shipmentReturn.status,
          reason: parsed.data.resolutionNote,
        },
      });
      return ok(res, { return: shipmentReturn });
    } catch (error) {
      return failFrom(res, error, "No se pudo actualizar la devolución");
    }
  },
);
router.get(
  "/api/shipment-claims",
  requireAuth,
  requireAnyRole("customer", "support", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "Los siniestros de envío requieren PostgreSQL");
    try {
      return ok(res, {
        claims: await getPostgresShipmentClaims({
          customerPublicId: req.auth.userId,
          includeAll: isAdmin(req) || req.auth.roles.includes("support"),
        }),
      });
    } catch (error) {
      return failFrom(res, error, "No se pudieron cargar los siniestros");
    }
  },
);
router.post(
  "/api/shipments/:shipmentId/claims",
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    const parsed = parseOrFail(shipmentClaimSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const claim = await createPostgresShipmentClaim({
        shipmentPublicId: req.params.shipmentId,
        customerPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "shipment.claim_submitted",
        entityType: "shipment_claim",
        entityId: claim.id,
        requestId: req.requestId,
        afterData: {
          shipmentId: req.params.shipmentId,
          claimType: claim.claimType,
          requestedAmount: claim.requestedAmount,
          eligibleAmount: claim.eligibleAmount,
        },
      });
      return res.status(201).json({ ok: true, requestId: req.requestId, claim });
    } catch (error) {
      return failFrom(
        res,
        // Una violación de unicidad es un conflicto del cliente, no una falla
        // del servidor: conserva su 409 y su mensaje propio.
        error.code === "23505"
          ? { status: 409, message: "Ya existe un siniestro para este envío" }
          : error,
        "Ya existe un siniestro para este envío",
      );
    }
  },
);
router.post(
  "/api/shipment-claims/:claimId/evidence",
  deliveryProofLimiter,
  requireAuth,
  requireAnyRole("customer", "support", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(shipmentClaimEvidenceSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const evidence = await addPostgresShipmentClaimEvidence({
        claimPublicId: req.params.claimId,
        actorPublicId: req.auth.userId,
        ...parsed.data,
        includeAll: isAdmin(req) || req.auth.roles.includes("support"),
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "shipment.claim_evidence_added",
        entityType: "shipment_claim",
        entityId: req.params.claimId,
        requestId: req.requestId,
        afterData: {
          evidenceId: evidence.id,
          mimeType: evidence.mimeType,
          sha256: evidence.sha256,
          sizeBytes: evidence.sizeBytes,
        },
      });
      return res.status(201).json({ ok: true, requestId: req.requestId, evidence });
    } catch (error) {
      return failFrom(res, error, "No se pudo adjuntar la evidencia");
    }
  },
);
router.get(
  "/api/shipment-claim-evidence/:evidenceId/content",
  deliveryProofLimiter,
  requireAuth,
  requireAnyRole("customer", "support", "admin"),
  async (req, res) => {
    try {
      return ok(
        res,
        await getPostgresShipmentClaimEvidenceContent({
          evidencePublicId: req.params.evidenceId,
          actorPublicId: req.auth.userId,
          includeAll: isAdmin(req) || req.auth.roles.includes("support"),
        }),
      );
    } catch (error) {
      return failFrom(res, error, "No se pudo abrir la evidencia");
    }
  },
);
router.patch(
  "/api/shipment-claims/:claimId",
  requireAuth,
  requireAnyRole("support", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(shipmentClaimUpdateSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const claim = await updatePostgresShipmentClaim({
        claimPublicId: req.params.claimId,
        actorPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "shipment.claim_updated",
        entityType: "shipment_claim",
        entityId: claim.id,
        requestId: req.requestId,
        afterData: {
          status: claim.status,
          approvedAmount: claim.approvedAmount,
          reason: parsed.data.resolutionNote,
        },
      });
      return ok(res, { claim });
    } catch (error) {
      return failFrom(res, error, "No se pudo actualizar el siniestro");
    }
  },
);
