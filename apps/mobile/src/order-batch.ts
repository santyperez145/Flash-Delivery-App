import type { DispatchOffer, Order } from "./types";

// Pedidos agrupados (P-03): quien reparte retira dos pedidos del mismo local y los
// entrega en orden. Los textos y el orden del recorrido viven acá para que la oferta,
// la lista de activos, la navegación y el seguimiento del cliente digan lo mismo.
// Del otro pedido no se muestra nada: es de otro cliente.

/** Ya salió del local: lo que queda es entregarlo. */
export const orderPickedUp = (order: Order) =>
  order.status === "picked_up" || order.status === "delivering";

/**
 * Los pedidos activos en el orden en que se recorren: primero los que faltan retirar
 * (en un lote, los dos están en el mismo local), después las entregas por posición.
 * Sin lote, se respeta el orden en que llegaron.
 */
export const ordersInRouteOrder = (orders: Order[]) =>
  orders
    .map((order, index) => ({ order, index }))
    .sort(
      (a, b) =>
        Number(orderPickedUp(a.order)) - Number(orderPickedUp(b.order)) ||
        (a.order.batch?.position ?? 0) - (b.order.batch?.position ?? 0) ||
        // Desempate explícito: no depende de que el motor ordene de forma estable.
        a.index - b.index,
    )
    .map(({ order }) => order);

/** Dos pedidos activos del mismo lote que todavía están en el local. */
export const batchPickupPending = (orders: Order[]) =>
  orders.filter((order) => order.batch).length >= 2 &&
  orders.some((order) => order.batch && !orderPickedUp(order));

/** El chip de cada pedido del lote en la lista de quien reparte. */
export const batchStopLabel = (batch: NonNullable<Order["batch"]>) =>
  `Entrega ${batch.position} de ${batch.stops}`;

/** Lo que agrega el segundo pedido, dicho antes de aceptarlo. */
export const batchOfferDetail = (batch: NonNullable<DispatchOffer["batch"]>) => {
  const minutos = Math.round(batch.extraMinutes);
  // Sin minutos extra no se inventa un «+0 min»: se dice sólo lo que cambia.
  return ["Retirás los dos juntos", "lo entregás segundo", minutos > 0 && `+${minutos} min`]
    .filter(Boolean)
    .join(" · ");
};

/** Lo que ve quien pidió mientras su pedido va en un lote; nada si ya terminó. */
export const customerBatchLine = (order: Order) => {
  if (!order.batch || order.status === "delivered" || order.status === "cancelled") return null;
  return order.batch.position === 2
    ? "Tu repartidor entrega primero otro pedido del mismo local. Ya está contado en el horario estimado."
    : "Tu pedido es la primera entrega del recorrido.";
};
