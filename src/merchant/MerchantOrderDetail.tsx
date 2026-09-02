// Detalle de comanda y sustituciones (ARC-001).
//
// DoorDash Merchant y Uber Eats Manager aíslan el 86-item / missing item del
// tablero de cocina: el comercio propone reemplazo, el cliente decide, el
// inventario queda acotado a la sucursal del pedido. Flash conserva esa
// frontera; no presenta el flujo como productivo si el pedido no tiene sucursal.
import { useCallback, useEffect, useState } from "react";
import { MapPin, MessageCircle, RefreshCw, TriangleAlert, X } from "lucide-react";

import { api } from "../api";
import { money } from "../format";
import { orderStatusLabel } from "../labels";
import type { Order, OrderSubstitution, Restaurant } from "../types";

export function MerchantOrderDetailDialog({
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
