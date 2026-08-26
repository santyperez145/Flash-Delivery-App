// Pantalla del comercio (ticket ARC-001, paso 12).
//
// La consola operativa del comercio y el detalle de pedido que sólo ella abre.
// Viajan juntos porque el modal no tiene sentido fuera de esta pantalla: se
// verificó que su único uso está acá.
//
// Es la superficie que el criterio «el build de driver no incluye pantallas de
// comercio» nombra literalmente. Separarla es la condición para poder excluirla.

import { useCallback, useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { api } from "../api";
import { mobileOrderStatusLabel, money } from "../format";
import { styles } from "../styles";
import { ActionButton, KpiRow, OrderCard, ServiceChatModal } from "../ui";
import type { MerchantOperationsDashboard, Order, OrderSubstitution, Restaurant } from "../types";

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
                <Text style={styles.heroCopy}>
                  {operations?.branch?.name || restaurant.address}
                </Text>
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
                    onPress={() => void loadOperations()}
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
          ) : null}
          {merchantView === "orders" ? (
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
              {activeOrdersHasMore ? (
                <View style={styles.merchantSlaAlert}>
                  <Ionicons name="warning-outline" size={18} color="#b33a25" />
                  <Text style={styles.merchantSlaAlertText}>
                    La cola supera los 100 pedidos activos. Se muestran primero los que requieren
                    acción.
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
                      onPress={() => setDetailOrderId(order.id)}
                    >
                      <Ionicons name="receipt-outline" size={18} color="#9a3e12" />
                      <Text style={styles.merchantOrderDetailActionText}>Ver comanda</Text>
                    </Pressable>
                    <Pressable style={styles.shareAction} onPress={() => setChatJobId(order.id)}>
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
          ) : null}
          {merchantView === "catalog" ? (
            <>
              <View style={styles.merchantScreenHeading}>
                <Text style={styles.merchantScreenEyebrow}>MENÚ</Text>
                <Text style={styles.merchantScreenTitle}>Catálogo y stock</Text>
                <Text style={styles.merchantScreenCopy}>
                  {metrics
                    ? `${restaurant.menu.length - metrics.unavailableItems} disponibles · ${metrics.unavailableItems} sin stock`
                    : "Sincronizando inventario de la sucursal"}
                </Text>
              </View>
              <Text style={styles.sectionTitle}>Menu y stock</Text>
              {restaurant.menu.map((item) => (
                <View key={item.id} style={styles.itemRow}>
                  <View style={styles.itemCopy}>
                    <Text style={styles.itemName}>{item.name}</Text>
                    <Text style={styles.cardText}>
                      {money.format(item.price)} - {item.stock ? "Disponible" : "Agotado"}
                    </Text>
                  </View>
                  <ActionButton
                    label={item.stock ? "Agotar" : "Reponer"}
                    disabled={busy}
                    onPress={() =>
                      runAction(
                        () => api.updateMenuStock(restaurant.id, item.id, !item.stock),
                        "Stock actualizado",
                      )
                    }
                  />
                </View>
              ))}
              <View style={styles.formCard}>
                <Text style={styles.sectionTitle}>Agregar producto</Text>
                <TextInput
                  value={newItem.name}
                  onChangeText={(value) => setNewItem((current) => ({ ...current, name: value }))}
                  placeholder="Nombre"
                  style={styles.input}
                />
                <TextInput
                  value={newItem.description}
                  onChangeText={(value) =>
                    setNewItem((current) => ({ ...current, description: value }))
                  }
                  placeholder="Descripcion"
                  style={styles.input}
                />
                <TextInput
                  value={newItem.category}
                  onChangeText={(value) =>
                    setNewItem((current) => ({ ...current, category: value }))
                  }
                  placeholder="Categoria"
                  style={styles.input}
                />
                <TextInput
                  value={newItem.price}
                  onChangeText={(value) => setNewItem((current) => ({ ...current, price: value }))}
                  placeholder="Precio"
                  keyboardType="numeric"
                  style={styles.input}
                />
                <ActionButton
                  label="Crear producto"
                  disabled={busy || !newItem.name.trim() || Number(newItem.price) <= 0}
                  onPress={() =>
                    runAction(async () => {
                      await api.addMenuItem(restaurant.id, {
                        name: newItem.name.trim(),
                        description: newItem.description.trim(),
                        category: newItem.category.trim() || "Especiales",
                        price: Number(newItem.price),
                      });
                      setNewItem({
                        name: "",
                        description: "",
                        category: "Especiales",
                        price: "",
                      });
                    }, "Producto creado")
                  }
                />
              </View>
            </>
          ) : null}
          {merchantView === "account" ? (
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
                    effectiveOpen
                      ? styles.merchantAccountStatusOpen
                      : styles.merchantAccountStatusPaused,
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
                    {updatedAt ? `Última lectura ${updatedAt}` : "Esperando primera lectura"} · Los
                    datos retenidos se identifican cuando falla una actualización.
                  </Text>
                </View>
              </View>
            </>
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

function MerchantOrderDetailModal({
  order,
  restaurant,
  busy,
  onClose,
  onOpenChat,
  onChanged,
}: {
  order: Order | null;
  restaurant: Restaurant;
  busy: boolean;
  onClose: () => void;
  onOpenChat: (orderId: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [substitutions, setSubstitutions] = useState<OrderSubstitution[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [replacementId, setReplacementId] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState("");
  const loadSubstitutions = useCallback(async (orderId: string) => {
    setLoading(true);
    try {
      const result = await api.getOrderSubstitutions(orderId);
      setSubstitutions(result.substitutions);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "No se pudieron cargar las sustituciones",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    setSelectedItemId("");
    setReplacementId("");
    setReason("");
    setSubstitutions([]);
    setError("");
    if (order) void loadSubstitutions(order.id);
  }, [order?.id, loadSubstitutions]);
  if (!order) return null;
  const selectedOrderItem = order.items.find((item) => item.menuItemId === selectedItemId) || null;
  const selectedCatalogItem = restaurant.menu.find((item) => item.id === selectedItemId) || null;
  const branch = restaurant.branches?.find((entry) => entry.id === order.branchId) || null;
  const inventoryFor = (itemId: string) => branch?.inventory?.[itemId];
  const isAvailable = (item: Restaurant["menu"][number]) => {
    const branchInventory = inventoryFor(item.id);
    return (
      item.stock &&
      (branchInventory?.available ?? true) &&
      (branchInventory?.stockQuantity == null ||
        branchInventory.stockQuantity >= (selectedOrderItem?.quantity || 1))
    );
  };
  const originalPrice = selectedOrderItem?.unitPrice ?? selectedCatalogItem?.price ?? 0;
  const candidates = restaurant.menu
    .filter(
      (item) => item.id !== selectedItemId && isAvailable(item) && item.price <= originalPrice,
    )
    .sort(
      (left, right) =>
        Number(
          Boolean(selectedCatalogItem?.category) &&
            right.category === selectedCatalogItem?.category,
        ) -
          Number(
            Boolean(selectedCatalogItem?.category) &&
              left.category === selectedCatalogItem?.category,
          ) || left.price - right.price,
    );
  const canManage = ["accepted", "preparing"].includes(order.status);
  const selectedPending = substitutions.some(
    (entry) => entry.status === "pending" && entry.original.id === selectedItemId,
  );
  const submitSubstitution = async () => {
    if (
      !order.branchId ||
      !selectedOrderItem?.menuItemId ||
      !replacementId ||
      reason.trim().length < 3
    )
      return;
    setActionBusy(true);
    setError("");
    try {
      const branchInventory = inventoryFor(selectedOrderItem.menuItemId);
      if (selectedCatalogItem?.stock && (branchInventory?.available ?? true))
        await api.updateBranchInventory(
          restaurant.id,
          order.branchId,
          selectedOrderItem.menuItemId,
          { available: false, stockQuantity: branchInventory?.stockQuantity ?? null },
        );
      const result = await api.proposeOrderSubstitution(order.id, {
        originalMenuItemId: selectedOrderItem.menuItemId,
        replacementMenuItemId: replacementId,
        reason: reason.trim(),
      });
      setSubstitutions((current) => [result.substitution, ...current]);
      setSelectedItemId("");
      setReplacementId("");
      setReason("");
      await onChanged();
      Alert.alert(
        "Propuesta enviada",
        "El cliente debe aceptar o rechazar el cambio antes de que cocina pueda avanzar.",
      );
    } catch (substitutionError) {
      setError(
        substitutionError instanceof Error
          ? substitutionError.message
          : "No se pudo proponer la sustitución",
      );
    } finally {
      setActionBusy(false);
    }
  };
  const createdLabel = order.createdAt
    ? new Date(order.createdAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
    : "Hora no disponible";
  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.merchantDetailBackdrop}>
        <View style={styles.merchantDetailSheet}>
          <View style={styles.issueModalHandle} />
          <View style={styles.issueModalHeader}>
            <View style={styles.merchantDetailHeading}>
              <Text style={styles.merchantScreenEyebrow}>COMANDA {order.id}</Text>
              <Text style={styles.merchantDetailTitle}>{mobileOrderStatusLabel[order.status]}</Text>
              <Text style={styles.merchantDetailSubtitle}>
                {createdLabel} ·{" "}
                {order.branchId ? branch?.name || order.branchId : "Sucursal no registrada"}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cerrar detalle"
              style={styles.issueModalClose}
              onPress={onClose}
            >
              <Ionicons name="close" size={21} color="#403a43" />
            </Pressable>
          </View>
          <ScrollView
            style={styles.merchantDetailScroll}
            contentContainerStyle={styles.merchantDetailContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.merchantDetailFacts}>
              <View style={styles.merchantDetailFact}>
                <Text style={styles.merchantDetailFactLabel}>Total</Text>
                <Text style={styles.merchantDetailFactValue}>{money.format(order.total)}</Text>
              </View>
              <View style={styles.merchantDetailFact}>
                <Text style={styles.merchantDetailFactLabel}>Entrega estimada</Text>
                <Text style={styles.merchantDetailFactValue}>{order.etaMin} min</Text>
              </View>
              <View style={styles.merchantDetailFact}>
                <Text style={styles.merchantDetailFactLabel}>Courier</Text>
                <Text style={styles.merchantDetailFactValue}>
                  {order.courierId ? "Asignado" : "Pendiente"}
                </Text>
              </View>
            </View>
            <View style={styles.merchantDetailSection}>
              <Text style={styles.sectionTitle}>Productos</Text>
              {order.items.map((item, index) => {
                const menuId = item.menuItemId || "";
                const catalogItem = restaurant.menu.find((entry) => entry.id === menuId);
                const itemInventory = menuId ? inventoryFor(menuId) : undefined;
                const unavailable =
                  Boolean(catalogItem && !catalogItem.stock) || itemInventory?.available === false;
                const hasPending = substitutions.some(
                  (entry) => entry.status === "pending" && entry.original.id === menuId,
                );
                return (
                  <View
                    key={`${menuId || item.name}-${index}`}
                    style={[
                      styles.merchantDetailItem,
                      selectedItemId === menuId && styles.merchantDetailItemSelected,
                    ]}
                  >
                    <View style={styles.merchantDetailQuantity}>
                      <Text style={styles.merchantDetailQuantityText}>{item.quantity}×</Text>
                    </View>
                    <View style={styles.merchantDetailItemCopy}>
                      <View style={styles.merchantDetailItemTitleRow}>
                        <Text style={styles.merchantDetailItemTitle}>{item.name}</Text>
                        {unavailable ? (
                          <Text style={styles.merchantUnavailableBadge}>SIN STOCK</Text>
                        ) : null}
                      </View>
                      {typeof item.unitPrice === "number" ? (
                        <Text style={styles.merchantDetailItemPrice}>
                          {money.format(item.unitPrice)} c/u
                        </Text>
                      ) : null}
                      {item.extras?.length ? (
                        <Text style={styles.merchantDetailItemMeta}>
                          Agregados: {item.extras.join(", ")}
                        </Text>
                      ) : null}
                      {item.note ? (
                        <View style={styles.merchantKitchenNote}>
                          <Ionicons name="create-outline" size={16} color="#9a3e12" />
                          <Text style={styles.merchantKitchenNoteText}>{item.note}</Text>
                        </View>
                      ) : null}
                      {canManage && menuId ? (
                        <Pressable
                          disabled={busy || actionBusy || hasPending}
                          style={[
                            styles.merchantSubstitutionTrigger,
                            (busy || actionBusy || hasPending) && styles.disabledButton,
                          ]}
                          onPress={() => {
                            setSelectedItemId(menuId);
                            setReplacementId("");
                            setReason("");
                          }}
                        >
                          <Ionicons
                            name={hasPending ? "hourglass-outline" : "swap-horizontal-outline"}
                            size={17}
                            color="#9a3e12"
                          />
                          <Text style={styles.merchantSubstitutionTriggerText}>
                            {hasPending ? "Esperando respuesta" : "Gestionar faltante"}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
            {selectedOrderItem && selectedCatalogItem ? (
              <View style={styles.merchantSubstitutionComposer}>
                <View>
                  <Text style={styles.merchantScreenEyebrow}>SUSTITUCIÓN</Text>
                  <Text style={styles.merchantDetailSectionTitle}>
                    Reemplazar {selectedOrderItem.name}
                  </Text>
                  <Text style={styles.cardText}>
                    Se marcará sin stock sólo en {branch?.name || "la sucursal del pedido"}. El
                    cliente recibirá una propuesta verificable.
                  </Text>
                </View>
                {!order.branchId ? (
                  <View style={styles.merchantDetailError}>
                    <Ionicons name="alert-circle-outline" size={18} color="#a33b28" />
                    <Text style={styles.merchantDetailErrorText}>
                      El pedido no conserva una sucursal operable; no se permite modificar
                      inventario.
                    </Text>
                  </View>
                ) : null}
                {candidates.length ? (
                  <>
                    <Text style={styles.issueFieldLabel}>Elegí un reemplazo disponible</Text>
                    <View style={styles.merchantReplacementList}>
                      {candidates.map((item) => (
                        <Pressable
                          key={item.id}
                          style={[
                            styles.merchantReplacementOption,
                            replacementId === item.id && styles.merchantReplacementOptionActive,
                          ]}
                          onPress={() => setReplacementId(item.id)}
                        >
                          <View style={styles.merchantReplacementRadio}>
                            {replacementId === item.id ? (
                              <View style={styles.merchantReplacementRadioDot} />
                            ) : null}
                          </View>
                          <View style={styles.merchantAccountCopy}>
                            <Text style={styles.itemName}>{item.name}</Text>
                            <Text style={styles.cardText}>
                              {item.category || "Sin categoría"} · {money.format(item.price)}
                            </Text>
                          </View>
                          {selectedCatalogItem.category &&
                          item.category === selectedCatalogItem.category ? (
                            <Text style={styles.merchantRecommendedBadge}>MISMA CATEGORÍA</Text>
                          ) : null}
                        </Pressable>
                      ))}
                    </View>
                    <TextInput
                      value={reason}
                      onChangeText={setReason}
                      maxLength={500}
                      multiline
                      numberOfLines={3}
                      placeholder="Motivo para el cliente"
                      style={[styles.input, styles.issueDescriptionInput]}
                    />
                    <Pressable
                      disabled={
                        !order.branchId ||
                        !replacementId ||
                        reason.trim().length < 3 ||
                        busy ||
                        actionBusy ||
                        selectedPending
                      }
                      style={[
                        styles.issueSubmitButton,
                        (!order.branchId ||
                          !replacementId ||
                          reason.trim().length < 3 ||
                          busy ||
                          actionBusy ||
                          selectedPending) &&
                          styles.disabledButton,
                      ]}
                      onPress={() => void submitSubstitution()}
                    >
                      {actionBusy ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Ionicons name="paper-plane-outline" size={18} color="#fff" />
                      )}
                      <Text style={styles.issueSubmitText}>
                        {actionBusy ? "Validando inventario…" : "Marcar agotado y proponer"}
                      </Text>
                    </Pressable>
                  </>
                ) : (
                  <View style={styles.merchantDetailError}>
                    <Ionicons name="alert-circle-outline" size={18} color="#a33b28" />
                    <Text style={styles.merchantDetailErrorText}>
                      No hay otro producto disponible de precio igual o menor en esta sucursal.
                    </Text>
                  </View>
                )}
              </View>
            ) : null}
            <View style={styles.merchantDetailSection}>
              <View style={styles.merchantDetailSectionHeader}>
                <Text style={styles.sectionTitle}>Cambios del pedido</Text>
                {loading ? <ActivityIndicator size="small" color="#ef641f" /> : null}
              </View>
              {substitutions.map((entry) => (
                <View key={entry.id} style={styles.merchantSubstitutionHistory}>
                  <View
                    style={[
                      styles.merchantSubstitutionStatus,
                      entry.status === "pending"
                        ? styles.merchantSubstitutionPending
                        : entry.status === "accepted"
                          ? styles.merchantSubstitutionAccepted
                          : styles.merchantSubstitutionRejected,
                    ]}
                  >
                    <Text style={styles.merchantSubstitutionStatusText}>
                      {entry.status === "pending"
                        ? "PENDIENTE"
                        : entry.status === "accepted"
                          ? "ACEPTADO"
                          : "RECHAZADO"}
                    </Text>
                  </View>
                  <Text style={styles.merchantDetailItemTitle}>
                    {entry.original.name} → {entry.replacement.name}
                  </Text>
                  <Text style={styles.cardText}>{entry.reason}</Text>
                  {entry.refundAmount > 0 ? (
                    <Text style={styles.merchantRefundText}>
                      Reintegro aplicado: {money.format(entry.refundAmount)}
                    </Text>
                  ) : null}
                </View>
              ))}
              {!loading && !substitutions.length ? (
                <Text style={styles.muted}>Todavía no se propusieron cambios.</Text>
              ) : null}
            </View>
            {error ? (
              <View style={styles.merchantDetailError}>
                <Ionicons name="alert-circle-outline" size={18} color="#a33b28" />
                <Text style={styles.merchantDetailErrorText}>{error}</Text>
              </View>
            ) : null}
            <View style={styles.merchantDetailDelivery}>
              <Ionicons name="location-outline" size={20} color="#7c3cff" />
              <View style={styles.merchantAccountCopy}>
                <Text style={styles.merchantDetailItemTitle}>Destino de entrega</Text>
                <Text style={styles.cardText}>{order.deliveryAddress}</Text>
              </View>
            </View>
            <Pressable style={styles.merchantDetailChat} onPress={() => onOpenChat(order.id)}>
              <Ionicons name="chatbubbles-outline" size={19} color="#fff" />
              <Text style={styles.issueSubmitText}>Abrir chat del pedido</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
