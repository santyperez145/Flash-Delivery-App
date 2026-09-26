// Catálogo y stock de comercio (ARC-001).
//
// Uber Eats Manager y DoorDash Merchant aíslan menú/86 de la cola en vivo.
// Flash deja alta, stock global y editores de modificadores/dieta aquí; el
// inventario por sucursal vive en MerchantStoreHours.
import type { Dispatch, SetStateAction } from "react";
import { Plus } from "lucide-react";

import { api } from "../api";
import { money } from "../format";
import { AdminSectionHeader } from "../ui/panels";
import { DietaryCatalogEditor, ModifierCatalogEditor } from "./MerchantCatalogEditors";
import type { Restaurant } from "../types";

type RunAction = (action: () => Promise<unknown>, success: string) => void;
type NewDish = {
  name: string;
  description: string;
  category: string;
  price: number;
};

export function MerchantStoreCatalog({
  restaurant,
  newDish,
  setNewDish,
  busy,
  runAction,
}: {
  restaurant: Restaurant;
  newDish: NewDish;
  setNewDish: Dispatch<SetStateAction<NewDish>>;
  busy: boolean;
  runAction: RunAction;
}) {
  return (
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
  );
}
