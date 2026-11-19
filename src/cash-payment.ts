// Pago en efectivo de pedidos de comida (PAG-01).
//
// La misma frase la leen tres personas distintas —quien pidió, quien reparte y el
// comercio— y cada una necesita su versión: quien pidió sabe cuánto tener a mano,
// quien reparte cuánto cobrar y cuánto vuelto llevar, y el comercio si cobra él (un
// retiro) o no. Viven juntas para que el importe y el vuelto se escriban igual en
// todas las pantallas.
import { money } from "./format";
import type { CashPayment } from "./types";

/** La etiqueta exacta que el servidor reconoce como pago en efectivo. */
export const CASH_PAYMENT = "Efectivo";

// Sin vuelto que calcular cuando paga justo: `tendered` llega en `null`.
const conVuelto = (cash: CashPayment, verbo: string) =>
  cash.tendered == null
    ? ""
    : ` · ${verbo} ${money.format(cash.tendered)}, vuelto ${money.format(cash.change)}`;

/** Lo que ve quien pidió en el seguimiento y en el resumen. */
export const cobroParaCliente = (cash: CashPayment) =>
  `Pagás en efectivo ${money.format(cash.toCollect)}${conVuelto(cash, "con")}`;

/** Lo que ve quien reparte en el pedido activo. */
export const cobroParaRepartidor = (cash: CashPayment) =>
  `Cobrá ${money.format(cash.toCollect)} en efectivo${conVuelto(cash, "paga con")}`;

/**
 * Lo que ve el comercio. En un retiro cobra él en el mostrador; en una entrega cobra
 * el repartidor, y el comercio sólo tiene que saber que no hay un cobro digital.
 */
export const cobroParaComercio = (cash: CashPayment) =>
  cash.collector === "merchant"
    ? `Cobrá ${money.format(cash.toCollect)} en efectivo en el mostrador${conVuelto(cash, "paga con")}`
    : "El repartidor cobra en efectivo";

// Los movimientos del libro contable llegan con su `kind` crudo. Los del efectivo
// se traducen porque son los que una persona necesita reconocer al conciliar.
const MOVIMIENTOS: Record<string, string> = {
  cash_collection: "Efectivo cobrado",
  cash_deposit: "Rendición de efectivo",
};

/** El tipo de movimiento como lo lee una persona; los demás quedan como llegan. */
export const etiquetaMovimiento = (kind: string) => MOVIMIENTOS[kind] ?? kind;
