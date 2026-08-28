// Pedidos grupales (ticket GTM-001, cuarto hueco comercial).
//
// Uber Eats, DoorDash y Rappi los tienen, y Flash los anunciaba en la portada
// —«Grupal · Pedido compartido»— sin que existiera nada detrás. Esa promesa se
// retiró al construir la suscripción; esta pantalla la vuelve cierta.
//
// **Cada persona ve lo que pidió cada una, y el anfitrión ve el total.** Esa
// transparencia es la función: en un pedido de oficina, lo que se discute
// después no es la comida, es quién pidió qué y cuánto salió.
//
// El grupo confirmado se vuelve un pedido normal. Esta pantalla junta los ítems
// y **delega en el checkout de siempre**, en vez de tener su propio camino de
// confirmación: un segundo checkout significaría dos versiones de la cotización
// firmada, la propina, el horario y el riesgo.
import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import { money } from "../format";
import type { CartLine, GroupOrder } from "../types";

const ETIQUETA_ESTADO: Record<GroupOrder["status"], string> = {
  open: "Abierto",
  locked: "Cerrado para sumar",
  placed: "Pedido confirmado",
  cancelled: "Cancelado",
};

export function GroupOrderPanel({
  restaurantId,
  cart,
  userId,
  onCheckoutGroup,
  busy,
}: {
  /** Restaurante abierto, si lo hay: es desde donde se puede abrir un grupo. */
  restaurantId: string | null;
  /** Carrito propio, para poder volcarlo al grupo sin volver a elegir todo. */
  cart: CartLine[];
  userId: string | null;
  /** Confirma el grupo por el checkout normal. */
  onCheckoutGroup: (group: GroupOrder) => void;
  busy: boolean;
}) {
  const [groups, setGroups] = useState<GroupOrder[]>([]);
  const [codigo, setCodigo] = useState("");
  const [tope, setTope] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setGroups((await api.getGroupOrders()).groups);
      setError("");
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudieron cargar los grupos");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const ejecutar = async (accion: () => Promise<unknown>) => {
    setOcupado(true);
    setError("");
    try {
      await accion();
      await cargar();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo completar la operación");
    } finally {
      setOcupado(false);
    }
  };

  const bloqueado = busy || ocupado;

  return (
    <section className="grupo-panel">
      <header>
        <h3>Pedido grupal</h3>
        <small>Cada uno agrega lo suyo y una sola persona paga.</small>
      </header>

      <div className="grupo-acciones">
        {restaurantId && (
          <div className="grupo-abrir">
            <label>
              <span>
                Tope por persona <small>(opcional)</small>
              </span>
              <input
                type="number"
                min={100}
                step={100}
                placeholder="Sin tope"
                value={tope}
                disabled={bloqueado}
                onChange={(evento) => setTope(evento.target.value)}
              />
            </label>
            <button
              type="button"
              className="primary-button"
              disabled={bloqueado}
              onClick={() =>
                ejecutar(() =>
                  api.createGroupOrder({
                    restaurantId,
                    // El tope viaja en centavos, como el resto del dinero.
                    spendLimitCents: Number(tope) > 0 ? Math.round(Number(tope) * 100) : undefined,
                  }),
                )
              }
            >
              Abrir grupo acá
            </button>
          </div>
        )}
        <div className="grupo-sumarse">
          <label>
            <span>Sumarme con un código</span>
            <input
              type="text"
              maxLength={6}
              placeholder="ABC123"
              value={codigo}
              disabled={bloqueado}
              // Se normaliza a mayúsculas al escribir: el código se dicta en voz
              // alta y se escribe como salga, y rechazarlo por eso sería inútil.
              onChange={(evento) => setCodigo(evento.target.value.toUpperCase())}
            />
          </label>
          <button
            type="button"
            disabled={bloqueado || codigo.length !== 6}
            onClick={() => ejecutar(async () => (await api.joinGroupOrder(codigo), setCodigo("")))}
          >
            Sumarme
          </button>
        </div>
      </div>

      {error && <p className="grupo-error">{error}</p>}
      {groups.length === 0 && <p className="admin-empty">No tenés pedidos grupales abiertos.</p>}

      {groups.map((group) => {
        const soyAnfitrion = group.hostId === userId;
        const miParte = group.participants.find((persona) => persona.userId === userId);
        return (
          <article key={group.id} className="grupo-tarjeta">
            <div className="grupo-encabezado">
              <div>
                <strong>{group.restaurantName}</strong>
                <small>
                  {ETIQUETA_ESTADO[group.status]} · {group.participants.length} personas
                  {group.spendLimit !== null && ` · tope ${money.format(group.spendLimit)}`}
                </small>
              </div>
              {/* El código se muestra sólo mientras se pueda usar: seguir
                  mostrándolo en un grupo cerrado invita a compartirlo y a que
                  alguien reciba un «ya está cerrado» sin entender por qué. */}
              {group.status === "open" && <code className="grupo-codigo">{group.joinCode}</code>}
            </div>

            <ul className="grupo-participantes">
              {group.participants.map((persona) => (
                <li key={persona.userId}>
                  <div>
                    <strong>
                      {persona.name}
                      {persona.isHost && <span className="grupo-anfitrion"> anfitrión</span>}
                    </strong>
                    {/* Quien todavía no eligió se muestra igual: en una oficina,
                        saber quién falta es la mitad de la utilidad. */}
                    <small>
                      {persona.items.length === 0
                        ? "Todavía no eligió"
                        : persona.items.map((item) => `${item.quantity}× ${item.name}`).join(" · ")}
                    </small>
                  </div>
                  <span>{money.format(persona.subtotal)}</span>
                </li>
              ))}
            </ul>

            <div className="grupo-total">
              <span>Total del grupo</span>
              <strong>{money.format(group.subtotal)}</strong>
            </div>

            {group.status === "open" && (
              <div className="grupo-controles">
                {/* Volcar el carrito propio en vez de re-elegir: quien ya armó su
                    pedido no debería tener que rehacerlo para compartirlo. */}
                <button
                  type="button"
                  disabled={bloqueado || cart.length === 0}
                  onClick={() =>
                    ejecutar(() =>
                      api.setGroupOrderItems(
                        group.id,
                        cart.map((linea) => ({
                          menuItemId: linea.item.id,
                          quantity: linea.quantity,
                          extras: linea.extras,
                          note: linea.note,
                        })),
                      ),
                    )
                  }
                >
                  {miParte?.items.length ? "Reemplazar mi parte" : "Poner mi carrito"}
                </button>
                {!!miParte?.items.length && (
                  <button
                    type="button"
                    disabled={bloqueado}
                    onClick={() => ejecutar(() => api.setGroupOrderItems(group.id, []))}
                  >
                    Sacar mi parte
                  </button>
                )}
                {soyAnfitrion && (
                  <button
                    type="button"
                    className="primary-button"
                    disabled={bloqueado || group.subtotal === 0}
                    onClick={() => ejecutar(() => api.setGroupOrderStatus(group.id, "locked"))}
                  >
                    Cerrar y revisar
                  </button>
                )}
              </div>
            )}

            {group.status === "locked" && soyAnfitrion && (
              <div className="grupo-controles">
                <button
                  type="button"
                  disabled={bloqueado}
                  onClick={() => ejecutar(() => api.setGroupOrderStatus(group.id, "open"))}
                >
                  Reabrir
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={bloqueado}
                  onClick={() => onCheckoutGroup(group)}
                >
                  Confirmar y pagar
                </button>
              </div>
            )}
            {group.status === "locked" && !soyAnfitrion && (
              <p className="grupo-espera">
                {group.hostName} está por confirmar. Ya no se pueden sumar productos.
              </p>
            )}
            {group.status === "open" && soyAnfitrion && (
              <button
                type="button"
                className="grupo-cancelar"
                disabled={bloqueado}
                onClick={() => ejecutar(() => api.setGroupOrderStatus(group.id, "cancelled"))}
              >
                Cancelar grupo
              </button>
            )}
          </article>
        );
      })}
    </section>
  );
}
