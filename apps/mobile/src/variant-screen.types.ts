// El contrato que las tres variantes cumplen (ticket ARC-001).
//
// Cada build de Flash carga exactamente una pantalla, y la elige el empaquetador
// —no el runtime—. Para que eso sea posible las tres tienen que ser
// intercambiables desde `App.tsx`, y este archivo es lo que las hace
// intercambiables: un único contexto con todo lo que el caparazón sabe, y cada
// variante toma lo que necesita.
//
// El contexto se pasa entero a propósito, aunque cada variante use la mitad. La
// alternativa —tres formas de props distintas— obligaría a `App.tsx` a saber
// cuál está instalada, que es exactamente lo que este corte elimina.
import type { ReactElement } from "react";

import type { AppState, Driver, Order, Restaurant, User } from "./types";

export type VariantScreenContext = {
  state: AppState;
  activeUser: User | null;
  activeDriver: Driver | null;
  activeRestaurant: Restaurant | null;
  sessionUser: User | null;
  orders: Order[];
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => Promise<void>;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

/**
 * El encabezado propio de la variante, encima de la pantalla.
 *
 * Sólo Flash Negocios dibuja uno: las otras dos lo resuelven adentro de su
 * pantalla. Devolver `null` es la respuesta normal, no un caso de borde.
 */
export type VariantHeader = (context: VariantScreenContext) => ReactElement | null;

/**
 * La pantalla de la variante instalada.
 *
 * Devuelve `null` cuando el contexto todavía no tiene la entidad que la
 * pantalla necesita —un comercio sin restaurante resuelto, por ejemplo—. Esa
 * comprobación vive en la variante y no en `App.tsx`, porque es la variante la
 * que sabe qué entidad la sostiene.
 */
export type VariantScreen = (context: VariantScreenContext) => ReactElement | null;
