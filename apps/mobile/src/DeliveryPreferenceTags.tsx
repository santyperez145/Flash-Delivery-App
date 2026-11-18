import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { flashDesign } from "./design-system";
import type { DeliveryPreferencesView } from "./types";

// Preferencias de entrega como etiquetas en la app móvil, según quién mira (P-02).
// Mismo criterio que `src/ui/DeliveryPreferenceTags.tsx` de la web:
// - `cocina`: el comercio ve si el pedido lleva cubiertos, y nada más.
// - `reparto`: quien entrega ve si es sin contacto y las indicaciones.

export function DeliveryPreferenceTags({
  preferences,
  audience,
}: {
  preferences?: DeliveryPreferencesView;
  audience: "cocina" | "reparto";
}) {
  if (!preferences) return null;
  if (audience === "cocina")
    return (
      <Etiqueta
        icono={preferences.cutlery ? "restaurant-outline" : "close-circle-outline"}
        texto={preferences.cutlery ? "Incluir cubiertos" : "Sin cubiertos"}
        tenue={!preferences.cutlery}
      />
    );
  const indicaciones = preferences.instructions?.trim();
  return (
    <>
      {preferences.dropoff === "leave_at_door" && (
        <Etiqueta icono="home-outline" texto="Dejar en la puerta" fuerte />
      )}
      {indicaciones ? (
        <Etiqueta icono="chatbox-ellipses-outline" texto={indicaciones} />
      ) : preferences.hasInstructions ? (
        <Etiqueta icono="chatbox-ellipses-outline" texto="Con indicaciones al aceptar" tenue />
      ) : null}
    </>
  );
}

function Etiqueta({
  icono,
  texto,
  fuerte,
  tenue,
}: {
  icono:
    | "restaurant-outline"
    | "close-circle-outline"
    | "home-outline"
    | "chatbox-ellipses-outline";
  texto: string;
  fuerte?: boolean;
  tenue?: boolean;
}) {
  return (
    <View style={[estilos.etiqueta, fuerte && estilos.fuerte]}>
      <Ionicons
        name={icono}
        size={14}
        color={tenue ? flashDesign.color.inkSoft : flashDesign.color.ink}
      />
      <Text style={[estilos.texto, fuerte && estilos.textoFuerte, tenue && estilos.textoTenue]}>
        {texto}
      </Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  etiqueta: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: flashDesign.color.surfaceMuted,
    borderRadius: 10,
  },
  fuerte: { backgroundColor: flashDesign.color.warningSoft },
  texto: { flex: 1, color: flashDesign.color.ink, fontSize: 13, lineHeight: 18 },
  textoFuerte: { fontWeight: "700" },
  textoTenue: { color: flashDesign.color.inkSoft },
});
