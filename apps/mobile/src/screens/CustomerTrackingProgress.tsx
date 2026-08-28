import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { styles } from "../styles";

export function CustomerTrackingProgress({
  labels,
  current,
  activeColor,
}: {
  labels: string[];
  current: number;
  activeColor: string;
}) {
  const normalizedCurrent = Math.min(Math.max(current, 0), labels.length - 1);
  return (
    <View style={styles.trackingProgress}>
      {labels.map((label, index) => {
        const state =
          index < normalizedCurrent
            ? "completada"
            : index === normalizedCurrent
              ? "actual"
              : "pendiente";
        return (
          <View
            accessible
            accessibilityRole="text"
            accessibilityLabel={`Etapa ${index + 1} de ${labels.length}: ${label}, ${state}`}
            style={styles.trackingStage}
            key={label}
          >
            <View
              style={[
                styles.trackingStageDot,
                index <= normalizedCurrent && { backgroundColor: activeColor },
              ]}
            >
              {index < normalizedCurrent ? (
                <Ionicons name="checkmark" size={11} color="#fff" />
              ) : null}
            </View>
            <Text
              style={[
                styles.trackingStageText,
                index === normalizedCurrent && styles.trackingStageTextActive,
              ]}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
