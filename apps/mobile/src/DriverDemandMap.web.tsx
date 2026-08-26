import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import type { DriverDemandZone, GeoPoint } from "./types";

type DriverDemandMapProps = {
  zones: DriverDemandZone[];
  driver?: GeoPoint | null;
  caption: string;
  detail: string;
  height?: number;
  accessibilityLabel?: string;
};

export default function DriverDemandMapWeb({
  caption,
  detail,
  height = 286,
  accessibilityLabel = "Mapa de actividad por zonas",
}: DriverDemandMapProps) {
  return (
    <View style={[styles.shell, { height }]} accessibilityLabel={accessibilityLabel}>
      <View style={styles.icon}>
        <Ionicons name="phone-portrait-outline" size={24} color="#7c3cff" />
      </View>
      <Text style={styles.title}>Polígonos de demanda en la app instalada</Text>
      <Text style={styles.text}>
        {caption} · {detail}
      </Text>
      <Text style={styles.note}>
        La vista web mobile no simula el mapa nativo. Los conteos PostgreSQL verificables siguen
        visibles debajo.
      </Text>
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
    borderRadius: 24,
    backgroundColor: "#f3eff8",
    borderWidth: 1,
    borderColor: "#ded4e8",
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  title: { color: "#17131c", fontSize: 13, fontWeight: "900", textAlign: "center" },
  text: { color: "#5f5964", fontSize: 11, fontWeight: "700", lineHeight: 16, textAlign: "center" },
  note: { color: "#827989", fontSize: 10, fontWeight: "600", lineHeight: 15, textAlign: "center" },
});
