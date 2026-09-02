// Sucursales, horario e inventario local (ARC-001).
//
// DoorDash y Uber Eats Manager separan store hours / availability del menú
// global. Flash deja pause, ETA, horarios semanales e inventario por sede
// aquí; un cambio no se propaga a otras sucursales.
import { MapPin } from "lucide-react";

import { api } from "../api";
import { BranchScheduleEditor } from "./MerchantCatalogEditors";
import type { Restaurant } from "../types";

type RunAction = (action: () => Promise<unknown>, success: string) => void;

export function MerchantStoreHours({
  restaurant,
  busy,
  runAction,
}: {
  restaurant: Restaurant;
  busy: boolean;
  runAction: RunAction;
}) {
  return (
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
  );
}
