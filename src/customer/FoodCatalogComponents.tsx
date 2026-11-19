import { Clock3, Heart, ImageOff, Plus, Search, SlidersHorizontal, Star, X } from "lucide-react";

import { money } from "../format";
import type { MenuItem, Restaurant } from "../types";

/**
 * Cuántas calificaciones necesita un local para mostrar su promedio.
 *
 * Con dos o tres opiniones el promedio dice más de quién opinó que del local:
 * un 5,0 con dos votos no se compara con un 4,6 con 120. Por debajo del umbral
 * el local se presenta como «Nuevo», que es lo que es.
 */
export const MIN_MERCHANT_RATINGS = 10;

/** «4,6 (120)» con coma decimal, o null si el local todavía no llega al umbral. */
export function merchantRatingLabel(restaurant: Pick<Restaurant, "rating" | "ratingCount">) {
  const count = restaurant.ratingCount ?? 0;
  if (restaurant.rating == null || count < MIN_MERCHANT_RATINGS) return null;
  return `${restaurant.rating.toFixed(1).replace(".", ",")} (${count})`;
}

/** La calificación del local, o el chip «Nuevo» cuando todavía no hay suficientes. */
export function MerchantRating({
  restaurant,
  iconSize = 13,
}: {
  restaurant: Pick<Restaurant, "rating" | "ratingCount">;
  iconSize?: number;
}) {
  const label = merchantRatingLabel(restaurant);
  if (!label)
    return (
      <span
        style={{
          padding: "1px 7px",
          border: "1px solid var(--line)",
          borderRadius: 999,
          color: "var(--ink)",
        }}
      >
        Nuevo
      </span>
    );
  return (
    <span aria-label={`Calificación ${label}`}>
      <Star size={iconSize} /> {label}
    </span>
  );
}

/**
 * La foto del plato, o un recuadro «Sin foto» del mismo tamaño.
 *
 * Nunca la foto del local en su lugar: el cliente la leería como la foto del
 * plato que va a recibir.
 */
export function DishPhoto({
  item,
  size,
}: {
  item: Pick<MenuItem, "image" | "name">;
  size: number;
}) {
  if (item.image) return <img src={item.image} alt={item.name} />;
  return (
    <span
      role="img"
      aria-label={`${item.name}, sin foto`}
      style={{
        display: "grid",
        placeItems: "center",
        alignContent: "center",
        gap: 2,
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 8,
        background: "var(--paper-soft)",
        border: "1px solid var(--line)",
        color: "var(--muted)",
        fontSize: "0.66rem",
        fontWeight: 800,
      }}
    >
      <ImageOff size={16} />
      Sin foto
    </span>
  );
}

export function SearchBar({
  query,
  setQuery,
}: {
  query: string;
  setQuery: (query: string) => void;
}) {
  return (
    <div className="search-bar">
      <Search size={17} />
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="¿Qué querés pedir hoy?"
      />
      <button
        type="button"
        aria-label="Limpiar busqueda"
        title="Limpiar busqueda"
        onClick={() => setQuery("")}
      >
        {query ? <X size={17} /> : <SlidersHorizontal size={17} />}
      </button>
    </div>
  );
}

export function CategoryRail({
  categories,
  category,
  setCategory,
}: {
  categories: string[];
  category: string;
  setCategory: (category: string) => void;
}) {
  return (
    <div className="category-rail">
      {categories.map((entry) => (
        <button
          className={category === entry ? "category-pill active" : "category-pill"}
          key={entry}
          onClick={() => setCategory(entry)}
          type="button"
        >
          {entry}
        </button>
      ))}
    </div>
  );
}

export function RestaurantCard({
  restaurant,
  onClick,
  favorite,
  onToggleFavorite,
}: {
  restaurant: Restaurant;
  onClick: () => void;
  favorite: boolean;
  onToggleFavorite: () => void;
}) {
  return (
    <button className="restaurant-card" type="button" onClick={onClick}>
      <img src={restaurant.image} alt={restaurant.name} />
      <span className={restaurant.open ? "badge" : "badge closed"}>
        {restaurant.open ? restaurant.badge : "Cerrado"}
      </span>
      <div className="restaurant-card-body">
        <div>
          <strong>{restaurant.name}</strong>
          <span>{restaurant.cuisine}</span>
        </div>
        <Heart
          size={18}
          fill={favorite ? "currentColor" : "none"}
          role="button"
          aria-label={favorite ? "Quitar de favoritos" : "Agregar a favoritos"}
          tabIndex={0}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              onToggleFavorite();
            }
          }}
        />
      </div>
      <div className="restaurant-meta">
        <MerchantRating restaurant={restaurant} />
        <span>{restaurant.etaMin} min</span>
        <span>{money.format(restaurant.deliveryFee)}</span>
      </div>
    </button>
  );
}

export function FoodRow({
  item,
  restaurant,
  onClick,
}: {
  item: MenuItem;
  restaurant: Restaurant;
  onClick: () => void;
}) {
  return (
    <button
      className={item.stock ? "food-row" : "food-row disabled"}
      type="button"
      onClick={onClick}
      disabled={!item.stock}
    >
      <DishPhoto item={item} size={68} />
      <div className="food-row-main">
        <strong>{item.name}</strong>
        <span>{restaurant.name}</span>
        {/* Sin estrella por plato y sin minutos que el comercio no declaró. */}
        {item.timeMin ? (
          <div className="food-row-meta">
            <span>
              <Clock3 size={12} /> {item.timeMin} min
            </span>
          </div>
        ) : null}
      </div>
      <div className="price-block">
        <strong>{money.format(item.price)}</strong>
        <Plus size={16} />
      </div>
    </button>
  );
}
