// Home operativo del backoffice (ARC-001).
//
// KPIs, investor pulse, salud, zonas y grilla en vivo. Uber Ops concentra el
// “command center” fuera del shell de navegación; Flash adopta la frontera.

import { money } from "../format";
import { AdminKpi, AdminSectionHeader } from "../ui/panels";
import type { AdminDashboard, AppState, Order, Ride } from "../types";
import { WorkQueueBoard } from "./WorkQueueBoard";
import { AdminLiveGrid, InvestorPulse, MarketplaceHealth, ZoneBoard } from "./AdminOverviewBoards";

type RunAction = (action: () => Promise<unknown>, success: string) => void;

export function AdminOverviewHome({
  state,
  dashboard,
  grossVolume,
  platformRevenue,
  readinessScore,
  cancellationCount,
  activeOrders,
  activeRides,
  busy,
  runAction,
}: {
  state: AppState;
  dashboard: AdminDashboard | null;
  grossVolume: number;
  platformRevenue: number;
  readinessScore: number;
  cancellationCount: number;
  activeOrders: Order[];
  activeRides: Ride[];
  busy: boolean;
  runAction: RunAction;
}) {
  const marketplace = dashboard?.marketplace;

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
          detail={`${state.metrics.avgOrderEta}m ETA`}
          tone="orange"
        />
        <AdminKpi
          label="Viajes activos"
          value={state.metrics.activeRides}
          detail={`${state.metrics.avgRideEta}m pickup`}
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
          value={money.format(marketplace?.grossVolume ?? grossVolume)}
          detail={`Revenue posteado ${money.format(platformRevenue)}`}
          tone="dark"
        />
      </div>
      <section className="admin-card">
        <AdminSectionHeader title="Investor pulse" action={`${readinessScore}/100 readiness`} />
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
          <AdminSectionHeader title="Zonas calientes" action="Live" />
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
