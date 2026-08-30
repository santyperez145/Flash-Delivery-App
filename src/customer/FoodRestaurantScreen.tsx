import { useState } from "react";
import { ArrowLeft, Bike, Clock3, Leaf, Search, ShoppingBag, Star } from "lucide-react";

import { itemMatchesDietary } from "../dietary";
import type { DietaryPreferences, MenuItem, Restaurant } from "../types";
import { IconButton } from "../ui/panels";
import { CategoryRail, FoodRow } from "./FoodCatalogComponents";
import { EmptyState } from "./EmptyState";

export function RestaurantDetail({
  restaurant,
  dietaryPreferences,
  cartCount,
  onBack,
  onOpenCart,
  onOpenItem,
}: {
  restaurant: Restaurant;
  dietaryPreferences: DietaryPreferences | null;
  cartCount: number;
  onBack: () => void;
  onOpenCart: () => void;
  onOpenItem: (item: MenuItem) => void;
}) {
  const [category, setCategory] = useState("Todo");
  const categories = ["Todo", ...Array.from(new Set(restaurant.menu.map((item) => item.category)))];
  const menu = restaurant.menu.filter(
    (item) =>
      (category === "Todo" || item.category === category) &&
      (!dietaryPreferences?.hideIncompatible || itemMatchesDietary(item, dietaryPreferences)),
  );
  return (
    <div className="screen detail-screen">
      <div className="restaurant-cover">
        <img src={restaurant.cover} alt={restaurant.name} />
        <div className="detail-topbar">
          <IconButton icon={ArrowLeft} label="Volver" onClick={onBack} />
          <IconButton icon={ShoppingBag} label="Carrito" badge={cartCount} onClick={onOpenCart} />
        </div>
      </div>
      <section className="detail-summary">
        <span className="badge warm">{restaurant.badge}</span>
        <h2>{restaurant.name}</h2>
        <p>
          {restaurant.cuisine} · {restaurant.address}
        </p>
        <div className="summary-grid">
          <span>
            <Star size={14} /> {restaurant.rating}
          </span>
          <span>
            <Bike size={14} /> {restaurant.distanceKm} km
          </span>
          <span>
            <Clock3 size={14} /> {restaurant.etaMin} min
          </span>
        </div>
      </section>
      <CategoryRail categories={categories} category={category} setCategory={setCategory} />
      {dietaryPreferences?.hideIncompatible && (
        <div className="dietary-filter-banner">
          <Leaf size={16} />
          <span>Filtro alimentario activo · sólo productos con declaraciones compatibles.</span>
        </div>
      )}
      <div className="item-list">
        {menu.map((item) => (
          <FoodRow
            key={item.id}
            item={item}
            restaurant={restaurant}
            onClick={() => onOpenItem(item)}
          />
        ))}
        {!menu.length && (
          <EmptyState
            icon={Search}
            title="Sin coincidencias declaradas"
            text="Probá otra categoría o revisá tu filtro alimentario en Perfil."
          />
        )}
      </div>
    </div>
  );
}
