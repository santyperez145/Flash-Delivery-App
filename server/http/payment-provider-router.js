// El vínculo con el proveedor de cobro: conectarlo, cortarlo y escuchar lo que
// avisa (ticket ARC-001, paso 2).
//
// Siete rutas que salieron del mismo bloque que `merchant-router.js` y no son lo
// mismo. Allá el comercio mira su plata; acá se establece la conexión OAuth con
// Mercado Pago y se recibe lo que el proveedor manda sin que nadie lo pida.
//
// **Tres de las siete no las llama nuestra aplicación.** El callback de OAuth lo
// invoca el navegador del comercio al volver de Mercado Pago, y los dos webhooks
// los invoca el proveedor. Por eso ninguna de las tres tiene `requireAuth`: no
// hay sesión que presentar. Lo que las autentica es otra cosa —el `state` del
// callback, la firma de los webhooks— y por eso esa verificación no es un
// detalle sino lo único que separa la ruta de ser un endpoint abierto.
//
// El callback **siempre redirige**, con éxito o con error, y nunca devuelve el
// motivo crudo: `invalid_state` o `provider_unavailable`. Del otro lado hay una
// persona mirando el navegador, no un cliente que sepa leer un JSON de error.
//
// `client-configuration` es la única que mira un comercio ajeno, y por eso sólo
// devuelve un booleano: si ese comercio puede cobrar. Un cliente necesita
// saberlo antes de intentar pagar; no necesita saber nada más de esa conexión.
import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";

import { requireAuth } from "./authentication.js";
import { requireAnyRole } from "./authorization.js";
import { config } from "../config.js";
import { enqueueMercadoPagoWebhook } from "../mercadopago-webhook-repository.js";
import { verifyMercadoPagoWebhook } from "../mercadopago-webhook.js";
import {
  beginMerchantPaymentOAuth,
  completeMerchantPaymentOAuth,
  getMerchantPaymentConnection,
  revokeMerchantPaymentConnection,
} from "../payment-oauth-repository.js";
import { recordPaymentWebhook, verifyWebhookSignature } from "../payment-repository.js";
import { postgresPool } from "../postgres.js";
import { payoutStepUpLimiter } from "./rate-limits.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

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

export const paymentProviderRouter = Router();
const router = paymentProviderRouter;

router.post("/api/payments/webhooks/:provider", async (req, res) => {
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

router.get(
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
router.get(
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
router.post(
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
router.post(
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
router.get("/api/payment-provider/mercadopago/callback", async (req, res) => {
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
router.post("/api/webhooks/mercadopago", async (req, res) => {
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
