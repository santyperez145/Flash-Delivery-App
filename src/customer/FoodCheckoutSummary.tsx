import { money } from "../format";

// El resumen de totales del carrito y del checkout.
//
// Vive aparte del carrito por el techo de tamaño de `FoodCartScreen.tsx`
// (`test:web-checkout`): las preferencias de entrega (P-02) necesitaban lugar, y
// el resumen es una pieza que sólo muestra, sin estado ni llamadas.
export function SummaryBlock({
  totals,
}: {
  totals: {
    subtotal: number;
    deliveryFee: number;
    serviceFee: number;
    discount?: number;
    subscriptionDiscount?: number;
    tip?: number;
    total: number;
  };
}) {
  return (
    <section className="summary-block">
      <div>
        <span>Subtotal</span>
        <strong>{money.format(totals.subtotal)}</strong>
      </div>
      <div>
        <span>Envio</span>
        <strong>{money.format(totals.deliveryFee)}</strong>
      </div>
      <div>
        <span>Servicio</span>
        <strong>{money.format(totals.serviceFee)}</strong>
      </div>
      {!!totals.discount && (
        <div>
          <span>Promoción</span>
          <strong>-{money.format(totals.discount)}</strong>
        </div>
      )}
      {/* Se nombra el beneficio en lugar de sumarlo al descuento. Quien paga una
          suscripción tiene que ver qué le devolvió en cada pedido: es lo único
          que sostiene la renovación, y esconderlo en «Promoción» lo borra. */}
      {!!totals.subscriptionDiscount && (
        <div className="summary-suscripcion">
          <span>Envío con Flash Más</span>
          <strong>-{money.format(totals.subscriptionDiscount)}</strong>
        </div>
      )}
      {/* Suma, no resta. Es la única línea del resumen que sube el total por
          decisión de la persona, y por eso se muestra por separado: verla dentro
          del total sin nombrarla es la forma más rápida de que se sienta un
          cargo que nadie eligió. */}
      {!!totals.tip && (
        <div>
          <span>Propina</span>
          <strong>{money.format(totals.tip)}</strong>
        </div>
      )}
      <div className="total-line">
        <span>Total</span>
        <strong>{money.format(totals.total)}</strong>
      </div>
    </section>
  );
}
