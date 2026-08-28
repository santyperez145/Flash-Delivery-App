// Las dos intervenciones que antes exigían entrar a la base (ticket OPS-001).
//
// El criterio dice «ningún incidente requiere ejecutar SQL manual». Al
// inventariar qué puede hacer un operador quedaron dos huecos, y los dos son la
// llamada de las dos de la mañana: suspender un comercio, y soltar un pedido de
// un conductor que se cayó.
//
// **Las dos piden un motivo antes de habilitar el botón.** No es burocracia: son
// decisiones sobre el registro de un tercero, y el día que alguien reclame, lo
// que se lee es el log de auditoría. Un log que dice quién suspendió a quién sin
// decir por qué obliga a reconstruir el motivo desde una tabla que pudo cambiar
// después.
import { useState } from "react";

import { api } from "../api";
import type { Order, Restaurant } from "../types";

// Un servicio se puede soltar sólo antes de que el conductor lo retire. Después
// tiene la comida encima, y ahí la salida es cancelar o abrir una incidencia:
// ofrecer el botón igual sería prometer un 409.
const SOLTABLES = ["courier_assigned", "arriving"];

function CampoMotivo({
  valor,
  onChange,
  disabled,
  etiqueta,
}: {
  valor: string;
  onChange: (valor: string) => void;
  disabled: boolean;
  etiqueta: string;
}) {
  return (
    <label className="intervencion-motivo">
      <span>{etiqueta}</span>
      <input
        type="text"
        value={valor}
        disabled={disabled}
        placeholder="Al menos cinco caracteres"
        onChange={(evento) => onChange(evento.target.value)}
      />
    </label>
  );
}

/**
 * Suspender o reactivar un comercio.
 *
 * Suspender frena los pedidos nuevos y **no cancela los que están en curso**. La
 * respuesta dice cuántos quedaron abiertos, y eso se muestra: con doce hay que
 * avisarle a soporte, con cero no hay nada más que hacer.
 */
export function MerchantSuspensionPanel({
  restaurants,
  busy,
  runAction,
}: {
  restaurants: Restaurant[];
  busy: boolean;
  runAction: (accion: () => Promise<unknown>, exito: string) => void;
}) {
  const [motivos, setMotivos] = useState<Record<string, string>>({});
  const [suspendidos, setSuspendidos] = useState<Record<string, boolean>>({});

  const cambiar = (restaurante: Restaurant, suspender: boolean) => {
    const motivo = motivos[restaurante.id]?.trim() || "";
    runAction(
      async () => {
        const resultado = await api.setMerchantStatus(
          restaurante.id,
          suspender ? "suspended" : "active",
          motivo,
        );
        setSuspendidos((previo) => ({ ...previo, [restaurante.id]: suspender }));
        setMotivos((previo) => ({ ...previo, [restaurante.id]: "" }));
        return resultado;
      },
      suspender ? `${restaurante.name} suspendido` : `${restaurante.name} reactivado`,
    );
  };

  if (restaurants.length === 0)
    return <p className="admin-empty">No hay comercios para intervenir.</p>;

  return (
    <ul className="intervencion-lista">
      {restaurants.map((restaurante) => {
        const suspendido = suspendidos[restaurante.id] === true;
        const motivo = motivos[restaurante.id] ?? "";
        return (
          <li key={restaurante.id}>
            <div className="intervencion-encabezado">
              <strong>{restaurante.name}</strong>
              <small>{suspendido ? "Suspendido en esta sesión" : restaurante.cuisine}</small>
            </div>
            <CampoMotivo
              etiqueta="Motivo"
              valor={motivo}
              disabled={busy}
              onChange={(valor) => setMotivos((previo) => ({ ...previo, [restaurante.id]: valor }))}
            />
            <button
              type="button"
              className={suspendido ? "" : "intervencion-peligro"}
              // El servidor exige cinco caracteres. Habilitar el botón antes
              // sería ofrecer una acción que devuelve 400.
              disabled={busy || motivo.trim().length < 5}
              onClick={() => cambiar(restaurante, !suspendido)}
            >
              {suspendido ? "Reactivar" : "Suspender ingreso de pedidos"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Soltar un servicio asignado y devolverlo al despacho.
 *
 * Sólo aparece para los que todavía no se retiraron. Un pedido ya levantado no
 * se «suelta»: se cancela o se abre una incidencia, que son caminos distintos
 * con consecuencias distintas para el cliente.
 */
export function DispatchReleasePanel({
  orders,
  busy,
  runAction,
}: {
  orders: Order[];
  busy: boolean;
  runAction: (accion: () => Promise<unknown>, exito: string) => void;
}) {
  const [motivos, setMotivos] = useState<Record<string, string>>({});
  const soltables = orders.filter(
    (pedido) => pedido.courierId && SOLTABLES.includes(pedido.status),
  );

  if (soltables.length === 0)
    return (
      <p className="admin-empty">
        No hay servicios asignados sin retirar. Un pedido ya levantado se cancela o se reclama, no
        se suelta.
      </p>
    );

  return (
    <ul className="intervencion-lista">
      {soltables.map((pedido) => {
        const motivo = motivos[pedido.id] ?? "";
        return (
          <li key={pedido.id}>
            <div className="intervencion-encabezado">
              <strong>{pedido.id}</strong>
              <small>
                {pedido.courierId} · {pedido.deliveryAddress}
              </small>
            </div>
            <CampoMotivo
              etiqueta="Qué pasó"
              valor={motivo}
              disabled={busy}
              onChange={(valor) => setMotivos((previo) => ({ ...previo, [pedido.id]: valor }))}
            />
            <button
              type="button"
              className="intervencion-peligro"
              disabled={busy || motivo.trim().length < 5}
              onClick={() =>
                runAction(async () => {
                  const resultado = await api.releaseJob(pedido.id, motivo.trim());
                  setMotivos((previo) => ({ ...previo, [pedido.id]: "" }));
                  return resultado;
                }, `${pedido.id} volvió al despacho`)
              }
            >
              Soltar y volver a ofrecer
            </button>
          </li>
        );
      })}
    </ul>
  );
}
