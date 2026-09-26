// Hoy / command center del comercio mobile (ARC-001).
//
// DoorDash Business Manager concentra apertura, ETA y pulso de cocina en Home.
// Flash deja esa franja acá; Pedidos y Catálogo no reconstruyen ventas.
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { api } from "../api";
import { money } from "../format";
import { styles } from "../styles";
import { ActionButton, KpiRow } from "../ui";
import type { MerchantOperationsDashboard, Restaurant } from "../types";

type RunAction = (action: () => Promise<unknown>, success: string) => void;

export function MerchantTodayPanel({
  restaurant,
  operations,
  operationsError,
  operationsLoading,
  manualOpen,
  effectiveOpen,
  etaMin,
  updatedAt,
  busy,
  runAction,
  onRefreshOperations,
}: {
  restaurant: Restaurant;
  operations: MerchantOperationsDashboard | null;
  operationsError: string;
  operationsLoading: boolean;
  manualOpen: boolean;
  effectiveOpen: boolean;
  etaMin: number;
  updatedAt: string | null;
  busy: boolean;
  runAction: RunAction;
  onRefreshOperations: () => void;
}) {
  const metrics = operations?.metrics;
  return (
    <>
      <LinearGradient
        colors={["#2d180e", "#12100f"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.merchantHero}
      >
        <View style={styles.merchantHeroTopline}>
          <View
            style={[
              styles.merchantLiveDot,
              effectiveOpen ? styles.merchantLiveDotOpen : styles.merchantLiveDotPaused,
            ]}
          />
          <Text style={styles.heroLabel}>
            {!manualOpen
              ? "Pausado por el local"
              : effectiveOpen
                ? "Abierto y recibiendo"
                : "Fuera de horario"}
          </Text>
        </View>
        <Text style={styles.heroTitle}>{restaurant.name}</Text>
        <Text style={styles.heroCopy}>{operations?.branch?.name || restaurant.address}</Text>
        <View style={styles.merchantHeroMeta}>
          <Text style={styles.merchantHeroMetaText}>{etaMin} min ETA</Text>
          <Text style={styles.merchantHeroMetaText}>
            {operations?.timezone || "Zona horaria pendiente"}
          </Text>
        </View>
      </LinearGradient>
      <View
        style={[
          styles.merchantSync,
          operationsError ? styles.merchantSyncError : styles.merchantSyncLive,
        ]}
      >
        <View style={styles.merchantSyncCopy}>
          <Text style={styles.merchantSyncTitle}>
            {operationsError
              ? operations
                ? "Última lectura conservada"
                : "Operación sin actualizar"
              : operations?.source === "postgres-live-operations"
                ? "Operación PostgreSQL en vivo"
                : operations
                  ? "Modo local explícito"
                  : "Conectando operación"}
          </Text>
          <Text style={styles.merchantSyncDetail}>
            {operationsError
              ? `${operationsError}${updatedAt ? ` · Último dato ${updatedAt}` : ""}`
              : updatedAt
                ? `Actualizado ${updatedAt}`
                : "Consultando la fuente autoritativa"}
          </Text>
        </View>
        {operationsLoading ? (
          <ActivityIndicator size="small" color="#ff7a2d" />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Actualizar operación"
            onPress={onRefreshOperations}
            style={styles.merchantSyncButton}
          >
            <Ionicons name="refresh" size={17} color="#28150d" />
          </Pressable>
        )}
      </View>
      <KpiRow
        items={[
          ["Venta de hoy", metrics ? money.format(metrics.grossSalesToday) : "—"],
          ["Activos", metrics?.activeOrders ?? "—"],
          ["Ticket hoy", metrics ? money.format(metrics.averageTicketToday) : "—"],
          ["Atención", metrics ? metrics.needsAction + metrics.lateOrders : "—"],
        ]}
      />
      <View style={styles.merchantPulseCard}>
        <View style={styles.merchantPulseHeader}>
          <View>
            <Text style={styles.merchantPulseEyebrow}>AHORA</Text>
            <Text style={styles.merchantPulseTitle}>Pulso de cocina</Text>
          </View>
          <Text style={styles.merchantPulseTotal}>
            {metrics ? `${metrics.activeOrders} en flujo` : "Sin sincronizar"}
          </Text>
        </View>
        <View style={styles.merchantPulseGrid}>
          {[
            ["Por aceptar", metrics?.needsAction],
            ["Preparando", metrics?.preparing],
            ["Listos", metrics?.readyForPickup],
            ["Con courier", metrics?.courierFlow],
            ["Sin stock", metrics?.unavailableItems],
          ].map(([label, value]) => (
            <View key={String(label)} style={styles.merchantPulseStage}>
              <Text style={styles.merchantPulseStageValue}>{value ?? "—"}</Text>
              <Text style={styles.merchantPulseStageLabel}>{label}</Text>
            </View>
          ))}
        </View>
        {metrics && (metrics.lateOrders > 0 || metrics.untrackedPrepOrders > 0) ? (
          <View style={styles.merchantSlaAlert}>
            <Ionicons name="warning-outline" size={18} color="#b33a25" />
            <Text style={styles.merchantSlaAlertText}>
              {metrics.lateOrders > 0 ? `${metrics.lateOrders} fuera de plazo. ` : ""}
              {metrics.untrackedPrepOrders > 0
                ? `${metrics.untrackedPrepOrders} sin SLA histórico observado.`
                : ""}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.actionRow}>
        <ActionButton
          label={manualOpen ? "Pausar pedidos" : "Abrir pedidos"}
          disabled={busy}
          onPress={() =>
            runAction(
              () => api.updateRestaurant(restaurant.id, { open: !manualOpen }),
              "Estado actualizado",
            )
          }
        />
        <ActionButton
          label="+5 min ETA"
          disabled={busy}
          onPress={() =>
            runAction(
              () =>
                api.updateRestaurant(restaurant.id, {
                  etaMin: etaMin + 5,
                }),
              "ETA actualizada",
            )
          }
        />
      </View>
    </>
  );
}
