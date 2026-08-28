// Reservar y mover el horario de un servicio (ticket GTM-001, tercer hueco).
//
// La portada prometía «Programar — Food o taxi» y **sólo los viajes sabían
// reservar**: un pedido de comida no se podía programar en absoluto. Y nada, ni
// viaje ni pedido, se podía mover de hora: la única salida era cancelar y volver
// a pedir, que además le cuenta la cancelación al cliente.
//
// **Un solo componente para reservar y para reprogramar.** Son la misma decisión
// tomada en dos momentos, y separarlos daría dos calendarios con dos reglas de
// qué horario es válido — que es exactamente cómo el servidor terminó con dos
// copias de la ventana de reserva.
import { useState } from "react";

// Las mismas cotas que aplica `server/scheduling.js`. Se duplican para no
// ofrecer un horario que el confirmar va a rechazar; el que manda es el
// servidor, y hay una puerta que vigila que estos dos números coincidan.
const MINUTOS_MINIMOS = 30;
const DIAS_MAXIMOS = 30;

/** `datetime-local` quiere hora local sin zona, y `toISOString` da UTC. Convertir
 *  mal acá adelanta o atrasa la reserva tres horas sin que nada falle. */
const aLocalInput = (fecha: Date) => {
  const local = new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

const limites = () => {
  const ahora = Date.now();
  return {
    min: aLocalInput(new Date(ahora + MINUTOS_MINIMOS * 60000)),
    max: aLocalInput(new Date(ahora + DIAS_MAXIMOS * 24 * 60 * 60000)),
  };
};

export const formatearHorario = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Elegir horario al crear el pedido.
 *
 * Arranca en «lo antes posible» y no en un calendario: la enorme mayoría de los
 * pedidos son para ahora, y abrir con un selector de fecha convierte el camino
 * normal en dos toques de más.
 */
export function SchedulePicker({
  scheduledFor,
  onChange,
  disabled,
}: {
  scheduledFor: string | null;
  onChange: (iso: string | null) => void;
  disabled: boolean;
}) {
  const { min, max } = limites();
  return (
    <section className="programar-selector">
      <div className="programar-opciones">
        <button
          type="button"
          className={scheduledFor ? "programar-opcion" : "programar-opcion activa"}
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          Lo antes posible
        </button>
        <button
          type="button"
          className={scheduledFor ? "programar-opcion activa" : "programar-opcion"}
          disabled={disabled}
          // Al pasar a «programar» se propone el primer horario válido en vez de
          // dejar el campo vacío: un campo vacío obliga a elegir día y hora desde
          // cero para algo que casi siempre es «hoy, un poco más tarde».
          onClick={() => onChange(new Date(Date.now() + MINUTOS_MINIMOS * 60000).toISOString())}
        >
          Programar
        </button>
      </div>
      {scheduledFor && (
        <label className="programar-campo">
          <span>Horario</span>
          <input
            type="datetime-local"
            min={min}
            max={max}
            disabled={disabled}
            value={aLocalInput(new Date(scheduledFor))}
            onChange={(evento) => {
              const elegido = new Date(evento.target.value);
              if (Number.isNaN(elegido.getTime())) return;
              onChange(elegido.toISOString());
            }}
          />
        </label>
      )}
      {scheduledFor && (
        <p className="programar-nota">
          Reservás para {formatearHorario(scheduledFor)}. Podés moverlo hasta que el comercio
          empiece a prepararlo.
        </p>
      )}
    </section>
  );
}

/**
 * Mover el horario de algo ya reservado.
 *
 * Va detrás de un botón y no siempre abierto: en la lista de actividad la acción
 * frecuente es seguir el pedido, no cambiarlo de hora, y un calendario abierto
 * en cada tarjeta empuja el resto de la información fuera de la pantalla.
 */
export function RescheduleControl({
  scheduledFor,
  onReschedule,
  disabled,
}: {
  scheduledFor: string;
  onReschedule: (iso: string) => void;
  disabled: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [borrador, setBorrador] = useState(scheduledFor);
  const { min, max } = limites();
  if (!abierto)
    return (
      <button
        type="button"
        className="reprogramar-abrir"
        disabled={disabled}
        onClick={() => {
          setBorrador(scheduledFor);
          setAbierto(true);
        }}
      >
        Reprogramar · {formatearHorario(scheduledFor)}
      </button>
    );
  return (
    <div className="reprogramar-panel">
      <input
        type="datetime-local"
        min={min}
        max={max}
        disabled={disabled}
        value={aLocalInput(new Date(borrador))}
        onChange={(evento) => {
          const elegido = new Date(evento.target.value);
          if (!Number.isNaN(elegido.getTime())) setBorrador(elegido.toISOString());
        }}
      />
      <div className="reprogramar-acciones">
        <button type="button" disabled={disabled} onClick={() => setAbierto(false)}>
          Cancelar
        </button>
        <button
          type="button"
          className="primary-button"
          // Nada se manda mientras se escribe: mover una reserva es un cambio
          // que el comercio ve, y confirmarlo por tecla lo dispararía en cada
          // dígito de la hora.
          disabled={disabled || borrador === scheduledFor}
          onClick={() => {
            onReschedule(borrador);
            setAbierto(false);
          }}
        >
          Confirmar horario
        </button>
      </div>
    </div>
  );
}
