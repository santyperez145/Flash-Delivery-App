// Snapshot financiero del ledger en backoffice (ARC-001).
//
// KPIs de GMV/ingreso/wallet y muestra reciente. Vive fuera de AdminConsole
// porque Stripe Atlas / Uber Finance aíslan el tablero de dinero del shell.

import { ReceiptText } from "lucide-react";

import { money } from "../format";
import { AdminKpi, AdminSectionHeader } from "../ui/panels";
import type { AdminDashboard, AppState, Order, Ride } from "../types";
import { PayoutReviewPanel, TipAdjustmentPanel } from "./AdminFinancePanels";
import { LedgerUnavailable, grossVolumePeriod } from "./AdminOverviewBoards";

export function AdminFinanceOverview({
  state,
  dashboard,
  cancellationCount,
  currentUserId,
}: {
  state: AppState;
  dashboard: AdminDashboard | null;
  cancellationCount: number;
  currentUserId: string;
}) {
  const recent: Array<Order | Ride> = [...state.orders.slice(0, 4), ...state.rides.slice(0, 4)];
  // El saldo de Wallet de clientes suma sólo cuentas con rol de cliente. Antes
  // sumaba a todos los usuarios, y un conductor o un comercio con saldo propio
  // inflaba un número que dice «clientes».
  const customerWallet = state.users
    .filter((user) => user.roles.includes("customer"))
    .reduce((sum, user) => sum + user.wallet, 0);
  const marketplace = dashboard?.marketplace;

  return (
    <div className="admin-grid">
      <section className="admin-card">
        <AdminSectionHeader title="Finanzas y conciliación" action="Ledger PostgreSQL" />
        <div className="admin-kpis finance">
          {/* GMV e ingreso salen sólo del tablero, con su período dicho. Sin
              tablero, «—»: un $0 se leería como que no se vendió nada. */}
          <AdminKpi
            label="GMV"
            value={marketplace ? money.format(marketplace.grossVolume) : "—"}
            detail={dashboard ? grossVolumePeriod(dashboard) : "Sin lectura del ledger"}
            tone="orange"
          />
          <AdminKpi
            label="Ingreso plataforma"
            value={marketplace ? money.format(marketplace.estimatedPlatformRevenue) : "—"}
            detail={
              marketplace ? `${marketplace.takeRatePercent}% registrado` : "Sin lectura del ledger"
            }
            tone="green"
          />
          <AdminKpi
            label="Wallet clientes"
            value={money.format(customerWallet)}
            detail="Saldo de cuentas con rol de cliente"
            tone="teal"
          />
          <AdminKpi
            label="Cancelaciones"
            value={cancellationCount}
            detail="Pedidos + viajes"
            tone="dark"
          />
        </div>
        {!dashboard && <LedgerUnavailable />}
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
