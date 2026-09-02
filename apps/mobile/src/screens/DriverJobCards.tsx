// Tarjetas de viaje y envío del conductor (ARC-001).
//
// Presentación local del home operativo. Salen de DriverScreen para no mezclar
// el cockpit con widgets de lista.

import { Ionicons } from "@expo/vector-icons";
import { Text, TextInput, View } from "react-native";

import { money } from "../format";
import { styles } from "../styles";
import { ActionButton } from "../ui";
import type { AppState, Ride } from "../types";

export function RideCard({
  ride,
  disabled,
  onPress,
}: {
  ride: Ride;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{ride.status}</Text>
      <Text style={styles.cardText}>
        {ride.pickup} {"->"} {ride.destination}
      </Text>
      <Text style={styles.cardText}>
        {ride.distanceKm} km - {money.format(ride.fare)}
      </Text>
      {onPress && <ActionButton label="Gestionar" disabled={disabled} onPress={onPress} />}
    </View>
  );
}

export function ShipmentCard({
  shipment,
  disabled,
  onPress,
  pin = "",
  onPinChange,
}: {
  shipment: AppState["shipments"][number];
  disabled?: boolean;
  onPress?: () => void;
  pin?: string;
  onPinChange?: (value: string) => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Envio · {shipment.status}</Text>
      <Text style={styles.cardText}>
        {shipment.pickup} → {shipment.destination}
      </Text>
      <Text style={styles.cardText}>
        {shipment.weightKg} kg · {money.format(shipment.fare)}
      </Text>
      <Text style={styles.helperText}>
        {shipment.serviceLevel?.toUpperCase()} · {shipment.itemCategory}
        {shipment.handlingInstructions ? ` · ${shipment.handlingInstructions}` : ""}
      </Text>
      {(shipment.deliveryEvidenceCount || 0) > 0 && (
        <View style={styles.deliveryEvidenceBadge}>
          <Ionicons name="shield-checkmark" size={16} color="#087a50" />
          <Text style={styles.deliveryEvidenceBadgeText}>
            {shipment.status === "delivered"
              ? shipment.signatureRequired
                ? "Entrega verificada con foto + firma + PIN"
                : "Entrega verificada con foto + PIN"
              : shipment.signatureRequired
                ? "Evidencia de entrega protegida"
                : "Foto de entrega protegida"}
          </Text>
        </View>
      )}
      {shipment.status === "delivering" && onPinChange ? (
        <>
          <Text style={styles.cardText}>Solicitá el PIN al destinatario</Text>
          <TextInput
            value={pin}
            onChangeText={onPinChange}
            keyboardType="number-pad"
            maxLength={4}
            secureTextEntry
            placeholder="PIN de 4 dígitos"
            style={styles.input}
          />
        </>
      ) : null}
      {onPress && (
        <ActionButton
          label={shipment.status === "delivering" ? "Confirmar entrega" : "Gestionar envio"}
          disabled={disabled || (shipment.status === "delivering" && pin.length !== 4)}
          onPress={onPress}
        />
      )}
    </View>
  );
}
