import { request } from "./api";
import type { GiftCard, ReceivedGiftCard } from "./types";

// Tarjetas de regalo (PAG-04), aparte de `api.ts` porque ese archivo es un
// monolito identificado en el hallazgo H-08. Mismas llamadas que la app móvil.

export const getGiftCards = () =>
  request<{ purchased: GiftCard[]; received: ReceivedGiftCard[] }>("/me/gift-cards");

/**
 * `idempotencyKey` lo arma quien llama, una vez por compra: un reintento después
 * de un corte de red devuelve la misma tarjeta en vez de cobrar otra.
 */
export const purchaseGiftCard = (
  input: { amount: number; recipientEmail?: string; message?: string; mfaCode?: string },
  idempotencyKey: string,
) =>
  request<{ card: GiftCard }>("/gift-cards", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(input),
  });

export const redeemGiftCardCode = (code: string) =>
  request<{ card: { id: string; amount: number } }>("/gift-cards/redeem", {
    method: "POST",
    body: JSON.stringify({ code }),
  });

export const claimGiftCard = (giftCardId: string) =>
  request<{ card: { id: string; amount: number } }>(`/gift-cards/${giftCardId}/claim`, {
    method: "POST",
    body: "{}",
  });

export const cancelGiftCard = (giftCardId: string) =>
  request<{ card: GiftCard }>(`/gift-cards/${giftCardId}/cancel`, {
    method: "POST",
    body: "{}",
  });
