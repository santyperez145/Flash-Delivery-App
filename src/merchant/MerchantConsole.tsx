// Consola de comercio en escritorio (ticket ARC-001, paso 14).
//
// Segundo corte de `src/App.tsx`. Se lleva las cinco piezas de la superficie de
// comercio: la consola y sus cuatro editores —horarios de sucursal, catálogo de
// modificadores, catálogo dietario y el detalle de pedido—.
//
// De las cinco, **sólo `MerchantDesktopConsole` cruza la frontera**. Horarios,
// modificadores y declaración alimentaria viven en MerchantCatalogEditors.tsx.
// `OrderOpsCard` iba en sentido contrario: la usa este bloque y también el
// conductor y operaciones, así que salió antes a [`../ui/panels.tsx`](../ui/panels.tsx).
//
// Es la superficie que el criterio «el build de driver no incluye pantallas de
// comercio» nombra literalmente: mientras viviera dentro de `App.tsx`, ningún
// empaquetador podía dejarla fuera de ningún bundle.
import { useCallback, useEffect, useState } from "react";
import {
  LineChart,
  ListChecks,
  LogIn,
  MapPin,
  MessageCircle,
  Plus,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Store,
  TriangleAlert,
  WalletCards,
  X,
} from "lucide-react";

import { api } from "../api";
import { compactMinutes, money } from "../format";
import { orderStatusLabel } from "../labels";
import { AdminKpi, AdminSectionHeader, OrderOpsCard } from "../ui/panels";
import {
  BranchScheduleEditor,
  DietaryCatalogEditor,
  ModifierCatalogEditor,
} from "./MerchantCatalogEditors";
import type {
  AppState,
  MerchantFinance,
  MerchantOperationsDashboard,
  Order,
  OrderSubstitution,
  Restaurant,
} from "../types";

function MerchantOrderDetailDialog({
  order,
  restaurant,
  busy,
  onClose,
  onChanged,
}: {
  order: Order;
  restaurant: Restaurant;
  busy: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [substitutions, setSubstitutions] = useState<OrderSubstitution[]>([]),
    [selectedItemId, setSelectedItemId] = useState(""),
    [replacementId, setReplacementId] = useState(""),
    [reason, setReason] = useState(""),
    [loading, setLoading] = useState(true),
    [actionBusy, setActionBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getOrderSubstitutions(order.id);
      setSubstitutions(result.substitutions);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "No se pudieron cargar los cambios",
      );
    } finally {
      setLoading(false);
    }
  }, [order.id]);
  useEffect(() => {
    void load();
  }, [load]);
  const branch = restaurant.branches?.find((entry) => entry.id === order.branchId) || null,
    selectedOrderItem = order.items.find((item) => item.menuItemId === selectedItemId) || null,
    selectedCatalogItem = restaurant.menu.find((item) => item.id === selectedItemId) || null,
    inventoryFor = (itemId: string) => branch?.inventory[itemId];
  const originalPrice = selectedOrderItem?.unitPrice ?? selectedCatalogItem?.price ?? 0;
  const candidates = restaurant.menu
    .filter((item) => {
      const inventory = inventoryFor(item.id);
      return (
        item.id !== selectedItemId &&
        item.stock &&
        (inventory?.available ?? true) &&
        (inventory?.stockQuantity == null ||
          inventory.stockQuantity >= (selectedOrderItem?.quantity || 1)) &&
        item.price <= originalPrice
      );
    })
    .sort(
      (left, right) =>
        Number(
          Boolean(selectedCatalogItem?.category) &&
            right.category === selectedCatalogItem?.category,
        ) -
          Number(
            Boolean(selectedCatalogItem?.category) &&
              left.category === selectedCatalogItem?.category,
          ) || left.price - right.price,
    );
  const canManage = ["accepted", "preparing"].includes(order.status),
    selectedPending = substitutions.some(
      (entry) => entry.status === "pending" && entry.original.id === selectedItemId,
    );
  const submit = async () => {
    if (
      !order.branchId ||
      !selectedOrderItem?.menuItemId ||
      !replacementId ||
      reason.trim().length < 3
    )
      return;
    setActionBusy(true);
    setError("");
    try {
      const inventory = inventoryFor(selectedOrderItem.menuItemId);
      if (selectedCatalogItem?.stock && (inventory?.available ?? true))
        await api.updateBranchInventory(
          restaurant.id,
          order.branchId,
          selectedOrderItem.menuItemId,
          { available: false, stockQuantity: inventory?.stockQuantity ?? null },
        );
      const result = await api.proposeOrderSubstitution(order.id, {
        originalMenuItemId: selectedOrderItem.menuItemId,
        replacementMenuItemId: replacementId,
        reason: reason.trim(),
      });
      setSubstitutions((current) => [result.substitution, ...current]);
      setSelectedItemId("");
      setReplacementId("");
      setReason("");
      await onChanged();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "No se pudo enviar la propuesta",
      );
    } finally {
      setActionBusy(false);
    }
  };
  return (
    <div
      className="merchant-order-detail-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="merchant-order-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="merchant-order-detail-title"
      >
        <header>
          <div>
            <small>COMANDA {order.id}</small>
            <h2 id="merchant-order-detail-title">{orderStatusLabel[order.status]}</h2>
            <p>
              {new Date(order.createdAt).toLocaleTimeString("es-AR", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              · {branch?.name || order.branchId || "Sucursal no registrada"}
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Cerrar detalle"
          >
            <X size={19} />
          </button>
        </header>
        <div className="merchant-order-detail-scroll">
          <div className="merchant-order-detail-facts">
            <article>
              <small>Total</small>
              <strong>{money.format(order.total)}</strong>
            </article>
            <article>
              <small>Entrega estimada</small>
              <strong>{order.etaMin} min</strong>
            </article>
            <article>
              <small>Courier</small>
              <strong>{order.courierId ? "Asignado" : "Pendiente"}</strong>
            </article>
          </div>
          <section className="merchant-order-detail-card">
            <div className="merchant-order-detail-card-title">
              <h3>Productos</h3>
              <span>{order.items.length} líneas</span>
            </div>
            {order.items.map((item, index) => {
              const menuId = item.menuItemId || "",
                catalogItem = restaurant.menu.find((entry) => entry.id === menuId),
                inventory = menuId ? inventoryFor(menuId) : undefined,
                unavailable =
                  Boolean(catalogItem && !catalogItem.stock) || inventory?.available === false,
                hasPending = substitutions.some(
                  (entry) => entry.status === "pending" && entry.original.id === menuId,
                );
              return (
                <article
                  className={
                    selectedItemId === menuId
                      ? "merchant-order-line selected"
                      : "merchant-order-line"
                  }
                  key={`${menuId || item.name}-${index}`}
                >
                  <b>{item.quantity}×</b>
                  <div>
                    <div className="merchant-order-line-title">
                      <strong>{item.name}</strong>
                      {unavailable && <span>SIN STOCK</span>}
                    </div>
                    {typeof item.unitPrice === "number" && (
                      <small>{money.format(item.unitPrice)} c/u</small>
                    )}
                    {item.extras.length > 0 && <p>Agregados: {item.extras.join(", ")}</p>}
                    {item.note && (
                      <blockquote>
                        <MessageCircle size={14} />
                        {item.note}
                      </blockquote>
                    )}
                    {canManage && menuId && (
                      <button
                        type="button"
                        disabled={busy || actionBusy || hasPending}
                        onClick={() => {
                          setSelectedItemId(menuId);
                          setReplacementId("");
                          setReason("");
                        }}
                      >
                        <RefreshCw size={14} />
                        {hasPending ? "Esperando respuesta" : "Gestionar faltante"}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
          {selectedOrderItem && selectedCatalogItem && (
            <section className="merchant-order-substitution-composer">
              <small>SUSTITUCIÓN</small>
              <h3>Reemplazar {selectedOrderItem.name}</h3>
              <p>
                El faltante se aplica únicamente a {branch?.name || "la sucursal del pedido"}; el
                cliente conserva la decisión final.
              </p>
              {!order.branchId && (
                <div className="merchant-order-detail-error">
                  <TriangleAlert size={16} />
                  El pedido no conserva una sucursal operable.
                </div>
              )}
              {candidates.length > 0 ? (
                <>
                  <div className="merchant-replacement-list">
                    {candidates.map((item) => (
                      <label className={replacementId === item.id ? "selected" : ""} key={item.id}>
                        <input
                          type="radio"
                          name="merchant-replacement"
                          checked={replacementId === item.id}
                          onChange={() => setReplacementId(item.id)}
                        />
                        <span>
                          <strong>{item.name}</strong>
                          <small>
                            {item.category} · {money.format(item.price)}
                          </small>
                        </span>
                        {selectedCatalogItem.category &&
                          item.category === selectedCatalogItem.category && (
                            <em>Misma categoría</em>
                          )}
                      </label>
                    ))}
                  </div>
                  <textarea
                    rows={3}
                    maxLength={500}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Motivo para el cliente"
                  />
                  <button
                    className="primary-button"
                    type="button"
                    disabled={
                      !order.branchId ||
                      !replacementId ||
                      reason.trim().length < 3 ||
                      busy ||
                      actionBusy ||
                      selectedPending
                    }
                    onClick={() => void submit()}
                  >
                    {actionBusy ? (
                      <RefreshCw className="merchant-operations-spinner" size={16} />
                    ) : (
                      <RefreshCw size={16} />
                    )}{" "}
                    {actionBusy ? "Validando inventario…" : "Marcar agotado y proponer"}
                  </button>
                </>
              ) : (
                <div className="merchant-order-detail-error">
                  <TriangleAlert size={16} />
                  No hay reemplazos disponibles de precio igual o menor.
                </div>
              )}
            </section>
          )}
          <section className="merchant-order-detail-card">
            <div className="merchant-order-detail-card-title">
              <h3>Cambios del pedido</h3>
              {loading && <RefreshCw className="merchant-operations-spinner" size={16} />}
            </div>
            {substitutions.map((entry) => (
              <article className="merchant-substitution-history" key={entry.id}>
                <span className={entry.status}>
                  {entry.status === "pending"
                    ? "Pendiente"
                    : entry.status === "accepted"
                      ? "Aceptado"
                      : "Rechazado"}
                </span>
                <strong>
                  {entry.original.name} → {entry.replacement.name}
                </strong>
                <p>{entry.reason}</p>
                {entry.refundAmount > 0 && (
                  <small>Reintegro aplicado: {money.format(entry.refundAmount)}</small>
                )}
              </article>
            ))}
            {!loading && !substitutions.length && (
              <p>No se registraron cambios para esta comanda.</p>
            )}
          </section>
          {error && (
            <div className="merchant-order-detail-error">
              <TriangleAlert size={16} />
              {error}
            </div>
          )}
          <section className="merchant-order-destination">
            <MapPin size={18} />
            <div>
              <strong>Destino de entrega</strong>
              <p>{order.deliveryAddress}</p>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

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
  setNewDish: React.Dispatch<
    React.SetStateAction<{
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
  const [finance, setFinance] = useState<MerchantFinance | null>(null);
  const [operations, setOperations] = useState<MerchantOperationsDashboard | null>(null);
  const [merchantActiveOrders, setMerchantActiveOrders] = useState<Order[]>([]);
  const [merchantActiveOrdersHasMore, setMerchantActiveOrdersHasMore] = useState(false);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [operationsLoading, setOperationsLoading] = useState(true);
  const [operationsError, setOperationsError] = useState("");
  const [financeLoading, setFinanceLoading] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutPassword, setPayoutPassword] = useState("");
  const [paymentConnection, setPaymentConnection] = useState<
    import("../types").MerchantPaymentConnection | null
  >(null);
  const [paymentProviderConfigured, setPaymentProviderConfigured] = useState(false);
  const [paymentConnectionPassword, setPaymentConnectionPassword] = useState("");
  const loadFinance = useCallback(async () => {
    setFinanceLoading(true);
    try {
      const [financeResult, connectionResult] = await Promise.all([
        api.getMerchantFinance(restaurant.id),
        api.getMerchantPaymentConnection(restaurant.id),
      ]);
      setFinance(financeResult.finance);
      setPaymentConnection(connectionResult.connection);
      setPaymentProviderConfigured(connectionResult.configured);
    } finally {
      setFinanceLoading(false);
    }
  }, [restaurant.id]);
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
  useEffect(() => {
    if (section === "finance") void loadFinance();
  }, [section, loadFinance]);
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
  const operationsUpdatedAt = operations
    ? new Intl.DateTimeFormat("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: operations.timezone,
      }).format(new Date(operations.generatedAt))
    : null;
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
            <button type="button" onClick={() => void loadOperations()}>
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
            detail={
              metrics ? `${metrics.completedToday} completados hoy` : "día local del comercio"
            }
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
        {section === "kitchen" && (
          <div className="merchant-kitchen-grid">
            <section className="admin-card">
              <AdminSectionHeader title="Comandas" action={`${activeOrders.length} activas`} />
              <div className="activity-stack">
                {merchantActiveOrdersHasMore && (
                  <div className="merchant-queue-limit">
                    <TriangleAlert size={16} />
                    <span>
                      Hay más de 100 pedidos activos. Priorizá la cola visible y contactá
                      Operaciones.
                    </span>
                  </div>
                )}
                {activeOrders.map((order) => (
                  <OrderOpsCard
                    key={order.id}
                    order={order}
                    restaurant={restaurant}
                    driver={state.drivers.find((entry) => entry.id === order.courierId)}
                    onAdvance={() => runAction(() => api.advanceOrder(order.id), "Pedido avanzado")}
                    canAdvance={["accepted", "preparing"].includes(order.status)}
                    onDetails={() => setDetailOrderId(order.id)}
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
        )}
        {section === "catalog" && (
          <div className="merchant-catalog-grid">
            <section className="admin-card">
              <AdminSectionHeader title="Productos" action={`${restaurant.menu.length} items`} />
              <div className="merchant-product-table">
                {restaurant.menu.map((item) => (
                  <article className="merchant-product-entry" key={item.id}>
                    <label>
                      <img src={item.image} alt="" />
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {item.category} · {money.format(item.price)}
                        </small>
                      </span>
                      <input
                        type="checkbox"
                        checked={item.stock}
                        disabled={busy}
                        onChange={(event) =>
                          runAction(
                            () => api.updateMenuStock(restaurant.id, item.id, event.target.checked),
                            "Stock actualizado",
                          )
                        }
                      />
                    </label>
                    <ModifierCatalogEditor
                      restaurantId={restaurant.id}
                      item={item}
                      busy={busy}
                      runAction={runAction}
                    />
                    <DietaryCatalogEditor
                      restaurantId={restaurant.id}
                      item={item}
                      busy={busy}
                      runAction={runAction}
                    />
                  </article>
                ))}
              </div>
            </section>
            <section className="admin-card merchant-create-product">
              <AdminSectionHeader title="Nuevo producto" action="Alta" />
              <input
                value={newDish.name}
                onChange={(event) =>
                  setNewDish((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Nombre"
              />
              <textarea
                value={newDish.description}
                onChange={(event) =>
                  setNewDish((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Descripcion"
              />
              <input
                value={newDish.category}
                onChange={(event) =>
                  setNewDish((current) => ({
                    ...current,
                    category: event.target.value,
                  }))
                }
                placeholder="Categoria"
              />
              <input
                type="number"
                value={newDish.price}
                onChange={(event) =>
                  setNewDish((current) => ({
                    ...current,
                    price: Number(event.target.value),
                  }))
                }
              />
              <button
                className="primary-button"
                disabled={busy}
                onClick={() =>
                  runAction(() => api.addMenuItem(restaurant.id, newDish), "Producto creado")
                }
              >
                <Plus size={17} /> Crear producto
              </button>
            </section>
          </div>
        )}
        {section === "branches" && (
          <div className="merchant-branches-grid">
            {(restaurant.branches || []).map((branch) => (
              <section className="admin-card merchant-branch-card" key={branch.id}>
                <div className="branch-card-head">
                  <span className={`branch-pin ${branch.open ? "live" : "paused"}`}>
                    <MapPin size={20} />
                  </span>
                  <div>
                    <small>{branch.isPrimary ? "Sucursal principal" : "Sucursal"}</small>
                    <h2>{branch.name}</h2>
                    <p>{branch.address}</p>
                  </div>
                  <label className="branch-switch">
                    <input
                      type="checkbox"
                      checked={branch.manualOpen}
                      disabled={busy}
                      onChange={(event) =>
                        runAction(
                          () =>
                            api.updateBranch(restaurant.id, branch.id, {
                              open: event.target.checked,
                              status: event.target.checked ? "active" : "paused",
                            }),
                          event.target.checked ? "Sucursal habilitada" : "Sucursal pausada",
                        )
                      }
                    />
                    <span>
                      {!branch.manualOpen
                        ? "Pausada manualmente"
                        : branch.open
                          ? "Abierta ahora"
                          : "Fuera de horario"}
                    </span>
                  </label>
                </div>
                <div className="branch-metrics">
                  <article>
                    <small>ETA publicado</small>
                    <strong>{branch.etaMin} min</strong>
                    <div className="branch-eta-actions">
                      <button
                        disabled={busy || branch.etaMin <= 5}
                        onClick={() =>
                          runAction(
                            () =>
                              api.updateBranch(restaurant.id, branch.id, {
                                etaMin: Math.max(5, branch.etaMin - 5),
                              }),
                            "ETA de sucursal actualizado",
                          )
                        }
                      >
                        −5
                      </button>
                      <button
                        disabled={busy || branch.etaMin >= 240}
                        onClick={() =>
                          runAction(
                            () =>
                              api.updateBranch(restaurant.id, branch.id, {
                                etaMin: Math.min(240, branch.etaMin + 5),
                              }),
                            "ETA de sucursal actualizado",
                          )
                        }
                      >
                        +5
                      </button>
                    </div>
                  </article>
                  <article>
                    <small>Coordenadas</small>
                    <strong>
                      {branch.lat.toFixed(4)}, {branch.lng.toFixed(4)}
                    </strong>
                    <span>PostGIS activo</span>
                  </article>
                  <article>
                    <small>Disponibles</small>
                    <strong>
                      {
                        restaurant.menu.filter(
                          (item) => branch.inventory[item.id]?.available ?? item.stock,
                        ).length
                      }
                      /{restaurant.menu.length}
                    </strong>
                    <span>Catálogo local</span>
                  </article>
                </div>
                <BranchScheduleEditor
                  restaurantId={restaurant.id}
                  branch={branch}
                  busy={busy}
                  runAction={runAction}
                />
                <div className="branch-stock-list">
                  <div className="branch-stock-title">
                    <strong>Inventario de esta sede</strong>
                    <small>Los cambios no afectan otras sucursales</small>
                  </div>
                  {restaurant.menu.map((item) => {
                    const inventory = branch.inventory[item.id],
                      available = inventory?.available ?? item.stock;
                    return (
                      <label key={item.id}>
                        <img src={item.image} alt="" />
                        <span>
                          <strong>{item.name}</strong>
                          <small>
                            {available
                              ? inventory?.stockQuantity == null
                                ? "Disponible"
                                : `${inventory.stockQuantity} unidades`
                              : "Agotado"}
                          </small>
                        </span>
                        <input
                          type="checkbox"
                          checked={available}
                          disabled={busy}
                          onChange={(event) =>
                            runAction(
                              () =>
                                api.updateBranchInventory(restaurant.id, branch.id, item.id, {
                                  available: event.target.checked,
                                  stockQuantity: event.target.checked ? null : 0,
                                }),
                              "Inventario de sucursal actualizado",
                            )
                          }
                        />
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}
            {!restaurant.branches?.length && (
              <section className="admin-card">
                <p>No hay sucursales configuradas.</p>
              </section>
            )}
          </div>
        )}
        {section === "analytics" && (
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
        )}
        {section === "finance" && (
          <div className="merchant-finance-grid">
            <section className="admin-card merchant-payout-history">
              <AdminSectionHeader
                title="Cobros del marketplace"
                action={
                  paymentConnection?.status === "connected"
                    ? paymentConnection.liveMode
                      ? "Cuenta real"
                      : "Cuenta de prueba"
                    : "Sin vincular"
                }
              />
              {paymentConnection?.status === "connected" ? (
                <>
                  <p>
                    Mercado Pago conectado · cuenta terminada en{" "}
                    {paymentConnection.externalAccountId.slice(-4)}.
                  </p>
                  <small>
                    Conectado {new Date(paymentConnection.connectedAt).toLocaleString("es-AR")}.
                    Flash renueva la autorización antes de vencer y nunca muestra tokens sin cifrar.
                  </small>
                  <div className="merchant-payout-form">
                    <input
                      type="password"
                      autoComplete="current-password"
                      placeholder="Contraseña para desvincular"
                      value={paymentConnectionPassword}
                      onChange={(event) => setPaymentConnectionPassword(event.target.value)}
                    />
                    <button
                      className="secondary-button"
                      disabled={busy || paymentConnectionPassword.length < 4}
                      onClick={() =>
                        runAction(async () => {
                          const result = await api.disconnectMerchantPaymentConnection(
                            restaurant.id,
                            paymentConnectionPassword,
                          );
                          setPaymentConnection(result.connection);
                          setPaymentConnectionPassword("");
                        }, "Mercado Pago desvinculado y credenciales eliminadas")
                      }
                    >
                      Desvincular de forma segura
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p>
                    {paymentConnection?.status === "revoked"
                      ? "La conexión anterior fue revocada y sus credenciales se eliminaron."
                      : paymentConnection?.status === "reconnect_required"
                        ? "Mercado Pago requiere renovar el consentimiento. Reconectá la cuenta antes de que se interrumpan los cobros."
                        : "Vinculá la cuenta seller para que Mercado Pago pueda dividir cobros entre el comercio y Flash."}
                  </p>
                  <button
                    className="primary-button"
                    disabled={busy || !paymentProviderConfigured}
                    onClick={() =>
                      runAction(async () => {
                        const result = await api.beginMerchantPaymentConnection(restaurant.id);
                        window.location.assign(result.authorizationUrl);
                      }, "Redirigiendo a Mercado Pago")
                    }
                  >
                    {paymentProviderConfigured
                      ? paymentConnection?.status === "reconnect_required"
                        ? "Reconectar Mercado Pago"
                        : "Conectar Mercado Pago"
                      : "Integración pendiente de credenciales"}
                  </button>
                </>
              )}
            </section>
            <section className="admin-card">
              <AdminSectionHeader
                title="Saldo liquidable"
                action={financeLoading ? "Actualizando…" : "PostgreSQL ledger"}
              />
              <strong className="merchant-balance">
                {money.format(finance?.availableBalance || 0)}
              </strong>
              <p>Ventas capturadas menos comisión y retiros reservados.</p>
              <div className="merchant-payout-form">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="Monto a retirar"
                  value={payoutAmount}
                  onChange={(event) => setPayoutAmount(event.target.value)}
                />
                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder="Contraseña actual"
                  value={payoutPassword}
                  onChange={(event) => setPayoutPassword(event.target.value)}
                  aria-label="Contraseña actual para autorizar el retiro"
                />
                <button
                  className="primary-button"
                  disabled={
                    busy ||
                    !Number(payoutAmount) ||
                    payoutPassword.length < 4 ||
                    Number(payoutAmount) > (finance?.availableBalance || 0)
                  }
                  onClick={async () => {
                    const amount = Number(payoutAmount);
                    await runAction(async () => {
                      const authorization = await api.authorizeMerchantPayout(
                        restaurant.id,
                        amount,
                        payoutPassword,
                      );
                      return api.requestMerchantPayout(
                        restaurant.id,
                        amount,
                        authorization.authorizationToken,
                      );
                    }, "Retiro reservado");
                    setPayoutAmount("");
                    setPayoutPassword("");
                    await loadFinance();
                  }}
                >
                  Solicitar retiro
                </button>
              </div>
              <small>
                Confirmás comercio e importe con tu contraseña. La autorización vence en 5 minutos,
                funciona una sola vez y el retiro queda pendiente del proveedor bancario.
              </small>
            </section>
            <section className="admin-card">
              <AdminSectionHeader
                title="Movimientos"
                action={`${finance?.movements.length || 0}`}
              />
              <div className="admin-table">
                {finance?.movements.map((entry) => (
                  <article className="admin-row compact" key={entry.id}>
                    <ReceiptText size={17} />
                    <div>
                      <strong>{entry.description}</strong>
                      <span>{new Date(entry.createdAt).toLocaleString("es-AR")}</span>
                    </div>
                    <b>
                      {entry.direction === "credit" ? "+" : "-"}
                      {money.format(entry.amount)}
                    </b>
                    <small>{entry.kind}</small>
                  </article>
                ))}
                {!financeLoading && !finance?.movements.length && <p>Sin liquidaciones todavía.</p>}
              </div>
            </section>
            <section className="admin-card merchant-payout-history">
              <AdminSectionHeader title="Retiros" action={`${finance?.payouts.length || 0}`} />
              <div className="admin-table">
                {finance?.payouts.map((entry) => (
                  <article className="admin-row compact" key={entry.id}>
                    <WalletCards size={17} />
                    <div>
                      <strong>{entry.id}</strong>
                      <span>{new Date(entry.createdAt).toLocaleDateString("es-AR")}</span>
                    </div>
                    <b>{money.format(entry.amount)}</b>
                    <small>{entry.status}</small>
                  </article>
                ))}
                {!financeLoading && !finance?.payouts.length && <p>No hay retiros solicitados.</p>}
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
