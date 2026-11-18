import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { api } from "./api";
import { flashDesign } from "./design-system";
import type { GeoPoint, Ride, RideTripCheck } from "./types";

// Control del viaje (SEG-01), como RideCheck de Uber: cuando el auto está detenido,
// se pierde la señal del conductor, se aleja del recorrido o el viaje termina lejos
// del destino, Flash pregunta si está todo bien. «Pedir ayuda» abre un incidente
// de seguridad en la misma cola que el SOS. Mismo texto que la web.

export const tripCheckCopy: Record<RideTripCheck["kind"], { title: string; body: string }> = {
  long_stop: {
    title: "¿Todo bien en tu viaje?",
    body: "Notamos que el auto está detenido hace varios minutos.",
  },
  signal_lost: {
    title: "¿Todo bien en tu viaje?",
    body: "Dejamos de recibir la ubicación del conductor.",
  },
  route_deviation: {
    title: "¿Todo bien en tu viaje?",
    body: "El auto se alejó del recorrido hacia tu destino.",
  },
  early_end: { title: "¿Llegaste bien?", body: "El viaje terminó lejos de tu destino." },
};

export function TripCheckBanner({ ride, location }: { ride: Ride; location?: GeoPoint }) {
  // La respuesta se guarda con el aviso al que contesta: si después llega otro aviso
  // del mismo viaje, se pregunta de nuevo en lugar de quedar oculto.
  const [respuesta, setRespuesta] = useState<{
    checkId: string;
    estado: "busy" | "ok" | "help";
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const check = ride.tripCheck;
  const estado = check && respuesta?.checkId === check.id ? respuesta.estado : "idle";
  if (!check || estado === "ok") return null;
  const copy = tripCheckCopy[check.kind];

  const contestar = async (response: "ok" | "help") => {
    setRespuesta({ checkId: check.id, estado: "busy" });
    setError(null);
    try {
      await api.answerRideTripCheck(ride.id, check.id, { response, location });
      setRespuesta({ checkId: check.id, estado: response });
    } catch (requestError) {
      setRespuesta(null);
      setError(
        requestError instanceof Error ? requestError.message : "No se pudo enviar tu respuesta.",
      );
    }
  };

  return (
    <View style={estilos.caja} accessibilityRole="alert" accessibilityLabel="Control del viaje">
      <Ionicons name="shield-half-outline" size={22} color="#B07A00" />
      <View style={estilos.cuerpo}>
        {estado === "help" ? (
          <>
            <Text style={estilos.titulo}>Avisamos a Seguridad Flash</Text>
            <Text style={estilos.texto}>
              Nuestro equipo ya tiene tu viaje y tu ubicación. Si es urgente, llamá al 911.
            </Text>
          </>
        ) : (
          <>
            <Text style={estilos.titulo}>{copy.title}</Text>
            <Text style={estilos.texto}>{copy.body}</Text>
            <View style={estilos.fila}>
              <Pressable
                accessibilityRole="button"
                disabled={estado === "busy"}
                onPress={() => contestar("ok")}
                style={[estilos.boton, estilos.botonSecundario]}
              >
                <Text style={estilos.botonTextoSecundario}>Estoy bien</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={estado === "busy"}
                onPress={() => contestar("help")}
                style={[estilos.boton, estilos.botonPeligro]}
              >
                <Text style={estilos.botonTexto}>Pedir ayuda</Text>
              </Pressable>
            </View>
            {error ? <Text style={estilos.error}>{error}</Text> : null}
          </>
        )}
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  caja: {
    flexDirection: "row",
    gap: flashDesign.space.sm,
    padding: flashDesign.space.md,
    marginBottom: flashDesign.space.sm,
    borderRadius: flashDesign.radius.card,
    backgroundColor: "#FFF6DC",
    borderWidth: 1,
    borderColor: "#F0D48A",
  },
  cuerpo: { flex: 1, gap: flashDesign.space.xxs },
  titulo: { color: flashDesign.color.ink, fontSize: 16, fontWeight: "800" },
  texto: { color: flashDesign.color.inkSoft, fontSize: flashDesign.type.body },
  fila: { flexDirection: "row", flexWrap: "wrap", gap: flashDesign.space.xs, marginTop: 6 },
  boton: {
    minHeight: flashDesign.control.touch,
    justifyContent: "center",
    paddingHorizontal: flashDesign.space.md,
    borderRadius: flashDesign.radius.pill,
  },
  botonSecundario: {
    backgroundColor: flashDesign.color.surface,
    borderWidth: 1,
    borderColor: flashDesign.color.line,
  },
  botonPeligro: { backgroundColor: flashDesign.color.danger },
  botonTexto: { color: "#fff", fontWeight: "800" },
  botonTextoSecundario: { color: flashDesign.color.ink, fontWeight: "800" },
  error: { color: flashDesign.color.danger, fontSize: flashDesign.type.metadata },
});
