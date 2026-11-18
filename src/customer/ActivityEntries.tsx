import { useState, type ReactNode } from "react";
import { ListChecks, RotateCcw, Star } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { money } from "../format";
import { EmptyState } from "./EmptyState";

// Las piezas de la pantalla Actividad (FE-01), como la de Uber y PedidosYa: lo que
// está en curso arriba, con su avance y cómo seguirlo; lo anterior abajo, con
// fecha, total, calificación y «Volver a pedir».

export type Entrada = {
  id: string;
  icono: LucideIcon;
  imagen?: string;
  titulo: string;
  detalle: string;
  /** ISO. Algunos envíos viejos no la tienen. */
  fecha?: string;
  monto: number;
  estado: string;
  activo: boolean;
  cancelado: boolean;
  /** De 0 a 1 mientras está en curso. */
  avance: number;
  seguir?: { rotulo: string; accion: () => void };
  cancelar?: () => void;
  /** Sólo si terminó bien y todavía no se calificó. */
  calificar?: (estrellas: number) => void;
  volverAPedir?: () => void;
  extra?: ReactNode;
};

const fechaCorta = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
export const unidades = (n: number) => `${n} ${n === 1 ? "producto" : "productos"}`;

export function SinActividad({ pedidos }: { pedidos: boolean }) {
  return (
    <EmptyState
      icon={ListChecks}
      title={pedidos ? "Todavía no hiciste pedidos" : "Todavía no hay viajes"}
      text={
        pedidos
          ? "Tus pedidos van a aparecer acá, con su seguimiento."
          : "Tus viajes y envíos van a aparecer acá."
      }
    />
  );
}

export const fechaDe = (iso?: string) => (iso ? fechaCorta.format(new Date(iso)) : "");

function Miniatura({ entrada }: { entrada: Entrada }) {
  return entrada.imagen ? (
    <img className="activity-thumb" src={entrada.imagen} alt="" loading="lazy" />
  ) : (
    <span className="activity-thumb" aria-hidden="true">
      <entrada.icono size={22} />
    </span>
  );
}

/** Algo en curso: estado, barra de avance y cómo seguirlo o cancelarlo. */
export function TarjetaEnCurso({ entrada, busy }: { entrada: Entrada; busy: boolean }) {
  return (
    <article className="activity-live">
      <div className="activity-live-head">
        <Miniatura entrada={entrada} />
        <div>
          <small>{entrada.estado}</small>
          <strong>{entrada.titulo}</strong>
          <span>{entrada.detalle}</span>
        </div>
        <b>{money.format(entrada.monto)}</b>
      </div>
      <span
        className="home-live-bar activity-live-bar"
        role="progressbar"
        aria-label={`Avance: ${entrada.estado}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(entrada.avance * 100)}
      >
        <span style={{ width: `${Math.max(8, entrada.avance * 100)}%` }} />
      </span>
      {entrada.extra}
      <div className="activity-actions">
        {entrada.cancelar && (
          <button type="button" className="secondary" disabled={busy} onClick={entrada.cancelar}>
            Cancelar
          </button>
        )}
        {entrada.seguir && (
          <button type="button" disabled={busy} onClick={entrada.seguir.accion}>
            {entrada.seguir.rotulo}
          </button>
        )}
      </div>
    </article>
  );
}

/** Algo que ya terminó: fecha, total, estado y lo que se puede hacer después. */
export function FilaAnterior({ entrada, busy }: { entrada: Entrada; busy: boolean }) {
  return (
    <article className="activity-row">
      <Miniatura entrada={entrada} />
      <div className="activity-row-main">
        <strong>{entrada.titulo}</strong>
        <span>{[fechaDe(entrada.fecha), entrada.detalle].filter(Boolean).join(" · ")}</span>
        {(entrada.calificar || entrada.volverAPedir) && (
          <div className="activity-row-actions">
            {entrada.calificar && <Calificar onRate={entrada.calificar} disabled={busy} />}
            {entrada.volverAPedir && (
              <button type="button" disabled={busy} onClick={entrada.volverAPedir}>
                <RotateCcw size={15} /> Volver a pedir
              </button>
            )}
          </div>
        )}
      </div>
      <div className="activity-row-side">
        <b>{money.format(entrada.monto)}</b>
        <small className={entrada.cancelado ? "activity-chip cancelled" : "activity-chip"}>
          {entrada.estado}
        </small>
      </div>
    </article>
  );
}

/** De 1 a 5 estrellas: la persona elige, no se califica con 5 por ella. */
function Calificar({ onRate, disabled }: { onRate: (n: number) => void; disabled: boolean }) {
  const [hover, setHover] = useState(0);
  return (
    <div
      className="activity-rate"
      role="group"
      aria-label="Calificá"
      onMouseLeave={() => setHover(0)}
    >
      <span>Calificá</span>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`${n} de 5 estrellas`}
          disabled={disabled}
          onMouseEnter={() => setHover(n)}
          onFocus={() => setHover(n)}
          onClick={() => onRate(n)}
        >
          <Star size={18} fill={n <= hover ? "currentColor" : "none"} />
        </button>
      ))}
    </div>
  );
}
