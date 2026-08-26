// Etiquetas de estado en español (ticket ARC-001, paso 9).
//
// Los tres mapas traducen el estado de dominio que devuelve el backend a lo que
// lee una persona. Vivían en `src/App.tsx` y los usa toda la plataforma: pedidos
// 9 veces, viajes 7, envíos 6, más el backoffice.
//
// Son `Record<Estado, string>` a propósito y no un objeto suelto: si el backend
// agrega un estado, TypeScript exige traducirlo acá en lugar de dejar que la
// pantalla muestre el identificador crudo.
import type { OrderStatus, RideStatus, Shipment } from "./types";

export const orderStatusLabel: Record<OrderStatus, string> = {
  requested: "Validando pago",
  accepted: "Aceptado",
  preparing: "Preparando",
  ready_for_pickup: "Listo para retirar",
  courier_assigned: "Repartidor asignado",
  picked_up: "Retirado",
  delivering: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

export const rideStatusLabel: Record<RideStatus, string> = {
  requested: "Buscando conductor",
  driver_assigned: "Conductor asignado",
  arriving: "Llegando",
  in_progress: "En viaje",
  completed: "Completado",
  cancelled: "Cancelado",
};

export const shipmentStatusLabel: Record<Shipment["status"], string> = {
  requested: "Buscando repartidor",
  driver_assigned: "Repartidor asignado",
  arriving: "Retirando el paquete",
  picked_up: "Paquete retirado",
  delivering: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

// --- Progresión de estados ------------------------------------------------
//
// El orden en que una pantalla dibuja los pasos de un pedido, un viaje o un
// envío. Son listas y no los `Record` de arriba porque acá **el orden es el
// dato**: un objeto no lo garantiza y una barra de progreso lo necesita.
//
// `cancelled` no aparece en ninguna: no es un paso del recorrido, es su
// interrupción, y dibujarlo como quinto paso sugeriría que se llega ahí.

export const orderSteps: OrderStatus[] = [
  "requested",
  "accepted",
  "preparing",
  "ready_for_pickup",
  "courier_assigned",
  "picked_up",
  "delivering",
  "delivered",
];

export const rideSteps: RideStatus[] = [
  "requested",
  "driver_assigned",
  "arriving",
  "in_progress",
  "completed",
];

export const shipmentSteps: Shipment["status"][] = [
  "requested",
  "driver_assigned",
  "arriving",
  "picked_up",
  "delivering",
  "delivered",
];
