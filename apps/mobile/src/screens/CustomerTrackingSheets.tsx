import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Alert, Pressable, ScrollView, Share, Text, View } from "react-native";

import { api } from "../api";
import FlashNativeMap from "../FlashNativeMap";
import { money } from "../format";
import { styles } from "../styles";
import { MobileTaskSheet, NativeMapUnavailable } from "../ui";
import type {
  DeliveryEvidence,
  Driver,
  Order,
  Ride,
  RideTrustedContact,
  Shipment,
  ShipmentReturn,
} from "../types";
import { CustomerTrackingProgress } from "./CustomerTrackingProgress";
import { useTrackingRoute } from "./useTrackingRoute";

export function OrderTrackingSheet({
  order,
  driver,
  onClose,
}: {
  order: Order | null;
  driver: Driver | null;
  onClose: () => void;
}) {
  const { route, routeError, hasMap } = useTrackingRoute({
    resourceId: order?.id,
    origin: order?.pickupLocation,
    destination: order?.deliveryLocation,
    errorMessage: "No pudimos cargar la ruta; el estado del pedido sigue actualizado.",
  });
  if (!order) return null;
  const stages = [
      "accepted",
      "preparing",
      "ready_for_pickup",
      "courier_assigned",
      "picked_up",
      "delivering",
      "delivered",
    ],
    current = Math.max(0, stages.indexOf(order.status)),
    labels = [
      "Confirmado",
      "Preparando",
      "Listo",
      "Repartidor asignado",
      "Retirado",
      "En camino",
      "Entregado",
    ];
  return (
    <MobileTaskSheet
      eyebrow="Seguimiento en vivo"
      title={`Pedido ${order.id}`}
      accessibilityLabel="Seguimiento del pedido"
      onClose={onClose}
    >
      {hasMap ? (
        <FlashNativeMap
          origin={order.pickupLocation!}
          destination={order.deliveryLocation!}
          route={route?.coordinates || []}
          driver={driver?.location || null}
          routeColor="#ff6a21"
          driverIcon="bicycle"
          caption={
            route
              ? `${route.distanceKm} km · ${route.durationMin} min de recorrido`
              : routeError || "Calculando ruta…"
          }
          detail={driver ? `${driver.name} · ${driver.vehicle}` : "Buscando repartidor disponible"}
          accessibilityLabel="Mapa interactivo del pedido"
        />
      ) : (
        <NativeMapUnavailable
          message={
            routeError || "El comercio o la entrega todavía no tienen coordenadas verificadas."
          }
        />
      )}
      <View style={styles.trackingStatus}>
        <Text style={styles.foodRestaurantTitle}>{labels[current]}</Text>
        <Text style={styles.cardText}>
          {order.status === "delivered"
            ? "Tu pedido fue entregado."
            : `ETA publicada: ${order.etaMin} min`}
        </Text>
        <CustomerTrackingProgress labels={labels} current={current} activeColor="#ff6a21" />
      </View>
      <Pressable
        style={styles.orderConfirmationAction}
        onPress={() =>
          Share.share({
            title: "Pedido Flash",
            message: `Mi pedido ${order.id} está ${labels[current].toLowerCase()}.`,
          })
        }
      >
        <Ionicons name="share-social-outline" size={18} color="#fff" />
        <Text style={styles.orderConfirmationActionText}>Compartir estado</Text>
      </Pressable>
    </MobileTaskSheet>
  );
}

export function RideTrackingSheet({
  ride,
  driver,
  contacts,
  pickupCode,
  onRevealCode,
  onShare,
  onSos,
  onCancel,
  onClose,
}: {
  ride: Ride | null;
  driver: Driver | null;
  contacts: RideTrustedContact[];
  pickupCode: string | null;
  onRevealCode: () => Promise<void>;
  onShare: (contact?: RideTrustedContact) => void;
  onSos: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const { route, routeError, hasMap } = useTrackingRoute({
    resourceId: ride?.id,
    origin: ride?.pickupLocation,
    destination: ride?.destinationLocation,
    errorMessage: "La ruta no está disponible; el estado del viaje sigue actualizado.",
  });
  if (!ride) return null;
  const stages: Ride["status"][] = [
      "requested",
      "driver_assigned",
      "arriving",
      "in_progress",
      "completed",
    ],
    labels = [
      "Buscando conductor",
      "Conductor asignado",
      "Llegando a buscarte",
      "Viaje en curso",
      "Llegaste",
    ],
    current = Math.max(0, stages.indexOf(ride.status)),
    headline = labels[current] || ride.status.replaceAll("_", " ");
  return (
    <MobileTaskSheet
      eyebrow="Viaje en vivo"
      title={headline}
      accessibilityLabel="Seguimiento del viaje"
      onClose={onClose}
    >
      {hasMap ? (
        <FlashNativeMap
          origin={ride.pickupLocation!}
          destination={ride.destinationLocation!}
          route={route?.coordinates || []}
          driver={driver?.location || null}
          routeColor="#7c3cff"
          caption={
            route
              ? `${route.distanceKm} km · ${route.durationMin} min`
              : routeError || "Calculando ruta real…"
          }
          detail={
            driver ? `${driver.name} · ${driver.vehicle}` : "Buscando un conductor disponible"
          }
          accessibilityLabel="Mapa interactivo del viaje"
        />
      ) : (
        <NativeMapUnavailable
          message={
            routeError || "El origen o el destino todavía no tienen coordenadas verificadas."
          }
        />
      )}
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.trackingStatus}>
          <Text style={styles.foodRestaurantTitle}>{headline}</Text>
          <Text style={styles.cardText}>
            {ride.pickup} → {ride.destination}
          </Text>
          <CustomerTrackingProgress labels={labels} current={current} activeColor="#7c3cff" />
        </View>
        {driver ? (
          <View style={styles.shipmentTrackingSummary}>
            <View>
              <Text style={styles.orderConfirmationEyebrow}>TU CONDUCTOR</Text>
              <Text style={styles.sectionTitle}>{driver.name}</Text>
              <Text style={styles.cardText}>
                {driver.vehicle} · ★ {driver.rating.toFixed(1)}
              </Text>
            </View>
            <View style={styles.shipmentTrackingBadge}>
              <Ionicons name="car-sport" size={20} color="#fff" />
            </View>
          </View>
        ) : null}
        {["driver_assigned", "arriving"].includes(ride.status) ? (
          <View style={styles.shipmentPinCard}>
            <Text style={styles.orderConfirmationEyebrow}>PIN PARA INICIAR</Text>
            {pickupCode ? (
              <>
                <Text style={styles.shipmentPin}>{pickupCode}</Text>
                <Text style={styles.helperText}>
                  Decíselo al conductor sólo cuando estés junto al vehículo correcto.
                </Text>
              </>
            ) : (
              <Pressable style={styles.orderConfirmationAction} onPress={() => void onRevealCode()}>
                <Ionicons name="key-outline" size={18} color="#fff" />
                <Text style={styles.orderConfirmationActionText}>Mostrar PIN seguro</Text>
              </Pressable>
            )}
          </View>
        ) : null}
        <View style={styles.safetyStrip}>
          <View style={styles.safetyIcon}>
            <Ionicons name="shield-checkmark" size={21} color="#087a4b" />
          </View>
          <View style={styles.itemCopy}>
            <Text style={styles.safetyTitle}>Centro de seguridad</Text>
            <Text style={styles.helperText}>
              Compartí tu ruta o enviá una alerta vinculada a este viaje.
            </Text>
          </View>
        </View>
        <Pressable style={styles.orderConfirmationAction} onPress={() => onShare()}>
          <Ionicons name="share-social-outline" size={18} color="#fff" />
          <Text style={styles.orderConfirmationActionText}>Compartir seguimiento seguro</Text>
        </Pressable>
        {contacts.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.paymentBrandRail}
          >
            {contacts.map((contact) => (
              <Pressable
                key={contact.id}
                style={styles.issueCategoryPill}
                onPress={() => onShare(contact)}
              >
                <Ionicons name="person-outline" size={15} color="#7c3cff" />
                <Text style={styles.issueCategoryText}>{contact.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <Pressable style={[styles.shareAction, { backgroundColor: "#fff0f0" }]} onPress={onSos}>
          <Ionicons name="warning" size={18} color="#c92626" />
          <Text style={[styles.shareActionText, { color: "#c92626" }]}>Seguridad Flash · SOS</Text>
        </Pressable>
        <Pressable style={styles.reportIssueButton} onPress={onCancel}>
          <Ionicons name="close-circle-outline" size={18} color="#8f3840" />
          <Text style={styles.reportIssueText}>Cancelar viaje</Text>
          <Ionicons name="chevron-forward" size={17} color="#a29aa5" />
        </Pressable>
      </ScrollView>
    </MobileTaskSheet>
  );
}

export function ShipmentTrackingSheet({
  shipment,
  driver,
  shipmentReturn,
  pin,
  onRevealPin,
  onClose,
}: {
  shipment: Shipment | null;
  driver: Driver | null;
  shipmentReturn: ShipmentReturn | null;
  pin: string | null;
  onRevealPin: () => Promise<void>;
  onClose: () => void;
}) {
  const [evidence, setEvidence] = useState<DeliveryEvidence[]>([]),
    [pinBusy, setPinBusy] = useState(false);
  const { route, routeError, hasMap } = useTrackingRoute({
    resourceId: shipment?.id,
    origin: shipment?.pickupLocation,
    destination: shipment?.destinationLocation,
    errorMessage: "No pudimos cargar la ruta; el estado operativo sigue actualizado.",
  });
  useEffect(() => {
    if (!shipment) {
      setEvidence([]);
      return;
    }
    let cancelled = false;
    void api
      .getShipmentDeliveryEvidence(shipment.id)
      .then((result) => {
        if (!cancelled) setEvidence(result.evidence);
      })
      .catch(() => {
        if (!cancelled) setEvidence([]);
      });
    return () => {
      cancelled = true;
    };
  }, [shipment?.id, shipment?.deliveryEvidenceCount]);
  if (!shipment) return null;
  const stages = [
      "requested",
      "driver_assigned",
      "arriving",
      "picked_up",
      "delivering",
      "delivered",
    ],
    labels = [
      "Solicitado",
      "Conductor asignado",
      "Retirando",
      "Paquete retirado",
      "En camino",
      "Entregado",
    ],
    current = Math.max(0, stages.indexOf(shipment.status)),
    photo = evidence.find((entry) => entry.type === "photo"),
    signature = evidence.find((entry) => entry.type === "signature");
  return (
    <MobileTaskSheet
      eyebrow="Envío en vivo"
      title={shipment.id}
      accessibilityLabel="Seguimiento del envío"
      onClose={onClose}
    >
      {hasMap ? (
        <FlashNativeMap
          origin={shipment.pickupLocation!}
          destination={shipment.destinationLocation!}
          route={route?.coordinates || []}
          driver={driver?.location || null}
          routeColor="#087a50"
          driverIcon="bicycle"
          caption={
            route
              ? `${route.distanceKm} km · ${route.durationMin} min de recorrido`
              : routeError || "Calculando ruta real…"
          }
          detail={driver ? `${driver.name} · ${driver.vehicle}` : "Buscando conductor disponible"}
          accessibilityLabel="Mapa interactivo del envío"
        />
      ) : (
        <NativeMapUnavailable
          message={
            routeError || "El retiro o la entrega todavía no tienen coordenadas verificadas."
          }
        />
      )}
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.trackingStatus}>
          <Text style={styles.foodRestaurantTitle}>{labels[current]}</Text>
          <Text style={styles.cardText}>
            {shipment.pickup} → {shipment.destination}
          </Text>
          <CustomerTrackingProgress labels={labels} current={current} activeColor="#087a50" />
        </View>
        <View style={styles.shipmentTrackingSummary}>
          <View>
            <Text style={styles.orderConfirmationEyebrow}>
              {shipment.serviceLevel?.toUpperCase()} · {shipment.itemCategory?.toUpperCase()}
            </Text>
            <Text style={styles.sectionTitle}>
              {shipment.weightKg} kg · {money.format(shipment.fare)}
            </Text>
            <Text style={styles.cardText}>{shipment.handlingInstructions}</Text>
          </View>
          <View style={styles.shipmentTrackingBadge}>
            <Ionicons
              name={shipment.protection === "standard" ? "shield-checkmark" : "cube"}
              size={20}
              color="#fff"
            />
          </View>
        </View>
        <View style={styles.deliveryProofCard}>
          <View style={styles.deliveryProofIcon}>
            <Ionicons name="finger-print" size={21} color="#fff" />
          </View>
          <View style={styles.itemCopy}>
            <Text style={styles.sectionTitle}>Prueba de entrega</Text>
            <Text style={styles.cardText}>
              {photo ? "Foto recibida" : "Foto pendiente"}
              {shipment.signatureRequired
                ? ` · ${signature ? `Firmó ${signature.signerName || "receptor"}` : "firma pendiente"}`
                : ""}
            </Text>
          </View>
        </View>
        {shipmentReturn ? (
          <View style={styles.returnStatusCard}>
            <Ionicons name="return-down-back" size={18} color="#7c3cff" />
            <Text style={styles.cardText}>
              Devolución · {shipmentReturn.status.replaceAll("_", " ")}
            </Text>
          </View>
        ) : null}
        {!["delivered", "cancelled"].includes(shipment.status) &&
          (pin ? (
            <View style={styles.shipmentPinCard}>
              <Text style={styles.orderConfirmationEyebrow}>PIN DE ENTREGA</Text>
              <Text style={styles.shipmentPin}>{pin}</Text>
              <Text style={styles.helperText}>
                Compartilo únicamente cuando recibas el paquete.
              </Text>
            </View>
          ) : (
            <Pressable
              style={styles.orderConfirmationAction}
              disabled={pinBusy}
              onPress={async () => {
                setPinBusy(true);
                try {
                  await onRevealPin();
                } catch (error) {
                  Alert.alert(
                    "Flash",
                    error instanceof Error ? error.message : "No se pudo consultar el PIN",
                  );
                } finally {
                  setPinBusy(false);
                }
              }}
            >
              <Ionicons name="key-outline" size={18} color="#fff" />
              <Text style={styles.orderConfirmationActionText}>
                {pinBusy ? "Consultando…" : "Ver PIN de entrega"}
              </Text>
            </Pressable>
          ))}
      </ScrollView>
    </MobileTaskSheet>
  );
}

// CustomerTrackingSheets module boundary.
