// Consola de comercio en escritorio (ticket ARC-001).
//
// Shell de navegación. Cocina, detalle/sustituciones, catálogo, sucursales,
// rendimiento, pulso y liquidaciones viven en módulos propios — la misma
// frontera que DoorDash Merchant Portal y Uber Eats Manager. El polling y el
// pause del local quedan aquí porque cruzan todas las secciones.
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  LineChart,
  ListChecks,
  LogIn,
  MapPin,
  ShieldCheck,
  ShoppingBag,
  Store,
  WalletCards,
} from "lucide-react";

import { api } from "../api";
import type { AppState, MerchantOperationsDashboard, Order, Restaurant } from "../types";
import { MerchantFinancePanel } from "./MerchantFinancePanel";
import { MerchantKitchenPanel } from "./MerchantKitchenPanel";
import { MerchantOperationsPulse } from "./MerchantOperationsPulse";
import { MerchantOrderDetailDialog } from "./MerchantOrderDetail";
import { MerchantStoreAnalytics } from "./MerchantStoreAnalytics";
import { MerchantStoreCatalog } from "./MerchantStoreCatalog";
import { MerchantStoreHours } from "./MerchantStoreHours";

export function MerchantDesktopConsole({
  state,
  restaurant,
  newDish,
  setNewDish,
  busy,
  realtimeStatus,
  runAction,
  onRefresh,
  onSwitchPortal,
  canSwitchPortal,
  onLogout,
}: {
  state: AppState;
  restaurant: Restaurant;
  newDish: {
    name: string;
    description: string;
    category: string;
    price: number;
  };
  setNewDish: Dispatch<
    SetStateAction<{
      name: string;
      description: string;
      category: string;
      price: number;
    }>
  >;
  busy: boolean;
  realtimeStatus: "connecting" | "live" | "reconnecting" | "offline";
  runAction: (action: () => Promise<unknown>, success: string) => void;
  onRefresh: () => Promise<void>;
  onSwitchPortal: () => void;
  canSwitchPortal: boolean;
  onLogout: () => void;
}) {
  const [section, setSection] = useState<
    "kitchen" | "catalog" | "branches" | "analytics" | "finance"
  >("kitchen");
  const [operations, setOperations] = useState<MerchantOperationsDashboard | null>(null);
  const [merchantActiveOrders, setMerchantActiveOrders] = useState<Order[]>([]);
  const [merchantActiveOrdersHasMore, setMerchantActiveOrdersHasMore] = useState(false);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [operationsLoading, setOperationsLoading] = useState(true);
  const [operationsError, setOperationsError] = useState("");
  const loadOperations = useCallback(async () => {
    setOperationsLoading(true);
    try {
      const [result, queue] = await Promise.all([
        api.getMerchantDashboard(restaurant.id),
        api.getMerchantActiveOrders(restaurant.id),
      ]);
      setOperations(result.dashboard);
      setMerchantActiveOrders(queue.orders);
      setMerchantActiveOrdersHasMore(queue.hasMore);
      setOperationsError("");
    } catch (error) {
      setOperationsError(
        error instanceof Error ? error.message : "No se pudo actualizar la operación",
      );
    } finally {
      setOperationsLoading(false);
    }
  }, [restaurant.id]);
  const orders = state.orders.filter((order) => order.restaurantId === restaurant.id);
  const activeOrders = merchantActiveOrders;
  const detailOrder = activeOrders.find((order) => order.id === detailOrderId) || null;
  const orderStatusSignature = orders.map((order) => `${order.id}:${order.status}`).join("|");
  const stockSignature = restaurant.menu.map((item) => `${item.id}:${item.stock}`).join("|");
  useEffect(() => {
    void loadOperations();
    const timer = window.setInterval(() => void loadOperations(), 30_000);
    return () => window.clearInterval(timer);
  }, [
    loadOperations,
    orderStatusSignature,
    restaurant.etaMin,
    restaurant.manualOpen,
    stockSignature,
  ]);
  const metrics = operations?.metrics;
  return (
    <main className="merchant-desktop-shell">
      {detailOrder && (
        <MerchantOrderDetailDialog
          order={detailOrder}
          restaurant={restaurant}
          busy={busy}
          onClose={() => setDetailOrderId(null)}
          onChanged={async () => {
            await onRefresh();
            await loadOperations();
          }}
        />
      )}
      <aside className="merchant-desktop-sidebar">
        <div className="admin-brand">
          <span>
            <Store size={22} />
          </span>
          <div>
            <strong>Flash Negocios</strong>
            <small>{restaurant.name}</small>
          </div>
        </div>
        <nav className="admin-nav">
          <button
            className={section === "kitchen" ? "active" : ""}
            onClick={() => setSection("kitchen")}
          >
            <ListChecks size={17} /> Cocina
          </button>
          <button
            className={section === "catalog" ? "active" : ""}
            onClick={() => setSection("catalog")}
          >
            <ShoppingBag size={17} /> Catalogo y stock
          </button>
          <button
            className={section === "branches" ? "active" : ""}
            onClick={() => setSection("branches")}
          >
            <MapPin size={17} /> Sucursales
          </button>
          <button
            className={section === "analytics" ? "active" : ""}
            onClick={() => setSection("analytics")}
          >
            <LineChart size={17} /> Rendimiento
          </button>
          <button
            className={section === "finance" ? "active" : ""}
            onClick={() => setSection("finance")}
          >
            <WalletCards size={17} /> Finanzas
          </button>
          {canSwitchPortal && (
            <button onClick={onSwitchPortal}>
              <ShieldCheck size={17} /> Superadmin
            </button>
          )}
          <button onClick={onLogout}>
            <LogIn size={17} /> Cerrar sesión
          </button>
        </nav>
        <label className="merchant-open-control">
          <span>
            <strong>Aceptar pedidos</strong>
            <small>
              {!restaurant.manualOpen
                ? "Local pausado"
                : restaurant.open
                  ? "Abierto ahora"
                  : "Fuera de horario"}
            </small>
          </span>
          <input
            type="checkbox"
            checked={restaurant.manualOpen ?? restaurant.open}
            disabled={busy}
            onChange={(event) =>
              runAction(
                () =>
                  api.updateRestaurant(restaurant.id, {
                    open: event.target.checked,
                  }),
                event.target.checked ? "Local habilitado" : "Local pausado",
              )
            }
          />
        </label>
      </aside>
      <section className="merchant-desktop-main">
        <header className="admin-topbar">
          <div>
            <span>Portal operativo</span>
            <h1>
              {section === "kitchen"
                ? "Cocina en vivo"
                : section === "catalog"
                  ? "Catalogo"
                  : section === "branches"
                    ? "Sucursales"
                    : section === "finance"
                      ? "Liquidaciones"
                      : "Rendimiento"}
            </h1>
          </div>
          <div className="admin-actions">
            <small className={`realtime-status ${realtimeStatus}`}>
              <span />
              {realtimeStatus}
            </small>
            <b>
              {operations?.branch ? `${operations.branch.etaMin} min ETA` : "ETA sin sincronizar"}
            </b>
          </div>
        </header>
        <MerchantOperationsPulse
          restaurant={restaurant}
          operations={operations}
          operationsError={operationsError}
          operationsLoading={operationsLoading}
          onRefresh={() => void loadOperations()}
        />
        {section === "kitchen" && (
          <MerchantKitchenPanel
            restaurant={restaurant}
            drivers={state.drivers}
            activeOrders={activeOrders}
            hasMore={merchantActiveOrdersHasMore}
            metrics={metrics}
            busy={busy}
            operationsLoading={operationsLoading}
            runAction={runAction}
            onOpenDetail={setDetailOrderId}
          />
        )}
        {section === "catalog" && (
          <MerchantStoreCatalog
            restaurant={restaurant}
            newDish={newDish}
            setNewDish={setNewDish}
            busy={busy}
            runAction={runAction}
          />
        )}
        {section === "branches" && (
          <MerchantStoreHours restaurant={restaurant} busy={busy} runAction={runAction} />
        )}
        {section === "analytics" && (
          <MerchantStoreAnalytics restaurant={restaurant} operations={operations} />
        )}
        {section === "finance" && (
          <MerchantFinancePanel restaurant={restaurant} busy={busy} runAction={runAction} />
        )}
      </section>
    </main>
  );
}
