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
import { coordinateSchema, distanceBetween } from "./geo.js";
import { publicUser, sanitizeUser } from "./user-view.js";
import { fail, failFrom, ok, parseOrFail } from "./http/responses.js";
import {
  canActAsCustomer,
  canActAsDriver,
  canAdvanceOrder,
  canAdvanceRide,
  canManageRestaurant,
  canMutateOrderStatus,
  canMutateRideStatus,
  hasRole,
  isAdmin,
  requireAnyRole,
} from "./http/authorization.js";
import { auditRuntime } from "./audit-trail.js";
import {
  audit,
  fallbackRidePricing,
  fallbackShipmentPricing,
  readDb,
  addTimeline,
  findRestaurant,
  scopeStateForRequest,
  sqliteReadCount,
} from "./fallback-runtime.js";
import { requireAuth } from "./http/authentication.js";
import { isSameOrigin, requireTrustedWebOrigin } from "./http/web-origin.js";
import { backofficeReportsRouter } from "./http/backoffice-reports-router.js";
import { catalogRouter } from "./http/catalog-router.js";
import { orderRouter } from "./http/order-router.js";
import { rideRouter } from "./http/ride-router.js";
import { shipmentRouter } from "./http/shipment-router.js";
import { authRouter } from "./http/auth-router.js";
import { merchantRouter } from "./http/merchant-router.js";
import { paymentProviderRouter } from "./http/payment-provider-router.js";
import { orderIssuesRouter } from "./http/order-issues-router.js";
import { cancellationSchema } from "./http/cancellation.js";
import { creditDriverEarningsRuntime } from "./driver-earnings.js";
import { addressesRouter } from "./http/addresses-router.js";
import { dietaryRouter } from "./http/dietary-router.js";
import { featureFlagsRouter } from "./http/feature-flags-router.js";
import { feedbackRouter } from "./http/feedback-router.js";
import { financialReviewRouter } from "./http/financial-review-router.js";
import { notificationsRouter } from "./http/notifications-router.js";
import {
  publishRealtimeEvent,
  realtimeClients,
  realtimeRouter,
  startRealtimeListener,
} from "./http/realtime.js";
import { mapsRouter } from "./http/maps-router.js";
import { rideContextRouter } from "./http/ride-context-router.js";
import { driverFleetRouter } from "./http/driver-fleet-router.js";
import { shipmentProtectionRouter } from "./http/shipment-protection-router.js";
import { productAnalyticsRouter } from "./http/product-analytics-router.js";
import { queueTriggersRouter } from "./http/queue-triggers-router.js";
import { paymentMethodsRouter } from "./http/payment-methods-router.js";
import { pricingRouter } from "./http/pricing-router.js";
import { supportRouter } from "./http/support-router.js";
import { configurationRouter } from "./http/configuration-router.js";
import {
  createLimiter,
  deliveryProofLimiter,
  payoutStepUpLimiter,
  serviceChatLimiter,
} from "./http/rate-limits.js";
import { closeRedis, redisClient, redisReadiness } from "./redis.js";
import { openApiDocument } from "./openapi.js";
import { closePostgres, postgresPool, postgresReadiness } from "./postgres.js";
import { getPostgresMerchantDashboard } from "./merchant-dashboard-repository.js";
import { stopTelemetry } from "./telemetry.js";
import { createGracefulShutdown } from "./graceful-shutdown.js";
import {
  beginMerchantPaymentOAuth,
  completeMerchantPaymentOAuth,
  getMerchantPaymentConnection,
  revokeMerchantPaymentConnection,
} from "./payment-oauth-repository.js";
import { verifyMercadoPagoWebhook } from "./mercadopago-webhook.js";
import { enqueueMercadoPagoWebhook } from "./mercadopago-webhook-repository.js";
import { cancelMarketplaceOrderAndRefund } from "./marketplace-refund-repository.js";
import {
  confirmPhoneVerification,
  requestPhoneVerification,
} from "./phone-verification-repository.js";
import { observeHttpRequest, observeProviderCall, renderPrometheus } from "./observability.js";
import {
  createPostgresSession,
  findAuthUserByEmail,
  findAuthUserByPublicId,
  getPostgresAddresses,
  getPostgresPaymentMethods,
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
  setPostgresUserStatus,
  updatePostgresAuthProfile,
  usesPostgresAuth,
} from "./auth-repository.js";
import {
  createPostgresMenuItem,
  getPostgresOperationsRestaurantPage,
  getPostgresRestaurantPage,
  getPostgresRestaurants,
  replacePostgresBranchSchedule,
  replacePostgresItemDietary,
  replacePostgresItemModifiers,
  updatePostgresBranch,
  updatePostgresBranchInventory,
  updatePostgresMenuItem,
  updatePostgresRestaurant,
  upsertPostgresBranchScheduleException,
} from "./catalog-repository.js";
import {
  getPostgresDriverForUser,
  getPostgresDrivers,
  getPostgresOperationsDriverPage,
  updatePostgresDriver,
} from "./driver-roster-repository.js";
import {
  assignPostgresOrderDriver,
  createPostgresOrder,
  getPostgresCart,
  getPostgresFoodCheckoutQuote,
  getPostgresFoodDeliveryQuote,
  getPostgresMerchantActiveOrderPage,
  getPostgresOrders,
  processPostgresOrderMarketplacePayment,
  reorderPostgresOrder,
  replacePostgresCart,
  setPostgresOrderStatus,
} from "./order-repository.js";
import { usesPostgresCommerce } from "./postgres.js";
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
  getShipmentServiceConfiguration,
} from "./mobility-repository.js";
import {
  cancelMobilityJobAndRefundWallet,
  cancelOrderAndRefundWallet,
  creditWallet,
  getPostgresWalletTransactions,
  getDriverEarnings,
  getWallet,
  getWalletBalances,
  settleMobilityWalletPayment,
} from "./wallet-repository.js";
import { claimReferral, getReferralSummary } from "./referral-repository.js";
import {
  decodeActivityCursor,
  getActivityPage,
  getAssignedDriverProjections,
} from "./activity-repository.js";
import {
  evaluateFeatureFlags,
  getFeatureFlags,
  updateFeatureFlag,
} from "./feature-flag-repository.js";
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
  getPostgresAdminFinancials,
  getPostgresAuditEvents,
  getPostgresAuditEventPage,
  getPostgresSupportTickets,
  getPostgresOperationsSupportTicketPage,
  getSupportAgents,
  processSupportQueue,
  recordPostgresAudit,
  updateSupportAgent,
} from "./operations-repository.js";
import {
  createPostgresPricingChangeRequest,
  createPostgresPricingRollbackRequest,
  getPostgresPricingChangeRequests,
  getPostgresPricingPlan,
  getPostgresPromotions,
  getPostgresZonePricing,
  getPostgresZones,
  reviewPostgresPricingChangeRequest,
  updatePostgresZone,
} from "./configuration-repository.js";
import { getPostgresFavoriteMerchantIds, getPostgresRatings } from "./feedback-repository.js";
import {
  enqueuePostgresNotification,
  getNotificationDeadLetters,
  processPostgresNotificationBatch,
  replayNotificationDeadLetter,
} from "./notification-repository.js";
import {
  getPostgresDispatchOffers,
  processPostgresDispatchBatch,
  rejectPostgresDispatchOffer,
} from "./dispatch-repository.js";
import {
  getMerchantFinance,
  getPayoutReviewQueue,
  requestMerchantPayout,
  createPayoutStepUp,
  reviewMerchantPayout,
} from "./merchant-finance-repository.js";
import { searchPostgresCatalog } from "./catalog-search-repository.js";
import {
  createPostgresTip,
  getPostgresTips,
  getTipAdjustments,
  requestTipAdjustment,
  reviewTipAdjustment,
} from "./tip-repository.js";
import { getOrCreatePostgresReceipt } from "./receipt-repository.js";
import { createOrderIssue, getOrderIssues, resolveOrderIssue } from "./order-issue-repository.js";
import {
  decideOrderSubstitution,
  getOrderSubstitutions,
  proposeOrderSubstitution,
} from "./substitution-repository.js";
import {
  assertDriverCanGoOnline,
  getDriverCompliance,
  getDriverDocumentContent,
  reviewDriverDocument,
  submitDriverDocument,
} from "./compliance-repository.js";
import { getDriverPreferences, updateDriverPreferences } from "./driver-preference-repository.js";
import { getDriverDemandZones } from "./driver-demand-repository.js";
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
  getLocalProductMetrics,
  getPublicState,
  getDatabasePath,
  getTimestamp,
  orderStatuses,
  revokeAuthSession,
  resetDb,
  rideStatuses,
  shipmentStatuses,
  writeDb,
} from "./store.js";

const app = express();
const jwtSecret = config.jwtSecret;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, "..", "dist");
const processStartedAt = Date.now();
let draining = false;

app.disable("x-powered-by");
app.set("trust proxy", config.isProduction ? 1 : false);

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

const stopRealtimeListener = await startRealtimeListener();

function corsOrigin(origin, callback) {
  if (!origin || config.corsOrigins.includes("*") || config.corsOrigins.includes(origin)) {
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

app.use(requestContext);
app.use(requestLogger);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: [
          "'self'",
          ...config.corsOrigins.filter((origin) => origin !== "*"),
          ...config.webMapOrigins,
        ],
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
app.use(
  compression({
    threshold: 1024,
    filter: (req, res) => req.path !== "/api/events" && compression.filter(req, res),
  }),
);
app.use("/api/auth", (_req, res, next) => {
  res.set("Cache-Control", "no-store, private");
  res.set("Pragma", "no-cache");
  next();
});
app.use("/api/auth", requireTrustedWebOrigin);
app.use("/api", (req, res, next) => {
  if (!new Set(["POST", "PUT", "PATCH", "DELETE"]).has(req.method)) return next();
  const hasBody =
    Number(req.get("content-length") || 0) > 0 || Boolean(req.get("transfer-encoding"));
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

// The database independently locks PIN verification after five failures. This
// wider edge budget also covers authorized photo upload/download operations.

const phoneVerificationConfirmSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Código inválido"),
});
const driverLocationSchema = coordinateSchema.extend({
  label: z.string().trim().min(2).max(120).optional(),
  source: z.enum(["foreground", "background"]).optional(),
  accuracyM: z.coerce.number().min(0).max(1000).optional(),
});
const driverPreferenceSchema = z.object({
  navigationProvider: z.enum(["system", "google_maps", "apple_maps"]),
});

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9][0-9]{7,14}$/, "Usa formato internacional, por ejemplo +5491112345678"),
  defaultAddress: z.string().trim().min(3).max(240),
});

const walletTopUpSchema = z.object({
  amount: z.coerce.number().int().min(1000).max(200000),
});
const referralClaimSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^FLASH[A-Z0-9]{8}$/),
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
        Object.entries(serviceQuickReplyFields).map(([key, value]) => [key, value.optional()]),
      ),
    )
    .refine((value) => Object.keys(value).length > 0, "No hay cambios");
const supportAgentUpdateSchema = z
  .object({
    availability: z.enum(["available", "busy", "offline"]).optional(),
    maxActiveTickets: z.coerce.number().int().min(1).max(100).optional(),
    skills: z.array(z.string().trim().min(1).max(80)).min(1).max(20).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Debes indicar un cambio");
const userStatusSchema = z.object({
  status: z.enum(["active", "suspended"]),
  reason: z.string().trim().min(5).max(240),
});
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
function accountSnapshot(db, userId) {
  return {
    user: publicUser(db, userId),
    addresses: (db.addresses || []).filter((entry) => entry.userId === userId),
    paymentMethods: (db.paymentMethods || []).filter((entry) => entry.userId === userId),
    walletTransactions: (db.walletTransactions || []).filter((entry) => entry.userId === userId),
    supportTickets: (db.supportTickets || []).filter((entry) => entry.userId === userId),
    ratings: (db.ratings || []).filter((entry) => entry.userId === userId),
  };
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
    const {
      password: _password,
      internalId: _internalId,
      loginLockedUntil: _loginLockedUntil,
      ...safeUser
    } = user;
    return { ...safeUser, wallet: balances.get(user.id) || 0 };
  });
  return state;
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
  const activeRideStatuses = ["requested", "driver_assigned", "arriving", "in_progress"];
  const activeOrders = db.orders.filter((order) => activeOrderStatuses.includes(order.status));
  const activeRides = db.rides.filter((ride) => activeRideStatuses.includes(ride.status));
  const completedRevenue = [
    ...db.orders.filter((order) => order.status === "delivered").map((order) => order.total),
    ...db.rides.filter((ride) => ride.status === "completed").map((ride) => ride.fare),
  ].reduce((sum, value) => sum + value, 0);
  const openTickets = db.supportTickets.filter((ticket) => ticket.status === "open").length;
  return {
    activeOrders: activeOrders.length,
    activeRides: activeRides.length,
    onlineDrivers: db.drivers.filter((driver) => driver.online).length,
    openRestaurants: db.restaurants.filter((restaurant) => restaurant.open).length,
    completedRevenue,
    openTickets,
    avgOrderEta: activeOrders.length
      ? Math.round(activeOrders.reduce((sum, order) => sum + order.etaMin, 0) / activeOrders.length)
      : 0,
    avgRideEta: activeRides.length
      ? Math.round(activeRides.reduce((sum, ride) => sum + ride.etaMin, 0) / activeRides.length)
      : 0,
  };
}

function ratio(part, total) {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(1));
}

function average(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

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
      return fail(
        res,
        503,
        "El rol PostgreSQL del runtime tiene privilegios incompatibles con producción",
      );
    if (config.redis.required && !redis.ready)
      return fail(res, 503, "Redis distribuido no disponible");
    const runtimeCounts = usesPostgresCommerce()
      ? await Promise.all([getPostgresUsers(), getPostgresRestaurants(), getPostgresDrivers()])
      : [db.users, db.restaurants, db.drivers];
    return ok(res, {
      service: "flash-fullstack-api",
      database: postgres,
      redis,
      runtimeStore: config.databaseUrl ? "postgres-primary" : "sqlite-demo",
      fallbackDiagnostics: { sqliteReads: sqliteReadCount() },
      authStore: usesPostgresAuth() ? "postgres" : "sqlite-test-fallback",
      domainStores: {
        catalog: usesPostgresCommerce() ? "postgres" : "sqlite-test-fallback",
        carts: usesPostgresCommerce() ? "postgres" : "sqlite-test-fallback",
        foodOrders: usesPostgresCommerce() ? "postgres" : "sqlite-test-fallback",
        drivers: usesPostgresCommerce() ? "postgres-postgis" : "sqlite-test-fallback",
        driverLocations: usesPostgresCommerce()
          ? "postgres-postgis+source+accuracy+freshness-gate"
          : "sqlite-test-fallback",
        driverVehicles: usesPostgresCommerce()
          ? "postgres-verified-registry+mode-eligibility"
          : "sqlite-test-fallback",
        rides: usesPostgresCommerce() ? "postgres-postgis" : "sqlite-test-fallback",
        shipments: usesPostgresCommerce() ? "postgres-postgis" : "sqlite-test-fallback",
        dispatch: usesPostgresCommerce()
          ? "postgres-postgis-expiring-offers+wave-worker"
          : "sqlite-test-fallback",
        wallet: usesPostgresAuth() ? "postgres-double-entry-ledger" : "sqlite-test-fallback",
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
        zones: usesPostgresCommerce() ? "postgres-postgis-live-counts" : "sqlite-test-fallback",
        pricing: usesPostgresCommerce()
          ? "postgres-versioned-plans+signed-quotes"
          : "sqlite-test-fallback",
        audit: usesPostgresCommerce() ? "postgres-operational-events" : "sqlite-test-fallback",
        feedback: usesPostgresCommerce() ? "postgres-ratings+favorites" : "sqlite-test-fallback",
        addresses: usesPostgresAuth() ? "postgres-postgis-address-book" : "sqlite-test-fallback",
        rideDestinations: usesPostgresAuth()
          ? "postgres-postgis-private-recents"
          : "sqlite-test-fallback",
        rideTrustedContacts: usesPostgresAuth()
          ? "postgres-rls+aes256gcm-private-contacts"
          : "unavailable",
        ridePickupVerification: usesPostgresAuth() ? "postgres-bcrypt-pin+lockout" : "unavailable",
        serviceChat: usesPostgresAuth()
          ? "postgres-aes256gcm+participant-rls+receipts+attachments+configured-replies"
          : "unavailable",
        maps: usesPostgresAuth() ? "nominatim+osrm+postgres-ttl-cache" : "external-provider-only",
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
  const {
    orders: _orders,
    rides: _rides,
    shipments: _shipments,
    tips: _tips,
    ...withoutActivity
  } = scopedState;
  const excludedBootstrapKeys = ["customer", "merchant", "driver", "operations"].includes(
    req.params.audience,
  )
    ? [
        "restaurants",
        "drivers",
        "zones",
        "promotions",
        "addresses",
        "paymentMethods",
        "walletTransactions",
        "supportTickets",
        "ratings",
        "favoriteRestaurantIds",
        "tips",
        ...(req.params.audience === "operations" ? ["users", "auditEvents"] : []),
      ]
    : [];
  const bootstrapState = Object.fromEntries(
    Object.entries(withoutActivity).filter(([key]) => !excludedBootstrapKeys.includes(key)),
  );
  res.set("Cache-Control", "no-store, private");
  ok(res, {
    audience: req.params.audience,
    state: {
      ...bootstrapState,
      metrics: metrics(scopedState),
    },
  });
});

app.get("/api/me/activity", requireAuth, async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const cursor = decodeActivityCursor(String(req.query.cursor || ""));
  if (req.query.cursor && !cursor) return fail(res, 400, "Cursor de actividad inválido");
  if (!usesPostgresCommerce()) {
    const scoped = scopeStateForRequest(getPublicState(), req),
      items = [
        ...scoped.orders.map((resource) => ({
          id: resource.id,
          kind: "order",
          createdAt: resource.createdAt,
          resource,
        })),
        ...scoped.rides.map((resource) => ({
          id: resource.id,
          kind: "ride",
          createdAt: resource.createdAt,
          resource,
        })),
        ...(scoped.shipments || []).map((resource) => ({
          id: resource.id,
          kind: "shipment",
          createdAt: resource.createdAt,
          resource,
        })),
      ]
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, limit);
    res.set("Cache-Control", "no-store, private");
    return ok(res, { items, nextCursor: null });
  }
  try {
    res.set("Cache-Control", "no-store, private");
    return ok(
      res,
      await getActivityPage({
        userPublicId: req.auth.userId,
        roles: req.auth.roles,
        limit,
        cursor,
      }),
    );
  } catch (error) {
    return failFrom(res, error, "No se pudo cargar la actividad");
  }
});

app.get("/api/driver/me", requireAuth, requireAnyRole("driver"), async (req, res) => {
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

app.get("/api/driver/earnings", requireAuth, requireAnyRole("driver"), async (req, res) => {
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

app.get("/api/driver/demand-zones", requireAuth, requireAnyRole("driver"), async (req, res) => {
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

app.get("/api/driver/preferences", requireAuth, requireAnyRole("driver"), async (req, res) => {
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

app.patch("/api/driver/preferences", requireAuth, requireAnyRole("driver"), async (req, res) => {
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

app.get(
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

const publicRestaurantFallback = (restaurant) => {
  const { ownerId: _ownerId, manualOpen: _manualOpen, ...safe } = restaurant;
  return {
    ...safe,
    branches: (restaurant.branches || []).map(
      ({
        manualOpen: _branchManual,
        weeklyHours: _hours,
        scheduleExceptions: _exceptions,
        inventory: _inventory,
        ...branch
      }) => branch,
    ),
  };
};
app.use(catalogRouter);
app.use(orderRouter);
app.use(rideRouter);
app.use(shipmentRouter);
app.use(authRouter);
app.use(merchantRouter);
app.use(paymentProviderRouter);
app.use(shipmentProtectionRouter);
app.use(orderIssuesRouter);

app.use(backofficeReportsRouter);
app.use(featureFlagsRouter);
app.use(productAnalyticsRouter);
app.get("/api/state", requireAuth, (_req, res) => {
  res.set("Cache-Control", "no-store");
  return fail(res, 410, "El estado global fue retirado; usa bootstrap y recursos segmentados");
});

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
      return failFrom(res, error, "No se pudo abrir la conversación");
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
      return failFrom(res, error, "No se pudo confirmar la lectura");
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
      return res.status(201).json({ ok: true, requestId: req.requestId, message });
    } catch (error) {
      return failFrom(res, error, "No se pudo enviar el mensaje");
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
      return failFrom(res, error, "No se pudo abrir el adjunto");
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
      return failFrom(res, error, "No se pudieron cargar respuestas rápidas");
    }
  },
);
app.get(
  "/api/admin/service-chat/quick-replies",
  requireAuth,
  requireAnyRole("admin"),
  async (_req, res) => ok(res, { quickReplies: await listServiceQuickReplies() }),
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
      return res.status(201).json({ ok: true, requestId: req.requestId, quickReply });
    } catch (error) {
      return failFrom(
        res,
        // Una violación de unicidad es un conflicto del cliente, no una falla
        // del servidor: conserva su 409 y su mensaje propio.
        error.code === "23505" ? { status: 409, message: "La respuesta ya existe" } : error,
        "La respuesta ya existe",
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
      return failFrom(
        res,
        // Una violación de unicidad es un conflicto del cliente, no una falla
        // del servidor: conserva su 409 y su mensaje propio.
        error.code === "23505" ? { status: 409, message: "La respuesta ya existe" } : error,
        "La respuesta ya existe",
      );
    }
  },
);

app.use(paymentMethodsRouter);

app.use(supportRouter);
app.get(
  "/api/admin/support/agents",
  requireAuth,
  requireAnyRole("support", "admin"),
  async (_req, res) => {
    try {
      return ok(res, { agents: await getSupportAgents() });
    } catch (error) {
      return failFrom(res, error, "No se pudieron cargar los agentes");
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
      return failFrom(res, error, "No se pudo actualizar el agente");
    }
  },
);
app.use(queueTriggersRouter);
app.use(notificationsRouter);
app.use(dietaryRouter);
app.get("/api/driver/offers", requireAuth, requireAnyRole("driver", "admin"), async (req, res) => {
  const driverId = isAdmin(req)
    ? String(req.query.driverId || req.auth.user.driverId || "")
    : req.auth.user.driverId;
  if (!driverId) return fail(res, 400, "Falta el conductor");
  try {
    return ok(res, { offers: await getPostgresDispatchOffers(driverId) });
  } catch (_error) {
    return fail(res, 500, "No se pudieron cargar las ofertas");
  }
});
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
      return failFrom(res, error, "No se pudo rechazar la oferta");
    }
  },
);
app.use(configurationRouter);
app.use(pricingRouter);
app.use(feedbackRouter);

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
    const [wallet, addresses, paymentMethods, supportTickets, ratings] = await Promise.all([
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
    account.paymentMethods = paymentMethods.filter((entry) => entry.userId === req.auth.userId);
    account.supportTickets = supportTickets;
    account.ratings = ratings;
    account.favoriteRestaurantIds = await getPostgresFavoriteMerchantIds(req.auth.userId);
    account.tips = await getPostgresTips({ userPublicId: req.auth.userId, roles: [] });
  }
  res.set("Cache-Control", "no-store, private");
  return ok(res, { account });
});

app.use(addressesRouter);

app.use(rideContextRouter);

app.post("/api/me/phone-verification/request", requireAuth, async (req, res) => {
  if (!usesPostgresAuth()) return fail(res, 503, "La verificación telefónica requiere PostgreSQL");
  try {
    return ok(res, await requestPhoneVerification(req.auth.userId));
  } catch (error) {
    if (error.retryAfter) res.set("Retry-After", String(error.retryAfter));
    return failFrom(res, error, "No se pudo enviar el código");
  }
});

app.post("/api/me/phone-verification/confirm", requireAuth, async (req, res) => {
  const parsed = parseOrFail(phoneVerificationConfirmSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  if (!usesPostgresAuth()) return fail(res, 503, "La verificación telefónica requiere PostgreSQL");
  try {
    return ok(
      res,
      await confirmPhoneVerification({ userPublicId: req.auth.userId, code: parsed.data.code }),
    );
  } catch (error) {
    return failFrom(res, error, "No se pudo verificar el teléfono");
  }
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
  if (usesPostgresAuth()) await updatePostgresAuthProfile(user.id, { name, phone, defaultAddress });
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
    const [wallet, addresses, paymentMethods, supportTickets, ratings] = await Promise.all([
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
    account.paymentMethods = paymentMethods.filter((entry) => entry.userId === user.id);
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
    return failFrom(res, error, "No se pudo cargar referidos");
  }
});

app.post("/api/referrals/claim", requireAuth, async (req, res) => {
  const parsed = parseOrFail(referralClaimSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  if (!usesPostgresAuth()) return fail(res, 503, "Referidos requiere PostgreSQL");
  try {
    const referral = await claimReferral({ publicUserId: req.auth.userId, code: parsed.data.code });
    await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "referral.claimed",
      entityType: "user",
      entityId: req.auth.userId,
      requestId: req.requestId,
      afterData: { code: parsed.data.code },
    });
    return ok(res, { referral });
  } catch (error) {
    return failFrom(res, error, "No se pudo aplicar el referido");
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
        paymentMethods: paymentMethods.filter((entry) => entry.userId === user.id),
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

app.use(realtimeRouter);

app.get("/api/metrics", requireAuth, requireAnyRole("admin"), async (req, res) => {
  ok(res, { metrics: metrics(await loadRuntimeState(req)) });
});

app.post("/api/jobs/:jobId/tips", requireAuth, requireAnyRole("customer"), async (req, res) => {
  if (!usesPostgresCommerce()) return fail(res, 503, "Las propinas requieren PostgreSQL");
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
    return failFrom(res, error, "No se pudo enviar la propina");
  }
});
app.get("/api/admin/tip-adjustments", requireAuth, requireAnyRole("admin"), async (_req, res) => {
  try {
    return ok(res, { adjustments: await getTipAdjustments() });
  } catch (error) {
    return failFrom(res, error, "No se pudieron cargar los ajustes de propinas");
  }
});
app.post("/api/admin/tip-adjustments", requireAuth, requireAnyRole("admin"), async (req, res) => {
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
    return res.status(201).json({ ok: true, requestId: req.requestId, adjustment });
  } catch (error) {
    return failFrom(res, error, "No se pudo solicitar el ajuste");
  }
});
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
      return failFrom(res, error, "No se pudo revisar el ajuste");
    }
  },
);
app.get(
  "/api/jobs/:jobId/receipt",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return fail(res, 503, "Los comprobantes requieren PostgreSQL");
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
      return failFrom(res, error, "No se pudo obtener el comprobante");
    }
  },
);

app.get("/api/internal/metrics", async (req, res) => {
  const supplied = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const expected = Buffer.from(config.metricsToken),
    actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected))
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
    realtimeEvents = await postgresPool.query("SELECT count(*)::int count FROM realtime_events"),
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

app.get("/api/admin/dashboard", requireAuth, requireAnyRole("admin"), async (req, res) => {
  ok(res, {
    dashboard: adminSnapshot(
      await loadRuntimeState(req),
      usesPostgresCommerce() ? await getPostgresAdminFinancials() : null,
    ),
  });
});

app.patch(
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

app.use(financialReviewRouter);

app.use(mapsRouter);

app.patch(
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

app.use(driverFleetRouter);

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
      return failFrom(res, error, "No se pudo cargar el legajo");
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
      return res.status(201).json({ ok: true, requestId: req.requestId, document });
    } catch (error) {
      return failFrom(res, error, "No se pudo enviar el documento");
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
      return failFrom(res, error, "No se pudo leer el documento");
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
      return failFrom(res, error, "No se pudo revisar el documento");
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

app.post("/api/reset", requireAuth, requireAnyRole("admin"), async (req, res) => {
  if (config.databaseUrl)
    return fail(res, 409, "Reset deshabilitado mientras PostgreSQL es la fuente real");
  await publishRealtimeEvent({
    req,
    type: "platform.reset",
    action: "platform.reset",
  });
  ok(res, { state: resetDb() });
});

if (fs.existsSync(distDir)) {
  app.use(
    express.static(distDir, {
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`))
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        else if (path.basename(filePath) === "index.html")
          res.setHeader("Cache-Control", "no-cache");
      },
    }),
  );
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
        path: req.originalUrl.split("?", 1)[0],
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
  onDrain: () => {
    draining = true;
  },
});

for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    shutdown(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        console.error(
          JSON.stringify({ level: "error", event: "shutdown.failed", message: error.message }),
        );
        process.exit(1);
      });
  });
