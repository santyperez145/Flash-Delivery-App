import { z } from "zod";

const defaultJwtSecret = "flash-local-demo-secret";
const booleanFromEnv = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  return value;
}, z.boolean());
// Vacía en el .env equivale a no definida: el ejemplo deja la clave a la vista.
const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Staging: un despliegue real (NODE_ENV=production, con todo el endurecimiento) que
  // todavía no tiene las cuentas de terceros. Ver docs/despliegue.md, «Staging».
  DEPLOY_STAGE: z.enum(["production", "staging"]).default("production"),
  // Sólo staging, y sólo si se pide: mostrar los códigos de verificación en pantalla
  // cuando no hay proveedor de email ni SMS. Quien tenga la URL puede crear cuentas con
  // emails ajenos sin verificarlos, así que se prende a mano y se apaga al tener SMTP.
  STAGING_EXPOSE_DEV_CODES: booleanFromEnv.default(false),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  // SEG-03: desde qué total (en centavos) un pedido con envío pide código de entrega.
  ORDER_DELIVERY_CODE_MIN_CENTS: z.coerce.number().int().min(0).default(6000000),
  // PAG-01: cuánto puede deber un conductor en comisiones de viajes en efectivo antes
  // de dejar de recibirlos.
  CASH_DRIVER_DEBT_LIMIT_CENTS: z.coerce.number().int().min(0).default(3000000),
  // PAG-01: lo que un comercio puede deber en comisiones de retiros en efectivo antes de
  // dejar de recibirlos. Se netea con sus liquidaciones de pedidos pagados.
  CASH_MERCHANT_DEBT_LIMIT_CENTS: z.coerce.number().int().min(0).default(5000000),
  HOST: z.string().min(1).default("127.0.0.1"),
  JWT_SECRET: z.string().min(16).default(defaultJwtSecret),
  CORS_ORIGIN: z
    .string()
    .default(
      "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:8081,http://localhost:8081",
    ),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(40),
  LOG_LEVEL: z.enum(["silent", "info"]).default("info"),
  DATABASE_URL: z.string().url().optional(),
  DATABASE_SSL: booleanFromEnv.default(false),
  ALLOW_SANDBOX_TOPUPS: booleanFromEnv.default(true),
  PAYMENT_WEBHOOK_SECRET: z.string().min(32).default("local-payment-webhook-secret-change-me"),
  METRICS_TOKEN: z.string().min(32).default("local-metrics-token-change-before-prod"),
  NOTIFICATION_PROVIDER: z.enum(["disabled", "sandbox", "expo"]).default("sandbox"),
  EXPO_ACCESS_TOKEN: z.string().min(16).optional(),
  PUSH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(8000),
  PUSH_RECEIPT_DELAY_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),
  PUSH_TOKEN_ENCRYPTION_KEY: z
    .string()
    .min(32)
    .default("local-device-token-key-change-before-production"),
  DELIVERY_PIN_SECRET: z
    .string()
    .min(32)
    .default("local-delivery-pin-secret-change-before-production"),
  MFA_ENCRYPTION_KEY: z.string().min(32).default("local-admin-mfa-key-change-before-production"),
  KYC_DOCUMENT_ENCRYPTION_KEY: z
    .string()
    .min(32)
    .default("local-kyc-document-key-change-before-production"),
  DELIVERY_PROOF_ENCRYPTION_KEY: z
    .string()
    .min(32)
    .default("local-delivery-proof-key-change-before-production"),
  RECOVERY_TOKEN_ENCRYPTION_KEY: z
    .string()
    .min(32)
    .default("local-recovery-token-key-change-before-production"),
  EMAIL_PROVIDER: z.enum(["disabled", "sandbox", "smtp"]).default("sandbox"),
  APP_PUBLIC_URL: z.string().url().default("http://127.0.0.1:8081"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: booleanFromEnv.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default("Flash <noreply@flash.local>"),
  REQUIRE_ADMIN_MFA: booleanFromEnv.default(false),
  // Dispatch v2: el radio acota el conjunto antes de puntuar. Sin él, cada
  // oleada recalcula historial de 30 días para todo el padrón online.
  DISPATCH_SEARCH_RADIUS_M: z.coerce.number().int().min(500).max(100000).default(8000),
  DISPATCH_MAX_RADIUS_M: z.coerce.number().int().min(500).max(200000).default(25000),
  DISPATCH_SHORTLIST_SIZE: z.coerce.number().int().min(5).max(200).default(30),
  // P-03: pedidos agrupados. Se puede apagar por ambiente. El desvío es lo que el
  // segundo cliente espera de más por la entrega del primero (en línea recta).
  FOOD_BATCHING_ENABLED: booleanFromEnv.default(true),
  FOOD_BATCH_MAX_DETOUR_M: z.coerce.number().int().min(0).max(50000).default(2500),
  MAPS_PROVIDER: z.enum(["openstreetmap", "google"]).default("openstreetmap"),
  GOOGLE_MAPS_SERVER_API_KEY: z.string().min(20).optional(),
  GEOCODING_URL: z.string().url().default("https://nominatim.openstreetmap.org"),
  ROUTING_URL: z.string().url().default("https://router.project-osrm.org"),
  WEB_MAP_ORIGINS: z.string().default("https://tile.openstreetmap.org"),
  GEOCODING_CACHE_TTL_SECONDS: z.coerce.number().int().min(60).max(2592000).default(604800),
  ROUTING_CACHE_TTL_SECONDS: z.coerce.number().int().min(30).max(86400).default(900),
  OTEL_ENABLED: booleanFromEnv.default(false),
  OTEL_SERVICE_NAME: z.string().min(1).max(128).default("flash-api"),
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: z.string().url().default("http://127.0.0.1:4318/v1/traces"),
  MAP_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(5000),
  MAP_PROVIDER_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(20).default(5),
  MAP_PROVIDER_RESET_MS: z.coerce.number().int().min(1000).max(600000).default(30000),
  MAP_PROVIDER_DAILY_BUDGET: z.coerce.number().int().min(1).max(10000000).default(10000),
  MAP_STALE_CACHE_SECONDS: z.coerce.number().int().min(60).max(2592000).default(86400),
  FEATURE_FLAG_SALT: z.string().min(32).default("local-feature-flag-salt-change-before-prod"),
  REDIS_URL: z.string().url().optional(),
  REDIS_REQUIRED: booleanFromEnv.default(false),
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  PHONE_VERIFY_PROVIDER: z.enum(["disabled", "sandbox", "twilio"]).default("sandbox"),
  TWILIO_ACCOUNT_SID: z
    .string()
    .regex(/^AC[0-9a-fA-F]{32}$/)
    .optional(),
  TWILIO_AUTH_TOKEN: z.string().min(20).optional(),
  TWILIO_VERIFY_SERVICE_SID: z
    .string()
    .regex(/^VA[0-9a-fA-F]{32}$/)
    .optional(),
  PAYMENT_MARKETPLACE_PROVIDER: z.enum(["disabled", "mercadopago"]).default("disabled"),
  PAYMENT_OAUTH_ENCRYPTION_KEY: z
    .string()
    .min(32)
    .default("local-payment-oauth-key-change-before-production"),
  MERCADOPAGO_CLIENT_ID: z.string().min(3).optional(),
  MERCADOPAGO_CLIENT_SECRET: z.string().min(16).optional(),
  MERCADOPAGO_PUBLIC_KEY: z.string().min(8).optional(),
  MERCADOPAGO_REDIRECT_URI: z
    .string()
    .url()
    .default("http://127.0.0.1:4000/api/payment-provider/mercadopago/callback"),
  PAYMENT_OAUTH_RETURN_URL: z.string().url().default("http://127.0.0.1:5173"),
  MERCADOPAGO_WEBHOOK_SECRET: z.string().min(32).optional(),
  // LAN-002: los documentos legales los redacta el dueño con asesoría; acá sólo su URL.
  LEGAL_TERMS_URL: optionalUrl,
  LEGAL_PRIVACY_URL: optionalUrl,
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const message = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid server configuration: ${message}`);
}

const env = parsed.data;
const corsOrigins = env.CORS_ORIGIN.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const webMapOrigins = [
  ...new Set(
    env.WEB_MAP_ORIGINS.split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => {
        const origin = new URL(value).origin;
        if (!origin.startsWith("https://"))
          throw new Error("WEB_MAP_ORIGINS only accepts HTTPS origins");
        return origin;
      }),
  ),
];

// Staging corre como producción (secretos propios, cookies seguras, RLS sin bypass, MFA de
// operaciones) pero admite proveedores de prueba donde todavía no hay cuenta de tercero:
// mapas, notificaciones, email, SMS, pagos y documentos legales. Lo demás se exige igual.
const isStaging = env.NODE_ENV === "production" && env.DEPLOY_STAGE === "staging";
const strictProviders = env.NODE_ENV === "production" && !isStaging;

if (env.NODE_ENV === "production" && env.JWT_SECRET === defaultJwtSecret) {
  throw new Error("JWT_SECRET must be configured before running in production");
}
if (env.NODE_ENV === "production" && !env.DATABASE_URL) {
  throw new Error("DATABASE_URL must point to PostgreSQL/PostGIS in production");
}
if (
  env.NODE_ENV === "production" &&
  env.PAYMENT_WEBHOOK_SECRET === "local-payment-webhook-secret-change-me"
) {
  throw new Error("PAYMENT_WEBHOOK_SECRET must be configured before running in production");
}
if (env.NODE_ENV === "production" && env.METRICS_TOKEN === "local-metrics-token-change-before-prod")
  throw new Error("METRICS_TOKEN must be configured before running in production");
// La política de uso de Nominatim prohíbe autocomplete de cliente contra la
// instancia pública y advierte a las aplicaciones comerciales que no dependan
// de ella. El demo público de OSRM está en la misma situación.
if (strictProviders && env.MAPS_PROVIDER === "openstreetmap")
  throw new Error(
    "MAPS_PROVIDER openstreetmap uses public community instances and is forbidden in production",
  );
if (
  env.NODE_ENV === "production" &&
  env.MAPS_PROVIDER === "google" &&
  !env.GOOGLE_MAPS_SERVER_API_KEY
)
  throw new Error("GOOGLE_MAPS_SERVER_API_KEY is required when MAPS_PROVIDER is google");
if (strictProviders && env.NOTIFICATION_PROVIDER === "sandbox")
  throw new Error("NOTIFICATION_PROVIDER sandbox is forbidden in production");
// Expo sin access token deja el proyecto abierto: cualquiera que conozca un
// token de dispositivo puede enviarle notificaciones en nombre de Flash.
if (env.NODE_ENV === "production" && env.NOTIFICATION_PROVIDER === "expo" && !env.EXPO_ACCESS_TOKEN)
  throw new Error("EXPO_ACCESS_TOKEN is required when NOTIFICATION_PROVIDER is expo in production");
if (
  env.NODE_ENV === "production" &&
  env.PUSH_TOKEN_ENCRYPTION_KEY === "local-device-token-key-change-before-production"
)
  throw new Error("PUSH_TOKEN_ENCRYPTION_KEY must be configured before running in production");
if (
  env.NODE_ENV === "production" &&
  env.DELIVERY_PIN_SECRET === "local-delivery-pin-secret-change-before-production"
)
  throw new Error("DELIVERY_PIN_SECRET must be configured before running in production");
if (
  env.NODE_ENV === "production" &&
  env.MFA_ENCRYPTION_KEY === "local-admin-mfa-key-change-before-production"
)
  throw new Error("MFA_ENCRYPTION_KEY must be configured before running in production");
if (
  env.NODE_ENV === "production" &&
  env.KYC_DOCUMENT_ENCRYPTION_KEY === "local-kyc-document-key-change-before-production"
)
  throw new Error("KYC_DOCUMENT_ENCRYPTION_KEY must be configured before running in production");
if (
  env.NODE_ENV === "production" &&
  env.DELIVERY_PROOF_ENCRYPTION_KEY === "local-delivery-proof-key-change-before-production"
)
  throw new Error("DELIVERY_PROOF_ENCRYPTION_KEY must be configured before running in production");
if (
  env.NODE_ENV === "production" &&
  env.RECOVERY_TOKEN_ENCRYPTION_KEY === "local-recovery-token-key-change-before-production"
)
  throw new Error("RECOVERY_TOKEN_ENCRYPTION_KEY must be configured before running in production");
if (
  strictProviders &&
  (env.EMAIL_PROVIDER !== "smtp" || !env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD)
)
  throw new Error("EMAIL_PROVIDER smtp and SMTP credentials are required in production");
if (env.NODE_ENV === "production" && !env.REQUIRE_ADMIN_MFA)
  throw new Error("REQUIRE_ADMIN_MFA must be true in production");
if (
  env.NODE_ENV === "production" &&
  env.FEATURE_FLAG_SALT === "local-feature-flag-salt-change-before-prod"
)
  throw new Error("FEATURE_FLAG_SALT must be configured before running in production");
if (
  strictProviders &&
  (env.PHONE_VERIFY_PROVIDER !== "twilio" ||
    !env.TWILIO_ACCOUNT_SID ||
    !env.TWILIO_AUTH_TOKEN ||
    !env.TWILIO_VERIFY_SERVICE_SID)
)
  throw new Error("Twilio Verify credentials are required for production phone verification");
if (
  env.NODE_ENV === "production" &&
  env.PAYMENT_MARKETPLACE_PROVIDER === "mercadopago" &&
  (env.PAYMENT_OAUTH_ENCRYPTION_KEY === "local-payment-oauth-key-change-before-production" ||
    !env.MERCADOPAGO_CLIENT_ID ||
    !env.MERCADOPAGO_CLIENT_SECRET ||
    !env.MERCADOPAGO_PUBLIC_KEY ||
    !env.MERCADOPAGO_WEBHOOK_SECRET)
)
  throw new Error(
    "Mercado Pago public key, OAuth, webhook credentials and independent encryption key are required",
  );

// Las tiendas exigen una política de privacidad pública, y nadie acepta unos términos
// que no puede leer: en producción las dos URLs son obligatorias y HTTPS.
for (const [name, value] of [
  ["LEGAL_TERMS_URL", env.LEGAL_TERMS_URL],
  ["LEGAL_PRIVACY_URL", env.LEGAL_PRIVACY_URL],
]) {
  if (strictProviders && !value?.startsWith("https://"))
    throw new Error(`${name} must be an HTTPS URL in production`);
  // En staging pueden faltar, pero si están tienen que ser HTTPS.
  if (isStaging && value && !value.startsWith("https://"))
    throw new Error(`${name} must be an HTTPS URL in staging`);
}

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  isStaging,
  deployStage: env.NODE_ENV === "production" ? env.DEPLOY_STAGE : "local",
  // Fuera de producción siempre; en staging, sólo si se pidió (STAGING_EXPOSE_DEV_CODES).
  // Son los códigos de verificación de email y teléfono: mostrarlos deja crear cuentas
  // con datos ajenos, pero no entrar a una cuenta que ya existe.
  exposeDevelopmentCodes:
    env.NODE_ENV !== "production" || (isStaging && env.STAGING_EXPOSE_DEV_CODES),
  // El token de recuperación de contraseña, nunca en un despliegue: con sólo saber el
  // email de alguien se le cambiaría la contraseña y se le cerrarían las sesiones.
  exposeRecoveryTokens: env.NODE_ENV !== "production",
  // Producción exige direcciones validadas por el proveedor comercial; staging no lo tiene.
  requireCommercialGeocoding: strictProviders,
  // Medios de pago y cargas de prueba: nunca en producción real.
  allowSandboxPayments: !strictProviders,
  port: env.PORT,
  host: env.HOST,
  jwtSecret: env.JWT_SECRET,
  corsOrigins,
  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    authMax: env.AUTH_RATE_LIMIT_MAX,
  },
  logLevel: env.LOG_LEVEL,
  databaseUrl: env.DATABASE_URL,
  databaseSsl: env.DATABASE_SSL,
  allowSandboxTopups: !strictProviders && env.ALLOW_SANDBOX_TOPUPS,
  paymentWebhookSecret: env.PAYMENT_WEBHOOK_SECRET,
  metricsToken: env.METRICS_TOKEN,
  notificationProvider: env.NOTIFICATION_PROVIDER,
  push: {
    provider: env.NOTIFICATION_PROVIDER,
    accessToken: env.EXPO_ACCESS_TOKEN ?? null,
    timeoutMs: env.PUSH_TIMEOUT_MS,
    receiptDelaySeconds: env.PUSH_RECEIPT_DELAY_SECONDS,
  },
  pushTokenEncryptionKey: env.PUSH_TOKEN_ENCRYPTION_KEY,
  deliveryPinSecret: env.DELIVERY_PIN_SECRET,
  orderDeliveryCodeMinCents: env.ORDER_DELIVERY_CODE_MIN_CENTS,
  cashDriverDebtLimitCents: env.CASH_DRIVER_DEBT_LIMIT_CENTS,
  cashMerchantDebtLimitCents: env.CASH_MERCHANT_DEBT_LIMIT_CENTS,
  mfaEncryptionKey: env.MFA_ENCRYPTION_KEY,
  kycDocumentEncryptionKey: env.KYC_DOCUMENT_ENCRYPTION_KEY,
  deliveryProofEncryptionKey: env.DELIVERY_PROOF_ENCRYPTION_KEY,
  recoveryTokenEncryptionKey: env.RECOVERY_TOKEN_ENCRYPTION_KEY,
  emailProvider: env.EMAIL_PROVIDER,
  appPublicUrl: env.APP_PUBLIC_URL,
  legal: { termsUrl: env.LEGAL_TERMS_URL ?? null, privacyUrl: env.LEGAL_PRIVACY_URL ?? null },
  smtp: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.SMTP_FROM,
  },
  requireAdminMfa: env.REQUIRE_ADMIN_MFA,
  dispatch: {
    searchRadiusM: env.DISPATCH_SEARCH_RADIUS_M,
    maxRadiusM: Math.max(env.DISPATCH_SEARCH_RADIUS_M, env.DISPATCH_MAX_RADIUS_M),
    shortlistSize: env.DISPATCH_SHORTLIST_SIZE,
    batchingEnabled: env.FOOD_BATCHING_ENABLED,
    batchMaxDetourM: env.FOOD_BATCH_MAX_DETOUR_M,
  },
  maps: { provider: env.MAPS_PROVIDER, googleServerApiKey: env.GOOGLE_MAPS_SERVER_API_KEY ?? null },
  geocodingUrl: env.GEOCODING_URL,
  routingUrl: env.ROUTING_URL,
  webMapOrigins,
  geocodingCacheTtlSeconds: env.GEOCODING_CACHE_TTL_SECONDS,
  routingCacheTtlSeconds: env.ROUTING_CACHE_TTL_SECONDS,
  telemetry: {
    enabled: env.OTEL_ENABLED,
    serviceName: env.OTEL_SERVICE_NAME,
    tracesUrl: env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
  },
  mapProvider: {
    timeoutMs: env.MAP_PROVIDER_TIMEOUT_MS,
    failureThreshold: env.MAP_PROVIDER_FAILURE_THRESHOLD,
    resetMs: env.MAP_PROVIDER_RESET_MS,
    dailyBudget: env.MAP_PROVIDER_DAILY_BUDGET,
    staleCacheSeconds: env.MAP_STALE_CACHE_SECONDS,
  },
  featureFlagSalt: env.FEATURE_FLAG_SALT,
  redis: { url: env.REDIS_URL, required: env.REDIS_REQUIRED },
  shutdownGraceMs: env.SHUTDOWN_GRACE_MS,
  phoneVerification: {
    provider: env.PHONE_VERIFY_PROVIDER,
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    serviceSid: env.TWILIO_VERIFY_SERVICE_SID,
  },
  paymentMarketplace: {
    provider: env.PAYMENT_MARKETPLACE_PROVIDER,
    encryptionKey: env.PAYMENT_OAUTH_ENCRYPTION_KEY,
    clientId: env.MERCADOPAGO_CLIENT_ID,
    clientSecret: env.MERCADOPAGO_CLIENT_SECRET,
    publicKey: env.MERCADOPAGO_PUBLIC_KEY,
    redirectUri: env.MERCADOPAGO_REDIRECT_URI,
    returnUrl: env.PAYMENT_OAUTH_RETURN_URL,
    webhookSecret: env.MERCADOPAGO_WEBHOOK_SECRET,
  },
};
