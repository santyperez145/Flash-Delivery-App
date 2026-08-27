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
import { sanitizeUser } from "./user-view.js";
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
import { backofficeReportsRouter } from "./http/backoffice-reports-router.js";
import { catalogRouter } from "./http/catalog-router.js";
import { orderRouter } from "./http/order-router.js";
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

const loginSchema = z.object({
  email: z.string().email("Email invalido"),
  password: z.string().min(4, "Password demasiado corto"),
  deviceName: z.string().trim().max(160).optional(),
  audience: z.enum(["customer", "driver", "merchant"]).optional(),
});

const registerSchema = z.object({
  name: z.string().min(2, "Nombre obligatorio"),
  email: z.string().email("Email invalido"),
  password: z.string().min(8, "Password minimo 8 caracteres").max(128, "Password demasiado largo"),
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9][0-9]{7,14}$/, "Usa formato internacional, por ejemplo +5491112345678")
    .optional(),
  deviceName: z.string().trim().max(160).optional(),
});
const passwordRecoveryRequestSchema = z.object({
  email: z.string().email("Email inválido"),
});
const passwordRecoveryConsumeSchema = z.object({
  token: z.string().min(40).max(128),
  password: z.string().min(8, "Password mínimo 8 caracteres").max(128, "Password demasiado largo"),
});
const emailVerificationRequestSchema = z.object({
  email: z.string().email("Email inválido"),
});
const emailVerificationConfirmSchema = emailVerificationRequestSchema.extend({
  code: z.string().regex(/^\d{6}$/, "Código inválido"),
});
const phoneVerificationConfirmSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Código inválido"),
});
const mfaCodeSchema = z.object({ code: z.string().trim().min(6).max(32) });
const mfaCompleteSchema = mfaCodeSchema.extend({
  challenge: z.string().min(20),
  deviceName: z.string().trim().max(160).optional(),
});

const coordinateSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
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
const payoutRequestSchema = z.object({
  amount: z.coerce.number().positive().max(100000000),
  merchantId: z.string().optional(),
  authorizationToken: z.string().min(20),
});
const payoutAuthorizeSchema = payoutRequestSchema
  .omit({ authorizationToken: true })
  .extend({ password: z.string().min(4).max(128) });
const mercadoPagoWebhookSchema = z.object({
  id: z.union([z.string(), z.number()]),
  type: z.enum([
    "order",
    "orders",
    "payment",
    "mp-connect",
    "topic_claims_integration_wh",
    "topic_chargebacks_wh",
    "stop_delivery_op_wh",
  ]),
  action: z.string().trim().max(120).optional(),
  live_mode: z.boolean().optional().default(false),
  date_created: z.string().datetime({ offset: true }).optional(),
  user_id: z.union([z.string(), z.number()]).optional(),
  data: z.object({ id: z.union([z.string(), z.number()]) }),
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
    paymentMethods: (db.paymentMethods || []).filter((entry) => entry.userId === userId),
    walletTransactions: (db.walletTransactions || []).filter((entry) => entry.userId === userId),
    supportTickets: (db.supportTickets || []).filter((entry) => entry.userId === userId),
    ratings: (db.ratings || []).filter((entry) => entry.userId === userId),
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
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

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

function issueAccessToken(user, { mfaVerified = false } = {}) {
  return jwt.sign({ sub: user.id, roles: user.roles, mfa: mfaVerified }, jwtSecret, {
    expiresIn: "15m",
  });
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
    try {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    } catch {
      return "";
    }
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
  hasRole(req, "admin") ? next() : fail(res, 403, "MFA administrativo requiere rol admin");

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

app.get("/api/merchant/me", requireAuth, requireAnyRole("merchant"), async (req, res) => {
  try {
    const restaurants = usesPostgresCommerce()
      ? await getPostgresRestaurants({ ownerPublicId: req.auth.userId })
      : readDb().restaurants.filter((entry) => entry.ownerId === req.auth.userId);
    res.set("Cache-Control", "no-store, private");
    return ok(res, { restaurants });
  } catch (error) {
    return failFrom(res, error, "No se pudo cargar el comercio");
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
app.use(orderIssuesRouter);

app.use(backofficeReportsRouter);
app.use(featureFlagsRouter);
app.use(productAnalyticsRouter);
app.get("/api/state", requireAuth, (_req, res) => {
  res.set("Cache-Control", "no-store");
  return fail(res, 410, "El estado global fue retirado; usa bootstrap y recursos segmentados");
});

app.get("/api/public/rides/track/:token", async (req, res) => {
  const token = String(req.params.token || "");
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return fail(res, 404, "El enlace no existe o venció");
  try {
    res.set("Cache-Control", "no-store, private");
    return ok(res, { tracking: await getPublicRideTracking(token) });
  } catch (error) {
    return failFrom(res, error, "No se pudo consultar el viaje");
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
      return failFrom(res, error, "No se pudo compartir el viaje");
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
      return failFrom(res, error, "No se pudo revocar el enlace");
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
      return res.status(201).json({ ok: true, requestId: req.requestId, incident });
    } catch (error) {
      return failFrom(res, error, "No se pudo activar Seguridad Flash");
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
      return failFrom(res, error, "No se pudo consultar el PIN de retiro");
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
    user?.password || "$2b$10$qJvN1MRgLJYlRirjP6N7ruoJc0mKlf2klq7iW03DIdDgV7gKDCl7.",
  );
  const accountLocked = Boolean(
    user?.loginLockedUntil && new Date(user.loginLockedUntil) > new Date(),
  );
  if (!user || accountLocked || !passwordMatches) {
    if (usesPostgresAuth() && user && !accountLocked) await recordPostgresLoginFailure(email);
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
  if (parsed.data.audience && !user.roles?.includes(parsed.data.audience)) {
    const productName =
      parsed.data.audience === "driver"
        ? "Flash Driver"
        : parsed.data.audience === "merchant"
          ? "Flash Negocios"
          : "Flash";
    return fail(res, 403, `Esta cuenta no pertenece a ${productName}`);
  }
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
    ...deliverSession(
      req,
      res,
      await issueSession(user, parsed.data.deviceName || req.get("user-agent") || "unknown"),
    ),
  });
});

app.get("/api/auth/mfa/status", requireAuth, async (req, res) => {
  if (!hasRole(req, "admin")) return fail(res, 403, "MFA administrativo requiere rol admin");
  return ok(res, { mfa: await getAdminMfaStatus(req.auth.userId) });
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

app.post("/api/auth/mfa/enroll", requireAuth, requireAdminIdentity, async (req, res) => {
  if (!usesPostgresAuth()) return fail(res, 503, "MFA real requiere PostgreSQL");
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
    return failFrom(res, error, "No se pudo iniciar MFA");
  }
});

app.post("/api/auth/mfa/confirm", requireAuth, requireAdminIdentity, async (req, res) => {
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
      ...deliverSession(
        req,
        res,
        await issueSession(
          req.auth.user,
          req.body?.deviceName || req.get("user-agent") || "unknown",
          { mfaVerified: true },
        ),
      ),
    });
  } catch (error) {
    return failFrom(res, error, "No se pudo confirmar MFA");
  }
});

app.post("/api/auth/mfa/complete", async (req, res) => {
  const parsed = parseOrFail(mfaCompleteSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    const challenge = jwt.verify(parsed.data.challenge, jwtSecret);
    if (challenge.purpose !== "admin_mfa") return fail(res, 401, "Desafío MFA inválido");
    const user = await findAuthUserByPublicId(challenge.sub);
    if (!user?.roles?.includes("admin")) return fail(res, 401, "Desafío MFA inválido");
    const verification = await verifyAdminMfa({
      userPublicId: user.id,
      code: parsed.data.code,
    });
    await recordPostgresAudit({
      actorPublicId: user.id,
      roles: user.roles,
      action: verification.recoveryCodeUsed ? "admin.mfa_recovery_used" : "admin.mfa_verified",
      entityType: "user",
      entityId: user.id,
      requestId: req.requestId,
    });
    return ok(res, {
      user: sanitizeUser(user),
      verification,
      ...deliverSession(
        req,
        res,
        await issueSession(user, parsed.data.deviceName || req.get("user-agent") || "unknown", {
          mfaVerified: true,
        }),
      ),
    });
  } catch (error) {
    // Un desafío vencido o mal firmado es un error del cliente y se le dice cuál
    // de los dos; cualquier otra falla es interna y no describe su causa.
    const jwtInvalido = { status: 401, message: "Desafío MFA inválido" };
    const jwtVencido = { status: 401, message: "Desafío MFA expirado" };
    return failFrom(
      res,
      error.name === "TokenExpiredError"
        ? jwtVencido
        : error.name === "JsonWebTokenError"
          ? jwtInvalido
          : error,
      "No se pudo verificar MFA",
    );
  }
});

app.post("/api/payments/webhooks/:provider", async (req, res) => {
  const provider = String(req.params.provider || "").toLowerCase();
  if (!/^[a-z0-9_-]{2,40}$/.test(provider)) return fail(res, 400, "Proveedor inválido");
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
app.use(financialReviewRouter);

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
  const parsed = parseOrFail(refreshSchema.pick({ refreshToken: true }), {
    ...(req.body || {}),
    refreshToken: req.body?.refreshToken || readRefreshCookie(req),
  });
  if (!parsed.ok) return fail(res, 400, parsed.message);
  if (usesPostgresAuth()) await revokePostgresSession(parsed.data.refreshToken);
  else revokeAuthSession(parsed.data.refreshToken);
  if (isWebSessionRequest(req)) clearRefreshCookie(res);
  return ok(res, { loggedOut: true });
});
app.get("/api/me/sessions", requireAuth, async (req, res) => {
  if (!usesPostgresAuth()) return ok(res, { sessions: [] });
  try {
    res.set("Cache-Control", "no-store, private");
    return ok(res, { sessions: await getPostgresUserSessions(req.auth.userId) });
  } catch (error) {
    return failFrom(res, error, "No se pudieron cargar las sesiones");
  }
});
app.delete("/api/me/sessions/:sessionId", requireAuth, async (req, res) => {
  if (!usesPostgresAuth()) return fail(res, 503, "El cierre remoto requiere PostgreSQL");
  try {
    const result = await revokeOwnedPostgresSession({
      userPublicId: req.auth.userId,
      sessionPublicId: req.params.sessionId,
    });
    await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "auth.session_revoked",
      entityType: "refresh_session",
      entityId: req.params.sessionId,
      requestId: req.requestId,
    });
    return ok(res, result);
  } catch (error) {
    return failFrom(res, error, "No se pudo cerrar la sesión");
  }
});
app.post(
  "/api/me/sessions/revoke-others",
  requireTrustedWebOrigin,
  requireAuth,
  async (req, res) => {
    const parsed = parseOrFail(refreshSchema.pick({ refreshToken: true }), {
      ...(req.body || {}),
      refreshToken: req.body?.refreshToken || readRefreshCookie(req),
    });
    if (!parsed.ok) return fail(res, 400, parsed.message);
    if (!usesPostgresAuth()) return fail(res, 503, "El cierre remoto requiere PostgreSQL");
    try {
      const result = await revokeOtherPostgresSessions({
        userPublicId: req.auth.userId,
        currentRefreshToken: parsed.data.refreshToken,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "auth.other_sessions_revoked",
        entityType: "user",
        entityId: req.auth.userId,
        requestId: req.requestId,
        afterData: result,
      });
      return ok(res, result);
    } catch (error) {
      return failFrom(res, error, "No se pudieron cerrar las demás sesiones");
    }
  },
);

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
      message: "Si la cuenta existe, enviamos las instrucciones de recuperación.",
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
    return failFrom(res, error, "No se pudo cambiar la contraseña");
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
    return failFrom(res, error, "No se pudo verificar el email");
  }
});

app.post("/api/auth/register", async (req, res) => {
  const parsed = parseOrFail(registerSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const { name, email, password, phone } = parsed.data;
  const db = usesPostgresAuth() ? null : readDb();
  const exists = usesPostgresAuth()
    ? await findAuthUserByEmail(email)
    : db.users.some((entry) => entry.email.toLowerCase() === String(email).trim().toLowerCase());
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
    audit(db, { auth: { userId: user.id } }, "user", user.id, "user.registered", {
      email: user.email,
    });
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
    ...deliverSession(
      req,
      res,
      await issueSession(user, req.body?.deviceName || req.get("user-agent") || "unknown"),
    ),
  });
});

app.post("/api/rides/quote", async (req, res) => {
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

app.get(
  "/api/merchant/dashboard",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    res.set("Cache-Control", "no-store, private");
    if (usesPostgresCommerce()) {
      try {
        const dashboard = await getPostgresMerchantDashboard({
          actorPublicId: req.auth.userId,
          merchantPublicId: String(req.query.restaurantId || "") || null,
          admin: isAdmin(req),
        });
        const restaurant = (
          await getPostgresRestaurants({ publicIds: [dashboard.restaurantId] })
        )[0];
        return ok(res, { dashboard: { ...dashboard, restaurant } });
      } catch (error) {
        return failFrom(res, error, "No se pudo cargar la operación del comercio");
      }
    }
    const db = usesPostgresCommerce() ? {} : readDb();
    const restaurant = isAdmin(req)
      ? db.restaurants.find((entry) => entry.id === req.query.restaurantId)
      : db.restaurants.find((entry) => entry.ownerId === req.auth.userId);
    if (!restaurant) return fail(res, 404, "Comercio no encontrado");
    const orders = db.orders.filter((order) => order.restaurantId === restaurant.id);
    const timezone = "America/Argentina/Buenos_Aires";
    const dateKey = (value) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(value));
    const todayKey = dateKey(getTimestamp());
    const terminalToday = (order, status) =>
      (order.timeline || []).some(
        (event) => event.status === status && dateKey(event.at) === todayKey,
      );
    const activeOrders = orders.filter((order) =>
      [
        "accepted",
        "preparing",
        "ready_for_pickup",
        "courier_assigned",
        "picked_up",
        "delivering",
      ].includes(order.status),
    );
    const completedOrders = orders.filter(
      (order) => order.status === "delivered" && terminalToday(order, "delivered"),
    );
    const cancelledOrders = orders.filter(
      (order) => order.status === "cancelled" && terminalToday(order, "cancelled"),
    );
    const grossSales = completedOrders.reduce((sum, order) => sum + order.total, 0);
    return ok(res, {
      dashboard: {
        generatedAt: getTimestamp(),
        source: "sqlite-test-fallback",
        timezone,
        restaurantId: restaurant.id,
        branch: null,
        restaurant,
        orders,
        metrics: {
          activeOrders: activeOrders.length,
          needsAction: activeOrders.filter((order) => order.status === "accepted").length,
          preparing: activeOrders.filter((order) => order.status === "preparing").length,
          readyForPickup: activeOrders.filter((order) => order.status === "ready_for_pickup")
            .length,
          courierFlow: activeOrders.filter((order) =>
            ["courier_assigned", "picked_up", "delivering"].includes(order.status),
          ).length,
          lateOrders: 0,
          untrackedPrepOrders: activeOrders.filter((order) =>
            ["accepted", "preparing"].includes(order.status),
          ).length,
          oldestActiveMinutes: Math.max(
            0,
            ...activeOrders
              .map((order) =>
                Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000),
              )
              .filter(Number.isFinite),
          ),
          completedToday: completedOrders.length,
          cancelledToday: cancelledOrders.length,
          grossSalesToday: grossSales,
          averageTicketToday: completedOrders.length
            ? Math.round(grossSales / completedOrders.length)
            : 0,
          unavailableItems: restaurant.menu.filter((item) => !item.stock).length,
        },
      },
    });
  },
);

app.get(
  "/api/merchant/orders/active",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const restaurantId = String(req.query.restaurantId || "").trim(),
      limit = Math.min(100, Math.max(1, Number(req.query.limit) || 100));
    if (!restaurantId) return fail(res, 400, "Indicá el comercio a consultar");
    res.set("Cache-Control", "no-store, private");
    try {
      if (usesPostgresCommerce())
        return ok(
          res,
          await getPostgresMerchantActiveOrderPage({
            actorPublicId: req.auth.userId,
            merchantPublicId: restaurantId,
            admin: isAdmin(req),
            limit,
          }),
        );
      const db = readDb(),
        restaurant = db.restaurants.find((entry) => entry.id === restaurantId);
      if (!restaurant || !canManageRestaurant(req, restaurant))
        return fail(res, 404, "Comercio no encontrado o no autorizado");
      const activeStatuses = new Set([
          "accepted",
          "preparing",
          "ready_for_pickup",
          "courier_assigned",
          "picked_up",
          "delivering",
        ]),
        all = db.orders.filter(
          (order) => order.restaurantId === restaurantId && activeStatuses.has(order.status),
        );
      return ok(res, {
        generatedAt: getTimestamp(),
        source: "sqlite-test-fallback",
        orders: all.slice(0, limit),
        hasMore: all.length > limit,
      });
    } catch (error) {
      return failFrom(res, error, "No se pudo cargar la cola activa");
    }
  },
);

app.get(
  "/api/merchant/finance",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const merchantId = String(req.query.merchantId || req.auth.user.restaurantId || "");
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
      return failFrom(res, error, "No se pudieron cargar las finanzas");
    }
  },
);
app.post(
  "/api/merchant/payouts/authorize",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  payoutStepUpLimiter,
  async (req, res) => {
    const parsed = parseOrFail(payoutAuthorizeSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    const merchantId = parsed.data.merchantId || req.auth.user.restaurantId;
    if (!merchantId) return fail(res, 400, "Falta el comercio");
    if (!bcrypt.compareSync(parsed.data.password, req.auth.user.password))
      return fail(res, 401, "La contraseña actual no es válida");
    try {
      const jti = crypto.randomUUID(),
        expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      await createPayoutStepUp({
        jti,
        merchantPublicId: merchantId,
        actorPublicId: req.auth.userId,
        admin: isAdmin(req),
        amount: parsed.data.amount,
        expiresAt,
      });
      const authorizationToken = jwt.sign(
        {
          sub: req.auth.userId,
          purpose: "merchant_payout",
          merchantId,
          amountCents: Math.round(parsed.data.amount * 100),
          jti,
        },
        jwtSecret,
        { expiresIn: "5m" },
      );
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "merchant.payout_authorized",
        entityType: "merchant",
        entityId: merchantId,
        requestId: req.requestId,
        afterData: { amount: parsed.data.amount, expiresAt: expiresAt.toISOString() },
      });
      return ok(res, {
        authorizationToken,
        expiresAt: expiresAt.toISOString(),
        merchantId,
        amount: parsed.data.amount,
      });
    } catch (error) {
      return failFrom(res, error, "No se pudo autorizar el retiro");
    }
  },
);
app.get(
  "/api/merchant/payment-provider",
  requireAuth,
  requireAnyRole("merchant"),
  async (req, res) => {
    const merchantId = String(req.query.merchantId || req.auth.user.restaurantId || "");
    if (!merchantId) return fail(res, 400, "Falta el comercio");
    try {
      return ok(res, {
        connection: await getMerchantPaymentConnection({
          merchantPublicId: merchantId,
          userPublicId: req.auth.userId,
        }),
        configured: config.paymentMarketplace.provider !== "disabled",
      });
    } catch (error) {
      return failFrom(res, error, "No se pudo consultar la vinculación");
    }
  },
);
app.get(
  "/api/payment-provider/client-configuration",
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    res.set("Cache-Control", "no-store, private");
    const enabled =
        config.paymentMarketplace.provider === "mercadopago" &&
        Boolean(config.paymentMarketplace.publicKey),
      merchantId = String(req.query.merchantId || "").slice(0, 100);
    let merchantReady = false;
    if (enabled && merchantId && postgresPool)
      merchantReady = Boolean(
        (
          await postgresPool.query(
            `SELECT 1 FROM merchant_payment_connections c JOIN merchants m ON m.id=c.merchant_id WHERE m.public_id=$1 AND c.provider='mercadopago' AND c.revoked_at IS NULL AND c.access_token_ciphertext IS NOT NULL AND c.token_expires_at>now() AND c.refresh_failures<5`,
            [merchantId],
          )
        ).rowCount,
      );
    return ok(res, {
      provider: enabled ? "mercadopago" : "disabled",
      publicKey: enabled ? config.paymentMarketplace.publicKey : null,
      merchantReady,
      cardDataHandling: "provider_tokenization_only",
    });
  },
);
app.post(
  "/api/merchant/payment-provider/connect",
  requireAuth,
  requireAnyRole("merchant"),
  async (req, res) => {
    const merchantId = String(req.body?.merchantId || req.auth.user.restaurantId || "");
    if (!merchantId) return fail(res, 400, "Falta el comercio");
    try {
      return ok(
        res,
        await beginMerchantPaymentOAuth({
          merchantPublicId: merchantId,
          userPublicId: req.auth.userId,
        }),
      );
    } catch (error) {
      return failFrom(res, error, "No se pudo iniciar la vinculación");
    }
  },
);
app.post(
  "/api/merchant/payment-provider/disconnect",
  requireAuth,
  requireAnyRole("merchant"),
  payoutStepUpLimiter,
  async (req, res) => {
    const merchantId = String(req.body?.merchantId || req.auth.user.restaurantId || ""),
      password = String(req.body?.password || "");
    if (!merchantId || password.length < 4)
      return fail(res, 400, "Comercio y contraseña actual son obligatorios");
    if (!bcrypt.compareSync(password, req.auth.user.password))
      return fail(res, 401, "La contraseña actual no es válida");
    try {
      return ok(res, {
        connection: await revokeMerchantPaymentConnection({
          merchantPublicId: merchantId,
          userPublicId: req.auth.userId,
          requestId: req.requestId,
        }),
      });
    } catch (error) {
      return failFrom(res, error, "No se pudo revocar la vinculación");
    }
  },
);
app.get("/api/payment-provider/mercadopago/callback", async (req, res) => {
  res.set("Cache-Control", "no-store, private");
  res.set("Pragma", "no-cache");
  const destination = new URL(config.paymentMarketplace.returnUrl);
  try {
    const state = String(req.query.state || ""),
      code = String(req.query.code || "");
    if (req.query.error || state.length < 20 || code.length < 3)
      throw Object.assign(new Error("Callback OAuth rechazado"), { status: 400 });
    await completeMerchantPaymentOAuth({ state, code });
    destination.searchParams.set("payment_connection", "connected");
    return res.redirect(303, destination.toString());
  } catch (error) {
    destination.searchParams.set("payment_connection", "error");
    destination.searchParams.set(
      "reason",
      error.status === 400 ? "invalid_state" : "provider_unavailable",
    );
    return res.redirect(303, destination.toString());
  }
});
app.post("/api/webhooks/mercadopago", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const parsed = parseOrFail(mercadoPagoWebhookSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  if (!config.paymentMarketplace.webhookSecret)
    return fail(res, 503, "Webhook de Mercado Pago no configurado");
  if (!postgresPool) return fail(res, 503, "Inbox de webhooks requiere PostgreSQL");
  const queryDataId = String(req.query["data.id"] || ""),
    bodyDataId = String(parsed.data.data.id);
  if (!queryDataId || queryDataId.toLowerCase() !== bodyDataId.toLowerCase())
    return fail(res, 400, "El recurso firmado no coincide con el payload");
  const valid = verifyMercadoPagoWebhook({
    xSignature: req.get("x-signature"),
    xRequestId: req.get("x-request-id"),
    dataId: queryDataId,
    secret: config.paymentMarketplace.webhookSecret,
  });
  if (!valid) return fail(res, 401, "Firma de webhook inválida");
  try {
    const event = await enqueueMercadoPagoWebhook({
      notificationId: String(parsed.data.id),
      resourceId: bodyDataId,
      requestId: String(req.get("x-request-id")),
      topic: parsed.data.type,
      action: parsed.data.action,
      liveMode: parsed.data.live_mode,
      occurredAt: parsed.data.date_created,
      payload: { userId: parsed.data.user_id ? String(parsed.data.user_id) : null },
    });
    return res
      .status(event.duplicate ? 200 : 201)
      .json({ ok: true, requestId: req.requestId, accepted: true, duplicate: event.duplicate });
  } catch (error) {
    return failFrom(res, error, "No se pudo persistir el webhook");
  }
});
app.post(
  "/api/merchant/payouts",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(payoutRequestSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    const idempotencyKey = String(req.get("idempotency-key") || "");
    if (idempotencyKey.length < 16) return fail(res, 400, "Idempotency-Key es obligatorio");
    const merchantId = parsed.data.merchantId || req.auth.user.restaurantId;
    if (!merchantId) return fail(res, 400, "Falta el comercio");
    try {
      let stepUp;
      try {
        stepUp = jwt.verify(parsed.data.authorizationToken, jwtSecret);
      } catch {
        return fail(res, 403, "Autorización reforzada inválida o vencida");
      }
      if (
        stepUp.sub !== req.auth.userId ||
        stepUp.purpose !== "merchant_payout" ||
        stepUp.merchantId !== merchantId ||
        stepUp.amountCents !== Math.round(parsed.data.amount * 100) ||
        typeof stepUp.jti !== "string"
      )
        return fail(res, 403, "La autorización no corresponde a este retiro");
      const finance = await requestMerchantPayout({
        merchantPublicId: merchantId,
        actorPublicId: req.auth.userId,
        admin: isAdmin(req),
        amount: parsed.data.amount,
        idempotencyKey,
        stepUpJti: stepUp.jti,
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
      return res.status(201).json({ ok: true, requestId: req.requestId, finance });
    } catch (error) {
      return failFrom(res, error, "No se pudo solicitar el payout");
    }
  },
);
app.post("/api/rides/options", async (req, res) => {
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

app.use(mapsRouter);

app.post("/api/rides", requireAuth, requireAnyRole("customer", "admin"), async (req, res) => {
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
      return fail(res, 400, "La reserva debe hacerse con al menos 30 minutos");
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

app.post("/api/shipments/quote", async (req, res) => {
  const parsed = parseOrFail(shipmentQuoteSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
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
    [zone, pricing, protectionPlan, shipmentServiceConfig] = usesPostgresCommerce()
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

app.post("/api/shipments", requireAuth, requireAnyRole("customer", "admin"), async (req, res) => {
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
    [shipmentZone, shipmentPricing, protectionPlan, shipmentServiceConfig] = usesPostgresCommerce()
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
});

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

app.get(
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
      return failFrom(res, error, "No se pudo registrar la evidencia");
    }
  },
);

app.get("/api/shipments/:shipmentId/delivery-evidence", requireAuth, async (req, res) => {
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
      return failFrom(res, error, "No se pudo abrir la evidencia");
    }
  },
);

app.post(
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
app.use(shipmentProtectionRouter);

app.patch("/api/shipments/:shipmentId/status", requireAuth, async (req, res) => {
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

app.post(
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

app.post(
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

app.patch("/api/rides/:rideId/status", requireAuth, async (req, res) => {
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
