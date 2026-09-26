// Cocina en vivo (ARC-001).
//
// DoorDash Merchant Portal y Uber Eats Manager concentran live orders y prep
// time fuera del catálogo y de las liquidaciones. Flash deja la cola y el SLA
// de cocina en este módulo; el shell sólo orquesta polling y navegación.
import { TriangleAlert } from "lucide-react";

import { api } from "../api";
import { compactMinutes } from "../format";
import { AdminSectionHeader, OrderOpsCard } from "../ui/panels";
import type { Driver, MerchantOperationsMetrics, Order, Restaurant } from "../types";

type RunAction = (action: () => Promise<unknown>, success: string) => void;

export function MerchantKitchenPanel({
  restaurant,
  drivers,
  activeOrders,
  hasMore,
  metrics,
  busy,
  operationsLoading,
  runAction,
  onOpenDetail,
}: {
  restaurant: Restaurant;
  drivers: Driver[];
  activeOrders: Order[];
  hasMore: boolean;
  metrics: MerchantOperationsMetrics | undefined;
  busy: boolean;
  operationsLoading: boolean;
  runAction: RunAction;
  onOpenDetail: (orderId: string) => void;
}) {
  return (
    <div className="merchant-kitchen-grid">
      <section className="admin-card">
        <AdminSectionHeader title="Comandas" action={`${activeOrders.length} activas`} />
        <div className="activity-stack">
          {hasMore && (
            <div className="merchant-queue-limit">
              <TriangleAlert size={16} />
              <span>
                Hay más de 100 pedidos activos. Priorizá la cola visible y contactá Operaciones.
              </span>
            </div>
          )}
          {activeOrders.map((order) => (
            <OrderOpsCard
              key={order.id}
              order={order}
              restaurant={restaurant}
              driver={drivers.find((entry) => entry.id === order.courierId)}
              onAdvance={() => runAction(() => api.advanceOrder(order.id), "Pedido avanzado")}
              canAdvance={["accepted", "preparing"].includes(order.status)}
              onDetails={() => onOpenDetail(order.id)}
              busy={busy}
            />
          ))}
          {operationsLoading && !activeOrders.length ? (
            <p>Sincronizando comandas…</p>
          ) : (
            !activeOrders.length && <p>No hay pedidos pendientes.</p>
          )}
        </div>
      </section>
      <section className="admin-card">
        <AdminSectionHeader title="Capacidad" action="SLA" />
        <p>Ajusta el tiempo visible para nuevos clientes según la carga real de cocina.</p>
        <div className="prep-actions">
          <button
            disabled={busy}
            onClick={() =>
              runAction(
                () =>
                  api.updateRestaurant(restaurant.id, {
                    etaMin: Math.max(5, restaurant.etaMin - 5),
                  }),
                "ETA reducida",
              )
            }
          >
            -5 min
          </button>
          <b>{restaurant.etaMin} min</b>
          <button
            disabled={busy}
            onClick={() =>
              runAction(
                () =>
                  api.updateRestaurant(restaurant.id, {
                    etaMin: restaurant.etaMin + 5,
                  }),
                "ETA ampliada",
              )
            }
          >
            +5 min
          </button>
        </div>
        <div className="merchant-capacity-facts">
          <article>
            <small>Fuera de plazo</small>
            <strong>{metrics?.lateOrders ?? "—"}</strong>
          </article>
          <article>
            <small>Más antiguo</small>
            <strong>{metrics ? compactMinutes(metrics.oldestActiveMinutes) : "—"}</strong>
          </article>
          <article>
            <small>Sin SLA observado</small>
            <strong>{metrics?.untrackedPrepOrders ?? "—"}</strong>
          </article>
        </div>
      </section>
    </div>
  );
}
