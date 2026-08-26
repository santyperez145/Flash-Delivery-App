import { config } from "./config.js";

export let redisClient = null;
let lastError = null;

if (config.redis.url) {
  const { createClient } = await import("redis");
  const client = createClient({
    url: config.redis.url,
    socket: {
      connectTimeout: 3000,
      reconnectStrategy: (retries) => Math.min(50 * 2 ** retries, 3000),
    },
  });
  client.on("error", (error) => {
    lastError = error.message;
  });
  try {
    await client.connect();
    redisClient = client;
  } catch (error) {
    lastError = error.message;
    client.destroy();
    if (config.redis.required)
      throw new Error(`Redis requerido pero no disponible: ${error.message}`);
  }
} else if (config.redis.required) {
  throw new Error("REDIS_URL es obligatorio cuando REDIS_REQUIRED=true");
}

export async function redisReadiness() {
  if (!config.redis.url)
    return {
      configured: false,
      ready: false,
      required: config.redis.required,
      mode: "memory-fallback",
    };
  if (!redisClient?.isReady)
    return {
      configured: true,
      ready: false,
      required: config.redis.required,
      mode: "unavailable",
      reason: lastError,
    };
  try {
    return {
      configured: true,
      ready: (await redisClient.ping()) === "PONG",
      required: config.redis.required,
      mode: "distributed",
    };
  } catch (error) {
    lastError = error.message;
    return {
      configured: true,
      ready: false,
      required: config.redis.required,
      mode: "unavailable",
      reason: lastError,
    };
  }
}

export async function closeRedis() {
  if (redisClient?.isOpen) await redisClient.quit();
}
