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
import { bypassRefusalReason } from "./rls-guard.js";
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
import { serviceChatRouter } from "./http/service-chat-router.js";
import { driverRouter } from "./http/driver-router.js";
import { accountRouter } from "./http/account-router.js";
import { jobClosureRouter } from "./http/job-closure-router.js";
import { adminRouter } from "./http/admin-router.js";
import { loadRuntimeState, metrics } from "./runtime-snapshot.js";
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

app.use(catalogRouter);
app.use(orderRouter);
app.use(rideRouter);
app.use(shipmentRouter);
app.use(authRouter);
app.use(merchantRouter);
app.use(serviceChatRouter);
app.use(driverRouter);
app.use(accountRouter);
app.use(jobClosureRouter);
app.use(adminRouter);
app.use(addressesRouter);
app.use(rideContextRouter);
app.use(driverFleetRouter);
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

app.use(paymentMethodsRouter);

app.use(supportRouter);
app.use(queueTriggersRouter);
app.use(notificationsRouter);
app.use(dietaryRouter);
app.use(configurationRouter);
app.use(pricingRouter);
app.use(feedbackRouter);

app.use(realtimeRouter);

app.get("/api/metrics", requireAuth, requireAnyRole("admin"), async (req, res) => {
  ok(res, { metrics: metrics(await loadRuntimeState(req)) });
});

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

app.use(financialReviewRouter);

app.use(mapsRouter);

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

// Antes de escuchar: si el rol de PostgreSQL puede saltear RLS, este proceso no
// atiende. `/api/ready` ya devolvía 503, pero eso sólo lo saca del balanceador;
// un proceso que falla readiness sigue respondiendo a quien lo alcance directo.
const negativa = bypassRefusalReason(await postgresReadiness(), {
  isProduction: config.isProduction,
});
if (negativa) {
  console.error(`Flash API se niega a arrancar: ${negativa}`);
  process.exit(1);
}

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
