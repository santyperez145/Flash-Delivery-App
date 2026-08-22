import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import type { GeoPoint } from "./types";

type FlashNativeMapProps = {
  origin: GeoPoint;
  destination: GeoPoint;
  route?: GeoPoint[];
  driver?: GeoPoint | null;
  caption: string;
  detail: string;
  routeColor?: string;
  driverIcon?: "car-sport" | "bicycle";
  originRole?: "point" | "driver";
  height?: number;
  accessibilityLabel?: string;
};

export default function FlashNativeMapWeb({
  caption,
  detail,
  height = 260,
  accessibilityLabel = "Mapa del recorrido",
}: FlashNativeMapProps) {
  return (
    <View style={[styles.shell, { height }]} accessibilityLabel={accessibilityLabel}>
      <View style={styles.icon}><Ionicons name="phone-portrait-outline" size={24} color="#7c3cff" /></View>
      <Text style={styles.title}>Mapa interactivo en la app instalada</Text>
      <Text style={styles.text}>{caption} · {detail}</Text>
      <Text style={styles.note}>Esta vista web mobile no simula el SDK nativo. Usá Android/iOS o la PWA principal para explorar el mapa.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    padding: 24,
    overflow: "hidden",
    borderRadius: 22,
    backgroundColor: "#f3eff8",
    borderWidth: 1,
    borderColor: "#ded4e8",
  },
  icon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  title: { color: "#17131c", fontSize: 13, fontWeight: "900", textAlign: "center" },
  text: { color: "#5f5964", fontSize: 11, fontWeight: "700", lineHeight: 16, textAlign: "center" },
  note: { color: "#827989", fontSize: 10, fontWeight: "600", lineHeight: 15, textAlign: "center" },
});
