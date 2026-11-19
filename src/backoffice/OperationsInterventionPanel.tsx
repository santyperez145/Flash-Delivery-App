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
import { Store } from "lucide-react";
import { useState } from "react";

import { api } from "../api";
import "../styles/merchant-onboarding.css";
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

/** Lo que operaciones necesita saber de un comercio para decidir qué hacer con él. */
type EstadoComercio = {
  tipo: "activo" | "pausado" | "suspendido";
  titulo: string;
  detalle: string;
};

const fechaCorta = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * El estado real de un comercio, leído del servidor y nada más (FE-05).
 *
 * Antes la fila mostraba una suspensión guardada sólo en el navegador: un recuerdo
 * que se perdía al recargar y que nunca veía otro operador. Ahora la suspensión
 * sale de `status` y la pausa del interruptor del local, que son las dos cosas
 * que de verdad frenan los pedidos.
 *
 * La pausa no se atribuye a nadie: el interruptor «Aceptar pedidos» es uno solo,
 * lo pueden apagar el local u operaciones, y el listado no dice quién fue.
 */
function estadoDe(restaurante: Restaurant): EstadoComercio {
  if (restaurante.status === "suspended") {
    const partes = [
      restaurante.suspensionReason,
      restaurante.suspendedAt ? fechaCorta.format(new Date(restaurante.suspendedAt)) : null,
    ].filter(Boolean);
    return {
      tipo: "suspendido",
      titulo: "Suspendido por operaciones",
      // El servidor los lee del evento de auditoría de la suspensión; si no hay
      // evento (una suspensión cargada a mano antes de OPS-001), llegan los dos en
      // null y se dice eso, en lugar de inventar un texto o mandar a buscar a un
      // registro donde tampoco están.
      detalle: partes.length ? partes.join(" · ") : "Sin motivo ni fecha registrados",
    };
  }
  if ((restaurante.manualOpen ?? restaurante.open) === false)
    return { tipo: "pausado", titulo: "Pausado", detalle: "«Aceptar pedidos» está apagado" };
  return {
    tipo: "activo",
    titulo: "Activo",
    detalle: restaurante.open ? "Abierto ahora" : "Fuera de horario o sin horarios cargados",
  };
}

type AccionConMotivo = { id: string; tipo: "suspender" | "levantar" };

/**
 * Una fila por comercio con su estado real y un único menú de acciones.
 *
 * Antes había dos listas del mismo comercio: una para suspender y otra con un
 * botón de pausa, cada una con su propia idea del estado. Ahora es una fila y
 * las acciones dependen de lo que el comercio está haciendo:
 *
 * - **Pausar / Reactivar** apagan o prenden «Aceptar pedidos», el mismo
 *   interruptor que el local tiene en su consola. No pide motivo: el local lo
 *   puede volver a prender.
 * - **Suspender** frena los pedidos nuevos y **no cancela los que están en
 *   curso**; levantar la suspensión también pide motivo. Son decisiones sobre
 *   el registro de un tercero, y el día que alguien reclame lo que se lee es el
 *   log de auditoría.
 */
export function MerchantOperationsList({
  restaurants,
  busy,
  runAction,
}: {
  restaurants: Restaurant[];
  busy: boolean;
  runAction: (accion: () => Promise<unknown>, exito: string) => void;
}) {
  const [menuAbierto, setMenuAbierto] = useState<string | null>(null);
  const [accion, setAccion] = useState<AccionConMotivo | null>(null);
  const [motivo, setMotivo] = useState("");
  // Lo que devolvió el servidor al suspender: cuántos pedidos quedaron en
  // curso. Con doce hay que avisarle a soporte, con cero no hay nada más que hacer.
  const [avisos, setAvisos] = useState<Record<string, string>>({});

  const cerrar = () => {
    setMenuAbierto(null);
    setAccion(null);
    setMotivo("");
  };

  const cambiarInterruptor = (restaurante: Restaurant, abrir: boolean) => {
    cerrar();
    runAction(
      () => api.updateRestaurant(restaurante.id, { open: abrir }),
      abrir ? `${restaurante.name} vuelve a aceptar pedidos` : `${restaurante.name} pausado`,
    );
  };

  const confirmarConMotivo = (restaurante: Restaurant, tipo: AccionConMotivo["tipo"]) => {
    const texto = motivo.trim();
    cerrar();
    runAction(
      async () => {
        const resultado = await api.setMerchantStatus(
          restaurante.id,
          tipo === "suspender" ? "suspended" : "active",
          texto,
        );
        const enCurso = resultado.merchant.openJobs;
        setAvisos((previo) => ({
          ...previo,
          [restaurante.id]:
            tipo === "suspender"
              ? enCurso > 0
                ? `Quedaron ${enCurso} pedido${enCurso === 1 ? "" : "s"} en curso: siguen hasta terminar.`
                : "No quedó ningún pedido en curso."
              : "",
        }));
        return resultado;
      },
      tipo === "suspender"
        ? `${restaurante.name} suspendido`
        : `${restaurante.name} vuelve a estar activo`,
    );
  };

  if (restaurants.length === 0)
    return (
      <p className="admin-empty">
        Todavía no hay comercios. Aparecen acá cuando se aprueba un alta en Altas.
      </p>
    );

  return (
    <ul className="comercios-lista">
      {restaurants.map((restaurante) => {
        const estado = estadoDe(restaurante);
        const menuId = `comercio-menu-${restaurante.id}`;
        const abierto = menuAbierto === restaurante.id;
        const pidiendoMotivo = accion?.id === restaurante.id ? accion.tipo : null;
        const aviso = avisos[restaurante.id];
        const productos = restaurante.menu.length;
        return (
          <li key={restaurante.id} className="comercio-fila">
            {restaurante.image ? (
              <img className="comercio-foto" src={restaurante.image} alt="" />
            ) : (
              <span className="comercio-foto-vacia" aria-hidden="true">
                <Store size={18} />
              </span>
            )}
            <div className="comercio-datos">
              <strong>{restaurante.name}</strong>
              <small>
                {[restaurante.cuisine, restaurante.address].filter(Boolean).join(" · ")}
              </small>
              <span className={`comercio-estado ${estado.tipo}`}>{estado.titulo}</span>
              <small>
                {estado.detalle} · {productos} producto{productos === 1 ? "" : "s"}
              </small>
              {aviso && <small role="status">{aviso}</small>}
            </div>
            <div className="comercio-menu">
              {pidiendoMotivo ? (
                <form
                  className="comercio-confirmar"
                  onSubmit={(evento) => {
                    evento.preventDefault();
                    if (motivo.trim().length >= 5) confirmarConMotivo(restaurante, pidiendoMotivo);
                  }}
                >
                  <p>
                    {pidiendoMotivo === "suspender"
                      ? "Frena los pedidos nuevos y no cancela los que están en curso. Le avisamos al local con el motivo."
                      : "El local vuelve al catálogo y puede recibir pedidos. Le avisamos con el motivo."}
                  </p>
                  <CampoMotivo
                    etiqueta={pidiendoMotivo === "suspender" ? "Motivo de la suspensión" : "Motivo"}
                    valor={motivo}
                    disabled={busy}
                    onChange={setMotivo}
                  />
                  <div>
                    <button
                      type="submit"
                      className={pidiendoMotivo === "suspender" ? "intervencion-peligro" : ""}
                      // El servidor exige cinco caracteres. Habilitar el botón antes
                      // sería ofrecer una acción que devuelve 400.
                      disabled={busy || motivo.trim().length < 5}
                    >
                      {pidiendoMotivo === "suspender" ? "Confirmar suspensión" : "Reactivar"}
                    </button>
                    <button type="button" onClick={cerrar}>
                      Cancelar
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    aria-expanded={abierto}
                    aria-controls={menuId}
                    aria-label={`Acciones para ${restaurante.name}`}
                    disabled={busy}
                    onClick={() => {
                      setAccion(null);
                      setMotivo("");
                      setMenuAbierto(abierto ? null : restaurante.id);
                    }}
                  >
                    Acciones
                  </button>
                  {abierto && (
                    <ul className="comercio-opciones" id={menuId}>
                      {estado.tipo === "activo" && (
                        <li>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => cambiarInterruptor(restaurante, false)}
                          >
                            Pausar
                          </button>
                        </li>
                      )}
                      {estado.tipo === "pausado" && (
                        <li>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => cambiarInterruptor(restaurante, true)}
                          >
                            Reactivar
                          </button>
                        </li>
                      )}
                      {estado.tipo === "suspendido" ? (
                        <li>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setAccion({ id: restaurante.id, tipo: "levantar" })}
                          >
                            Reactivar
                          </button>
                        </li>
                      ) : (
                        <li>
                          <button
                            type="button"
                            className="intervencion-peligro"
                            disabled={busy}
                            onClick={() => setAccion({ id: restaurante.id, tipo: "suspender" })}
                          >
                            Suspender
                          </button>
                        </li>
                      )}
                    </ul>
                  )}
                </>
              )}
            </div>
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
