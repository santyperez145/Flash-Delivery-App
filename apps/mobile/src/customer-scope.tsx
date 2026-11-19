import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ServicioCliente } from "./customer-services";
import { flashDesign } from "./design-system";

// Pedidos y Viajes son dos experiencias separadas (FE-02), como Uber Eats y Uber y
// como la web desde FE-01: cada una con su inicio, sus servicios y su actividad.
//
// - **Pedidos**: comida, súper, farmacia, kiosco y tiendas.
// - **Viajes**: viajes y envíos de paquetes (Uber también ofrece los envíos desde
//   su app de viajes).
//
// La elección se recuerda en el teléfono. No es un dato sensible: va a AsyncStorage
// y no al llavero, y si no se puede leer se arranca en Pedidos.

export type Ambito = "pedidos" | "viajes";

const CLAVE = "flash.ambito";

export function useAmbito() {
  const [ambito, setAmbito] = useState<Ambito>("pedidos");
  useEffect(() => {
    let vigente = true;
    AsyncStorage.getItem(CLAVE)
      .then((guardado) => vigente && guardado === "viajes" && setAmbito("viajes"))
      .catch(() => undefined);
    return () => {
      vigente = false;
    };
  }, []);
  const cambiar = (siguiente: Ambito) => {
    setAmbito(siguiente);
    // Sin almacenamiento, la elección vale para esta sesión de la app.
    void AsyncStorage.setItem(CLAVE, siguiente).catch(() => undefined);
  };
  return { ambito, cambiar };
}

/** A qué ámbito pertenece un servicio: los rubros son Pedidos; viajes y envíos, Viajes. */
export const ambitoDe = (servicio: ServicioCliente): Ambito =>
  servicio.tipo === "vertical" ? "pedidos" : "viajes";

export function AmbitoSwitch({
  ambito,
  onChange,
}: {
  ambito: Ambito;
  onChange: (ambito: Ambito) => void;
}) {
  const opciones = [
    { id: "pedidos" as const, rotulo: "Pedidos", icono: "bag-handle-outline" as const },
    { id: "viajes" as const, rotulo: "Viajes", icono: "car-sport-outline" as const },
  ];
  return (
    <View style={estilos.caja} accessibilityRole="tablist" accessibilityLabel="Pedidos o Viajes">
      {opciones.map((opcion) => {
        const activa = ambito === opcion.id;
        return (
          <Pressable
            key={opcion.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: activa }}
            onPress={() => !activa && onChange(opcion.id)}
            style={[estilos.opcion, activa && estilos.opcionActiva]}
          >
            <Ionicons
              name={opcion.icono}
              size={17}
              color={activa ? "#fff" : flashDesign.color.inkSoft}
            />
            <Text style={[estilos.rotulo, activa && estilos.rotuloActivo]}>{opcion.rotulo}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const estilos = StyleSheet.create({
  caja: {
    flexDirection: "row",
    gap: 4,
    marginHorizontal: flashDesign.space.md,
    marginTop: flashDesign.space.sm,
    padding: 4,
    borderRadius: flashDesign.radius.pill,
    backgroundColor: flashDesign.color.surfaceMuted,
  },
  opcion: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
    borderRadius: flashDesign.radius.pill,
  },
  opcionActiva: { backgroundColor: flashDesign.color.ink },
  rotulo: { color: flashDesign.color.inkSoft, fontSize: 14, fontWeight: "800" },
  rotuloActivo: { color: "#fff" },
});
