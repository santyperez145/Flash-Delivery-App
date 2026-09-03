// El conductor mirando lo suyo (ticket ARC-001, paso 2).
//
// Ocho rutas: su perfil, lo que ganó, dónde hay demanda, sus preferencias y las
// ofertas de trabajo que puede rechazar.
//
// Se separa de `driver-fleet-router.js`, que tiene el otro lado del mismo
// conductor: papeles, vehículo y disponibilidad, es decir **si puede trabajar**.
// Acá está lo que hace con esa habilitación una vez que la tiene. La primera es
// una máquina de estados con revisión administrativa; ésta es una lectura de su
// propia situación.
//
// `GET /api/me/assigned-drivers` viaja con este grupo aunque cuelgue de
// `/api/me`: lo que devuelve es qué conductores tiene asignados quien pregunta,
// y eso es el mismo dato leído desde el otro extremo.
//
// Las preferencias acotan qué trabajo se le ofrece —modos de servicio, radio,
// horarios—. Por eso el `PATCH` audita: un conductor que deja de recibir
// ofertas necesita poder reconstruir si fue por un cambio suyo, y cuándo.
import { Router } from "express";
import { z } from "zod";

import { getAssignedDriverProjections } from "../activity-repository.js";
import { auditRuntime } from "../audit-trail.js";
import { requireAuth } from "./authentication.js";
import { isAdmin, requireAnyRole } from "./authorization.js";
import { getPostgresDispatchOffers, rejectPostgresDispatchOffer } from "../dispatch-repository.js";
import { getDriverDemandZones } from "../driver-demand-repository.js";
import { getDriverPreferences, updateDriverPreferences } from "../driver-preference-repository.js";
import { getPostgresDriverForUser } from "../driver-roster-repository.js";
import { readDb, scopeStateForRequest } from "../fallback-runtime.js";
import { recordPostgresAudit } from "../audit-repository.js";
import { usesPostgresCommerce } from "../postgres.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";
import { getPublicState, getTimestamp, writeDb } from "../store.js";
import { getDriverEarnings } from "../wallet-repository.js";

const driverPreferenceSchema = z.object({
  navigationProvider: z.enum(["system", "google_maps", "apple_maps"]),
});

export const driverRouter = Router();
const router = driverRouter;

router.get("/api/driver/me", requireAuth, requireAnyRole("driver"), async (req, res) => {
  try {
    const driver = usesPostgresCommerce()
      ? await getPostgresDriverForUser(req.auth.userId)
      : readDb().drivers.find((entry) => entry.userId === req.auth.userId) || null;
    if (!driver) return fail(res, 404, "Perfil de conductor no encontrado");
    res.set("Cache-Control", "no-store, private");
    return ok(res, { driver });
  } catch (error) {
    return failFrom(res, error, "No se pudo cargar el perfil del conductor");
  }
});

router.get("/api/driver/earnings", requireAuth, requireAnyRole("driver"), async (req, res) => {
  try {
    if (!usesPostgresCommerce()) {
      const db = readDb(),
        driver = db.drivers.find((entry) => entry.userId === req.auth.userId);
      if (!driver) return fail(res, 404, "Perfil de conductor no encontrado");
      const user = db.users.find((entry) => entry.id === driver.userId),
        now = new Date(),
        dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      const weekStart = new Date(dayStart);
      weekStart.setDate(dayStart.getDate() - ((dayStart.getDay() + 6) % 7));
      const entries = (db.walletTransactions || [])
        .filter(
          (entry) =>
            entry.userId === driver.userId &&
            /^(Ganancia|Propina|Ajuste de propina)\b/i.test(entry.description || ""),
        )
        .map((entry) => ({
          id: entry.id,
          category: /^Propina/i.test(entry.description)
            ? "tip"
            : /^Ajuste/i.test(entry.description)
              ? "adjustment"
              : /viaje/i.test(entry.description)
                ? "ride"
                : /envio/i.test(entry.description)
                  ? "shipment"
                  : "food",
          jobId: null,
          description: entry.description,
          amount: entry.kind === "debit" ? -Number(entry.amount) : Number(entry.amount),
          createdAt: entry.createdAt,
        }));
      const summarize = (start, end) => {
        const scoped = entries.filter(
          (entry) => new Date(entry.createdAt) >= start && new Date(entry.createdAt) < end,
        );
        return {
          amount: scoped.reduce((sum, entry) => sum + entry.amount, 0),
          serviceEarnings: scoped
            .filter((entry) => !["tip", "adjustment"].includes(entry.category))
            .reduce((sum, entry) => sum + entry.amount, 0),
          tips: scoped
            .filter((entry) => entry.category === "tip")
            .reduce((sum, entry) => sum + entry.amount, 0),
          adjustments: scoped
            .filter((entry) => entry.category === "adjustment")
            .reduce((sum, entry) => sum + entry.amount, 0),
          services: scoped.filter((entry) => !["tip", "adjustment"].includes(entry.category))
            .length,
          onlineSeconds: null,
          activeSeconds: null,
          periodStart: start.toISOString(),
          periodEnd: end.toISOString(),
        };
      };
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const days = [];
      for (
        let cursor = new Date(weekStart);
        cursor <= dayStart;
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
      ) {
        const end = new Date(cursor);
        end.setDate(end.getDate() + 1);
        const summary = summarize(cursor, end);
        days.push({
          date: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`,
          amount: summary.amount,
          serviceEarnings: summary.serviceEarnings,
          tips: summary.tips,
          adjustments: summary.adjustments,
          services: summary.services,
          onlineSeconds: null,
          activeSeconds: null,
        });
      }
      res.set("Cache-Control", "no-store, private");
      return ok(res, {
        earnings: {
          driverId: driver.id,
          currency: "ARS",
          timezone: "America/Argentina/Buenos_Aires",
          source: "sqlite-test-fallback",
          walletBalance: Number(user?.wallet || 0),
          today: summarize(dayStart, dayEnd),
          week: summarize(weekStart, weekEnd),
          days,
          recent: entries.slice(0, 100),
          timeTracking: { status: "unavailable", reason: "postgres_required" },
          cashout: { status: "not_configured", reason: "external_payout_provider_required" },
        },
      });
    }
    const earnings = await getDriverEarnings(req.auth.userId);
    if (!earnings) return fail(res, 404, "Perfil de conductor no encontrado");
    res.set("Cache-Control", "no-store, private");
    return ok(res, { earnings });
  } catch (error) {
    return failFrom(res, error, "No se pudieron cargar las ganancias");
  }
});

router.get("/api/driver/demand-zones", requireAuth, requireAnyRole("driver"), async (req, res) => {
  if (!usesPostgresCommerce())
    return fail(res, 503, "La demanda por zonas requiere PostgreSQL/PostGIS");
  try {
    const demand = await getDriverDemandZones(req.auth.userId);
    if (!demand) return fail(res, 404, "Perfil de conductor no encontrado");
    res.set("Cache-Control", "no-store, private");
    return ok(res, { demand });
  } catch (error) {
    return failFrom(res, error, "No se pudo calcular la demanda por zonas");
  }
});

router.get("/api/driver/preferences", requireAuth, requireAnyRole("driver"), async (req, res) => {
  try {
    const preferences = usesPostgresCommerce()
      ? await getDriverPreferences(req.auth.userId)
      : (() => {
          const driver = readDb().drivers.find((entry) => entry.userId === req.auth.userId);
          return driver
            ? {
                driverId: driver.id,
                navigationProvider: driver.navigationProvider || "system",
                updatedAt: null,
              }
            : null;
        })();
    if (!preferences) return fail(res, 404, "Perfil de conductor no encontrado");
    res.set("Cache-Control", "no-store, private");
    return ok(res, { preferences });
  } catch (error) {
    return failFrom(res, error, "No se pudieron cargar las preferencias");
  }
});

router.patch("/api/driver/preferences", requireAuth, requireAnyRole("driver"), async (req, res) => {
  const parsed = parseOrFail(driverPreferenceSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    let preferences;
    if (usesPostgresCommerce())
      preferences = await updateDriverPreferences({
        actorPublicId: req.auth.userId,
        ...parsed.data,
      });
    else {
      const db = readDb(),
        driver = db.drivers.find((entry) => entry.userId === req.auth.userId);
      if (driver) {
        driver.navigationProvider = parsed.data.navigationProvider;
        writeDb(db);
        preferences = {
          driverId: driver.id,
          navigationProvider: driver.navigationProvider,
          updatedAt: getTimestamp(),
        };
      }
    }
    if (!preferences) return fail(res, 404, "Perfil de conductor no encontrado");
    await auditRuntime(
      usesPostgresCommerce() ? {} : readDb(),
      req,
      "driver",
      preferences.driverId,
      "driver.preferences_updated",
      { navigationProvider: preferences.navigationProvider },
    );
    res.set("Cache-Control", "no-store, private");
    return ok(res, { preferences });
  } catch (error) {
    return failFrom(res, error, "No se pudieron actualizar las preferencias");
  }
});

router.get(
  "/api/me/assigned-drivers",
  requireAuth,
  requireAnyRole("customer", "merchant"),
  async (req, res) => {
    try {
      const drivers = usesPostgresCommerce()
        ? await getAssignedDriverProjections({
            userPublicId: req.auth.userId,
            roles: req.auth.roles,
          })
        : scopeStateForRequest(getPublicState(), req).drivers.map(
            ({ id, name, rating, vehicle, plate, vehicleKind, location }) => ({
              id,
              name,
              rating,
              vehicle,
              plate,
              vehicleKind,
              location,
            }),
          );
      res.set("Cache-Control", "no-store, private");
      return ok(res, { drivers });
    } catch (error) {
      return failFrom(res, error, "No se pudieron cargar los conductores asignados");
    }
  },
);

router.get(
  "/api/driver/offers",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "Las ofertas de despacho requieren PostgreSQL");
    const driverId = isAdmin(req)
      ? String(req.query.driverId || req.auth.user.driverId || "")
      : req.auth.user.driverId;
    if (!driverId) return fail(res, 400, "Falta el conductor");
    try {
      return ok(res, { offers: await getPostgresDispatchOffers(driverId) });
    } catch (_error) {
      return fail(res, 500, "No se pudieron cargar las ofertas");
    }
  },
);
router.post(
  "/api/driver/offers/:offerId/reject",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
    const driverId = isAdmin(req)
      ? String(req.body?.driverId || req.auth.user.driverId || "")
      : req.auth.user.driverId;
    if (!driverId) return fail(res, 400, "Falta el conductor");
    try {
      await rejectPostgresDispatchOffer({
        driverPublicId: driverId,
        offerPublicId: req.params.offerId,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "dispatch_offer.rejected",
        entityType: "dispatch_offer",
        entityId: req.params.offerId,
        requestId: req.requestId,
      });
      return ok(res, { rejected: true });
    } catch (error) {
      return failFrom(res, error, "No se pudo rechazar la oferta");
    }
  },
);
