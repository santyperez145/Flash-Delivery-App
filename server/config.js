import { z } from "zod";

const defaultJwtSecret = "flash-local-demo-secret";
const booleanFromEnv = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().min(1).default("127.0.0.1"),
  JWT_SECRET: z.string().min(16).default(defaultJwtSecret),
  CORS_ORIGIN: z.string().default("http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:8081,http://localhost:8081"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(40),
  LOG_LEVEL: z.enum(["silent", "info"]).default("info"),
  DATABASE_URL: z.string().url().optional(),
  DATABASE_SSL: booleanFromEnv.default(false),
  ALLOW_SANDBOX_TOPUPS: booleanFromEnv.default(true),
  PAYMENT_WEBHOOK_SECRET: z.string().min(32).default("local-payment-webhook-secret-change-me"),
  METRICS_TOKEN: z.string().min(32).default("local-metrics-token-change-before-prod"),
  NOTIFICATION_PROVIDER: z.enum(["disabled","sandbox"]).default("sandbox"),
  PUSH_TOKEN_ENCRYPTION_KEY: z.string().min(32).default("local-device-token-key-change-before-production"),
  DELIVERY_PIN_SECRET: z.string().min(32).default("local-delivery-pin-secret-change-before-production"),
  MFA_ENCRYPTION_KEY: z.string().min(32).default("local-admin-mfa-key-change-before-production"),
  KYC_DOCUMENT_ENCRYPTION_KEY: z.string().min(32).default("local-kyc-document-key-change-before-production"),
  DELIVERY_PROOF_ENCRYPTION_KEY: z.string().min(32).default("local-delivery-proof-key-change-before-production"),
  RECOVERY_TOKEN_ENCRYPTION_KEY: z.string().min(32).default("local-recovery-token-key-change-before-production"),
  EMAIL_PROVIDER: z.enum(["disabled","sandbox","smtp"]).default("sandbox"),
  APP_PUBLIC_URL: z.string().url().default("http://127.0.0.1:8081"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: booleanFromEnv.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default("Flash <noreply@flash.local>"),
  REQUIRE_ADMIN_MFA: booleanFromEnv.default(false),
  GEOCODING_URL: z.string().url().default("https://nominatim.openstreetmap.org"),
  ROUTING_URL: z.string().url().default("https://router.project-osrm.org")
  ,GEOCODING_CACHE_TTL_SECONDS: z.coerce.number().int().min(60).max(2592000).default(604800)
  ,ROUTING_CACHE_TTL_SECONDS: z.coerce.number().int().min(30).max(86400).default(900)
  ,OTEL_ENABLED: booleanFromEnv.default(false)
  ,OTEL_SERVICE_NAME: z.string().min(1).max(128).default("flash-api")
  ,OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: z.string().url().default("http://127.0.0.1:4318/v1/traces")
  ,MAP_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(5000)
  ,MAP_PROVIDER_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(20).default(5)
  ,MAP_PROVIDER_RESET_MS: z.coerce.number().int().min(1000).max(600000).default(30000)
  ,MAP_PROVIDER_DAILY_BUDGET: z.coerce.number().int().min(1).max(10000000).default(10000)
  ,MAP_STALE_CACHE_SECONDS: z.coerce.number().int().min(60).max(2592000).default(86400)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const message = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid server configuration: ${message}`);
}

const env = parsed.data;
const corsOrigins = env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);

if (env.NODE_ENV === "production" && env.JWT_SECRET === defaultJwtSecret) {
  throw new Error("JWT_SECRET must be configured before running in production");
}
if (env.NODE_ENV === "production" && !env.DATABASE_URL) {
  throw new Error("DATABASE_URL must point to PostgreSQL/PostGIS in production");
}
if (env.NODE_ENV === "production" && env.PAYMENT_WEBHOOK_SECRET === "local-payment-webhook-secret-change-me") {
  throw new Error("PAYMENT_WEBHOOK_SECRET must be configured before running in production");
}
if(env.NODE_ENV==="production"&&env.METRICS_TOKEN==="local-metrics-token-change-before-prod")throw new Error("METRICS_TOKEN must be configured before running in production");
if(env.NODE_ENV==="production"&&env.NOTIFICATION_PROVIDER==="sandbox")throw new Error("NOTIFICATION_PROVIDER sandbox is forbidden in production");
if(env.NODE_ENV==="production"&&env.PUSH_TOKEN_ENCRYPTION_KEY==="local-device-token-key-change-before-production")throw new Error("PUSH_TOKEN_ENCRYPTION_KEY must be configured before running in production");
if(env.NODE_ENV==="production"&&env.DELIVERY_PIN_SECRET==="local-delivery-pin-secret-change-before-production")throw new Error("DELIVERY_PIN_SECRET must be configured before running in production");
if(env.NODE_ENV==="production"&&env.MFA_ENCRYPTION_KEY==="local-admin-mfa-key-change-before-production")throw new Error("MFA_ENCRYPTION_KEY must be configured before running in production");
if(env.NODE_ENV==="production"&&env.KYC_DOCUMENT_ENCRYPTION_KEY==="local-kyc-document-key-change-before-production")throw new Error("KYC_DOCUMENT_ENCRYPTION_KEY must be configured before running in production");
if(env.NODE_ENV==="production"&&env.DELIVERY_PROOF_ENCRYPTION_KEY==="local-delivery-proof-key-change-before-production")throw new Error("DELIVERY_PROOF_ENCRYPTION_KEY must be configured before running in production");
if(env.NODE_ENV==="production"&&env.RECOVERY_TOKEN_ENCRYPTION_KEY==="local-recovery-token-key-change-before-production")throw new Error("RECOVERY_TOKEN_ENCRYPTION_KEY must be configured before running in production");
if(env.NODE_ENV==="production"&&(env.EMAIL_PROVIDER!=="smtp"||!env.SMTP_HOST||!env.SMTP_USER||!env.SMTP_PASSWORD))throw new Error("EMAIL_PROVIDER smtp and SMTP credentials are required in production");
if(env.NODE_ENV==="production"&&!env.REQUIRE_ADMIN_MFA)throw new Error("REQUIRE_ADMIN_MFA must be true in production");

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  port: env.PORT,
  host: env.HOST,
  jwtSecret: env.JWT_SECRET,
  corsOrigins,
  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    authMax: env.AUTH_RATE_LIMIT_MAX
  },
  logLevel: env.LOG_LEVEL,
  databaseUrl: env.DATABASE_URL,
  databaseSsl: env.DATABASE_SSL,
  allowSandboxTopups: !env.NODE_ENV.includes("production") && env.ALLOW_SANDBOX_TOPUPS,
  paymentWebhookSecret: env.PAYMENT_WEBHOOK_SECRET,
  metricsToken:env.METRICS_TOKEN,
  notificationProvider:env.NOTIFICATION_PROVIDER,
  pushTokenEncryptionKey:env.PUSH_TOKEN_ENCRYPTION_KEY,
  deliveryPinSecret:env.DELIVERY_PIN_SECRET,
  mfaEncryptionKey:env.MFA_ENCRYPTION_KEY,
  kycDocumentEncryptionKey:env.KYC_DOCUMENT_ENCRYPTION_KEY,
  deliveryProofEncryptionKey:env.DELIVERY_PROOF_ENCRYPTION_KEY,
  recoveryTokenEncryptionKey:env.RECOVERY_TOKEN_ENCRYPTION_KEY,
  emailProvider:env.EMAIL_PROVIDER,
  appPublicUrl:env.APP_PUBLIC_URL,
  smtp:{host:env.SMTP_HOST,port:env.SMTP_PORT,secure:env.SMTP_SECURE,user:env.SMTP_USER,password:env.SMTP_PASSWORD,from:env.SMTP_FROM},
  requireAdminMfa:env.REQUIRE_ADMIN_MFA,
  geocodingUrl: env.GEOCODING_URL,
  routingUrl: env.ROUTING_URL
  ,geocodingCacheTtlSeconds: env.GEOCODING_CACHE_TTL_SECONDS
  ,routingCacheTtlSeconds: env.ROUTING_CACHE_TTL_SECONDS
  ,telemetry: {
    enabled: env.OTEL_ENABLED,
    serviceName: env.OTEL_SERVICE_NAME,
    tracesUrl: env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
  }
  ,mapProvider: {
    timeoutMs: env.MAP_PROVIDER_TIMEOUT_MS,
    failureThreshold: env.MAP_PROVIDER_FAILURE_THRESHOLD,
    resetMs: env.MAP_PROVIDER_RESET_MS,
    dailyBudget: env.MAP_PROVIDER_DAILY_BUDGET,
    staleCacheSeconds: env.MAP_STALE_CACHE_SECONDS
  }
};
