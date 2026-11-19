// Tarjetas de regalo (PAG-04). La lógica y el dinero viven en
// `gift-card-repository.js`.
import { Router } from "express";
import { z } from "zod";

import {
  cancelGiftCard,
  claimGiftCard,
  GIFT_CARD_MIN_PESOS,
  listGiftCards,
  purchaseGiftCard,
  redeemGiftCardCode,
} from "../gift-card-repository.js";
import { recordPostgresAudit } from "../operations-repository.js";
import { usesPostgresCommerce } from "../postgres.js";
import { requireAuth } from "./authentication.js";
import { requireAnyRole } from "./authorization.js";
import { failFromStepUp, stepUpMfa } from "./mfa-step-up.js";
import { giftCardLimiter } from "./rate-limits.js";
import { publishRealtimeEvent } from "./realtime.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

const compraSchema = z.object({
  // Pesos enteros. El tope es técnico (que el importe entre en centavos sin perder
  // precisión); el real es el saldo de la Wallet.
  amount: z
    .number()
    .int("El importe va en pesos enteros")
    .min(GIFT_CARD_MIN_PESOS, `El mínimo es $${GIFT_CARD_MIN_PESOS.toLocaleString("es-AR")}`)
    .max(90_000_000_000_000),
  recipientEmail: z.string().trim().email("Email inválido").max(254).optional(),
  message: z.string().trim().max(140, "El mensaje admite 140 caracteres").optional(),
  mfaCode: z.string().trim().max(32).optional(),
});
const canjeSchema = z.object({ code: z.string().trim().min(1, "Escribí el código").max(40) });

export const giftCardRouter = Router();
const soloPostgres = (res) => fail(res, 503, "Las tarjetas de regalo requieren PostgreSQL");
const auditar = (req, action, entityId, afterData) =>
  recordPostgresAudit({
    actorPublicId: req.auth.userId,
    roles: req.auth.roles,
    action,
    entityType: "gift_card",
    entityId,
    requestId: req.requestId,
    afterData,
  });
// La Wallet cambió: las otras sesiones de la persona la vuelven a leer.
const avisarWallet = (req, action) =>
  publishRealtimeEvent({
    req,
    type: "wallet.updated",
    entityType: "user",
    entityId: req.auth.userId,
    action,
  });

giftCardRouter.get(
  "/api/me/gift-cards",
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return soloPostgres(res);
    try {
      // Lleva los códigos vigentes de quien compró: no se guarda en ningún caché.
      res.set("Cache-Control", "no-store, private");
      return ok(res, await listGiftCards(req.auth.userId));
    } catch (error) {
      return failFrom(res, error, "No se pudieron leer las tarjetas de regalo");
    }
  },
);

giftCardRouter.post(
  "/api/gift-cards",
  giftCardLimiter,
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return soloPostgres(res);
    const parsed = parseOrFail(compraSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    const idempotencyKey = req.get("idempotency-key");
    if (!idempotencyKey || !/^[a-zA-Z0-9._:-]{16,128}$/.test(idempotencyKey))
      return fail(res, 400, "Idempotency-Key válido es obligatorio");
    try {
      // Con la verificación en dos pasos activa, comprar pide el código: con la
      // contraseña sola no alcanza para convertir el saldo en un código y llevárselo.
      await stepUpMfa(req, parsed.data.mfaCode);
      const { card, replayed } = await purchaseGiftCard({
        userPublicId: req.auth.userId,
        amount: parsed.data.amount,
        recipientEmail: parsed.data.recipientEmail || null,
        message: parsed.data.message || null,
        idempotencyKey,
      });
      if (!replayed) {
        await auditar(req, "gift_card.purchased", card.id, {
          amount: card.amount,
          addressed: Boolean(card.recipientEmail),
        });
        await avisarWallet(req, "wallet.gift_card_purchased");
      }
      res.set("Cache-Control", "no-store, private");
      return res.status(replayed ? 200 : 201).json({ ok: true, requestId: req.requestId, card });
    } catch (error) {
      return failFromStepUp(res, error, "No se pudo comprar la tarjeta de regalo");
    }
  },
);

giftCardRouter.post(
  "/api/gift-cards/redeem",
  giftCardLimiter,
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return soloPostgres(res);
    const parsed = parseOrFail(canjeSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const card = await redeemGiftCardCode({
        userPublicId: req.auth.userId,
        code: parsed.data.code,
      });
      await auditar(req, "gift_card.redeemed", card.id, { amount: card.amount, by: "code" });
      await avisarWallet(req, "wallet.gift_card_redeemed");
      return ok(res, { card });
    } catch (error) {
      return failFrom(res, error, "No se pudo canjear la tarjeta de regalo");
    }
  },
);

giftCardRouter.post(
  "/api/gift-cards/:giftCardId/claim",
  giftCardLimiter,
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return soloPostgres(res);
    try {
      const card = await claimGiftCard({
        userPublicId: req.auth.userId,
        giftCardPublicId: req.params.giftCardId,
      });
      await auditar(req, "gift_card.redeemed", card.id, { amount: card.amount, by: "account" });
      await avisarWallet(req, "wallet.gift_card_redeemed");
      return ok(res, { card });
    } catch (error) {
      return failFrom(res, error, "No se pudo canjear la tarjeta de regalo");
    }
  },
);

giftCardRouter.post(
  "/api/gift-cards/:giftCardId/cancel",
  giftCardLimiter,
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return soloPostgres(res);
    try {
      const card = await cancelGiftCard({
        userPublicId: req.auth.userId,
        giftCardPublicId: req.params.giftCardId,
      });
      await auditar(req, "gift_card.cancelled", card.id, { amount: card.amount });
      await avisarWallet(req, "wallet.gift_card_cancelled");
      return ok(res, { card });
    } catch (error) {
      return failFrom(res, error, "No se pudo anular la tarjeta de regalo");
    }
  },
);
