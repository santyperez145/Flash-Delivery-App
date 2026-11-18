// Preferencias de entrega de un pedido de comida (P-02).
//
// Uber Eats y PedidosYa dejan elegir cómo se entrega: en mano o en la puerta,
// con indicaciones para quien reparte, y si el pedido lleva cubiertos. Flash no
// tenía ninguna de las tres.
//
// **Es un módulo puro, sin base ni red,** por la misma razón que
// `realtime-audience.js`: la validación y lo que ve cada rol tienen que tener una
// sola fuente, y esa fuente tiene que poder probarse sin levantar nada.
//
// Decisiones, con su motivo:
//
// - **El modo de entrega es un valor cerrado, no texto libre.** Uber lo modela
//   como modo de entrega y DoorDash como bandera de entrega sin contacto, los dos
//   separados de las indicaciones. Un modo en texto libre no se puede validar ni
//   mostrar como etiqueta, y no se puede bloquear donde no corresponde.
// - **Las indicaciones son para quien reparte y sólo para él.** Uber no le pasa
//   al comercio el modo ni las notas de entrega cuando la entrega la coordina la
//   plataforma. Acá igual: el comercio ve sólo si el pedido lleva cubiertos, que
//   es lo único que le sirve a la cocina. Un repartidor que todavía no aceptó ve
//   que hay indicaciones y si es sin contacto, nunca el texto: es información de
//   la casa de alguien.
// - **No van en la cotización firmada.** No cambian el precio, igual que la
//   propina, y cambiarlas no debería obligar a volver a cotizar.
// - **«Dejar en la puerta» no se ofrece en farmacia ni en tiendas.** Uber lo
//   bloquea en farmacia y electrónica: un producto de valor o de cuidado
//   personal no se deja sin que alguien lo reciba.
// - **Cubiertos, por omisión, no.** Es una decisión de Flash, no de la
//   competencia: en Uber el valor puede quedar a criterio del comercio. Pedirlos
//   es un toque; mandarlos a quien no los usa es desperdicio en cada pedido.

export const MODOS_DE_ENTREGA = ["hand_to_me", "leave_at_door"];
export const MAX_INDICACIONES = 300;
const RUBROS_SIN_PUERTA = new Set(["pharmacy", "retail"]);

/** Lo que vale para un pedido que no eligió nada, incluidos los anteriores a P-02. */
export const PREFERENCIAS_POR_OMISION = Object.freeze({
  dropoff: "hand_to_me",
  instructions: "",
  cutlery: false,
});

const conflicto = (mensaje) => Object.assign(new Error(mensaje), { status: 409 });

/**
 * Normaliza y valida lo que manda el cliente al confirmar.
 *
 * El esquema HTTP ya acotó tipos y largo; acá van las reglas que dependen del
 * pedido. Lanza 409, como la propina en retiro: aceptar algo que no se va a
 * cumplir es peor que rechazarlo.
 */
export function normalizarPreferencias(
  entrada,
  { fulfillment = "delivery", vertical = "restaurant" } = {},
) {
  const preferencias = {
    dropoff: entrada?.dropoff ?? PREFERENCIAS_POR_OMISION.dropoff,
    instructions: String(entrada?.instructions ?? "")
      // Saltos de línea y tabs se vuelven espacios; el resto de los caracteres
      // de control se descarta. Llegan a una pantalla ajena y a una notificación.
      .replace(/[\r\n\t]+/g, " ")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, MAX_INDICACIONES),
    cutlery: entrada?.cutlery === true,
  };
  if (!MODOS_DE_ENTREGA.includes(preferencias.dropoff))
    throw conflicto("Modo de entrega desconocido");
  if (
    fulfillment === "pickup" &&
    (preferencias.dropoff !== "hand_to_me" || preferencias.instructions)
  )
    throw conflicto("Un pedido para retirar no lleva modo ni indicaciones de reparto");
  if (preferencias.dropoff === "leave_at_door" && RUBROS_SIN_PUERTA.has(vertical))
    throw conflicto("Este comercio no permite dejar el pedido en la puerta");
  return preferencias;
}

/** Lee lo guardado, con valores seguros para los pedidos anteriores a P-02. */
export function preferenciasDesdeMetadata(metadata) {
  const guardadas = metadata?.deliveryPreferences || {};
  return {
    dropoff: MODOS_DE_ENTREGA.includes(guardadas.dropoff) ? guardadas.dropoff : "hand_to_me",
    instructions: typeof guardadas.instructions === "string" ? guardadas.instructions : "",
    cutlery: guardadas.cutlery === true,
  };
}

/** Lo que ve el comercio: sólo lo que le sirve a la cocina. */
export function paraElComercio(order) {
  return {
    ...order,
    deliveryPreferences: { cutlery: order.deliveryPreferences?.cutlery === true },
  };
}

/**
 * Lo que ve un repartidor que todavía no aceptó: que hay indicaciones y si es
 * sin contacto, para decidir; nunca el texto.
 */
export function paraRepartidorSinAsignar(order) {
  const preferencias = order.deliveryPreferences || PREFERENCIAS_POR_OMISION;
  return {
    ...order,
    deliveryPreferences: {
      dropoff: preferencias.dropoff,
      hasInstructions: Boolean(preferencias.instructions),
    },
  };
}
