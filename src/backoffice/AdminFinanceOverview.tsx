// Snapshot financiero del ledger en backoffice (ARC-001).
//
// KPIs de GMV/ingreso/wallet y muestra reciente. Vive fuera de AdminConsole
// porque Stripe Atlas / Uber Finance aíslan el tablero de dinero del shell.

import { ReceiptText } from "lucide-react";

import { money } from "../format";
import { AdminKpi, AdminSectionHeader } from "../ui/panels";
import type { AppState, Order, Ride } from "../types";
import { PayoutReviewPanel, TipAdjustmentPanel } from "./AdminFinancePanels";

export function AdminFinanceOverview({
  state,
  grossVolume,
  platformRevenue,
  takeRatePercent,
  cancellationCount,
  currentUserId,
}: {
  state: AppState;
  grossVolume: number;
  platformRevenue: number;
  takeRatePercent: number;
  cancellationCount: number;
  currentUserId: string;
}) {
  const recent: Array<Order | Ride> = [...state.orders.slice(0, 4), ...state.rides.slice(0, 4)];

  return (
    <div className="admin-grid">
      <section className="admin-card">
        <AdminSectionHeader title="Finanzas y conciliacion" action="Ledger PostgreSQL" />
        <div className="admin-kpis finance">
          <AdminKpi
            label="GMV total"
            value={money.format(grossVolume)}
            detail="Pedidos + viajes"
            tone="orange"
          />
          <AdminKpi
            label="Ingreso plataforma"
            value={money.format(platformRevenue)}
            detail={`${takeRatePercent}% registrado`}
            tone="green"
          />
          <AdminKpi
            label="Wallet clientes"
            value={money.format(state.users.reduce((sum, user) => sum + user.wallet, 0))}
            detail="Saldo total"
            tone="teal"
          />
          <AdminKpi
            label="Cancelaciones"
            value={cancellationCount}
            detail="Pedidos + viajes"
            tone="dark"
          />
        </div>
        <div className="admin-table">
          {recent.map((entry) => (
            <article className="admin-row compact" key={entry.id}>
              <ReceiptText size={18} />
              <div>
                <strong>{entry.id}</strong>
                <span>{"restaurantId" in entry ? "Pedido de comida" : "Viaje/taxi"}</span>
              </div>
              <b>{money.format("total" in entry ? entry.total : entry.fare)}</b>
              <small>{entry.paymentMethod}</small>
            </article>
          ))}
        </div>
      </section>
      <PayoutReviewPanel />
      <TipAdjustmentPanel tips={state.tips || []} currentUserId={currentUserId} />
    </div>
  );
}
