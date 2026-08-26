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
  NOTIFICATION_PROVIDER: z.enum(["disabled","sandbox","expo"]).default("sandbox"),
  EXPO_ACCESS_TOKEN: z.string().min(16).optional(),
  PUSH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(8000),
  PUSH_RECEIPT_DELAY_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),
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
  ROUTING_URL: z.string().url().default("https://router.project-osrm.org"),
  WEB_MAP_ORIGINS: z.string().default("https://tile.openstreetmap.org")
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
  ,FEATURE_FLAG_SALT: z.string().min(32).default("local-feature-flag-salt-change-before-prod")
  ,REDIS_URL: z.string().url().optional()
  ,REDIS_REQUIRED: booleanFromEnv.default(false)
  ,SHUTDOWN_GRACE_MS: z.coerce.number().int().min(1000).max(60000).default(10000)
  ,PHONE_VERIFY_PROVIDER: z.enum(["disabled","sandbox","twilio"]).default("sandbox")
  ,TWILIO_ACCOUNT_SID: z.string().regex(/^AC[0-9a-fA-F]{32}$/).optional()
  ,TWILIO_AUTH_TOKEN: z.string().min(20).optional()
  ,TWILIO_VERIFY_SERVICE_SID: z.string().regex(/^VA[0-9a-fA-F]{32}$/).optional()
  ,PAYMENT_MARKETPLACE_PROVIDER: z.enum(["disabled","mercadopago"]).default("disabled")
  ,PAYMENT_OAUTH_ENCRYPTION_KEY: z.string().min(32).default("local-payment-oauth-key-change-before-production")
  ,MERCADOPAGO_CLIENT_ID: z.string().min(3).optional()
  ,MERCADOPAGO_CLIENT_SECRET: z.string().min(16).optional()
  ,MERCADOPAGO_PUBLIC_KEY: z.string().min(8).optional()
  ,MERCADOPAGO_REDIRECT_URI: z.string().url().default("http://127.0.0.1:4000/api/payment-provider/mercadopago/callback")
  ,PAYMENT_OAUTH_RETURN_URL: z.string().url().default("http://127.0.0.1:5173")
  ,MERCADOPAGO_WEBHOOK_SECRET: z.string().min(32).optional()
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const message = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid server configuration: ${message}`);
}

const env = parsed.data;
const corsOrigins = env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
const webMapOrigins = [...new Set(env.WEB_MAP_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean).map((value) => {
  const origin = new URL(value).origin;
  if (!origin.startsWith("https://")) throw new Error("WEB_MAP_ORIGINS only accepts HTTPS origins");
  return origin;
}))];

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
// Expo sin access token deja el proyecto abierto: cualquiera que conozca un
// token de dispositivo puede enviarle notificaciones en nombre de Flash.
if(env.NODE_ENV==="production"&&env.NOTIFICATION_PROVIDER==="expo"&&!env.EXPO_ACCESS_TOKEN)throw new Error("EXPO_ACCESS_TOKEN is required when NOTIFICATION_PROVIDER is expo in production");
if(env.NODE_ENV==="production"&&env.PUSH_TOKEN_ENCRYPTION_KEY==="local-device-token-key-change-before-production")throw new Error("PUSH_TOKEN_ENCRYPTION_KEY must be configured before running in production");
if(env.NODE_ENV==="production"&&env.DELIVERY_PIN_SECRET==="local-delivery-pin-secret-change-before-production")throw new Error("DELIVERY_PIN_SECRET must be configured before running in production");
if(env.NODE_ENV==="production"&&env.MFA_ENCRYPTION_KEY==="local-admin-mfa-key-change-before-production")throw new Error("MFA_ENCRYPTION_KEY must be configured before running in production");
if(env.NODE_ENV==="production"&&env.KYC_DOCUMENT_ENCRYPTION_KEY==="local-kyc-document-key-change-before-production")throw new Error("KYC_DOCUMENT_ENCRYPTION_KEY must be configured before running in production");
if(env.NODE_ENV==="production"&&env.DELIVERY_PROOF_ENCRYPTION_KEY==="local-delivery-proof-key-change-before-production")throw new Error("DELIVERY_PROOF_ENCRYPTION_KEY must be configured before running in production");
if(env.NODE_ENV==="production"&&env.RECOVERY_TOKEN_ENCRYPTION_KEY==="local-recovery-token-key-change-before-production")throw new Error("RECOVERY_TOKEN_ENCRYPTION_KEY must be configured before running in production");
if(env.NODE_ENV==="production"&&(env.EMAIL_PROVIDER!=="smtp"||!env.SMTP_HOST||!env.SMTP_USER||!env.SMTP_PASSWORD))throw new Error("EMAIL_PROVIDER smtp and SMTP credentials are required in production");
if(env.NODE_ENV==="production"&&!env.REQUIRE_ADMIN_MFA)throw new Error("REQUIRE_ADMIN_MFA must be true in production");
if(env.NODE_ENV==="production"&&env.FEATURE_FLAG_SALT==="local-feature-flag-salt-change-before-prod")throw new Error("FEATURE_FLAG_SALT must be configured before running in production");
if(env.NODE_ENV==="production"&&(env.PHONE_VERIFY_PROVIDER!=="twilio"||!env.TWILIO_ACCOUNT_SID||!env.TWILIO_AUTH_TOKEN||!env.TWILIO_VERIFY_SERVICE_SID))throw new Error("Twilio Verify credentials are required for production phone verification");
if(env.NODE_ENV==="production"&&env.PAYMENT_MARKETPLACE_PROVIDER==="mercadopago"&&(env.PAYMENT_OAUTH_ENCRYPTION_KEY==="local-payment-oauth-key-change-before-production"||!env.MERCADOPAGO_CLIENT_ID||!env.MERCADOPAGO_CLIENT_SECRET||!env.MERCADOPAGO_PUBLIC_KEY||!env.MERCADOPAGO_WEBHOOK_SECRET))throw new Error("Mercado Pago public key, OAuth, webhook credentials and independent encryption key are required");

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
  push:{provider:env.NOTIFICATION_PROVIDER,accessToken:env.EXPO_ACCESS_TOKEN??null,timeoutMs:env.PUSH_TIMEOUT_MS,receiptDelaySeconds:env.PUSH_RECEIPT_DELAY_SECONDS},
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
  ,webMapOrigins
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
  ,featureFlagSalt: env.FEATURE_FLAG_SALT
  ,redis: { url: env.REDIS_URL, required: env.REDIS_REQUIRED }
  ,shutdownGraceMs: env.SHUTDOWN_GRACE_MS
  ,phoneVerification: {provider:env.PHONE_VERIFY_PROVIDER,accountSid:env.TWILIO_ACCOUNT_SID,authToken:env.TWILIO_AUTH_TOKEN,serviceSid:env.TWILIO_VERIFY_SERVICE_SID}
  ,paymentMarketplace:{provider:env.PAYMENT_MARKETPLACE_PROVIDER,encryptionKey:env.PAYMENT_OAUTH_ENCRYPTION_KEY,clientId:env.MERCADOPAGO_CLIENT_ID,clientSecret:env.MERCADOPAGO_CLIENT_SECRET,publicKey:env.MERCADOPAGO_PUBLIC_KEY,redirectUri:env.MERCADOPAGO_REDIRECT_URI,returnUrl:env.PAYMENT_OAUTH_RETURN_URL,webhookSecret:env.MERCADOPAGO_WEBHOOK_SECRET}
};
