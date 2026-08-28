// Reglas de programación de un servicio (ticket GTM-001, tercer hueco).
//
// La ventana de reserva vivía escrita a mano dentro del router de viajes, y era
// la única parte del producto que sabía programar algo. Al agregar pedidos de
// comida programados hacían falta las mismas dos cotas, y **una segunda copia de
// una regla de negocio diverge en silencio**: el día que se acepte reservar con
// 15 minutos, la mitad del producto seguiría exigiendo 30 y nadie sabría cuál
// está bien.
//
// Las dos cotas tienen un motivo, no son números redondos por costumbre:
//
// - **30 minutos de anticipación mínima.** Es lo que tarda el despacho en
//   ofrecer y que alguien acepte; por debajo de eso una «reserva» es un pedido
//   normal disfrazado, y el cliente cree tener garantía cuando no la tiene.
// - **30 días de horizonte máximo.** Más allá el precio cotizado deja de
//   significar algo: cambian tarifas, zonas y quién trabaja ese día.
export const MINUTOS_MINIMOS_DE_ANTICIPACION = 30;
export const DIAS_MAXIMOS_DE_HORIZONTE = 30;

const MS_MINIMO = MINUTOS_MINIMOS_DE_ANTICIPACION * 60 * 1000;
const MS_MAXIMO = DIAS_MAXIMOS_DE_HORIZONTE * 24 * 60 * 60 * 1000;

/**
 * Valida un horario de reserva contra la ventana permitida.
 *
 * Devuelve un mensaje en lugar de lanzar porque los dos llamadores lo convierten
 * en un 400 con texto para la persona, y una excepción obligaría a cada uno a
 * traducirla — que es como se terminan escribiendo dos mensajes distintos para
 * el mismo rechazo.
 *
 * `ahora` se pasa para poder afirmar el borde exacto en una prueba. Sin eso, un
 * caso sobre «justo 30 minutos» depende de cuánto tardó en correr el test.
 */
export function validarHorarioProgramado(iso, ahora = Date.now()) {
  const instante = new Date(iso).getTime();
  if (!Number.isFinite(instante)) return "El horario de la reserva no es válido";
  if (instante < ahora + MS_MINIMO)
    return `La reserva debe hacerse con al menos ${MINUTOS_MINIMOS_DE_ANTICIPACION} minutos`;
  if (instante > ahora + MS_MAXIMO)
    return `Sólo puedes reservar hasta ${DIAS_MAXIMOS_DE_HORIZONTE} días antes`;
  return null;
}

/**
 * Estados desde los que todavía se puede mover un horario.
 *
 * **Después de que el comercio empieza a cocinar, reprogramar es tirar comida.**
 * Y con conductor asignado, es hacerle perder el viaje a alguien que ya se
 * comprometió. En los dos casos la salida correcta es cancelar —con su política
 * de cancelación— y no mover la hora como si no hubiera costado nada.
 */
export const ESTADOS_REPROGRAMABLES = ["requested", "accepted"];
