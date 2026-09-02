// Cola de cocina mobile (ARC-001).
//
// DoorDash Business Manager y Uber Eats Manager aíslan live orders de Home.
// Flash deja avance de etapa, comanda y chat aquí; las ventas no se reconstruyen.
import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import { api } from "../api";
import { styles } from "../styles";
import { OrderCard } from "../ui";
import type { MerchantOperationsMetrics, Order } from "../types";

type RunAction = (action: () => Promise<unknown>, success: string) => void;

export function MerchantStoreOrders({
  activeOrders,
  hasMore,
  metrics,
  operationsLoading,
  busy,
  runAction,
  onOpenDetail,
  onOpenChat,
}: {
  activeOrders: Order[];
  hasMore: boolean;
  metrics: MerchantOperationsMetrics | undefined;
  operationsLoading: boolean;
  busy: boolean;
  runAction: RunAction;
  onOpenDetail: (orderId: string) => void;
  onOpenChat: (orderId: string) => void;
}) {
  return (
    <>
      <View style={styles.merchantScreenHeading}>
        <Text style={styles.merchantScreenEyebrow}>OPERACIÓN</Text>
        <Text style={styles.merchantScreenTitle}>Pedidos activos</Text>
        <Text style={styles.merchantScreenCopy}>
          La cola se prioriza por responsabilidad de cocina, plazo y etapa logística.
        </Text>
      </View>
      <View style={styles.merchantOrderSummary}>
        {[
          ["Por aceptar", metrics?.needsAction],
          ["Preparando", metrics?.preparing],
          ["Listos", metrics?.readyForPickup],
          ["Courier", metrics?.courierFlow],
        ].map(([label, value]) => (
          <View key={String(label)} style={styles.merchantOrderSummaryItem}>
            <Text style={styles.merchantOrderSummaryValue}>{value ?? "—"}</Text>
            <Text style={styles.merchantOrderSummaryLabel}>{label}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.sectionTitle}>Cocina en vivo</Text>
      {hasMore ? (
        <View style={styles.merchantSlaAlert}>
          <Ionicons name="warning-outline" size={18} color="#b33a25" />
          <Text style={styles.merchantSlaAlertText}>
            La cola supera los 100 pedidos activos. Se muestran primero los que requieren acción.
          </Text>
        </View>
      ) : null}
      {activeOrders.map((order) => (
        <View key={order.id} style={styles.stack}>
          <OrderCard
            order={order}
            disabled={busy}
            onPress={
              ["accepted", "preparing"].includes(order.status)
                ? () => runAction(() => api.advanceOrder(order.id), "Pedido avanzado")
                : undefined
            }
          />
          <View style={styles.merchantOrderActions}>
            <Pressable
              style={styles.merchantOrderDetailAction}
              onPress={() => onOpenDetail(order.id)}
            >
              <Ionicons name="receipt-outline" size={18} color="#9a3e12" />
              <Text style={styles.merchantOrderDetailActionText}>Ver comanda</Text>
            </Pressable>
            <Pressable style={styles.shareAction} onPress={() => onOpenChat(order.id)}>
              <Ionicons name="chatbubbles-outline" size={18} color="#7c3cff" />
              <Text style={styles.shareActionText}>Chat</Text>
            </Pressable>
          </View>
        </View>
      ))}
      {activeOrders.length === 0 && (
        <View style={styles.merchantEmpty}>
          <Ionicons name="checkmark-circle-outline" size={28} color="#1d9b63" />
          <Text style={styles.merchantEmptyTitle}>
            {operationsLoading ? "Sincronizando la cola" : "Cocina al día"}
          </Text>
          <Text style={styles.merchantEmptyCopy}>
            {operationsLoading
              ? "Consultando pedidos activos en PostgreSQL…"
              : "No hay pedidos activos para gestionar."}
          </Text>
        </View>
      )}
    </>
  );
}
