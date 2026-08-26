// Métodos de pago del cliente (ticket ARC-001, paso 7).
//
// Décimotercer grupo de rutas extraído de `server/index.js`. Cubre alta, cambio
// de predeterminado y revocación de los métodos que el cliente deja guardados.
//
// **Nunca pasa un PAN ni un CVV por acá.** El alta recibe un token del proveedor
// —`pm_test_...` en sandbox— y sólo persiste marca, últimos cuatro dígitos y
// vencimiento. Es la diferencia entre guardar una referencia a una tarjeta y
// guardar la tarjeta.
//
// El vencimiento se valida contra el mes en curso, no sólo contra el año: una
// tarjeta que vence este mismo mes ya está vencida, y aceptarla sólo mueve el
// rechazo al momento del cobro.
import { Router } from "express";
import { z } from "zod";

import {
  createSandboxPaymentMethod,
  revokePostgresPaymentMethod,
  setDefaultPostgresPaymentMethod,
} from "../auth-repository.js";
import { recordPostgresAudit } from "../operations-repository.js";
import { requireAuth } from "./authentication.js";
import { requireAnyRole } from "./authorization.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

const sandboxPaymentMethodSchema = z
  .object({
    providerToken: z.string().regex(/^pm_test_[A-Za-z0-9_-]{8,120}$/, "Token sandbox inválido"),
    brand: z.enum(["visa", "mastercard", "amex", "cabal"]),
    last4: z.string().regex(/^\d{4}$/),
    expiryMonth: z.coerce.number().int().min(1).max(12),
    expiryYear: z.coerce
      .number()
      .int()
      .min(new Date().getUTCFullYear())
      .max(new Date().getUTCFullYear() + 25),
    isDefault: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    const now = new Date();
    if (value.expiryYear === now.getUTCFullYear() && value.expiryMonth < now.getUTCMonth() + 1)
      ctx.addIssue({
        code: "custom",
        path: ["expiryMonth"],
        message: "La tarjeta está vencida",
      });
  });

export const paymentMethodsRouter = Router();
const router = paymentMethodsRouter;

router.post(
  "/api/payment-methods/sandbox",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    if (config.isProduction) return fail(res, 404, "Ruta no disponible");
    const parsed = parseOrFail(sandboxPaymentMethodSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const paymentMethod = await createSandboxPaymentMethod({
        userPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "payment_method.created",
        entityType: "payment_method",
        entityId: paymentMethod.id,
        requestId: req.requestId,
        afterData: {
          provider: "sandbox",
          brand: paymentMethod.brand,
          last4: paymentMethod.last4,
        },
      });
      return res.status(201).json({ ok: true, requestId: req.requestId, paymentMethod });
    } catch (error) {
      return failFrom(res, error, "No se pudo registrar el método de pago");
    }
  },
);
router.patch(
  "/api/payment-methods/:paymentMethodId/default",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    try {
      const paymentMethod = await setDefaultPostgresPaymentMethod({
        userPublicId: req.auth.userId,
        paymentMethodId: req.params.paymentMethodId,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "payment_method.default_changed",
        entityType: "payment_method",
        entityId: paymentMethod.id,
        requestId: req.requestId,
      });
      return ok(res, { paymentMethod });
    } catch (error) {
      return failFrom(res, error, "No se pudo cambiar el método predeterminado");
    }
  },
);
router.delete(
  "/api/payment-methods/:paymentMethodId",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    try {
      const paymentMethods = await revokePostgresPaymentMethod({
        userPublicId: req.auth.userId,
        paymentMethodId: req.params.paymentMethodId,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "payment_method.revoked",
        entityType: "payment_method",
        entityId: req.params.paymentMethodId,
        requestId: req.requestId,
      });
      return ok(res, {
        paymentMethods: paymentMethods.filter((entry) => entry.userId === req.auth.userId),
      });
    } catch (error) {
      return failFrom(res, error, "No se pudo eliminar el método de pago");
    }
  },
);
