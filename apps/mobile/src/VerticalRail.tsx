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
  categories,
}: {
  restaurants: Restaurant[];
  categories: C[];
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
  const visibles = restaurants.filter((restaurant) => rubroDe(restaurant) === vertical);
  const enRubro = new Set(
    visibles.flatMap((restaurant) => restaurant.menu.map((item) => item.category)),
  );
  return {
    vertical,
    label: RUBROS[vertical].label,
    rail: { verticals, vertical, onChange: setVertical },
    restaurants: visibles,
    // «Todos» siempre; el resto, sólo las categorías que el rubro elegido tiene.
    categories: categories.filter((entry) => entry.name === "Todos" || enRubro.has(entry.name)),
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
