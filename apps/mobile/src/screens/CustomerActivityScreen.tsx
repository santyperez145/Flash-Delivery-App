import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import { api } from "../api";
import { GroupOrderPanel } from "../GroupOrderPanel";
import { money } from "../format";
import { styles } from "../styles";
import { ActionButton } from "../ui";
import type {
  GroupOrder,
  MobileCartLine,
  Order,
  OrderSubstitution,
  Ride,
  ServiceCancellation,
  ServiceReceipt,
  ServiceTip,
  Shipment,
  ShipmentClaim,
  ShipmentReturn,
} from "../types";

type CompletedService = {
  id: string;
  kind: "order" | "ride" | "shipment";
  label: string;
  amount: number;
};

type RecentCancellation = ServiceCancellation & { label: string };

type CustomerActivityScreenProps = {
  restaurantId: string | null;
  cart: MobileCartLine[];
  userId: string;
  busy: boolean;
  activeOrders: Order[];
  activeRides: Ride[];
  activeShipments: Shipment[];
  pendingSubstitutions: OrderSubstitution[];
  completedServices: CompletedService[];
  recentCancellations: RecentCancellation[];
  tips: ServiceTip[];
  receipts: Record<string, ServiceReceipt>;
  shipments: Shipment[];
  shipmentReturns: ShipmentReturn[];
  shipmentClaims: ShipmentClaim[];
  activityCursor: string | null;
  activityLoading: boolean;
  onCheckoutGroup: (group: GroupOrder) => void;
  runAction: (action: () => Promise<unknown>, success: string) => void;
  onSubstitutionResolved: (substitution: OrderSubstitution) => void;
  onTrackOrder: (orderId: string) => void;
  onTrackRide: (rideId: string) => void;
  onTrackShipment: (shipmentId: string) => void;
  onChat: (jobId: string) => void;
  onReceiptLoaded: (serviceId: string, receipt: ServiceReceipt) => void;
  onReorderLoaded: (cart: MobileCartLine[]) => void;
  onReportOrderIssue: (orderId: string) => void;
  onRequestReturn: (shipmentId: string) => void;
  onOpenClaimEvidence: (evidenceId: string) => Promise<void>;
  onAttachClaimEvidence: (claimId: string) => Promise<void>;
  onReportShipmentClaim: (shipmentId: string, declaredValue: number) => void;
  onLoadMore: () => void;
};

export function CustomerActivityScreen({
  restaurantId,
  cart,
  userId,
  busy,
  activeOrders,
  activeRides,
  activeShipments,
  pendingSubstitutions,
  completedServices,
  recentCancellations,
  tips,
  receipts,
  shipments,
  shipmentReturns,
  shipmentClaims,
  activityCursor,
  activityLoading,
  onCheckoutGroup,
  runAction,
  onSubstitutionResolved,
  onTrackOrder,
  onTrackRide,
  onTrackShipment,
  onChat,
  onReceiptLoaded,
  onReorderLoaded,
  onReportOrderIssue,
  onRequestReturn,
  onOpenClaimEvidence,
  onAttachClaimEvidence,
  onReportShipmentClaim,
  onLoadMore,
}: CustomerActivityScreenProps) {
  const hasActivity =
    activeOrders.length + activeRides.length + activeShipments.length > 0 ||
    pendingSubstitutions.length > 0 ||
    completedServices.length > 0 ||
    recentCancellations.length > 0;

  return (
    <>
      <View style={styles.activityHeading}>
        <Text style={styles.foodRestaurantTitle}>Actividad</Text>
        <Text style={styles.cardText}>Pedidos, viajes y envíos en un solo lugar.</Text>
      </View>
      <GroupOrderPanel
        restaurantId={restaurantId}
        cart={cart}
        userId={userId}
        onCheckoutGroup={onCheckoutGroup}
        busy={busy}
      />
      {!hasActivity && (
        <View style={styles.foodEmpty}>
          <Ionicons name="time-outline" size={56} color="#7c3cff" />
          <Text style={styles.foodSectionTitle}>Todavía no hay actividad</Text>
        </View>
      )}
      {pendingSubstitutions.length > 0 && (
        <PendingSubstitutions
          substitutions={pendingSubstitutions}
          busy={busy}
          runAction={runAction}
          onResolved={onSubstitutionResolved}
        />
      )}
      {activeOrders.map((order) => (
        <View key={order.id} style={styles.stack}>
          <Pressable style={styles.activityCard} onPress={() => onTrackOrder(order.id)}>
            <View style={styles.activityIconFood}>
              <Ionicons name="fast-food" size={21} color="#fff" />
            </View>
            <View style={styles.itemCopy}>
              <Text style={styles.cardTitle}>Pedido · {order.status}</Text>
              <Text style={styles.cardText}>{order.deliveryAddress}</Text>
              <Text style={styles.totalText}>{money.format(order.total)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#aaa" />
          </Pressable>
          <ChatAction label="Chat con comercio y repartidor" onPress={() => onChat(order.id)} />
        </View>
      ))}
      {activeRides.map((ride) => (
        <View key={ride.id} style={styles.stack}>
          <Pressable style={styles.activityCard} onPress={() => onTrackRide(ride.id)}>
            <View style={styles.activityIconRide}>
              <Ionicons name="car-sport" size={21} color="#fff" />
            </View>
            <View style={styles.itemCopy}>
              <Text style={styles.cardTitle}>Viaje · {ride.status}</Text>
              <Text style={styles.cardText}>
                {ride.pickup} → {ride.destination}
              </Text>
              <Text style={styles.totalText}>{money.format(ride.fare)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#aaa" />
          </Pressable>
          <ChatAction label="Chat con el conductor" onPress={() => onChat(ride.id)} />
        </View>
      ))}
      {activeShipments.map((shipment) => (
        <View key={shipment.id} style={styles.stack}>
          <Pressable style={styles.activityCard} onPress={() => onTrackShipment(shipment.id)}>
            <View style={styles.activityIconRide}>
              <Ionicons name="cube" size={21} color="#fff" />
            </View>
            <View style={styles.itemCopy}>
              <Text style={styles.cardTitle}>Envío · {shipment.status}</Text>
              <Text style={styles.cardText}>
                {shipment.pickup} → {shipment.destination}
              </Text>
              <Text style={styles.totalText}>{money.format(shipment.fare)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#aaa" />
          </Pressable>
          <ChatAction label="Chat con el conductor" onPress={() => onChat(shipment.id)} />
        </View>
      ))}
      {recentCancellations.length > 0 && (
        <>
          <Text style={styles.foodSectionTitle}>Cancelaciones</Text>
          {recentCancellations.map((cancellation) => (
            <View key={cancellation.id} style={styles.card}>
              <Text style={styles.cardTitle}>{cancellation.label}</Text>
              <Text style={styles.cardText}>
                Motivo: {cancellation.reason.replaceAll("_", " ")}
              </Text>
              <Text style={styles.totalText}>
                Reintegro · {money.format(cancellation.refundAmount)}
              </Text>
              <Text style={styles.cardText}>
                {new Date(cancellation.createdAt).toLocaleString("es-AR")}
              </Text>
            </View>
          ))}
        </>
      )}
      {completedServices.length > 0 && (
        <>
          <Text style={styles.foodSectionTitle}>Servicios completados</Text>
          {completedServices.map((service) => (
            <CompletedServiceCard
              key={service.id}
              service={service}
              busy={busy}
              existingTip={tips.find((tip) => tip.jobId === service.id)}
              receipt={receipts[service.id]}
              shipment={shipments.find((entry) => entry.id === service.id)}
              shipmentReturn={shipmentReturns.find((entry) => entry.shipmentId === service.id)}
              shipmentClaim={shipmentClaims.find((entry) => entry.shipmentId === service.id)}
              runAction={runAction}
              onReceiptLoaded={onReceiptLoaded}
              onReorderLoaded={onReorderLoaded}
              onReportOrderIssue={onReportOrderIssue}
              onRequestReturn={onRequestReturn}
              onOpenClaimEvidence={onOpenClaimEvidence}
              onAttachClaimEvidence={onAttachClaimEvidence}
              onReportShipmentClaim={onReportShipmentClaim}
            />
          ))}
        </>
      )}
      {activityCursor ? (
        <Pressable
          disabled={activityLoading}
          style={[styles.secondaryButton, activityLoading && styles.disabledButton]}
          onPress={onLoadMore}
        >
          <Text style={styles.secondaryButtonText}>
            {activityLoading ? "Cargando…" : "Ver actividad anterior"}
          </Text>
        </Pressable>
      ) : null}
    </>
  );
}

function ChatAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.shareAction} onPress={onPress}>
      <Ionicons name="chatbubbles-outline" size={18} color="#7c3cff" />
      <Text style={styles.shareActionText}>{label}</Text>
    </Pressable>
  );
}

function PendingSubstitutions({
  substitutions,
  busy,
  runAction,
  onResolved,
}: {
  substitutions: OrderSubstitution[];
  busy: boolean;
  runAction: CustomerActivityScreenProps["runAction"];
  onResolved: CustomerActivityScreenProps["onSubstitutionResolved"];
}) {
  const decide = (substitutionId: string, decision: "accepted" | "rejected") =>
    runAction(
      async () => {
        const result = await api.decideOrderSubstitution(substitutionId, decision);
        onResolved(result.substitution);
      },
      decision === "accepted"
        ? "Sustitución aceptada y diferencia reintegrada"
        : "Sustitución rechazada",
    );

  return (
    <>
      <View style={styles.substitutionSectionTitle}>
        <View>
          <Text style={styles.foodSectionTitle}>Necesitan tu decisión</Text>
          <Text style={styles.cardText}>El comercio no puede avanzar hasta que respondas.</Text>
        </View>
        <View style={styles.substitutionCount}>
          <Text style={styles.substitutionCountText}>{substitutions.length}</Text>
        </View>
      </View>
      {substitutions.map((substitution) => {
        const difference = Math.max(
          0,
          (substitution.original.unitPrice - substitution.replacement.unitPrice) *
            substitution.quantity,
        );
        return (
          <View key={substitution.id} style={styles.substitutionCard}>
            <View style={styles.substitutionAlert}>
              <Ionicons name="swap-horizontal" size={22} color="#fff" />
            </View>
            <View style={styles.substitutionContent}>
              <Text style={styles.substitutionEyebrow}>Sustitución propuesta</Text>
              <Text style={styles.substitutionTitle}>{substitution.original.name}</Text>
              <View style={styles.substitutionArrowRow}>
                <View style={styles.substitutionProduct}>
                  <Text style={styles.cardText}>Original</Text>
                  <Text style={styles.substitutionPrice}>
                    {money.format(substitution.original.unitPrice)}
                  </Text>
                </View>
                <Ionicons name="arrow-forward" size={20} color="#7c3cff" />
                <View style={styles.substitutionProduct}>
                  <Text style={styles.cardText}>{substitution.replacement.name}</Text>
                  <Text style={styles.substitutionPrice}>
                    {money.format(substitution.replacement.unitPrice)}
                  </Text>
                </View>
              </View>
              <Text style={styles.substitutionReason}>{substitution.reason}</Text>
              {difference > 0 && (
                <View style={styles.substitutionRefund}>
                  <Ionicons name="wallet-outline" size={17} color="#087a50" />
                  <Text style={styles.substitutionRefundText}>
                    Recibís {money.format(difference)} en Flash Wallet
                  </Text>
                </View>
              )}
              <View style={styles.substitutionActions}>
                <Pressable
                  disabled={busy}
                  style={[styles.substitutionReject, busy && styles.disabledButton]}
                  onPress={() => decide(substitution.id, "rejected")}
                >
                  <Text style={styles.substitutionRejectText}>Rechazar</Text>
                </Pressable>
                <Pressable
                  disabled={busy}
                  style={[styles.substitutionAccept, busy && styles.disabledButton]}
                  onPress={() => decide(substitution.id, "accepted")}
                >
                  <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  <Text style={styles.substitutionAcceptText}>Aceptar cambio</Text>
                </Pressable>
              </View>
            </View>
          </View>
        );
      })}
    </>
  );
}

function CompletedServiceCard({
  service,
  busy,
  existingTip,
  receipt,
  shipment,
  shipmentReturn,
  shipmentClaim,
  runAction,
  onReceiptLoaded,
  onReorderLoaded,
  onReportOrderIssue,
  onRequestReturn,
  onOpenClaimEvidence,
  onAttachClaimEvidence,
  onReportShipmentClaim,
}: {
  service: CompletedService;
  busy: boolean;
  existingTip?: ServiceTip;
  receipt?: ServiceReceipt;
  shipment?: Shipment;
  shipmentReturn?: ShipmentReturn;
  shipmentClaim?: ShipmentClaim;
  runAction: CustomerActivityScreenProps["runAction"];
  onReceiptLoaded: CustomerActivityScreenProps["onReceiptLoaded"];
  onReorderLoaded: CustomerActivityScreenProps["onReorderLoaded"];
  onReportOrderIssue: CustomerActivityScreenProps["onReportOrderIssue"];
  onRequestReturn: CustomerActivityScreenProps["onRequestReturn"];
  onOpenClaimEvidence: CustomerActivityScreenProps["onOpenClaimEvidence"];
  onAttachClaimEvidence: CustomerActivityScreenProps["onAttachClaimEvidence"];
  onReportShipmentClaim: CustomerActivityScreenProps["onReportShipmentClaim"];
}) {
  const suggested = Math.max(
    100,
    Math.min(
      Math.floor(service.amount * 0.5),
      Math.max(500, Math.round((service.amount * 0.1) / 100) * 100),
    ),
  );
  const secondSuggestion = Math.min(Math.floor(service.amount * 0.5), suggested * 2);

  const reorder = () =>
    runAction(async () => {
      const result = await api.reorder(service.id);
      onReorderLoaded(
        result.cart.map((line) => ({
          lineId: `${line.item.id}:${line.extras.slice().sort().join(",")}:${line.note}`,
          restaurantId: line.restaurantId,
          menuItemId: line.item.id,
          name: line.item.name,
          unitPrice: line.item.price,
          quantity: line.quantity,
          extras: line.extras,
          note: line.note,
        })),
      );
    }, "Carrito reconstruido con precios y stock actuales");

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{service.label}</Text>
      {receipt ? (
        <View>
          <Text style={styles.totalText}>
            {receipt.number} · {money.format(receipt.total)}
          </Text>
          <Text style={styles.cardText}>
            {new Date(receipt.issuedAt).toLocaleString("es-AR")} · Comprobante de servicio no fiscal
          </Text>
          {receipt.lineItems.map((line, index) => (
            <Text key={`${receipt.id}-${index}`} style={styles.cardText}>
              {line.quantity}× {line.name} · {money.format(line.total)}
            </Text>
          ))}
        </View>
      ) : (
        <ActionButton
          label="Ver comprobante"
          disabled={busy}
          onPress={() =>
            runAction(async () => {
              const response = await api.getReceipt(service.id);
              onReceiptLoaded(service.id, response.receipt);
            }, "Comprobante cargado")
          }
        />
      )}
      {service.kind === "order" && (
        <>
          <Pressable style={styles.reorderButton} disabled={busy} onPress={reorder}>
            <Ionicons name="refresh-outline" size={18} color="#fff" />
            <Text style={styles.reorderButtonText}>Pedir de nuevo</Text>
          </Pressable>
          <Pressable
            style={styles.reportIssueButton}
            disabled={busy}
            onPress={() => onReportOrderIssue(service.id)}
          >
            <Ionicons name="alert-circle-outline" size={18} color="#d14b32" />
            <Text style={styles.reportIssueText}>Reportar un problema con el pedido</Text>
            <Ionicons name="chevron-forward" size={17} color="#a29aa5" />
          </Pressable>
        </>
      )}
      {service.kind === "shipment" &&
        (shipmentReturn ? (
          <View style={styles.returnStatusCard}>
            <Ionicons name="return-down-back" size={18} color="#7c3cff" />
            <Text style={styles.cardText}>
              Devolución · {shipmentReturn.status.replaceAll("_", " ")}
            </Text>
          </View>
        ) : (
          <Pressable
            style={styles.reportIssueButton}
            disabled={busy}
            onPress={() => onRequestReturn(service.id)}
          >
            <Ionicons name="return-down-back" size={18} color="#7c3cff" />
            <Text style={styles.reportIssueText}>Solicitar devolución</Text>
            <Ionicons name="chevron-forward" size={17} color="#a29aa5" />
          </Pressable>
        ))}
      {service.kind === "shipment" && shipment?.protection === "standard" && (
        <ShipmentClaimControl
          claim={shipmentClaim}
          shipment={shipment}
          busy={busy}
          runAction={runAction}
          onOpenClaimEvidence={onOpenClaimEvidence}
          onAttachClaimEvidence={onAttachClaimEvidence}
          onReportShipmentClaim={onReportShipmentClaim}
        />
      )}
      <Text style={styles.foodSectionTitle}>Propina</Text>
      {existingTip ? (
        <Text style={styles.totalText}>Enviada · {money.format(existingTip.amount)}</Text>
      ) : (
        <>
          <Text style={styles.cardText}>Va completa a la Wallet del conductor.</Text>
          <View style={styles.actionRow}>
            {[suggested, secondSuggestion].map((amount, index) => (
              <ActionButton
                key={`${service.id}-tip-${index}`}
                label={money.format(amount)}
                disabled={busy}
                onPress={() =>
                  runAction(() => api.createTip(service.id, amount), "Propina enviada")
                }
              />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

function ShipmentClaimControl({
  claim,
  shipment,
  busy,
  runAction,
  onOpenClaimEvidence,
  onAttachClaimEvidence,
  onReportShipmentClaim,
}: {
  claim?: ShipmentClaim;
  shipment: Shipment;
  busy: boolean;
  runAction: CustomerActivityScreenProps["runAction"];
  onOpenClaimEvidence: CustomerActivityScreenProps["onOpenClaimEvidence"];
  onAttachClaimEvidence: CustomerActivityScreenProps["onAttachClaimEvidence"];
  onReportShipmentClaim: CustomerActivityScreenProps["onReportShipmentClaim"];
}) {
  if (!claim) {
    return (
      <Pressable
        style={styles.reportIssueButton}
        disabled={busy}
        onPress={() => onReportShipmentClaim(shipment.id, shipment.declaredValue || 0)}
      >
        <Ionicons name="shield-outline" size={18} color="#087a50" />
        <Text style={styles.reportIssueText}>Reportar siniestro protegido</Text>
        <Ionicons name="chevron-forward" size={17} color="#a29aa5" />
      </Pressable>
    );
  }

  return (
    <View style={styles.returnStatusCard}>
      <Ionicons name="shield-checkmark" size={18} color="#087a50" />
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={styles.cardText}>
          Siniestro · {claim.status.replaceAll("_", " ")} · elegible{" "}
          {money.format(claim.eligibleAmount)}
        </Text>
        {claim.evidence?.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => runAction(() => onOpenClaimEvidence(item.id), "Evidencia abierta")}
          >
            <Text style={styles.reportIssueText}>
              📎 {item.fileName} · {Math.ceil(item.sizeBytes / 1024)} KB
            </Text>
          </Pressable>
        ))}
        {["submitted", "under_review"].includes(claim.status) && (
          <Pressable
            disabled={busy}
            onPress={() =>
              runAction(() => onAttachClaimEvidence(claim.id), "Evidencia cifrada y adjuntada")
            }
          >
            <Text style={styles.reportIssueText}>+ Adjuntar foto o PDF</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
