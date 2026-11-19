import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { flashDesign } from "./design-system";
import { money } from "./format";

// Cómo se paga un viaje (PAG-01): Flash Wallet o efectivo al conductor, como Uber en
// Argentina. Mismo comportamiento que la web.

export type RidePaymentMethod = "Flash Wallet" | "Efectivo";

export function RidePaymentPicker({
  value,
  fare,
  onChange,
}: {
  value: RidePaymentMethod;
  fare: number | null;
  onChange: (value: RidePaymentMethod) => void;
}) {
  return (
    <View style={estilos.caja}>
      <View style={estilos.fila} accessibilityRole="radiogroup" accessibilityLabel="Cómo pagás">
        {(["Flash Wallet", "Efectivo"] as const).map((metodo) => {
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
                name={metodo === "Efectivo" ? "cash-outline" : "wallet-outline"}
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
    </View>
  );
}

const estilos = StyleSheet.create({
  caja: { gap: flashDesign.space.xs, marginVertical: flashDesign.space.xs },
  fila: { flexDirection: "row", gap: flashDesign.space.xs },
  opcion: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    minHeight: flashDesign.control.touch,
    borderRadius: flashDesign.radius.control,
    borderWidth: 1,
    borderColor: flashDesign.color.line,
    backgroundColor: flashDesign.color.surface,
  },
  opcionActiva: { backgroundColor: flashDesign.color.ink, borderColor: flashDesign.color.ink },
  texto: { color: flashDesign.color.ink, fontWeight: "800" },
  textoActivo: { color: "#fff" },
  nota: { color: flashDesign.color.inkSoft, fontSize: flashDesign.type.metadata },
});
