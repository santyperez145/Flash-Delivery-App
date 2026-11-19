// Pedidos agrupados del mismo local, vistos por quien reparte (P-03).
//
// El servidor decide el lote y dice qué entrega es cada pedido (`order.batch`);
// acá sólo se ordena lo que ya llegó como recorrido. Nada del otro pedido viaja
// en el del cliente, así que todo se calcula con los pedidos que quien reparte ya
// tiene asignados.
import { money } from "../format";
import type { DispatchOffer, Order, Restaurant } from "../types";

/** Retirado o en camino: lo que queda de ese pedido es la entrega. */
function yaRetirado(order: Order) {
  return order.status === "picked_up" || order.status === "delivering";
}

/**
 * Los pedidos activos en el orden en que se recorren: primero los que faltan
 * retirar (los dos de un lote se retiran juntos, en el mismo local) y después las
 * entregas según su lugar en el lote. `sort` es estable: un pedido suelto conserva
 * el lugar que tenía.
 */
export function ordenarRecorrido(orders: Order[]) {
  return [...orders].sort(
    (a, b) =>
      Number(yaRetirado(a)) - Number(yaRetirado(b)) ||
      (a.batch?.position ?? 0) - (b.batch?.position ?? 0),
  );
}

/**
 * Dos pedidos activos de un mismo lote que todavía están en el local. Se comparan
 * comercio y sucursal porque el lote nunca mezcla locales; el aviso evita que se
 * vaya con uno solo.
 */
export function retiraDosDelLocal(orders: Order[]) {
  const porRetirar = orders.filter((order) => order.batch && !yaRetirado(order));
  return porRetirar.some((order, index) =>
    porRetirar
      .slice(index + 1)
      .some(
        (otro) =>
          otro.restaurantId === order.restaurantId &&
          (otro.branchId ?? null) === (order.branchId ?? null) &&
          otro.batch?.position !== order.batch?.position,
      ),
  );
}

/**
 * La próxima parada: si falta retirar algo, el local; si no, la entrega con el
 * lugar más bajo del lote. Con un solo pedido es ese mismo, como antes.
 */
export function proximaParada(orders: Order[], restaurants: Restaurant[]) {
  if (!orders.length) return null;
  const porRetirar = orders.find((order) => !yaRetirado(order));
  if (porRetirar) {
    const local = restaurants.find((entry) => entry.id === porRetirar.restaurantId);
    return `Retiro en ${local?.name || "el local"}`;
  }
  const siguiente = ordenarRecorrido(orders)[0];
  return `Entrega en ${siguiente.deliveryAddress}`;
}

export function BatchChip({ order }: { order: Order }) {
  if (!order.batch) return null;
  return (
    <span className="batch-chip">
      Entrega {order.batch.position} de {order.batch.stops}
    </span>
  );
}

/**
 * Lo que se muestra como monto de la oferta. En comida `fare` es lo que paga el
 * cliente, que no es lo que gana quien reparte: si el servidor manda la ganancia,
 * va esa.
 */
export function montoDeOferta(offer: DispatchOffer) {
  return offer.courierEarning != null
    ? `Ganás ${money.format(offer.courierEarning)}`
    : money.format(offer.fare);
}

/** El encabezado y la aclaración de una oferta que se suma a un pedido en curso. */
export function encabezadoDeLote(offer: DispatchOffer) {
  if (!offer.batch) return null;
  return {
    titulo: "Sumá un pedido del mismo local",
    detalle: `Retirás los dos juntos · lo entregás segundo · +${offer.batch.extraMinutes} min`,
  };
}
