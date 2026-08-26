// Flota del conductor (ticket ARC-001, paso 7).
//
// Undécimo grupo de rutas extraído de `server/index.js`. Cubre el ciclo de vida
// completo de un vehículo: alta, edición, activación, retiro y **la revisión
// administrativa que lo habilita**.
//
// La revisión vive acá aunque su ruta cuelgue de `/api/admin`. Separarla por el
// prefijo de la URL partiría en dos una sola máquina de estados: un vehículo sin
// aprobar no despacha, y quién lo aprueba es parte de cómo llega a hacerlo.
//
// El dispatch exige `vehicle.status='approved'`, así que este grupo decide qué
// conductores son elegibles. Por eso cada transición queda auditada.
import { Router } from "express";
import { z } from "zod";

import {
  activateDriverVehicle,
  createDriverVehicle,
  getDriverVehicles,
  retireDriverVehicle,
  reviewDriverVehicle,
  updateDriverVehicle,
} from "../driver-vehicle-repository.js";
import { recordPostgresAudit } from "../operations-repository.js";
import { requireAuth } from "./authentication.js";
import { isAdmin, requireAnyRole } from "./authorization.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

const driverVehicleFields = {
  kind: z.enum(["bicycle", "motorcycle", "car", "van"]),
  model: z.string().trim().min(2).max(80),
  plate: z
    .string()
    .trim()
    .min(3)
    .max(16)
    .regex(/^[A-Za-z0-9 -]+$/),
  color: z.string().trim().min(2).max(40).nullable().optional(),
  seats: z.coerce.number().int().min(1).max(8).nullable().optional(),
  serviceModes: z
    .array(z.enum(["delivery", "ride"]))
    .min(1)
    .max(2),
};
const driverVehicleSchema = z.object(driverVehicleFields).superRefine((value, ctx) => {
  if (value.serviceModes.includes("ride") && (!["car", "van"].includes(value.kind) || !value.seats))
    ctx.addIssue({
      code: "custom",
      path: ["seats"],
      message: "Viajes requiere auto o van con asientos declarados",
    });
});
const driverVehicleUpdateSchema = z
  .object(
    Object.fromEntries(
      Object.entries(driverVehicleFields).map(([key, value]) => [key, value.optional()]),
    ),
  )
  .refine((value) => Object.keys(value).length > 0, "Indicá al menos un cambio");
const driverVehicleReviewSchema = z
  .object({
    status: z.enum(["approved", "rejected"]),
    rejectionReason: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === "rejected" && (!value.rejectionReason || value.rejectionReason.length < 5))
      ctx.addIssue({ code: "custom", path: ["rejectionReason"], message: "Explica el rechazo" });
  });

export const driverFleetRouter = Router();
const router = driverFleetRouter;

router.get(
  "/api/drivers/:driverId/vehicles",
  requireAuth,
  requireAnyRole("driver", "support", "admin"),
  async (req, res) => {
    try {
      return ok(res, {
        vehicles: await getDriverVehicles({
          driverPublicId: req.params.driverId,
          actorPublicId: req.auth.userId,
          roles: req.auth.roles,
          includeRetired: req.query.includeRetired === "true",
        }),
      });
    } catch (error) {
      return failFrom(res, error, "No se pudieron cargar los vehículos");
    }
  },
);
router.post(
  "/api/drivers/:driverId/vehicles",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(driverVehicleSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const vehicle = await createDriverVehicle({
        driverPublicId: req.params.driverId,
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "driver_vehicle.created",
        entityType: "driver_vehicle",
        entityId: vehicle.id,
        requestId: req.requestId,
        afterData: {
          driverId: vehicle.driverId,
          kind: vehicle.kind,
          serviceModes: vehicle.serviceModes,
          status: vehicle.status,
        },
      });
      return res.status(201).json({ ok: true, requestId: req.requestId, vehicle });
    } catch (error) {
      return failFrom(res, error, "No se pudo registrar el vehículo");
    }
  },
);
router.patch(
  "/api/driver-vehicles/:vehicleId",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(driverVehicleUpdateSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const vehicle = await updateDriverVehicle({
        vehiclePublicId: req.params.vehicleId,
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        changes: parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "driver_vehicle.updated",
        entityType: "driver_vehicle",
        entityId: vehicle.id,
        requestId: req.requestId,
        afterData: {
          kind: vehicle.kind,
          serviceModes: vehicle.serviceModes,
          status: vehicle.status,
        },
      });
      return ok(res, { vehicle });
    } catch (error) {
      return failFrom(res, error, "No se pudo actualizar el vehículo");
    }
  },
);
router.post(
  "/api/driver-vehicles/:vehicleId/activate",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
    try {
      const vehicle = await activateDriverVehicle({
        vehiclePublicId: req.params.vehicleId,
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "driver_vehicle.activated",
        entityType: "driver_vehicle",
        entityId: vehicle.id,
        requestId: req.requestId,
        afterData: { driverId: vehicle.driverId, active: true },
      });
      return ok(res, { vehicle });
    } catch (error) {
      return failFrom(res, error, "No se pudo activar el vehículo");
    }
  },
);
router.delete(
  "/api/driver-vehicles/:vehicleId",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
    try {
      const vehicle = await retireDriverVehicle({
        vehiclePublicId: req.params.vehicleId,
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "driver_vehicle.retired",
        entityType: "driver_vehicle",
        entityId: vehicle.id,
        requestId: req.requestId,
        afterData: { driverId: vehicle.driverId, retiredAt: vehicle.retiredAt },
      });
      return ok(res, { vehicle });
    } catch (error) {
      return failFrom(res, error, "No se pudo retirar el vehículo");
    }
  },
);
router.patch(
  "/api/admin/driver-vehicles/:vehicleId/review",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const parsed = parseOrFail(driverVehicleReviewSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const vehicle = await reviewDriverVehicle({
        vehiclePublicId: req.params.vehicleId,
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: `driver_vehicle.${parsed.data.status}`,
        entityType: "driver_vehicle",
        entityId: vehicle.id,
        requestId: req.requestId,
        afterData: {
          driverId: vehicle.driverId,
          status: vehicle.status,
          rejectionReason: vehicle.rejectionReason,
        },
      });
      return ok(res, { vehicle });
    } catch (error) {
      return failFrom(res, error, "No se pudo revisar el vehículo");
    }
  },
);
