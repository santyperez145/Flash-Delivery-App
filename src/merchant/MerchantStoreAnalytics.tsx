// Rendimiento operativo del comercio (ARC-001).
//
// DoorDash Business Manager publica embudo y salud de catálogo fuera de la
// cocina. Flash sólo muestra agregados persistidos del dashboard; no reconstruye
// ventas desde la cola parcial del cliente.
import { money } from "../format";
import { AdminSectionHeader } from "../ui/panels";
import type { MerchantOperationsDashboard } from "../types";
import type { Restaurant } from "../types";

export function MerchantStoreAnalytics({
  restaurant,
  operations,
}: {
  restaurant: Restaurant;
  operations: MerchantOperationsDashboard | null;
}) {
  const metrics = operations?.metrics;
  return (
    <div className="admin-grid two">
      <section className="admin-card">
        <AdminSectionHeader title="Embudo operativo" action="Datos persistidos" />
        <div className="admin-table">
          <article className="admin-row compact">
            <strong>Pedidos activos ahora</strong>
            <b>{metrics?.activeOrders ?? "—"}</b>
          </article>
          <article className="admin-row compact">
            <strong>Entregados hoy</strong>
            <b>{metrics?.completedToday ?? "—"}</b>
          </article>
          <article className="admin-row compact">
            <strong>Cancelados hoy</strong>
            <b>{metrics?.cancelledToday ?? "—"}</b>
          </article>
        </div>
      </section>
      <section className="admin-card">
        <AdminSectionHeader title="Salud del catalogo" action="En vivo" />
        <p>
          {metrics
            ? `${Math.max(0, restaurant.menu.length - metrics.unavailableItems)} productos disponibles y ${metrics.unavailableItems} pausados.`
            : "Esperando el inventario autoritativo de la sucursal."}
        </p>
        <p>
          ETA publicado:{" "}
          {operations?.branch ? `${operations.branch.etaMin} minutos.` : "sin sincronizar."}
        </p>
        <p>
          Facturación de hoy:{" "}
          {metrics ? `${money.format(metrics.grossSalesToday)}.` : "sin sincronizar."}
        </p>
      </section>
    </div>
  );
}
