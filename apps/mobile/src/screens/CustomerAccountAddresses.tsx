// Libreta de direcciones de cuenta (ARC-001).
//
// Uber y DoorDash comparten la libreta entre verticales; Flash también.
import { Ionicons } from "@expo/vector-icons";
import { Alert, Pressable, Text, View } from "react-native";

import { api } from "../api";
import { styles } from "../styles";
import type { AppState, User } from "../types";
import { CustomerAddressForm } from "./CustomerAddressForm";
import type { AccountAddressHandler, AccountRunAction } from "./CustomerAccountTypes";

export function CustomerAccountAddresses({
  state,
  user,
  busy,
  runAction,
  onUseAddress,
}: {
  state: AppState;
  user: User;
  busy: boolean;
  runAction: AccountRunAction;
  onUseAddress: AccountAddressHandler;
}) {
  return (
    <View style={styles.addressBookCard}>
      <View style={styles.addressBookHeading}>
        <View>
          <Text style={styles.foodRestaurantTitle}>Direcciones guardadas</Text>
          <Text style={styles.cardText}>Se comparten entre comidas, viajes y envíos.</Text>
        </View>
        <Ionicons name="map-outline" size={24} color="#7c3cff" />
      </View>
      {state.addresses
        .filter((item) => item.userId === user.id)
        .map((item) => (
          <View style={styles.savedAddressRow} key={item.id}>
            <View
              style={[styles.savedAddressIcon, item.isDefault && styles.savedAddressIconDefault]}
            >
              <Ionicons
                name={
                  item.label.toLowerCase().includes("trab") ? "business-outline" : "home-outline"
                }
                size={19}
                color={item.isDefault ? "#fff" : "#7c3cff"}
              />
            </View>
            <Pressable
              style={styles.savedAddressCopy}
              onPress={() => {
                const point =
                  item.lat !== null && item.lng !== null ? { lat: item.lat, lng: item.lng } : null;
                onUseAddress(item.address, point);
              }}
            >
              <View style={styles.savedAddressTitle}>
                <Text style={styles.sectionTitle}>{item.label}</Text>
                {item.isDefault && <Text style={styles.defaultAddressBadge}>Principal</Text>}
              </View>
              <Text style={styles.cardText}>{item.address}</Text>
              <View style={styles.addressValidationStatus}>
                <Ionicons
                  name={item.isValidated ? "checkmark-circle" : "alert-circle-outline"}
                  size={14}
                  color={item.isValidated ? "#087a50" : "#a15c00"}
                />
                <Text
                  style={[
                    styles.addressValidationText,
                    !item.isValidated && styles.addressValidationTextWarning,
                  ]}
                >
                  {item.isValidated
                    ? `Validada${item.geocodingProvider ? ` · ${item.geocodingProvider}` : ""}`
                    : "Requiere volver a validarse"}
                </Text>
              </View>
            </Pressable>
            {!item.id.startsWith("profile-") && (
              <View style={styles.savedAddressActions}>
                {!item.isDefault && (
                  <Pressable
                    disabled={busy}
                    onPress={() =>
                      runAction(
                        () => api.setDefaultAddress(item.id),
                        "Dirección principal actualizada",
                      )
                    }
                  >
                    <Ionicons name="star-outline" size={20} color="#7c3cff" />
                  </Pressable>
                )}
                <Pressable
                  disabled={busy}
                  onPress={() =>
                    Alert.alert("Eliminar dirección", `¿Eliminar ${item.label}?`, [
                      { text: "Cancelar", style: "cancel" },
                      {
                        text: "Eliminar",
                        style: "destructive",
                        onPress: () =>
                          runAction(() => api.deleteAddress(item.id), "Dirección eliminada"),
                      },
                    ])
                  }
                >
                  <Ionicons name="trash-outline" size={20} color="#d74a43" />
                </Pressable>
              </View>
            )}
          </View>
        ))}
      <CustomerAddressForm
        busy={busy}
        hasPersistedAddress={state.addresses.some(
          (item) => item.userId === user.id && !item.id.startsWith("profile-"),
        )}
        runAction={runAction}
        onSaved={(match) => onUseAddress(match.label, match.point)}
      />
    </View>
  );
}
