// Consola compacta de comercio (ARC-001).
//
// Superficie del phone-stage web. El escritorio vive en MerchantConsole.
// DoorDash/Uber Eats no mezclan este cockpit con driver ni ops.
import { type Dispatch, type SetStateAction } from "react";
import { Plus, Store } from "lucide-react";

import { api } from "../api";
import { money } from "../format";
import { OrderOpsCard, SectionTitle, TopBar } from "../ui/panels";
import type { AppState, Restaurant } from "../types";
import { MetricCard } from "./ops-primitives";

export function MerchantApp({
  state,
  restaurant,
  newDish,
  setNewDish,
  busy,
  runAction,
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
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const orders = state.orders.filter((order) => order.restaurantId === restaurant.id);
  const activeOrders = orders.filter((order) => !["delivered", "cancelled"].includes(order.status));
  const soldOutItems = restaurant.menu.filter((item) => !item.stock).length;
  const todayRevenue = orders.reduce((sum, order) => sum + order.total, 0);
  return (
    <div className="screen">
      <TopBar title="Comercio" actionIcon={Store} />
      <section className="merchant-hero">
        <img src={restaurant.cover} alt={restaurant.name} />
        <div>
          <span>{restaurant.open ? "Abierto" : "Pausado"}</span>
          <h2>{restaurant.name}</h2>
          <p>{restaurant.address}</p>
        </div>
      </section>
      <label className="toggle-row light">
        <span>
          <strong>Aceptar pedidos</strong>
          <small>{restaurant.open ? "Online" : "Pausado"}</small>
        </span>
        <input
          checked={restaurant.open}
          onChange={(event) =>
            runAction(
              () =>
                api.updateRestaurant(restaurant.id, {
                  open: event.target.checked,
                }),
              event.target.checked ? "Local abierto" : "Local pausado",
            )
          }
          type="checkbox"
          disabled={busy}
        />
      </label>
      <div className="merchant-command">
        <MetricCard label="Venta" value={todayRevenue} tone="orange" />
        <MetricCard label="Activos" value={activeOrders.length} tone="teal" />
        <MetricCard label="ETA" value={restaurant.etaMin} tone="green" />
        <MetricCard label="Sin stock" value={soldOutItems} tone="dark" />
      </div>
      <section className="prep-control">
        <div>
          <strong>Control de cocina</strong>
          <span>Ajusta ETA en vivo para proteger SLA y evitar cancelaciones.</span>
        </div>
        <div className="prep-actions">
          <button
            type="button"
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
            -5m
          </button>
          <button
            type="button"
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
            +5m
          </button>
        </div>
      </section>
      <SectionTitle title="Cocina" action={`${orders.length} pedidos`} />
      <div className="activity-stack">
        {orders.map((order) => (
          <OrderOpsCard
            key={order.id}
            order={order}
            restaurant={restaurant}
            driver={state.drivers.find((entry) => entry.id === order.courierId)}
            onAdvance={() => runAction(() => api.advanceOrder(order.id), "Pedido avanzado")}
            busy={busy}
          />
        ))}
      </div>
      <SectionTitle title="Menu" action="Stock" />
      <div className="menu-admin">
        {restaurant.menu.map((item) => (
          <label className="stock-row" key={item.id}>
            <img src={item.image} alt={item.name} />
            <span>
              <strong>{item.name}</strong>
              <small>{money.format(item.price)}</small>
            </span>
            <input
              checked={item.stock}
              onChange={(event) =>
                runAction(
                  () => api.updateMenuStock(restaurant.id, item.id, event.target.checked),
                  "Stock actualizado",
                )
              }
              type="checkbox"
              disabled={busy}
            />
          </label>
        ))}
      </div>
      <section className="new-dish">
        <h2>Alta rapida</h2>
        <input
          value={newDish.name}
          onChange={(event) => setNewDish((current) => ({ ...current, name: event.target.value }))}
        />
        <input
          value={newDish.description}
          onChange={(event) =>
            setNewDish((current) => ({
              ...current,
              description: event.target.value,
            }))
          }
        />
        <div className="two-fields">
          <input
            value={newDish.category}
            onChange={(event) =>
              setNewDish((current) => ({
                ...current,
                category: event.target.value,
              }))
            }
          />
          <input
            value={newDish.price}
            onChange={(event) =>
              setNewDish((current) => ({
                ...current,
                price: Number(event.target.value),
              }))
            }
            type="number"
          />
        </div>
        <button
          className="primary-button"
          type="button"
          disabled={busy}
          onClick={() =>
            runAction(() => api.addMenuItem(restaurant.id, newDish), "Producto creado")
          }
        >
          <Plus size={17} /> Agregar plato
        </button>
      </section>
    </div>
  );
}
