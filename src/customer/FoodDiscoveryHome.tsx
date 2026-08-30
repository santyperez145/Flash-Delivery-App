import { Clock3, LocateFixed, ShieldCheck, Sparkles, UserRound } from "lucide-react";

import { money } from "../format";
import type { MenuItem, Restaurant } from "../types";
import { SectionTitle } from "../ui/panels";
import { Beneficios, useSubscription } from "./SubscriptionPanel";
import { CategoryRail, FoodRow, RestaurantCard, SearchBar } from "./FoodCatalogComponents";

export function FoodDiscoveryHome({
  restaurants,
  allItems,
  query,
  setQuery,
  category,
  setCategory,
  categories,
  favoriteRestaurantIds,
  onToggleFavorite,
  onOpenRestaurant,
  onOpenItem,
  onOpenSubscription,
}: {
  restaurants: Restaurant[];
  allItems: Array<{ restaurant: Restaurant; item: MenuItem }>;
  query: string;
  setQuery: (query: string) => void;
  category: string;
  setCategory: (category: string) => void;
  categories: string[];
  favoriteRestaurantIds: string[];
  onToggleFavorite: (restaurantId: string, favorite: boolean) => void;
  onOpenRestaurant: (restaurant: Restaurant) => void;
  onOpenItem: (restaurant: Restaurant, item: MenuItem) => void;
  onOpenSubscription: () => void;
}) {
  const featuredRestaurant =
    restaurants.find((restaurant) => restaurant.open) || restaurants[0] || allItems[0]?.restaurant;
  const heroImage = featuredRestaurant?.cover || featuredRestaurant?.image;
  return (
    <>
      {heroImage && (
        <section className="promo-card">
          <img src={heroImage} alt={`Promoción de ${featuredRestaurant.name}`} />
          <div className="promo-overlay">
            <span>Hot deal</span>
            <h2>Comida en minutos</h2>
            <p>Pedidos, tracking y reparto con backend activo.</p>
          </div>
        </section>
      )}
      <FlashPassTeaser onOpen={onOpenSubscription} />
      <FlashPromiseGrid />
      <SearchBar query={query} setQuery={setQuery} />
      <CategoryRail categories={categories} category={category} setCategory={setCategory} />
      <SectionTitle title="Cerca tuyo" action="Abiertos" />
      <div className="restaurant-rail">
        {restaurants.map((restaurant) => (
          <RestaurantCard
            key={restaurant.id}
            restaurant={restaurant}
            favorite={favoriteRestaurantIds.includes(restaurant.id)}
            onToggleFavorite={() =>
              onToggleFavorite(restaurant.id, !favoriteRestaurantIds.includes(restaurant.id))
            }
            onClick={() => onOpenRestaurant(restaurant)}
          />
        ))}
      </div>
      <SectionTitle title="Mas pedidos" action="Filtros" />
      <div className="item-list">
        {allItems.slice(0, 7).map(({ restaurant, item }) => (
          <FoodRow
            key={`${restaurant.id}-${item.id}`}
            item={item}
            restaurant={restaurant}
            onClick={() => onOpenItem(restaurant, item)}
          />
        ))}
      </div>
    </>
  );
}

function FlashPassTeaser({ onOpen }: { onOpen: () => void }) {
  const { planes, suscripcion, cargando } = useSubscription();
  const plan = planes[0];
  if (cargando || suscripcion || !plan) return null;
  return (
    <button type="button" className="flash-pass" onClick={onOpen}>
      <div>
        <span>{plan.planName}</span>
        <Beneficios plan={plan} />
      </div>
      <span className="flash-pass-status">
        <Sparkles size={15} /> {money.format(plan.priceCents / 100)} / {plan.billingPeriodDays} días
      </span>
    </button>
  );
}

function FlashPromiseGrid() {
  const promises = [
    ["Tracking vivo", "Mapa + ETA", LocateFixed],
    ["Garantia", "Credito si falla", ShieldCheck],
    ["Sustituciones", "Vos elegis el reemplazo", UserRound],
    ["Programar", "Food o taxi", Clock3],
  ] as const;
  return (
    <div className="promise-grid">
      {promises.map(([title, detail, Icon]) => (
        <article key={title}>
          <Icon size={16} />
          <strong>{title}</strong>
          <span>{detail}</span>
        </article>
      ))}
    </div>
  );
}
