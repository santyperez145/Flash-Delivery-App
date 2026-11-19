import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { flashDesign } from "./design-system";
import { FAMILY_PAYMENT, familyPaymentNote, type FamilyMembership } from "./family-payment";
import { money } from "./format";
import type { FamilyPaymentLabel } from "./types";

// Cómo se paga un viaje (PAG-01): Flash Wallet o efectivo al conductor, como Uber en
// Argentina. Con PAG-05 se suma «Perfil familiar», sólo para quien es miembro activo:
// paga la Wallet de quien organiza. Los envíos usan el mismo selector sin efectivo,
// porque el servidor no acepta efectivo en un envío. Mismo comportamiento que la web.

export type RidePaymentMethod = "Flash Wallet" | "Efectivo" | FamilyPaymentLabel;

const iconos: Record<RidePaymentMethod, keyof typeof Ionicons.glyphMap> = {
  "Flash Wallet": "wallet-outline",
  Efectivo: "cash-outline",
  "Perfil familiar": "people-outline",
};

export function RidePaymentPicker({
  value,
  fare,
  onChange,
  family = null,
  cash = true,
}: {
  value: RidePaymentMethod;
  fare: number | null;
  onChange: (value: RidePaymentMethod) => void;
  /** La membresía activa del perfil familiar; sin ella la opción no aparece. */
  family?: FamilyMembership | null;
  /** `false` en envíos: no se pagan en efectivo. */
  cash?: boolean;
}) {
  const metodos: RidePaymentMethod[] = [
    "Flash Wallet",
    ...(cash ? (["Efectivo"] as const) : []),
    ...(family ? [FAMILY_PAYMENT] : []),
  ];
  return (
    <View style={estilos.caja}>
      <View style={estilos.fila} accessibilityRole="radiogroup" accessibilityLabel="Cómo pagás">
        {metodos.map((metodo) => {
          const activo = value === metodo;
          return (
            <Pressable
              key={metodo}
              accessibilityRole="radio"
              accessibilityState={{ checked: activo }}
              onPress={() => onChange(metodo)}
              style={[estilos.opcion, activo && estilos.opcionActiva]}
            >
              <Ionicons
                name={iconos[metodo]}
                size={18}
                color={activo ? "#fff" : flashDesign.color.ink}
              />
              <Text style={[estilos.texto, activo && estilos.textoActivo]}>{metodo}</Text>
            </Pressable>
          );
        })}
      </View>
      {value === "Efectivo" ? (
        <Text style={estilos.nota}>
          Le pagás {fare !== null ? money.format(fare) : "el total"} en efectivo al conductor al
          terminar el viaje.
        </Text>
      ) : null}
      {value === FAMILY_PAYMENT && family ? (
        <Text style={estilos.nota}>{familyPaymentNote(family)}</Text>
      ) : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  caja: { gap: flashDesign.space.xs, marginVertical: flashDesign.space.xs },
  // Con tres opciones en un teléfono angosto, el texto baja de línea dentro del
  // botón en vez de empujar la fila fuera de la pantalla.
  fila: { flexDirection: "row", gap: flashDesign.space.xs },
  opcion: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    minHeight: flashDesign.control.touch,
    paddingHorizontal: 6,
    borderRadius: flashDesign.radius.control,
    borderWidth: 1,
    borderColor: flashDesign.color.line,
    backgroundColor: flashDesign.color.surface,
  },
  opcionActiva: { backgroundColor: flashDesign.color.ink, borderColor: flashDesign.color.ink },
  texto: { flexShrink: 1, color: flashDesign.color.ink, fontWeight: "800", textAlign: "center" },
  textoActivo: { color: "#fff" },
  nota: { color: flashDesign.color.inkSoft, fontSize: flashDesign.type.metadata },
});
