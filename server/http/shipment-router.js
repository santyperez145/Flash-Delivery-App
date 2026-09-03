// El envío de punta a punta: cotizar, despachar, llevar y probar que llegó
// (ticket ARC-001, paso 2).
//
// Décimo y último grupo grande de movilidad. A diferencia de viajes, estas diez
// rutas ya estaban contiguas en `server/index.js`: el archivo las tenía
// agrupadas por casualidad justo donde correspondía agruparlas por diseño.
//
// No confundir con `shipment-protection-router.js`, que es el vecino y no el
// mismo dominio. Ahí viven devoluciones y reclamos —lo que se tramita cuando el
// envío salió mal—; acá, el envío que sale bien. Es el mismo corte que separa
// `order-router.js` de `order-issues-router.js`.
//
// **La prueba de entrega es lo que distingue a un envío de un viaje.** Un viaje
// termina cuando la persona baja; un envío termina cuando alguien puede
// demostrar que la cosa llegó y a quién. De ahí las cuatro rutas de evidencia y
// PIN, y de ahí que compartan `deliveryProofLimiter`: la base ya bloquea el PIN
// a los cinco fallos, y el limitador cubre además la subida y descarga de la
// foto, que es la parte que un atacante puede repetir barato.
//
// El contenido de la evidencia se sirve por una ruta propia
// —`/api/shipment-delivery-evidence/:evidenceId/content`— y no incrustado en el
// JSON del envío. Una foto en base64 dentro de la respuesta la deja en cada
// caché y cada log del camino.
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { Router } from "express";
import { z } from "zod";

import { auditRuntime } from "../audit-trail.js";
import { config } from "../config.js";
import { requireAuth } from "./authentication.js";
import { canActAsCustomer, canActAsDriver, isAdmin, requireAnyRole } from "./authorization.js";
import { cancellationSchema } from "./cancellation.js";
import { getPostgresPricingPlan, getPostgresZonePricing } from "../configuration-repository.js";
import { creditDriverEarningsRuntime } from "../driver-earnings.js";
import { getPostgresDrivers } from "../driver-roster-repository.js";
import { fallbackShipmentPricing, readDb } from "../fallback-runtime.js";
import { coordinateSchema, distanceBetween } from "../geo.js";
import {
  fetchRoadDistanceKmIfRequired,
  requiresRoadRouting,
  resolveQuoteDistanceKm,
} from "../maps-route-service.js";
import {
  createPostgresShipment,
  getPostgresShipments,
  setPostgresShipmentStatus,
} from "../mobility-repository.js";
import {
  addPostgresShipmentDeliveryEvidence,
  getPostgresShipmentDeliveryCode,
  getPostgresShipmentDeliveryEvidence,
  getPostgresShipmentDeliveryEvidenceContent,
  verifyPostgresShipmentDelivery,
} from "../shipment-delivery-repository.js";
import {
  getShipmentProtectionPlan,
  getShipmentServiceConfiguration,
} from "../shipment-options-repository.js";
import { recordPostgresAudit } from "../audit-repository.js";
import { usesPostgresCommerce } from "../postgres.js";
import { deliveryProofLimiter } from "./rate-limits.js";
import { publishRealtimeEvent } from "./realtime.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";
import { assessTransactionRisk, setRiskEntity } from "../risk-repository.js";
import { shipmentProtectionRouter } from "./shipment-protection-router.js";
import { createId, createLocalNotification, getTimestamp, shipmentStatuses } from "../store.js";
import { cancelMobilityJobAndRefundWallet } from "../wallet-repository.js";

const shipmentQuoteSchema = z.object({
  pickup: z.string().min(3, "Origen obligatorio"),
  destination: z.string().min(3, "Destino obligatorio"),
  packageSize: z.enum(["small", "medium", "large"]),
  weightKg: z.coerce.number().positive().max(20),
  declaredValue: z.coerce.number().nonnegative().max(1000000).default(0),
  protection: z.enum(["none", "standard"]).default("none"),
  signatureRequired: z.boolean().default(false),
  itemCategory: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,31}$/)
    .default("standard"),
  serviceLevel: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,31}$/)
    .default("standard"),
  pickupCoords: coordinateSchema.nullable().optional(),
  destinationCoords: coordinateSchema.nullable().optional(),
  quoteToken: z.string().min(20).optional(),
});

const shipmentCreateSchema = shipmentQuoteSchema.extend({
  customerId: z.string().min(1),
  recipientName: z.string().trim().min(2).max(120),
  recipientPhone: z.string().trim().min(6).max(40),
  description: z.string().trim().min(2).max(180),
  deliveryNotes: z.string().trim().max(300).default(""),
  paymentMethod: z.string().min(2),
  termsAccepted: z.literal(true, {
    error: "Debes aceptar las restricciones de envio",
  }),
});
const deliveryPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "El PIN debe tener cuatro dígitos"),
});
const deliveryEvidenceSchema = z
  .object({
    type: z.enum(["photo", "signature"]),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    contentBase64: z.string().min(4).max(2100000),
    capturedAt: z.string().datetime().optional(),
    location: z
      .object({
        lat: z.coerce.number().min(-90).max(90),
        lng: z.coerce.number().min(-180).max(180),
      })
      .optional(),
    signerName: z.string().trim().min(2).max(120).optional(),
    signerRelationship: z.enum(["recipient", "authorized_person"]).optional(),
    consentVersion: z.literal("shipment-receipt-v1").optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.type === "signature" &&
      (!value.signerName || !value.signerRelationship || !value.consentVersion)
    )
      ctx.addIssue({
        code: "custom",
        message: "La firma requiere identidad, relación y consentimiento",
      });
    if (
      value.type === "photo" &&
      (value.signerName || value.signerRelationship || value.consentVersion)
    )
      ctx.addIssue({
        code: "custom",
        message: "Los datos del firmante sólo corresponden a una firma",
      });
  });

function calculateShipmentQuote(
  {
    pickup,
    destination,
    packageSize,
    weightKg,
    pickupCoords,
    destinationCoords,
    deliveryMultiplier = 1,
    zoneId = null,
    declaredValue = 0,
    protection = "none",
    protectionPlan = null,
    shipmentServiceConfig = null,
    roadDistanceKm = null,
    allowGeodesicFallback = true,
  },
  pricing = fallbackShipmentPricing,
) {
  const rules = pricing.config;
  const coordinateDistance = distanceBetween(pickupCoords, destinationCoords);
  const textWeight = `${pickup}${destination}`.length;
  let distanceKm;
  let distanceSource;
  let routingMode;
  if (coordinateDistance !== null) {
    ({ distanceKm, distanceSource } = resolveQuoteDistanceKm({
      allowGeodesicFallback,
      airDistanceM: coordinateDistance * 1000,
      roadFactor: rules.roadFactor,
      roadDistanceKm,
      minDistanceKm: rules.minDistanceKm,
      maxDistanceKm: rules.maxDistanceKm,
    }));
    routingMode = distanceSource === "road" ? "road" : "geodesic_scaled";
  } else {
    distanceKm = Math.max(2, Math.min(25, 2 + (textWeight % 18) * 0.7));
    distanceSource = "text_estimate";
    routingMode = "text-estimate";
  }
  const sizeMultiplier = Number(rules.sizeMultipliers[packageSize]);
  const serviceMultiplier = shipmentServiceConfig?.level.transportMultiplier || 1,
    categorySurcharge = shipmentServiceConfig?.category.surcharge || 0,
    baseTransportFare = Math.round(
      (rules.baseFare + distanceKm * rules.distancePerKm + Number(weightKg) * rules.weightPerKg) *
        sizeMultiplier *
        deliveryMultiplier,
    ),
    transportFare = Math.round(baseTransportFare * serviceMultiplier) + categorySurcharge,
    protectionPremium =
      protection === "standard" && protectionPlan
        ? Math.max(
            protectionPlan.minimumPremium,
            Math.round(Number(declaredValue) * protectionPlan.premiumRate),
          )
        : 0,
    fare = transportFare + protectionPremium;
  return {
    packageSize,
    distanceKm: Number(distanceKm.toFixed(1)),
    etaMin: Math.max(
      rules.minimumEtaMin,
      Math.round(
        (rules.etaBaseMin + distanceKm * rules.etaPerKm) *
          (shipmentServiceConfig?.level.etaMultiplier || 1),
      ),
    ),
    fare,
    zoneId,
    deliveryMultiplier,
    pricingVersion: pricing.version,
    declaredValue: Number(declaredValue),
    protection,
    protectionPremium,
    protectionPlanId: protection === "standard" ? protectionPlan?.id || null : null,
    deductible: protection === "standard" ? protectionPlan?.deductible || 0 : 0,
    itemCategory: shipmentServiceConfig?.category.code || "standard",
    itemCategoryName: shipmentServiceConfig?.category.name || "Paquete estándar",
    itemCategoryId: shipmentServiceConfig?.category.id || null,
    handlingInstructions: shipmentServiceConfig?.category.handlingInstructions || "",
    serviceLevel: shipmentServiceConfig?.level.code || "standard",
    serviceLevelName: shipmentServiceConfig?.level.name || "Standard",
    serviceLevelId: shipmentServiceConfig?.level.id || null,
    breakdown: {
      base: Number(rules.baseFare),
      distance: Math.round(distanceKm * rules.distancePerKm),
      weight: Math.round(Number(weightKg) * rules.weightPerKg),
      sizeMultiplier,
      deliveryMultiplier,
      baseTransportFare,
      serviceMultiplier,
      categorySurcharge,
      transportFare,
      protectionPremium,
    },
    estimated: distanceSource !== "road",
    routingMode,
    distanceSource,
  };
}

function assignShipmentDriver(db, shipment) {
  const driver = db.drivers
    .filter(
      (entry) =>
        entry.online &&
        entry.serviceModes.includes("delivery") &&
        !(db.shipments || []).some(
          (candidate) =>
            candidate.driverId === entry.id &&
            !["delivered", "cancelled"].includes(candidate.status),
        ),
    )
    .map((entry) => ({
      entry,
      distance: distanceBetween(entry.location, shipment.pickupLocation) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => left.distance - right.distance)[0]?.entry;
  if (!driver) return shipment;
  return {
    ...shipment,
    driverId: driver.id,
    status: "driver_assigned",
    timeline: [...shipment.timeline, { status: "driver_assigned", at: getTimestamp() }],
  };
}

const jwtSecret = config.jwtSecret;

export const shipmentRouter = Router();
const router = shipmentRouter;

router.post("/api/shipments/quote", async (req, res) => {
  const parsed = parseOrFail(shipmentQuoteSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  if (parsed.data.protection === "standard" && parsed.data.declaredValue <= 0)
    return fail(res, 400, "Indicá el valor declarado para contratar protección");
  try {
    const fallbackServiceConfig = {
      category: {
        id: null,
        code: "standard",
        name: "Paquete estándar",
        handlingInstructions: "",
        surcharge: 0,
        maximumWeightKg: 20,
      },
      level: {
        id: null,
        code: "standard",
        name: "Standard",
        transportMultiplier: 1,
        etaMultiplier: 1,
        maximumDistanceKm: null,
      },
    };
    const roadDistanceKm = await fetchRoadDistanceKmIfRequired({
      fromCoords: parsed.data.pickupCoords,
      toCoords: parsed.data.destinationCoords,
    });
    const [zone, pricing, protectionPlan, shipmentServiceConfig] = usesPostgresCommerce()
      ? await Promise.all([
          getPostgresZonePricing(parsed.data.pickupCoords),
          getPostgresPricingPlan("shipment"),
          parsed.data.protection === "standard"
            ? getShipmentProtectionPlan()
            : Promise.resolve(null),
          getShipmentServiceConfiguration(parsed.data),
        ])
      : [
          { deliveryMultiplier: 1, zoneId: null },
          fallbackShipmentPricing,
          null,
          fallbackServiceConfig,
        ];
    const allowGeodesicFallback = !requiresRoadRouting();
    if (protectionPlan && parsed.data.declaredValue > protectionPlan.maximumDeclaredValue)
      return fail(res, 400, "El valor declarado supera el máximo protegible");
    if (parsed.data.weightKg > shipmentServiceConfig.category.maximumWeightKg)
      return fail(
        res,
        400,
        `La categoría ${shipmentServiceConfig.category.name} admite hasta ${shipmentServiceConfig.category.maximumWeightKg} kg`,
      );
    const quote = calculateShipmentQuote(
      {
        ...parsed.data,
        ...zone,
        protectionPlan,
        shipmentServiceConfig,
        roadDistanceKm,
        allowGeodesicFallback,
      },
      pricing,
    );
    if (
      shipmentServiceConfig.level.maximumDistanceKm &&
      quote.distanceKm > shipmentServiceConfig.level.maximumDistanceKm
    )
      return fail(
        res,
        400,
        `${shipmentServiceConfig.level.name} admite recorridos de hasta ${shipmentServiceConfig.level.maximumDistanceKm} km`,
      );
    const quoteId = createId("QUOTE"),
      expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const quoteToken = jwt.sign(
      {
        kind: "shipment_quote",
        quoteId,
        fare: quote.fare,
        breakdown: quote.breakdown,
        pricingVersion: quote.pricingVersion,
        zoneId: quote.zoneId,
        pickup: parsed.data.pickup,
        destination: parsed.data.destination,
        packageSize: parsed.data.packageSize,
        weightKg: parsed.data.weightKg,
        declaredValue: parsed.data.declaredValue,
        protection: parsed.data.protection,
        signatureRequired: parsed.data.signatureRequired,
        itemCategory: parsed.data.itemCategory,
        serviceLevel: parsed.data.serviceLevel,
        pickupCoords: parsed.data.pickupCoords || null,
        destinationCoords: parsed.data.destinationCoords || null,
      },
      jwtSecret,
      { expiresIn: "5m" },
    );
    return ok(res, { quote: { ...quote, quoteId, quoteToken, expiresAt } });
  } catch (error) {
    return failFrom(res, error, "No se pudo cotizar el envío");
  }
});

router.post(
  "/api/shipments",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(shipmentCreateSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    if (!canActAsCustomer(req, parsed.data.customerId))
      return fail(res, 403, "No puedes crear envios para otro cliente");
    const idempotencyKey = req.get("idempotency-key");
    if (
      usesPostgresCommerce() &&
      (!idempotencyKey || !/^[a-zA-Z0-9._:-]{16,128}$/.test(idempotencyKey))
    )
      return fail(res, 400, "Idempotency-Key válido es obligatorio para crear envíos");
    if (usesPostgresCommerce() && !parsed.data.quoteToken)
      return fail(res, 400, "Debes cotizar el envío antes de solicitarlo");
    const db = usesPostgresCommerce() ? {} : readDb();
    if (parsed.data.protection === "standard" && parsed.data.declaredValue <= 0)
      return fail(res, 400, "Indicá el valor declarado para contratar protección");
    const fallbackServiceConfig = {
        category: {
          id: null,
          code: "standard",
          name: "Paquete estándar",
          handlingInstructions: "",
          surcharge: 0,
          maximumWeightKg: 20,
        },
        level: {
          id: null,
          code: "standard",
          name: "Standard",
          transportMultiplier: 1,
          etaMultiplier: 1,
          maximumDistanceKm: null,
        },
      },
      [shipmentZone, shipmentPricing, protectionPlan, shipmentServiceConfig] =
        usesPostgresCommerce()
          ? await Promise.all([
              getPostgresZonePricing(parsed.data.pickupCoords),
              getPostgresPricingPlan("shipment"),
              parsed.data.protection === "standard"
                ? getShipmentProtectionPlan()
                : Promise.resolve(null),
              getShipmentServiceConfiguration(parsed.data),
            ])
          : [
              { deliveryMultiplier: 1, zoneId: null },
              fallbackShipmentPricing,
              null,
              fallbackServiceConfig,
            ];
    if (protectionPlan && parsed.data.declaredValue > protectionPlan.maximumDeclaredValue)
      return fail(res, 400, "El valor declarado supera el máximo protegible");
    if (parsed.data.weightKg > shipmentServiceConfig.category.maximumWeightKg)
      return fail(
        res,
        400,
        `La categoría ${shipmentServiceConfig.category.name} admite hasta ${shipmentServiceConfig.category.maximumWeightKg} kg`,
      );
    const roadDistanceKm = await fetchRoadDistanceKmIfRequired({
      fromCoords: parsed.data.pickupCoords,
      toCoords: parsed.data.destinationCoords,
    });
    const allowGeodesicFallback = !requiresRoadRouting();
    let quote = calculateShipmentQuote(
      {
        ...parsed.data,
        ...shipmentZone,
        protectionPlan,
        shipmentServiceConfig,
        roadDistanceKm,
        allowGeodesicFallback,
      },
      shipmentPricing,
    );
    if (
      shipmentServiceConfig.level.maximumDistanceKm &&
      quote.distanceKm > shipmentServiceConfig.level.maximumDistanceKm
    )
      return fail(
        res,
        400,
        `${shipmentServiceConfig.level.name} admite recorridos de hasta ${shipmentServiceConfig.level.maximumDistanceKm} km`,
      );
    if (parsed.data.quoteToken) {
      try {
        const locked = jwt.verify(parsed.data.quoteToken, jwtSecret);
        if (
          locked.kind !== "shipment_quote" ||
          locked.pickup !== parsed.data.pickup ||
          locked.destination !== parsed.data.destination ||
          locked.packageSize !== parsed.data.packageSize ||
          Number(locked.weightKg) !== Number(parsed.data.weightKg) ||
          Number(locked.declaredValue || 0) !== Number(parsed.data.declaredValue) ||
          String(locked.protection || "none") !== parsed.data.protection ||
          Boolean(locked.signatureRequired) !== parsed.data.signatureRequired ||
          String(locked.itemCategory || "standard") !== parsed.data.itemCategory ||
          String(locked.serviceLevel || "standard") !== parsed.data.serviceLevel ||
          JSON.stringify(locked.pickupCoords || null) !==
            JSON.stringify(parsed.data.pickupCoords || null) ||
          JSON.stringify(locked.destinationCoords || null) !==
            JSON.stringify(parsed.data.destinationCoords || null)
        )
          return fail(res, 409, "La cotización no corresponde a este envío");
        quote = {
          ...quote,
          fare: locked.fare,
          breakdown: locked.breakdown,
          pricingVersion: locked.pricingVersion,
          zoneId: locked.zoneId,
          quoteId: locked.quoteId,
        };
      } catch (_error) {
        return fail(res, 409, "La cotización venció; actualiza el precio antes de solicitar");
      }
    }
    let riskAssessment = null;
    if (usesPostgresCommerce()) {
      try {
        riskAssessment = await assessTransactionRisk({
          customerPublicId: parsed.data.customerId,
          service: "shipment",
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
            afterData: { service: "shipment", score: riskAssessment.score },
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
    let shipment = {
      id: createId("SHIP"),
      customerId: parsed.data.customerId,
      driverId: null,
      status: "requested",
      pickup: parsed.data.pickup,
      destination: parsed.data.destination,
      pickupLocation: parsed.data.pickupCoords || null,
      destinationLocation: parsed.data.destinationCoords || null,
      recipientName: parsed.data.recipientName,
      recipientPhone: parsed.data.recipientPhone,
      packageSize: parsed.data.packageSize,
      description: parsed.data.description,
      weightKg: parsed.data.weightKg,
      deliveryNotes: parsed.data.deliveryNotes,
      distanceKm: quote.distanceKm,
      etaMin: quote.etaMin,
      fare: quote.fare,
      quoteId: quote.quoteId || null,
      pricingVersion: quote.pricingVersion,
      fareBreakdown: quote.breakdown,
      paymentMethod: parsed.data.paymentMethod,
      deliveryPin: String(crypto.randomInt(1000, 10000)),
      createdAt,
      timeline: [{ status: "requested", at: createdAt }],
    };
    if (usesPostgresCommerce()) {
      try {
        shipment = await createPostgresShipment({
          publicId: shipment.id,
          customerPublicId: parsed.data.customerId,
          data: parsed.data,
          quote,
          idempotencyKey,
        });
        if (riskAssessment)
          await setRiskEntity({
            assessmentPublicId: riskAssessment.id,
            entityPublicId: shipment.id,
          });
      } catch (error) {
        return failFrom(res, error, "No se pudo crear el envío");
      }
    } else {
      db.shipments ||= [];
      shipment = assignShipmentDriver(db, shipment);
      db.shipments.unshift(shipment);
    }
    await auditRuntime(db, req, "shipment", shipment.id, "shipment.created", {
      fare: shipment.fare,
      packageSize: shipment.packageSize,
    });
    if (!usesPostgresCommerce())
      createLocalNotification({
        userId: shipment.customerId,
        template: "shipment_status",
        payload: { shipmentId: shipment.id, status: shipment.status, etaMin: shipment.etaMin },
      });
    await publishRealtimeEvent({
      req,
      type: "shipment.created",
      entityType: "shipment",
      entityId: shipment.id,
      action: "shipment.created",
    });
    return ok(res, { shipment });
  },
);

router.post(
  "/api/shipments/:shipmentId/accept",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
    const db = usesPostgresCommerce() ? {} : readDb();
    if (usesPostgresCommerce())
      [db.shipments, db.drivers] = await Promise.all([
        getPostgresShipments(),
        getPostgresDrivers(),
      ]);
    const shipment = db.shipments.find((entry) => entry.id === req.params.shipmentId);
    const driver = db.drivers.find((entry) => entry.id === req.body?.driverId);
    if (!shipment) return fail(res, 404, "Envio no encontrado");
    if (
      !driver ||
      !canActAsDriver(req, driver.id) ||
      !driver.online ||
      !driver.serviceModes.includes("delivery")
    )
      return fail(res, 409, "Conductor no disponible");
    if (shipment.driverId) return fail(res, 409, "Envio ya asignado");
    if (usesPostgresCommerce())
      Object.assign(
        shipment,
        await setPostgresShipmentStatus(shipment.id, "driver_assigned", req.auth.userId, driver.id),
      );
    else {
      shipment.driverId = driver.id;
      shipment.status = "driver_assigned";
      shipment.timeline.push({ status: shipment.status, at: getTimestamp() });
    }
    await auditRuntime(db, req, "shipment", shipment.id, "shipment.accepted", {
      driverId: driver.id,
    });
    return ok(res, { shipment });
  },
);

router.post(
  "/api/shipments/:shipmentId/advance",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
    const db = usesPostgresCommerce() ? {} : readDb();
    if (usesPostgresCommerce())
      [db.shipments, db.drivers] = await Promise.all([
        getPostgresShipments(),
        getPostgresDrivers(),
      ]);
    const shipment = db.shipments.find((entry) => entry.id === req.params.shipmentId);
    if (!shipment) return fail(res, 404, "Envio no encontrado");
    if (!isAdmin(req) && !canActAsDriver(req, shipment.driverId))
      return fail(res, 403, "No puedes avanzar este envio");
    const next = {
      driver_assigned: "arriving",
      arriving: "picked_up",
      picked_up: "delivering",
      delivering: "delivered",
    }[shipment.status];
    if (!next) return fail(res, 409, "El envio no puede avanzar desde su estado actual");
    if (next === "delivered" && usesPostgresCommerce())
      return fail(res, 409, "Debes verificar el PIN del destinatario para completar la entrega");
    if (usesPostgresCommerce())
      Object.assign(shipment, await setPostgresShipmentStatus(shipment.id, next, req.auth.userId));
    else {
      shipment.status = next;
      shipment.timeline.push({ status: next, at: getTimestamp() });
    }
    if (next === "delivered")
      await creditDriverEarningsRuntime(
        db,
        shipment.driverId,
        Math.round(shipment.fare * 0.78),
        `envio-${shipment.id}`,
      );
    await auditRuntime(db, req, "shipment", shipment.id, "shipment.advanced", {
      status: next,
    });
    return ok(res, { shipment });
  },
);

router.get(
  "/api/shipments/:shipmentId/delivery-code",
  deliveryProofLimiter,
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return fail(res, 503, "La prueba de entrega requiere PostgreSQL");
    try {
      const code = await getPostgresShipmentDeliveryCode({
        publicId: req.params.shipmentId,
        customerPublicId: req.auth.userId,
        admin: isAdmin(req),
      });
      return ok(res, { deliveryCode: code });
    } catch (error) {
      return failFrom(res, error, "No se pudo consultar el código");
    }
  },
);

router.post(
  "/api/shipments/:shipmentId/delivery-evidence",
  deliveryProofLimiter,
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "La evidencia de entrega requiere PostgreSQL");
    const parsed = parseOrFail(deliveryEvidenceSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const evidence = await addPostgresShipmentDeliveryEvidence({
        publicId: req.params.shipmentId,
        actorPublicId: req.auth.userId,
        ...parsed.data,
        admin: isAdmin(req),
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "shipment.delivery_evidence_recorded",
        entityType: "shipment",
        entityId: req.params.shipmentId,
        requestId: req.requestId,
        afterData: {
          evidenceId: evidence.id,
          type: evidence.type,
          sha256: evidence.sha256,
          sizeBytes: evidence.sizeBytes,
          hasLocation: Boolean(evidence.capturedLocation),
        },
      });
      res.status(201);
      return ok(res, { evidence });
    } catch (error) {
      return failFrom(res, error, "No se pudo registrar la evidencia");
    }
  },
);

router.get("/api/shipments/:shipmentId/delivery-evidence", requireAuth, async (req, res) => {
  if (!usesPostgresCommerce()) return fail(res, 503, "La evidencia de entrega requiere PostgreSQL");
  try {
    return ok(res, {
      evidence: await getPostgresShipmentDeliveryEvidence({
        publicId: req.params.shipmentId,
        actorPublicId: req.auth.userId,
        admin: isAdmin(req),
      }),
    });
  } catch (error) {
    return failFrom(res, error, "No se pudo consultar la evidencia");
  }
});

router.get(
  "/api/shipment-delivery-evidence/:evidenceId/content",
  deliveryProofLimiter,
  requireAuth,
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "La evidencia de entrega requiere PostgreSQL");
    try {
      return ok(
        res,
        await getPostgresShipmentDeliveryEvidenceContent({
          evidencePublicId: req.params.evidenceId,
          actorPublicId: req.auth.userId,
          admin: isAdmin(req),
        }),
      );
    } catch (error) {
      return failFrom(res, error, "No se pudo abrir la evidencia");
    }
  },
);

router.post(
  "/api/shipments/:shipmentId/verify-delivery",
  deliveryProofLimiter,
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return fail(res, 503, "La prueba de entrega requiere PostgreSQL");
    const parsed = parseOrFail(deliveryPinSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const result = await verifyPostgresShipmentDelivery({
        publicId: req.params.shipmentId,
        actorPublicId: req.auth.userId,
        pin: parsed.data.pin,
        admin: isAdmin(req),
      });
      if (!result.verified) {
        await recordPostgresAudit({
          actorPublicId: req.auth.userId,
          roles: req.auth.roles,
          action: "shipment.delivery_pin_failed",
          entityType: "shipment",
          entityId: req.params.shipmentId,
          requestId: req.requestId,
          afterData: {
            attemptsRemaining: result.attemptsRemaining,
            lockedUntil: result.lockedUntil,
          },
        });
        return fail(
          res,
          result.lockedUntil ? 429 : 400,
          result.lockedUntil
            ? "Verificación bloqueada temporalmente"
            : `PIN incorrecto. Quedan ${result.attemptsRemaining} intentos`,
        );
      }
      await creditDriverEarningsRuntime(
        null,
        result.shipment.driverId,
        Math.round(result.shipment.fare * 0.78),
        `envio-${result.shipment.id}`,
      );
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "shipment.delivery_verified",
        entityType: "shipment",
        entityId: req.params.shipmentId,
        requestId: req.requestId,
        afterData: { proofType: result.proofType },
      });
      await publishRealtimeEvent({
        req,
        type: "shipment.updated",
        entityType: "shipment",
        entityId: req.params.shipmentId,
        action: "shipment.delivery_verified",
      });
      return ok(res, {
        shipment: result.shipment,
        proof: { type: result.proofType, verified: true },
      });
    } catch (error) {
      return failFrom(res, error, "No se pudo verificar la entrega");
    }
  },
);

router.patch("/api/shipments/:shipmentId/status", requireAuth, async (req, res) => {
  if (req.body?.status !== "cancelled" || !shipmentStatuses.includes(req.body.status))
    return fail(res, 400, "Solo se permite cancelar el envio");
  const cancellation = parseOrFail(cancellationSchema, req.body || {});
  if (!cancellation.ok) return fail(res, 400, cancellation.message);
  const db = usesPostgresCommerce() ? {} : readDb();
  if (usesPostgresCommerce()) db.shipments = await getPostgresShipments();
  const shipment = db.shipments.find((entry) => entry.id === req.params.shipmentId);
  if (!shipment) return fail(res, 404, "Envio no encontrado");
  if (
    !isAdmin(req) &&
    !canActAsCustomer(req, shipment.customerId) &&
    !canActAsDriver(req, shipment.driverId)
  )
    return fail(res, 403, "No puedes cancelar este envio");
  if (usesPostgresCommerce()) {
    const cancellationResult = await cancelMobilityJobAndRefundWallet({
      publicId: shipment.id,
      kind: "delivery",
      actorPublicId: req.auth.userId,
      reason: cancellation.data.reason,
      reasonDetail: cancellation.data.reasonDetail,
    });
    Object.assign(
      shipment,
      (await getPostgresShipments()).find((entry) => entry.id === shipment.id),
      { cancellation: cancellationResult },
    );
  } else {
    shipment.status = "cancelled";
    shipment.timeline.push({ status: "cancelled", at: getTimestamp() });
  }
  await auditRuntime(db, req, "shipment", shipment.id, "shipment.cancelled");
  return ok(res, { shipment });
});
