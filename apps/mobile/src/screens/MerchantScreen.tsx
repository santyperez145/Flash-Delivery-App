// Pantalla del comercio (ticket ARC-001).
//
// Shell de navegación mobile. Hoy, Pedidos, Catálogo, Cuenta y el detalle de
// comanda viven en módulos propios — la misma frontera que DoorDash Business
// Manager. El polling y el chat cruzan pestañas y quedan aquí.
//
// Es la superficie que el criterio «el build de driver no incluye pantallas de
// comercio» nombra literalmente.

import { useCallback, useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { api } from "../api";
import { styles } from "../styles";
import { ServiceChatModal } from "../ui";
import type { MerchantOperationsDashboard, Order, Restaurant } from "../types";
import { MerchantOrderDetailModal } from "./MerchantOrderDetailModal";
import { MerchantStoreAccount } from "./MerchantStoreAccount";
import { MerchantStoreMenu } from "./MerchantStoreMenu";
import { MerchantStoreOrders } from "./MerchantStoreOrders";
import { MerchantTodayPanel } from "./MerchantTodayPanel";

export function MerchantScreen({
  restaurant,
  orders,
  busy,
  runAction,
  onRefresh,
}: {
  restaurant: Restaurant;
  orders: Order[];
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const merchantScrollRef = useRef<ScrollView>(null);
  const [merchantView, setMerchantView] = useState<"today" | "orders" | "catalog" | "account">(
    "today",
  );
  const [chatJobId, setChatJobId] = useState<string | null>(null);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [operations, setOperations] = useState<MerchantOperationsDashboard | null>(null);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [activeOrdersHasMore, setActiveOrdersHasMore] = useState(false);
  const [operationsLoading, setOperationsLoading] = useState(true);
  const [operationsError, setOperationsError] = useState("");
  const [newItem, setNewItem] = useState({
    name: "",
    description: "",
    category: "Especiales",
    price: "",
  });
  useEffect(() => {
    merchantScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [merchantView]);
  const restaurantOrders = orders.filter((order) => order.restaurantId === restaurant.id);
  const orderStatusSignature = restaurantOrders
    .map((order) => `${order.id}:${order.status}`)
    .join("|");
  const stockSignature = restaurant.menu.map((item) => `${item.id}:${item.stock}`).join("|");
  const loadOperations = useCallback(async () => {
    setOperationsLoading(true);
    try {
      const [result, queue] = await Promise.all([
        api.getMerchantDashboard(restaurant.id),
        api.getMerchantActiveOrders(restaurant.id),
      ]);
      setOperations(result.dashboard);
      setActiveOrders(queue.orders);
      setActiveOrdersHasMore(queue.hasMore);
      setOperationsError("");
    } catch (error) {
      setOperationsError(
        error instanceof Error ? error.message : "No se pudo actualizar la operación",
      );
    } finally {
      setOperationsLoading(false);
    }
  }, [restaurant.id]);
  useEffect(() => {
    void loadOperations();
    const timer = setInterval(() => void loadOperations(), 30_000);
    return () => clearInterval(timer);
  }, [
    loadOperations,
    orderStatusSignature,
    restaurant.etaMin,
    restaurant.manualOpen,
    stockSignature,
  ]);
  const metrics = operations?.metrics;
  const manualOpen = operations?.branch?.manualOpen ?? restaurant.manualOpen ?? restaurant.open;
  const effectiveOpen = operations?.branch?.open ?? restaurant.open;
  const etaMin = operations?.branch?.etaMin ?? restaurant.etaMin;
  const updatedAt = operations
    ? new Intl.DateTimeFormat("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: operations.timezone,
      }).format(new Date(operations.generatedAt))
    : null;
  const detailOrder = activeOrders.find((order) => order.id === detailOrderId) || null;
  return (
    <View style={styles.merchantShell}>
      <ServiceChatModal
        jobId={chatJobId}
        currentUserId={restaurant.ownerId}
        onClose={() => setChatJobId(null)}
      />
      <MerchantOrderDetailModal
        order={detailOrder}
        restaurant={restaurant}
        busy={busy}
        onClose={() => setDetailOrderId(null)}
        onOpenChat={(orderId) => {
          setDetailOrderId(null);
          setChatJobId(orderId);
        }}
        onChanged={async () => {
          await onRefresh();
          await loadOperations();
        }}
      />
      <ScrollView
        ref={merchantScrollRef}
        contentContainerStyle={styles.merchantContent}
        refreshControl={
          <RefreshControl
            refreshing={operationsLoading}
            onRefresh={async () => {
              await onRefresh();
              await loadOperations();
            }}
          />
        }
      >
        <View style={styles.stack}>
          {merchantView === "today" ? (
            <MerchantTodayPanel
              restaurant={restaurant}
              operations={operations}
              operationsError={operationsError}
              operationsLoading={operationsLoading}
              manualOpen={Boolean(manualOpen)}
              effectiveOpen={Boolean(effectiveOpen)}
              etaMin={etaMin}
              updatedAt={updatedAt}
              busy={busy}
              runAction={runAction}
              onRefreshOperations={() => void loadOperations()}
            />
          ) : null}
          {merchantView === "orders" ? (
            <MerchantStoreOrders
              activeOrders={activeOrders}
              hasMore={activeOrdersHasMore}
              metrics={metrics}
              operationsLoading={operationsLoading}
              busy={busy}
              runAction={runAction}
              onOpenDetail={setDetailOrderId}
              onOpenChat={setChatJobId}
            />
          ) : null}
          {merchantView === "catalog" ? (
            <MerchantStoreMenu
              restaurant={restaurant}
              metrics={metrics}
              busy={busy}
              runAction={runAction}
              newItem={newItem}
              setNewItem={setNewItem}
            />
          ) : null}
          {merchantView === "account" ? (
            <MerchantStoreAccount
              restaurant={restaurant}
              operations={operations}
              effectiveOpen={Boolean(effectiveOpen)}
              updatedAt={updatedAt}
            />
          ) : null}
        </View>
      </ScrollView>
      <View style={styles.merchantBottomNav}>
        {(
          [
            ["today", "home-outline", "Hoy"],
            ["orders", "receipt-outline", "Pedidos"],
            ["catalog", "restaurant-outline", "Catálogo"],
            ["account", "person-circle-outline", "Cuenta"],
          ] as const
        ).map(([value, icon, label]) => (
          <Pressable
            key={value}
            style={[
              styles.merchantBottomItem,
              merchantView === value && styles.merchantBottomItemActive,
            ]}
            onPress={() => setMerchantView(value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: merchantView === value }}
          >
            <View style={styles.merchantBottomIconWrap}>
              <Ionicons
                name={icon}
                size={22}
                color={merchantView === value ? "#ef641f" : "#8b817b"}
              />
              {value === "orders" && Boolean(metrics?.needsAction || metrics?.lateOrders) ? (
                <View style={styles.merchantBottomDot} />
              ) : null}
            </View>
            <Text
              style={[
                styles.merchantBottomLabel,
                merchantView === value && styles.merchantBottomLabelActive,
              ]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
