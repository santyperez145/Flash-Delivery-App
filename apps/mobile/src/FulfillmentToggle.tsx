import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { flashDesign } from "./design-system";
import { money } from "./format";
import type { Restaurant } from "./types";

// Envío o retiro en el local, en el carrito móvil (P-11).
//
// El servidor y la web ofrecían el retiro desde GTM-002; la app móvil, que es la
// superficie principal del cliente, no. Se elige en el carrito, antes de cotizar,
// como en PedidosYa: el modo decide si hace falta dirección, si hay envío en el
// precio y si se puede dejar propina. Sólo aparece si alguna sucursal lo habilitó.

export type Fulfillment = "delivery" | "pickup";

/**
 * La sucursal donde se retira: la principal si lo ofrece, si no la primera que
 * lo haga. Su id viaja al cotizar, así la que se muestra es la que cotiza.
 */
export function sucursalConRetiro(restaurant?: Restaurant | null) {
  // Sólo una sucursal que hoy puede atender: el servidor cotiza el retiro únicamente
  // en una activa, abierta y dentro de su horario (`branch.open` ya lo resume).
  const disponibles = (restaurant?.branches || []).filter(
    (branch) => branch.pickupEnabled && branch.status === "active" && branch.open,
  );
  return disponibles.find((branch) => branch.isPrimary) || disponibles[0] || null;
}

export function FulfillmentToggle({
  value,
  onChange,
  deliveryFee,
  pickupAddress,
  disabled,
}: {
  value: Fulfillment;
  onChange: (value: Fulfillment) => void;
  deliveryFee: number;
  /** La dirección de la sucursal que acepta retiro. */
  pickupAddress: string;
  disabled: boolean;
}) {
  const opcion = (
    modo: Fulfillment,
    icono: "bicycle-outline" | "storefront-outline",
    titulo: string,
    detalle: string,
  ) => {
    const activa = value === modo;
    return (
      <Pressable
        key={modo}
        onPress={() => onChange(modo)}
        disabled={disabled}
        style={[estilos.opcion, activa && estilos.activa]}
        accessibilityRole="radio"
        accessibilityState={{ checked: activa, disabled }}
      >
        <Ionicons name={icono} size={20} color={flashDesign.color.food} />
        <View style={estilos.texto}>
          <Text style={estilos.titulo}>{titulo}</Text>
          <Text style={estilos.detalle} numberOfLines={2}>
            {detalle}
          </Text>
        </View>
      </Pressable>
    );
  };
  return (
    <View style={estilos.grupo} accessibilityRole="radiogroup" accessibilityLabel="Modo de entrega">
      {opcion("delivery", "bicycle-outline", "Envío", `Envío ${money.format(deliveryFee)}`)}
      {opcion("pickup", "storefront-outline", "Retiro en el local", `Sin envío · ${pickupAddress}`)}
    </View>
  );
}

const estilos = StyleSheet.create({
  grupo: { flexDirection: "row", gap: 8, marginHorizontal: flashDesign.space.md, marginBottom: 8 },
  opcion: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    backgroundColor: flashDesign.color.surface,
    borderWidth: 1,
    borderColor: flashDesign.color.line,
    borderRadius: 14,
  },
  activa: { borderColor: flashDesign.color.food, backgroundColor: flashDesign.color.warningSoft },
  texto: { flex: 1, minWidth: 0 },
  titulo: { color: flashDesign.color.ink, fontSize: 14, fontWeight: "700" },
  detalle: { color: flashDesign.color.inkSoft, fontSize: 12 },
});
