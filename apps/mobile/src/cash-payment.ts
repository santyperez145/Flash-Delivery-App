import { money } from "./format";
import type { CashPayment } from "./types";

// Efectivo en pedidos de comida (PAG-01): lo comparten el checkout, el seguimiento,
// el repartidor y el comercio. Los textos viven acá para que quien paga, quien cobra
// y quien despacha lean el mismo monto con las mismas palabras.

/** La etiqueta exacta que espera la API como `paymentMethod`, igual que en viajes. */
export const CASH_PAYMENT = "Efectivo";

/**
 * El id con que la lista de medios de la comida marca «Efectivo». No es un medio
 * guardado: se manda la etiqueta sin `paymentMethodId`, que el servidor rechaza.
 */
export const CASH_PAYMENT_ID = "efectivo";

/** Quién cobra, dicho a quien paga: el repartidor al llegar o el mostrador. */
export const cashCollectionNote = (fulfillment: "delivery" | "pickup") =>
  fulfillment === "pickup"
    ? "Pagás en el mostrador al retirar"
    : "Le pagás al repartidor cuando llega";

/**
 * «¿Con cuánto pagás?» en pesos enteros, o `null` si está vacío: pagar justo es la
 * opción por omisión y no se manda nada.
 */
export const parseCashTendered = (text: string): number | null => {
  const digitos = text.replace(/\D/g, "");
  return digitos ? Number(digitos) : null;
};

const vuelto = (cash: CashPayment, prefijo: string) =>
  cash.tendered === null
    ? ""
    : ` · ${prefijo} ${money.format(cash.tendered)}, vuelto ${money.format(cash.change)}`;

/** Lo que ve quien pidió en el seguimiento y en sus pedidos. */
export const customerCashLine = (cash: CashPayment) =>
  `Pagás en efectivo ${money.format(cash.toCollect)}${vuelto(cash, "con")}`;

/** Lo que ve quien reparte: cuánto cobrar en mano y cuánto vuelto llevar. */
export const courierCashLine = (cash: CashPayment) =>
  `Cobrá ${money.format(cash.toCollect)} en efectivo${vuelto(cash, "paga con")}`;

/** Lo que ve el comercio: cobra él sólo en un retiro; en reparto cobra quien lleva. */
export const merchantCashLine = (cash: CashPayment) =>
  cash.collector === "merchant"
    ? `Cobrá ${money.format(cash.toCollect)} en efectivo en el mostrador${vuelto(cash, "paga con")}`
    : "El repartidor cobra en efectivo";
