// Riel contextual del phone-stage (ARC-001).
//
// Comparte forma entre audiencias, no dominio. Cada modo sólo muestra el
// contexto que le pertenece: carrito, cuenta comercio, ganancia o tickets.
import { Bike, LocateFixed, ShieldCheck, Store, UserRound } from "lucide-react";

import { api } from "../api";
import { money } from "../format";
import { Metric } from "../ui/panels";
import type { AppState, Mode, User } from "../types";
import { MiniOrder, MiniRide, PanelHeader } from "./ops-primitives";

export function OpsRail({
  mode,
  state,
  user,
  cartCount,
  cartTotal,
  busy,
  runAction,
}: {
  mode: Mode;
  state: AppState;
  user: User | null;
  cartCount: number;
  cartTotal: number;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const driver = state.drivers.find((entry) => entry.userId === user?.id);
  const merchantRestaurantId = user?.restaurantId || state.restaurants[0]?.id;
  const activeOrder = state.orders.find(
    (order) => !["delivered", "cancelled"].includes(order.status),
  );
  const activeRide = state.rides.find((ride) => !["completed", "cancelled"].includes(ride.status));
  return (
    <aside className="ops-panel">
      <PanelHeader
        title={
          mode === "customer"
            ? "Cliente"
            : mode === "merchant"
              ? "Comercio"
              : mode === "driver"
                ? "Driver"
                : "Ops"
        }
        icon={
          mode === "customer"
            ? UserRound
            : mode === "merchant"
              ? Store
              : mode === "driver"
                ? Bike
                : ShieldCheck
        }
      />
      {mode === "customer" && (
        <>
          <div className="ops-card highlight">
            <span>Carrito actual</span>
            <strong>{cartCount} items</strong>
            <p>{cartCount ? money.format(cartTotal) : "Listo para pedir comida o taxi"}</p>
          </div>
          {activeOrder && <MiniOrder state={state} order={activeOrder} />}
          {activeRide && <MiniRide state={state} ride={activeRide} />}
        </>
      )}
      {mode === "merchant" && (
        <>
          <div className="ops-card">
            <span>Cuenta</span>
            <strong>{user?.name}</strong>
            <p>
              {state.orders.filter((order) => order.restaurantId === merchantRestaurantId).length}{" "}
              pedidos historicos
            </p>
          </div>
          {state.orders
            .filter((order) => order.restaurantId === merchantRestaurantId)
            .slice(0, 3)
            .map((order) => (
              <MiniOrder key={order.id} state={state} order={order} />
            ))}
        </>
      )}
      {mode === "driver" && driver && (
        <>
          <div className="ops-card highlight">
            <span>Ganancia hoy</span>
            <strong>{money.format(driver.earningsToday)}</strong>
            <p>
              {driver.online ? "Online" : "Fuera de linea"} · {driver.vehicle}
            </p>
          </div>
          <button
            className="rail-action"
            type="button"
            disabled={busy}
            onClick={() =>
              runAction(
                () => api.updateDriver(driver.id, { online: !driver.online }),
                "Disponibilidad actualizada",
              )
            }
          >
            <LocateFixed size={16} /> {driver.online ? "Pausar" : "Activar"}
          </button>
        </>
      )}
      {mode === "ops" && (
        <>
          <div className="capacity-grid">
            <Metric
              label="Facturado"
              value={money.format(state.metrics.completedRevenue)}
              trend="completado"
            />
            <Metric label="Tickets" value={String(state.metrics.openTickets)} trend="soporte" />
          </div>
          {state.supportTickets.map((ticket) => (
            <article className="ops-card" key={ticket.id}>
              <span>
                {ticket.priority} ·{" "}
                {ticket.slaStatus === "on_track" ? "en SLA" : ticket.slaStatus.replaceAll("_", " ")}
              </span>
              <strong>{ticket.title}</strong>
              <p>
                {ticket.service} · {ticket.status}
              </p>
            </article>
          ))}
        </>
      )}
    </aside>
  );
}
