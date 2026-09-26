// Rationale in-app antes del diálogo del sistema (MOB-001).
// Uber/DoorDash explican por qué piden ubicación; el OS string solo aparece después.
import * as Location from "expo-location";
import { Alert } from "react-native";

type LocationAudience = "driver" | "customer";

const COPY: Record<
  LocationAudience,
  { title: string; message: string; continueLabel: string; cancelLabel: string }
> = {
  driver: {
    title: "Ubicación para Flash Driver",
    message:
      "Mientras estés online usamos tu ubicación para asignarte servicios cercanos y mostrar tu posición al cliente durante el seguimiento.",
    continueLabel: "Continuar",
    cancelLabel: "Ahora no",
  },
  customer: {
    title: "Ubicación en Flash",
    message:
      "Usamos tu ubicación para tomar el origen del viaje, calcular el tiempo estimado de llegada y sugerir comercios cercanos.",
    continueLabel: "Continuar",
    cancelLabel: "Ahora no",
  },
};

function confirmLocationRationale(audience: LocationAudience): Promise<boolean> {
  const copy = COPY[audience];
  return new Promise((resolve) => {
    Alert.alert(copy.title, copy.message, [
      { text: copy.cancelLabel, style: "cancel", onPress: () => resolve(false) },
      { text: copy.continueLabel, onPress: () => resolve(true) },
    ]);
  });
}

export async function explainAndRequestForegroundLocation({
  audience,
}: {
  audience: LocationAudience;
}): Promise<Location.LocationPermissionResponse> {
  const existing = await Location.getForegroundPermissionsAsync();
  if (existing.status === "granted") return existing;

  const accepted = await confirmLocationRationale(audience);
  if (!accepted) {
    return {
      ...existing,
      status: Location.PermissionStatus.DENIED,
      granted: false,
    };
  }

  return Location.requestForegroundPermissionsAsync();
}
