// Palancas de demanda: promociones y multiplicadores de zona (ARC-001).
//
// `PATCH /api/promotions/:id` y `PATCH /api/zones/:id` estaban construidas y sin
// pantalla. Son las dos palancas con las que se corrige una operación en curso:
// pausar una promoción que está quemando plata, y subir o bajar el multiplicador
// de una zona sin demanda cubierta.
//
// **Las dos mueven dinero, y el diseño lo refleja.** Nada se aplica al escribir:
// se edita, se ve el valor anterior al lado, y se confirma. Un `onChange` que
// dispara el PATCH convierte un tecleo en un cambio de precio para todos los
// clientes de una zona.
//
// **Nota sobre `active` en zonas.** El PATCH lo acepta, pero `GET /api/zones` no
// lo devuelve: la consulta selecciona nombre, nivel de demanda y multiplicadores
// y nada más. Un interruptor acá podría apagar una zona sin poder mostrar nunca
// que quedó apagada, así que no se cablea hasta que la lectura lo exponga. Que
// el lado de escritura acepte un campo que el de lectura ignora es una asimetría
// del contrato, no una pantalla que falta.
import { useState } from "react";

import { api } from "../api";
import type { Promotion, Zone } from "../types";

type Accion = (accion: () => Promesa, exito: string) => void;
type Promesa = Promise<unknown>;

const NIVELES = ["low", "medium", "high"] as const;
const ETIQUETA_NIVEL: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
};

export function PromotionControlsPanel({
  promotions,
  runAction,
  busy,
}: {
  promotions: Promotion[];
  runAction: Accion;
  busy: boolean;
}) {
  if (promotions.length === 0) {
    return <p className="admin-empty">No hay promociones cargadas.</p>;
  }
  return (
    <ul className="demanda-promos">
      {promotions.map((promocion) => (
        <li key={promocion.id}>
          <div>
            <strong>{promocion.title}</strong>
            <p>
              {promocion.code ? <code>{promocion.code}</code> : null} {promocion.service}
              {promocion.kind ? ` · ${promocion.kind}` : ""}
            </p>
          </div>
          <button
            type="button"
            className={promocion.active ? "promo-activa" : "promo-pausada"}
            disabled={busy}
            onClick={() =>
              runAction(
                () => api.updatePromotion(promocion.id, { active: !promocion.active }),
                `${promocion.title} quedó ${promocion.active ? "pausada" : "activa"}`,
              )
            }
            aria-label={`${promocion.active ? "Pausar" : "Activar"} ${promocion.title}`}
          >
            {promocion.active ? "Activa" : "Pausada"}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ZoneDemandPanel({
  zones,
  runAction,
  busy,
}: {
  zones: Zone[];
  runAction: Accion;
  busy: boolean;
}) {
  // Un borrador por zona. Sin esto, cada tecla en un multiplicador sería un
  // cambio de precio confirmado.
  const [borrador, setBorrador] = useState<
    Record<string, { demandLevel: string; deliveryMultiplier: string; rideMultiplier: string }>
  >({});

  const editar = (zona: Zone, campo: string, valor: string) =>
    setBorrador((previo) => {
      // El borrador nace de los valores vigentes la primera vez que se toca la
      // zona, para que «cambiado» compare contra lo que hay y no contra vacío.
      const base = previo[zona.id] ?? {
        demandLevel: zona.demandLevel,
        deliveryMultiplier: String(zona.deliveryMultiplier),
        rideMultiplier: String(zona.rideMultiplier),
      };
      return { ...previo, [zona.id]: { ...base, [campo]: valor } };
    });

  if (zones.length === 0) return <p className="admin-empty">No hay zonas configuradas.</p>;

  return (
    <ul className="demanda-zonas">
      {zones.map((zona) => {
        const edicion = borrador[zona.id];
        const cambiado =
          edicion &&
          (edicion.demandLevel !== zona.demandLevel ||
            Number(edicion.deliveryMultiplier) !== zona.deliveryMultiplier ||
            Number(edicion.rideMultiplier) !== zona.rideMultiplier);
        return (
          <li key={zona.id}>
            <div className="zona-encabezado">
              <strong>{zona.name}</strong>
              <small>
                {zona.activeOrders} pedidos · {zona.activeRides} viajes
              </small>
            </div>
            <div className="zona-campos">
              <label>
                <span>Demanda</span>
                <select
                  value={edicion?.demandLevel ?? zona.demandLevel}
                  onChange={(evento) => editar(zona, "demandLevel", evento.target.value)}
                >
                  {NIVELES.map((nivel) => (
                    <option key={nivel} value={nivel}>
                      {ETIQUETA_NIVEL[nivel]}
                    </option>
                  ))}
                </select>
              </label>
              {(
                [
                  ["deliveryMultiplier", "Delivery", zona.deliveryMultiplier],
                  ["rideMultiplier", "Viajes", zona.rideMultiplier],
                ] as const
              ).map(([campo, etiqueta, actual]) => (
                <label key={campo}>
                  <span>
                    {etiqueta} <small>(hoy {actual})</small>
                  </span>
                  <input
                    type="number"
                    min={0.5}
                    max={3}
                    step={0.05}
                    value={edicion?.[campo] ?? String(actual)}
                    onChange={(evento) => editar(zona, campo, evento.target.value)}
                  />
                </label>
              ))}
            </div>
            <button
              type="button"
              disabled={busy || !cambiado}
              onClick={() =>
                runAction(
                  () =>
                    api.updateZone(zona.id, {
                      demandLevel: edicion.demandLevel as Zone["demandLevel"],
                      deliveryMultiplier: Number(edicion.deliveryMultiplier),
                      rideMultiplier: Number(edicion.rideMultiplier),
                    }),
                  `${zona.name} actualizada`,
                )
              }
            >
              {cambiado ? "Aplicar cambios" : "Sin cambios"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
