// Tableros de inversión del backoffice (ARC-001).
//
// Readiness, unit economics, milestones, funnel y riesgos. Uber Investor /
// dashboards de seed aíslan esta lectura del shell operativo.

import { AdminSectionHeader } from "../ui/panels";
import type { AdminDashboard, AppState } from "../types";
import {
  GrowthFunnel,
  InvestorPulse,
  MilestoneBoard,
  RiskSignalBoard,
  UnitEconomicsBoard,
} from "./AdminOverviewBoards";

export function AdminInvestorPanels({
  state,
  dashboard,
  grossVolume,
  platformRevenue,
  readinessScore,
}: {
  state: AppState;
  dashboard: AdminDashboard | null;
  grossVolume: number;
  platformRevenue: number;
  readinessScore: number;
}) {
  return (
    <div className="admin-grid">
      <section className="admin-card">
        <AdminSectionHeader title="Ronda seed readiness" action={`${readinessScore}/100`} />
        <InvestorPulse
          dashboard={dashboard}
          grossVolume={grossVolume}
          platformRevenue={platformRevenue}
        />
      </section>
      <div className="admin-grid two">
        <section className="admin-card">
          <AdminSectionHeader title="Unit economics" action="Modelo financiero" />
          <UnitEconomicsBoard dashboard={dashboard} />
        </section>
        <section className="admin-card">
          <AdminSectionHeader title="Milestones para levantar capital" action="18 meses" />
          <MilestoneBoard dashboard={dashboard} />
        </section>
      </div>
      <div className="admin-grid two">
        <section className="admin-card">
          <AdminSectionHeader title="Funnel de crecimiento" action="Seed metrics" />
          <GrowthFunnel state={state} dashboard={dashboard} />
        </section>
        <section className="admin-card">
          <AdminSectionHeader
            title="Riesgos y mitigacion"
            action={`${dashboard?.riskSignals.length ?? 0} senales`}
          />
          <RiskSignalBoard dashboard={dashboard} />
        </section>
      </div>
    </div>
  );
}
