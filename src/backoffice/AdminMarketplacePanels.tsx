// Paneles de marketplace del backoffice (ARC-001).
//
// Dispatch, comercios y supply de conductores. Salen de AdminConsole porque
// Uber Ops / DoorDash Drive aíslan el tablero de asignación del control de
// oferta; Flash adopta la misma frontera sin sumar superficie de producto.

import { AdminSectionHeader } from "../ui/panels";
import { api } from "../api";
import { initials } from "../format";
import type { AppState, Order, Ride } from "../types";
import { AdminLiveGrid } from "./AdminOverviewBoards";
import {
  DispatchManualAssignPanel,
  DispatchReleasePanel,
  MerchantSuspensionPanel,
} from "./OperationsInterventionPanel";
import { DriverCompliancePanel } from "./AdminTrustPanels";

type RunAction = (action: () => Promise<unknown>, success: string) => void;

export function AdminDispatchPanel({
  state,
  orders,
  rides,
  busy,
  runAction,
}: {
  state: AppState;
  orders: Order[];
  rides: Ride[];
  busy: boolean;
  runAction: RunAction;
}) {
  return (
    <>
      <section className="admin-card">
        <AdminSectionHeader title="Dispatch y asignaciones" action="Food + Taxi" />
        <AdminLiveGrid
          state={state}
          orders={orders}
          rides={rides}
          busy={busy}
          runAction={runAction}
        />
      </section>
      {/* La intervención va junto al tablero de dispatch y no en una
          sección propia: se usa mirando los pedidos que están trabados,
          no buscándola. */}
      <section className="admin-card">
        <AdminSectionHeader title="Soltar un servicio trabado" action="Vuelve al despacho" />
        <DispatchReleasePanel orders={orders} busy={busy} runAction={runAction} />
      </section>
      <section className="admin-card">
        <AdminSectionHeader title="Asignación manual" action="Cuando el auto-despacho no alcanza" />
        <DispatchManualAssignPanel
          orders={orders}
          drivers={state.drivers}
          busy={busy}
          runAction={runAction}
        />
      </section>
    </>
  );
}

export function AdminMerchantsPanel({
  restaurants,
  busy,
  runAction,
}: {
  restaurants: AppState["restaurants"];
  busy: boolean;
  runAction: RunAction;
}) {
  return (
    <>
      <section className="admin-card">
        <AdminSectionHeader
          title="Suspender ingreso de pedidos"
          action="No cancela lo que ya está en curso"
        />
        <MerchantSuspensionPanel restaurants={restaurants} busy={busy} runAction={runAction} />
      </section>
      <section className="admin-card">
        <AdminSectionHeader title="Comercios" action="Control operativo" />
        <div className="admin-table">
          {restaurants.map((restaurant) => (
            <article className="admin-row" key={restaurant.id}>
              <img src={restaurant.image} alt={restaurant.name} />
              <div>
                <strong>{restaurant.name}</strong>
                <span>
                  {restaurant.cuisine} · {restaurant.address}
                </span>
              </div>
              <b>{restaurant.open ? "Abierto" : "Pausado"}</b>
              <small>
                {restaurant.etaMin}m · {restaurant.menu.length} items
              </small>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  runAction(
                    () =>
                      api.updateRestaurant(restaurant.id, {
                        open: !restaurant.open,
                      }),
                    restaurant.open ? "Comercio pausado" : "Comercio abierto",
                  )
                }
              >
                {restaurant.open ? "Pausar" : "Abrir"}
              </button>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

export function AdminDriversSupplyPanel({
  drivers,
  busy,
  runAction,
}: {
  drivers: AppState["drivers"];
  busy: boolean;
  runAction: RunAction;
}) {
  return (
    <section className="admin-card">
      <AdminSectionHeader title="Conductores y repartidores" action="Supply" />
      <div className="admin-table">
        {drivers.map((driver) => (
          <article className="admin-row" key={driver.id}>
            <div className="avatar">{initials(driver.name)}</div>
            <div>
              <strong>{driver.name}</strong>
              <span>
                {driver.vehicle} · {driver.plate} · {driver.location.label}
              </span>
            </div>
            <b>{driver.online ? "Online" : "Offline"}</b>
            <small>
              {driver.activeService} · {driver.rating}
            </small>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                runAction(
                  () =>
                    api.updateDriver(driver.id, {
                      online: !driver.online,
                    }),
                  "Disponibilidad actualizada",
                )
              }
            >
              {driver.online ? "Pausar" : "Activar"}
            </button>
            <DriverCompliancePanel driverId={driver.id} busy={busy} runAction={runAction} />
          </article>
        ))}
      </div>
    </section>
  );
}
