import { Sparkles, Tag } from "lucide-react";

import { money } from "../format";
import type { AppState, MenuItem, MerchantVertical, Restaurant } from "../types";
import { SectionTitle } from "../ui/panels";
import { Beneficios, useSubscription } from "./SubscriptionPanel";
import { CategoryRail, FoodRow, RestaurantCard, SearchBar } from "./FoodCatalogComponents";
import { useVerticalScope, VerticalRail } from "./VerticalRail";

export function FoodDiscoveryHome({
  restaurants,
  allItems,
  query,
  setQuery,
  category,
  setCategory,
  categories,
  state,
  onToggleFavorite,
  onOpenRestaurant,
  onOpenItem,
  onOpenSubscription,
  initialVertical,
}: {
  restaurants: Restaurant[];
  allItems: Array<{ restaurant: Restaurant; item: MenuItem }>;
  query: string;
  setQuery: (query: string) => void;
  category: string;
  setCategory: (category: string) => void;
  categories: string[];
  /** Favoritos y promociones: datos reales de la cuenta, no textos fijos. */
  state: Pick<AppState, "favoriteRestaurantIds" | "promotions">;
  onToggleFavorite: (restaurantId: string, favorite: boolean) => void;
  onOpenRestaurant: (restaurant: Restaurant) => void;
  onOpenItem: (restaurant: Restaurant, item: MenuItem) => void;
  onOpenSubscription: () => void;
  initialVertical?: MerchantVertical;
}) {
  const scope = useVerticalScope(
    { restaurants, allItems, categories, query, setCategory },
    initialVertical,
  );
  restaurants = scope.restaurants;
  allItems = scope.items;
  const favoriteRestaurantIds = state.favoriteRestaurantIds || [];
  // RES-03: como Uber Eats y PedidosYa, la portada abre con el buscador, los rubros y
  // las promociones vigentes. Sólo las reales: sin promoción activa no hay tarjeta.
  const promociones = state.promotions.filter((p) => p.active && p.service === "food");
  return (
    <>
      <SearchBar query={query} setQuery={setQuery} />
      <VerticalRail {...scope.rail} />
      {promociones.length > 0 && (
        <section className="promo-rail" aria-label="Promociones vigentes">
          {promociones.map((promocion) => (
            <article key={promocion.id}>
              <Tag size={16} />
              <strong>{promocion.title}</strong>
              <span>{promocion.description}</span>
              {promocion.code && <small>Código {promocion.code}</small>}
            </article>
          ))}
        </section>
      )}
      <FlashPassTeaser onOpen={onOpenSubscription} />
      <CategoryRail categories={scope.categories} category={category} setCategory={setCategory} />
      <SectionTitle title="Cerca tuyo" action="Abiertos" />
      {!restaurants.length && <p className="vertical-empty">Sin comercios para mostrar acá.</p>}
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
      <SectionTitle title="Platos de comercios abiertos" />
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
