// Límites de abuso por operación (ticket ARC-001).
//
// Última pieza del núcleo compartido de HTTP. Los limitadores vivían en
// `server/index.js`, así que un grupo de rutas que necesitara uno seguía atado
// al archivo grande incluso teniendo todo lo demás extraído.
//
// **El límite se comparte entre réplicas cuando hay Redis.** Sin él cae a
// memoria del proceso, lo que significa que N réplicas toleran N veces el
// límite: es degradación aceptable en desarrollo y no en producción, donde
// `REDIS_REQUIRED` lo exige. `test:redis-rate-limit` prueba justamente que dos
// réplicas comparten el mismo presupuesto.
//
// `/health` y `/ready` quedan exentos a propósito: un chequeo de salud que el
// rate limiter apaga convierte un pico de tráfico en una baja del servicio.
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";

import { config } from "../config.js";
import { redisClient } from "../redis.js";
import { fail } from "./responses.js";

/**
 * Cada límite lleva su propio `prefix`.
 *
 * Compartir prefijo entre operaciones distintas haría que subir una foto de
 * entrega consumiera el presupuesto de autorizar un pago. El prefijo es lo que
 * mantiene separados presupuestos que no tienen nada que ver.
 */
export function createLimiter({ max, message, prefix }) {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: max,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) => ["/health", "/ready"].includes(req.path),
    handler: (_req, res) => fail(res, 429, message),
    ...(redisClient
      ? {
          store: new RedisStore({
            sendCommand: (...args) => redisClient.sendCommand(args),
            prefix: `flash:rate:${prefix}:`,
          }),
        }
      : {}),
  });
}

/** Autorización financiera: el presupuesto más bajo, porque el daño es dinero. */
export const payoutStepUpLimiter = createLimiter({
  max: 10,
  prefix: "payout-step-up",
  message: "Demasiados intentos de autorización financiera. Intenta más tarde.",
});

// La base bloquea la verificación de PIN a los cinco fallos por su cuenta. Este
// presupuesto más amplio cubre además la subida y descarga autorizada de fotos.
export const deliveryProofLimiter = createLimiter({
  max: 30,
  prefix: "delivery-proof",
  message: "Demasiadas operaciones de prueba de entrega. Intenta más tarde.",
});

export const serviceChatLimiter = createLimiter({
  max: 60,
  prefix: "service-chat",
  message: "Demasiados mensajes. Espera antes de continuar.",
});
