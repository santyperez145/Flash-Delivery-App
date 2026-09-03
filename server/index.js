import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import compression from "compression";
import express from "express";
import helmet from "helmet";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { config } from "./config.js";
import { bypassRefusalReason } from "./rls-guard.js";
import { fail } from "./http/responses.js";
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
import { paymentProviderRouter } from "./http/payment-provider-router.js";
import { orderIssuesRouter } from "./http/order-issues-router.js";
import { addressesRouter } from "./http/addresses-router.js";
import { dietaryRouter } from "./http/dietary-router.js";
import { featureFlagsRouter } from "./http/feature-flags-router.js";
import { feedbackRouter } from "./http/feedback-router.js";
import { financialReviewRouter } from "./http/financial-review-router.js";
import { notificationsRouter } from "./http/notifications-router.js";
import { realtimeClients, realtimeRouter, startRealtimeListener } from "./http/realtime.js";
import { mapsRouter } from "./http/maps-router.js";
import { rideContextRouter } from "./http/ride-context-router.js";
import { driverFleetRouter } from "./http/driver-fleet-router.js";
import { shipmentProtectionRouter } from "./http/shipment-protection-router.js";
import { productAnalyticsRouter } from "./http/product-analytics-router.js";
import { platformStatusRouter } from "./http/platform-status-router.js";
import { readinessRouter } from "./http/readiness-router.js";
import { bootstrapRouter } from "./http/bootstrap-router.js";
import { metricsRouter } from "./http/metrics-router.js";
import { queueTriggersRouter } from "./http/queue-triggers-router.js";
import { paymentMethodsRouter } from "./http/payment-methods-router.js";
import { pricingRouter } from "./http/pricing-router.js";
import { subscriptionRouter } from "./http/subscription-router.js";
import { groupOrderRouter } from "./http/group-order-router.js";
import { supportRouter } from "./http/support-router.js";
import { configurationRouter } from "./http/configuration-router.js";
import { createLimiter } from "./http/rate-limits.js";
import { closeRedis } from "./redis.js";
import { closePostgres, postgresReadiness } from "./postgres.js";
import { stopTelemetry } from "./telemetry.js";
import { createGracefulShutdown } from "./graceful-shutdown.js";
import { beginDrain } from "./runtime-drain.js";
import { observeHttpRequest } from "./observability.js";
import { createId } from "./store.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, "..", "dist");

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

app.use(platformStatusRouter);
app.use(readinessRouter);
app.use(bootstrapRouter);

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
app.use(paymentMethodsRouter);

app.use(supportRouter);
app.use(queueTriggersRouter);
app.use(notificationsRouter);
app.use(dietaryRouter);
app.use(configurationRouter);
app.use(pricingRouter);
app.use(subscriptionRouter);
app.use(groupOrderRouter);
app.use(feedbackRouter);

app.use(realtimeRouter);
app.use(metricsRouter);

app.use(financialReviewRouter);

app.use(mapsRouter);

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
export { app };

const shouldListen = process.env.FLASH_HTTP_LISTEN !== "0";

if (shouldListen) {
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
    onDrain: beginDrain,
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
}
