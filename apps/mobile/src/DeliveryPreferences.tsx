import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { flashDesign } from "./design-system";
import type { DeliveryPreferences as Preferencias, MerchantVertical } from "./types";

// Preferencias de entrega en el checkout móvil (P-02).
//
// Mismo contrato que el componente web y que `server/delivery-preferences.js`:
// modo cerrado —en mano o en la puerta—, indicaciones de hasta 300 caracteres que
// sólo ve quien reparte, y cubiertos que por omisión no van. Los estilos viven
// acá y no en `styles.ts`, que es una hoja compartida de casi cinco mil líneas.

export const PREFERENCIAS_INICIALES: Preferencias = {
  dropoff: "hand_to_me",
  instructions: "",
  cutlery: false,
};
const MAX_INDICACIONES = 300;
// Las mismas que rechaza el servidor: farmacia y tiendas no se dejan en la puerta.
const RUBROS_SIN_PUERTA: MerchantVertical[] = ["pharmacy", "retail"];

export function DeliveryPreferences({
  value,
  onChange,
  vertical,
  pickup = false,
  disabled,
}: {
  value: Preferencias;
  onChange: (value: Preferencias) => void;
  vertical: MerchantVertical;
  /** En retiro no hay reparto: sólo se elige si lleva cubiertos. */
  pickup?: boolean;
  disabled: boolean;
}) {
  const sinPuerta = RUBROS_SIN_PUERTA.includes(vertical);
  const cambiar = (parcial: Partial<Preferencias>) => onChange({ ...value, ...parcial });
  const opcion = (
    modo: Preferencias["dropoff"],
    titulo: string,
    detalle: string,
    bloqueada: boolean,
  ) => {
    const activa = value.dropoff === modo;
    return (
      <Pressable
        key={modo}
        disabled={disabled || bloqueada}
        onPress={() => cambiar({ dropoff: modo })}
        style={[
          estilos.opcion,
          activa && estilos.opcionActiva,
          bloqueada && estilos.opcionBloqueada,
        ]}
        accessibilityRole="radio"
        accessibilityState={{ checked: activa, disabled: disabled || bloqueada }}
      >
        <Ionicons
          name={modo === "leave_at_door" ? "home-outline" : "hand-left-outline"}
          size={20}
          color={flashDesign.color.food}
        />
        <View style={estilos.opcionTexto}>
          <Text style={estilos.titulo}>{titulo}</Text>
          <Text style={estilos.detalle}>{detalle}</Text>
        </View>
      </Pressable>
    );
  };
  return (
    <View style={estilos.contenedor} accessibilityLabel="Preferencias de entrega">
      {!pickup && (
        <>
          <Text style={estilos.seccion}>Cómo te lo entregamos</Text>
          <View style={estilos.opciones} accessibilityRole="radiogroup">
            {opcion("hand_to_me", "En mano", "Te lo entregan en la puerta", false)}
            {opcion(
              "leave_at_door",
              "Dejar en la puerta",
              sinPuerta ? "No disponible en este comercio" : "Sin contacto",
              sinPuerta,
            )}
          </View>
          <Text style={estilos.seccion}>Indicaciones para quien reparte</Text>
          <TextInput
            value={value.instructions}
            onChangeText={(texto) => cambiar({ instructions: texto })}
            maxLength={MAX_INDICACIONES}
            editable={!disabled}
            multiline
            placeholder="Piso, timbre, cómo encontrar la entrada"
            placeholderTextColor={flashDesign.color.muted}
            style={estilos.campo}
            accessibilityLabel="Indicaciones para quien reparte"
          />
          <Text style={estilos.detalle}>
            Las ve sólo quien reparte · {value.instructions.length}/{MAX_INDICACIONES}
          </Text>
        </>
      )}
      <View style={estilos.cubiertos}>
        <Ionicons name="restaurant-outline" size={18} color={flashDesign.color.ink} />
        <Text style={[estilos.titulo, estilos.cubiertosTexto]}>
          Incluir cubiertos y servilletas
        </Text>
        <Switch
          value={value.cutlery}
          disabled={disabled}
          onValueChange={(cutlery) => cambiar({ cutlery })}
          accessibilityLabel="Incluir cubiertos y servilletas"
        />
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  contenedor: {
    gap: 8,
    marginHorizontal: flashDesign.space.md,
    marginBottom: flashDesign.space.md,
  },
  seccion: { color: flashDesign.color.ink, fontSize: 15, fontWeight: "800", marginTop: 6 },
  opciones: { gap: 8 },
  opcion: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    backgroundColor: flashDesign.color.surface,
    borderWidth: 1,
    borderColor: flashDesign.color.line,
    borderRadius: 14,
  },
  opcionActiva: {
    borderColor: flashDesign.color.food,
    backgroundColor: flashDesign.color.warningSoft,
  },
  opcionBloqueada: { opacity: 0.55 },
  opcionTexto: { flex: 1, minWidth: 0 },
  titulo: { color: flashDesign.color.ink, fontSize: 14, fontWeight: "700" },
  detalle: { color: flashDesign.color.inkSoft, fontSize: 12 },
  campo: {
    minHeight: 64,
    padding: 12,
    color: flashDesign.color.ink,
    fontSize: 14,
    textAlignVertical: "top",
    backgroundColor: flashDesign.color.surface,
    borderWidth: 1,
    borderColor: flashDesign.color.line,
    borderRadius: 14,
  },
  cubiertos: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    backgroundColor: flashDesign.color.surface,
    borderRadius: 14,
  },
  cubiertosTexto: { flex: 1 },
});
