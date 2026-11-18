import { useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";

import { api } from "./api";
import { flashDesign } from "./design-system";

// La foto de un pedido dejado en la puerta, para quien lo pidió (P-02b).
//
// Uber Eats la muestra al cerrar el pedido. Se pide recién cuando la persona la
// quiere ver: es una imagen cifrada en el servidor, no algo que haya que bajar
// con cada actualización del seguimiento.
export function OrderDeliveryPhoto({ orderId }: { orderId: string }) {
  const [foto, setFoto] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  const ver = async () => {
    setCargando(true);
    setError("");
    try {
      const respuesta = await api.getOrderDeliveryPhoto(orderId);
      setFoto(`data:${respuesta.photo.mimeType};base64,${respuesta.contentBase64}`);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No pudimos traer la foto");
    } finally {
      setCargando(false);
    }
  };

  if (foto)
    return (
      <Image
        source={{ uri: foto }}
        style={estilos.foto}
        accessibilityLabel="Foto del pedido en la puerta"
      />
    );
  return (
    <View style={estilos.caja}>
      <Pressable accessibilityRole="button" disabled={cargando} onPress={() => void ver()}>
        <Text style={estilos.accion}>
          {cargando ? "Trayendo la foto…" : error ? "Reintentar" : "Ver foto de la entrega"}
        </Text>
      </Pressable>
      {cargando && <ActivityIndicator color={flashDesign.color.food} />}
      {error ? <Text style={estilos.error}>{error}</Text> : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  caja: { flexDirection: "row", alignItems: "center", gap: flashDesign.space.xs },
  accion: { color: flashDesign.color.ink, fontWeight: "800", textDecorationLine: "underline" },
  error: { color: flashDesign.color.danger, fontSize: flashDesign.type.metadata },
  foto: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: flashDesign.radius.card,
    backgroundColor: flashDesign.color.surfaceMuted,
  },
});
