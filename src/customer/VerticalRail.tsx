import { useEffect, useState, type ComponentType } from "react";
import { Candy, Pill, ShoppingBag, ShoppingBasket, UtensilsCrossed } from "lucide-react";

import { api } from "../api";
import type { CatalogVertical, MenuItem, MerchantVertical, Restaurant } from "../types";

// Rubros de comercio en la portada (P-01).
//
// PedidosYa y Uber Eats abren su portada con accesos por rubro —restaurantes,
// súper, farmacia, kiosco, tiendas—. En Flash el rubro existía en la base desde la
// migración 001 y ninguna pantalla lo mostraba: un comercio que no era
// restaurante aparecía mezclado entre las parrillas o no aparecía.

const RUBROS: Record<MerchantVertical, { label: string; Icon: ComponentType<{ size?: number }> }> =
  {
    restaurant: { label: "Restaurantes", Icon: UtensilsCrossed },
    grocery: { label: "Súper", Icon: ShoppingBasket },
    pharmacy: { label: "Farmacia", Icon: Pill },
    kiosk: { label: "Kiosco", Icon: Candy },
    retail: { label: "Tiendas", Icon: ShoppingBag },
  };

export const rubroDe = (restaurant: Restaurant): MerchantVertical =>
  restaurant.vertical ?? "restaurant";

/**
 * El rubro elegido y lo que la portada muestra con él.
 *
 * Los rubros salen del resumen del servidor y no de los comercios cargados: el
 * cliente tiene una página de cada uno, y contar sobre eso diría «3 farmacias»
 * donde hay cuarenta.
 *
 * **Con una búsqueda escrita el rubro deja de filtrar.** Quien busca «hielo»
 * desde Restaurantes quiere el kiosco que lo vende, no una lista vacía.
 */
export function useVerticalScope({
  restaurants,
  allItems,
  categories,
  query,
  setCategory,
}: {
  restaurants: Restaurant[];
  allItems: Array<{ restaurant: Restaurant; item: MenuItem }>;
  categories: string[];
  query: string;
  setCategory: (category: string) => void;
}) {
  const [vertical, setVertical] = useState<MerchantVertical>("restaurant");
  const [verticals, setVerticals] = useState<CatalogVertical[]>([]);
  useEffect(() => {
    let activo = true;
    api
      .getCatalogVerticals()
      .then((response) => activo && setVerticals(response.verticals))
      .catch(() => activo && setVerticals([]));
    return () => {
      activo = false;
    };
  }, []);
  const buscando = Boolean(query.trim());
  const enRubro = (restaurant: Restaurant) => buscando || rubroDe(restaurant) === vertical;
  const items = allItems.filter(({ restaurant }) => enRubro(restaurant));
  return {
    // Cambiar de rubro vuelve a «Todo»: una categoría del rubro anterior dejaría
    // la lista vacía sin que se vea por qué.
    rail: {
      verticals,
      vertical,
      onChange: (rubro: MerchantVertical) => {
        setVertical(rubro);
        setCategory("Todo");
      },
    },
    restaurants: restaurants.filter(enRubro),
    items,
    // Las categorías del rubro elegido: «Lácteos» no es una opción en Restaurantes.
    categories: categories.filter(
      (entry) => entry === "Todo" || items.some(({ item }) => item.category === entry),
    ),
  };
}

export function VerticalRail({
  verticals,
  vertical,
  onChange,
}: {
  verticals: CatalogVertical[];
  vertical: MerchantVertical;
  onChange: (vertical: MerchantVertical) => void;
}) {
  // Con un solo rubro no hay nada que elegir, y un acceso único es ruido.
  if (verticals.length <= 1) return null;
  return (
    <nav className="vertical-rail" aria-label="Rubros de comercio">
      {verticals.map(({ vertical: rubro, merchants }) => {
        const { label, Icon } = RUBROS[rubro];
        return (
          <button
            key={rubro}
            type="button"
            className={rubro === vertical ? "vertical-tile active" : "vertical-tile"}
            aria-pressed={rubro === vertical}
            onClick={() => onChange(rubro)}
          >
            <span className="vertical-icon">
              <Icon size={20} />
            </span>
            <strong>{label}</strong>
            <small>
              {merchants} {merchants === 1 ? "comercio" : "comercios"}
            </small>
          </button>
        );
      })}
    </nav>
  );
}
