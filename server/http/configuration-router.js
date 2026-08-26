// Configuración de plataforma (ticket ARC-001, paso 7).
//
// Décimoquinto grupo de rutas extraído de `server/index.js`. Agrupa promociones,
// ciudades, zonas, planes de precio y niveles de envío: **todo lo que define qué
// cuestan las cosas y dónde están disponibles**.
//
// Las lecturas son públicas y las escrituras son administrativas, pero son la
// misma configuración vista desde los dos lados. Separarlas por el prefijo de la
// URL dejaría la lectura de un nivel de envío lejos de la ruta que lo edita, que
// es justo el par que hay que mirar junto cuando algo no cuadra.
//
// Nada de acá es por usuario: es la forma del mercado. Por eso toda escritura
// queda auditada —cambiar un multiplicador de zona cambia el precio de cada
// cotización posterior— y las lecturas pueden cachearse.
import { Router } from "express";
import { z } from "zod";

import { usesPostgresCommerce } from "../postgres.js";
import { findPublicCity, getPublicCities } from "../city-repository.js";
import { fallbackRidePricing, fallbackShipmentPricing, readDb } from "../fallback-runtime.js";
import {
  createPostgresPromotion,
  getPostgresPricingPlans,
  getPostgresPromotions,
  getPostgresZones,
  updatePostgresPromotion,
  updatePostgresZone,
} from "../configuration-repository.js";
import {
  getShipmentOptions,
  updateShipmentItemCategory,
  updateShipmentServiceLevel,
} from "../mobility-repository.js";
import { recordPostgresAudit } from "../operations-repository.js";
import { assessZoneReadiness, getZoneReadiness } from "../zone-readiness-repository.js";
import { publishRealtimeEvent } from "./realtime.js";
import { requireAuth } from "./authentication.js";
import { isAdmin, requireAnyRole } from "./authorization.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

const shipmentCategoryUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    handlingInstructions: z.string().trim().min(3).max(300).optional(),
    surcharge: z.coerce.number().nonnegative().max(100000).optional(),
    maximumWeightKg: z.coerce.number().positive().max(20).optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Indicá al menos un cambio");
const shipmentServiceLevelUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    transportMultiplier: z.coerce.number().min(0.5).max(5).optional(),
    etaMultiplier: z.coerce.number().min(0.25).max(3).optional(),
    maximumDistanceKm: z.coerce.number().positive().max(500).nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Indicá al menos un cambio");
const promotionFields = z.object({
  code: z.string().trim().min(3).max(40).optional(),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(500).default(""),
  service: z.enum(["food", "ride"]),
  kind: z.enum(["percentage", "fixed", "free_delivery", "wallet_credit"]),
  value: z.coerce.number().int().positive(),
  maxDiscount: z.coerce.number().nonnegative().optional(),
  minSubtotal: z.coerce.number().nonnegative().default(0),
  usageLimit: z.coerce.number().int().positive().optional(),
  perUserLimit: z.coerce.number().int().positive().max(100).default(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  rules: z.record(z.string(), z.unknown()).default({}),
  active: z.boolean().default(true),
});
const promotionCreateSchema = promotionFields.refine(
  (value) => new Date(value.endsAt) > new Date(value.startsAt),
  "La fecha final debe ser posterior",
);
const promotionUpdateSchema = promotionFields
  .partial()
  .refine(
    (value) =>
      Object.keys(value).length > 0 &&
      (!value.startsAt || !value.endsAt || new Date(value.endsAt) > new Date(value.startsAt)),
    "Cambio de promoción inválido",
  );

const zoneUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    demandLevel: z.enum(["low", "medium", "high"]).optional(),
    deliveryMultiplier: z.coerce.number().min(0.5).max(3).optional(),
    rideMultiplier: z.coerce.number().min(0.5).max(3).optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Debes indicar un cambio");
export const configurationRouter = Router();
const router = configurationRouter;

router.get("/api/promotions", async (_req, res) => {
  try {
    res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
    return ok(res, {
      promotions: usesPostgresCommerce() ? await getPostgresPromotions() : readDb().promotions,
    });
  } catch (_error) {
    return fail(res, 500, "No se pudieron cargar las promociones");
  }
});
router.post("/api/promotions", requireAuth, requireAnyRole("admin"), async (req, res) => {
  if (!usesPostgresCommerce()) return fail(res, 503, "Promociones reales requieren PostgreSQL");
  const parsed = parseOrFail(promotionCreateSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    const promotion = await createPostgresPromotion(parsed.data);
    await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "promotion.created",
      entityType: "promotion",
      entityId: promotion.id,
      requestId: req.requestId,
      afterData: {
        code: promotion.code,
        service: promotion.service,
        kind: promotion.kind,
      },
    });
    return res.status(201).json({ ok: true, requestId: res.locals.requestId, promotion });
  } catch (error) {
    return failFrom(
      res,
      // Una violación de unicidad es un conflicto del cliente, no una falla
      // del servidor: conserva su 409 y su mensaje propio.
      error.code === "23505" ? { status: 409, message: "El código ya existe" } : error,
      "No se pudo crear la promoción",
    );
  }
});
router.patch(
  "/api/promotions/:promotionId",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const parsed = parseOrFail(promotionUpdateSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const promotion = await updatePostgresPromotion(req.params.promotionId, parsed.data);
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "promotion.updated",
        entityType: "promotion",
        entityId: promotion.id,
        requestId: req.requestId,
        afterData: parsed.data,
      });
      return ok(res, { promotion });
    } catch (error) {
      return failFrom(
        res,
        // Una violación de unicidad es un conflicto del cliente, no una falla
        // del servidor: conserva su 409 y su mensaje propio.
        error.code === "23505" ? { status: 409, message: "El código ya existe" } : error,
        "No se pudo actualizar la promoción",
      );
    }
  },
);
router.get("/api/cities", async (_req, res) => {
  try {
    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=900");
    return ok(res, {
      cities: usesPostgresCommerce()
        ? await getPublicCities()
        : [
            {
              id: "CITY-BA",
              slug: "buenos-aires",
              name: "Buenos Aires",
              countryCode: "AR",
              currency: "ARS",
              timezone: "America/Argentina/Buenos_Aires",
              status: "beta",
              enabledServices: ["delivery", "shopping"],
              center: { lat: -34.6037, lng: -58.3816 },
            },
          ],
    });
  } catch (_error) {
    return fail(res, 500, "No se pudieron cargar las ciudades");
  }
});
router.get("/api/zones", async (req, res) => {
  try {
    const citySlug = String(req.query.city || "buenos-aires");
    if (!/^[a-z0-9-]{2,40}$/.test(citySlug)) return fail(res, 400, "Ciudad inválida");
    if (usesPostgresCommerce() && !(await findPublicCity(citySlug)))
      return fail(res, 404, "Ciudad no habilitada");
    res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
    return ok(res, {
      city: citySlug,
      zones: usesPostgresCommerce()
        ? await getPostgresZones({ citySlug })
        : citySlug === "buenos-aires"
          ? readDb().zones
          : [],
    });
  } catch (_error) {
    return fail(res, 500, "No se pudieron cargar las zonas");
  }
});
router.patch("/api/zones/:zoneId", requireAuth, requireAnyRole("admin"), async (req, res) => {
  const parsed = parseOrFail(zoneUpdateSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    const zone = await updatePostgresZone(req.params.zoneId, parsed.data);
    await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "zone.updated",
      entityType: "service_zone",
      entityId: zone.id,
      requestId: req.requestId,
      afterData: parsed.data,
    });
    await publishRealtimeEvent({
      req,
      type: "zone.updated",
      entityType: "service_zone",
      entityId: zone.id,
      action: "zone.updated",
    });
    return ok(res, { zone });
  } catch (error) {
    return failFrom(res, error, "No se pudo actualizar la zona");
  }
});
router.get(
  "/api/operations/zones/:zoneId/readiness",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    try {
      res.set("Cache-Control", "no-store, private");
      return ok(res, { readiness: await getZoneReadiness(req.params.zoneId) });
    } catch (error) {
      return failFrom(res, error, "No se pudo evaluar la zona");
    }
  },
);
router.post(
  "/api/operations/zones/:zoneId/readiness-assessments",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    try {
      const assessment = await assessZoneReadiness({
        zonePublicId: req.params.zoneId,
        actorPublicId: req.auth.userId,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "zone.readiness_assessed",
        entityType: "service_zone",
        entityId: req.params.zoneId,
        requestId: req.requestId,
        afterData: {
          assessmentId: assessment.id,
          decision: assessment.decision,
          checks: assessment.checks,
        },
      });
      return res.status(201).json({ ok: true, requestId: req.requestId, assessment });
    } catch (error) {
      return failFrom(res, error, "No se pudo registrar la evaluación");
    }
  },
);

router.get("/api/pricing", async (_req, res) => {
  try {
    return ok(res, {
      plans: usesPostgresCommerce()
        ? await getPostgresPricingPlans()
        : [fallbackRidePricing, fallbackShipmentPricing],
    });
  } catch (_error) {
    return fail(res, 500, "No se pudieron cargar las tarifas");
  }
});
router.get("/api/shipment-options", async (_req, res) => {
  if (!usesPostgresCommerce())
    return fail(res, 503, "Las opciones operativas de envío requieren PostgreSQL");
  try {
    return ok(res, await getShipmentOptions());
  } catch (_error) {
    return fail(res, 500, "No se pudieron cargar las opciones de envío");
  }
});
router.get(
  "/api/admin/shipment-options",
  requireAuth,
  requireAnyRole("admin"),
  async (_req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "Las opciones operativas de envío requieren PostgreSQL");
    try {
      return ok(res, await getShipmentOptions({ includeInactive: true }));
    } catch (_error) {
      return fail(res, 500, "No se pudo cargar la configuración de envíos");
    }
  },
);
router.patch(
  "/api/admin/shipment-item-categories/:code",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const parsed = parseOrFail(shipmentCategoryUpdateSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const before =
          (await getShipmentOptions({ includeInactive: true })).categories.find(
            (entry) => entry.code === req.params.code,
          ) || null,
        category = await updateShipmentItemCategory(req.params.code, parsed.data);
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "shipment.category_updated",
        entityType: "shipment_item_category",
        entityId: req.params.code,
        requestId: req.requestId,
        beforeData: before,
        afterData: category,
      });
      return ok(res, { category });
    } catch (error) {
      return failFrom(res, error, "No se pudo actualizar la categoría");
    }
  },
);
router.patch(
  "/api/admin/shipment-service-levels/:code",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const parsed = parseOrFail(shipmentServiceLevelUpdateSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const before =
          (await getShipmentOptions({ includeInactive: true })).serviceLevels.find(
            (entry) => entry.code === req.params.code,
          ) || null,
        serviceLevel = await updateShipmentServiceLevel(req.params.code, parsed.data);
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "shipment.service_level_updated",
        entityType: "shipment_service_level",
        entityId: req.params.code,
        requestId: req.requestId,
        beforeData: before,
        afterData: serviceLevel,
      });
      return ok(res, { serviceLevel });
    } catch (error) {
      return failFrom(res, error, "No se pudo actualizar el nivel de servicio");
    }
  },
);
