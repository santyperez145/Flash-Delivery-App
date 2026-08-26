// Gobernanza tarifaria: qué cuesta cada servicio y quién autoriza cambiarlo
// (ticket ARC-001, paso 2).
//
// Estaba dentro de `/api/admin`, junto a moderación de cuentas, conciliación y
// disparadores de workers. Ese prefijo no es un dominio sino una audiencia. Lo
// que agrupa a estas cuatro rutas es un ciclo de vida propio —una tarifa se
// propone, se revisa y recién entonces rige— que no comparte con el resto de
// lo administrativo.
//
// **Ningún cambio de tarifa entra en vigencia al pedirlo.** `POST` crea una
// solicitud; hace falta un `PATCH .../review` para aprobarla. Es control de
// doble firma sobre el precio, y la razón es directa: un decimal mal puesto en
// `distancePerKm` se le cobra a todos los viajes de la ciudad hasta que alguien
// lo note.
//
// El rollback es una solicitud más, no un atajo: vuelve a una versión anterior
// pero pasa por la misma revisión. Deshacer un error de precio también cambia
// lo que se le cobra a la gente.
//
// Las tarifas se versionan y no se editan. `version` es único, así que un
// `23505` de PostgreSQL significa que esa versión ya existe: es un conflicto
// del cliente —409— y no una falla del servidor.
import { Router } from "express";
import { z } from "zod";

import { usesPostgresCommerce } from "../postgres.js";
import {
  createPostgresPricingChangeRequest,
  createPostgresPricingRollbackRequest,
  getPostgresPricingChangeRequests,
  reviewPostgresPricingChangeRequest,
} from "../configuration-repository.js";
import { recordPostgresAudit } from "../operations-repository.js";
import { requireAuth } from "./authentication.js";
import { requireAnyRole } from "./authorization.js";
import { publishRealtimeEvent } from "./realtime.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

// Cada servicio valida la forma de su tarifa con un esquema propio y no como
// `record` libre: un `config` sin esquema dejaría entrar campos con el nombre
// equivocado, que después se leen como `undefined` al calcular el precio.
const positiveRate = z.coerce.number().positive().max(1000000),
  multiplier = z.coerce.number().positive().max(10);
const ridePricingConfigSchema = z
  .object({
    baseFare: positiveRate,
    distancePerKm: positiveRate,
    timePerMin: positiveRate,
    serviceFee: positiveRate,
    tollThresholdKm: positiveRate,
    tollAmount: z.coerce.number().nonnegative().max(1000000),
    roadFactor: multiplier,
    minDistanceKm: positiveRate,
    maxDistanceKm: positiveRate,
    durationBaseMin: positiveRate,
    durationPerKm: positiveRate,
    etaBaseMin: positiveRate,
    etaPerKm: positiveRate,
    serviceMultipliers: z.object({
      moto: multiplier,
      economy: multiplier,
      comfort: multiplier,
      xl: multiplier,
    }),
  })
  .refine((value) => value.maxDistanceKm > value.minDistanceKm, "Distancias tarifarias inválidas");
const shipmentPricingConfigSchema = z
  .object({
    baseFare: positiveRate,
    distancePerKm: positiveRate,
    weightPerKg: positiveRate,
    roadFactor: multiplier,
    minDistanceKm: positiveRate,
    maxDistanceKm: positiveRate,
    etaBaseMin: positiveRate,
    etaPerKm: positiveRate,
    minimumEtaMin: positiveRate,
    sizeMultipliers: z.object({
      small: multiplier,
      medium: multiplier,
      large: multiplier,
    }),
  })
  .refine((value) => value.maxDistanceKm > value.minDistanceKm, "Distancias tarifarias inválidas");
const foodPricingConfigSchema = z
  .object({
    baseDeliveryFee: positiveRate,
    distancePerKm: positiveRate,
    minimumDeliveryFee: positiveRate,
    maximumDeliveryFee: positiveRate,
    serviceFee: positiveRate,
    roadFactor: multiplier,
    maximumDistanceKm: positiveRate,
  })
  .refine(
    (value) => value.maximumDeliveryFee >= value.minimumDeliveryFee,
    "Límites tarifarios inválidos",
  );
const pricingPlanSchema = z.object({
  version: z
    .string()
    .trim()
    .regex(/^[A-Z0-9._-]{6,64}$/),
  config: z.record(z.string(), z.unknown()),
  effectiveAt: z.string().datetime({ offset: true }).optional(),
});
const pricingRollbackSchema = z.object({
  targetVersion: z
    .string()
    .trim()
    .regex(/^[A-Z0-9._-]{6,64}$/),
  version: z
    .string()
    .trim()
    .regex(/^[A-Z0-9._-]{6,64}$/),
  effectiveAt: z.string().datetime({ offset: true }).optional(),
});
const pricingReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().min(5).max(500),
});

export const pricingRouter = Router();
const router = pricingRouter;

router.get(
  "/api/admin/pricing-changes",
  requireAuth,
  requireAnyRole("admin"),
  async (_req, res) => {
    try {
      return ok(res, { requests: await getPostgresPricingChangeRequests() });
    } catch (error) {
      return failFrom(res, error, "No se pudo cargar la cola tarifaria");
    }
  },
);
router.post(
  "/api/admin/pricing/:service",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "La configuración tarifaria requiere PostgreSQL");
    const service = String(req.params.service),
      base = parseOrFail(pricingPlanSchema, req.body || {});
    if (!base.ok || !["food", "ride", "shipment"].includes(service))
      return fail(res, 400, base.ok ? "Servicio tarifario inválido" : base.message);
    const schemas = {
        food: foodPricingConfigSchema,
        ride: ridePricingConfigSchema,
        shipment: shipmentPricingConfigSchema,
      },
      validatedConfig = parseOrFail(schemas[service], base.data.config);
    if (!validatedConfig.ok) return fail(res, 400, validatedConfig.message);
    const effectiveAt = base.data.effectiveAt ? new Date(base.data.effectiveAt) : new Date();
    if (
      effectiveAt.getTime() < Date.now() - 60000 ||
      effectiveAt.getTime() > Date.now() + 366 * 86400000
    )
      return fail(res, 400, "La vigencia debe estar entre ahora y 366 días");
    try {
      const changeRequest = await createPostgresPricingChangeRequest({
        service,
        version: base.data.version,
        config: validatedConfig.data,
        effectiveAt,
        requesterPublicId: req.auth.userId,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "pricing.change_requested",
        entityType: "pricing_change_request",
        entityId: changeRequest.id,
        requestId: req.requestId,
        afterData: {
          service,
          version: changeRequest.version,
          effectiveAt: changeRequest.effectiveAt,
          riskLevel: changeRequest.riskLevel,
          maximumChangePercent: changeRequest.maximumChangePercent,
        },
      });
      return res.status(201).json({ ok: true, requestId: req.requestId, changeRequest });
    } catch (error) {
      return failFrom(
        res,
        // Una violación de unicidad es un conflicto del cliente, no una falla
        // del servidor: conserva su 409 y su mensaje propio.
        error.code === "23505" ? { status: 409, message: "La versión tarifaria ya existe" } : error,
        "No se pudo solicitar la tarifa",
      );
    }
  },
);
router.post(
  "/api/admin/pricing/:service/rollback",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const service = String(req.params.service),
      parsed = parseOrFail(pricingRollbackSchema, req.body || {});
    if (!parsed.ok || !["food", "ride", "shipment"].includes(service))
      return fail(res, 400, parsed.ok ? "Servicio tarifario inválido" : parsed.message);
    const effectiveAt = parsed.data.effectiveAt ? new Date(parsed.data.effectiveAt) : new Date();
    if (
      effectiveAt.getTime() < Date.now() - 60000 ||
      effectiveAt.getTime() > Date.now() + 366 * 86400000
    )
      return fail(res, 400, "La vigencia debe estar entre ahora y 366 días");
    try {
      const changeRequest = await createPostgresPricingRollbackRequest({
        service,
        targetVersion: parsed.data.targetVersion,
        version: parsed.data.version,
        effectiveAt,
        requesterPublicId: req.auth.userId,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "pricing.rollback_requested",
        entityType: "pricing_change_request",
        entityId: changeRequest.id,
        requestId: req.requestId,
        afterData: {
          service,
          version: changeRequest.version,
          sourceVersion: changeRequest.sourceVersion,
          effectiveAt: changeRequest.effectiveAt,
          riskLevel: changeRequest.riskLevel,
        },
      });
      return res.status(201).json({ ok: true, requestId: req.requestId, changeRequest });
    } catch (error) {
      return failFrom(
        res,
        // Una violación de unicidad es un conflicto del cliente, no una falla
        // del servidor: conserva su 409 y su mensaje propio.
        error.code === "23505"
          ? { status: 409, message: "La versión de rollback ya existe" }
          : error,
        "No se pudo solicitar el rollback",
      );
    }
  },
);
router.patch(
  "/api/admin/pricing-changes/:requestId/review",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const parsed = parseOrFail(pricingReviewSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const changeRequest = await reviewPostgresPricingChangeRequest({
        publicId: req.params.requestId,
        reviewerPublicId: req.auth.userId,
        decision: parsed.data.decision,
        note: parsed.data.note,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: `pricing.${changeRequest.status}`,
        entityType: "pricing_change_request",
        entityId: changeRequest.id,
        requestId: req.requestId,
        afterData: {
          service: changeRequest.service,
          version: changeRequest.version,
          status: changeRequest.status,
          effectiveAt: changeRequest.effectiveAt,
          riskLevel: changeRequest.riskLevel,
          changeKind: changeRequest.changeKind,
        },
      });
      await publishRealtimeEvent({
        req,
        type: "pricing.change_reviewed",
        entityType: "pricing_change_request",
        entityId: changeRequest.id,
        action: changeRequest.status,
      });
      return ok(res, { changeRequest });
    } catch (error) {
      return failFrom(res, error, "No se pudo revisar la tarifa");
    }
  },
);
