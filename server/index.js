import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import bcrypt from "bcryptjs";
import compression from "compression";
import express from "express";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { config } from "./config.js";
import { closeRedis, redisClient, redisReadiness } from "./redis.js";
import { openApiDocument } from "./openapi.js";
import { closePostgres, postgresPool, postgresReadiness } from "./postgres.js";
import { stopTelemetry } from "./telemetry.js";
import { createGracefulShutdown } from "./graceful-shutdown.js";
import { beginMerchantPaymentOAuth, completeMerchantPaymentOAuth, getMerchantPaymentConnection, revokeMerchantPaymentConnection } from "./payment-oauth-repository.js";
import {verifyMercadoPagoWebhook} from "./mercadopago-webhook.js";
import {enqueueMercadoPagoWebhook} from "./mercadopago-webhook-repository.js";
import {cancelMarketplaceOrderAndRefund} from "./marketplace-refund-repository.js";
import { confirmPhoneVerification, requestPhoneVerification } from "./phone-verification-repository.js";
import { observeHttpRequest, observeProviderCall, renderPrometheus } from "./observability.js";
import { ProviderCircuit } from "./provider-resilience.js";
import {
  createPostgresSession,
  createPostgresAddress,
  deletePostgresAddress,
  findAuthUserByEmail,
  findAuthUserByPublicId,
  getPostgresAddresses,
  getPostgresPaymentMethods,
  createSandboxPaymentMethod,
  setDefaultPostgresPaymentMethod,
  revokePostgresPaymentMethod,
  getPostgresUsers,
  getPostgresOperationsUserPage,
  getPostgresUserSessions,
  recordPostgresLoginFailure,
  recordPostgresLoginSuccess,
  requestPasswordRecovery,
  consumePasswordRecovery,
  resendEmailVerification,
  confirmEmailVerification,
  registerAuthUser,
  revokePostgresSession,
  revokeOwnedPostgresSession,
  revokeOtherPostgresSessions,
  rotatePostgresSession,
  setPostgresDefaultAddress,
  setPostgresUserStatus,
  updatePostgresAddress,
  updatePostgresAuthProfile,
  usesPostgresAuth,
} from "./auth-repository.js";
import {
  assignPostgresOrderDriver,
  createPostgresOrder,
  processPostgresOrderMarketplacePayment,
  createPostgresMenuItem,
  getPostgresOrders,
  getPostgresFoodDeliveryQuote,
  getPostgresFoodCheckoutQuote,
  getPostgresCart,
  getPostgresDrivers,
  getPostgresDriverForUser,
  getPostgresRestaurants,
  getPostgresRestaurantPage,
  getPostgresOperationsRestaurantPage,
  getPostgresOperationsDriverPage,
  setPostgresOrderStatus,
  replacePostgresCart,
  reorderPostgresOrder,
  updatePostgresMenuItem,
  replacePostgresItemModifiers,
  replacePostgresItemDietary,
  updatePostgresRestaurant,
  updatePostgresDriver,
  updatePostgresBranch,
  updatePostgresBranchInventory,
  replacePostgresBranchSchedule,
  upsertPostgresBranchScheduleException,
  usesPostgresCommerce,
} from "./commerce-repository.js";
import {
  createPostgresRide,
  createPostgresShipment,
  getPostgresRides,
  getPostgresShipments,
  setPostgresRideStatus,
  setPostgresShipmentStatus,
  getPostgresShipmentDeliveryCode,
  verifyPostgresShipmentDelivery,
  addPostgresShipmentDeliveryEvidence,
  getPostgresShipmentDeliveryEvidence,
  getPostgresShipmentDeliveryEvidenceContent,
  getShipmentProtectionPlan,
  getShipmentOptions,
  getShipmentServiceConfiguration,
  updateShipmentItemCategory,
  updateShipmentServiceLevel,
  getPostgresShipmentReturns,
  createPostgresShipmentReturn,
  updatePostgresShipmentReturn,
  getPostgresShipmentClaims,
  createPostgresShipmentClaim,
  updatePostgresShipmentClaim,
  addPostgresShipmentClaimEvidence,
  getPostgresShipmentClaimEvidenceContent,
} from "./mobility-repository.js";
import {
  cancelMobilityJobAndRefundWallet,
  cancelOrderAndRefundWallet,
  creditWallet,
  getPostgresWalletTransactions,
  getWallet,
  getWalletBalances,
  settleMobilityWalletPayment,
} from "./wallet-repository.js";
import { claimReferral, getReferralSummary } from "./referral-repository.js";
import { decodeActivityCursor, getActivityPage, getAssignedDriverProjections } from "./activity-repository.js";
import { findPublicCity, getPublicCities } from "./city-repository.js";
import { evaluateFeatureFlags, getFeatureFlags, updateFeatureFlag } from "./feature-flag-repository.js";
import { getProductMetrics, ingestProductEvents } from "./product-analytics-repository.js";
import { assessZoneReadiness, getZoneReadiness } from "./zone-readiness-repository.js";
import {
  getPaymentReconciliation,
  recordPaymentWebhook,
  resolvePaymentReconciliationCase,
  scanPaymentReconciliation,
  verifyWebhookSignature,
} from "./payment-repository.js";
import {
  assessTransactionRisk,
  getTransactionRisks,
  reviewTransactionRisk,
  setRiskEntity,
} from "./risk-repository.js";
import {
  addPostgresSupportMessage,
  createPostgresSupportTicket,
  getPostgresAdminFinancials,
  getPostgresAuditEvents,
  getPostgresAuditEventPage,
  getPostgresNotifications,
  getPostgresSupportTickets,
  getPostgresOperationsSupportTicketPage,
  getSupportAgents,
  markPostgresNotificationRead,
  processSupportQueue,
  recordPostgresAudit,
  updateSupportAgent,
  updatePostgresSupportTicket,
} from "./operations-repository.js";
import {
  createPostgresPricingChangeRequest,
  createPostgresPricingRollbackRequest,
  createPostgresPromotion,
  getPostgresPricingChangeRequests,
  getPostgresPricingPlan,
  getPostgresPricingPlans,
  getPostgresPromotions,
  getPostgresZonePricing,
  getPostgresZones,
  reviewPostgresPricingChangeRequest,
  updatePostgresPromotion,
  updatePostgresZone,
} from "./configuration-repository.js";
import {
  createPostgresRating,
  getPostgresFavoriteMerchantIds,
  getPostgresRatings,
  setPostgresFavorite,
} from "./feedback-repository.js";
import {
  enqueuePostgresNotification,
  getNotificationDeadLetters,
  getPostgresDevices,
  getPostgresNotificationPreferences,
  processPostgresNotificationBatch,
  registerPostgresDevice,
  replayNotificationDeadLetter,
  revokePostgresDevice,
  updatePostgresNotificationPreference,
} from "./notification-repository.js";
import {
  getPostgresDispatchOffers,
  processPostgresDispatchBatch,
  rejectPostgresDispatchOffer,
} from "./dispatch-repository.js";
import {
  canReceiveRealtimeEvent,
  getPostgresRealtimeCursor,
  getPostgresRealtimeReplay,
  persistPostgresRealtimeEvent,
  startPostgresRealtimeListener,
} from "./realtime-repository.js";
import {
  getMerchantFinance,
  getPayoutReviewQueue,
  requestMerchantPayout,
  createPayoutStepUp,
  reviewMerchantPayout,
} from "./merchant-finance-repository.js";
import {
  getUserDietaryPreferences,
  replaceUserDietaryPreferences,
} from "./dietary-preference-repository.js";
import { searchPostgresCatalog } from "./catalog-search-repository.js";
import {
  createPostgresTip,
  getPostgresTips,
  getTipAdjustments,
  requestTipAdjustment,
  reviewTipAdjustment,
} from "./tip-repository.js";
import { getOrCreatePostgresReceipt } from "./receipt-repository.js";
import {
  createOrderIssue,
  getOrderIssues,
  resolveOrderIssue,
} from "./order-issue-repository.js";
import {
  decideOrderSubstitution,
  getOrderSubstitutions,
  proposeOrderSubstitution,
} from "./substitution-repository.js";
import {
  createMapCacheKey,
  getCachedMapResponse,
  getStaleCachedMapResponse,
  putCachedMapResponse,
} from "./map-cache-repository.js";
import {
  assertDriverCanGoOnline,
  getDriverCompliance,
  getDriverDocumentContent,
  reviewDriverDocument,
  submitDriverDocument,
} from "./compliance-repository.js";
import {
  activateDriverVehicle,
  createDriverVehicle,
  getDriverVehicles,
  retireDriverVehicle,
  reviewDriverVehicle,
  updateDriverVehicle,
} from "./driver-vehicle-repository.js";
import {
  createRideSafetyIncident,
  createRideTrackingLink,
  getPublicRideTracking,
  getRidePickupCode,
  revokeRideTrackingLink,
  verifyRidePickupCode,
} from "./ride-safety-repository.js";
import {
  beginAdminMfaEnrollment,
  confirmAdminMfa,
  getAdminMfaStatus,
  verifyAdminMfa,
} from "./mfa-repository.js";
import {
  deletePostgresRideDestination,
  getPostgresRideDestinations,
  recordPostgresRideDestination,
} from "./destination-repository.js";
import {
  createPostgresTrustedContact,
  deletePostgresTrustedContact,
  getPostgresTrustedContacts,
} from "./trusted-contact-repository.js";
import {
  createServiceMessage,
  createServiceQuickReply,
  getServiceAttachmentContent,
  getServiceMessages,
  getServiceQuickReplies,
  listServiceQuickReplies,
  markServiceMessagesRead,
  updateServiceQuickReply,
} from "./service-chat-repository.js";
import {
  consumeAuthSession,
  createAuthSession,
  createId,
  createLocalNotification,
  createLocalProductEvents,
  getLocalNotificationPreferences,
  getLocalNotifications,
  getLocalProductMetrics,
  getLocalDietaryPreferences,
  getPublicState,
  getDatabasePath,
  getTimestamp,
  orderStatuses,
  readDb as readFallbackDb,
  markLocalNotificationRead,
  revokeAuthSession,
  resetDb,
  rideStatuses,
  updateLocalNotificationPreference,
  replaceLocalDietaryPreferences,
  shipmentStatuses,
  writeDb,
} from "./store.js";

const app = express();
const serviceFee = 520;
const jwtSecret = config.jwtSecret;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, "..", "dist");
const realtimeClients = new Map();
const processStartedAt = Date.now();
const mapProviderCircuit = new ProviderCircuit(config.mapProvider);
let sqliteRuntimeReads = 0;
let draining = false;
function readDb() {
  sqliteRuntimeReads += 1;
  return readFallbackDb();
}

app.disable("x-powered-by");
app.set("trust proxy", config.isProduction ? 1 : false);

const ok = (res, payload = {}) =>
  res.json({ ok: true, requestId: res.locals.requestId, ...payload });
const fail = (res, status, message) =>
  res
    .status(status)
    .json({ ok: false, requestId: res.locals.requestId, message });
const parseOrFail = (schema, payload) => {
  const result = schema.safeParse(payload);
  if (!result.success) {
    return {
      ok: false,
      message: result.error.issues.map((issue) => issue.message).join(", "),
    };
  }
  return { ok: true, data: result.data };
};

function requestContext(req, res, next) {
  const headerId = Array.isArray(req.headers["x-request-id"])
    ? req.headers["x-request-id"][0]
    : req.headers["x-request-id"];
  const requestId =
    typeof headerId === "string" && /^[a-zA-Z0-9._:-]{8,128}$/.test(headerId)
      ? headerId
      : createId("REQ");
  req.requestId = requestId;
  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  trace.getActiveSpan()?.setAttribute("flash.request.id", requestId);
  next();
}

function requestLogger(req, res, next) {
  const start = Date.now();
  const span = trace.getActiveSpan();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const route = req.route?.path || req.originalUrl.split("?", 1)[0];
    span?.updateName(`${req.method} ${route}`);
    span?.setAttributes({
      "http.route": route,
      "http.response.status_code": res.statusCode,
      "flash.http.duration_ms": durationMs,
    });
    if (res.statusCode >= 500) span?.setStatus({ code: SpanStatusCode.ERROR });
    observeHttpRequest({
      method: req.method,
      path: route,
      status: res.statusCode,
      durationMs,
    });
    if (config.logLevel !== "silent")
      console.log(
        JSON.stringify({
          level: res.statusCode >= 500 ? "error" : "info",
          requestId: req.requestId,
          method: req.method,
          path: route,
          status: res.statusCode,
          durationMs,
        }),
      );
  });
  return next();
}

function writeSseEvent(client, event, data, cursor = null) {
  if (client.destroyed || client.writableEnded) return false;
  client.write(
    `${cursor ? `id: ${cursor}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
  );
  return true;
}

function fanoutRealtimeEvent(payload) {
  for (const [client, context] of realtimeClients) {
    if (!canReceiveRealtimeEvent(payload, context)) continue;
    if (!writeSseEvent(client, "state.updated", payload, payload.cursor))
      realtimeClients.delete(client);
  }
}

async function publishRealtimeEvent({
  req,
  type,
  entityType = null,
  entityId = null,
  action = null,
}) {
  if (postgresPool) {
    await persistPostgresRealtimeEvent({
      type,
      entityType,
      entityId,
      action,
      requestId: req?.requestId || null,
      actorPublicId: req?.auth?.userId || null,
    });
    return;
  }
  const payload = {
    id: createId("EVT"),
    type,
    entityType,
    entityId,
    action,
    requestId: req?.requestId || null,
    at: getTimestamp(),
  };
  for (const [client] of realtimeClients)
    if (!writeSseEvent(client, "state.updated", payload))
      realtimeClients.delete(client);
}

const stopRealtimeListener = postgresPool
  ? await startPostgresRealtimeListener(fanoutRealtimeEvent)
  : null;

function isSameOrigin(req, origin) {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === `${req.protocol}:` && parsed.host === req.get("host");
  } catch {
    return false;
  }
}

function isAllowedOrigin(req, origin) {
  return (
    !origin ||
    config.corsOrigins.includes("*") ||
    config.corsOrigins.includes(origin) ||
    isSameOrigin(req, origin)
  );
}

function corsOrigin(origin, callback) {
  if (
    !origin ||
    config.corsOrigins.includes("*") ||
    config.corsOrigins.includes(origin)
  ) {
    return callback(null, true);
  }
  const error = new Error("Origen no permitido por CORS");
  error.status = 403;
  return callback(error);
}

const apiCors = cors({ origin: corsOrigin, credentials: true });
function apiCorsMiddleware(req, res, next) {
  if (isSameOrigin(req, req.get("origin"))) return next();
  return apiCors(req, res, next);
}

function requireTrustedWebOrigin(req, res, next) {
  if (req.get("x-flash-client") !== "web") return next();
  const origin = req.get("origin");
  const fetchSite = req.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    return fail(res, 403, "Solicitud web cross-site rechazada");
  }
  if (!isAllowedOrigin(req, origin)) {
    return fail(res, 403, "Origen web no permitido");
  }
  return next();
}

function createLimiter({ max, message, prefix }) {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: max,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) => ["/health", "/ready"].includes(req.path),
    handler: (_req, res) => fail(res, 429, message),
    ...(redisClient ? { store: new RedisStore({ sendCommand: (...args) => redisClient.sendCommand(args), prefix: `flash:rate:${prefix}:` }) } : {}),
  });
}
const payoutStepUpLimiter = createLimiter({max:10,prefix:"payout-step-up",message:"Demasiados intentos de autorización financiera. Intenta más tarde."});

app.use(requestContext);
app.use(requestLogger);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'", ...config.corsOrigins.filter((origin) => origin !== "*"), ...config.webMapOrigins],
        fontSrc: ["'self'", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        workerSrc: ["'self'", "blob:"],
        upgradeInsecureRequests: config.isProduction ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: config.isProduction ? undefined : false,
  }),
);
app.use("/api", apiCorsMiddleware);
app.use(compression({
  threshold: 1024,
  filter: (req, res) => req.path !== "/api/events" && compression.filter(req, res),
}));
app.use("/api/auth", (_req, res, next) => {
  res.set("Cache-Control", "no-store, private");
  res.set("Pragma", "no-cache");
  next();
});
app.use("/api/auth", requireTrustedWebOrigin);
app.use("/api", (req, res, next) => {
  if (!new Set(["POST", "PUT", "PATCH", "DELETE"]).has(req.method)) return next();
  const hasBody = Number(req.get("content-length") || 0) > 0 || Boolean(req.get("transfer-encoding"));
  if (!hasBody) return next();
  if (req.is("application/json") || req.is("application/*+json")) return next();
  return fail(res, 415, "Content-Type debe ser application/json");
});
app.use(
  "/api",
  createLimiter({
    max: config.rateLimit.max,
    prefix: "api",
    message: "Demasiadas solicitudes. Intenta nuevamente en unos segundos.",
  }),
);
app.use(
  "/api/auth",
  createLimiter({
    max: config.rateLimit.authMax,
    prefix: "auth",
    message: "Demasiados intentos de autenticacion. Intenta mas tarde.",
  }),
);
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buffer) => {
      req.rawBody = Buffer.from(buffer);
    },
  }),
);

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}

async function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return fail(res, 401, "Token requerido");
  try {
    const payload = jwt.verify(token, jwtSecret);
    const db = usesPostgresAuth() ? null : readDb();
    const user = usesPostgresAuth()
      ? await findAuthUserByPublicId(payload.sub)
      : db.users.find((entry) => entry.id === payload.sub);
    if (!user) return fail(res, 401, "Usuario no existe");
    req.auth = {
      userId: user.id,
      roles: Array.isArray(user.roles) ? user.roles : [],
      user,
      mfaVerified: payload.mfa === true,
      mfa:
        usesPostgresAuth() && user.roles?.includes("admin")
          ? await getAdminMfaStatus(user.id)
          : { enabled: false },
    };
    res.set("Cache-Control", "no-store, private");
    res.set("Pragma", "no-cache");
    return next();
  } catch (_error) {
    return fail(res, 401, "Token invalido o expirado");
  }
}

function hasRole(req, role) {
  return Boolean(req.auth?.roles?.includes(role));
}

function isAdmin(req) {
  return (
    hasRole(req, "admin") &&
    !(
      (req.auth?.mfa?.enabled || config.requireAdminMfa) &&
      !req.auth?.mfaVerified
    )
  );
}

const requireAnyRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.auth) return fail(res, 401, "Token requerido");
    if (!roles.some((role) => hasRole(req, role))) {
      return fail(res, 403, "No tienes permisos para esta accion");
    }
    if (
      roles.includes("admin") &&
      hasRole(req, "admin") &&
      (req.auth.mfa?.enabled || config.requireAdminMfa) &&
      !req.auth.mfaVerified
    ) {
      return fail(
        res,
        403,
        "Completa el segundo factor para usar privilegios administrativos",
      );
    }
    return next();
  };

function canActAsCustomer(req, customerId) {
  return (
    isAdmin(req) || (hasRole(req, "customer") && req.auth.userId === customerId)
  );
}

function canActAsDriver(req, driverId) {
  return (
    isAdmin(req) ||
    (hasRole(req, "driver") && req.auth.user.driverId === driverId)
  );
}

function canManageRestaurant(req, restaurant) {
  return (
    isAdmin(req) ||
    (hasRole(req, "merchant") && restaurant.ownerId === req.auth.userId)
  );
}

function canAdvanceOrder(req, db, order) {
  const restaurant = findRestaurant(db, order.restaurantId);
  return (
    isAdmin(req) ||
    (restaurant && canManageRestaurant(req, restaurant)) ||
    (order.courierId && canActAsDriver(req, order.courierId))
  );
}

function canMutateOrderStatus(req, db, order, status) {
  if (isAdmin(req)) return true;
  if (status !== "cancelled") return false;
  const restaurant = findRestaurant(db, order.restaurantId);
  return (
    canActAsCustomer(req, order.customerId) ||
    (restaurant && canManageRestaurant(req, restaurant)) ||
    (order.courierId && canActAsDriver(req, order.courierId))
  );
}

function canAdvanceRide(req, ride) {
  return isAdmin(req) || (ride.driverId && canActAsDriver(req, ride.driverId));
}

function canMutateRideStatus(req, ride, status) {
  if (isAdmin(req)) return true;
  if (status !== "cancelled") return false;
  return (
    canActAsCustomer(req, ride.customerId) ||
    (ride.driverId && canActAsDriver(req, ride.driverId))
  );
}

function audit(db, req, entityType, entityId, action, payload = {}) {
  const event = {
    id: createId("AUD"),
    actorId: req.auth?.userId || "system",
    entityType,
    entityId,
    action,
    payload,
    createdAt: getTimestamp(),
  };
  db.auditEvents = [event, ...(db.auditEvents || [])].slice(0, 500);
}
// The database independently locks PIN verification after five failures. This
// wider edge budget also covers authorized photo upload/download operations.
const deliveryProofLimiter = createLimiter({
  max: 30,
  prefix: "delivery-proof",
  message: "Demasiadas operaciones de prueba de entrega. Intenta más tarde.",
});
const serviceChatLimiter = createLimiter({
  max: 60,
  prefix: "service-chat",
  message: "Demasiados mensajes. Espera antes de continuar.",
});

async function auditRuntime(
  db,
  req,
  entityType,
  entityId,
  action,
  payload = {},
) {
  if (usesPostgresCommerce())
    await recordPostgresAudit({
      actorPublicId: req.auth?.userId,
      roles: req.auth?.roles || [],
      action,
      entityType,
      entityId,
      requestId: req.requestId,
      afterData: payload,
    });
  else {
    audit(db, req, entityType, entityId, action, payload);
    writeDb(db);
  }
}

const loginSchema = z.object({
  email: z.string().email("Email invalido"),
  password: z.string().min(4, "Password demasiado corto"),
  deviceName: z.string().trim().max(160).optional(),
});

const registerSchema = z.object({
  name: z.string().min(2, "Nombre obligatorio"),
  email: z.string().email("Email invalido"),
  password: z
    .string()
    .min(8, "Password minimo 8 caracteres")
    .max(128, "Password demasiado largo"),
  phone: z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/, "Usa formato internacional, por ejemplo +5491112345678").optional(),
  deviceName: z.string().trim().max(160).optional(),
});
const passwordRecoveryRequestSchema = z.object({
  email: z.string().email("Email inválido"),
});
const passwordRecoveryConsumeSchema = z.object({
  token: z.string().min(40).max(128),
  password: z
    .string()
    .min(8, "Password mínimo 8 caracteres")
    .max(128, "Password demasiado largo"),
});
const emailVerificationRequestSchema = z.object({
  email: z.string().email("Email inválido"),
});
const emailVerificationConfirmSchema = emailVerificationRequestSchema.extend({
  code: z.string().regex(/^\d{6}$/, "Código inválido"),
});
const phoneVerificationConfirmSchema = z.object({ code: z.string().regex(/^\d{6}$/, "Código inválido") });
const mfaCodeSchema = z.object({ code: z.string().trim().min(6).max(32) });
const mfaCompleteSchema = mfaCodeSchema.extend({
  challenge: z.string().min(20),
  deviceName: z.string().trim().max(160).optional(),
});

const coordinateSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

const orderSchema = z.object({
  customerId: z.string().min(1),
  restaurantId: z.string().min(1),
  deliveryAddressId: z.string().uuid().optional(),
  branchId: z.string().min(3).max(100).optional(),
  deliveryAddress: z.string().min(3),
  paymentMethod: z.string().min(2),
  paymentMethodId: z.string().uuid().optional(),
  promotionCode: z.string().trim().min(3).max(40).optional(),
  quoteToken: z.string().min(20).optional(),
  providerPayment: z.object({
    cardToken:z.string().regex(/^[A-Za-z0-9._-]{8,256}$/).refine(value=>!/^\d{13,19}$/.test(value),"Debes enviar un token del proveedor, no el número de tarjeta"),
    paymentMethodId:z.string().regex(/^[A-Za-z0-9_-]{2,64}$/),
    installments:z.coerce.number().int().min(1).max(48).default(1),
  }).optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        quantity: z.coerce.number().int().min(1).max(30),
        extras: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
        note: z.string().trim().max(500).default(""),
      }),
    )
    .min(1),
});

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
const foodOrderQuoteSchema = z.object({
  customerId: z.string().min(1),
  restaurantId: z.string().min(1),
  deliveryAddressId: z.string().uuid(),
  branchId: z.string().min(3).max(100).optional(),
  paymentMethod: z.string().min(2).optional(),
  paymentMethodId: z.string().uuid().optional(),
  promotionCode: z.string().trim().min(3).max(40).optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        quantity: z.coerce.number().int().min(1).max(30),
        extras: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
        note: z.string().trim().max(500).default(""),
      }),
    )
    .min(1)
    .max(50)
    .optional(),
});

const cartSchema = z.object({
  restaurantId: z.string().min(1).optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        quantity: z.coerce.number().int().min(1).max(99),
        extras: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
        note: z.string().trim().max(500).default(""),
      }),
    )
    .max(99),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(32),
  deviceName: z.string().trim().max(160).optional(),
});

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
    status: z.enum([
      "under_review",
      "approved",
      "rejected",
      "settlement_pending",
      "settled",
    ]),
    resolutionNote: z.string().trim().min(5).max(1000),
    approvedAmount: z.coerce.number().positive().max(1000000).optional(),
  }),
  shipmentClaimEvidenceSchema = z.object({
    fileName: z.string().trim().min(1).max(160),
    mimeType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
    contentBase64: z.string().min(4).max(1024000),
  });
const shipmentCategoryUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    handlingInstructions: z.string().trim().min(3).max(300).optional(),
    surcharge: z.coerce.number().nonnegative().max(100000).optional(),
    maximumWeightKg: z.coerce.number().positive().max(20).optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Indicá al menos un cambio",
  );
const shipmentServiceLevelUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    transportMultiplier: z.coerce.number().min(0.5).max(5).optional(),
    etaMultiplier: z.coerce.number().min(0.25).max(3).optional(),
    maximumDistanceKm: z.coerce
      .number()
      .positive()
      .max(500)
      .nullable()
      .optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Indicá al menos un cambio",
  );
const payoutRequestSchema = z.object({
  amount: z.coerce.number().positive().max(100000000),
  merchantId: z.string().optional(),
  authorizationToken: z.string().min(20),
});
const payoutAuthorizeSchema = payoutRequestSchema.omit({authorizationToken:true}).extend({password:z.string().min(4).max(128)});
const payoutReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().min(5).max(1000),
});
const mercadoPagoWebhookSchema=z.object({id:z.union([z.string(),z.number()]),type:z.enum(["order","orders","payment","mp-connect","topic_claims_integration_wh","topic_chargebacks_wh","stop_delivery_op_wh"]),action:z.string().trim().max(120).optional(),live_mode:z.boolean().optional().default(false),date_created:z.string().datetime({offset:true}).optional(),user_id:z.union([z.string(),z.number()]).optional(),data:z.object({id:z.union([z.string(),z.number()])})});

const driverLocationSchema = coordinateSchema.extend({
  label: z.string().trim().min(2).max(120).optional(),
  source:z.enum(["foreground","background"]).optional(),
  accuracyM:z.coerce.number().min(0).max(1000).optional(),
});
const driverVehicleFields={
  kind:z.enum(["bicycle","motorcycle","car","van"]),
  model:z.string().trim().min(2).max(80),
  plate:z.string().trim().min(3).max(16).regex(/^[A-Za-z0-9 -]+$/),
  color:z.string().trim().min(2).max(40).nullable().optional(),
  seats:z.coerce.number().int().min(1).max(8).nullable().optional(),
  serviceModes:z.array(z.enum(["delivery","ride"])).min(1).max(2),
};
const driverVehicleSchema=z.object(driverVehicleFields).superRefine((value,ctx)=>{
  if(value.serviceModes.includes("ride")&&(!["car","van"].includes(value.kind)||!value.seats))ctx.addIssue({code:"custom",path:["seats"],message:"Viajes requiere auto o van con asientos declarados"});
});
const driverVehicleUpdateSchema=z.object(Object.fromEntries(Object.entries(driverVehicleFields).map(([key,value])=>[key,value.optional()]))).refine(value=>Object.keys(value).length>0,"Indicá al menos un cambio");
const driverVehicleReviewSchema=z.object({status:z.enum(["approved","rejected"]),rejectionReason:z.string().trim().max(500).nullable().optional()}).superRefine((value,ctx)=>{if(value.status==="rejected"&&(!value.rejectionReason||value.rejectionReason.length<5))ctx.addIssue({code:"custom",path:["rejectionReason"],message:"Explica el rechazo"});});

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/, "Usa formato internacional, por ejemplo +5491112345678"),
  defaultAddress: z.string().trim().min(3).max(240),
});

const walletTopUpSchema = z.object({
  amount: z.coerce.number().int().min(1000).max(200000),
});
const referralClaimSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^FLASH[A-Z0-9]{8}$/),
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
      ["driver_license", "vehicle_registration", "insurance"].includes(
        value.type,
      ) &&
      !value.expiresAt
    )
      ctx.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "El vencimiento es obligatorio",
      });
    if (
      value.expiresAt &&
      new Date(`${value.expiresAt}T23:59:59Z`) < new Date()
    )
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
    if (
      value.status === "rejected" &&
      (!value.rejectionReason || value.rejectionReason.length < 5)
    )
      ctx.addIssue({
        code: "custom",
        path: ["rejectionReason"],
        message: "Explica el rechazo",
      });
  });
const addressSchema = z.object({
  label: z.string().trim().min(1).max(60),
  address: z.string().trim().min(3).max(240),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  isDefault: z.boolean().default(false),
});
const rideDestinationSchema = z.object({
  label: z.string().trim().min(1).max(80),
  address: z.string().trim().min(3).max(240),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});
const trustedContactSchema = z.object({
  name: z.string().trim().min(2).max(80),
  relationship: z.enum(["family", "friend", "partner", "coworker", "other"]),
  phone: z
    .string()
    .trim()
    .regex(
      /^\+[1-9][0-9]{7,14}$/,
      "Usa formato internacional, por ejemplo +5491112345678",
    ),
});
const sandboxPaymentMethodSchema = z
  .object({
    providerToken: z
      .string()
      .regex(/^pm_test_[A-Za-z0-9_-]{8,120}$/, "Token sandbox inválido"),
    brand: z.enum(["visa", "mastercard", "amex", "cabal"]),
    last4: z.string().regex(/^\d{4}$/),
    expiryMonth: z.coerce.number().int().min(1).max(12),
    expiryYear: z.coerce
      .number()
      .int()
      .min(new Date().getUTCFullYear())
      .max(new Date().getUTCFullYear() + 25),
    isDefault: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    const now = new Date();
    if (
      value.expiryYear === now.getUTCFullYear() &&
      value.expiryMonth < now.getUTCMonth() + 1
    )
      ctx.addIssue({
        code: "custom",
        path: ["expiryMonth"],
        message: "La tarjeta está vencida",
      });
  });
const paymentReconciliationResolutionSchema = z.object({
  status: z.enum(["resolved", "ignored"]),
  resolutionNote: z.string().trim().min(5).max(1000),
});
const transactionRiskReviewSchema = z.object({
  reviewStatus: z.enum(["confirmed_fraud", "false_positive", "cleared"]),
  reviewNote: z.string().trim().min(5).max(1000),
});

const supportTicketCreateSchema = z.object({
  category: z.enum([
    "food",
    "ride",
    "shipment",
    "payment",
    "account",
    "safety",
    "other",
  ]),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  subject: z.string().trim().min(4).max(160),
  body: z.string().trim().min(4).max(5000),
  jobId: z.string().trim().max(64).optional(),
});
const rideTrackingCreateSchema = z.object({
  ttlMinutes: z.coerce.number().int().min(15).max(1440).default(180),
});
const rideSafetyIncidentSchema = z.object({
  type: z.enum([
    "sos",
    "unsafe_driving",
    "medical",
    "harassment",
    "crash",
    "other",
  ]),
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
const serviceMessageSchema = z
  .object({
    body: z.string().trim().max(1000).optional().default(""),
    attachment: z
      .object({
        fileName: z.string().trim().min(1).max(160),
        mimeType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
        contentBase64: z.string().min(4).max(1024000),
      })
      .optional(),
  })
  .refine(
    (value) => Boolean(value.body || value.attachment),
    "El mensaje requiere texto o adjunto",
  );
const serviceQuickReplyFields = {
  serviceScope: z.enum(["all", "food", "ride", "shipment"]),
  audience: z.enum(["customer", "driver", "merchant"]),
  locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/),
  body: z.string().trim().min(1).max(160),
  position: z.coerce.number().int().min(0).max(1000),
  active: z.boolean(),
};
const serviceQuickReplyCreateSchema = z.object(serviceQuickReplyFields),
  serviceQuickReplyUpdateSchema = z
    .object(
      Object.fromEntries(
        Object.entries(serviceQuickReplyFields).map(([key, value]) => [
          key,
          value.optional(),
        ]),
      ),
    )
    .refine((value) => Object.keys(value).length > 0, "No hay cambios");
const supportMessageSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  internal: z.boolean().default(false),
});
const supportTicketUpdateSchema = z
  .object({
    status: z
      .enum([
        "open",
        "waiting_customer",
        "waiting_operations",
        "resolved",
        "closed",
      ])
      .optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    assignedTo: z.string().trim().max(64).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Debes indicar un cambio");
const supportAgentUpdateSchema = z
  .object({
    availability: z.enum(["available", "busy", "offline"]).optional(),
    maxActiveTickets: z.coerce.number().int().min(1).max(100).optional(),
    skills: z.array(z.string().trim().min(1).max(80)).min(1).max(20).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Debes indicar un cambio");
const supportQueueProcessSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
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
      (!value.startsAt ||
        !value.endsAt ||
        new Date(value.endsAt) > new Date(value.startsAt)),
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
const favoriteSchema = z.object({ favorite: z.boolean() });
const ratingSchema = z.object({
  jobId: z.string().min(3).max(64),
  subjectType: z.enum(["driver", "merchant", "customer"]),
  score: z.coerce.number().int().min(1).max(5),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  comment: z.string().trim().max(1000).default(""),
});
const deviceSchema = z.object({
  platform: z.enum(["ios", "android", "web"]),
  pushToken: z.string().trim().min(16).max(512),
  appVersion: z.string().trim().max(40).optional(),
  deviceFingerprint: z.string().trim().min(8).max(256),
});
const notificationPreferenceSchema = z.object({
  pushEnabled: z.boolean(),
  emailEnabled: z.boolean(),
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
const userStatusSchema = z.object({
  status: z.enum(["active", "suspended"]),
  reason: z.string().trim().min(5).max(240),
});
const featureFlagUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  rolloutPercentage: z.coerce.number().int().min(0).max(100).optional(),
  allowedRoles: z.array(z.enum(["customer","merchant","driver","admin","support"])).max(5).optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  variant: z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()])).optional(),
}).refine((value)=>Object.keys(value).length>0,"Indicá al menos un cambio").refine((value)=>!value.startsAt||!value.endsAt||new Date(value.endsAt)>new Date(value.startsAt),"La fecha final debe ser posterior al inicio");
const productEventSchema=z.object({id:z.string().uuid(),name:z.enum(["home_viewed","search_started","merchant_viewed","cart_updated","checkout_started","quote_received","job_created","activity_viewed"]),surface:z.enum(["web","customer_app","driver_app","merchant_app"]),sessionId:z.string().uuid(),occurredAt:z.string().datetime(),properties:z.record(z.string(),z.union([z.string().max(80),z.number().finite(),z.boolean(),z.null()])).default({})}).superRefine((event,ctx)=>{const timestamp=new Date(event.occurredAt).getTime();if(timestamp<Date.now()-86400000||timestamp>Date.now()+300000)ctx.addIssue({code:"custom",message:"Fecha de analytics fuera de ventana"});for(const key of Object.keys(event.properties))if(/email|phone|address|coord|lat|lng|token|name|note|query|text/i.test(key))ctx.addIssue({code:"custom",message:`Propiedad sensible no permitida: ${key}`});});
const productEventsSchema=z.object({events:z.array(productEventSchema).min(1).max(20)});
const tipSchema = z.object({
  amount: z.coerce.number().int().min(100).max(100000),
});
const tipAdjustmentRequestSchema = z.object({
  tipId: z.string().trim().min(8).max(80),
  amount: z.coerce.number().positive().max(100000),
  reason: z.string().trim().min(5).max(1000),
});
const tipAdjustmentReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().min(5).max(1000),
});
const orderIssueSchema = z.object({
  category: z.enum([
    "missing_item",
    "wrong_item",
    "damaged_item",
    "quality",
    "late",
    "other",
  ]),
  description: z.string().trim().min(5).max(1000),
  requestedRefund: z.coerce.number().nonnegative().max(1000000),
});
const orderIssueResolutionSchema = z
  .object({
    status: z.enum(["approved", "rejected"]),
    approvedRefund: z.coerce.number().nonnegative().max(1000000).default(0),
    resolutionNote: z.string().trim().min(3).max(1000),
  })
  .superRefine((value, ctx) => {
    if (value.status === "rejected" && value.approvedRefund !== 0)
      ctx.addIssue({
        code: "custom",
        path: ["approvedRefund"],
        message: "Una incidencia rechazada no puede reintegrar dinero",
      });
  });
const substitutionProposalSchema = z.object({
  originalMenuItemId: z.string().min(3).max(100),
  replacementMenuItemId: z.string().min(3).max(100),
  reason: z.string().trim().min(3).max(500),
});
const substitutionDecisionSchema = z.object({
  decision: z.enum(["accepted", "rejected"]),
});
const branchUpdateSchema = z
  .object({
    open: z.boolean().optional(),
    etaMin: z.coerce.number().int().min(5).max(240).optional(),
    status: z.enum(["active", "paused", "closed"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Debes indicar un cambio");
const branchInventorySchema = z.object({
  available: z.boolean(),
  stockQuantity: z.coerce.number().int().nonnegative().nullable().optional(),
});
const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida");
const branchScheduleSchema = z
  .object({
    timezone: z.string().trim().min(3).max(100),
    hours: z
      .array(
        z.object({
          weekday: z.coerce.number().int().min(0).max(6),
          opensAt: localTimeSchema,
          closesAt: localTimeSchema,
          enabled: z.boolean(),
        }),
      )
      .length(7),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.hours.map((hour) => hour.weekday)).size !== 7)
      ctx.addIssue({
        code: "custom",
        path: ["hours"],
        message: "Debes enviar exactamente un horario por día",
      });
  });
const branchScheduleExceptionSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
    isOpen: z.boolean(),
    opensAt: localTimeSchema.optional(),
    closesAt: localTimeSchema.optional(),
    reason: z.string().trim().max(160).optional(),
  })
  .superRefine((value, ctx) => {
    const date = new Date(`${value.date}T00:00:00Z`);
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value.date
    )
      ctx.addIssue({
        code: "custom",
        path: ["date"],
        message: "Fecha calendario inválida",
      });
    if (value.isOpen && (!value.opensAt || !value.closesAt))
      ctx.addIssue({
        code: "custom",
        path: ["opensAt"],
        message: "Una excepción abierta requiere horario",
      });
  });
const itemModifierGroupsSchema = z
  .object({
    groups: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z0-9_-]{2,80}$/),
            name: z.string().trim().min(2).max(100),
            min: z.coerce.number().int().min(0).max(20),
            max: z.coerce.number().int().min(1).max(20),
            active: z.boolean().default(true),
            modifiers: z
              .array(
                z.object({
                  id: z.string().regex(/^[a-zA-Z0-9_-]{2,80}$/),
                  name: z.string().trim().min(1).max(100),
                  price: z.coerce.number().min(0).max(1000000),
                  available: z.boolean().default(true),
                }),
              )
              .max(40),
          })
          .refine(
            (group) =>
              group.min <= group.max && group.max <= group.modifiers.length,
            { message: "Los límites del grupo no coinciden con sus opciones" },
          ),
      )
      .max(12),
  })
  .superRefine((value, ctx) => {
    const groupIds = value.groups.map((group) => group.id),
      modifierIds = value.groups.flatMap((group) =>
        group.modifiers.map((modifier) => modifier.id),
      );
    if (new Set(groupIds).size !== groupIds.length)
      ctx.addIssue({
        code: "custom",
        path: ["groups"],
        message: "Los identificadores de grupo no pueden repetirse",
      });
    if (new Set(modifierIds).size !== modifierIds.length)
      ctx.addIssue({
        code: "custom",
        path: ["groups"],
        message:
          "Los identificadores de agregados deben ser únicos dentro del producto",
      });
  });
const itemDietarySchema = z.object({
  dietaryLabels: z
    .array(z.enum(["vegetarian", "vegan", "gluten_free", "halal", "kosher"]))
    .max(5)
    .refine(
      (values) => new Set(values).size === values.length,
      "No repitas restricciones",
    ),
  allergens: z
    .array(
      z.object({
        code: z.enum([
          "gluten",
          "milk",
          "eggs",
          "peanuts",
          "tree_nuts",
          "soy",
          "fish",
          "shellfish",
          "sesame",
        ]),
        presence: z.enum(["contains", "may_contain"]),
      }),
    )
    .max(9)
    .refine(
      (values) =>
        new Set(values.map((value) => value.code)).size === values.length,
      "No repitas alérgenos",
    ),
});
const userDietaryPreferenceSchema = z.object({
  dietaryLabels: z
    .array(z.enum(["vegetarian", "vegan", "gluten_free", "halal", "kosher"]))
    .max(5)
    .refine(
      (values) => new Set(values).size === values.length,
      "No repitas preferencias",
    ),
  avoidedAllergens: z
    .array(
      z.enum([
        "gluten",
        "milk",
        "eggs",
        "peanuts",
        "tree_nuts",
        "soy",
        "fish",
        "shellfish",
        "sesame",
      ]),
    )
    .max(9)
    .refine(
      (values) => new Set(values).size === values.length,
      "No repitas alérgenos",
    ),
  hideIncompatible: z.boolean(),
});
const catalogSearchSchema = z.object({
  q: z.string().trim().max(120).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});
const cancellationSchema = z
  .object({
    status: z.literal("cancelled"),
    reason: z.enum([
      "changed_mind",
      "wrong_address",
      "long_wait",
      "price",
      "driver_issue",
      "merchant_issue",
      "recipient_unavailable",
      "other",
    ]),
    reasonDetail: z.string().trim().min(3).max(500).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.reason === "other" && !value.reasonDetail)
      ctx.addIssue({
        code: "custom",
        path: ["reasonDetail"],
        message: "Describe el motivo",
      });
  });
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
  .refine(
    (value) => value.maxDistanceKm > value.minDistanceKm,
    "Distancias tarifarias inválidas",
  );
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
  .refine(
    (value) => value.maxDistanceKm > value.minDistanceKm,
    "Distancias tarifarias inválidas",
  );
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

const orderLabels = {
  accepted: "Aceptado",
  preparing: "Preparando",
  ready_for_pickup: "Listo para retirar",
  courier_assigned: "Repartidor asignado",
  picked_up: "Retirado",
  delivering: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

const rideLabels = {
  requested: "Buscando conductor",
  driver_assigned: "Conductor asignado",
  arriving: "Llegando al punto",
  in_progress: "Viaje iniciado",
  completed: "Completado",
  cancelled: "Cancelado",
};

function publicUser(db, userId) {
  const user = db.users.find((entry) => entry.id === userId);
  if (!user) return null;
  const { password, ...safeUser } = user;
  return safeUser;
}

function accountSnapshot(db, userId) {
  return {
    user: publicUser(db, userId),
    addresses: (db.addresses || []).filter((entry) => entry.userId === userId),
    paymentMethods: (db.paymentMethods || []).filter(
      (entry) => entry.userId === userId,
    ),
    walletTransactions: (db.walletTransactions || []).filter(
      (entry) => entry.userId === userId,
    ),
    supportTickets: (db.supportTickets || []).filter(
      (entry) => entry.userId === userId,
    ),
    ratings: (db.ratings || []).filter((entry) => entry.userId === userId),
  };
}

function findRestaurant(db, restaurantId) {
  return db.restaurants.find((restaurant) => restaurant.id === restaurantId);
}

function calculateOrderTotals(restaurant, items) {
  let subtotal = 0;
  const expandedItems = items.map((entry) => {
    const menuItem = restaurant.menu.find(
      (item) => item.id === entry.menuItemId,
    );
    if (!menuItem || !menuItem.stock) {
      throw new Error(`Producto no disponible: ${entry.menuItemId}`);
    }
    const quantity = Math.max(1, Number(entry.quantity || 1));
    const extras = Array.isArray(entry.extras) ? entry.extras : [];
    const extrasTotal = extras.reduce((sum, extraIdOrName) => {
      const extra = restaurant.extras.find(
        (item) => item.id === extraIdOrName || item.name === extraIdOrName,
      );
      return sum + (extra?.price || 0);
    }, 0);
    subtotal += (menuItem.price + extrasTotal) * quantity;
    return {
      menuItemId: menuItem.id,
      name: menuItem.name,
      quantity,
      unitPrice: menuItem.price,
      extras: extras.map((extraIdOrName) => {
        const extra = restaurant.extras.find(
          (item) => item.id === extraIdOrName || item.name === extraIdOrName,
        );
        return extra?.name || extraIdOrName;
      }),
      note: String(entry.note || ""),
    };
  });

  return {
    items: expandedItems,
    subtotal,
    deliveryFee: restaurant.deliveryFee,
    serviceFee,
    total: subtotal + restaurant.deliveryFee + serviceFee,
  };
}

function distanceBetween(first, second) {
  if (!first || !second) return null;
  const earthRadiusKm = 6371;
  const latDelta = ((second.lat - first.lat) * Math.PI) / 180;
  const lngDelta = ((second.lng - first.lng) * Math.PI) / 180;
  const firstLat = (first.lat * Math.PI) / 180;
  const secondLat = (second.lat * Math.PI) / 180;
  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.sin(lngDelta / 2) ** 2 * Math.cos(firstLat) * Math.cos(secondLat);
  return (
    earthRadiusKm *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

const fallbackRidePricing = {
  version: "sqlite-test-fallback",
  config: {
    baseFare: 850,
    distancePerKm: 420,
    timePerMin: 48,
    serviceFee: 390,
    tollThresholdKm: 18,
    tollAmount: 850,
    roadFactor: 1.22,
    minDistanceKm: 1.2,
    maxDistanceKm: 50,
    durationBaseMin: 8,
    durationPerKm: 2.1,
    etaBaseMin: 4,
    etaPerKm: 0.55,
    serviceMultipliers: { moto: 0.78, economy: 1, comfort: 1.28, xl: 1.65 },
  },
};
const fallbackShipmentPricing = {
  version: "sqlite-test-fallback",
  config: {
    baseFare: 1200,
    distancePerKm: 540,
    weightPerKg: 85,
    roadFactor: 1.22,
    minDistanceKm: 1,
    maxDistanceKm: 45,
    etaBaseMin: 12,
    etaPerKm: 2.2,
    minimumEtaMin: 15,
    sizeMultipliers: { small: 1, medium: 1.18, large: 1.42 },
  },
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
  const normalizedService = ["economy", "comfort", "moto", "xl"].includes(
    service,
  )
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
  const durationMin = Math.round(
    rules.durationBaseMin + distanceKm * rules.durationPerKm,
  );
  const baseFare = Number(rules.baseFare);
  const distanceFare = Math.round(distanceKm * rules.distancePerKm);
  const timeFare = Math.round(durationMin * rules.timePerMin);
  const serviceFee = Number(rules.serviceFee);
  const tolls =
    distanceKm > rules.tollThresholdKm ? Number(rules.tollAmount) : 0;
  const subtotal = Math.round(
    (baseFare + distanceFare + timeFare) * serviceMultiplier,
  );
  const demandAdjustment = Math.round(subtotal * (demandMultiplier - 1));
  const fare = Math.round(subtotal + demandAdjustment + serviceFee + tolls);
  return {
    service: normalizedService,
    distanceKm: Number(distanceKm.toFixed(1)),
    etaMin: Math.max(
      3,
      Math.round(rules.etaBaseMin + distanceKm * rules.etaPerKm),
    ),
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

function scopeStateForRequest(state, req) {
  if (isAdmin(req) || hasRole(req, "support")) return state;
  const userId = req.auth.userId;
  const scoped = { ...state };
  scoped.users = state.users.filter((user) => user.id === userId);
  scoped.addresses = (state.addresses || []).filter(
    (entry) => entry.userId === userId,
  );
  scoped.paymentMethods = (state.paymentMethods || []).filter(
    (entry) => entry.userId === userId,
  );
  scoped.walletTransactions = (state.walletTransactions || []).filter(
    (entry) => entry.userId === userId,
  );
  scoped.supportTickets = (state.supportTickets || []).filter(
    (entry) => !entry.userId || entry.userId === userId,
  );
  scoped.ratings = (state.ratings || []).filter(
    (entry) => entry.userId === userId,
  );
  scoped.auditEvents = [];

  if (hasRole(req, "customer")) {
    scoped.orders = state.orders.filter((entry) => entry.customerId === userId);
    scoped.rides = state.rides.filter((entry) => entry.customerId === userId);
    scoped.shipments = (state.shipments || []).filter(
      (entry) => entry.customerId === userId,
    );
    const assignedDriverIds = new Set(
      [
        ...scoped.orders.map((entry) => entry.courierId),
        ...scoped.rides.map((entry) => entry.driverId),
        ...scoped.shipments.map((entry) => entry.driverId),
      ].filter(Boolean),
    );
    scoped.drivers = state.drivers.filter((entry) =>
      assignedDriverIds.has(entry.id),
    );
  } else if (hasRole(req, "merchant")) {
    scoped.restaurants = state.restaurants.filter(
      (entry) => entry.ownerId === userId,
    );
    const merchantIds = new Set(scoped.restaurants.map((entry) => entry.id));
    scoped.orders = state.orders.filter((entry) =>
      merchantIds.has(entry.restaurantId),
    );
    scoped.rides = [];
    scoped.shipments = [];
    const courierIds = new Set(
      scoped.orders.map((entry) => entry.courierId).filter(Boolean),
    );
    scoped.drivers = state.drivers.filter((entry) => courierIds.has(entry.id));
  } else if (hasRole(req, "driver")) {
    const driverId = req.auth.user.driverId;
    scoped.orders = state.orders
      .filter((entry) => !entry.courierId || entry.courierId === driverId)
      .map((entry) =>
        entry.courierId === driverId
          ? entry
          : {
              ...entry,
              customerId: "private",
              deliveryAddress: "Disponible después de aceptar",
              items: entry.items.map((item) => ({ ...item, note: "" })),
            },
      );
    scoped.rides = state.rides
      .filter((entry) => !entry.driverId || entry.driverId === driverId)
      .map((entry) =>
        entry.driverId === driverId
          ? entry
          : { ...entry, customerId: "private" },
      );
    scoped.shipments = (state.shipments || [])
      .filter((entry) => !entry.driverId || entry.driverId === driverId)
      .map((entry) =>
        entry.driverId === driverId
          ? entry
          : {
              ...entry,
              customerId: "private",
              recipientName: "Oculto hasta aceptar",
              recipientPhone: "Oculto",
              deliveryNotes: "",
            },
      );
    scoped.drivers = state.drivers.filter((entry) => entry.id === driverId);
  } else {
    scoped.orders = [];
    scoped.rides = [];
    scoped.shipments = [];
    scoped.drivers = [];
  }
  return scoped;
}

async function loadRuntimeState(req) {
  if (!usesPostgresCommerce()) return getPublicState();
  const state = {
    meta: { version: 65, updatedAt: getTimestamp(), database: "postgres" },
    users: [],
    addresses: [],
    paymentMethods: [],
    walletTransactions: [],
    restaurants: [],
    drivers: [],
    orders: [],
    rides: [],
    shipments: [],
    promotions: [],
    supportTickets: [],
    ratings: [],
    zones: [],
    auditEvents: [],
    favoriteRestaurantIds: [],
    tips: [],
  };
  [
    state.users,
    state.addresses,
    state.paymentMethods,
    state.walletTransactions,
    state.restaurants,
    state.orders,
    state.drivers,
    state.rides,
    state.shipments,
    state.supportTickets,
    state.promotions,
    state.zones,
    state.auditEvents,
    state.ratings,
    state.favoriteRestaurantIds,
    state.tips,
  ] = await Promise.all([
    getPostgresUsers({ includeInactive: isAdmin(req) }),
    getPostgresAddresses(),
    getPostgresPaymentMethods(),
    getPostgresWalletTransactions({
      userPublicId: req.auth.userId,
      includeAll: isAdmin(req),
    }),
    getPostgresRestaurants(),
    getPostgresOrders(),
    getPostgresDrivers(),
    getPostgresRides(),
    getPostgresShipments(),
    getPostgresSupportTickets({
      userPublicId: req.auth.userId,
      roles: req.auth.roles,
    }),
    getPostgresPromotions({ includeInactive: isAdmin(req) }),
    getPostgresZones(),
    isAdmin(req) ? getPostgresAuditEvents(100) : Promise.resolve([]),
    getPostgresRatings({
      userPublicId: req.auth.userId,
      includeAll: isAdmin(req),
    }),
    getPostgresFavoriteMerchantIds(req.auth.userId),
    getPostgresTips({ userPublicId: req.auth.userId, roles: req.auth.roles }),
  ]);
  const balances = await getWalletBalances();
  state.users = state.users.map((user) => {
    const {password:_password,internalId:_internalId,loginLockedUntil:_loginLockedUntil,...safeUser}=user;
    return {...safeUser,wallet:balances.get(user.id)||0};
  });
  return state;
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password, internalId, loginLockedUntil, ...safeUser } = user;
  return safeUser;
}

function issueAccessToken(user, { mfaVerified = false } = {}) {
  return jwt.sign(
    { sub: user.id, roles: user.roles, mfa: mfaVerified },
    jwtSecret,
    { expiresIn: "15m" },
  );
}

function issueMfaChallenge(user) {
  return jwt.sign({ sub: user.id, purpose: "admin_mfa" }, jwtSecret, {
    expiresIn: "5m",
  });
}

async function issueSession(user, deviceName, { mfaVerified = false } = {}) {
  const session = usesPostgresAuth()
    ? await createPostgresSession(user, deviceName)
    : createAuthSession(user.id, deviceName);
  return {
    token: issueAccessToken(user, { mfaVerified }),
    refreshToken: session.refreshToken,
    refreshExpiresAt: session.expiresAt,
  };
}

const refreshCookieName = config.isProduction ? "__Host-flash_refresh" : "flash_refresh";
function isWebSessionRequest(req) {
  return req.get("x-flash-client") === "web";
}
function readRefreshCookie(req) {
  if (!isWebSessionRequest(req)) return "";
  const cookies = String(req.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator).trim() !== refreshCookieName) continue;
    try { return decodeURIComponent(cookie.slice(separator + 1).trim()); } catch { return ""; }
  }
  return "";
}
function setRefreshCookie(res, refreshToken, expiresAt) {
  res.cookie(refreshCookieName, refreshToken, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.isProduction,
    path: config.isProduction ? "/" : "/api",
    expires: new Date(expiresAt),
  });
}
function clearRefreshCookie(res) {
  res.clearCookie(refreshCookieName, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.isProduction,
    path: config.isProduction ? "/" : "/api",
  });
}
function deliverSession(req, res, session) {
  if (!isWebSessionRequest(req)) return session;
  setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
  const { refreshToken: _refreshToken, ...publicSession } = session;
  return publicSession;
}

function creditDriverEarnings(db, driverId, amount, reference) {
  const driver = db.drivers.find((entry) => entry.id === driverId);
  if (!driver || !Number.isFinite(amount) || amount <= 0) return;
  driver.earningsToday = Number(driver.earningsToday || 0) + Math.round(amount);
  const user = db.users.find((entry) => entry.id === driver.userId);
  if (user) user.wallet = Number(user.wallet || 0) + Math.round(amount);
  db.walletTransactions ||= [];
  db.walletTransactions.unshift({
    id: createId("WAL"),
    userId: driver.userId,
    kind: "credit",
    amount: Math.round(amount),
    description: `Ganancia ${reference}`,
    createdAt: getTimestamp(),
  });
}

async function creditDriverEarningsRuntime(db, driverId, amount, reference) {
  if (!usesPostgresCommerce())
    return creditDriverEarnings(db, driverId, amount, reference);
  const driver = (await getPostgresDrivers()).find(
    (entry) => entry.id === driverId,
  );
  if (!driver || amount <= 0) return;
  const publicId = reference.replace(/^(viaje|envio)-/, "");
  return settleMobilityWalletPayment({
    publicId,
    driverPublicId: driverId,
    driverAmount: Math.round(amount),
    reference,
  });
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
const requireAdminIdentity = (req, res, next) =>
  hasRole(req, "admin")
    ? next()
    : fail(res, 403, "MFA administrativo requiere rol admin");

function calculateRideOptions(
  db,
  input,
  zoneMultiplier = 1,
  pricing = fallbackRidePricing,
) {
  const eligibleDrivers = db.drivers.filter(
    (driver) =>
      driver.online &&
      driver.serviceModes.includes("ride") &&
      !db.rides.some(
        (ride) =>
          ride.driverId === driver.id &&
          !["completed", "cancelled"].includes(ride.status),
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
    const quote = calculateRideQuote(
      { ...input, service, demandMultiplier },
      pricing,
    );
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
  },
  pricing = fallbackShipmentPricing,
) {
  const rules = pricing.config;
  const coordinateDistance = distanceBetween(pickupCoords, destinationCoords);
  const textWeight = `${pickup}${destination}`.length;
  const distanceKm =
    coordinateDistance !== null
      ? Math.max(
          rules.minDistanceKm,
          Math.min(rules.maxDistanceKm, coordinateDistance * rules.roadFactor),
        )
      : Math.max(2, Math.min(25, 2 + (textWeight % 18) * 0.7));
  const sizeMultiplier = Number(rules.sizeMultipliers[packageSize]);
  const serviceMultiplier =
      shipmentServiceConfig?.level.transportMultiplier || 1,
    categorySurcharge = shipmentServiceConfig?.category.surcharge || 0,
    baseTransportFare = Math.round(
      (rules.baseFare +
        distanceKm * rules.distancePerKm +
        Number(weightKg) * rules.weightPerKg) *
        sizeMultiplier *
        deliveryMultiplier,
    ),
    transportFare =
      Math.round(baseTransportFare * serviceMultiplier) + categorySurcharge,
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
    protectionPlanId:
      protection === "standard" ? protectionPlan?.id || null : null,
    deductible: protection === "standard" ? protectionPlan?.deductible || 0 : 0,
    itemCategory: shipmentServiceConfig?.category.code || "standard",
    itemCategoryName:
      shipmentServiceConfig?.category.name || "Paquete estándar",
    itemCategoryId: shipmentServiceConfig?.category.id || null,
    handlingInstructions:
      shipmentServiceConfig?.category.handlingInstructions || "",
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
    estimated: coordinateDistance === null,
    routingMode: coordinateDistance === null ? "text-estimate" : "coordinates",
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
      distance:
        distanceBetween(entry.location, shipment.pickupLocation) ??
        Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => left.distance - right.distance)[0]?.entry;
  if (!driver) return shipment;
  return {
    ...shipment,
    driverId: driver.id,
    status: "driver_assigned",
    timeline: [
      ...shipment.timeline,
      { status: "driver_assigned", at: getTimestamp() },
    ],
  };
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
      distance:
        distanceBetween(driver.location, ride.pickupLocation) ??
        Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => left.distance - right.distance);
  const driver = candidates[0]?.driver;
  if (!driver) return ride;
  return {
    ...ride,
    driverId: driver.id,
    status: "driver_assigned",
    timeline: [
      ...ride.timeline,
      { status: "driver_assigned", at: getTimestamp() },
    ],
  };
}

function nextOrderStatus(order) {
  if (order.status === "accepted") return "preparing";
  if (order.status === "preparing") return "ready_for_pickup";
  if (order.status === "courier_assigned") return "picked_up";
  if (order.status === "picked_up") return "delivering";
  if (order.status === "delivering") return "delivered";
  return null;
}

function nextRideStatus(ride) {
  if (ride.status === "driver_assigned") return "arriving";
  if (ride.status === "arriving") return "in_progress";
  if (ride.status === "in_progress") return "completed";
  return null;
}

function addTimeline(entity, status) {
  return {
    ...entity,
    status,
    timeline: [
      ...(entity.timeline || []),
      {
        status,
        at: getTimestamp(),
      },
    ],
  };
}

function metrics(db) {
  const activeOrderStatuses = [
    "accepted",
    "preparing",
    "ready_for_pickup",
    "courier_assigned",
    "picked_up",
    "delivering",
  ];
  const activeRideStatuses = [
    "requested",
    "driver_assigned",
    "arriving",
    "in_progress",
  ];
  const activeOrders = db.orders.filter((order) =>
    activeOrderStatuses.includes(order.status),
  );
  const activeRides = db.rides.filter((ride) =>
    activeRideStatuses.includes(ride.status),
  );
  const completedRevenue = [
    ...db.orders
      .filter((order) => order.status === "delivered")
      .map((order) => order.total),
    ...db.rides
      .filter((ride) => ride.status === "completed")
      .map((ride) => ride.fare),
  ].reduce((sum, value) => sum + value, 0);
  const openTickets = db.supportTickets.filter(
    (ticket) => ticket.status === "open",
  ).length;
  return {
    activeOrders: activeOrders.length,
    activeRides: activeRides.length,
    onlineDrivers: db.drivers.filter((driver) => driver.online).length,
    openRestaurants: db.restaurants.filter((restaurant) => restaurant.open)
      .length,
    completedRevenue,
    openTickets,
    avgOrderEta: activeOrders.length
      ? Math.round(
          activeOrders.reduce((sum, order) => sum + order.etaMin, 0) /
            activeOrders.length,
        )
      : 0,
    avgRideEta: activeRides.length
      ? Math.round(
          activeRides.reduce((sum, ride) => sum + ride.etaMin, 0) /
            activeRides.length,
        )
      : 0,
  };
}

function ratio(part, total) {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(1));
}

function average(values) {
  if (!values.length) return 0;
  return Math.round(
    values.reduce((sum, value) => sum + value, 0) / values.length,
  );
}

function adminSnapshot(db, financial = null) {
  const activeOrders = db.orders.filter(
    (order) => !["delivered", "cancelled"].includes(order.status),
  );
  const activeRides = db.rides.filter(
    (ride) => !["completed", "cancelled"].includes(ride.status),
  );
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
  const unassignedOrders = activeOrders.filter(
    (order) => !order.courierId,
  ).length;
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
      fillRateRide: ratio(
        db.rides.filter((ride) => ride.driverId).length,
        db.rides.length,
      ),
      cancellationRate: ratio(cancelledJobs, totalJobs),
      supplyDemandRatio: Number(
        (
          db.drivers.filter((driver) => driver.online).length /
          Math.max(1, activeOrders.length + activeRides.length)
        ).toFixed(2),
      ),
      unassignedOrders,
      unassignedRides,
      openRestaurants: db.restaurants.filter((restaurant) => restaurant.open)
        .length,
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
            ratio(
              db.orders.filter((order) => order.courierId).length,
              db.orders.length,
            ) *
              0.16 +
            ratio(
              db.rides.filter((ride) => ride.driverId).length,
              db.rides.length,
            ) *
              0.16,
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
          value:
            financial?.revenueCoverage === "wallet_settlements"
              ? "Flash Wallet"
              : "Sin datos",
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
          db.supportTickets.filter((ticket) => ticket.status === "open")
            .length > 5
            ? "high"
            : "low",
        label: "Tickets abiertos",
        value: db.supportTickets.filter((ticket) => ticket.status === "open")
          .length,
      },
      {
        id: "supply",
        level:
          db.drivers.filter((driver) => driver.online).length < 2
            ? "medium"
            : "low",
        label: "Supply online",
        value: db.drivers.filter((driver) => driver.online).length,
      },
    ],
    zones: db.zones || [],
    recentAuditEvents: (db.auditEvents || []).slice(0, 10),
  };
}

app.get("/api/health", (_req, res) => {
  ok(res, {
    service: "flash-fullstack-api",
    environment: config.env,
    storageMode: config.databaseUrl ? "postgres-primary" : "sqlite-demo",
    timestamp: getTimestamp(),
  });
});

app.get("/api/openapi.json", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=900");
  return res.json(openApiDocument);
});

app.get("/api/ready", async (_req, res) => {
  try {
    if (draining) return fail(res, 503, "La instancia está drenando conexiones");
    const db = config.databaseUrl ? null : readDb();
    const postgres = await postgresReadiness();
    const redis = await redisReadiness();
    if (config.databaseUrl && !postgres.ready)
      return fail(res, 503, "PostgreSQL/PostGIS no disponible");
    if (config.isProduction && config.databaseUrl && !postgres.least_privilege)
      return fail(res, 503, "El rol PostgreSQL del runtime tiene privilegios incompatibles con producción");
    if (config.redis.required && !redis.ready)
      return fail(res, 503, "Redis distribuido no disponible");
    const runtimeCounts = usesPostgresCommerce()
      ? await Promise.all([
          getPostgresUsers(),
          getPostgresRestaurants(),
          getPostgresDrivers(),
        ])
      : [db.users, db.restaurants, db.drivers];
    return ok(res, {
      service: "flash-fullstack-api",
      database: postgres,
      redis,
      runtimeStore: config.databaseUrl ? "postgres-primary" : "sqlite-demo",
      fallbackDiagnostics: { sqliteReads: sqliteRuntimeReads },
      authStore: usesPostgresAuth() ? "postgres" : "sqlite-test-fallback",
      domainStores: {
        catalog: usesPostgresCommerce() ? "postgres" : "sqlite-test-fallback",
        carts: usesPostgresCommerce() ? "postgres" : "sqlite-test-fallback",
        foodOrders: usesPostgresCommerce()
          ? "postgres"
          : "sqlite-test-fallback",
        drivers: usesPostgresCommerce()
          ? "postgres-postgis"
          : "sqlite-test-fallback",
        driverLocations: usesPostgresCommerce()
          ? "postgres-postgis+source+accuracy+freshness-gate"
          : "sqlite-test-fallback",
        driverVehicles: usesPostgresCommerce()
          ? "postgres-verified-registry+mode-eligibility"
          : "sqlite-test-fallback",
        rides: usesPostgresCommerce()
          ? "postgres-postgis"
          : "sqlite-test-fallback",
        shipments: usesPostgresCommerce()
          ? "postgres-postgis"
          : "sqlite-test-fallback",
        dispatch: usesPostgresCommerce()
          ? "postgres-postgis-expiring-offers+wave-worker"
          : "sqlite-test-fallback",
        wallet: usesPostgresAuth()
          ? "postgres-double-entry-ledger"
          : "sqlite-test-fallback",
        payments: usesPostgresAuth()
          ? "wallet-capture-refunds+signed-webhooks+balanced-settlements+tips+dual-control-adjustments+reconciliation-cases+risk-scoring"
          : "sqlite-test-fallback",
        receipts: usesPostgresAuth()
          ? "postgres-immutable-service-snapshots"
          : "sqlite-test-fallback",
        cancellations: usesPostgresAuth()
          ? "postgres-auditable-reasons+refund-outcomes"
          : "sqlite-test-fallback",
        orderIssues: usesPostgresAuth()
          ? "postgres-workflow+partial-refunds+settlement-reversal"
          : "sqlite-test-fallback",
        substitutions: usesPostgresAuth()
          ? "postgres-customer-consent+wallet-price-adjustment"
          : "sqlite-test-fallback",
        merchantBranches: usesPostgresAuth()
          ? "postgres-postgis+branch-inventory"
          : "sqlite-test-fallback",
        merchantFinance: usesPostgresAuth()
          ? "postgres-ledger+payout-reservations+independent-review"
          : "sqlite-test-fallback",
        support: usesPostgresAuth()
          ? "postgres-conversations+priority-sla+capacity-routing+automatic-escalation"
          : "sqlite-test-fallback",
        notifications: usesPostgresAuth()
          ? `postgres-outbox+preferences+in-app+invalid-token-revocation+dead-letter-replay+${config.notificationProvider}-worker`
          : "sqlite-test-fallback",
        realtime: usesPostgresAuth()
          ? "postgres-event-log+listen-notify+sse-replay"
          : "memory-test-fallback",
        promotions: usesPostgresCommerce()
          ? "postgres-transactional-redemptions"
          : "sqlite-test-fallback",
        zones: usesPostgresCommerce()
          ? "postgres-postgis-live-counts"
          : "sqlite-test-fallback",
        pricing: usesPostgresCommerce()
          ? "postgres-versioned-plans+signed-quotes"
          : "sqlite-test-fallback",
        audit: usesPostgresCommerce()
          ? "postgres-operational-events"
          : "sqlite-test-fallback",
        feedback: usesPostgresCommerce()
          ? "postgres-ratings+favorites"
          : "sqlite-test-fallback",
        addresses: usesPostgresAuth()
          ? "postgres-postgis-address-book"
          : "sqlite-test-fallback",
        rideDestinations: usesPostgresAuth()
          ? "postgres-postgis-private-recents"
          : "sqlite-test-fallback",
        rideTrustedContacts: usesPostgresAuth()
          ? "postgres-rls+aes256gcm-private-contacts"
          : "unavailable",
        ridePickupVerification: usesPostgresAuth()
          ? "postgres-bcrypt-pin+lockout"
          : "unavailable",
        serviceChat: usesPostgresAuth()
          ? "postgres-aes256gcm+participant-rls+receipts+attachments+configured-replies"
          : "unavailable",
        maps: usesPostgresAuth()
          ? "nominatim+osrm+postgres-ttl-cache"
          : "external-provider-only",
        driverCompliance: usesPostgresAuth()
          ? "postgres-kyc+encrypted-documents+manual-review"
          : "unavailable",
        rideSafety: usesPostgresAuth()
          ? "postgres-expiring-tracking-links+sos-incidents"
          : "unavailable",
        passwordRecovery: usesPostgresAuth()
          ? `postgres-one-time-digests+encrypted-${config.emailProvider}-email+session-revocation`
          : "unavailable",
        emailVerification: usesPostgresAuth()
          ? `postgres-bcrypt-otp+encrypted-${config.emailProvider}-email+login-gate`
          : "unavailable",
        shipmentClaims: usesPostgresAuth()
          ? "postgres-protection-eligibility+encrypted-evidence+auditable-workflow"
          : "unavailable",
      },
      users: runtimeCounts[0].length,
      restaurants: runtimeCounts[1].length,
      drivers: runtimeCounts[2].length,
      timestamp: getTimestamp(),
    });
  } catch (_error) {
    return fail(res, 503, "Base de datos no disponible");
  }
});

const bootstrapAudienceRoles = {
  customer: "customer",
  merchant: "merchant",
  driver: "driver",
  operations: "admin",
};

app.get("/api/bootstrap/:audience", requireAuth, async (req, res) => {
  const requiredRole = bootstrapAudienceRoles[req.params.audience];
  if (!requiredRole) return fail(res, 404, "Audiencia inexistente");
  if (!req.auth.roles.includes(requiredRole))
    return fail(res, 403, "La audiencia no pertenece a esta sesión");
  const state = await loadRuntimeState(req);
  const scopedState = scopeStateForRequest(state, req);
  const { orders: _orders, rides: _rides, shipments: _shipments, tips: _tips, ...withoutActivity } = scopedState;
  const excludedBootstrapKeys=["customer","merchant","driver","operations"].includes(req.params.audience)?["restaurants","drivers","zones","promotions","addresses","paymentMethods","walletTransactions","supportTickets","ratings","favoriteRestaurantIds","tips",...(req.params.audience==="operations"?["users","auditEvents"]:[])]:[];
  const bootstrapState=Object.fromEntries(Object.entries(withoutActivity).filter(([key])=>!excludedBootstrapKeys.includes(key)));
  res.set("Cache-Control", "no-store, private");
  ok(res, {
    audience: req.params.audience,
    state: {
      ...bootstrapState,
      metrics: metrics(scopedState),
    },
  });
});

app.get("/api/me/activity", requireAuth, async (req,res)=>{
  const limit=Math.min(50,Math.max(1,Number(req.query.limit)||20));
  const cursor=decodeActivityCursor(String(req.query.cursor||""));
  if(req.query.cursor&&!cursor)return fail(res,400,"Cursor de actividad inválido");
  if(!usesPostgresCommerce()){
    const scoped=scopeStateForRequest(getPublicState(),req),items=[
      ...scoped.orders.map(resource=>({id:resource.id,kind:"order",createdAt:resource.createdAt,resource})),
      ...scoped.rides.map(resource=>({id:resource.id,kind:"ride",createdAt:resource.createdAt,resource})),
      ...(scoped.shipments||[]).map(resource=>({id:resource.id,kind:"shipment",createdAt:resource.createdAt,resource})),
    ].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,limit);
    res.set("Cache-Control","no-store, private");return ok(res,{items,nextCursor:null});
  }
  try{res.set("Cache-Control","no-store, private");return ok(res,await getActivityPage({userPublicId:req.auth.userId,roles:req.auth.roles,limit,cursor}));}
  catch(error){return fail(res,error.status||500,error.message||"No se pudo cargar la actividad");}
});

app.get("/api/driver/me", requireAuth, requireAnyRole("driver"), async (req,res)=>{
  try {
    const driver=usesPostgresCommerce()
      ? await getPostgresDriverForUser(req.auth.userId)
      : readDb().drivers.find((entry)=>entry.userId===req.auth.userId)||null;
    if(!driver)return fail(res,404,"Perfil de conductor no encontrado");
    res.set("Cache-Control","no-store, private");
    return ok(res,{driver});
  } catch(error) {
    return fail(res,error.status||500,error.message||"No se pudo cargar el perfil del conductor");
  }
});

app.get("/api/merchant/me", requireAuth, requireAnyRole("merchant"), async (req,res)=>{
  try {
    const restaurants=usesPostgresCommerce()
      ? await getPostgresRestaurants({ownerPublicId:req.auth.userId})
      : readDb().restaurants.filter((entry)=>entry.ownerId===req.auth.userId);
    res.set("Cache-Control","no-store, private");
    return ok(res,{restaurants});
  } catch(error) {
    return fail(res,error.status||500,error.message||"No se pudo cargar el comercio");
  }
});

app.get("/api/me/assigned-drivers",requireAuth,requireAnyRole("customer","merchant"),async(req,res)=>{
  try {
    const drivers=usesPostgresCommerce()
      ? await getAssignedDriverProjections({userPublicId:req.auth.userId,roles:req.auth.roles})
      : scopeStateForRequest(getPublicState(),req).drivers.map(({id,name,rating,vehicle,plate,vehicleKind,location})=>({id,name,rating,vehicle,plate,vehicleKind,location}));
    res.set("Cache-Control","no-store, private");
    return ok(res,{drivers});
  } catch(error) {
    return fail(res,error.status||500,error.message||"No se pudieron cargar los conductores asignados");
  }
});

const publicRestaurantFallback=restaurant=>{const{ownerId:_ownerId,manualOpen:_manualOpen,...safe}=restaurant;return{...safe,branches:(restaurant.branches||[]).map(({manualOpen:_branchManual,weeklyHours:_hours,scheduleExceptions:_exceptions,inventory:_inventory,...branch})=>branch)};};
app.get("/api/catalog/restaurants",async(req,res)=>{const limit=Math.min(50,Math.max(1,Number(req.query.limit)||20)),query=String(req.query.q||"").slice(0,100);let cursor=null;if(req.query.cursor){try{cursor=JSON.parse(Buffer.from(String(req.query.cursor),"base64url").toString("utf8"));if(typeof cursor.id!=="string"||!cursor.createdAt)throw new Error();}catch{return fail(res,400,"Cursor de catálogo inválido");}}try{res.set("Cache-Control","public, max-age=30, stale-while-revalidate=120");if(!usesPostgresCommerce()){const normalized=query.trim().toLowerCase(),all=getPublicState().restaurants.filter(item=>!normalized||`${item.name} ${item.cuisine}`.toLowerCase().includes(normalized)).map(publicRestaurantFallback),offset=cursor?Math.max(0,all.findIndex(item=>item.id===cursor.id)+1):0,restaurants=all.slice(offset,offset+limit),last=restaurants.at(-1),nextCursor=offset+limit<all.length&&last?Buffer.from(JSON.stringify({createdAt:new Date(0).toISOString(),id:last.id})).toString("base64url"):null;return ok(res,{restaurants,nextCursor});}return ok(res,await getPostgresRestaurantPage({limit,cursor,query}));}catch(error){return fail(res,500,error.message||"No se pudo cargar el catálogo");}});

function parseOperationsCursor(value){if(!value)return null;try{const cursor=JSON.parse(Buffer.from(String(value),"base64url").toString("utf8"));if(typeof cursor.id!=="string"||!/^[0-9]{4}-/.test(cursor.createdAt))return false;return cursor;}catch{return false;}}
function parseOperationsTimestampCursor(value,field,numericId=false){if(!value)return null;try{const cursor=JSON.parse(Buffer.from(String(value),"base64url").toString("utf8"));const validId=numericId?/^\d+$/.test(cursor.id):typeof cursor.id==="string"&&/^[a-zA-Z0-9._:-]+$/.test(cursor.id);if(!validId||typeof cursor[field]!=="string"||!/^[0-9]{4}-/.test(cursor[field]))throw new Error();return cursor;}catch{return false;}}
const fallbackOperationsCursorDate="1970-01-01T00:00:00.000Z";
function paginateFallbackOperations(items,{limit,cursor,query,search,cursorField="createdAt",cursorKey=cursorField,map=item=>item}){const normalized=query.trim().toLowerCase(),filtered=items.filter(item=>!normalized||search(item).toLowerCase().includes(normalized)),cursorIndex=cursor?filtered.findIndex(item=>String(item.id)===String(cursor.id)):-1,offset=cursor?Math.max(0,cursorIndex+1):0,page=filtered.slice(offset,offset+limit),last=page.at(-1);return{items:page.map(map),nextCursor:offset+limit<filtered.length&&last?Buffer.from(JSON.stringify({[cursorKey]:last[cursorField]||fallbackOperationsCursorDate,id:String(last.id)})).toString("base64url"):null};}
const fallbackOperationsSupportTicket=ticket=>({...ticket,title:ticket.title||ticket.subject||"",userId:ticket.userId||null,jobId:ticket.jobId||null,assignedTo:ticket.assignedTo||null,firstResponseDueAt:ticket.firstResponseDueAt||null,resolutionDueAt:ticket.resolutionDueAt||null,firstRespondedAt:ticket.firstRespondedAt||null,lastEscalatedAt:ticket.lastEscalatedAt||null,escalationLevel:Number(ticket.escalationLevel||0),messages:ticket.messages||[],assignmentHistory:ticket.assignmentHistory||[],escalations:ticket.escalations||[],slaStatus:ticket.slaStatus||"on_track"});
const fallbackOperationsAuditEvent=event=>({...event,id:String(event.id),actorId:event.actorId||null,payload:event.payload||{},createdAt:event.createdAt||fallbackOperationsCursorDate});
app.get("/api/operations/restaurants",requireAuth,requireAnyRole("admin"),async(req,res)=>{const limit=Math.min(100,Math.max(1,Number(req.query.limit)||50)),cursor=parseOperationsCursor(req.query.cursor),query=String(req.query.q||"").slice(0,100);if(cursor===false)return fail(res,400,"Cursor operativo inválido");try{res.set("Cache-Control","no-store, private");if(!usesPostgresCommerce()){const page=paginateFallbackOperations(readDb().restaurants,{limit,cursor,query,search:item=>[item.id,item.name,item.cuisine,item.address].join(" ")});return ok(res,{restaurants:page.items,nextCursor:page.nextCursor});}return ok(res,await getPostgresOperationsRestaurantPage({limit,cursor,query}));}catch(error){return fail(res,error.status||500,error.message||"No se pudieron cargar los comercios operativos");}});
app.get("/api/operations/drivers",requireAuth,requireAnyRole("admin"),async(req,res)=>{const limit=Math.min(100,Math.max(1,Number(req.query.limit)||50)),cursor=parseOperationsCursor(req.query.cursor),query=String(req.query.q||"").slice(0,100);if(cursor===false)return fail(res,400,"Cursor operativo inválido");try{res.set("Cache-Control","no-store, private");if(!usesPostgresCommerce()){const page=paginateFallbackOperations(readDb().drivers,{limit,cursor,query,search:item=>[item.id,item.name,item.vehicle,item.plate].join(" "),map:item=>({...item,vehicleStatus:item.vehicleStatus||null})});return ok(res,{drivers:page.items,nextCursor:page.nextCursor});}return ok(res,await getPostgresOperationsDriverPage({limit,cursor,query}));}catch(error){return fail(res,error.status||500,error.message||"No se pudo cargar la flota operativa");}});
app.get("/api/operations/users",requireAuth,requireAnyRole("admin"),async(req,res)=>{const limit=Math.min(100,Math.max(1,Number(req.query.limit)||50)),cursor=parseOperationsCursor(req.query.cursor),query=String(req.query.q||"").slice(0,100);if(cursor===false)return fail(res,400,"Cursor operativo inválido");try{res.set("Cache-Control","no-store, private");if(!usesPostgresCommerce()){const page=paginateFallbackOperations(readDb().users.map(sanitizeUser),{limit,cursor,query,search:item=>[item.id,item.name,item.email].join(" ")});return ok(res,{users:page.items,nextCursor:page.nextCursor});}const page=await getPostgresOperationsUserPage({limit,cursor,query}),balances=await getWalletBalances();page.users=page.users.map(user=>({...user,wallet:balances.get(user.id)||0}));return ok(res,page);}catch(error){return fail(res,error.status||500,error.message||"No se pudieron cargar los usuarios operativos");}});
app.get("/api/operations/support-tickets",requireAuth,requireAnyRole("admin"),async(req,res)=>{const limit=Math.min(100,Math.max(1,Number(req.query.limit)||50)),query=String(req.query.q||"").slice(0,100),cursor=parseOperationsTimestampCursor(req.query.cursor,"updatedAt");if(cursor===false)return fail(res,400,"Cursor operativo inválido");try{res.set("Cache-Control","no-store, private");if(!usesPostgresCommerce()){const page=paginateFallbackOperations(readDb().supportTickets.map(fallbackOperationsSupportTicket),{limit,cursor,query,cursorField:"updatedAt",search:item=>[item.id,item.title,item.service,item.priority].join(" ")});return ok(res,{tickets:page.items,nextCursor:page.nextCursor});}return ok(res,await getPostgresOperationsSupportTicketPage({limit,cursor,query}));}catch(error){return fail(res,error.status||500,error.message||"No se pudo cargar la mesa de ayuda");}});
app.get("/api/operations/audit-events",requireAuth,requireAnyRole("admin"),async(req,res)=>{const limit=Math.min(100,Math.max(1,Number(req.query.limit)||50)),query=String(req.query.q||"").slice(0,100),cursor=parseOperationsTimestampCursor(req.query.cursor,"occurredAt",usesPostgresCommerce());if(cursor===false)return fail(res,400,"Cursor operativo inválido");try{res.set("Cache-Control","no-store, private");if(!usesPostgresCommerce()){const page=paginateFallbackOperations(readDb().auditEvents.map(fallbackOperationsAuditEvent),{limit,cursor,query,cursorField:"createdAt",cursorKey:"occurredAt",search:item=>[item.id,item.actorId,item.entityType,item.entityId,item.action].join(" ")});return ok(res,{events:page.items,nextCursor:page.nextCursor});}return ok(res,await getPostgresAuditEventPage({limit,cursor,query}));}catch(error){return fail(res,error.status||500,error.message||"No se pudo cargar la auditoría");}});
app.get("/api/features",requireAuth,async(req,res)=>{try{res.set("Cache-Control","no-store, private");return ok(res,{features:usesPostgresAuth()?await evaluateFeatureFlags({userId:req.auth.userId,roles:req.auth.roles}):{delivery_beta:{active:true,variant:{phase:"local_demo"}},shipment_beta:{active:true,variant:{phase:"local_demo"}},public_rides:{active:false,variant:{}}}});}catch(_error){return ok(res,{features:{},degraded:true});}});
app.get("/api/operations/feature-flags",requireAuth,requireAnyRole("admin"),async(_req,res)=>{try{res.set("Cache-Control","no-store, private");return ok(res,{flags:await getFeatureFlags()});}catch(error){return fail(res,error.status||500,error.message||"No se pudieron cargar los feature flags");}});
app.patch("/api/operations/feature-flags/:flagId",requireAuth,requireAnyRole("admin"),async(req,res)=>{const parsed=parseOrFail(featureFlagUpdateSchema,req.body||{});if(!parsed.ok)return fail(res,400,parsed.message);try{const before=(await getFeatureFlags()).find((flag)=>flag.id===req.params.flagId);if(!before)return fail(res,404,"Feature flag no encontrado");const flag=await updateFeatureFlag({publicId:req.params.flagId,changes:parsed.data});await recordPostgresAudit({actorPublicId:req.auth.userId,roles:req.auth.roles,action:"feature_flag.updated",entityType:"feature_flag",entityId:flag.id,requestId:req.requestId,beforeData:before,afterData:flag});return ok(res,{flag});}catch(error){return fail(res,error.status||500,error.message||"No se pudo actualizar el feature flag");}});
app.post("/api/analytics/events",requireAuth,async(req,res)=>{const parsed=parseOrFail(productEventsSchema,req.body||{});if(!parsed.ok)return fail(res,400,parsed.message);try{const result=usesPostgresAuth()?await ingestProductEvents({userPublicId:req.auth.userId,events:parsed.data.events}):createLocalProductEvents({userId:req.auth.userId,events:parsed.data.events});return res.status(202).json({ok:true,requestId:req.requestId,...result});}catch(error){return fail(res,error.status||500,error.message||"No se pudieron registrar los eventos");}});
app.get("/api/operations/product-metrics",requireAuth,requireAnyRole("admin"),async(req,res)=>{const days=Math.min(90,Math.max(1,Number(req.query.days)||7));try{res.set("Cache-Control","no-store, private");const metrics=usesPostgresAuth()?await getProductMetrics({days}):getLocalProductMetrics({days});return ok(res,{metrics});}catch(error){return fail(res,error.status||500,error.message||"No se pudieron calcular las métricas de producto");}});
app.get("/api/operations/zones/:zoneId/readiness",requireAuth,requireAnyRole("admin"),async(req,res)=>{try{res.set("Cache-Control","no-store, private");return ok(res,{readiness:await getZoneReadiness(req.params.zoneId)});}catch(error){return fail(res,error.status||500,error.message||"No se pudo evaluar la zona");}});
app.post("/api/operations/zones/:zoneId/readiness-assessments",requireAuth,requireAnyRole("admin"),async(req,res)=>{try{const assessment=await assessZoneReadiness({zonePublicId:req.params.zoneId,actorPublicId:req.auth.userId});await recordPostgresAudit({actorPublicId:req.auth.userId,roles:req.auth.roles,action:"zone.readiness_assessed",entityType:"service_zone",entityId:req.params.zoneId,requestId:req.requestId,afterData:{assessmentId:assessment.id,decision:assessment.decision,checks:assessment.checks}});return res.status(201).json({ok:true,requestId:req.requestId,assessment});}catch(error){return fail(res,error.status||500,error.message||"No se pudo registrar la evaluación");}});

app.get("/api/state", requireAuth, (_req,res) => {
  res.set("Cache-Control","no-store");
  return fail(res,410,"El estado global fue retirado; usa bootstrap y recursos segmentados");
});

app.get("/api/public/rides/track/:token", async (req, res) => {
  const token = String(req.params.token || "");
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token))
    return fail(res, 404, "El enlace no existe o venció");
  try {
    res.set("Cache-Control", "no-store, private");
    return ok(res, { tracking: await getPublicRideTracking(token) });
  } catch (error) {
    return fail(
      res,
      error.status || 500,
      error.message || "No se pudo consultar el viaje",
    );
  }
});
app.post(
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
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo compartir el viaje",
      );
    }
  },
);
app.delete(
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
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo revocar el enlace",
      );
    }
  },
);
app.post(
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
      return res
        .status(201)
        .json({ ok: true, requestId: req.requestId, incident });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo activar Seguridad Flash",
      );
    }
  },
);
app.get(
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
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo consultar el PIN de retiro",
      );
    }
  },
);
app.post(
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
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo verificar el pasajero",
        error.attemptsRemaining === undefined
          ? undefined
          : { attemptsRemaining: error.attemptsRemaining },
      );
    }
  },
);
app.get(
  "/api/jobs/:jobId/messages",
  requireAuth,
  requireAnyRole("customer", "driver", "merchant"),
  async (req, res) => {
    try {
      return ok(
        res,
        await getServiceMessages({
          jobPublicId: req.params.jobId,
          userPublicId: req.auth.userId,
        }),
      );
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo abrir la conversación",
      );
    }
  },
);
app.post(
  "/api/jobs/:jobId/messages/read",
  requireAuth,
  requireAnyRole("customer", "driver", "merchant"),
  async (req, res) => {
    try {
      return ok(res, {
        receipt: await markServiceMessagesRead({
          jobPublicId: req.params.jobId,
          userPublicId: req.auth.userId,
        }),
      });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo confirmar la lectura",
      );
    }
  },
);
app.post(
  "/api/jobs/:jobId/messages",
  serviceChatLimiter,
  requireAuth,
  requireAnyRole("customer", "driver", "merchant"),
  async (req, res) => {
    const parsed = parseOrFail(serviceMessageSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const message = await createServiceMessage({
        jobPublicId: req.params.jobId,
        userPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "service_message.created",
        entityType: "job",
        entityId: req.params.jobId,
        requestId: req.requestId,
        afterData: {
          messageId: message.id,
          attachmentIds: message.attachments.map((entry) => entry.id),
        },
      });
      await publishRealtimeEvent({
        req,
        type: "service.message_created",
        entityType: "job",
        entityId: req.params.jobId,
        action: "service_message.created",
      });
      return res
        .status(201)
        .json({ ok: true, requestId: req.requestId, message });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo enviar el mensaje",
      );
    }
  },
);
app.get(
  "/api/service-message-attachments/:attachmentId/content",
  serviceChatLimiter,
  requireAuth,
  requireAnyRole("customer", "driver", "merchant"),
  async (req, res) => {
    try {
      return ok(
        res,
        await getServiceAttachmentContent({
          attachmentPublicId: req.params.attachmentId,
          userPublicId: req.auth.userId,
        }),
      );
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo abrir el adjunto",
      );
    }
  },
);
app.get(
  "/api/jobs/:jobId/quick-replies",
  requireAuth,
  requireAnyRole("customer", "driver", "merchant"),
  async (req, res) => {
    try {
      return ok(
        res,
        await getServiceQuickReplies({
          jobPublicId: req.params.jobId,
          userPublicId: req.auth.userId,
          locale: String(req.query.locale || "es-AR"),
        }),
      );
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudieron cargar respuestas rápidas",
      );
    }
  },
);
app.get(
  "/api/admin/service-chat/quick-replies",
  requireAuth,
  requireAnyRole("admin"),
  async (_req, res) =>
    ok(res, { quickReplies: await listServiceQuickReplies() }),
);
app.post(
  "/api/admin/service-chat/quick-replies",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const parsed = parseOrFail(serviceQuickReplyCreateSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const quickReply = await createServiceQuickReply(parsed.data);
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "service_chat.quick_reply_created",
        entityType: "service_chat_quick_reply",
        entityId: quickReply.id,
        requestId: req.requestId,
        afterData: quickReply,
      });
      return res
        .status(201)
        .json({ ok: true, requestId: req.requestId, quickReply });
    } catch (error) {
      return fail(
        res,
        error.code === "23505" ? 409 : error.status || 500,
        error.code === "23505" ? "La respuesta ya existe" : error.message,
      );
    }
  },
);
app.patch(
  "/api/admin/service-chat/quick-replies/:quickReplyId",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const parsed = parseOrFail(serviceQuickReplyUpdateSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const quickReply = await updateServiceQuickReply({
        publicId: req.params.quickReplyId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "service_chat.quick_reply_updated",
        entityType: "service_chat_quick_reply",
        entityId: quickReply.id,
        requestId: req.requestId,
        afterData: quickReply,
      });
      return ok(res, { quickReply });
    } catch (error) {
      return fail(
        res,
        error.code === "23505" ? 409 : error.status || 500,
        error.code === "23505" ? "La respuesta ya existe" : error.message,
      );
    }
  },
);

app.post(
  "/api/payment-methods/sandbox",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    if (config.isProduction) return fail(res, 404, "Ruta no disponible");
    const parsed = parseOrFail(sandboxPaymentMethodSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const paymentMethod = await createSandboxPaymentMethod({
        userPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "payment_method.created",
        entityType: "payment_method",
        entityId: paymentMethod.id,
        requestId: req.requestId,
        afterData: {
          provider: "sandbox",
          brand: paymentMethod.brand,
          last4: paymentMethod.last4,
        },
      });
      return res
        .status(201)
        .json({ ok: true, requestId: req.requestId, paymentMethod });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo registrar el método de pago",
      );
    }
  },
);
app.patch(
  "/api/payment-methods/:paymentMethodId/default",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    try {
      const paymentMethod = await setDefaultPostgresPaymentMethod({
        userPublicId: req.auth.userId,
        paymentMethodId: req.params.paymentMethodId,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "payment_method.default_changed",
        entityType: "payment_method",
        entityId: paymentMethod.id,
        requestId: req.requestId,
      });
      return ok(res, { paymentMethod });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo cambiar el método predeterminado",
      );
    }
  },
);
app.delete(
  "/api/payment-methods/:paymentMethodId",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    try {
      const paymentMethods = await revokePostgresPaymentMethod({
        userPublicId: req.auth.userId,
        paymentMethodId: req.params.paymentMethodId,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "payment_method.revoked",
        entityType: "payment_method",
        entityId: req.params.paymentMethodId,
        requestId: req.requestId,
      });
      return ok(res, {
        paymentMethods: paymentMethods.filter(
          (entry) => entry.userId === req.auth.userId,
        ),
      });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo eliminar el método de pago",
      );
    }
  },
);

app.get("/api/support/tickets", requireAuth, async (req, res) => {
  if (!usesPostgresCommerce())
    return ok(res, {
      tickets: scopeStateForRequest(getPublicState(), req).supportTickets || [],
    });
  try {
    return ok(res, {
      tickets: await getPostgresSupportTickets({
        userPublicId: req.auth.userId,
        roles: req.auth.roles,
      }),
    });
  } catch (error) {
    return fail(
      res,
      error.status || 500,
      error.message || "No se pudo cargar soporte",
    );
  }
});
app.post("/api/support/tickets", requireAuth, async (req, res) => {
  if (!usesPostgresCommerce())
    return fail(res, 503, "Soporte real requiere PostgreSQL");
  const idempotencyKey=String(req.get("idempotency-key")||"");
  if(!/^[a-zA-Z0-9._:-]{16,128}$/.test(idempotencyKey))return fail(res,400,"Idempotency-Key válido es obligatorio");
  const parsed = parseOrFail(supportTicketCreateSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    const created = await createPostgresSupportTicket({
      userPublicId: req.auth.userId,
      idempotencyKey,
      ...parsed.data,
      jobPublicId:parsed.data.jobId,
    });
    const ticket=created.ticket;
    if(!created.replayed)await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "support.created",
      entityType: "support_ticket",
      entityId: ticket.id,
      requestId: req.requestId,
      afterData: {
        category: parsed.data.category,
        priority: parsed.data.priority,
      },
    });
    if(!created.replayed)await publishRealtimeEvent({
      req,
      type: "support.updated",
      entityType: "support_ticket",
      entityId: ticket.id,
      action: "support.created",
    });
    return res
      .status(201)
      .json({ ok: true, requestId: res.locals.requestId, ticket });
  } catch (error) {
    return fail(
      res,
      error.status || 500,
      error.message || "No se pudo crear el ticket",
    );
  }
});
app.post(
  "/api/support/tickets/:ticketId/messages",
  requireAuth,
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "Soporte real requiere PostgreSQL");
    const idempotencyKey=String(req.get("idempotency-key")||"");
    if(!/^[a-zA-Z0-9._:-]{16,128}$/.test(idempotencyKey))return fail(res,400,"Idempotency-Key válido es obligatorio");
    const parsed = parseOrFail(supportMessageSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const created = await addPostgresSupportMessage({
        ticketPublicId: req.params.ticketId,
        senderPublicId: req.auth.userId,
        roles: req.auth.roles,
        idempotencyKey,
        ...parsed.data,
      });
      const ticket=created.ticket;
      if(!created.replayed)await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: parsed.data.internal
          ? "support.internal_note_created"
          : "support.message_created",
        entityType: "support_ticket",
        entityId: ticket.id,
        requestId: req.requestId,
        afterData: { internal: parsed.data.internal },
      });
      if(!created.replayed)await publishRealtimeEvent({
        req,
        type: "support.updated",
        entityType: "support_ticket",
        entityId: ticket.id,
        action: "support.message_created",
      });
      return ok(res, { ticket });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo enviar el mensaje",
      );
    }
  },
);
app.patch(
  "/api/support/tickets/:ticketId",
  requireAuth,
  requireAnyRole("support", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(supportTicketUpdateSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const ticket = await updatePostgresSupportTicket({
        ticketPublicId: req.params.ticketId,
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "support.updated",
        entityType: "support_ticket",
        entityId: ticket.id,
        requestId: req.requestId,
        afterData: parsed.data,
      });
      return ok(res, { ticket });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo actualizar el ticket",
      );
    }
  },
);
app.get(
  "/api/admin/support/agents",
  requireAuth,
  requireAnyRole("support", "admin"),
  async (_req, res) => {
    try {
      return ok(res, { agents: await getSupportAgents() });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudieron cargar los agentes",
      );
    }
  },
);
app.patch(
  "/api/admin/support/agents/:userId",
  requireAuth,
  requireAnyRole("support", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(supportAgentUpdateSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const agent = await updateSupportAgent({
        userPublicId: req.params.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "support.agent_updated",
        entityType: "support_agent",
        entityId: agent.userId,
        requestId: req.requestId,
        afterData: parsed.data,
      });
      return ok(res, { agent });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo actualizar el agente",
      );
    }
  },
);
app.post(
  "/api/admin/support/process",
  requireAuth,
  requireAnyRole("support", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(supportQueueProcessSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const result = await processSupportQueue(parsed.data);
      for (const escalation of result.escalated)
        await recordPostgresAudit({
          actorPublicId: req.auth.userId,
          roles: req.auth.roles,
          action: "support.sla_escalated",
          entityType: "support_ticket",
          entityId: escalation.ticketId,
          requestId: req.requestId,
          afterData: {
            level: escalation.level,
            breachKind: escalation.breachKind,
          },
        });
      return ok(res, { result });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo procesar la cola de soporte",
      );
    }
  },
);
app.get("/api/notifications", requireAuth, async (req, res) => {
  if (!usesPostgresCommerce()) return ok(res, { notifications: getLocalNotifications(req.auth.userId) });
  try {
    return ok(res, {
      notifications: await getPostgresNotifications(req.auth.userId),
    });
  } catch (_error) {
    return fail(res, 500, "No se pudieron cargar las notificaciones");
  }
});
app.patch(
  "/api/notifications/:notificationId/read",
  requireAuth,
  async (req, res) => {
    if (!usesPostgresCommerce()) {
      try {
        return ok(res, {
          notifications: markLocalNotificationRead({
            userId: req.auth.userId,
            notificationId: req.params.notificationId
          })
        });
      } catch (error) {
        return fail(res, error.status || 500, error.message || "No se pudo marcar la notificación");
      }
    }
    try {
      return ok(res, {
        notifications: await markPostgresNotificationRead({
          publicId: req.params.notificationId,
          userPublicId: req.auth.userId,
        }),
      });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo marcar la notificación",
      );
    }
  },
);
app.get("/api/notification-preferences", requireAuth, async (req, res) => {
  if (!usesPostgresCommerce())
    return ok(res, { preferences: getLocalNotificationPreferences(req.auth.userId) });
  try {
    return ok(res, {
      preferences: await getPostgresNotificationPreferences(req.auth.userId),
    });
  } catch (_error) {
    return fail(res, 500, "No se pudieron cargar las preferencias");
  }
});
app.patch(
  "/api/notification-preferences/:category",
  requireAuth,
  async (req, res) => {
    const category = String(req.params.category);
    if (
      ![
        "service_updates",
        "promotions",
        "support",
        "wallet",
        "account",
      ].includes(category)
    )
      return fail(res, 400, "Categoría inválida");
    const parsed = parseOrFail(notificationPreferenceSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    if (!usesPostgresCommerce()) {
      const preferences = updateLocalNotificationPreference({
        userId: req.auth.userId,
        category,
        ...parsed.data
      });
      await auditRuntime(
        readDb(),
        req,
        "notification_preference",
        category,
        "notification_preference.updated",
        parsed.data
      );
      return ok(res, {
        preferences
      });
    }
    try {
      const preferences = await updatePostgresNotificationPreference({
        userPublicId: req.auth.userId,
        category,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "notification_preference.updated",
        entityType: "notification_preference",
        entityId: category,
        requestId: req.requestId,
        afterData: parsed.data,
      });
      return ok(res, { preferences });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo actualizar la preferencia",
      );
    }
  },
);
app.get(
  "/api/dietary-preferences",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    try {
      if (!usesPostgresAuth()) {
        return ok(res, {
          preferences: getLocalDietaryPreferences(req.auth.userId),
        });
      }
      return ok(res, {
        preferences: await getUserDietaryPreferences(req.auth.userId),
      });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudieron cargar las preferencias alimentarias",
      );
    }
  },
);
app.put(
  "/api/dietary-preferences",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(userDietaryPreferenceSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      if (!usesPostgresAuth()) {
        const preferences = replaceLocalDietaryPreferences({
          userId: req.auth.userId,
          ...parsed.data,
        });
        await auditRuntime(
          readDb(),
          req,
          "user",
          req.auth.userId,
          "user.dietary_preferences_updated",
          {
            dietaryCount: parsed.data.dietaryLabels.length,
            allergenCount: parsed.data.avoidedAllergens.length,
            hideIncompatible: parsed.data.hideIncompatible,
          },
        );
        return ok(res, { preferences });
      }
      const preferences = await replaceUserDietaryPreferences({
        userPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "user.dietary_preferences_updated",
        entityType: "user",
        entityId: req.auth.userId,
        requestId: req.requestId,
        afterData: {
          dietaryCount: parsed.data.dietaryLabels.length,
          allergenCount: parsed.data.avoidedAllergens.length,
          hideIncompatible: parsed.data.hideIncompatible,
        },
      });
      return ok(res, { preferences });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message ||
          "No se pudieron actualizar las preferencias alimentarias",
      );
    }
  },
);
app.get(
  "/api/catalog/search",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "La búsqueda de catálogo requiere PostgreSQL");
    const parsed = parseOrFail(catalogSearchSchema, req.query);
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      return ok(
        res,
        await searchPostgresCatalog({
          userPublicId: req.auth.userId,
          query: parsed.data.q,
          limit: parsed.data.limit,
          offset: parsed.data.offset,
        }),
      );
    } catch (_error) {
      return fail(res, 500, "No se pudo buscar el catálogo");
    }
  },
);
app.get("/api/devices", requireAuth, async (req, res) => {
  try {
    return ok(res, { devices: await getPostgresDevices(req.auth.userId) });
  } catch (_error) {
    return fail(res, 500, "No se pudieron cargar los dispositivos");
  }
});
app.post("/api/devices", requireAuth, async (req, res) => {
  const parsed = parseOrFail(deviceSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    const fingerprint = crypto
        .createHmac("sha256", jwtSecret)
        .update(parsed.data.deviceFingerprint)
        .digest("hex"),
      device = await registerPostgresDevice({
        userPublicId: req.auth.userId,
        platform: parsed.data.platform,
        pushToken: parsed.data.pushToken,
        appVersion: parsed.data.appVersion,
        fingerprint,
      });
    await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "device.registered",
      entityType: "user_device",
      entityId: device.id,
      requestId: req.requestId,
      afterData: { platform: device.platform, appVersion: device.appVersion },
    });
    return res
      .status(201)
      .json({ ok: true, requestId: res.locals.requestId, device });
  } catch (error) {
    return fail(
      res,
      error.status || 500,
      error.message || "No se pudo registrar el dispositivo",
    );
  }
});
app.delete("/api/devices/:deviceId", requireAuth, async (req, res) => {
  try {
    await revokePostgresDevice({
      userPublicId: req.auth.userId,
      devicePublicId: req.params.deviceId,
    });
    await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "device.revoked",
      entityType: "user_device",
      entityId: req.params.deviceId,
      requestId: req.requestId,
    });
    return ok(res, { revoked: true });
  } catch (error) {
    return fail(
      res,
      error.status || 500,
      error.message || "No se pudo revocar el dispositivo",
    );
  }
});
app.get(
  "/api/driver/offers",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
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
app.post(
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
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo rechazar la oferta",
      );
    }
  },
);
app.post(
  "/api/admin/dispatch/process",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    try {
      return ok(res, {
        result: await processPostgresDispatchBatch({
          limit: Math.min(100, Math.max(1, Number(req.body?.limit) || 20)),
        }),
      });
    } catch (_error) {
      return fail(res, 500, "No se pudo procesar el dispatch");
    }
  },
);
app.post(
  "/api/admin/notifications/process",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    if (
      config.notificationProvider === "disabled" &&
      config.emailProvider === "disabled"
    )
      return fail(
        res,
        503,
        "Los proveedores de notificaciones están deshabilitados",
      );
    try {
      return ok(res, {
        result: await processPostgresNotificationBatch({
          workerId: `api-${process.pid}`,
          limit: Math.min(100, Math.max(1, Number(req.body?.limit) || 25)),
          provider: config.notificationProvider,
        }),
      });
    } catch (_error) {
      return fail(res, 500, "No se pudo procesar la cola de notificaciones");
    }
  },
);
app.get(
  "/api/admin/notifications/dead-letters",
  requireAuth,
  requireAnyRole("admin"),
  async (_req, res) => {
    try {
      return ok(res, { deadLetters: await getNotificationDeadLetters() });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo cargar la cola de descarte",
      );
    }
  },
);
app.post(
  "/api/admin/notifications/dead-letters/:notificationId/replay",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    try {
      const deadLetter = await replayNotificationDeadLetter({
        notificationPublicId: req.params.notificationId,
        actorPublicId: req.auth.userId,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "notification.dead_letter_replayed",
        entityType: "notification",
        entityId: req.params.notificationId,
        requestId: req.requestId,
        afterData: {
          reason: deadLetter.reason,
          replayCount: deadLetter.replayCount,
        },
      });
      return ok(res, { deadLetter });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo reintentar la notificación",
      );
    }
  },
);

app.get("/api/promotions", async (_req, res) => {
  try {
    res.set("Cache-Control","public, max-age=30, stale-while-revalidate=120");
    return ok(res, {
      promotions: usesPostgresCommerce()
        ? await getPostgresPromotions()
        : readDb().promotions,
    });
  } catch (_error) {
    return fail(res, 500, "No se pudieron cargar las promociones");
  }
});
app.post(
  "/api/promotions",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "Promociones reales requieren PostgreSQL");
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
      return res
        .status(201)
        .json({ ok: true, requestId: res.locals.requestId, promotion });
    } catch (error) {
      return fail(
        res,
        error.code === "23505" ? 409 : error.status || 500,
        error.code === "23505"
          ? "El código ya existe"
          : error.message || "No se pudo crear la promoción",
      );
    }
  },
);
app.patch(
  "/api/promotions/:promotionId",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const parsed = parseOrFail(promotionUpdateSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const promotion = await updatePostgresPromotion(
        req.params.promotionId,
        parsed.data,
      );
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
      return fail(
        res,
        error.code === "23505" ? 409 : error.status || 500,
        error.code === "23505"
          ? "El código ya existe"
          : error.message || "No se pudo actualizar la promoción",
      );
    }
  },
);
app.get("/api/cities", async (_req, res) => {
  try {
    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=900");
    return ok(res, {
      cities: usesPostgresCommerce()
        ? await getPublicCities()
        : [{ id: "CITY-BA", slug: "buenos-aires", name: "Buenos Aires", countryCode: "AR", currency: "ARS", timezone: "America/Argentina/Buenos_Aires", status: "beta", enabledServices: ["delivery", "shopping"], center: { lat: -34.6037, lng: -58.3816 } }],
    });
  } catch (_error) {
    return fail(res, 500, "No se pudieron cargar las ciudades");
  }
});
app.get("/api/zones", async (req, res) => {
  try {
    const citySlug = String(req.query.city || "buenos-aires");
    if (!/^[a-z0-9-]{2,40}$/.test(citySlug)) return fail(res, 400, "Ciudad inválida");
    if (usesPostgresCommerce() && !(await findPublicCity(citySlug))) return fail(res, 404, "Ciudad no habilitada");
    res.set("Cache-Control","public, max-age=30, stale-while-revalidate=120");
    return ok(res, {
      city: citySlug,
      zones: usesPostgresCommerce() ? await getPostgresZones({ citySlug }) : citySlug === "buenos-aires" ? readDb().zones : [],
    });
  } catch (_error) {
    return fail(res, 500, "No se pudieron cargar las zonas");
  }
});
app.get("/api/pricing", async (_req, res) => {
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
app.get("/api/shipment-options", async (_req, res) => {
  if (!usesPostgresCommerce())
    return fail(
      res,
      503,
      "Las opciones operativas de envío requieren PostgreSQL",
    );
  try {
    return ok(res, await getShipmentOptions());
  } catch (_error) {
    return fail(res, 500, "No se pudieron cargar las opciones de envío");
  }
});
app.get(
  "/api/admin/shipment-options",
  requireAuth,
  requireAnyRole("admin"),
  async (_req, res) => {
    if (!usesPostgresCommerce())
      return fail(
        res,
        503,
        "Las opciones operativas de envío requieren PostgreSQL",
      );
    try {
      return ok(res, await getShipmentOptions({ includeInactive: true }));
    } catch (_error) {
      return fail(res, 500, "No se pudo cargar la configuración de envíos");
    }
  },
);
app.patch(
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
        category = await updateShipmentItemCategory(
          req.params.code,
          parsed.data,
        );
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
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo actualizar la categoría",
      );
    }
  },
);
app.patch(
  "/api/admin/shipment-service-levels/:code",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const parsed = parseOrFail(
      shipmentServiceLevelUpdateSchema,
      req.body || {},
    );
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const before =
          (
            await getShipmentOptions({ includeInactive: true })
          ).serviceLevels.find((entry) => entry.code === req.params.code) ||
          null,
        serviceLevel = await updateShipmentServiceLevel(
          req.params.code,
          parsed.data,
        );
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
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo actualizar el nivel de servicio",
      );
    }
  },
);
app.get(
  "/api/admin/pricing-changes",
  requireAuth,
  requireAnyRole("admin"),
  async (_req, res) => {
    try {
      return ok(res, { requests: await getPostgresPricingChangeRequests() });
    } catch (error) {
      return fail(
        res,
        500,
        error.message || "No se pudo cargar la cola tarifaria",
      );
    }
  },
);
app.post(
  "/api/admin/pricing/:service",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "La configuración tarifaria requiere PostgreSQL");
    const service = String(req.params.service),
      base = parseOrFail(pricingPlanSchema, req.body || {});
    if (!base.ok || !["food", "ride", "shipment"].includes(service))
      return fail(
        res,
        400,
        base.ok ? "Servicio tarifario inválido" : base.message,
      );
    const schemas = {
        food: foodPricingConfigSchema,
        ride: ridePricingConfigSchema,
        shipment: shipmentPricingConfigSchema,
      },
      validatedConfig = parseOrFail(schemas[service], base.data.config);
    if (!validatedConfig.ok) return fail(res, 400, validatedConfig.message);
    const effectiveAt = base.data.effectiveAt
      ? new Date(base.data.effectiveAt)
      : new Date();
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
      return res
        .status(201)
        .json({ ok: true, requestId: req.requestId, changeRequest });
    } catch (error) {
      return fail(
        res,
        error.code === "23505" ? 409 : error.status || 500,
        error.code === "23505"
          ? "La versión tarifaria ya existe"
          : error.message || "No se pudo solicitar la tarifa",
      );
    }
  },
);
app.post(
  "/api/admin/pricing/:service/rollback",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const service = String(req.params.service),
      parsed = parseOrFail(pricingRollbackSchema, req.body || {});
    if (!parsed.ok || !["food", "ride", "shipment"].includes(service))
      return fail(
        res,
        400,
        parsed.ok ? "Servicio tarifario inválido" : parsed.message,
      );
    const effectiveAt = parsed.data.effectiveAt
      ? new Date(parsed.data.effectiveAt)
      : new Date();
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
      return res
        .status(201)
        .json({ ok: true, requestId: req.requestId, changeRequest });
    } catch (error) {
      return fail(
        res,
        error.code === "23505" ? 409 : error.status || 500,
        error.code === "23505"
          ? "La versión de rollback ya existe"
          : error.message || "No se pudo solicitar el rollback",
      );
    }
  },
);
app.patch(
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
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo revisar la tarifa",
      );
    }
  },
);
app.patch(
  "/api/zones/:zoneId",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
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
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo actualizar la zona",
      );
    }
  },
);
app.get("/api/favorites", requireAuth, async (req, res) => {
  try {
    return ok(res, {
      restaurantIds: usesPostgresCommerce()
        ? await getPostgresFavoriteMerchantIds(req.auth.userId)
        : [],
    });
  } catch (_error) {
    return fail(res, 500, "No se pudieron cargar favoritos");
  }
});
app.put(
  "/api/favorites/:restaurantId",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(favoriteSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const restaurantIds = await setPostgresFavorite({
        userPublicId: req.auth.userId,
        merchantPublicId: req.params.restaurantId,
        favorite: parsed.data.favorite,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: parsed.data.favorite ? "favorite.added" : "favorite.removed",
        entityType: "merchant",
        entityId: req.params.restaurantId,
        requestId: req.requestId,
      });
      return ok(res, { restaurantIds });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo actualizar favoritos",
      );
    }
  },
);
app.get("/api/ratings", requireAuth, async (req, res) => {
  try {
    return ok(res, {
      ratings: await getPostgresRatings({
        userPublicId: req.auth.userId,
        includeAll: isAdmin(req),
      }),
    });
  } catch (_error) {
    return fail(res, 500, "No se pudieron cargar calificaciones");
  }
});
app.post("/api/ratings", requireAuth, async (req, res) => {
  const parsed = parseOrFail(ratingSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    const rating = await createPostgresRating({
      jobPublicId: parsed.data.jobId,
      authorPublicId: req.auth.userId,
      subjectType: parsed.data.subjectType,
      score: parsed.data.score,
      tags: parsed.data.tags,
      comment: parsed.data.comment,
    });
    await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "rating.created",
      entityType: "rating",
      entityId: rating.id,
      requestId: req.requestId,
      afterData: {
        jobId: rating.jobId,
        subjectType: rating.subjectType,
        score: rating.score,
      },
    });
    return res
      .status(201)
      .json({ ok: true, requestId: res.locals.requestId, rating });
  } catch (error) {
    return fail(
      res,
      error.status || 500,
      error.message || "No se pudo guardar la calificación",
    );
  }
});

app.get("/api/me", requireAuth, async (req, res) => {
  const db = usesPostgresAuth() ? null : readDb();
  const account = usesPostgresAuth()
    ? {
        user: null,
        addresses: [],
        paymentMethods: [],
        walletTransactions: [],
        supportTickets: [],
        ratings: [],
      }
    : accountSnapshot(db, req.auth.userId);
  if (usesPostgresAuth()) {
    account.user = sanitizeUser(await findAuthUserByPublicId(req.auth.userId));
    const [wallet, addresses, paymentMethods, supportTickets, ratings] =
      await Promise.all([
        getWallet(req.auth.userId),
        getPostgresAddresses(req.auth.userId),
        getPostgresPaymentMethods(),
        getPostgresSupportTickets({
          userPublicId: req.auth.userId,
          roles: [],
        }),
        getPostgresRatings({ userPublicId: req.auth.userId }),
      ]);
    account.user.wallet = wallet.balance;
    account.walletTransactions = wallet.transactions;
    account.addresses = addresses;
    account.paymentMethods = paymentMethods.filter(
      (entry) => entry.userId === req.auth.userId,
    );
    account.supportTickets = supportTickets;
    account.ratings = ratings;
    account.favoriteRestaurantIds=await getPostgresFavoriteMerchantIds(req.auth.userId);
    account.tips=await getPostgresTips({userPublicId:req.auth.userId,roles:[]});
  }
  res.set("Cache-Control","no-store, private");
  return ok(res, { account });
});

app.get("/api/addresses", requireAuth, async (req, res) => {
  if (!usesPostgresAuth()) {
    const db = readDb();
    return ok(res, {
      addresses: (db.addresses || []).filter((entry) => entry.userId === req.auth.userId),
    });
  }
  return ok(res, { addresses: await getPostgresAddresses(req.auth.userId) });
});
app.post("/api/addresses", requireAuth, async (req, res) => {
  const parsed = parseOrFail(addressSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  if (!usesPostgresAuth()) {
    const db = readDb();
    const user = db.users.find((entry) => entry.id === req.auth.userId);
    if (!user) return fail(res, 404, "Usuario no encontrado");
    const owned = (db.addresses || []).filter((entry) => entry.userId === user.id);
    if (owned.length >= 20) return fail(res, 409, "Alcanzaste el límite de direcciones guardadas");
    const address = {
      id: createId("ADDR"),
      userId: user.id,
      ...parsed.data,
      isDefault: parsed.data.isDefault || owned.length === 0,
    };
    if (address.isDefault) {
      (db.addresses || []).forEach((entry) => {
        if (entry.userId === user.id) entry.isDefault = false;
      });
      user.defaultAddress = address.address;
    }
    db.addresses = [...(db.addresses || []), address];
    audit(db, req, "address", address.id, "address.created", {
      label: address.label,
      isDefault: address.isDefault,
    });
    writeDb(db);
    await publishRealtimeEvent({
      req,
      type: "user.updated",
      entityType: "address",
      entityId: address.id,
      action: "address.created",
    });
    return res.status(201).json({
      ok: true,
      requestId: req.requestId,
      address,
      addresses: db.addresses.filter((entry) => entry.userId === user.id),
    });
  }
  try {
    const address = await createPostgresAddress({
      userPublicId: req.auth.userId,
      ...parsed.data,
    });
    await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "address.created",
      entityType: "address",
      entityId: address.id,
      requestId: req.requestId,
      afterData: { label: address.label, isDefault: address.isDefault },
    });
    await publishRealtimeEvent({
      req,
      type: "user.updated",
      entityType: "address",
      entityId: address.id,
      action: "address.created",
    });
    return res.status(201).json({
      ok: true,
      requestId: req.requestId,
      address,
      addresses: await getPostgresAddresses(req.auth.userId),
    });
  } catch (error) {
    return fail(
      res,
      error.status || 500,
      error.message || "No se pudo guardar la dirección",
    );
  }
});
app.put("/api/addresses/:addressId", requireAuth, async (req, res) => {
  const parsed = parseOrFail(addressSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  if (!usesPostgresAuth()) {
    const db = readDb();
    const address = (db.addresses || []).find(
      (entry) => entry.id === req.params.addressId && entry.userId === req.auth.userId,
    );
    if (!address) return fail(res, 404, "Dirección no encontrada");
    const nextIsDefault = parsed.data.isDefault || address.isDefault;
    if (nextIsDefault) {
      (db.addresses || []).forEach((entry) => {
        if (entry.userId === req.auth.userId) entry.isDefault = false;
      });
      const user = db.users.find((entry) => entry.id === req.auth.userId);
      if (user) user.defaultAddress = parsed.data.address;
    }
    Object.assign(address, { ...parsed.data, isDefault: nextIsDefault });
    audit(db, req, "address", address.id, "address.updated", {
      label: address.label,
      isDefault: address.isDefault,
    });
    writeDb(db);
    return ok(res, {
      address,
      addresses: db.addresses.filter((entry) => entry.userId === req.auth.userId),
    });
  }
  try {
    const address = await updatePostgresAddress({
      userPublicId: req.auth.userId,
      addressId: req.params.addressId,
      ...parsed.data,
    });
    await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "address.updated",
      entityType: "address",
      entityId: address.id,
      requestId: req.requestId,
      afterData: { label: address.label, isDefault: address.isDefault },
    });
    return ok(res, {
      address,
      addresses: await getPostgresAddresses(req.auth.userId),
    });
  } catch (error) {
    return fail(
      res,
      error.code === "22P02" ? 404 : error.status || 500,
      error.code === "22P02"
        ? "Dirección no encontrada"
        : error.message || "No se pudo actualizar la dirección",
    );
  }
});
app.patch(
  "/api/addresses/:addressId/default",
  requireAuth,
  async (req, res) => {
    if (!usesPostgresAuth()) {
      const db = readDb();
      const address = (db.addresses || []).find(
        (entry) => entry.id === req.params.addressId && entry.userId === req.auth.userId,
      );
      if (!address) return fail(res, 404, "Dirección no encontrada");
      (db.addresses || []).forEach((entry) => {
        if (entry.userId === req.auth.userId) entry.isDefault = false;
      });
      address.isDefault = true;
      const user = db.users.find((entry) => entry.id === req.auth.userId);
      if (user) user.defaultAddress = address.address;
      audit(db, req, "address", address.id, "address.default_changed", {
        isDefault: true,
      });
      writeDb(db);
      await publishRealtimeEvent({
        req,
        type: "user.updated",
        entityType: "address",
        entityId: address.id,
        action: "address.default_changed",
      });
      return ok(res, {
        address,
        addresses: db.addresses.filter((entry) => entry.userId === req.auth.userId),
      });
    }
    try {
      const address = await setPostgresDefaultAddress({
        userPublicId: req.auth.userId,
        addressId: req.params.addressId,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "address.default_changed",
        entityType: "address",
        entityId: address.id,
        requestId: req.requestId,
        afterData: { isDefault: true },
      });
      await publishRealtimeEvent({
        req,
        type: "user.updated",
        entityType: "address",
        entityId: address.id,
        action: "address.default_changed",
      });
      return ok(res, {
        address,
        addresses: await getPostgresAddresses(req.auth.userId),
      });
    } catch (error) {
      return fail(
        res,
        error.code === "22P02" ? 404 : error.status || 500,
        error.code === "22P02"
          ? "Dirección no encontrada"
          : error.message || "No se pudo cambiar la dirección principal",
      );
    }
  },
);
app.delete("/api/addresses/:addressId", requireAuth, async (req, res) => {
  if (!usesPostgresAuth()) {
    const db = readDb();
    const addressIndex = (db.addresses || []).findIndex(
      (entry) => entry.id === req.params.addressId && entry.userId === req.auth.userId,
    );
    if (addressIndex < 0) return fail(res, 404, "Dirección no encontrada");
    const [deletedAddress] = db.addresses.splice(addressIndex, 1);
    if (deletedAddress.isDefault) {
      const nextDefault = db.addresses.find((entry) => entry.userId === req.auth.userId);
      const user = db.users.find((entry) => entry.id === req.auth.userId);
      if (nextDefault) {
        nextDefault.isDefault = true;
        if (user) user.defaultAddress = nextDefault.address;
      } else if (user) {
        user.defaultAddress = "";
      }
    }
    audit(db, req, "address", deletedAddress.id, "address.deleted", {});
    writeDb(db);
    await publishRealtimeEvent({
      req,
      type: "user.updated",
      entityType: "address",
      entityId: deletedAddress.id,
      action: "address.deleted",
    });
    return ok(res, {
      deleted: true,
      addresses: db.addresses.filter((entry) => entry.userId === req.auth.userId),
    });
  }
  try {
    const addresses = await deletePostgresAddress({
      userPublicId: req.auth.userId,
      addressId: req.params.addressId,
    });
    await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "address.deleted",
      entityType: "address",
      entityId: req.params.addressId,
      requestId: req.requestId,
    });
    await publishRealtimeEvent({
      req,
      type: "user.updated",
      entityType: "address",
      entityId: req.params.addressId,
      action: "address.deleted",
    });
    return ok(res, { deleted: true, addresses });
  } catch (error) {
    return fail(
      res,
      error.code === "22P02" ? 404 : error.status || 500,
      error.code === "22P02"
        ? "Dirección no encontrada"
        : error.message || "No se pudo eliminar la dirección",
    );
  }
});
app.get(
  "/api/ride-destinations",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    try {
      return ok(res, {
        destinations: await getPostgresRideDestinations(req.auth.userId),
      });
    } catch (_error) {
      return fail(res, 500, "No se pudieron cargar los destinos recientes");
    }
  },
);
app.post(
  "/api/ride-destinations",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(rideDestinationSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const destination = await recordPostgresRideDestination({
        userPublicId: req.auth.userId,
        ...parsed.data,
      });
      return res.status(201).json({
        ok: true,
        requestId: req.requestId,
        destination,
        destinations: await getPostgresRideDestinations(req.auth.userId),
      });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo guardar el destino reciente",
      );
    }
  },
);
app.delete(
  "/api/ride-destinations/:destinationId",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    try {
      const destinations = await deletePostgresRideDestination({
        userPublicId: req.auth.userId,
        destinationId: req.params.destinationId,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "ride_destination.deleted",
        entityType: "ride_destination",
        entityId: req.params.destinationId,
        requestId: req.requestId,
      });
      return ok(res, { deleted: true, destinations });
    } catch (error) {
      return fail(
        res,
        error.code === "22P02" ? 404 : error.status || 500,
        error.code === "22P02"
          ? "Destino reciente no encontrado"
          : error.message || "No se pudo eliminar el destino",
      );
    }
  },
);
app.get(
  "/api/ride-trusted-contacts",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    try {
      return ok(res, {
        contacts: await getPostgresTrustedContacts(req.auth.userId),
      });
    } catch (_error) {
      return fail(res, 500, "No se pudieron cargar los contactos de confianza");
    }
  },
);
app.post(
  "/api/ride-trusted-contacts",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(trustedContactSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const contact = await createPostgresTrustedContact({
        userPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "ride_trusted_contact.created",
        entityType: "ride_trusted_contact",
        entityId: contact.id,
        requestId: req.requestId,
        afterData: { relationship: contact.relationship, last4: contact.last4 },
      });
      return res.status(201).json({
        ok: true,
        requestId: req.requestId,
        contact,
        contacts: await getPostgresTrustedContacts(req.auth.userId),
      });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo guardar el contacto de confianza",
      );
    }
  },
);
app.delete(
  "/api/ride-trusted-contacts/:contactId",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    try {
      const contacts = await deletePostgresTrustedContact({
        userPublicId: req.auth.userId,
        contactId: req.params.contactId,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "ride_trusted_contact.deleted",
        entityType: "ride_trusted_contact",
        entityId: req.params.contactId,
        requestId: req.requestId,
      });
      return ok(res, { deleted: true, contacts });
    } catch (error) {
      return fail(
        res,
        error.code === "22P02" ? 404 : error.status || 500,
        error.code === "22P02"
          ? "Contacto de confianza no encontrado"
          : error.message || "No se pudo eliminar el contacto",
      );
    }
  },
);

app.post("/api/me/phone-verification/request", requireAuth, async (req, res) => {
  if (!usesPostgresAuth()) return fail(res, 503, "La verificación telefónica requiere PostgreSQL");
  try { return ok(res, await requestPhoneVerification(req.auth.userId)); }
  catch (error) { if (error.retryAfter) res.set("Retry-After", String(error.retryAfter)); return fail(res,error.status||500,error.message||"No se pudo enviar el código"); }
});

app.post("/api/me/phone-verification/confirm", requireAuth, async (req, res) => {
  const parsed = parseOrFail(phoneVerificationConfirmSchema, req.body || {});
  if (!parsed.ok) return fail(res,400,parsed.message);
  if (!usesPostgresAuth()) return fail(res,503,"La verificación telefónica requiere PostgreSQL");
  try { return ok(res, await confirmPhoneVerification({userPublicId:req.auth.userId,code:parsed.data.code})); }
  catch (error) { return fail(res,error.status||500,error.message||"No se pudo verificar el teléfono"); }
});

app.patch("/api/me", requireAuth, async (req, res) => {
  const parsed = parseOrFail(profileSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const db = usesPostgresAuth() ? null : readDb();
  const user = usesPostgresAuth()
    ? await findAuthUserByPublicId(req.auth.userId)
    : db.users.find((entry) => entry.id === req.auth.userId);
  if (!user) return fail(res, 404, "Usuario no encontrado");
  const { name, phone, defaultAddress } = parsed.data;
  user.name = name;
  user.phone = phone || "";
  user.defaultAddress = defaultAddress;
  if (usesPostgresAuth())
    await updatePostgresAuthProfile(user.id, { name, phone, defaultAddress });
  if (!usesPostgresAuth()) {
    const existingAddress = (db.addresses || []).find(
      (entry) => entry.userId === user.id && entry.isDefault,
    );
    (db.addresses || []).forEach((entry) => {
      if (entry.userId === user.id) entry.isDefault = false;
    });
    if (existingAddress) {
      existingAddress.address = defaultAddress;
      existingAddress.isDefault = true;
    } else {
      db.addresses = [
        ...(db.addresses || []),
        {
          id: createId("ADDR"),
          userId: user.id,
          label: "Principal",
          address: defaultAddress,
          lat: null,
          lng: null,
          isDefault: true,
        },
      ];
    }
  }
  if (usesPostgresAuth())
    await recordPostgresAudit({
      actorPublicId: user.id,
      roles: req.auth.roles,
      action: "user.profile_updated",
      entityType: "user",
      entityId: user.id,
      requestId: req.requestId,
      afterData: { fields: ["name", "phone", "defaultAddress"] },
    });
  else {
    audit(db, req, "user", user.id, "user.profile_updated", {
      fields: ["name", "phone", "defaultAddress"],
    });
    writeDb(db);
  }
  await publishRealtimeEvent({
    req,
    type: "user.updated",
    entityType: "user",
    entityId: user.id,
    action: "user.profile_updated",
  });
  const account = usesPostgresAuth()
    ? {
        user: null,
        addresses: [],
        paymentMethods: [],
        walletTransactions: [],
        supportTickets: [],
        ratings: [],
      }
    : accountSnapshot(readDb(), user.id);
  if (usesPostgresAuth()) {
    account.user = sanitizeUser(await findAuthUserByPublicId(user.id));
    const [wallet, addresses, paymentMethods, supportTickets, ratings] =
      await Promise.all([
        getWallet(user.id),
        getPostgresAddresses(user.id),
        getPostgresPaymentMethods(),
        getPostgresSupportTickets({
          userPublicId: user.id,
          roles: req.auth.roles,
        }),
        getPostgresRatings({ userPublicId: user.id }),
      ]);
    account.user.wallet = wallet.balance;
    account.walletTransactions = wallet.transactions;
    account.addresses = addresses;
    account.paymentMethods = paymentMethods.filter(
      (entry) => entry.userId === user.id,
    );
    account.supportTickets = supportTickets;
    account.ratings = ratings;
  }
  return ok(res, { account });
});

app.get("/api/referrals/me", requireAuth, async (req, res) => {
  if (!usesPostgresAuth()) return fail(res, 503, "Referidos requiere PostgreSQL");
  try {
    return ok(res, { referral: await getReferralSummary(req.auth.userId) });
  } catch (error) {
    return fail(res, error.status || 500, error.message || "No se pudo cargar referidos");
  }
});

app.post("/api/referrals/claim", requireAuth, async (req, res) => {
  const parsed = parseOrFail(referralClaimSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  if (!usesPostgresAuth()) return fail(res, 503, "Referidos requiere PostgreSQL");
  try {
    const referral = await claimReferral({ publicUserId: req.auth.userId, code: parsed.data.code });
    await recordPostgresAudit({ actorPublicId: req.auth.userId, roles: req.auth.roles, action: "referral.claimed", entityType: "user", entityId: req.auth.userId, requestId: req.requestId, afterData: { code: parsed.data.code } });
    return ok(res, { referral });
  } catch (error) {
    return fail(res, error.status || 500, error.message || "No se pudo aplicar el referido");
  }
});

app.post("/api/wallet/topup", requireAuth, async (req, res) => {
  const parsed = parseOrFail(walletTopUpSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const db = usesPostgresAuth() ? null : readDb();
  const user = usesPostgresAuth()
    ? await findAuthUserByPublicId(req.auth.userId)
    : db.users.find((entry) => entry.id === req.auth.userId);
  if (!user) return fail(res, 404, "Usuario no encontrado");
  const amount = parsed.data.amount;
  if (usesPostgresAuth()) {
    if (!config.allowSandboxTopups)
      return fail(
        res,
        503,
        "Las cargas directas están deshabilitadas; se requiere un payment intent confirmado",
      );
    const idempotencyKey = req.get("idempotency-key");
    if (!idempotencyKey || !/^[a-zA-Z0-9._:-]{16,128}$/.test(idempotencyKey))
      return fail(res, 400, "Idempotency-Key válido es obligatorio");
    const wallet = await creditWallet({
      publicUserId: user.id,
      amount,
      idempotencyKey,
      kind: "sandbox_topup",
      description: "Carga sandbox",
      metadata: { requestId: req.requestId },
    });
    const pgUser = sanitizeUser(await findAuthUserByPublicId(user.id));
    pgUser.wallet = wallet.balance;
    await publishRealtimeEvent({
      req,
      type: "wallet.updated",
      entityType: "user",
      entityId: user.id,
      action: "wallet.topped_up",
    });
    const [addresses, paymentMethods, supportTickets] = await Promise.all([
      getPostgresAddresses(user.id),
      getPostgresPaymentMethods(),
      getPostgresSupportTickets({
        userPublicId: user.id,
        roles: req.auth.roles,
      }),
    ]);
    return ok(res, {
      account: {
        user: pgUser,
        addresses,
        paymentMethods: paymentMethods.filter(
          (entry) => entry.userId === user.id,
        ),
        supportTickets,
        walletTransactions: wallet.transactions,
        ratings: [],
      },
    });
  }
  user.wallet += amount;
  db.walletTransactions = [
    {
      id: createId("WAL"),
      userId: user.id,
      kind: "credit",
      amount,
      description: "Carga de saldo sandbox",
      createdAt: getTimestamp(),
    },
    ...(db.walletTransactions || []),
  ];
  const walletMethod = (db.paymentMethods || []).find(
    (entry) => entry.userId === user.id && entry.type === "wallet",
  );
  if (walletMethod) walletMethod.balance = user.wallet;
  audit(db, req, "wallet", user.id, "wallet.topped_up", {
    amount,
    balance: user.wallet,
  });
  writeDb(db);
  await publishRealtimeEvent({
    req,
    type: "wallet.updated",
    entityType: "user",
    entityId: user.id,
    action: "wallet.topped_up",
  });
  return ok(res, { account: accountSnapshot(readDb(), user.id) });
});

app.get("/api/events", requireAuth, async (req, res) => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  const context = { userPublicId: req.auth.userId, roles: req.auth.roles };
  realtimeClients.set(res, context);
  const requestedCursor = Math.max(
    0,
    Number(req.get("last-event-id") || req.query.cursor || 0) || 0,
  );
  const cursor = postgresPool ? await getPostgresRealtimeCursor() : null;
  writeSseEvent(
    res,
    "connected",
    {
      id: createId("EVT"),
      type: "connected",
      at: getTimestamp(),
      cursor,
    },
    cursor,
  );
  if (postgresPool && requestedCursor) {
    for (const event of await getPostgresRealtimeReplay({
      after: requestedCursor,
      ...context,
    }))
      writeSseEvent(res, "state.updated", event, event.cursor);
  }
  const heartbeat = setInterval(() => {
    if (!writeSseEvent(res, "heartbeat", { at: getTimestamp() })) {
      clearInterval(heartbeat);
      realtimeClients.delete(res);
    }
  }, 25000);
  req.on("close", () => {
    clearInterval(heartbeat);
    realtimeClients.delete(res);
  });
});

app.get(
  "/api/metrics",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    ok(res, { metrics: metrics(await loadRuntimeState(req)) });
  },
);

app.post(
  "/api/jobs/:jobId/tips",
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "Las propinas requieren PostgreSQL");
    const parsed = parseOrFail(tipSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    const idempotencyKey = String(req.get("idempotency-key") || "");
    if (!/^[a-zA-Z0-9._:-]{16,128}$/.test(idempotencyKey))
      return fail(res, 400, "Idempotency-Key válido es obligatorio");
    try {
      const tip = await createPostgresTip({
        jobPublicId: req.params.jobId,
        customerPublicId: req.auth.userId,
        amount: parsed.data.amount,
        idempotencyKey,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "service.tip_created",
        entityType: "job",
        entityId: req.params.jobId,
        requestId: req.requestId,
        afterData: { tipId: tip.id, amount: tip.amount },
      });
      await publishRealtimeEvent({
        req,
        type: "wallet.updated",
        entityType: "job",
        entityId: req.params.jobId,
        action: "service.tip_created",
      });
      return res.status(201).json({ ok: true, requestId: req.requestId, tip });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo enviar la propina",
      );
    }
  },
);
app.get(
  "/api/admin/tip-adjustments",
  requireAuth,
  requireAnyRole("admin"),
  async (_req, res) => {
    try {
      return ok(res, { adjustments: await getTipAdjustments() });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudieron cargar los ajustes de propinas",
      );
    }
  },
);
app.post(
  "/api/admin/tip-adjustments",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const parsed = parseOrFail(tipAdjustmentRequestSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    const idempotencyKey = String(req.get("idempotency-key") || "");
    if (!/^[a-zA-Z0-9._:-]{16,128}$/.test(idempotencyKey))
      return fail(res, 400, "Idempotency-Key válido es obligatorio");
    try {
      const adjustment = await requestTipAdjustment({
        actorPublicId: req.auth.userId,
        idempotencyKey,
        ...parsed.data,
        tipPublicId: parsed.data.tipId,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "service.tip_adjustment_requested",
        entityType: "tip_adjustment",
        entityId: adjustment.id,
        requestId: req.requestId,
        afterData: {
          tipId: adjustment.tipId,
          amount: adjustment.amount,
          reason: adjustment.reason,
        },
      });
      return res
        .status(201)
        .json({ ok: true, requestId: req.requestId, adjustment });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo solicitar el ajuste",
      );
    }
  },
);
app.patch(
  "/api/admin/tip-adjustments/:adjustmentId/review",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const parsed = parseOrFail(tipAdjustmentReviewSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const adjustment = await reviewTipAdjustment({
        adjustmentPublicId: req.params.adjustmentId,
        actorPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: `service.tip_adjustment_${parsed.data.decision}`,
        entityType: "tip_adjustment",
        entityId: adjustment.id,
        requestId: req.requestId,
        afterData: {
          tipId: adjustment.tipId,
          amount: adjustment.amount,
          status: adjustment.status,
        },
      });
      await publishRealtimeEvent({
        req,
        type: "wallet.updated",
        entityType: "job",
        entityId: adjustment.jobId,
        action: `service.tip_adjustment_${parsed.data.decision}`,
      });
      return ok(res, { adjustment });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo revisar el ajuste",
      );
    }
  },
);
app.post(
  "/api/orders/:orderId/issues",
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "Las incidencias requieren PostgreSQL");
    const parsed = parseOrFail(orderIssueSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const issue = await createOrderIssue({
        orderPublicId: req.params.orderId,
        customerPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "order_issue.created",
        entityType: "order_issue",
        entityId: issue.id,
        requestId: req.requestId,
        afterData: {
          orderId: req.params.orderId,
          category: issue.category,
          requestedRefund: issue.requestedRefund,
        },
      });
      await publishRealtimeEvent({
        req,
        type: "order.issue_updated",
        entityType: "order",
        entityId: req.params.orderId,
        action: "order_issue.created",
      });
      return res
        .status(201)
        .json({ ok: true, requestId: req.requestId, issue });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo crear la incidencia",
      );
    }
  },
);
app.get("/api/orders/:orderId/issues", requireAuth, async (req, res) => {
  try {
    return ok(res, {
      issues: await getOrderIssues({
        orderPublicId: req.params.orderId,
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
      }),
    });
  } catch (error) {
    return fail(
      res,
      error.status || 500,
      error.message || "No se pudieron cargar las incidencias",
    );
  }
});
app.patch(
  "/api/order-issues/:issueId/resolve",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const parsed = parseOrFail(orderIssueResolutionSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const issue = await resolveOrderIssue({
        issuePublicId: req.params.issueId,
        actorPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: `order_issue.${issue.status}`,
        entityType: "order_issue",
        entityId: issue.id,
        requestId: req.requestId,
        afterData: {
          orderId: issue.orderId,
          approvedRefund: issue.approvedRefund,
        },
      });
      await publishRealtimeEvent({
        req,
        type: "order.issue_updated",
        entityType: "order",
        entityId: issue.orderId,
        action: `order_issue.${issue.status}`,
      });
      return ok(res, { issue });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo resolver la incidencia",
      );
    }
  },
);
app.post(
  "/api/orders/:orderId/substitutions",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(substitutionProposalSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const substitution = await proposeOrderSubstitution({
        orderPublicId: req.params.orderId,
        merchantOwnerPublicId: req.auth.userId,
        admin: isAdmin(req),
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "order_substitution.proposed",
        entityType: "order_substitution",
        entityId: substitution.id,
        requestId: req.requestId,
        afterData: {
          orderId: req.params.orderId,
          original: substitution.original.id,
          replacement: substitution.replacement.id,
        },
      });
      await publishRealtimeEvent({
        req,
        type: "order.substitution_updated",
        entityType: "order",
        entityId: req.params.orderId,
        action: "order_substitution.proposed",
      });
      return res
        .status(201)
        .json({ ok: true, requestId: req.requestId, substitution });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo proponer la sustitución",
      );
    }
  },
);
app.get("/api/orders/:orderId/substitutions", requireAuth, async (req, res) => {
  try {
    return ok(res, {
      substitutions: await getOrderSubstitutions({
        orderPublicId: req.params.orderId,
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
      }),
    });
  } catch (error) {
    return fail(
      res,
      error.status || 500,
      error.message || "No se pudieron cargar las sustituciones",
    );
  }
});
app.patch(
  "/api/order-substitutions/:substitutionId",
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    const parsed = parseOrFail(substitutionDecisionSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const substitution = await decideOrderSubstitution({
        substitutionPublicId: req.params.substitutionId,
        customerPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: `order_substitution.${substitution.status}`,
        entityType: "order_substitution",
        entityId: substitution.id,
        requestId: req.requestId,
        afterData: {
          orderId: substitution.orderId,
          refundAmount: substitution.refundAmount,
        },
      });
      await publishRealtimeEvent({
        req,
        type: "order.substitution_updated",
        entityType: "order",
        entityId: substitution.orderId,
        action: `order_substitution.${substitution.status}`,
      });
      return ok(res, { substitution });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo responder la sustitución",
      );
    }
  },
);
app.patch(
  "/api/restaurants/:restaurantId/branches/:branchId",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(branchUpdateSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const restaurant = await updatePostgresBranch({
        merchantPublicId: req.params.restaurantId,
        branchPublicId: req.params.branchId,
        actorPublicId: req.auth.userId,
        admin: isAdmin(req),
        changes: parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "merchant_branch.updated",
        entityType: "merchant_branch",
        entityId: req.params.branchId,
        requestId: req.requestId,
        afterData: parsed.data,
      });
      return ok(res, { restaurant });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo actualizar la sucursal",
      );
    }
  },
);
app.patch(
  "/api/restaurants/:restaurantId/branches/:branchId/inventory/:itemId",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(branchInventorySchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const restaurant = await updatePostgresBranchInventory({
        merchantPublicId: req.params.restaurantId,
        branchPublicId: req.params.branchId,
        itemPublicId: req.params.itemId,
        actorPublicId: req.auth.userId,
        admin: isAdmin(req),
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "branch_inventory.updated",
        entityType: "merchant_branch",
        entityId: req.params.branchId,
        requestId: req.requestId,
        afterData: {
          itemId: req.params.itemId,
          available: parsed.data.available,
          stockQuantity: parsed.data.stockQuantity,
        },
      });
      return ok(res, { restaurant });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo actualizar el inventario de la sucursal",
      );
    }
  },
);
app.put(
  "/api/restaurants/:restaurantId/branches/:branchId/schedule",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(branchScheduleSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const restaurant = await replacePostgresBranchSchedule({
        merchantPublicId: req.params.restaurantId,
        branchPublicId: req.params.branchId,
        actorPublicId: req.auth.userId,
        admin: isAdmin(req),
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "merchant_branch.schedule_replaced",
        entityType: "merchant_branch",
        entityId: req.params.branchId,
        requestId: req.requestId,
        afterData: { timezone: parsed.data.timezone, hours: parsed.data.hours },
      });
      return ok(res, { restaurant });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo guardar el horario",
      );
    }
  },
);
app.put(
  "/api/restaurants/:restaurantId/branches/:branchId/schedule-exceptions",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(branchScheduleExceptionSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const restaurant = await upsertPostgresBranchScheduleException({
        merchantPublicId: req.params.restaurantId,
        branchPublicId: req.params.branchId,
        actorPublicId: req.auth.userId,
        admin: isAdmin(req),
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "merchant_branch.schedule_exception_upserted",
        entityType: "merchant_branch",
        entityId: req.params.branchId,
        requestId: req.requestId,
        afterData: parsed.data,
      });
      return ok(res, { restaurant });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo guardar la excepción",
      );
    }
  },
);
app.get(
  "/api/jobs/:jobId/receipt",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "Los comprobantes requieren PostgreSQL");
    try {
      const result = await getOrCreatePostgresReceipt({
        jobPublicId: req.params.jobId,
        actorPublicId: req.auth.userId,
        admin: isAdmin(req),
      });
      if (result.created)
        await recordPostgresAudit({
          actorPublicId: req.auth.userId,
          roles: req.auth.roles,
          action: "service.receipt_issued",
          entityType: "job",
          entityId: req.params.jobId,
          requestId: req.requestId,
          afterData: {
            receiptId: result.receipt.id,
            receiptNumber: result.receipt.number,
          },
        });
      return ok(res, { receipt: result.receipt });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo obtener el comprobante",
      );
    }
  },
);

app.get("/api/internal/metrics", async (req, res) => {
  const supplied = String(req.get("authorization") || "").replace(
    /^Bearer\s+/i,
    "",
  );
  const expected = Buffer.from(config.metricsToken),
    actual = Buffer.from(supplied);
  if (
    actual.length !== expected.length ||
    !crypto.timingSafeEqual(actual, expected)
  )
    return fail(res, 401, "Token de métricas inválido");
  if (!postgresPool) return fail(res, 503, "PostgreSQL no configurado");
  const rows = await postgresPool.query(`SELECT
  count(*) FILTER(WHERE kind='delivery' AND metadata->>'subtype'='food_order' AND status NOT IN('completed','cancelled'))::int active_food,
  count(*) FILTER(WHERE kind='ride' AND status NOT IN('completed','cancelled'))::int active_rides,
  count(*) FILTER(WHERE kind='delivery' AND metadata->>'subtype'='shipment' AND status NOT IN('completed','cancelled'))::int active_shipments FROM jobs`);
  const tickets = await postgresPool.query(
      "SELECT count(*)::int count FROM support_tickets WHERE status NOT IN('resolved','closed')",
    ),
    payments = await postgresPool.query(
      "SELECT status::text,count(*)::int count FROM payment_intents GROUP BY status ORDER BY status",
    ),
    notifications = await postgresPool.query(
      "SELECT status,count(*)::int count FROM notifications GROUP BY status ORDER BY status",
    ),
    dispatchOffers = await postgresPool.query(
      "SELECT status,count(*)::int count FROM dispatch_offers GROUP BY status ORDER BY status",
    ),
    realtimeEvents = await postgresPool.query(
      "SELECT count(*)::int count FROM realtime_events",
    ),
    payouts = await postgresPool.query(
      "SELECT status,count(*)::int count FROM payouts GROUP BY status ORDER BY status",
    ),
    merchantPayable = await postgresPool.query(
      `SELECT COALESCE(sum(CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END),0)::bigint cents FROM ledger_accounts a JOIN ledger_entries e ON e.account_id=a.id WHERE a.owner_type='merchant' AND a.account_type='payable'`,
    ),
    tips = await postgresPool.query(
      "SELECT count(*)::int count,COALESCE(sum(amount_cents),0)::bigint cents FROM service_tips",
    ),
    paymentOAuthConnections = await postgresPool.query(
      `SELECT status,count(*)::int count FROM (
        SELECT CASE
          WHEN revoked_at IS NOT NULL THEN 'revoked'
          WHEN refresh_failures>=5 OR token_expires_at IS NULL OR token_expires_at<=now() THEN 'reconnect_required'
          WHEN token_expires_at<now()+interval '30 days' THEN 'renewal_due'
          ELSE 'connected'
        END status
        FROM merchant_payment_connections
      ) connections GROUP BY status ORDER BY status`,
    ),
    idempotencyKeys = await postgresPool.query(
      `SELECT CASE WHEN expires_at<=now() THEN 'expired' ELSE 'active' END status,count(*)::int count
       FROM idempotency_keys GROUP BY 1 ORDER BY 1`,
    );
  res.type("text/plain; version=0.0.4; charset=utf-8").send(
    renderPrometheus({
      pool: postgresPool,
      business: {
        activeFood: rows.rows[0].active_food,
        activeRides: rows.rows[0].active_rides,
        activeShipments: rows.rows[0].active_shipments,
        openTickets: tickets.rows[0].count,
        payments: payments.rows,
        notifications: notifications.rows,
        dispatchOffers: dispatchOffers.rows,
        realtimeEvents: realtimeEvents.rows[0].count,
        payouts: payouts.rows,
        merchantPayableCents: merchantPayable.rows[0].cents,
        tipsCount: tips.rows[0].count,
        tipsCents: tips.rows[0].cents,
        paymentOAuthConnections: paymentOAuthConnections.rows,
        idempotencyKeys: idempotencyKeys.rows,
      },
      startedAt: processStartedAt,
      realtimeConnections: realtimeClients.size,
    }),
  );
});

app.get(
  "/api/admin/dashboard",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    ok(res, {
      dashboard: adminSnapshot(
        await loadRuntimeState(req),
        usesPostgresCommerce() ? await getPostgresAdminFinancials() : null,
      ),
    });
  },
);

app.post("/api/auth/login", async (req, res) => {
  const parsed = parseOrFail(loginSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const { email, password } = parsed.data;
  const db = usesPostgresAuth() ? null : readDb();
  const user = usesPostgresAuth()
    ? await findAuthUserByEmail(email)
    : db.users.find(
        (entry) =>
          entry.email.toLowerCase() ===
          String(email || "")
            .trim()
            .toLowerCase(),
      );
  const passwordMatches = bcrypt.compareSync(
    password,
    user?.password ||
      "$2b$10$qJvN1MRgLJYlRirjP6N7ruoJc0mKlf2klq7iW03DIdDgV7gKDCl7.",
  );
  const accountLocked = Boolean(
    user?.loginLockedUntil && new Date(user.loginLockedUntil) > new Date(),
  );
  if (!user || accountLocked || !passwordMatches) {
    if (usesPostgresAuth() && user && !accountLocked)
      await recordPostgresLoginFailure(email);
    return fail(res, 401, "Credenciales invalidas");
  }
  if (usesPostgresAuth() && !user.emailVerifiedAt)
    return res.status(403).json({
      ok: false,
      requestId: req.requestId,
      message: "Debes verificar tu email",
      verificationRequired: true,
      email: user.email,
    });
  if (usesPostgresAuth()) await recordPostgresLoginSuccess(user.id);
  if (
    usesPostgresAuth() &&
    user.roles?.includes("admin") &&
    (await getAdminMfaStatus(user.id)).enabled
  ) {
    return ok(res, {
      user: sanitizeUser(user),
      mfaRequired: true,
      mfaChallenge: issueMfaChallenge(user),
    });
  }
  return ok(res, {
    user: usesPostgresAuth() ? sanitizeUser(user) : publicUser(db, user.id),
    ...deliverSession(req, res, await issueSession(
      user,
      parsed.data.deviceName || req.get("user-agent") || "unknown",
    )),
  });
});

app.get("/api/auth/mfa/status", requireAuth, async (req, res) => {
  if (!hasRole(req, "admin"))
    return fail(res, 403, "MFA administrativo requiere rol admin");
  return ok(res, { mfa: await getAdminMfaStatus(req.auth.userId) });
});

app.patch(
  "/api/admin/users/:userId/status",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    if (!usesPostgresAuth())
      return fail(res, 503, "La moderación de cuentas requiere PostgreSQL");
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
        action:
          parsed.data.status === "active"
            ? "user.reactivated"
            : "user.suspended",
      });
      return ok(res, { moderation });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo cambiar el estado de la cuenta",
      );
    }
  },
);

app.post(
  "/api/auth/mfa/enroll",
  requireAuth,
  requireAdminIdentity,
  async (req, res) => {
    if (!usesPostgresAuth())
      return fail(res, 503, "MFA real requiere PostgreSQL");
    try {
      const enrollment = await beginAdminMfaEnrollment({
        userPublicId: req.auth.userId,
        email: req.auth.user.email,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "admin.mfa_enrollment_started",
        entityType: "user",
        entityId: req.auth.userId,
        requestId: req.requestId,
      });
      return ok(res, { enrollment });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo iniciar MFA",
      );
    }
  },
);

app.post(
  "/api/auth/mfa/confirm",
  requireAuth,
  requireAdminIdentity,
  async (req, res) => {
    const parsed = parseOrFail(mfaCodeSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const mfa = await confirmAdminMfa({
        userPublicId: req.auth.userId,
        code: parsed.data.code,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "admin.mfa_enabled",
        entityType: "user",
        entityId: req.auth.userId,
        requestId: req.requestId,
      });
      return ok(res, {
        mfa,
        ...deliverSession(req, res, await issueSession(
          req.auth.user,
          req.body?.deviceName || req.get("user-agent") || "unknown",
          { mfaVerified: true },
        )),
      });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo confirmar MFA",
      );
    }
  },
);

app.post("/api/auth/mfa/complete", async (req, res) => {
  const parsed = parseOrFail(mfaCompleteSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    const challenge = jwt.verify(parsed.data.challenge, jwtSecret);
    if (challenge.purpose !== "admin_mfa")
      return fail(res, 401, "Desafío MFA inválido");
    const user = await findAuthUserByPublicId(challenge.sub);
    if (!user?.roles?.includes("admin"))
      return fail(res, 401, "Desafío MFA inválido");
    const verification = await verifyAdminMfa({
      userPublicId: user.id,
      code: parsed.data.code,
    });
    await recordPostgresAudit({
      actorPublicId: user.id,
      roles: user.roles,
      action: verification.recoveryCodeUsed
        ? "admin.mfa_recovery_used"
        : "admin.mfa_verified",
      entityType: "user",
      entityId: user.id,
      requestId: req.requestId,
    });
    return ok(res, {
      user: sanitizeUser(user),
      verification,
      ...deliverSession(req, res, await issueSession(
        user,
        parsed.data.deviceName || req.get("user-agent") || "unknown",
        { mfaVerified: true },
      )),
    });
  } catch (error) {
    return fail(
      res,
      error.name === "JsonWebTokenError" || error.name === "TokenExpiredError"
        ? 401
        : error.status || 500,
      error.name === "TokenExpiredError"
        ? "Desafío MFA expirado"
        : error.name === "JsonWebTokenError"
          ? "Desafío MFA inválido"
          : error.message || "No se pudo verificar MFA",
    );
  }
});

app.post("/api/payments/webhooks/:provider", async (req, res) => {
  const provider = String(req.params.provider || "").toLowerCase();
  if (!/^[a-z0-9_-]{2,40}$/.test(provider))
    return fail(res, 400, "Proveedor inválido");
  const eventId = String(req.body?.id || "");
  const eventType = String(req.body?.type || "");
  if (!eventId || !eventType) return fail(res, 400, "Evento incompleto");
  const signatureValid = verifyWebhookSignature(
    req.rawBody || Buffer.from(""),
    req.get("x-flash-signature"),
    config.paymentWebhookSecret,
  );
  const result = await recordPaymentWebhook({
    provider,
    eventId,
    eventType,
    payload: req.body,
    signatureValid,
  });
  if (!signatureValid) return fail(res, 401, "Firma de webhook inválida");
  return ok(res, result);
});
app.get(
  "/api/admin/payment-reconciliation",
  requireAuth,
  requireAnyRole("support", "admin"),
  async (_req, res) => {
    try {
      return ok(res, await getPaymentReconciliation());
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo cargar la conciliación",
      );
    }
  },
);
app.post(
  "/api/admin/payment-reconciliation/scan",
  requireAuth,
  requireAnyRole("support", "admin"),
  async (req, res) => {
    try {
      const reconciliation = await scanPaymentReconciliation();
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "payment.reconciliation_scanned",
        entityType: "payment_reconciliation",
        entityId: "scan",
        requestId: req.requestId,
        afterData: {
          openCount: reconciliation.summary.openCount,
          urgentCount: reconciliation.summary.urgentCount,
        },
      });
      return ok(res, reconciliation);
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo ejecutar la conciliación",
      );
    }
  },
);
app.patch(
  "/api/admin/payment-reconciliation/:caseId",
  requireAuth,
  requireAnyRole("support", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(
      paymentReconciliationResolutionSchema,
      req.body || {},
    );
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const reconciliationCase = await resolvePaymentReconciliationCase({
        casePublicId: req.params.caseId,
        actorPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "payment.reconciliation_resolved",
        entityType: "payment_reconciliation",
        entityId: reconciliationCase.id,
        requestId: req.requestId,
        afterData: {
          status: reconciliationCase.status,
          caseType: reconciliationCase.caseType,
        },
      });
      return ok(res, { case: reconciliationCase });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo resolver el caso",
      );
    }
  },
);
app.get(
  "/api/admin/transaction-risks",
  requireAuth,
  requireAnyRole("support", "admin"),
  async (_req, res) => {
    try {
      return ok(res, { assessments: await getTransactionRisks() });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudieron cargar las evaluaciones",
      );
    }
  },
);
app.patch(
  "/api/admin/transaction-risks/:assessmentId",
  requireAuth,
  requireAnyRole("support", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(transactionRiskReviewSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const assessment = await reviewTransactionRisk({
        assessmentPublicId: req.params.assessmentId,
        actorPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "risk.assessment_reviewed",
        entityType: "risk_assessment",
        entityId: assessment.id,
        requestId: req.requestId,
        afterData: {
          decision: assessment.decision,
          reviewStatus: assessment.reviewStatus,
          score: assessment.score,
        },
      });
      return ok(res, { assessment });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo revisar la evaluación",
      );
    }
  },
);

app.post("/api/auth/refresh", async (req, res) => {
  const parsed = parseOrFail(refreshSchema, {
    ...(req.body || {}),
    refreshToken: req.body?.refreshToken || readRefreshCookie(req),
  });
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const rotated = usesPostgresAuth()
    ? await rotatePostgresSession(
        parsed.data.refreshToken,
        parsed.data.deviceName || req.get("user-agent") || "unknown",
      )
    : consumeAuthSession(
        parsed.data.refreshToken,
        parsed.data.deviceName || req.get("user-agent") || "unknown",
      );
  if (!rotated) return fail(res, 401, "Sesion expirada o revocada");
  const db = usesPostgresAuth() ? null : readDb();
  const user = usesPostgresAuth()
    ? rotated.user
    : db.users.find((entry) => entry.id === rotated.userId);
  if (!user) return fail(res, 401, "Usuario no existe");
  if (
    usesPostgresAuth() &&
    user.roles?.includes("admin") &&
    (await getAdminMfaStatus(user.id)).enabled
  ) {
    await revokePostgresSession(rotated.refreshToken);
    if (isWebSessionRequest(req)) clearRefreshCookie(res);
    return ok(res, {
      user: sanitizeUser(user),
      mfaRequired: true,
      mfaChallenge: issueMfaChallenge(user),
    });
  }
  return ok(res, {
    user: usesPostgresAuth() ? sanitizeUser(user) : publicUser(db, user.id),
    token: issueAccessToken(user),
    ...deliverSession(req, res, {
      refreshToken: rotated.refreshToken,
      refreshExpiresAt: rotated.expiresAt,
    }),
  });
});

app.post("/api/auth/logout", async (req, res) => {
  const parsed = parseOrFail(
    refreshSchema.pick({ refreshToken: true }),
    { ...(req.body || {}), refreshToken: req.body?.refreshToken || readRefreshCookie(req) },
  );
  if (!parsed.ok) return fail(res, 400, parsed.message);
  if (usesPostgresAuth()) await revokePostgresSession(parsed.data.refreshToken);
  else revokeAuthSession(parsed.data.refreshToken);
  if (isWebSessionRequest(req)) clearRefreshCookie(res);
  return ok(res, { loggedOut: true });
});
app.get("/api/me/sessions",requireAuth,async(req,res)=>{if(!usesPostgresAuth())return ok(res,{sessions:[]});try{res.set("Cache-Control","no-store, private");return ok(res,{sessions:await getPostgresUserSessions(req.auth.userId)});}catch(error){return fail(res,error.status||500,error.message||"No se pudieron cargar las sesiones");}});
app.delete("/api/me/sessions/:sessionId",requireAuth,async(req,res)=>{if(!usesPostgresAuth())return fail(res,503,"El cierre remoto requiere PostgreSQL");try{const result=await revokeOwnedPostgresSession({userPublicId:req.auth.userId,sessionPublicId:req.params.sessionId});await recordPostgresAudit({actorPublicId:req.auth.userId,roles:req.auth.roles,action:"auth.session_revoked",entityType:"refresh_session",entityId:req.params.sessionId,requestId:req.requestId});return ok(res,result);}catch(error){return fail(res,error.status||500,error.message||"No se pudo cerrar la sesión");}});
app.post("/api/me/sessions/revoke-others",requireTrustedWebOrigin,requireAuth,async(req,res)=>{const parsed=parseOrFail(refreshSchema.pick({refreshToken:true}),{...(req.body||{}),refreshToken:req.body?.refreshToken||readRefreshCookie(req)});if(!parsed.ok)return fail(res,400,parsed.message);if(!usesPostgresAuth())return fail(res,503,"El cierre remoto requiere PostgreSQL");try{const result=await revokeOtherPostgresSessions({userPublicId:req.auth.userId,currentRefreshToken:parsed.data.refreshToken});await recordPostgresAudit({actorPublicId:req.auth.userId,roles:req.auth.roles,action:"auth.other_sessions_revoked",entityType:"user",entityId:req.auth.userId,requestId:req.requestId,afterData:result});return ok(res,result);}catch(error){return fail(res,error.status||500,error.message||"No se pudieron cerrar las demás sesiones");}});

app.post("/api/auth/password-recovery/request", async (req, res) => {
  const parsed = parseOrFail(passwordRecoveryRequestSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    const fingerprint = crypto
        .createHmac("sha256", jwtSecret)
        .update(`${req.ip || ""}|${req.get("user-agent") || ""}`)
        .digest("hex"),
      recovery = await requestPasswordRecovery({
        email: parsed.data.email,
        requesterFingerprintHash: fingerprint,
      });
    return ok(res, {
      message:
        "Si la cuenta existe, enviamos las instrucciones de recuperación.",
      ...(!config.isProduction && recovery
        ? { developmentToken: recovery.token, expiresAt: recovery.expiresAt }
        : {}),
    });
  } catch (_error) {
    return fail(res, 500, "No se pudo procesar la recuperación");
  }
});
app.post("/api/auth/password-recovery/confirm", async (req, res) => {
  const parsed = parseOrFail(passwordRecoveryConsumeSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    const result = await consumePasswordRecovery({
      token: parsed.data.token,
      password: parsed.data.password,
    });
    return ok(res, {
      passwordChanged: true,
      revokedSessions: result.revokedSessions,
    });
  } catch (error) {
    return fail(
      res,
      error.status || 500,
      error.message || "No se pudo cambiar la contraseña",
    );
  }
});
app.post("/api/auth/email-verification/resend", async (req, res) => {
  const parsed = parseOrFail(emailVerificationRequestSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    const challenge = await resendEmailVerification(parsed.data.email);
    return ok(res, {
      message: "Si la cuenta está pendiente, enviamos un código nuevo.",
      ...(!config.isProduction && challenge
        ? { developmentCode: challenge.code, expiresAt: challenge.expiresAt }
        : {}),
    });
  } catch (_error) {
    return fail(res, 500, "No se pudo reenviar el código");
  }
});
app.post("/api/auth/email-verification/confirm", async (req, res) => {
  const parsed = parseOrFail(emailVerificationConfirmSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    const user = await confirmEmailVerification(parsed.data);
    return ok(res, { verified: true, user: sanitizeUser(user) });
  } catch (error) {
    return fail(
      res,
      error.status || 500,
      error.message || "No se pudo verificar el email",
    );
  }
});

app.post("/api/auth/register", async (req, res) => {
  const parsed = parseOrFail(registerSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const { name, email, password, phone } = parsed.data;
  const db = usesPostgresAuth() ? null : readDb();
  const exists = usesPostgresAuth()
    ? await findAuthUserByEmail(email)
    : db.users.some(
        (entry) =>
          entry.email.toLowerCase() === String(email).trim().toLowerCase(),
      );
  if (exists) return fail(res, 409, "Ese email ya existe");
  let user = {
    id: createId("USR"),
    name: String(name),
    email: String(email).trim().toLowerCase(),
    password: bcrypt.hashSync(String(password), 10),
    roles: ["customer"],
    phone: String(phone || ""),
    wallet: 0,
    defaultAddress: "",
  };
  if (usesPostgresAuth()) {
    user = await registerAuthUser({
      publicId: user.id,
      name: user.name,
      email: user.email,
      passwordHash: user.password,
      phone: user.phone,
    });
  } else {
    db.users.push(user);
  }
  const verificationCode = user.verificationCode;
  delete user.verificationCode;
  if (usesPostgresAuth())
    await recordPostgresAudit({
      actorPublicId: user.id,
      roles: user.roles,
      action: "user.registered",
      entityType: "user",
      entityId: user.id,
      requestId: req.requestId,
      afterData: { email: user.email },
    });
  else {
    audit(
      db,
      { auth: { userId: user.id } },
      "user",
      user.id,
      "user.registered",
      { email: user.email },
    );
    writeDb(db);
  }
  if (usesPostgresAuth())
    return ok(res, {
      user: sanitizeUser(user),
      verificationRequired: true,
      ...(!config.isProduction
        ? {
            developmentCode: verificationCode.code,
            expiresAt: verificationCode.expiresAt,
          }
        : {}),
    });
  return ok(res, {
    user: publicUser(db, user.id),
    ...deliverSession(req, res, await issueSession(
      user,
      req.body?.deviceName || req.get("user-agent") || "unknown",
    )),
  });
});

app.get("/api/restaurants", async (_req, res) => {
  const restaurants = usesPostgresCommerce()
    ? await getPostgresRestaurants()
    : readDb().restaurants;
  ok(res, { restaurants });
});

app.get(
  "/api/cart",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return ok(res, { cart: [] });
    return ok(res, { cart: await getPostgresCart(req.auth.userId) });
  },
);

app.put(
  "/api/cart",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(cartSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const cart = await replacePostgresCart(
        req.auth.userId,
        parsed.data.restaurantId,
        parsed.data.items,
      );
      return ok(res, { cart });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo guardar el carrito",
      );
    }
  },
);

app.post(
  "/api/orders/:orderId/reorder",
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "La recompra requiere PostgreSQL");
    try {
      const result = await reorderPostgresOrder({
        customerPublicId: req.auth.userId,
        orderPublicId: req.params.orderId,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "order.reordered_to_cart",
        entityType: "order",
        entityId: req.params.orderId,
        requestId: req.requestId,
        afterData: {
          restaurantId: result.restaurantId,
          lineCount: result.cart.length,
        },
      });
      return ok(res, result);
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo reconstruir el carrito",
      );
    }
  },
);

app.patch(
  "/api/restaurants/:restaurantId",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const db = usesPostgresAuth() ? null : readDb();
    let restaurant = usesPostgresCommerce()
      ? (await getPostgresRestaurants()).find(
          (entry) => entry.id === req.params.restaurantId,
        )
      : findRestaurant(db, req.params.restaurantId);
    if (!restaurant) return fail(res, 404, "Restaurante no encontrado");
    if (!canManageRestaurant(req, restaurant))
      return fail(res, 403, "No puedes gestionar este restaurante");
    const body = req.body || {};
    if (usesPostgresCommerce()) {
      restaurant = await updatePostgresRestaurant(restaurant.id, body);
    } else {
      if (typeof body.open === "boolean") restaurant.open = body.open;
      if (typeof body.etaMin === "number")
        restaurant.etaMin = Math.max(5, body.etaMin);
    }
    await auditRuntime(
      db,
      req,
      "restaurant",
      restaurant.id,
      "restaurant.updated",
      {
        open: restaurant.open,
        etaMin: restaurant.etaMin,
      },
    );
    await publishRealtimeEvent({
      req,
      type: "restaurant.updated",
      entityType: "restaurant",
      entityId: restaurant.id,
      action: "restaurant.updated",
    });
    return ok(res, { restaurant });
  },
);

app.post(
  "/api/restaurants/:restaurantId/menu",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const db = usesPostgresAuth() ? null : readDb();
    let restaurant = usesPostgresCommerce()
      ? (await getPostgresRestaurants()).find(
          (entry) => entry.id === req.params.restaurantId,
        )
      : findRestaurant(db, req.params.restaurantId);
    if (!restaurant) return fail(res, 404, "Restaurante no encontrado");
    if (!canManageRestaurant(req, restaurant))
      return fail(res, 403, "No puedes gestionar este restaurante");
    const { name, description, category, price } = req.body || {};
    if (!name || !price)
      return fail(res, 400, "Nombre y precio son obligatorios");
    const item = {
      id: createId("ITEM"),
      name: String(name),
      description: String(description || ""),
      category: String(category || "Especiales"),
      price: Math.max(100, Number(price)),
      rating: 4.5,
      timeMin: restaurant.etaMin,
      kcal: 500,
      stock: true,
      image: restaurant.image,
      tags: ["Nuevo"],
    };
    if (usesPostgresCommerce())
      restaurant = await createPostgresMenuItem(restaurant.id, item);
    else restaurant.menu.unshift(item);
    await auditRuntime(db, req, "menu_item", item.id, "menu_item.created", {
      restaurantId: restaurant.id,
      price: item.price,
    });
    await publishRealtimeEvent({
      req,
      type: "restaurant.updated",
      entityType: "restaurant",
      entityId: restaurant.id,
      action: "menu_item.created",
    });
    return ok(res, { item, restaurant });
  },
);

app.patch(
  "/api/restaurants/:restaurantId/menu/:itemId",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const db = usesPostgresCommerce() ? {} : readDb();
    let restaurant = usesPostgresCommerce()
      ? (await getPostgresRestaurants()).find(
          (entry) => entry.id === req.params.restaurantId,
        )
      : findRestaurant(db, req.params.restaurantId);
    if (!restaurant) return fail(res, 404, "Restaurante no encontrado");
    if (!canManageRestaurant(req, restaurant))
      return fail(res, 403, "No puedes gestionar este restaurante");
    const item = restaurant.menu.find(
      (entry) => entry.id === req.params.itemId,
    );
    if (!item) return fail(res, 404, "Producto no encontrado");
    const body = req.body || {};
    if (usesPostgresCommerce()) {
      restaurant = await updatePostgresMenuItem(restaurant.id, item.id, body);
      Object.assign(
        item,
        restaurant.menu.find((entry) => entry.id === item.id),
      );
    } else {
      if (typeof body.stock === "boolean") item.stock = body.stock;
      if (typeof body.price === "number")
        item.price = Math.max(100, body.price);
    }
    await auditRuntime(db, req, "menu_item", item.id, "menu_item.updated", {
      restaurantId: restaurant.id,
      stock: item.stock,
      price: item.price,
    });
    await publishRealtimeEvent({
      req,
      type: "restaurant.updated",
      entityType: "restaurant",
      entityId: restaurant.id,
      action: "menu_item.updated",
    });
    return ok(res, { item, restaurant });
  },
);

app.put(
  "/api/restaurants/:restaurantId/menu/:itemId/modifiers",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "La gestión de agregados requiere PostgreSQL");
    const parsed = parseOrFail(itemModifierGroupsSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const restaurant = await replacePostgresItemModifiers({
        merchantPublicId: req.params.restaurantId,
        itemPublicId: req.params.itemId,
        actorPublicId: req.auth.user.id,
        admin: req.auth.user.role === "admin",
        groups: parsed.data.groups,
      });
      await auditRuntime(
        {},
        req,
        "menu_item",
        req.params.itemId,
        "catalog_item.modifiers_replaced",
        {
          restaurantId: req.params.restaurantId,
          groupCount: parsed.data.groups.length,
        },
      );
      await publishRealtimeEvent({
        req,
        type: "restaurant.updated",
        entityType: "restaurant",
        entityId: req.params.restaurantId,
        action: "catalog_item.modifiers_replaced",
      });
      return ok(res, { restaurant });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudieron guardar los agregados",
      );
    }
  },
);

app.put(
  "/api/restaurants/:restaurantId/menu/:itemId/dietary",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "La información alimentaria requiere PostgreSQL");
    const parsed = parseOrFail(itemDietarySchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const restaurant = await replacePostgresItemDietary({
        merchantPublicId: req.params.restaurantId,
        itemPublicId: req.params.itemId,
        actorPublicId: req.auth.user.id,
        admin: req.auth.user.role === "admin",
        ...parsed.data,
      });
      await auditRuntime(
        {},
        req,
        "menu_item",
        req.params.itemId,
        "catalog_item.dietary_replaced",
        {
          restaurantId: req.params.restaurantId,
          dietaryCount: parsed.data.dietaryLabels.length,
          allergenCount: parsed.data.allergens.length,
        },
      );
      await publishRealtimeEvent({
        req,
        type: "restaurant.updated",
        entityType: "restaurant",
        entityId: req.params.restaurantId,
        action: "catalog_item.dietary_replaced",
      });
      return ok(res, { restaurant });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo guardar la información alimentaria",
      );
    }
  },
);

app.post(
  "/api/orders/quote",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "La cotización geográfica requiere PostgreSQL");
    const parsed = parseOrFail(foodOrderQuoteSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    if (!canActAsCustomer(req, parsed.data.customerId))
      return fail(res, 403, "No puedes cotizar para otro cliente");
    try {
      const calculated = parsed.data.items
        ? await getPostgresFoodCheckoutQuote({
            customerPublicId: parsed.data.customerId,
            merchantPublicId: parsed.data.restaurantId,
            deliveryAddressId: parsed.data.deliveryAddressId,
            branchPublicId: parsed.data.branchId,
            items: parsed.data.items,
            paymentMethod: parsed.data.paymentMethod || "Flash Wallet",
            paymentMethodId: parsed.data.paymentMethodId,
            promotionCode: parsed.data.promotionCode,
          })
        : await getPostgresFoodDeliveryQuote({
            customerPublicId: parsed.data.customerId,
            merchantPublicId: parsed.data.restaurantId,
            deliveryAddressId: parsed.data.deliveryAddressId,
            branchPublicId: parsed.data.branchId,
          });
      const quoteId = createId("QUOTE"),
        expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const quoteToken = jwt.sign(
        { kind: "food_quote", quoteId, ...calculated },
        jwtSecret,
        { expiresIn: "5m" },
      );
      return ok(res, {
        quote: { ...calculated, quoteId, quoteToken, expiresAt },
      });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo cotizar la entrega",
      );
    }
  },
);

app.post(
  "/api/orders",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(orderSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    const {
      customerId,
      restaurantId,
      items,
      deliveryAddressId,
      deliveryAddress,
      paymentMethod,
      paymentMethodId,
      providerPayment,
      promotionCode,
      quoteToken,
    } = parsed.data;
    const idempotencyKey = req.get("idempotency-key");
    if (
      usesPostgresCommerce() &&
      (!idempotencyKey || !/^[a-zA-Z0-9._:-]{16,128}$/.test(idempotencyKey))
    ) {
      return fail(
        res,
        400,
        "Idempotency-Key válido es obligatorio para crear pedidos",
      );
    }
    const db = usesPostgresCommerce() ? {} : readDb();
    const customer = usesPostgresAuth()
      ? await findAuthUserByPublicId(customerId)
      : db.users.find((user) => user.id === customerId);
    if (!customer) return fail(res, 404, "Cliente no encontrado");
    if (!canActAsCustomer(req, customerId))
      return fail(res, 403, "No puedes crear pedidos para otro cliente");
    let lockedQuote = null;
    if (usesPostgresCommerce()) {
      if (!quoteToken)
        return fail(
          res,
          400,
          "Debes cotizar la entrega antes de confirmar el pedido",
        );
      try {
        lockedQuote = jwt.verify(quoteToken, jwtSecret);
        if (
          lockedQuote.kind !== "food_quote" ||
          lockedQuote.customerId !== customerId ||
          lockedQuote.restaurantId !== restaurantId ||
          lockedQuote.deliveryAddressId !== deliveryAddressId
        )
          return fail(res, 409, "La cotización no corresponde a este pedido");
      } catch (_error) {
        return fail(
          res,
          409,
          "La cotización venció; actualiza el precio antes de confirmar",
        );
      }
    }
    const restaurant = usesPostgresCommerce()
      ? (await getPostgresRestaurants()).find(
          (entry) => entry.id === restaurantId,
        )
      : findRestaurant(db, restaurantId);
    if (!restaurant || !restaurant.open)
      return fail(res, 404, "Restaurante no disponible");
    if (!Array.isArray(items) || items.length === 0)
      return fail(res, 400, "Agrega productos al pedido");

    let totals;
    try {
      totals = calculateOrderTotals(restaurant, items);
    } catch (error) {
      return fail(res, 400, error.message);
    }
    let riskAssessment = null;
    if (usesPostgresCommerce()) {
      try {
        riskAssessment = await assessTransactionRisk({
          customerPublicId: customerId,
          service: "food",
          amount: lockedQuote?.total ?? totals.total,
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
            afterData: { service: "food", score: riskAssessment.score },
          });
          return fail(
            res,
            403,
            "La operación requiere verificación de seguridad. Contactá a soporte.",
          );
        }
      } catch (error) {
        return fail(
          res,
          error.status || 500,
          error.message || "No se pudo verificar el riesgo de la operación",
        );
      }
    }

    const status = "accepted";
    const createdAt = getTimestamp();
    let order = {
      id: createId("ORD"),
      customerId,
      restaurantId,
      courierId: null,
      status,
      deliveryAddress: String(deliveryAddress || customer.defaultAddress || ""),
      paymentMethod: String(paymentMethod || "Flash Wallet"),
      ...totals,
      etaMin: restaurant.etaMin + 8,
      createdAt,
      timeline: [{ status, at: createdAt }],
    };
    if (usesPostgresCommerce()) {
      try {
        order = await createPostgresOrder({
          publicId: order.id,
          customerPublicId: customerId,
          merchantPublicId: restaurantId,
          deliveryAddressId,
          deliveryAddress: order.deliveryAddress,
          paymentMethod: order.paymentMethod,
          paymentMethodId,
          providerPayment,
          promotionCode,
          items,
          serviceFee: lockedQuote?.serviceFee ?? serviceFee,
          lockedQuote,
          idempotencyKey,
        });
        if(providerPayment&&!String(order.paymentMethod).toLowerCase().includes("wallet"))order=await processPostgresOrderMarketplacePayment({orderPublicId:order.id,customerPublicId:customerId,idempotencyKey,cardToken:providerPayment.cardToken,paymentMethodId:providerPayment.paymentMethodId,installments:providerPayment.installments});
        if (riskAssessment)
          await setRiskEntity({
            assessmentPublicId: riskAssessment.id,
            entityPublicId: order.id,
          });
      } catch (error) {
        return fail(
          res,
          error.status || 500,
          error.message || "No se pudo crear el pedido",
        );
      }
    } else {
      db.orders.unshift(order);
    }
    await auditRuntime(db, req, "order", order.id, "order.created", {
      restaurantId,
      total: order.total,
      itemCount: order.items.length,
    });
    if (!usesPostgresCommerce())
      createLocalNotification({
        userId: order.customerId,
        template: "order_status",
        payload: { orderId: order.id, status: order.status, etaMin: order.etaMin }
      });
    await publishRealtimeEvent({
      req,
      type: "order.created",
      entityType: "order",
      entityId: order.id,
      action: "order.created",
    });
    return ok(res, { order, label: orderLabels[status] });
  },
);

app.post(
  "/api/orders/:orderId/accept-delivery",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
    const { driverId } = req.body || {};
    const db = usesPostgresCommerce() ? {} : readDb();
    let order = usesPostgresCommerce()
      ? (await getPostgresOrders()).find(
          (entry) => entry.id === req.params.orderId,
        )
      : db.orders.find((entry) => entry.id === req.params.orderId);
    const driver = usesPostgresCommerce()
      ? (await getPostgresDrivers()).find((entry) => entry.id === driverId)
      : db.drivers.find((entry) => entry.id === driverId);
    if (!order) return fail(res, 404, "Pedido no encontrado");
    if (!canActAsDriver(req, driverId))
      return fail(res, 403, "No puedes aceptar pedidos con otro conductor");
    if (
      !driver ||
      !driver.online ||
      !driver.serviceModes.includes("delivery")
    ) {
      return fail(res, 409, "Repartidor no disponible");
    }
    if (order.courierId) return fail(res, 409, "El pedido ya tiene repartidor");
    if (["delivered", "cancelled"].includes(order.status)) {
      return fail(res, 409, "El pedido ya no esta disponible");
    }
    if (usesPostgresCommerce()) {
      try {
        order = await assignPostgresOrderDriver(
          order.id,
          driverId,
          req.auth.userId,
        );
      } catch (error) {
        return fail(res, error.status || 500, error.message);
      }
    } else {
      order.courierId = driverId;
      Object.assign(order, addTimeline(order, "courier_assigned"));
    }
    await auditRuntime(db, req, "order", order.id, "order.delivery_accepted", {
      driverId,
    });
    await publishRealtimeEvent({
      req,
      type: "order.updated",
      entityType: "order",
      entityId: order.id,
      action: "order.delivery_accepted",
    });
    return ok(res, { order, label: orderLabels[order.status] });
  },
);

app.post(
  "/api/orders/:orderId/advance",
  requireAuth,
  requireAnyRole("merchant", "driver", "admin"),
  async (req, res) => {
    const db = usesPostgresCommerce() ? {} : readDb();
    if (usesPostgresCommerce())
      [db.orders, db.drivers, db.restaurants] = await Promise.all([
        getPostgresOrders(),
        getPostgresDrivers(),
        getPostgresRestaurants(),
      ]);
    const index = db.orders.findIndex(
      (entry) => entry.id === req.params.orderId,
    );
    if (index < 0) return fail(res, 404, "Pedido no encontrado");
    if (!canAdvanceOrder(req, db, db.orders[index]))
      return fail(res, 403, "No puedes avanzar este pedido");
    const next = nextOrderStatus(db.orders[index]);
    if (!next)
      return fail(res, 409, "El pedido no puede avanzar desde este estado");
    db.orders[index] = usesPostgresCommerce()
      ? await setPostgresOrderStatus(db.orders[index].id, next, req.auth.userId)
      : addTimeline(db.orders[index], next);
    if (next === "delivered") {
      db.orders[index].etaMin = 0;
      if (!usesPostgresCommerce())
        await creditDriverEarningsRuntime(
          db,
          db.orders[index].courierId,
          db.orders[index].deliveryFee,
          `delivery-${db.orders[index].id}`,
        );
    }
    await auditRuntime(
      db,
      req,
      "order",
      db.orders[index].id,
      "order.status_advanced",
      { status: next },
    );
    if (!usesPostgresCommerce())
      createLocalNotification({
        userId: db.orders[index].customerId,
        template: "order_status",
        payload: { orderId: db.orders[index].id, status: next, etaMin: db.orders[index].etaMin }
      });
    await publishRealtimeEvent({
      req,
      type: "order.updated",
      entityType: "order",
      entityId: db.orders[index].id,
      action: "order.status_advanced",
    });
    return ok(res, { order: db.orders[index], label: orderLabels[next] });
  },
);

app.patch("/api/orders/:orderId/status", requireAuth, async (req, res) => {
  const { status } = req.body || {};
  if (!orderStatuses.includes(status))
    return fail(res, 400, "Estado de pedido invalido");
  const cancellation =
    status === "cancelled"
      ? parseOrFail(cancellationSchema, req.body || {})
      : null;
  if (cancellation && !cancellation.ok)
    return fail(res, 400, cancellation.message);
  const db = usesPostgresCommerce() ? {} : readDb();
  if (usesPostgresCommerce())
    [db.orders, db.restaurants] = await Promise.all([
      getPostgresOrders(),
      getPostgresRestaurants(),
    ]);
  const index = db.orders.findIndex((entry) => entry.id === req.params.orderId);
  if (index < 0) return fail(res, 404, "Pedido no encontrado");
  if (!canMutateOrderStatus(req, db, db.orders[index], status)) {
    return fail(res, 403, "No puedes cambiar este estado de pedido");
  }
  if (usesPostgresCommerce() && status === "cancelled") {
    const cancellationResult = await cancelMarketplaceOrderAndRefund({
      orderPublicId: db.orders[index].id,
      actorPublicId: req.auth.userId,
      reason: cancellation.data.reason,
      reasonDetail: cancellation.data.reasonDetail,
    })||await cancelOrderAndRefundWallet({
      orderPublicId: db.orders[index].id,
      actorPublicId: req.auth.userId,
      reason: cancellation.data.reason,
      reasonDetail: cancellation.data.reasonDetail,
    });
    db.orders[index] = (await getPostgresOrders()).find(
      (entry) => entry.id === db.orders[index].id,
    );
    db.orders[index].cancellation = cancellationResult;
  } else
    db.orders[index] = usesPostgresCommerce()
      ? await setPostgresOrderStatus(
          db.orders[index].id,
          status,
          req.auth.userId,
        )
      : addTimeline(db.orders[index], status);
  await auditRuntime(
    db,
    req,
    "order",
    db.orders[index].id,
    "order.status_set",
    { status },
  );
  await publishRealtimeEvent({
    req,
    type: "order.updated",
    entityType: "order",
    entityId: db.orders[index].id,
    action: "order.status_set",
  });
  return ok(res, { order: db.orders[index], label: orderLabels[status] });
});

app.post("/api/rides/quote", async (req, res) => {
  const parsed = parseOrFail(rideQuoteSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const { pickup, destination, service, pickupCoords, destinationCoords } =
    parsed.data;
  const [zone, pricing] = usesPostgresCommerce()
    ? await Promise.all([
        getPostgresZonePricing(pickupCoords),
        getPostgresPricingPlan("ride"),
      ])
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
    quoteToken = jwt.sign({ kind: "ride_quote", quoteId, service: quote.service, fare: quote.fare, breakdown: quote.breakdown, pricingVersion: quote.pricingVersion, pickup, destination, pickupCoords: pickupCoords || null, destinationCoords: destinationCoords || null }, jwtSecret, { expiresIn: "5m" });
  return ok(res, { quote: { ...quote, quoteId, quoteToken, expiresAt } });
});

app.get(
  "/api/merchant/dashboard",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const db = usesPostgresCommerce() ? {} : readDb();
    if (usesPostgresCommerce()) {
      [db.restaurants, db.orders] = await Promise.all([
        getPostgresRestaurants(),
        getPostgresOrders(),
      ]);
    }
    const restaurant = isAdmin(req)
      ? db.restaurants.find((entry) => entry.id === req.query.restaurantId)
      : db.restaurants.find((entry) => entry.ownerId === req.auth.userId);
    if (!restaurant) return fail(res, 404, "Comercio no encontrado");
    const orders = db.orders.filter(
      (order) => order.restaurantId === restaurant.id,
    );
    const activeOrders = orders.filter(
      (order) => !["delivered", "cancelled"].includes(order.status),
    );
    const completedOrders = orders.filter(
      (order) => order.status === "delivered",
    );
    const cancelledOrders = orders.filter(
      (order) => order.status === "cancelled",
    );
    const grossSales = completedOrders.reduce(
      (sum, order) => sum + order.total,
      0,
    );
    return ok(res, {
      dashboard: {
        generatedAt: getTimestamp(),
        restaurant,
        orders,
        metrics: {
          activeOrders: activeOrders.length,
          completedOrders: completedOrders.length,
          cancelledOrders: cancelledOrders.length,
          grossSales,
          averageTicket: completedOrders.length
            ? Math.round(grossSales / completedOrders.length)
            : 0,
          unavailableItems: restaurant.menu.filter((item) => !item.stock)
            .length,
          etaMin: restaurant.etaMin,
        },
      },
    });
  },
);

app.get(
  "/api/merchant/finance",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const merchantId = String(
      req.query.merchantId || req.auth.user.restaurantId || "",
    );
    if (!merchantId) return fail(res, 400, "Falta el comercio");
    try {
      return ok(res, {
        finance: await getMerchantFinance({
          merchantPublicId: merchantId,
          actorPublicId: req.auth.userId,
          admin: isAdmin(req),
        }),
      });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudieron cargar las finanzas",
      );
    }
  },
);
app.post(
  "/api/merchant/payouts/authorize",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  payoutStepUpLimiter,
  async (req,res) => {
    const parsed=parseOrFail(payoutAuthorizeSchema,req.body||{});
    if(!parsed.ok)return fail(res,400,parsed.message);
    const merchantId=parsed.data.merchantId||req.auth.user.restaurantId;
    if(!merchantId)return fail(res,400,"Falta el comercio");
    if(!bcrypt.compareSync(parsed.data.password,req.auth.user.password))return fail(res,401,"La contraseña actual no es válida");
    try{
      const jti=crypto.randomUUID(),expiresAt=new Date(Date.now()+5*60*1000);
      await createPayoutStepUp({jti,merchantPublicId:merchantId,actorPublicId:req.auth.userId,admin:isAdmin(req),amount:parsed.data.amount,expiresAt});
      const authorizationToken=jwt.sign({sub:req.auth.userId,purpose:"merchant_payout",merchantId,amountCents:Math.round(parsed.data.amount*100),jti},jwtSecret,{expiresIn:"5m"});
      await recordPostgresAudit({actorPublicId:req.auth.userId,roles:req.auth.roles,action:"merchant.payout_authorized",entityType:"merchant",entityId:merchantId,requestId:req.requestId,afterData:{amount:parsed.data.amount,expiresAt:expiresAt.toISOString()}});
      return ok(res,{authorizationToken,expiresAt:expiresAt.toISOString(),merchantId,amount:parsed.data.amount});
    }catch(error){return fail(res,error.status||500,error.message||"No se pudo autorizar el retiro");}
  },
);
app.get("/api/merchant/payment-provider",requireAuth,requireAnyRole("merchant"),async(req,res)=>{const merchantId=String(req.query.merchantId||req.auth.user.restaurantId||"");if(!merchantId)return fail(res,400,"Falta el comercio");try{return ok(res,{connection:await getMerchantPaymentConnection({merchantPublicId:merchantId,userPublicId:req.auth.userId}),configured:config.paymentMarketplace.provider!=="disabled"});}catch(error){return fail(res,error.status||500,error.message||"No se pudo consultar la vinculación");}});
app.get("/api/payment-provider/client-configuration",requireAuth,requireAnyRole("customer"),async(req,res)=>{res.set("Cache-Control","no-store, private");const enabled=config.paymentMarketplace.provider==="mercadopago"&&Boolean(config.paymentMarketplace.publicKey),merchantId=String(req.query.merchantId||"").slice(0,100);let merchantReady=false;if(enabled&&merchantId&&postgresPool)merchantReady=Boolean((await postgresPool.query(`SELECT 1 FROM merchant_payment_connections c JOIN merchants m ON m.id=c.merchant_id WHERE m.public_id=$1 AND c.provider='mercadopago' AND c.revoked_at IS NULL AND c.access_token_ciphertext IS NOT NULL AND c.token_expires_at>now() AND c.refresh_failures<5`,[merchantId])).rowCount);return ok(res,{provider:enabled?"mercadopago":"disabled",publicKey:enabled?config.paymentMarketplace.publicKey:null,merchantReady,cardDataHandling:"provider_tokenization_only"});});
app.post("/api/merchant/payment-provider/connect",requireAuth,requireAnyRole("merchant"),async(req,res)=>{const merchantId=String(req.body?.merchantId||req.auth.user.restaurantId||"");if(!merchantId)return fail(res,400,"Falta el comercio");try{return ok(res,await beginMerchantPaymentOAuth({merchantPublicId:merchantId,userPublicId:req.auth.userId}));}catch(error){return fail(res,error.status||500,error.message||"No se pudo iniciar la vinculación");}});
app.post("/api/merchant/payment-provider/disconnect",requireAuth,requireAnyRole("merchant"),payoutStepUpLimiter,async(req,res)=>{const merchantId=String(req.body?.merchantId||req.auth.user.restaurantId||""),password=String(req.body?.password||"");if(!merchantId||password.length<4)return fail(res,400,"Comercio y contraseña actual son obligatorios");if(!bcrypt.compareSync(password,req.auth.user.password))return fail(res,401,"La contraseña actual no es válida");try{return ok(res,{connection:await revokeMerchantPaymentConnection({merchantPublicId:merchantId,userPublicId:req.auth.userId,requestId:req.requestId})});}catch(error){return fail(res,error.status||500,error.message||"No se pudo revocar la vinculación");}});
app.get("/api/payment-provider/mercadopago/callback",async(req,res)=>{res.set("Cache-Control","no-store, private");res.set("Pragma","no-cache");const destination=new URL(config.paymentMarketplace.returnUrl);try{const state=String(req.query.state||""),code=String(req.query.code||"");if(req.query.error||state.length<20||code.length<3)throw Object.assign(new Error("Callback OAuth rechazado"),{status:400});await completeMerchantPaymentOAuth({state,code});destination.searchParams.set("payment_connection","connected");return res.redirect(303,destination.toString());}catch(error){destination.searchParams.set("payment_connection","error");destination.searchParams.set("reason",error.status===400?"invalid_state":"provider_unavailable");return res.redirect(303,destination.toString());}});
app.post("/api/webhooks/mercadopago",async(req,res)=>{res.set("Cache-Control","no-store");const parsed=parseOrFail(mercadoPagoWebhookSchema,req.body||{});if(!parsed.ok)return fail(res,400,parsed.message);if(!config.paymentMarketplace.webhookSecret)return fail(res,503,"Webhook de Mercado Pago no configurado");if(!postgresPool)return fail(res,503,"Inbox de webhooks requiere PostgreSQL");const queryDataId=String(req.query["data.id"]||""),bodyDataId=String(parsed.data.data.id);if(!queryDataId||queryDataId.toLowerCase()!==bodyDataId.toLowerCase())return fail(res,400,"El recurso firmado no coincide con el payload");const valid=verifyMercadoPagoWebhook({xSignature:req.get("x-signature"),xRequestId:req.get("x-request-id"),dataId:queryDataId,secret:config.paymentMarketplace.webhookSecret});if(!valid)return fail(res,401,"Firma de webhook inválida");try{const event=await enqueueMercadoPagoWebhook({notificationId:String(parsed.data.id),resourceId:bodyDataId,requestId:String(req.get("x-request-id")),topic:parsed.data.type,action:parsed.data.action,liveMode:parsed.data.live_mode,occurredAt:parsed.data.date_created,payload:{userId:parsed.data.user_id?String(parsed.data.user_id):null}});return res.status(event.duplicate?200:201).json({ok:true,requestId:req.requestId,accepted:true,duplicate:event.duplicate});}catch(error){return fail(res,error.status||500,"No se pudo persistir el webhook");}});
app.post(
  "/api/merchant/payouts",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(payoutRequestSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    const idempotencyKey = String(req.get("idempotency-key") || "");
    if (idempotencyKey.length < 16)
      return fail(res, 400, "Idempotency-Key es obligatorio");
    const merchantId = parsed.data.merchantId || req.auth.user.restaurantId;
    if (!merchantId) return fail(res, 400, "Falta el comercio");
    try {
      let stepUp;
      try{stepUp=jwt.verify(parsed.data.authorizationToken,jwtSecret);}catch{return fail(res,403,"Autorización reforzada inválida o vencida");}
      if(stepUp.sub!==req.auth.userId||stepUp.purpose!=="merchant_payout"||stepUp.merchantId!==merchantId||stepUp.amountCents!==Math.round(parsed.data.amount*100)||typeof stepUp.jti!=="string")return fail(res,403,"La autorización no corresponde a este retiro");
      const finance = await requestMerchantPayout({
        merchantPublicId: merchantId,
        actorPublicId: req.auth.userId,
        admin: isAdmin(req),
        amount: parsed.data.amount,
        idempotencyKey,
        stepUpJti:stepUp.jti,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "merchant.payout_requested",
        entityType: "merchant",
        entityId: merchantId,
        requestId: req.requestId,
        afterData: { amount: parsed.data.amount },
      });
      await publishRealtimeEvent({
        req,
        type: "merchant.finance.updated",
        entityType: "restaurant",
        entityId: merchantId,
        action: "merchant.payout_requested",
      });
      return res
        .status(201)
        .json({ ok: true, requestId: req.requestId, finance });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo solicitar el payout",
      );
    }
  },
);
app.get(
  "/api/admin/payouts",
  requireAuth,
  requireAnyRole("admin"),
  async (_req, res) => {
    try {
      return ok(res, { payouts: await getPayoutReviewQueue() });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudieron cargar los payouts",
      );
    }
  },
);
app.patch(
  "/api/admin/payouts/:payoutId/review",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const parsed = parseOrFail(payoutReviewSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const payout = await reviewMerchantPayout({
        payoutPublicId: req.params.payoutId,
        actorPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: `merchant.payout_${parsed.data.decision}`,
        entityType: "payout",
        entityId: payout.id,
        requestId: req.requestId,
        afterData: {
          merchantId: payout.merchantId,
          amount: payout.amount,
          status: payout.status,
        },
      });
      await publishRealtimeEvent({
        req,
        type: "merchant.finance.updated",
        entityType: "restaurant",
        entityId: payout.merchantId,
        action: `merchant.payout_${parsed.data.decision}`,
      });
      return ok(res, { payout });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo revisar el payout",
      );
    }
  },
);

app.post("/api/rides/options", async (req, res) => {
  const parsed = parseOrFail(rideQuoteSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const db = usesPostgresCommerce() ? {} : readDb();
  if (usesPostgresCommerce())
    [db.drivers, db.rides] = await Promise.all([
      getPostgresDrivers(),
      getPostgresRides(),
    ]);
  const [zone, pricing] = usesPostgresCommerce()
    ? await Promise.all([
        getPostgresZonePricing(parsed.data.pickupCoords),
        getPostgresPricingPlan("ride"),
      ])
    : [{ rideMultiplier: 1 }, fallbackRidePricing];
  return ok(res, {
    options: calculateRideOptions(
      db,
      parsed.data,
      zone.rideMultiplier,
      pricing,
    ),
  });
});

app.get("/api/maps/geocode", requireAuth, async (req, res) => {
  const query = String(req.query.q || "").trim();
  if (query.length < 3 || query.length > 180)
    return fail(res, 400, "La direccion debe tener entre 3 y 180 caracteres");
  let cacheKey;
  try {
    const normalizedQuery = query
      .normalize("NFKC")
      .toLocaleLowerCase("es-AR")
      .replace(/\s+/g, " ");
    cacheKey = createMapCacheKey(
      `${config.geocodingUrl}|${normalizedQuery}`,
    );
    const cached = await getCachedMapResponse({
      kind: "geocode",
      key: cacheKey,
    });
    if (cached)
      return ok(res, {
        results: cached.payload.results,
        provider: cached.provider,
        cache: "hit",
      });
    const url = new URL("/search", config.geocodingUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "5");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("countrycodes", "ar");
    const { response } = await mapProviderCircuit.execute({
      provider: "openstreetmap",
      operation: "geocode",
      timeoutMs: config.mapProvider.timeoutMs,
      call: (signal) => fetch(url, { headers: { "User-Agent": "FlashDeliveryApp/0.1 (operations@flash.local)" }, signal }),
    });
    observeProviderCall({ provider: "openstreetmap", operation: "geocode", outcome: "success" });
    const payload = await response.json();
    const results = payload
      .map((entry) => ({
        label: entry.display_name,
        point: { lat: Number(entry.lat), lng: Number(entry.lon) },
        type: entry.type || "address",
      }))
      .filter(
        (entry) =>
          Number.isFinite(entry.point.lat) && Number.isFinite(entry.point.lng),
      );
    await putCachedMapResponse({
      kind: "geocode",
      key: cacheKey,
      provider: "openstreetmap",
      payload: { results },
      ttlSeconds: config.geocodingCacheTtlSeconds,
    });
    return ok(res, { results, provider: "openstreetmap", cache: "miss" });
  } catch (error) {
    observeProviderCall({ provider: "openstreetmap", operation: "geocode", outcome: error.code || "failure" });
    const stale = cacheKey ? await getStaleCachedMapResponse({ kind: "geocode", key: cacheKey, maxStaleSeconds: config.mapProvider.staleCacheSeconds }) : null;
    if (stale) return ok(res, { results: stale.payload.results, provider: stale.provider, cache: "stale", degraded: true });
    return fail(res, 503, "El servicio de geocodificacion no esta disponible");
  }
});

app.get("/api/maps/route", requireAuth, async (req, res) => {
  const fromLat = Number(req.query.fromLat);
  const fromLng = Number(req.query.fromLng);
  const toLat = Number(req.query.toLat);
  const toLng = Number(req.query.toLng);
  if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite))
    return fail(res, 400, "Coordenadas invalidas");
  if (
    Math.abs(fromLat) > 90 ||
    Math.abs(toLat) > 90 ||
    Math.abs(fromLng) > 180 ||
    Math.abs(toLng) > 180
  )
    return fail(res, 400, "Coordenadas fuera de rango");
  let cacheKey;
  try {
    const routeIdentity = [fromLat, fromLng, toLat, toLng]
      .map((value) => value.toFixed(5))
      .join(",");
    cacheKey = createMapCacheKey(
      `${config.routingUrl}|driving|${routeIdentity}`,
    );
    const cached = await getCachedMapResponse({ kind: "route", key: cacheKey });
    if (cached)
      return ok(res, {
        route: cached.payload.route,
        provider: cached.provider,
        cache: "hit",
      });
    const url = new URL(
      `/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}`,
      config.routingUrl,
    );
    url.searchParams.set("overview", "full");
    url.searchParams.set("geometries", "geojson");
    url.searchParams.set("steps", "true");
    const { response } = await mapProviderCircuit.execute({
      provider: "osrm",
      operation: "route",
      timeoutMs: config.mapProvider.timeoutMs,
      call: (signal) => fetch(url, { signal }),
    });
    observeProviderCall({ provider: "osrm", operation: "route", outcome: "success" });
    const payload = await response.json();
    const route = payload.routes?.[0];
    if (!route) return fail(res, 404, "No se encontro una ruta transitable");
    const normalizedRoute = {
      distanceKm: Number((route.distance / 1000).toFixed(1)),
      durationMin: Math.max(1, Math.round(route.duration / 60)),
      coordinates: route.geometry.coordinates.map(([lng, lat]) => ({
        lat,
        lng,
      })),
      steps: (route.legs || [])
        .flatMap((leg) => leg.steps || [])
        .map((step) => ({
          type: step.maneuver?.type || "continue",
          modifier: step.maneuver?.modifier || "straight",
          street: step.name || "calle sin nombre",
          distanceM: Math.round(step.distance),
          durationSec: Math.round(step.duration),
          location: {
            lat: Number(step.maneuver.location[1]),
            lng: Number(step.maneuver.location[0]),
          },
        })),
    };
    await putCachedMapResponse({
      kind: "route",
      key: cacheKey,
      provider: "osrm",
      payload: { route: normalizedRoute },
      ttlSeconds: config.routingCacheTtlSeconds,
    });
    return ok(res, { route: normalizedRoute, provider: "osrm", cache: "miss" });
  } catch (error) {
    observeProviderCall({ provider: "osrm", operation: "route", outcome: error.code || "failure" });
    const stale = cacheKey ? await getStaleCachedMapResponse({ kind: "route", key: cacheKey, maxStaleSeconds: config.mapProvider.staleCacheSeconds }) : null;
    if (stale) return ok(res, { route: stale.payload.route, provider: stale.provider, cache: "stale", degraded: true });
    return fail(res, 503, "El servicio de rutas no esta disponible");
  }
});

app.post(
  "/api/rides",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
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
      const scheduledMs = new Date(scheduledFor).getTime();
      if (scheduledMs < Date.now() + 30 * 60 * 1000)
        return fail(
          res,
          400,
          "La reserva debe hacerse con al menos 30 minutos",
        );
      if (scheduledMs > Date.now() + 30 * 24 * 60 * 60 * 1000)
        return fail(res, 400, "Sólo puedes reservar hasta 30 días antes");
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
      return fail(
        res,
        400,
        "Idempotency-Key válido es obligatorio para solicitar viajes",
      );
    }
    if (usesPostgresCommerce() && !quoteToken)
      return fail(res, 400, "Debes cotizar el viaje antes de solicitarlo");
    const [rideZone, ridePricing] = usesPostgresCommerce()
      ? await Promise.all([
          getPostgresZonePricing(pickupCoords),
          getPostgresPricingPlan("ride"),
        ])
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
          JSON.stringify(locked.pickupCoords || null) !==
            JSON.stringify(pickupCoords || null) ||
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
        return fail(
          res,
          409,
          "La cotizacion vencio; actualiza el precio antes de solicitar",
        );
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
        return fail(
          res,
          error.status || 500,
          error.message || "No se pudo verificar el riesgo de la operación",
        );
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
        return fail(
          res,
          error.status || 500,
          error.message || "No se pudo solicitar el viaje",
        );
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
        payload: { rideId: ride.id, status: ride.status, etaMin: ride.etaMin }
      });
    await publishRealtimeEvent({
      req,
      type: "ride.created",
      entityType: "ride",
      entityId: ride.id,
      action: "ride.created",
    });
    return ok(res, { ride, label: rideLabels[ride.status] });
  },
);

app.post("/api/shipments/quote", async (req, res) => {
  const parsed = parseOrFail(shipmentQuoteSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  if (parsed.data.protection === "standard" && parsed.data.declaredValue <= 0)
    return fail(
      res,
      400,
      "Indicá el valor declarado para contratar protección",
    );
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
    [zone, pricing, protectionPlan, shipmentServiceConfig] =
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
  if (
    protectionPlan &&
    parsed.data.declaredValue > protectionPlan.maximumDeclaredValue
  )
    return fail(res, 400, "El valor declarado supera el máximo protegible");
  if (parsed.data.weightKg > shipmentServiceConfig.category.maximumWeightKg)
    return fail(
      res,
      400,
      `La categoría ${shipmentServiceConfig.category.name} admite hasta ${shipmentServiceConfig.category.maximumWeightKg} kg`,
    );
  const quote = calculateShipmentQuote(
    { ...parsed.data, ...zone, protectionPlan, shipmentServiceConfig },
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
});

app.post(
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
      return fail(
        res,
        400,
        "Idempotency-Key válido es obligatorio para crear envíos",
      );
    if (usesPostgresCommerce() && !parsed.data.quoteToken)
      return fail(res, 400, "Debes cotizar el envío antes de solicitarlo");
    const db = usesPostgresCommerce() ? {} : readDb();
    if (parsed.data.protection === "standard" && parsed.data.declaredValue <= 0)
      return fail(
        res,
        400,
        "Indicá el valor declarado para contratar protección",
      );
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
    if (
      protectionPlan &&
      parsed.data.declaredValue > protectionPlan.maximumDeclaredValue
    )
      return fail(res, 400, "El valor declarado supera el máximo protegible");
    if (parsed.data.weightKg > shipmentServiceConfig.category.maximumWeightKg)
      return fail(
        res,
        400,
        `La categoría ${shipmentServiceConfig.category.name} admite hasta ${shipmentServiceConfig.category.maximumWeightKg} kg`,
      );
    let quote = calculateShipmentQuote(
      {
        ...parsed.data,
        ...shipmentZone,
        protectionPlan,
        shipmentServiceConfig,
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
          Number(locked.declaredValue || 0) !==
            Number(parsed.data.declaredValue) ||
          String(locked.protection || "none") !== parsed.data.protection ||
          Boolean(locked.signatureRequired) !== parsed.data.signatureRequired ||
          String(locked.itemCategory || "standard") !==
            parsed.data.itemCategory ||
          String(locked.serviceLevel || "standard") !==
            parsed.data.serviceLevel ||
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
        return fail(
          res,
          409,
          "La cotización venció; actualiza el precio antes de solicitar",
        );
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
        return fail(
          res,
          error.status || 500,
          error.message || "No se pudo verificar el riesgo de la operación",
        );
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
        return fail(
          res,
          error.status || 500,
          error.message || "No se pudo crear el envío",
        );
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
        payload: { shipmentId: shipment.id, status: shipment.status, etaMin: shipment.etaMin }
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

app.post(
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
    const shipment = db.shipments.find(
      (entry) => entry.id === req.params.shipmentId,
    );
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
        await setPostgresShipmentStatus(
          shipment.id,
          "driver_assigned",
          req.auth.userId,
          driver.id,
        ),
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

app.post(
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
    const shipment = db.shipments.find(
      (entry) => entry.id === req.params.shipmentId,
    );
    if (!shipment) return fail(res, 404, "Envio no encontrado");
    if (!isAdmin(req) && !canActAsDriver(req, shipment.driverId))
      return fail(res, 403, "No puedes avanzar este envio");
    const next = {
      driver_assigned: "arriving",
      arriving: "picked_up",
      picked_up: "delivering",
      delivering: "delivered",
    }[shipment.status];
    if (!next)
      return fail(res, 409, "El envio no puede avanzar desde su estado actual");
    if (next === "delivered" && usesPostgresCommerce())
      return fail(
        res,
        409,
        "Debes verificar el PIN del destinatario para completar la entrega",
      );
    if (usesPostgresCommerce())
      Object.assign(
        shipment,
        await setPostgresShipmentStatus(shipment.id, next, req.auth.userId),
      );
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

app.get(
  "/api/shipments/:shipmentId/delivery-code",
  deliveryProofLimiter,
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "La prueba de entrega requiere PostgreSQL");
    try {
      const code = await getPostgresShipmentDeliveryCode({
        publicId: req.params.shipmentId,
        customerPublicId: req.auth.userId,
        admin: isAdmin(req),
      });
      return ok(res, { deliveryCode: code });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo consultar el código",
      );
    }
  },
);

app.post(
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
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo registrar la evidencia",
      );
    }
  },
);

app.get(
  "/api/shipments/:shipmentId/delivery-evidence",
  requireAuth,
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "La evidencia de entrega requiere PostgreSQL");
    try {
      return ok(res, {
        evidence: await getPostgresShipmentDeliveryEvidence({
          publicId: req.params.shipmentId,
          actorPublicId: req.auth.userId,
          admin: isAdmin(req),
        }),
      });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo consultar la evidencia",
      );
    }
  },
);

app.get(
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
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo abrir la evidencia",
      );
    }
  },
);

app.post(
  "/api/shipments/:shipmentId/verify-delivery",
  deliveryProofLimiter,
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "La prueba de entrega requiere PostgreSQL");
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
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo verificar la entrega",
      );
    }
  },
);
app.get(
  "/api/shipment-returns",
  requireAuth,
  requireAnyRole("customer", "support", "admin"),
  async (req, res) => {
    try {
      return ok(res, {
        returns: await getPostgresShipmentReturns({
          customerPublicId: req.auth.userId,
          includeAll: isAdmin(req) || req.auth.roles.includes("support"),
        }),
      });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudieron cargar las devoluciones",
      );
    }
  },
);
app.post(
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
      return res
        .status(201)
        .json({ ok: true, requestId: req.requestId, return: shipmentReturn });
    } catch (error) {
      return fail(
        res,
        error.code === "23505" ? 409 : error.status || 500,
        error.code === "23505"
          ? "Ya existe una devolución para este envío"
          : error.message || "No se pudo solicitar la devolución",
      );
    }
  },
);
app.patch(
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
        afterData: { status: shipmentReturn.status },
      });
      return ok(res, { return: shipmentReturn });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo actualizar la devolución",
      );
    }
  },
);
app.get(
  "/api/shipment-claims",
  requireAuth,
  requireAnyRole("customer", "support", "admin"),
  async (req, res) => {
    try {
      return ok(res, {
        claims: await getPostgresShipmentClaims({
          customerPublicId: req.auth.userId,
          includeAll: isAdmin(req) || req.auth.roles.includes("support"),
        }),
      });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudieron cargar los siniestros",
      );
    }
  },
);
app.post(
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
      return res
        .status(201)
        .json({ ok: true, requestId: req.requestId, claim });
    } catch (error) {
      return fail(
        res,
        error.code === "23505" ? 409 : error.status || 500,
        error.code === "23505"
          ? "Ya existe un siniestro para este envío"
          : error.message,
      );
    }
  },
);
app.post(
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
      return res
        .status(201)
        .json({ ok: true, requestId: req.requestId, evidence });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo adjuntar la evidencia",
      );
    }
  },
);
app.get(
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
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo abrir la evidencia",
      );
    }
  },
);
app.patch(
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
        },
      });
      return ok(res, { claim });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo actualizar el siniestro",
      );
    }
  },
);

app.patch(
  "/api/shipments/:shipmentId/status",
  requireAuth,
  async (req, res) => {
    if (
      req.body?.status !== "cancelled" ||
      !shipmentStatuses.includes(req.body.status)
    )
      return fail(res, 400, "Solo se permite cancelar el envio");
    const cancellation = parseOrFail(cancellationSchema, req.body || {});
    if (!cancellation.ok) return fail(res, 400, cancellation.message);
    const db = usesPostgresCommerce() ? {} : readDb();
    if (usesPostgresCommerce()) db.shipments = await getPostgresShipments();
    const shipment = db.shipments.find(
      (entry) => entry.id === req.params.shipmentId,
    );
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
        (await getPostgresShipments()).find(
          (entry) => entry.id === shipment.id,
        ),
        { cancellation: cancellationResult },
      );
    } else {
      shipment.status = "cancelled";
      shipment.timeline.push({ status: "cancelled", at: getTimestamp() });
    }
    await auditRuntime(db, req, "shipment", shipment.id, "shipment.cancelled");
    return ok(res, { shipment });
  },
);

app.post(
  "/api/rides/:rideId/accept",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
    const { driverId } = req.body || {};
    const db = usesPostgresCommerce() ? {} : readDb();
    if (usesPostgresCommerce())
      [db.rides, db.drivers] = await Promise.all([
        getPostgresRides(),
        getPostgresDrivers(),
      ]);
    const index = db.rides.findIndex((entry) => entry.id === req.params.rideId);
    const driver = db.drivers.find((entry) => entry.id === driverId);
    if (index < 0) return fail(res, 404, "Viaje no encontrado");
    if (!canActAsDriver(req, driverId))
      return fail(res, 403, "No puedes aceptar viajes con otro conductor");
    if (!driver || !driver.online || !driver.serviceModes.includes("ride")) {
      return fail(res, 409, "Conductor no disponible");
    }
    if (db.rides[index].driverId)
      return fail(res, 409, "El viaje ya tiene conductor");
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

app.post(
  "/api/rides/:rideId/advance",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
    const db = usesPostgresCommerce() ? {} : readDb();
    if (usesPostgresCommerce())
      [db.rides, db.drivers] = await Promise.all([
        getPostgresRides(),
        getPostgresDrivers(),
      ]);
    const index = db.rides.findIndex((entry) => entry.id === req.params.rideId);
    if (index < 0) return fail(res, 404, "Viaje no encontrado");
    if (!canAdvanceRide(req, db.rides[index]))
      return fail(res, 403, "No puedes avanzar este viaje");
    const next = nextRideStatus(db.rides[index]);
    if (!next)
      return fail(res, 409, "El viaje no puede avanzar desde este estado");
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
    await auditRuntime(
      db,
      req,
      "ride",
      db.rides[index].id,
      "ride.status_advanced",
      { status: next },
    );
    if (!usesPostgresCommerce())
      createLocalNotification({
        userId: db.rides[index].customerId,
        template: "ride_status",
        payload: { rideId: db.rides[index].id, status: next, etaMin: db.rides[index].etaMin }
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

app.patch("/api/rides/:rideId/status", requireAuth, async (req, res) => {
  const { status } = req.body || {};
  if (!rideStatuses.includes(status))
    return fail(res, 400, "Estado de viaje invalido");
  const cancellation =
    status === "cancelled"
      ? parseOrFail(cancellationSchema, req.body || {})
      : null;
  if (cancellation && !cancellation.ok)
    return fail(res, 400, cancellation.message);
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
      db.rides[index] = (await getPostgresRides()).find(
        (entry) => entry.id === db.rides[index].id,
      );
      db.rides[index].cancellation = cancellationResult;
    } else
      db.rides[index] = await setPostgresRideStatus(
        db.rides[index].id,
        status,
        req.auth.userId,
      );
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

app.patch(
  "/api/drivers/:driverId/availability",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
    const db = usesPostgresCommerce() ? {} : readDb();
    let driver = usesPostgresCommerce()
      ? (await getPostgresDrivers()).find(
          (entry) => entry.id === req.params.driverId,
        )
      : db.drivers.find((entry) => entry.id === req.params.driverId);
    if (!driver) return fail(res, 404, "Conductor no encontrado");
    if (!canActAsDriver(req, driver.id))
      return fail(res, 403, "No puedes gestionar otro conductor");
    const body = req.body || {};
    if (usesPostgresCommerce()) {
      if (body.online === true || (driver.online && body.activeService && body.activeService!==driver.activeService))
        try {
          await assertDriverCanGoOnline(driver.id,body.activeService||driver.activeService);
        } catch (error) {
          return fail(res, error.status || 409, error.message);
        }
      driver = await updatePostgresDriver(driver.id, body);
    } else {
      if (typeof body.online === "boolean") driver.online = body.online;
      if (driver.serviceModes.includes(body.activeService))
        driver.activeService = body.activeService;
    }
    await auditRuntime(
      db,
      req,
      "driver",
      driver.id,
      "driver.availability_updated",
      {
        online: driver.online,
        activeService: driver.activeService,
      },
    );
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

app.get(
  "/api/drivers/:driverId/vehicles",
  requireAuth,
  requireAnyRole("driver", "support", "admin"),
  async (req,res)=>{try{return ok(res,{vehicles:await getDriverVehicles({driverPublicId:req.params.driverId,actorPublicId:req.auth.userId,roles:req.auth.roles,includeRetired:req.query.includeRetired==="true"})});}catch(error){return fail(res,error.status||500,error.message||"No se pudieron cargar los vehículos");}},
);
app.post(
  "/api/drivers/:driverId/vehicles",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req,res)=>{const parsed=parseOrFail(driverVehicleSchema,req.body||{});if(!parsed.ok)return fail(res,400,parsed.message);try{const vehicle=await createDriverVehicle({driverPublicId:req.params.driverId,actorPublicId:req.auth.userId,roles:req.auth.roles,...parsed.data});await recordPostgresAudit({actorPublicId:req.auth.userId,roles:req.auth.roles,action:"driver_vehicle.created",entityType:"driver_vehicle",entityId:vehicle.id,requestId:req.requestId,afterData:{driverId:vehicle.driverId,kind:vehicle.kind,serviceModes:vehicle.serviceModes,status:vehicle.status}});return res.status(201).json({ok:true,requestId:req.requestId,vehicle});}catch(error){return fail(res,error.status||500,error.message||"No se pudo registrar el vehículo");}},
);
app.patch(
  "/api/driver-vehicles/:vehicleId",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req,res)=>{const parsed=parseOrFail(driverVehicleUpdateSchema,req.body||{});if(!parsed.ok)return fail(res,400,parsed.message);try{const vehicle=await updateDriverVehicle({vehiclePublicId:req.params.vehicleId,actorPublicId:req.auth.userId,roles:req.auth.roles,changes:parsed.data});await recordPostgresAudit({actorPublicId:req.auth.userId,roles:req.auth.roles,action:"driver_vehicle.updated",entityType:"driver_vehicle",entityId:vehicle.id,requestId:req.requestId,afterData:{kind:vehicle.kind,serviceModes:vehicle.serviceModes,status:vehicle.status}});return ok(res,{vehicle});}catch(error){return fail(res,error.status||500,error.message||"No se pudo actualizar el vehículo");}},
);
app.post(
  "/api/driver-vehicles/:vehicleId/activate",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req,res)=>{try{const vehicle=await activateDriverVehicle({vehiclePublicId:req.params.vehicleId,actorPublicId:req.auth.userId,roles:req.auth.roles});await recordPostgresAudit({actorPublicId:req.auth.userId,roles:req.auth.roles,action:"driver_vehicle.activated",entityType:"driver_vehicle",entityId:vehicle.id,requestId:req.requestId,afterData:{driverId:vehicle.driverId,active:true}});return ok(res,{vehicle});}catch(error){return fail(res,error.status||500,error.message||"No se pudo activar el vehículo");}},
);
app.delete(
  "/api/driver-vehicles/:vehicleId",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req,res)=>{try{const vehicle=await retireDriverVehicle({vehiclePublicId:req.params.vehicleId,actorPublicId:req.auth.userId,roles:req.auth.roles});await recordPostgresAudit({actorPublicId:req.auth.userId,roles:req.auth.roles,action:"driver_vehicle.retired",entityType:"driver_vehicle",entityId:vehicle.id,requestId:req.requestId,afterData:{driverId:vehicle.driverId,retiredAt:vehicle.retiredAt}});return ok(res,{vehicle});}catch(error){return fail(res,error.status||500,error.message||"No se pudo retirar el vehículo");}},
);
app.patch(
  "/api/admin/driver-vehicles/:vehicleId/review",
  requireAuth,
  requireAnyRole("admin"),
  async (req,res)=>{const parsed=parseOrFail(driverVehicleReviewSchema,req.body||{});if(!parsed.ok)return fail(res,400,parsed.message);try{const vehicle=await reviewDriverVehicle({vehiclePublicId:req.params.vehicleId,actorPublicId:req.auth.userId,roles:req.auth.roles,...parsed.data});await recordPostgresAudit({actorPublicId:req.auth.userId,roles:req.auth.roles,action:`driver_vehicle.${parsed.data.status}`,entityType:"driver_vehicle",entityId:vehicle.id,requestId:req.requestId,afterData:{driverId:vehicle.driverId,status:vehicle.status,rejectionReason:vehicle.rejectionReason}});return ok(res,{vehicle});}catch(error){return fail(res,error.status||500,error.message||"No se pudo revisar el vehículo");}},
);

app.get(
  "/api/drivers/:driverId/compliance",
  requireAuth,
  requireAnyRole("driver", "support", "admin"),
  async (req, res) => {
    try {
      return ok(res, {
        compliance: await getDriverCompliance({
          actorPublicId: req.auth.userId,
          roles: req.auth.roles,
          driverPublicId: req.params.driverId,
        }),
      });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo cargar el legajo",
      );
    }
  },
);
app.post(
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
      return res
        .status(201)
        .json({ ok: true, requestId: req.requestId, document });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo enviar el documento",
      );
    }
  },
);
app.get(
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
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo leer el documento",
      );
    }
  },
);
app.patch(
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
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo revisar el documento",
      );
    }
  },
);

app.patch(
  "/api/drivers/:driverId/location",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(driverLocationSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    const db = usesPostgresCommerce() ? {} : readDb();
    let driver = usesPostgresCommerce()
      ? (await getPostgresDrivers()).find(
          (entry) => entry.id === req.params.driverId,
        )
      : db.drivers.find((entry) => entry.id === req.params.driverId);
    if (!driver) return fail(res, 404, "Conductor no encontrado");
    if (!canActAsDriver(req, driver.id))
      return fail(res, 403, "No puedes actualizar otro conductor");
    const { lat, lng, label,source,accuracyM } = parsed.data;
    if (usesPostgresCommerce()) {
      driver = await updatePostgresDriver(driver.id, {
        lat,
        lng,
        label: label || driver.location.label || "Ubicacion GPS",
        source:source||"foreground",
        accuracyM,
      });
    } else {
      driver.location = {
        lat,
        lng,
        label: label || driver.location.label || "Ubicacion GPS",
        updatedAt: getTimestamp(),
        source:source||"foreground",
        accuracyM:accuracyM??null,
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

app.post(
  "/api/reset",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    if (config.databaseUrl)
      return fail(
        res,
        409,
        "Reset deshabilitado mientras PostgreSQL es la fuente real",
      );
    await publishRealtimeEvent({
      req,
      type: "platform.reset",
      action: "platform.reset",
    });
    ok(res, { state: resetDb() });
  },
);

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, {
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`))
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      else if (path.basename(filePath) === "index.html")
        res.setHeader("Cache-Control", "no-cache");
    },
  }));
  app.get(/^\/assets\/.+/, (_req, res) => {
    fail(res, 404, "Asset no encontrado");
  });
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.use((req, res) => {
  fail(res, 404, `Ruta no encontrada: ${req.method} ${req.path}`);
});

app.use((error, req, res, _next) => {
  const status = Number(error.status || error.statusCode || 500);
  if (status >= 500 && config.logLevel !== "silent") {
    console.error(
      JSON.stringify({
        level: "error",
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl.split("?",1)[0],
        status,
        message: error.message,
      }),
    );
  }
  return fail(
    res,
    status >= 400 && status < 600 ? status : 500,
    status >= 500 ? "Error interno del servidor" : error.message,
  );
});

const server = app.listen(config.port, config.host, () => {
  console.log(`Flash API running on http://${config.host}:${config.port}`);
});

server.on("error", (error) => {
  console.error("Flash API failed to start", error);
  process.exitCode = 1;
});

const shutdown = createGracefulShutdown({
  server,
  realtimeClients,
  stopRealtimeListener,
  closePostgres,
  closeRedis,
  stopTelemetry,
  graceMs: config.shutdownGraceMs,
  onDrain: () => { draining = true; },
});

for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    shutdown(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        console.error(JSON.stringify({ level: "error", event: "shutdown.failed", message: error.message }));
        process.exit(1);
      });
  });
