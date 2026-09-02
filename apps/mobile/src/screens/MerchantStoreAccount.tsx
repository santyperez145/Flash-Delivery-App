// Cuenta operativa del comercio mobile (ARC-001).
//
// DoorDash Business Manager guarda identidad, sucursales y fuente de datos
// fuera de la cola. Flash no presenta el fallback SQLite como PostgreSQL en vivo.
import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { styles } from "../styles";
import type { MerchantOperationsDashboard, Restaurant } from "../types";

export function MerchantStoreAccount({
  restaurant,
  operations,
  effectiveOpen,
  updatedAt,
}: {
  restaurant: Restaurant;
  operations: MerchantOperationsDashboard | null;
  effectiveOpen: boolean;
  updatedAt: string | null;
}) {
  return (
    <>
      <View style={styles.merchantScreenHeading}>
        <Text style={styles.merchantScreenEyebrow}>TU NEGOCIO</Text>
        <Text style={styles.merchantScreenTitle}>{restaurant.name}</Text>
        <Text style={styles.merchantScreenCopy}>
          Identidad operativa, sucursales y procedencia de los datos.
        </Text>
      </View>
      <View style={styles.merchantAccountCard}>
        <View style={styles.merchantAccountIcon}>
          <Ionicons name="storefront-outline" size={24} color="#fff" />
        </View>
        <View style={styles.merchantAccountCopy}>
          <Text style={styles.merchantAccountCardTitle}>
            {operations?.branch?.name || restaurant.address}
          </Text>
          <Text style={styles.merchantAccountCardDetail}>
            {operations?.timezone || "Zona horaria sin sincronizar"}
          </Text>
        </View>
        <Text
          style={[
            styles.merchantAccountStatus,
            effectiveOpen ? styles.merchantAccountStatusOpen : styles.merchantAccountStatusPaused,
          ]}
        >
          {effectiveOpen ? "Abierto" : "Cerrado"}
        </Text>
      </View>
      <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>Sucursales</Text>
        {(restaurant.branches || []).map((branch) => (
          <View key={branch.id} style={styles.merchantBranchRow}>
            <View
              style={[
                styles.merchantBranchPin,
                branch.open ? styles.merchantBranchPinOpen : styles.merchantBranchPinClosed,
              ]}
            >
              <Ionicons
                name="location-outline"
                size={19}
                color={branch.open ? "#15764c" : "#98532e"}
              />
            </View>
            <View style={styles.merchantAccountCopy}>
              <Text style={styles.itemName}>{branch.name}</Text>
              <Text style={styles.cardText}>{branch.address}</Text>
              <Text style={styles.merchantBranchMeta}>
                {branch.etaMin} min ·{" "}
                {branch.manualOpen
                  ? branch.open
                    ? "Abierta ahora"
                    : "Fuera de horario"
                  : "Pausada manualmente"}
              </Text>
            </View>
          </View>
        ))}
        {!restaurant.branches?.length ? (
          <Text style={styles.muted}>No hay sucursales configuradas.</Text>
        ) : null}
      </View>
      <View style={styles.merchantDataCard}>
        <Ionicons name="shield-checkmark-outline" size={22} color="#1b8859" />
        <View style={styles.merchantAccountCopy}>
          <Text style={styles.merchantAccountTitle}>
            {operations?.source === "postgres-live-operations"
              ? "Datos operativos PostgreSQL"
              : "Fuente local explícita"}
          </Text>
          <Text style={styles.merchantAccountDetail}>
            {updatedAt ? `Última lectura ${updatedAt}` : "Esperando primera lectura"} · Los datos
            retenidos se identifican cuando falla una actualización.
          </Text>
        </View>
      </View>
    </>
  );
}
