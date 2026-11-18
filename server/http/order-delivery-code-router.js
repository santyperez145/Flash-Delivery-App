// Código de entrega en pedidos (SEG-03).
//
// El cliente lo ve; quien reparte lo ingresa al llegar. La guarda que lo exige
// para cerrar el pedido vive en `POST /api/orders/:orderId/advance`.
import { Router } from "express";
import { z } from "zod";

import { recordPostgresAudit } from "../operations-repository.js";
import {
  getOrderDeliveryCode,
  verifyOrderDeliveryCode,
} from "../order-delivery-code-repository.js";
import { usesPostgresCommerce } from "../postgres.js";
import { requireAuth } from "./authentication.js";
import { requireAnyRole } from "./authorization.js";
import { deliveryProofLimiter } from "./rate-limits.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

const codigoSchema = z.object({ pin: z.string().regex(/^\d{4}$/, "El código tiene 4 dígitos") });

export const orderDeliveryCodeRouter = Router();

orderDeliveryCodeRouter.get(
  "/api/orders/:orderId/delivery-code",
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return fail(res, 503, "El código de entrega requiere PostgreSQL");
    try {
      res.set("Cache-Control", "no-store, private");
      return ok(
        res,
        await getOrderDeliveryCode({
          orderPublicId: req.params.orderId,
          userPublicId: req.auth.userId,
        }),
      );
    } catch (error) {
      return failFrom(res, error, "No se pudo leer el código de entrega");
    }
  },
);

orderDeliveryCodeRouter.post(
  "/api/orders/:orderId/delivery-code/verify",
  deliveryProofLimiter,
  requireAuth,
  requireAnyRole("driver"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return fail(res, 503, "El código de entrega requiere PostgreSQL");
    const parsed = parseOrFail(codigoSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const result = await verifyOrderDeliveryCode({
        orderPublicId: req.params.orderId,
        userPublicId: req.auth.userId,
        pin: parsed.data.pin,
      });
      // Sin el código: ni en la auditoría ni en la respuesta.
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "order.delivery_code_verified",
        entityType: "order",
        entityId: req.params.orderId,
        requestId: req.requestId,
        afterData: { verifiedAt: result.verifiedAt },
      });
      return ok(res, result);
    } catch (error) {
      return failFrom(res, error, "No se pudo verificar el código");
    }
  },
);
