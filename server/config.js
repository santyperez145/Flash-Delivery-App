import { z } from "zod";

const defaultJwtSecret = "flash-local-demo-secret";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().min(1).default("127.0.0.1"),
  JWT_SECRET: z.string().min(16).default(defaultJwtSecret),
  CORS_ORIGIN: z.string().default("http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:8081,http://localhost:8081"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(40),
  LOG_LEVEL: z.enum(["silent", "info"]).default("info")
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
  logLevel: env.LOG_LEVEL
};
