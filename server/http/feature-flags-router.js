// Feature flags: qué está encendido, para quién, y quién lo enciende
// (ticket ARC-001, paso 2).
//
// Las tres rutas son un mismo interruptor visto desde los dos lados. `GET
// /api/features` responde qué le toca a quien pregunta —ya resuelto contra su
// rol y su porcentaje de rollout—; las dos de `/api/operations/feature-flags`
// listan los interruptores y los cambian. Separarlas dejaría la lectura sin la
// definición que la produce.
//
// `GET /api/features` degrada en lugar de fallar: si la evaluación se cae,
// responde `{ features: {}, degraded: true }` con 200. Es deliberado. Un flag
// que no se puede leer significa "no hay nada encendido", que es el estado
// seguro; devolver 500 dejaría a la aplicación sin arrancar por un interruptor
// apagado.
//
// El `PATCH` audita con `beforeData` y `afterData`. Un flag es la palanca más
// rápida que tiene la plataforma para cambiar de comportamiento sin desplegar,
// y por eso mismo es la que más necesita decir después quién la movió.
import { Router } from "express";
import { z } from "zod";

import { usesPostgresAuth } from "../auth-repository.js";
import {
  evaluateFeatureFlags,
  getFeatureFlags,
  updateFeatureFlag,
} from "../feature-flag-repository.js";
import { recordPostgresAudit } from "../operations-repository.js";
import { usesPostgresCommerce } from "../postgres.js";
import { requireAuth } from "./authentication.js";
import { requireAnyRole } from "./authorization.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

const featureFlagUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    rolloutPercentage: z.coerce.number().int().min(0).max(100).optional(),
    allowedRoles: z
      .array(z.enum(["customer", "merchant", "driver", "admin", "support"]))
      .max(5)
      .optional(),
    startsAt: z.string().datetime().nullable().optional(),
    endsAt: z.string().datetime().nullable().optional(),
    variant: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Indicá al menos un cambio")
  .refine(
    (value) =>
      !value.startsAt || !value.endsAt || new Date(value.endsAt) > new Date(value.startsAt),
    "La fecha final debe ser posterior al inicio",
  );

export const featureFlagsRouter = Router();
const router = featureFlagsRouter;

router.get("/api/features", requireAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store, private");
    return ok(res, {
      features: usesPostgresAuth()
        ? await evaluateFeatureFlags({ userId: req.auth.userId, roles: req.auth.roles })
        : {
            delivery_beta: { active: true, variant: { phase: "local_demo" } },
            shipment_beta: { active: true, variant: { phase: "local_demo" } },
            // Espeja lo que la migración 124 dejó en la base. El respaldo tiene
            // los flags fijos, y dejarlos derivar hace que la demo se comporte
            // distinto del producto: con el gate de la pestaña cableado, un
            // `false` acá escondería Taxi sólo en modo local.
            public_rides: { active: true, variant: {} },
          },
    });
  } catch (_error) {
    return ok(res, { features: {}, degraded: true });
  }
});
router.get(
  "/api/operations/feature-flags",
  requireAuth,
  requireAnyRole("admin"),
  async (_req, res) => {
    if (!usesPostgresCommerce()) return fail(res, 503, "Los feature flags requieren PostgreSQL");
    try {
      res.set("Cache-Control", "no-store, private");
      return ok(res, { flags: await getFeatureFlags() });
    } catch (error) {
      return failFrom(res, error, "No se pudieron cargar los feature flags");
    }
  },
);
router.patch(
  "/api/operations/feature-flags/:flagId",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const parsed = parseOrFail(featureFlagUpdateSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const before = (await getFeatureFlags()).find((flag) => flag.id === req.params.flagId);
      if (!before) return fail(res, 404, "Feature flag no encontrado");
      const flag = await updateFeatureFlag({ publicId: req.params.flagId, changes: parsed.data });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "feature_flag.updated",
        entityType: "feature_flag",
        entityId: flag.id,
        requestId: req.requestId,
        beforeData: before,
        afterData: flag,
      });
      return ok(res, { flag });
    } catch (error) {
      return failFrom(res, error, "No se pudo actualizar el feature flag");
    }
  },
);
