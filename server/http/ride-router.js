// El viaje de punta a punta: cotizar, pedir, asignar, llevar y llegar
// (ticket ARC-001, paso 2).
//
// Todo el dominio de movilidad de pasajeros en un archivo. Estaba repartido en
// cinco tramos de `server/index.js` separados por pedidos, envíos y mapas, y
// sus ayudantes vivían cuatrocientas líneas más arriba que las rutas que los
// usaban.
//
// Viaja completo el cálculo de tarifa —`calculateRideQuote`, el catálogo de
// categorías y las opciones— porque la cotización es lo único que el viaje
// promete antes de existir. Un viaje que se cobra distinto de lo cotizado es el
// peor defecto posible de este dominio, así que la cotización se firma: el
// token JWT lleva el precio y `POST /api/rides` compara contra él.
//
// La seguridad del viaje va acá y no en un router aparte. El enlace público de
// seguimiento, el incidente, el código de retiro y su verificación son el mismo
// viaje mirado por quien se preocupa: separarlos dejaría el incidente sin el
// estado del viaje que lo explica.
//
// `GET /api/public/rides/track/:token` es la única ruta sin autenticación del
// grupo. El token es la credencial —40 a 64 caracteres, validados antes de
// tocar la base— y por eso la respuesta devuelve 404 tanto si el enlace no
// existe como si venció: distinguirlos le diría a quien prueba tokens cuáles
// existieron.
import jwt from "jsonwebtoken";
import { Router } from "express";
import { z } from "zod";

import { auditRuntime } from "../audit-trail.js";
import { findAuthUserByPublicId, usesPostgresAuth } from "../auth-repository.js";
import { config } from "../config.js";
import { coordinateSchema, distanceBetween } from "../geo.js";
import { requireAuth } from "./authentication.js";
import {
  canActAsCustomer,
  canActAsDriver,
  canAdvanceRide,
  canMutateRideStatus,
  requireAnyRole,
} from "./authorization.js";
import { cancellationSchema } from "./cancellation.js";
import { getPostgresPricingPlan, getPostgresZonePricing } from "../configuration-repository.js";
import { creditDriverEarningsRuntime } from "../driver-earnings.js";
import { getPostgresDrivers } from "../driver-roster-repository.js";
import { addTimeline, fallbackRidePricing, readDb } from "../fallback-runtime.js";
import {
  createPostgresRide,
  getPostgresRides,
  setPostgresRideStatus,
} from "../mobility-repository.js";
import { recordPostgresAudit } from "../operations-repository.js";
import { usesPostgresCommerce } from "../postgres.js";
import { validarHorarioProgramado } from "../scheduling.js";
import { deliveryProofLimiter } from "./rate-limits.js";
import { publishRealtimeEvent } from "./realtime.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";
import {
  createRideSafetyIncident,
  createRideTrackingLink,
  getPublicRideTracking,
  getRidePickupCode,
  revokeRideTrackingLink,
  verifyRidePickupCode,
} from "../ride-safety-repository.js";
import { assessTransactionRisk, setRiskEntity } from "../risk-repository.js";
import { createId, createLocalNotification, getTimestamp, rideStatuses } from "../store.js";
import { cancelMobilityJobAndRefundWallet } from "../wallet-repository.js";

const rideQuoteSchema = z.object({
  pickup: z.string().min(3, "Origen obligatorio"),
  destination: z.string().min(3, "Destino obligatorio"),
  service: z.enum(["economy", "comfort", "moto", "xl"]).default("economy"),
  pickupCoords: coordinateSchema.nullable().optional(),
  destinationCoords: coordinateSchema.nullable().optional(),
});

const rideCreateSchema = rideQuoteSchema.extend({
  customerId: z.string().min(1),
  paymentMethod: z.string().min(2),
  quoteToken: z.string().min(20).optional(),
  scheduledFor: z.string().datetime().optional(),
});
const rideTrackingCreateSchema = z.object({
  ttlMinutes: z.coerce.number().int().min(15).max(1440).default(180),
});
const rideSafetyIncidentSchema = z.object({
  type: z.enum(["sos", "unsafe_driving", "medical", "harassment", "crash", "other"]),
  details: z.string().trim().max(1000).optional(),
  location: z
    .object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
    })
    .optional(),
});
const ridePickupVerificationSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "El PIN debe tener 4 dígitos"),
});
const rideLabels = {
  requested: "Buscando conductor",
  driver_assigned: "Conductor asignado",
  arriving: "Llegando al punto",
  in_progress: "Viaje iniciado",
  completed: "Completado",
  cancelled: "Cancelado",
};

function calculateRideQuote(
  {
    pickup,
    destination,
    service = "economy",
    pickupCoords,
    destinationCoords,
    demandMultiplier = 1,
  },
  pricing = fallbackRidePricing,
) {
  const normalizedService = ["economy", "comfort", "moto", "xl"].includes(service)
    ? service
    : "economy";
  const rules = pricing.config,
    serviceMultiplier = Number(rules.serviceMultipliers[normalizedService]);
  const textWeight = `${pickup || ""}${destination || ""}`.length;
  const coordinateDistance = distanceBetween(pickupCoords, destinationCoords);
  const distanceKm =
    coordinateDistance !== null
      ? Math.max(
          rules.minDistanceKm,
          Math.min(rules.maxDistanceKm, coordinateDistance * rules.roadFactor),
        )
      : Math.max(2.4, Math.min(28, 2.2 + (textWeight % 19) * 0.72));
  const durationMin = Math.round(rules.durationBaseMin + distanceKm * rules.durationPerKm);
  const baseFare = Number(rules.baseFare);
  const distanceFare = Math.round(distanceKm * rules.distancePerKm);
  const timeFare = Math.round(durationMin * rules.timePerMin);
  const serviceFee = Number(rules.serviceFee);
  const tolls = distanceKm > rules.tollThresholdKm ? Number(rules.tollAmount) : 0;
  const subtotal = Math.round((baseFare + distanceFare + timeFare) * serviceMultiplier);
  const demandAdjustment = Math.round(subtotal * (demandMultiplier - 1));
  const fare = Math.round(subtotal + demandAdjustment + serviceFee + tolls);
  return {
    service: normalizedService,
    distanceKm: Number(distanceKm.toFixed(1)),
    etaMin: Math.max(3, Math.round(rules.etaBaseMin + distanceKm * rules.etaPerKm)),
    durationMin,
    fare,
    breakdown: {
      baseFare,
      distanceFare,
      timeFare,
      serviceFee,
      tolls,
      demandAdjustment,
      demandMultiplier,
      serviceMultiplier,
    },
    pricingVersion: pricing.version,
    estimated: coordinateDistance === null,
    routingMode: coordinateDistance === null ? "text-estimate" : "coordinates",
  };
}

const rideServiceCatalog = {
  moto: { label: "Flash Moto", capacity: 1, description: "La opcion mas agil" },
  economy: { label: "Flash", capacity: 4, description: "Precio accesible" },
  comfort: {
    label: "Flash Comfort",
    capacity: 4,
    description: "Autos con mejor calificacion",
  },
  xl: {
    label: "Flash XL",
    capacity: 6,
    description: "Mas lugar para tu grupo",
  },
};

function calculateRideOptions(db, input, zoneMultiplier = 1, pricing = fallbackRidePricing) {
  const eligibleDrivers = db.drivers.filter(
    (driver) =>
      driver.online &&
      driver.serviceModes.includes("ride") &&
      !db.rides.some(
        (ride) => ride.driverId === driver.id && !["completed", "cancelled"].includes(ride.status),
      ),
  );
  const activeDemand = db.rides.filter((ride) =>
    ["requested", "driver_assigned", "arriving"].includes(ride.status),
  ).length;
  const demandRatio = activeDemand / Math.max(1, eligibleDrivers.length);
  const demandMultiplier = Math.max(
    zoneMultiplier,
    demandRatio > 3 ? 1.35 : demandRatio > 2 ? 1.22 : demandRatio > 1 ? 1.1 : 1,
  );
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  return ["economy", "comfort", "moto", "xl"].map((service) => {
    const quote = calculateRideQuote({ ...input, service, demandMultiplier }, pricing);
    const nearestDistance = eligibleDrivers.reduce((nearest, driver) => {
      const distance = distanceBetween(driver.location, input.pickupCoords);
      return distance === null ? nearest : Math.min(nearest, distance);
    }, Number.POSITIVE_INFINITY);
    const pickupEtaMin = Number.isFinite(nearestDistance)
      ? Math.max(2, Math.round(nearestDistance * 2.6))
      : quote.etaMin;
    const quoteId = createId("QUOTE");
    const quoteToken = jwt.sign(
      {
        kind: "ride_quote",
        quoteId,
        service,
        fare: quote.fare,
        breakdown: quote.breakdown,
        pricingVersion: quote.pricingVersion,
        pickup: input.pickup,
        destination: input.destination,
        pickupCoords: input.pickupCoords,
        destinationCoords: input.destinationCoords,
      },
      jwtSecret,
      { expiresIn: "5m" },
    );
    return {
      ...quote,
      ...rideServiceCatalog[service],
      pickupEtaMin,
      availableDrivers: eligibleDrivers.length,
      available: eligibleDrivers.length > 0,
      quoteId,
      quoteToken,
      expiresAt,
    };
  });
}

function assignRideDriver(db, ride) {
  const candidates = db.drivers
    .filter(
      (entry) =>
        entry.online &&
        entry.serviceModes.includes("ride") &&
        !db.rides.some(
          (candidate) =>
            candidate.driverId === entry.id &&
            !["completed", "cancelled"].includes(candidate.status),
        ),
    )
    .map((driver) => ({
      driver,
      distance: distanceBetween(driver.location, ride.pickupLocation) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => left.distance - right.distance);
  const driver = candidates[0]?.driver;
  if (!driver) return ride;
  return {
    ...ride,
    driverId: driver.id,
    status: "driver_assigned",
    timeline: [...ride.timeline, { status: "driver_assigned", at: getTimestamp() }],
  };
}

function nextRideStatus(ride) {
  if (ride.status === "driver_assigned") return "arriving";
  if (ride.status === "arriving") return "in_progress";
  if (ride.status === "in_progress") return "completed";
  return null;
}

const jwtSecret = config.jwtSecret;

export const rideRouter = Router();
const router = rideRouter;

router.get("/api/public/rides/track/:token", async (req, res) => {
  const token = String(req.params.token || "");
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return fail(res, 404, "El enlace no existe o venció");
  try {
    res.set("Cache-Control", "no-store, private");
    return ok(res, { tracking: await getPublicRideTracking(token) });
  } catch (error) {
    return failFrom(res, error, "No se pudo consultar el viaje");
  }
});
router.post(
  "/api/rides/:rideId/tracking-links",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(rideTrackingCreateSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const link = await createRideTrackingLink({
        ridePublicId: req.params.rideId,
        userPublicId: req.auth.userId,
        ttlMinutes: parsed.data.ttlMinutes,
      });
      const trackingUrl = `${config.appPublicUrl.replace(/\/$/, "")}/track/${link.token}`;
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "ride.tracking_link_created",
        entityType: "ride",
        entityId: req.params.rideId,
        requestId: req.requestId,
        afterData: { linkId: link.id, expiresAt: link.expiresAt },
      });
      return res.status(201).json({
        ok: true,
        requestId: req.requestId,
        link: { id: link.id, trackingUrl, expiresAt: link.expiresAt },
      });
    } catch (error) {
      return failFrom(res, error, "No se pudo compartir el viaje");
    }
  },
);
router.delete(
  "/api/rides/:rideId/tracking-links/:linkId",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    try {
      const result = await revokeRideTrackingLink({
        ridePublicId: req.params.rideId,
        linkPublicId: req.params.linkId,
        userPublicId: req.auth.userId,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "ride.tracking_link_revoked",
        entityType: "ride",
        entityId: req.params.rideId,
        requestId: req.requestId,
        afterData: { linkId: req.params.linkId },
      });
      return ok(res, result);
    } catch (error) {
      return failFrom(res, error, "No se pudo revocar el enlace");
    }
  },
);
router.post(
  "/api/rides/:rideId/safety-incidents",
  requireAuth,
  requireAnyRole("customer", "driver", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(rideSafetyIncidentSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const incident = await createRideSafetyIncident({
        ridePublicId: req.params.rideId,
        userPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "ride.safety_incident_created",
        entityType: "ride",
        entityId: req.params.rideId,
        requestId: req.requestId,
        afterData: { incidentId: incident.id, type: incident.type },
      });
      await publishRealtimeEvent({
        req,
        type: "ride.safety",
        entityType: "ride",
        entityId: req.params.rideId,
        action: "ride.safety_incident_created",
      });
      return res.status(201).json({ ok: true, requestId: req.requestId, incident });
    } catch (error) {
      return failFrom(res, error, "No se pudo activar Seguridad Flash");
    }
  },
);
router.get(
  "/api/rides/:rideId/pickup-code",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    try {
      return ok(
        res,
        await getRidePickupCode({
          ridePublicId: req.params.rideId,
          userPublicId: req.auth.userId,
        }),
      );
    } catch (error) {
      return failFrom(res, error, "No se pudo consultar el PIN de retiro");
    }
  },
);
router.post(
  "/api/rides/:rideId/verify-pickup",
  deliveryProofLimiter,
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(ridePickupVerificationSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const verification = await verifyRidePickupCode({
        ridePublicId: req.params.rideId,
        userPublicId: req.auth.userId,
        pin: parsed.data.pin,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "ride.pickup_verified",
        entityType: "ride",
        entityId: req.params.rideId,
        requestId: req.requestId,
        afterData: { verifiedAt: verification.verifiedAt },
      });
      await publishRealtimeEvent({
        req,
        type: "ride.updated",
        entityType: "ride",
        entityId: req.params.rideId,
        action: "ride.pickup_verified",
      });
      return ok(res, { verification });
    } catch (error) {
      // El repositorio adjunta cuántos intentos quedan antes del bloqueo, y se
      // dice en el mensaje igual que en la verificación de PIN de envío. Antes
      // viajaba como cuarto argumento de `fail`, que sólo toma tres: el dato se
      // descartaba en silencio y el pasajero nunca supo cuántos le quedaban.
      const restantes = error.attemptsRemaining;
      return failFrom(
        res,
        restantes === undefined
          ? error
          : { status: error.status, message: `${error.message}. Quedan ${restantes} intentos` },
        "No se pudo verificar el pasajero",
      );
    }
  },
);

router.post("/api/rides/quote", async (req, res) => {
  const parsed = parseOrFail(rideQuoteSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const { pickup, destination, service, pickupCoords, destinationCoords } = parsed.data;
  const [zone, pricing] = usesPostgresCommerce()
    ? await Promise.all([getPostgresZonePricing(pickupCoords), getPostgresPricingPlan("ride")])
    : [{ rideMultiplier: 1, zoneId: null }, fallbackRidePricing];
  const quote = {
      ...calculateRideQuote(
        {
          pickup,
          destination,
          service,
          pickupCoords,
          destinationCoords,
          demandMultiplier: zone.rideMultiplier,
        },
        pricing,
      ),
      zoneId: zone.zoneId,
    },
    quoteId = createId("QUOTE"),
    expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    quoteToken = jwt.sign(
      {
        kind: "ride_quote",
        quoteId,
        service: quote.service,
        fare: quote.fare,
        breakdown: quote.breakdown,
        pricingVersion: quote.pricingVersion,
        pickup,
        destination,
        pickupCoords: pickupCoords || null,
        destinationCoords: destinationCoords || null,
      },
      jwtSecret,
      { expiresIn: "5m" },
    );
  return ok(res, { quote: { ...quote, quoteId, quoteToken, expiresAt } });
});

router.post("/api/rides/options", async (req, res) => {
  const parsed = parseOrFail(rideQuoteSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const db = usesPostgresCommerce() ? {} : readDb();
  if (usesPostgresCommerce())
    [db.drivers, db.rides] = await Promise.all([getPostgresDrivers(), getPostgresRides()]);
  const [zone, pricing] = usesPostgresCommerce()
    ? await Promise.all([
        getPostgresZonePricing(parsed.data.pickupCoords),
        getPostgresPricingPlan("ride"),
      ])
    : [{ rideMultiplier: 1 }, fallbackRidePricing];
  return ok(res, {
    options: calculateRideOptions(db, parsed.data, zone.rideMultiplier, pricing),
  });
});

router.post("/api/rides", requireAuth, requireAnyRole("customer", "admin"), async (req, res) => {
  const parsed = parseOrFail(rideCreateSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const {
    customerId,
    pickup,
    destination,
    service,
    paymentMethod,
    pickupCoords,
    destinationCoords,
    quoteToken,
    scheduledFor,
  } = parsed.data;
  if (scheduledFor) {
    // La ventana vivía escrita a mano acá, y era la única parte del producto que
    // sabía reservar. Al programar pedidos de comida hacía falta la misma regla,
    // y una segunda copia diverge en silencio: el día que se acepte reservar con
    // 15 minutos, la mitad del producto seguiría exigiendo 30.
    const invalido = validarHorarioProgramado(scheduledFor);
    if (invalido) return fail(res, 400, invalido);
  }
  const db = usesPostgresCommerce() ? {} : readDb();
  const customer = usesPostgresAuth()
    ? await findAuthUserByPublicId(customerId)
    : db.users.find((user) => user.id === customerId);
  if (!customer) return fail(res, 404, "Cliente no encontrado");
  if (!canActAsCustomer(req, customerId))
    return fail(res, 403, "No puedes crear viajes para otro cliente");
  const idempotencyKey = req.get("idempotency-key");
  if (
    usesPostgresCommerce() &&
    (!idempotencyKey || !/^[a-zA-Z0-9._:-]{16,128}$/.test(idempotencyKey))
  ) {
    return fail(res, 400, "Idempotency-Key válido es obligatorio para solicitar viajes");
  }
  if (usesPostgresCommerce() && !quoteToken)
    return fail(res, 400, "Debes cotizar el viaje antes de solicitarlo");
  const [rideZone, ridePricing] = usesPostgresCommerce()
    ? await Promise.all([getPostgresZonePricing(pickupCoords), getPostgresPricingPlan("ride")])
    : [{ rideMultiplier: 1, zoneId: null }, fallbackRidePricing];
  let quote = {
    ...calculateRideQuote(
      {
        pickup,
        destination,
        service,
        pickupCoords,
        destinationCoords,
        demandMultiplier: rideZone.rideMultiplier,
      },
      ridePricing,
    ),
    zoneId: rideZone.zoneId,
  };
  if (quoteToken) {
    try {
      const locked = jwt.verify(quoteToken, jwtSecret);
      if (
        locked.kind !== "ride_quote" ||
        locked.service !== service ||
        locked.pickup !== pickup ||
        locked.destination !== destination ||
        JSON.stringify(locked.pickupCoords || null) !== JSON.stringify(pickupCoords || null) ||
        JSON.stringify(locked.destinationCoords || null) !==
          JSON.stringify(destinationCoords || null)
      )
        return fail(res, 409, "La cotizacion no corresponde a este viaje");
      quote = {
        ...quote,
        fare: locked.fare,
        breakdown: locked.breakdown,
        pricingVersion: locked.pricingVersion,
        quoteId: locked.quoteId,
      };
    } catch (_error) {
      return fail(res, 409, "La cotizacion vencio; actualiza el precio antes de solicitar");
    }
  }
  let riskAssessment = null;
  if (usesPostgresCommerce()) {
    try {
      riskAssessment = await assessTransactionRisk({
        customerPublicId: customerId,
        service: "ride",
        amount: quote.fare,
        requestId: req.requestId,
        idempotencyKey,
      });
      if (riskAssessment.decision === "block") {
        await recordPostgresAudit({
          actorPublicId: req.auth.userId,
          roles: req.auth.roles,
          action: "risk.transaction_blocked",
          entityType: "risk_assessment",
          entityId: riskAssessment.id,
          requestId: req.requestId,
          afterData: { service: "ride", score: riskAssessment.score },
        });
        return fail(
          res,
          403,
          "La operación requiere verificación de seguridad. Contactá a soporte.",
        );
      }
    } catch (error) {
      return failFrom(res, error, "No se pudo verificar el riesgo de la operación");
    }
  }
  const createdAt = getTimestamp();
  let ride = {
    id: createId("RIDE"),
    customerId,
    driverId: null,
    status: "requested",
    service: quote.service,
    pickup: String(pickup),
    destination: String(destination),
    pickupLocation: pickupCoords || null,
    destinationLocation: destinationCoords || null,
    distanceKm: quote.distanceKm,
    etaMin: quote.etaMin,
    durationMin: quote.durationMin,
    fare: quote.fare,
    paymentMethod: String(paymentMethod || "Flash Wallet"),
    scheduledFor: scheduledFor || null,
    createdAt,
    timeline: [{ status: "requested", at: createdAt }],
  };
  if (usesPostgresCommerce()) {
    try {
      ride = await createPostgresRide({
        publicId: ride.id,
        customerPublicId: customerId,
        pickup,
        destination,
        service,
        pickupCoords,
        destinationCoords,
        quote,
        paymentMethod: ride.paymentMethod,
        idempotencyKey,
        scheduledFor,
      });
      if (riskAssessment)
        await setRiskEntity({
          assessmentPublicId: riskAssessment.id,
          entityPublicId: ride.id,
        });
    } catch (error) {
      return failFrom(res, error, "No se pudo solicitar el viaje");
    }
  } else {
    ride = assignRideDriver(db, ride);
    db.rides.unshift(ride);
  }
  await auditRuntime(db, req, "ride", ride.id, "ride.created", {
    service: ride.service,
    fare: ride.fare,
    driverId: ride.driverId,
    scheduledFor: ride.scheduledFor,
  });
  if (!usesPostgresCommerce())
    createLocalNotification({
      userId: ride.customerId,
      template: "ride_status",
      payload: { rideId: ride.id, status: ride.status, etaMin: ride.etaMin },
    });
  await publishRealtimeEvent({
    req,
    type: "ride.created",
    entityType: "ride",
    entityId: ride.id,
    action: "ride.created",
  });
  return ok(res, { ride, label: rideLabels[ride.status] });
});

router.post(
  "/api/rides/:rideId/accept",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
    const { driverId } = req.body || {};
    const db = usesPostgresCommerce() ? {} : readDb();
    if (usesPostgresCommerce())
      [db.rides, db.drivers] = await Promise.all([getPostgresRides(), getPostgresDrivers()]);
    const index = db.rides.findIndex((entry) => entry.id === req.params.rideId);
    const driver = db.drivers.find((entry) => entry.id === driverId);
    if (index < 0) return fail(res, 404, "Viaje no encontrado");
    if (!canActAsDriver(req, driverId))
      return fail(res, 403, "No puedes aceptar viajes con otro conductor");
    if (!driver || !driver.online || !driver.serviceModes.includes("ride")) {
      return fail(res, 409, "Conductor no disponible");
    }
    if (db.rides[index].driverId) return fail(res, 409, "El viaje ya tiene conductor");
    db.rides[index] = usesPostgresCommerce()
      ? await setPostgresRideStatus(
          db.rides[index].id,
          "driver_assigned",
          req.auth.userId,
          driverId,
        )
      : addTimeline({ ...db.rides[index], driverId }, "driver_assigned");
    await auditRuntime(db, req, "ride", db.rides[index].id, "ride.accepted", {
      driverId,
    });
    await publishRealtimeEvent({
      req,
      type: "ride.updated",
      entityType: "ride",
      entityId: db.rides[index].id,
      action: "ride.accepted",
    });
    return ok(res, {
      ride: db.rides[index],
      label: rideLabels[db.rides[index].status],
    });
  },
);

router.post(
  "/api/rides/:rideId/advance",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
    const db = usesPostgresCommerce() ? {} : readDb();
    if (usesPostgresCommerce())
      [db.rides, db.drivers] = await Promise.all([getPostgresRides(), getPostgresDrivers()]);
    const index = db.rides.findIndex((entry) => entry.id === req.params.rideId);
    if (index < 0) return fail(res, 404, "Viaje no encontrado");
    if (!canAdvanceRide(req, db.rides[index]))
      return fail(res, 403, "No puedes avanzar este viaje");
    const next = nextRideStatus(db.rides[index]);
    if (!next) return fail(res, 409, "El viaje no puede avanzar desde este estado");
    db.rides[index] = usesPostgresCommerce()
      ? await setPostgresRideStatus(db.rides[index].id, next, req.auth.userId)
      : addTimeline(db.rides[index], next);
    if (next === "completed") {
      db.rides[index].etaMin = 0;
      await creditDriverEarningsRuntime(
        db,
        db.rides[index].driverId,
        Math.round(db.rides[index].fare * 0.8),
        `viaje-${db.rides[index].id}`,
      );
    }
    await auditRuntime(db, req, "ride", db.rides[index].id, "ride.status_advanced", {
      status: next,
    });
    if (!usesPostgresCommerce())
      createLocalNotification({
        userId: db.rides[index].customerId,
        template: "ride_status",
        payload: { rideId: db.rides[index].id, status: next, etaMin: db.rides[index].etaMin },
      });
    await publishRealtimeEvent({
      req,
      type: "ride.updated",
      entityType: "ride",
      entityId: db.rides[index].id,
      action: "ride.status_advanced",
    });
    return ok(res, { ride: db.rides[index], label: rideLabels[next] });
  },
);

router.patch("/api/rides/:rideId/status", requireAuth, async (req, res) => {
  const { status } = req.body || {};
  if (!rideStatuses.includes(status)) return fail(res, 400, "Estado de viaje invalido");
  const cancellation =
    status === "cancelled" ? parseOrFail(cancellationSchema, req.body || {}) : null;
  if (cancellation && !cancellation.ok) return fail(res, 400, cancellation.message);
  const db = usesPostgresCommerce() ? {} : readDb();
  if (usesPostgresCommerce()) db.rides = await getPostgresRides();
  const index = db.rides.findIndex((entry) => entry.id === req.params.rideId);
  if (index < 0) return fail(res, 404, "Viaje no encontrado");
  if (!canMutateRideStatus(req, db.rides[index], status)) {
    return fail(res, 403, "No puedes cambiar este estado de viaje");
  }
  if (usesPostgresCommerce()) {
    if (status === "cancelled") {
      const cancellationResult = await cancelMobilityJobAndRefundWallet({
        publicId: db.rides[index].id,
        kind: "ride",
        actorPublicId: req.auth.userId,
        reason: cancellation.data.reason,
        reasonDetail: cancellation.data.reasonDetail,
      });
      db.rides[index] = (await getPostgresRides()).find((entry) => entry.id === db.rides[index].id);
      db.rides[index].cancellation = cancellationResult;
    } else
      db.rides[index] = await setPostgresRideStatus(db.rides[index].id, status, req.auth.userId);
  } else db.rides[index] = addTimeline(db.rides[index], status);
  await auditRuntime(db, req, "ride", db.rides[index].id, "ride.status_set", {
    status,
  });
  await publishRealtimeEvent({
    req,
    type: "ride.updated",
    entityType: "ride",
    entityId: db.rides[index].id,
    action: "ride.status_set",
  });
  return ok(res, { ride: db.rides[index], label: rideLabels[status] });
});
