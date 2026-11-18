import { useEffect, useState, type ComponentProps } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "./api";
import { flashDesign } from "./design-system";
import type { CatalogVertical, MerchantVertical, Restaurant } from "./types";

// Rubros de comercio en la portada móvil (P-01).
//
// PedidosYa y Uber Eats abren su portada con accesos por rubro. En Flash el rubro
// existía en la base desde la migración 001 y ninguna pantalla lo mostraba. Los
// estilos viven acá y no en `styles.ts` para no hacer crecer la hoja compartida.

type IconName = ComponentProps<typeof Ionicons>["name"];
const RUBROS: Record<MerchantVertical, { label: string; icon: IconName }> = {
  restaurant: { label: "Restaurantes", icon: "restaurant-outline" },
  grocery: { label: "Súper", icon: "basket-outline" },
  pharmacy: { label: "Farmacia", icon: "medkit-outline" },
  kiosk: { label: "Kiosco", icon: "ice-cream-outline" },
  retail: { label: "Tiendas", icon: "bag-handle-outline" },
};

export const rubroDe = (restaurant: Restaurant): MerchantVertical =>
  restaurant.vertical ?? "restaurant";

/**
 * El rubro elegido y lo que la portada muestra con él. Los rubros salen del
 * resumen del servidor y no de los comercios cargados, que son sólo una página de
 * cada uno: contar sobre eso diría «3 farmacias» donde hay cuarenta.
 */
export function useVerticalScope<C extends { name: string }>({
  restaurants,
  allRestaurants,
  categories,
  onSelectCategory,
}: {
  restaurants: Restaurant[];
  /** El catálogo sin filtrar por cocina: las categorías se calculan sobre él. */
  allRestaurants: Restaurant[];
  categories: C[];
  onSelectCategory: (category: string) => void;
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
  // **El rubro activo tiene que existir en el resumen.** Arranca en
  // «restaurant», pero un catálogo que sólo tiene farmacias no tiene ese rubro, y
  // la barra se oculta con uno solo: sin esto la portada quedaba vacía y sin
  // forma de elegir. Si el resumen falla o no llegó, no se filtra por rubro.
  const activo: MerchantVertical | null = !verticals.length
    ? null
    : verticals.some((entry) => entry.vertical === vertical)
      ? vertical
      : verticals[0].vertical;
  const delRubro = (restaurant: Restaurant) => activo === null || rubroDe(restaurant) === activo;
  // En el móvil las categorías de la portada son **cocinas** («Parrilla urbana»),
  // no categorías de menú: se quedan las cocinas de los comercios del rubro, y se
  // calculan sobre el catálogo entero, no sobre el ya filtrado por una cocina.
  const cocinas = new Set(
    allRestaurants.filter(delRubro).map((restaurant) => restaurant.cuisine.trim() || "Otros"),
  );
  const rubro = activo ?? "restaurant";
  return {
    vertical: rubro,
    label: RUBROS[rubro].label,
    rail: {
      verticals,
      vertical: rubro,
      // Cambiar de rubro vuelve a «Todos»: la cocina del rubro anterior dejaría
      // el nuevo vacío sin que se vea por qué.
      onChange: (siguiente: MerchantVertical) => {
        setVertical(siguiente);
        onSelectCategory("Todos");
      },
    },
    restaurants: restaurants.filter(delRubro),
    categories: categories.filter((entry) => entry.name === "Todos" || cocinas.has(entry.name)),
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
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={estilos.rail}
      accessibilityRole="tablist"
      accessibilityLabel="Rubros de comercio"
    >
      {verticals.map(({ vertical: rubro, merchants }) => {
        const activo = rubro === vertical;
        return (
          <Pressable
            key={rubro}
            onPress={() => onChange(rubro)}
            style={[estilos.tile, activo && estilos.tileActivo]}
            accessibilityRole="tab"
            accessibilityState={{ selected: activo }}
            accessibilityLabel={`${RUBROS[rubro].label}, ${merchants} ${merchants === 1 ? "comercio" : "comercios"}`}
          >
            <View style={estilos.icono}>
              <Ionicons name={RUBROS[rubro].icon} size={22} color={flashDesign.color.food} />
            </View>
            <Text style={estilos.nombre} numberOfLines={1}>
              {RUBROS[rubro].label}
            </Text>
            <Text style={estilos.cantidad} numberOfLines={1}>
              {merchants} {merchants === 1 ? "comercio" : "comercios"}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  rail: { gap: 10, paddingHorizontal: flashDesign.space.md, paddingBottom: flashDesign.space.xs },
  tile: {
    alignItems: "center",
    gap: 4,
    minWidth: 88,
    paddingVertical: 10,
    paddingHorizontal: 8,
    backgroundColor: flashDesign.color.surfaceMuted,
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 16,
  },
  tileActivo: {
    borderColor: flashDesign.color.food,
    backgroundColor: flashDesign.color.warningSoft,
  },
  icono: {
    alignItems: "center",
    justifyContent: "center",
    width: 42,
    height: 42,
    backgroundColor: flashDesign.color.surface,
    borderRadius: 12,
  },
  nombre: { color: flashDesign.color.ink, fontSize: 13, fontWeight: "700" },
  cantidad: { color: flashDesign.color.inkSoft, fontSize: 11 },
});
