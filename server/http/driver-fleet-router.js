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
import { auditRuntime } from "../audit-trail.js";
import { canActAsDriver } from "./authorization.js";
import {
  assertDriverCanGoOnline,
  getDriverCompliance,
  getDriverDocumentContent,
  reviewDriverDocument,
  submitDriverDocument,
} from "../compliance-repository.js";
import { getPostgresDrivers, updatePostgresDriver } from "../driver-roster-repository.js";
import { readDb } from "../fallback-runtime.js";
import { coordinateSchema } from "../geo.js";
import { usesPostgresCommerce } from "../postgres.js";
import { publishRealtimeEvent } from "./realtime.js";
import { getTimestamp } from "../store.js";
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

const driverLocationSchema = coordinateSchema.extend({
  label: z.string().trim().min(2).max(120).optional(),
  source: z.enum(["foreground", "background"]).optional(),
  accuracyM: z.coerce.number().min(0).max(1000).optional(),
});
const driverDocumentSchema = z
  .object({
    type: z.enum([
      "identity",
      "driver_license",
      "vehicle_registration",
      "insurance",
      "background_check",
    ]),
    mimeType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
    contentBase64: z.string().min(4).max(1000000),
    expiresAt: z.string().date().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      ["driver_license", "vehicle_registration", "insurance"].includes(value.type) &&
      !value.expiresAt
    )
      ctx.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "El vencimiento es obligatorio",
      });
    if (value.expiresAt && new Date(`${value.expiresAt}T23:59:59Z`) < new Date())
      ctx.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "El documento está vencido",
      });
  });
const driverDocumentReviewSchema = z
  .object({
    status: z.enum(["approved", "rejected"]),
    rejectionReason: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === "rejected" && (!value.rejectionReason || value.rejectionReason.length < 5))
      ctx.addIssue({
        code: "custom",
        path: ["rejectionReason"],
        message: "Explica el rechazo",
      });
  });

export const driverFleetRouter = Router();
const router = driverFleetRouter;

router.get(
  "/api/drivers/:driverId/vehicles",
  requireAuth,
  requireAnyRole("driver", "support", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "La flota del conductor requiere PostgreSQL");
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

// La aptitud para trabajar: legajo, disponibilidad y posición.
//
// Llegó acá con la extracción del conductor y ensancha lo que este archivo
// cubre, de «el vehículo» a «si puede trabajar y dónde está». No es una mezcla:
// `assertDriverCanGoOnline` consulta en la misma sentencia el estado del legajo
// y el del vehículo, así que conectarse depende de las dos cosas a la vez. Con
// los documentos en otro archivo, las dos entradas de esa puerta quedarían
// separadas de la puerta.
//
// La revisión del documento cuelga de `/api/admin` y vive igual acá, por la
// misma razón que la revisión del vehículo: partir por el prefijo de la URL
// rompería en dos una sola máquina de estados.
//
// El contenido del documento se sirve por ruta propia y con su identificador.
// Un DNI en base64 dentro del JSON del legajo queda en cada caché del camino, y
// es el documento más sensible que la plataforma guarda.
router.patch(
  "/api/drivers/:driverId/availability",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
    const db = usesPostgresCommerce() ? {} : readDb();
    let driver = usesPostgresCommerce()
      ? (await getPostgresDrivers()).find((entry) => entry.id === req.params.driverId)
      : db.drivers.find((entry) => entry.id === req.params.driverId);
    if (!driver) return fail(res, 404, "Conductor no encontrado");
    if (!canActAsDriver(req, driver.id))
      return fail(res, 403, "No puedes gestionar otro conductor");
    const body = req.body || {};
    if (usesPostgresCommerce()) {
      if (
        body.online === true ||
        (driver.online && body.activeService && body.activeService !== driver.activeService)
      )
        try {
          await assertDriverCanGoOnline(driver.id, body.activeService || driver.activeService);
        } catch (error) {
          // El 409 explica por qué no puede ponerse en línea —documentación vencida,
          // vehículo sin habilitar— y ese mensaje es parte del contrato con la app.
          return failFrom(res, error, "No se pudo habilitar el turno");
        }
      driver = await updatePostgresDriver(driver.id, body);
    } else {
      if (typeof body.online === "boolean") driver.online = body.online;
      if (driver.serviceModes.includes(body.activeService))
        driver.activeService = body.activeService;
    }
    await auditRuntime(db, req, "driver", driver.id, "driver.availability_updated", {
      online: driver.online,
      activeService: driver.activeService,
    });
    await publishRealtimeEvent({
      req,
      type: "driver.updated",
      entityType: "driver",
      entityId: driver.id,
      action: "driver.availability_updated",
    });
    return ok(res, { driver });
  },
);

router.get(
  "/api/drivers/:driverId/compliance",
  requireAuth,
  requireAnyRole("driver", "support", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "El legajo del conductor requiere PostgreSQL");
    try {
      return ok(res, {
        compliance: await getDriverCompliance({
          actorPublicId: req.auth.userId,
          roles: req.auth.roles,
          driverPublicId: req.params.driverId,
        }),
      });
    } catch (error) {
      return failFrom(res, error, "No se pudo cargar el legajo");
    }
  },
);
router.post(
  "/api/drivers/:driverId/documents",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(driverDocumentSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const document = await submitDriverDocument({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        driverPublicId: req.params.driverId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "driver_document.submitted",
        entityType: "driver_document",
        entityId: document.id,
        requestId: req.requestId,
        afterData: {
          driverId: req.params.driverId,
          type: document.type,
          mimeType: document.mimeType,
          sha256: document.sha256,
          sizeBytes: document.sizeBytes,
          expiresAt: document.expiresAt,
        },
      });
      return res.status(201).json({ ok: true, requestId: req.requestId, document });
    } catch (error) {
      return failFrom(res, error, "No se pudo enviar el documento");
    }
  },
);
router.get(
  "/api/driver-documents/:documentId/content",
  requireAuth,
  requireAnyRole("driver", "support", "admin"),
  async (req, res) => {
    try {
      const result = await getDriverDocumentContent({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        documentPublicId: req.params.documentId,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "driver_document.viewed",
        entityType: "driver_document",
        entityId: req.params.documentId,
        requestId: req.requestId,
        afterData: {
          mimeType: result.document.mimeType,
          sizeBytes: result.document.sizeBytes,
        },
      });
      return ok(res, result);
    } catch (error) {
      return failFrom(res, error, "No se pudo leer el documento");
    }
  },
);
router.patch(
  "/api/admin/driver-documents/:documentId/review",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const parsed = parseOrFail(driverDocumentReviewSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const compliance = await reviewDriverDocument({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        documentPublicId: req.params.documentId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: `driver_document.${parsed.data.status}`,
        entityType: "driver_document",
        entityId: req.params.documentId,
        requestId: req.requestId,
        afterData: {
          driverId: compliance.driverId,
          status: parsed.data.status,
          rejectionReason: parsed.data.rejectionReason || null,
        },
      });
      return ok(res, { compliance });
    } catch (error) {
      return failFrom(res, error, "No se pudo revisar el documento");
    }
  },
);

router.patch(
  "/api/drivers/:driverId/location",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(driverLocationSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    const db = usesPostgresCommerce() ? {} : readDb();
    let driver = usesPostgresCommerce()
      ? (await getPostgresDrivers()).find((entry) => entry.id === req.params.driverId)
      : db.drivers.find((entry) => entry.id === req.params.driverId);
    if (!driver) return fail(res, 404, "Conductor no encontrado");
    if (!canActAsDriver(req, driver.id))
      return fail(res, 403, "No puedes actualizar otro conductor");
    const { lat, lng, label, source, accuracyM } = parsed.data;
    if (usesPostgresCommerce()) {
      driver = await updatePostgresDriver(driver.id, {
        lat,
        lng,
        label: label || driver.location.label || "Ubicacion GPS",
        source: source || "foreground",
        accuracyM,
      });
    } else {
      driver.location = {
        lat,
        lng,
        label: label || driver.location.label || "Ubicacion GPS",
        updatedAt: getTimestamp(),
        source: source || "foreground",
        accuracyM: accuracyM ?? null,
      };
    }
    await publishRealtimeEvent({
      req,
      type: "driver.location.updated",
      entityType: "driver",
      entityId: driver.id,
      action: "driver.location_updated",
    });
    return ok(res, { driver });
  },
);
