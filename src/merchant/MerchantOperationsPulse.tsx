// Pulso operativo siempre visible (ARC-001).
//
// DoorDash Merchant tablet mantiene KPIs y etapas de cocina encima de la cola.
// Flash conserva esa franja en el shell: loading, dato rancio y SLA se leen
// sin entrar a Finanzas ni al catálogo.
import { RefreshCw, TriangleAlert } from "lucide-react";

import { compactMinutes, money } from "../format";
import { AdminKpi } from "../ui/panels";
import type { MerchantOperationsDashboard } from "../types";
import type { Restaurant } from "../types";

export function MerchantOperationsPulse({
  restaurant,
  operations,
  operationsError,
  operationsLoading,
  onRefresh,
}: {
  restaurant: Restaurant;
  operations: MerchantOperationsDashboard | null;
  operationsError: string;
  operationsLoading: boolean;
  onRefresh: () => void;
}) {
  const metrics = operations?.metrics;
  const operationsUpdatedAt = operations
    ? new Intl.DateTimeFormat("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: operations.timezone,
      }).format(new Date(operations.generatedAt))
    : null;

  return (
    <>
      <section
        className={`merchant-operations-status ${operationsError ? "error" : operations?.source === "postgres-live-operations" ? "live" : "fallback"}`}
      >
        <span className="merchant-operations-dot" />
        <div>
          <strong>
            {operationsError
              ? operations
                ? "Última lectura conservada"
                : "Operación sin actualizar"
              : operations?.source === "postgres-live-operations"
                ? "Operación conectada a PostgreSQL"
                : operations
                  ? "Modo local explícito"
                  : "Conectando operación"}
          </strong>
          <small>
            {operationsError
              ? `${operationsError}${operationsUpdatedAt ? ` · Último dato ${operationsUpdatedAt}` : ""}`
              : operationsUpdatedAt
                ? `Actualizado ${operationsUpdatedAt} · ${operations?.branch?.name || restaurant.name}`
                : "Consultando la fuente autoritativa"}
          </small>
        </div>
        {operationsLoading ? (
          <RefreshCw className="merchant-operations-spinner" size={18} />
        ) : (
          <button type="button" onClick={onRefresh}>
            <RefreshCw size={16} /> Actualizar
          </button>
        )}
      </section>
      <div className="admin-kpis">
        <AdminKpi
          label="Pedidos activos"
          value={metrics?.activeOrders ?? "—"}
          detail={
            metrics
              ? `${compactMinutes(metrics.oldestActiveMinutes)} el más antiguo`
              : "cola sin sincronizar"
          }
          tone="orange"
        />
        <AdminKpi
          label="Ventas de hoy"
          value={metrics ? money.format(metrics.grossSalesToday) : "—"}
          detail={metrics ? `${metrics.completedToday} completados hoy` : "día local del comercio"}
          tone="green"
        />
        <AdminKpi
          label="Ticket de hoy"
          value={metrics ? money.format(metrics.averageTicketToday) : "—"}
          detail={metrics ? `${metrics.cancelledToday} cancelados hoy` : "sin estimaciones"}
          tone="blue"
        />
        <AdminKpi
          label="Requieren atención"
          value={metrics ? metrics.needsAction + metrics.lateOrders : "—"}
          detail={metrics ? `${metrics.lateOrders} fuera de plazo` : "SLA sin sincronizar"}
          tone="dark"
        />
      </div>
      <section className="merchant-pulse" aria-label="Pulso operativo de cocina">
        <div className="merchant-pulse-heading">
          <div>
            <small>Ahora</small>
            <h2>Pulso de cocina</h2>
          </div>
          <span>
            {metrics ? `${metrics.activeOrders} pedidos en flujo` : "Esperando datos reales"}
          </span>
        </div>
        <div className="merchant-pulse-stages">
          <article className={metrics?.needsAction ? "attention" : ""}>
            <span>Por aceptar</span>
            <strong>{metrics?.needsAction ?? "—"}</strong>
            <small>acción del local</small>
          </article>
          <article>
            <span>Preparando</span>
            <strong>{metrics?.preparing ?? "—"}</strong>
            <small>en cocina</small>
          </article>
          <article>
            <span>Listos</span>
            <strong>{metrics?.readyForPickup ?? "—"}</strong>
            <small>esperan retiro</small>
          </article>
          <article>
            <span>Con courier</span>
            <strong>{metrics?.courierFlow ?? "—"}</strong>
            <small>última milla</small>
          </article>
          <article className={metrics?.unavailableItems ? "stock" : ""}>
            <span>Sin stock</span>
            <strong>{metrics?.unavailableItems ?? "—"}</strong>
            <small>productos</small>
          </article>
        </div>
        {metrics && (metrics.lateOrders > 0 || metrics.untrackedPrepOrders > 0) && (
          <div className="merchant-pulse-alert">
            <TriangleAlert size={17} />
            <span>
              {metrics.lateOrders > 0
                ? `${metrics.lateOrders} pedido${metrics.lateOrders === 1 ? "" : "s"} fuera del plazo de preparación.`
                : ""}
              {metrics.lateOrders > 0 && metrics.untrackedPrepOrders > 0 ? " " : ""}
              {metrics.untrackedPrepOrders > 0
                ? `${metrics.untrackedPrepOrders} pedido${metrics.untrackedPrepOrders === 1 ? "" : "s"} heredado${metrics.untrackedPrepOrders === 1 ? "" : "s"} sin SLA observado.`
                : ""}
            </span>
          </div>
        )}
      </section>
    </>
  );
}
