// Home operativo del backoffice (ARC-001).
//
// KPIs, investor pulse, salud, zonas y grilla en vivo. Uber Ops concentra el
// “command center” fuera del shell de navegación; Flash adopta la frontera.

import { money } from "../format";
import { AdminKpi, AdminSectionHeader } from "../ui/panels";
import type { AdminDashboard, AppState, Order, Ride } from "../types";
import { WorkQueueBoard } from "./WorkQueueBoard";
import {
  AdminLiveGrid,
  InvestorPulse,
  MarketplaceHealth,
  ZoneBoard,
  grossVolumePeriod,
} from "./AdminOverviewBoards";

type RunAction = (action: () => Promise<unknown>, success: string) => void;

export function AdminOverviewHome({
  state,
  dashboard,
  grossVolume,
  platformRevenue,
  cancellationCount,
  activeOrders,
  activeRides,
  busy,
  runAction,
}: {
  state: AppState;
  dashboard: AdminDashboard | null;
  /** null sin tablero: no hay cifra que mostrar, y cada tarjeta lo dice. */
  grossVolume: number | null;
  platformRevenue: number | null;
  cancellationCount: number;
  activeOrders: Order[];
  activeRides: Ride[];
  busy: boolean;
  runAction: RunAction;
}) {
  return (
    <>
      {/* Primero de todo en la vista general: es la única pantalla que
          responde «¿hay algo acumulándose?» sin entrar a ocho secciones, y
          debajo de los KPI se leería después de lo que ya está bien. */}
      <WorkQueueBoard />
      <div className="admin-kpis">
        <AdminKpi
          label="Pedidos activos"
          value={state.metrics.activeOrders}
          // Sin nada activo el servidor devuelve 0, que no es un promedio.
          detail={
            state.metrics.activeOrders ? `${state.metrics.avgOrderEta}m ETA` : "Sin pedidos activos"
          }
          tone="orange"
        />
        <AdminKpi
          label="Viajes activos"
          value={state.metrics.activeRides}
          detail={
            state.metrics.activeRides ? `${state.metrics.avgRideEta}m pickup` : "Sin viajes activos"
          }
          tone="teal"
        />
        <AdminKpi
          label="Drivers online"
          value={state.metrics.onlineDrivers}
          detail={`${state.drivers.length} registrados`}
          tone="green"
        />
        <AdminKpi
          label="GMV registrado"
          // FE-04: sin tablero, «—» y no $0, que se leería como «no se vendió nada».
          value={grossVolume === null ? "—" : money.format(grossVolume)}
          detail={
            platformRevenue === null
              ? "Sin lectura del ledger"
              : `Revenue posteado ${money.format(platformRevenue)}`
          }
          tone="dark"
        />
      </div>
      <section className="admin-card">
        {/* Sin el puntaje de «readiness»: parte de una constante del servidor y no
            mide nada verificable (ver AdminInvestorPanels). */}
        <AdminSectionHeader
          title="Investor pulse"
          action={dashboard ? grossVolumePeriod(dashboard) : "Sin lectura"}
        />
        <InvestorPulse
          dashboard={dashboard}
          grossVolume={grossVolume}
          platformRevenue={platformRevenue}
        />
      </section>
      <div className="admin-grid two">
        <section className="admin-card">
          <AdminSectionHeader
            title="Salud del marketplace"
            action={`${state.restaurants.length} comercios`}
          />
          <MarketplaceHealth
            state={state}
            dashboard={dashboard}
            cancellationCount={cancellationCount}
          />
        </section>
        <section className="admin-card">
          <AdminSectionHeader title="Zonas de servicio" action="Pedidos y viajes en curso" />
          <ZoneBoard state={state} />
        </section>
      </div>
      <section className="admin-card">
        <AdminSectionHeader
          title="Actividad en vivo"
          action={`${activeOrders.length + activeRides.length} activos`}
        />
        <AdminLiveGrid
          state={state}
          orders={activeOrders}
          rides={activeRides}
          busy={busy}
          runAction={runAction}
        />
      </section>
    </>
  );
}
