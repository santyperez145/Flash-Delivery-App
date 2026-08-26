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
import type { Order } from "./types";

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

/** Un paso de la ruta vial, tal como lo devuelve el proveedor cartográfico. */
export type RoadStep = {
  type: string;
  modifier: string;
  street: string;
  distanceM: number;
  durationSec: number;
  location: { lat: number; lng: number };
};

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
