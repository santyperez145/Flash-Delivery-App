// Tableros de inversión del backoffice (ARC-001).
//
// Cifras del ledger, unit economics, funnel y riesgos. Uber Investor /
// dashboards de seed aíslan esta lectura del shell operativo.
//
// Sólo se muestra lo que el tablero calcula sobre datos registrados. Quedaron
// afuera el puntaje de «readiness» (parte de una constante del servidor) y la
// lista de hitos (una hoja de ruta escrita a mano, no un estado): los dos se
// leían como medición y no lo eran.

import { AdminSectionHeader } from "../ui/panels";
import type { AdminDashboard, AppState } from "../types";
import {
  GrowthFunnel,
  InvestorPulse,
  RiskSignalBoard,
  UnitEconomicsBoard,
  grossVolumePeriod,
} from "./AdminOverviewBoards";

export function AdminInvestorPanels({
  state,
  dashboard,
  grossVolume,
  platformRevenue,
}: {
  state: AppState;
  dashboard: AdminDashboard | null;
  grossVolume: number | null;
  platformRevenue: number | null;
}) {
  return (
    <div className="admin-grid">
      <section className="admin-card">
        <AdminSectionHeader
          title="Cifras del ledger"
          action={dashboard ? grossVolumePeriod(dashboard) : "Sin lectura"}
        />
        <InvestorPulse
          dashboard={dashboard}
          grossVolume={grossVolume}
          platformRevenue={platformRevenue}
        />
      </section>
      <section className="admin-card">
        <AdminSectionHeader title="Unit economics" action="Datos registrados" />
        <UnitEconomicsBoard dashboard={dashboard} />
      </section>
      <div className="admin-grid two">
        <section className="admin-card">
          <AdminSectionHeader title="Funnel de crecimiento" action="Cuentas y jobs" />
          <GrowthFunnel state={state} dashboard={dashboard} />
        </section>
        <section className="admin-card">
          <AdminSectionHeader
            title="Riesgos y mitigación"
            action={dashboard ? `${dashboard.riskSignals.length} señales` : "—"}
          />
          <RiskSignalBoard dashboard={dashboard} />
        </section>
      </div>
    </div>
  );
}
