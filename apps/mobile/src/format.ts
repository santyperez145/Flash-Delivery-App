// Formateo y etiquetas de la aplicación móvil (ticket ARC-001, paso 10).
//
// El resto del núcleo compartido de `apps/mobile/App.tsx`, junto con
// [`styles.ts`](styles.ts). Son las funciones que toda pantalla usa para mostrar
// un importe, una duración o el estado de un pedido.
//
// Deliberadamente **no** se comparten con la web aunque tengan nombres iguales:
// `mobileOrderStatusLabel` dice «Nuevo · aceptar» donde la web dice «Aceptado»,
// porque en el móvil la pantalla es del comercio y la etiqueta es una acción, no
// un estado. Unificarlas sería perder esa distinción; el nombre lleva el prefijo
// `mobile` justamente para que nadie las confunda.
import type { Order, Ride, RoadStep, Shipment } from "./types";

/** Pesos argentinos sin decimales, igual que en la web. */
export const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

/** Etiquetas de estado del pedido en la voz del móvil, no la de la web. */
export const mobileOrderStatusLabel: Record<Order["status"], string> = {
  requested: "Validando pago",
  accepted: "Nuevo · aceptar",
  preparing: "En preparación",
  ready_for_pickup: "Listo para retirar",
  courier_assigned: "Courier asignado",
  picked_up: "Retirado",
  delivering: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

/**
 * El estado de lo que pidió un cliente, en su voz (FE-02). La actividad mostraba el
 * identificador crudo («Pedido · courier_assigned»).
 */
export const customerOrderStatusLabel: Record<Order["status"], string> = {
  requested: "Confirmando el pago",
  accepted: "El comercio lo aceptó",
  preparing: "En preparación",
  ready_for_pickup: "Listo para retirar",
  courier_assigned: "Repartidor asignado",
  picked_up: "Retirado por el repartidor",
  delivering: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

export const rideStatusLabel: Record<Ride["status"], string> = {
  requested: "Buscando conductor",
  driver_assigned: "Conductor asignado",
  arriving: "Tu conductor está llegando",
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

/**
 * Duración operativa legible.
 *
 * Distingue `null` de cero: «No disponible» y «0 min» significan cosas
 * distintas, y colapsarlas esconde que el dato falta.
 */
export function operationalDuration(seconds: number | null | undefined) {
  if (seconds == null) return "No disponible";
  const safeSeconds = Math.max(0, seconds);
  if (safeSeconds === 0) return "0 min";
  const minutes = Math.floor(safeSeconds / 60);
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
}

/** Importe abreviado para tarjetas y KPIs, donde no entra la cifra completa. */
export function compactMoney(value: number) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000)
    return `${sign}$${(absolute / 1_000_000).toFixed(absolute >= 10_000_000 ? 0 : 1).replace(".0", "")}M`;
  if (absolute >= 1_000)
    return `${sign}$${(absolute / 1_000).toFixed(absolute >= 10_000 ? 0 : 1).replace(".0", "")}k`;
  return `${sign}$${Math.round(absolute)}`;
}

/** Instrucción de giro en una sola frase, para el modo navegación. */
export function navigationInstruction(step: RoadStep) {
  const action =
    step.type === "arrive"
      ? "Llegá a destino"
      : step.modifier.includes("left")
        ? "Girá a la izquierda"
        : step.modifier.includes("right")
          ? "Girá a la derecha"
          : step.type === "depart"
            ? "Empezá"
            : "Continuá";
  return `${action} por ${step.street}`;
}

/**
 * El texto que el servidor ya redactó para una notificación, si lo mandó. Las del
 * perfil familiar (PAG-05) traen `title` y `body`; sin leerlos, la bandeja mostraba
 * un texto genérico. `null`: la bandeja sigue con su texto de siempre.
 */
export const notificationPayloadText = (
  payload: Record<string, unknown>,
  key: "title" | "body",
): string | null => {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : null;
};

/**
 * FE-04: la calificación de quien maneja, sólo si alguien lo calificó. Sin opiniones el
 * valor guardado es el inicial (5), no una nota: se dice «Nuevo» en lugar de «★ 5,0».
 */
export function calificacionConductor(driver: { rating: number; ratingCount?: number }) {
  return driver.ratingCount && driver.ratingCount > 0
    ? `★ ${driver.rating.toFixed(1).replace(".", ",")}`
    : "Nuevo";
}
