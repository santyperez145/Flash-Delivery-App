import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable, Text, View } from "react-native";

import { RescheduleControl } from "../SchedulePicker";
import { flashDesign } from "../design-system";
import { mobileOrderStatusLabel, money } from "../format";
import { styles } from "../styles";
import type { Order } from "../types";

export function CustomerFoodOrdersScreen({
  visible,
  lastCreatedOrder,
  activeOrders,
  busy,
  onHome,
  onConfirmedActivity,
  onShare,
  onTrack,
  onReschedule,
  onCancel,
}: {
  visible: boolean;
  lastCreatedOrder: Order | null;
  activeOrders: Order[];
  busy: boolean;
  onHome: () => void;
  onConfirmedActivity: () => void;
  onShare: (order: Order) => void;
  onTrack: (orderId: string) => void;
  onReschedule: (orderId: string, scheduledFor: string) => void;
  onCancel: (orderId: string) => void;
}) {
  if (!visible) return null;

  return (
    <>
      {lastCreatedOrder ? (
        <LinearGradient colors={["#FFF4E9", "#FFE7D6"]} style={styles.orderConfirmationCard}>
          <View style={styles.orderConfirmationIcon}>
            <Ionicons name="checkmark" size={29} color="#fff" />
          </View>
          <Text style={styles.orderConfirmationEyebrow}>PEDIDO CONFIRMADO</Text>
          <Text style={styles.orderConfirmationTitle}>El comercio ya lo recibió</Text>
          <Text style={styles.orderConfirmationCopy}>
            Pedido {lastCreatedOrder.id} · entrega estimada en {lastCreatedOrder.etaMin} min.
          </Text>
          <Text style={styles.orderConfirmationTotal}>{money.format(lastCreatedOrder.total)}</Text>
          <Pressable style={styles.orderConfirmationAction} onPress={onConfirmedActivity}>
            <Text style={styles.orderConfirmationActionText}>Seguir en Actividad</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </Pressable>
        </LinearGradient>
      ) : null}
      <View style={styles.foodPageHeader}>
        <Pressable onPress={onHome} style={styles.foodBack}>
          <Ionicons name="chevron-back" size={20} color={flashDesign.color.ink} />
        </Pressable>
        <View style={styles.foodPageHeaderCopy}>
          <Text style={styles.foodPageTitle}>Tus pedidos</Text>
          <Text style={styles.foodPageSubtitle}>Estado y próxima acción en tiempo real</Text>
        </View>
      </View>
      <View style={styles.foodSectionHeader}>
        <Text style={styles.foodSectionTitle}>En curso</Text>
        <Text style={styles.foodSeeAll}>{activeOrders.length} activos</Text>
      </View>
      {activeOrders.length === 0 ? (
        <View style={styles.foodEmpty}>
          <View style={styles.foodEmptyIcon}>
            <Ionicons name="receipt-outline" size={30} color={flashDesign.color.food} />
          </View>
          <Text style={styles.foodEmptyTitle}>No hay pedidos en curso</Text>
          <Text style={styles.foodEmptyCopy}>
            Cuando confirmes una compra, su preparación y entrega aparecerán acá y en Actividad.
          </Text>
          <Pressable style={styles.foodEmptyAction} onPress={onHome}>
            <Text style={styles.foodEmptyActionText}>Explorar restaurantes</Text>
          </Pressable>
        </View>
      ) : null}
      {activeOrders.map((order) => (
        <View key={order.id} style={styles.foodActiveOrderCard}>
          <View style={styles.foodActiveOrderHeader}>
            <View style={styles.foodActiveOrderIcon}>
              <Ionicons name="restaurant" size={19} color="#fff" />
            </View>
            <View style={styles.itemCopy}>
              <Text style={styles.foodActiveOrderEyebrow}>PEDIDO {order.id}</Text>
              <Text style={styles.foodActiveOrderStatus}>
                {mobileOrderStatusLabel[order.status]}
              </Text>
            </View>
            <Text style={styles.foodActiveOrderEta}>{order.etaMin} min</Text>
          </View>
          <View style={styles.foodActiveOrderDestination}>
            <Ionicons name="location-outline" size={17} color={flashDesign.color.food} />
            <Text style={styles.foodActiveOrderDestinationText} numberOfLines={2}>
              {order.deliveryAddress}
            </Text>
            <Text style={styles.foodActiveOrderTotal}>{money.format(order.total)}</Text>
          </View>
          <View style={styles.foodActiveOrderActions}>
            <Pressable style={styles.foodActiveOrderSecondary} onPress={() => onShare(order)}>
              <Ionicons name="share-social-outline" size={17} color={flashDesign.color.food} />
              <Text style={styles.foodActiveOrderSecondaryText}>Compartir</Text>
            </Pressable>
            <Pressable style={styles.foodActiveOrderPrimary} onPress={() => onTrack(order.id)}>
              <Ionicons name="map-outline" size={17} color="#fff" />
              <Text style={styles.foodActiveOrderPrimaryText}>Ver seguimiento</Text>
            </Pressable>
          </View>
          {order.scheduledFor && ["requested", "accepted"].includes(order.status) ? (
            <RescheduleControl
              scheduledFor={order.scheduledFor}
              disabled={busy}
              onReschedule={(iso) => onReschedule(order.id, iso)}
            />
          ) : null}
          {!["delivered", "cancelled"].includes(order.status) ? (
            <Pressable
              disabled={busy}
              style={styles.foodActiveOrderCancel}
              onPress={() => onCancel(order.id)}
            >
              <Text style={styles.foodActiveOrderCancelText}>Cancelar pedido</Text>
              <Ionicons name="chevron-forward" size={16} color={flashDesign.color.danger} />
            </Pressable>
          ) : null}
        </View>
      ))}
    </>
  );
}
