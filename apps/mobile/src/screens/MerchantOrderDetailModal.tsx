// Detalle de comanda y sustituciones mobile (ARC-001).
//
// DoorDash Business Manager y Uber Eats aíslan el 86-item de la cola. Flash
// conserva propuesta, inventario por sucursal y chat del pedido aquí.
import { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { api } from "../api";
import { mobileOrderStatusLabel, money } from "../format";
import { styles } from "../styles";
import type { Order, OrderSubstitution, Restaurant } from "../types";

export function MerchantOrderDetailModal({
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
