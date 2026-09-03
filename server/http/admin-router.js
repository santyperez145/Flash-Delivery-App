// Lo último que quedaba bajo `/api/admin` (ticket ARC-001, paso 2).
//
// Dos rutas: el tablero que resume la plataforma entera y la moderación de una
// cuenta. Son el resto de un prefijo que este ticket desarmó en siete cortes,
// porque `/api/admin` describía quién mira y no qué mira.
//
// Estas dos sobreviven juntas porque comparten exactamente eso: no tienen un
// dominio propio. El tablero es el agregado de todos los dominios —de ahí que
// `adminSnapshot` sea la función más larga que quedaba en `server/index.js`— y
// la suspensión de una cuenta atraviesa a todos por igual.
//
// El tablero se arma sobre `runtime-snapshot.js`, que comparte con el bootstrap
// y las métricas. Suspender una cuenta publica un evento de tiempo real: quien
// está con sesión abierta tiene que enterarse sin recargar, porque el punto de
// suspender es que deje de operar ahora.
import { Router } from "express";
import { z } from "zod";

import { setPostgresUserStatus, usesPostgresAuth } from "../auth-repository.js";
import { requireAuth } from "./authentication.js";
import { requireAnyRole } from "./authorization.js";
import { getPostgresAdminFinancials, recordPostgresAudit } from "../operations-repository.js";
import {
  releaseJobFromDriver,
  assignJobToDriver,
  setMerchantStatus,
} from "../operations-intervention-repository.js";
import { usesPostgresCommerce, postgresPool } from "../postgres.js";
import { publishRealtimeEvent } from "./realtime.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";
import { average, loadRuntimeState, metrics, ratio } from "../runtime-snapshot.js";
import { getTimestamp } from "../store.js";

// Las dos intervenciones que antes exigian entrar a la base (OPS-001).
//
// **El motivo es obligatorio en las dos, y de al menos cinco caracteres.** Son
// decisiones sobre el registro de un tercero: suspender el ingreso de un
// comercio, o sacarle a un conductor un trabajo que ya habia aceptado. El dia
// del incidente lo que se lee es el log de auditoria, y un log que dice quien
// suspendio a quien sin decir por que obliga a reconstruir el motivo desde otra
// tabla. `test:audit-actor` lo vigila.
const merchantStatusSchema = z.object({
  status: z.enum(["active", "suspended"]),
  reason: z.string().trim().min(5).max(500),
});
const jobReleaseSchema = z.object({ reason: z.string().trim().min(5).max(500) });
const jobAssignSchema = z.object({
  driverId: z.string().trim().min(3).max(100),
  reason: z.string().trim().min(5).max(500),
});

const userStatusSchema = z.object({
  status: z.enum(["active", "suspended"]),
  reason: z.string().trim().min(5).max(240),
});
function adminSnapshot(db, financial = null) {
  const activeOrders = db.orders.filter(
    (order) => !["delivered", "cancelled"].includes(order.status),
  );
  const activeRides = db.rides.filter((ride) => !["completed", "cancelled"].includes(ride.status));
  const grossVolume = [
    ...db.orders.map((order) => order.total),
    ...db.rides.map((ride) => ride.fare),
  ].reduce((sum, value) => sum + value, 0);
  const completedJobs =
    db.orders.filter((order) => order.status === "delivered").length +
    db.rides.filter((ride) => ride.status === "completed").length;
  const cancelledJobs =
    db.orders.filter((order) => order.status === "cancelled").length +
    db.rides.filter((ride) => ride.status === "cancelled").length;
  const totalJobs = db.orders.length + db.rides.length;
  const unassignedOrders = activeOrders.filter((order) => !order.courierId).length;
  const unassignedRides = activeRides.filter((ride) => !ride.driverId).length;
  const recordedGrossVolume = financial?.grossProcessed ?? grossVolume,
    postedPlatformRevenue = financial?.postedPlatformRevenue ?? 0;
  const actualTakeRate = recordedGrossVolume
    ? Number(((postedPlatformRevenue / recordedGrossVolume) * 100).toFixed(2))
    : 0;
  return {
    generatedAt: getTimestamp(),
    metrics: metrics(db),
    marketplace: {
      grossVolume: recordedGrossVolume,
      estimatedPlatformRevenue: postedPlatformRevenue,
      takeRatePercent: actualTakeRate,
      financial,
      averageOrderValue: average(db.orders.map((order) => order.total)),
      averageRideFare: average(db.rides.map((ride) => ride.fare)),
      fillRateDelivery: ratio(
        db.orders.filter((order) => order.courierId).length,
        db.orders.length,
      ),
      fillRateRide: ratio(db.rides.filter((ride) => ride.driverId).length, db.rides.length),
      cancellationRate: ratio(cancelledJobs, totalJobs),
      supplyDemandRatio: Number(
        (
          db.drivers.filter((driver) => driver.online).length /
          Math.max(1, activeOrders.length + activeRides.length)
        ).toFixed(2),
      ),
      unassignedOrders,
      unassignedRides,
      openRestaurants: db.restaurants.filter((restaurant) => restaurant.open).length,
      onlineDrivers: db.drivers.filter((driver) => driver.online).length,
    },
    investor: {
      dataStatus: "operational_only",
      seedTarget: null,
      monthlyBurn: null,
      runwayMonths: null,
      netRevenueRunRate: null,
      contributionMargin: null,
      contributionMarginPercent: null,
      readinessScore: Math.min(
        100,
        Math.round(
          42 +
            ratio(completedJobs, totalJobs) * 0.18 +
            ratio(db.orders.filter((order) => order.courierId).length, db.orders.length) * 0.16 +
            ratio(db.rides.filter((ride) => ride.driverId).length, db.rides.length) * 0.16,
        ),
      ),
      milestones: [
        {
          label: "Producto fullstack",
          status: "done",
          value: "Cliente, comercio, driver y admin",
        },
        {
          label: "Seguridad API",
          status: "done",
          value: "JWT, RBAC, ownership, rate limits",
        },
        {
          label: "Mobile nativo",
          status: "in_progress",
          value: "Expo base para 3 apps",
        },
        {
          label: "Realtime dispatch",
          status: "next",
          value: "SSE/WebSocket + Redis GEO",
        },
        {
          label: "Pagos reales",
          status: "next",
          value: "PSP + ledger financiero",
        },
      ],
      unitEconomics: [
        {
          label: "AOV comida",
          value: `$${average(db.orders.map((order) => order.total))}`,
          detail: "Ticket promedio",
        },
        {
          label: "Fare taxi",
          value: `$${average(db.rides.map((ride) => ride.fare))}`,
          detail: "Tarifa promedio",
        },
        {
          label: "Take rate registrado",
          value: `${actualTakeRate}%`,
          detail: "Revenue posteado / pagos procesados",
        },
        {
          label: "Reintegros",
          value: `$${financial?.refunded ?? 0}`,
          detail: "Refunds confirmados en ledger",
        },
        {
          label: "Revenue cubierto",
          value: financial?.revenueCoverage === "wallet_settlements" ? "Flash Wallet" : "Sin datos",
          detail: "Métodos externos pendientes de conciliación",
        },
        {
          label: "Jobs cumplidos",
          value: String(completedJobs),
          detail: "Pedidos + viajes finalizados",
        },
      ],
    },
    riskSignals: [
      {
        id: "dispatch_backlog",
        level: unassignedOrders + unassignedRides > 2 ? "medium" : "low",
        label: "Backlog de asignacion",
        value: unassignedOrders + unassignedRides,
      },
      {
        id: "support_queue",
        level:
          db.supportTickets.filter((ticket) => ticket.status === "open").length > 5
            ? "high"
            : "low",
        label: "Tickets abiertos",
        value: db.supportTickets.filter((ticket) => ticket.status === "open").length,
      },
      {
        id: "supply",
        level: db.drivers.filter((driver) => driver.online).length < 2 ? "medium" : "low",
        label: "Supply online",
        value: db.drivers.filter((driver) => driver.online).length,
      },
    ],
    zones: db.zones || [],
    recentAuditEvents: (db.auditEvents || []).slice(0, 10),
  };
}

export const adminRouter = Router();
const router = adminRouter;

router.get("/api/admin/dashboard", requireAuth, requireAnyRole("admin"), async (req, res) => {
  ok(res, {
    dashboard: adminSnapshot(
      await loadRuntimeState(req),
      usesPostgresCommerce() ? await getPostgresAdminFinancials() : null,
    ),
  });
});

router.patch(
  "/api/admin/users/:userId/status",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    if (!usesPostgresAuth()) return fail(res, 503, "La moderación de cuentas requiere PostgreSQL");
    const parsed = parseOrFail(userStatusSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const moderation = await setPostgresUserStatus({
        targetPublicId: req.params.userId,
        actorPublicId: req.auth.userId,
        actorRoles: req.auth.roles,
        requestId: req.requestId,
        ...parsed.data,
      });
      await publishRealtimeEvent({
        req,
        type: "user.status.updated",
        entityType: "user",
        entityId: req.params.userId,
        action: parsed.data.status === "active" ? "user.reactivated" : "user.suspended",
      });
      return ok(res, { moderation });
    } catch (error) {
      return failFrom(res, error, "No se pudo cambiar el estado de la cuenta");
    }
  },
);

/**
 * Suspender o reactivar un comercio (OPS-001).
 *
 * `merchants.status` existía y cuarenta y una consultas lo respetaban; ninguna
 * ruta lo escribía. Suspender un local —intoxicación, fraude, un comercio que
 * acepta y no cocina— se hacía con un `UPDATE` a mano.
 *
 * **Suspender frena lo nuevo y no cancela lo que está en curso.** La respuesta
 * dice cuántos pedidos quedaron abiertos, porque es lo que decide qué hace el
 * operador después: con doce hay que avisarle a soporte, con cero no hay nada
 * más que hacer.
 */
router.patch(
  "/api/admin/merchants/:merchantId/status",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "La suspensión de comercios requiere PostgreSQL");
    const parsed = parseOrFail(merchantStatusSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const merchant = await setMerchantStatus({
        merchantPublicId: req.params.merchantId,
        status: parsed.data.status,
        reason: parsed.data.reason,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "merchant.status_changed",
        entityType: "merchant",
        entityId: merchant.id,
        requestId: req.requestId,
        beforeData: { status: merchant.previousStatus },
        afterData: {
          status: merchant.status,
          reason: parsed.data.reason,
          openJobs: merchant.openJobs,
        },
      });
      return ok(res, { merchant });
    } catch (error) {
      return failFrom(res, error, "No se pudo cambiar el estado del comercio");
    }
  },
);

/**
 * Devolver un trabajo asignado al despacho (OPS-001).
 *
 * Un teléfono que se apaga, una moto que se rompe, alguien que aceptó y
 * desapareció: el trabajo quedaba con conductor puesto y sin forma de volver a
 * ofrecerlo. **Sólo antes de retirar** — después el conductor tiene la comida
 * encima, y ahí la salida es cancelar con su política o abrir una incidencia,
 * no reasignar.
 */
router.post(
  "/api/admin/jobs/:jobId/release",
  requireAuth,
  requireAnyRole("admin", "support"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "La intervención de despacho requiere PostgreSQL");
    const parsed = parseOrFail(jobReleaseSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const job = await releaseJobFromDriver({
        jobPublicId: req.params.jobId,
        reason: parsed.data.reason,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "dispatch.job_released",
        entityType: "job",
        entityId: job.id,
        requestId: req.requestId,
        beforeData: { driverId: job.releasedFrom },
        afterData: { status: job.status, reason: parsed.data.reason },
      });
      return ok(res, { job });
    } catch (error) {
      return failFrom(res, error, "No se pudo soltar el servicio");
    }
  },
);

/**
 * Asignación manual desde backoffice (DSP-001).
 *
 * Cuando el auto-despacho agota oleadas o hay una escalación, operaciones fuerza
 * un courier concreto. Misma frontera que el worker: comida listo para retirar,
 * viajes/envíos en `requested`, capacidad y vehículo aprobado. Motivo obligatorio.
 */
router.post(
  "/api/admin/jobs/:jobId/assign",
  requireAuth,
  requireAnyRole("admin", "support"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "La intervención de despacho requiere PostgreSQL");
    const parsed = parseOrFail(jobAssignSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const actor = (
        await postgresPool.query("SELECT id FROM users WHERE public_id=$1", [req.auth.userId])
      ).rows[0];
      const job = await assignJobToDriver({
        jobPublicId: req.params.jobId,
        driverPublicId: parsed.data.driverId,
        reason: parsed.data.reason,
        actorUserId: actor?.id || null,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "dispatch.job_assigned",
        entityType: "job",
        entityId: job.id,
        requestId: req.requestId,
        beforeData: { driverId: null },
        afterData: {
          status: job.status,
          driverId: job.assignedTo,
          reason: parsed.data.reason,
        },
      });
      return ok(res, { job });
    } catch (error) {
      return failFrom(res, error, "No se pudo asignar el servicio");
    }
  },
);
