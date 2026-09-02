// Pantalla del conductor (ticket ARC-001).
//
// Shell del turno: GPS, evidencia, ofertas y composición de pestañas. Home,
// inbox, cuenta, ganancias, guía y firma viven en módulos propios.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";

import { api } from "../api";
import {
  getBackgroundLocationState,
  startDriverBackgroundLocation,
  stopDriverBackgroundLocation,
  type BackgroundLocationState,
} from "../background-location";
import { buildExternalNavigationUrl } from "../navigation-links";
import { styles } from "../styles";
import { ServiceChatModal } from "../ui";
import type {
  AppState,
  DispatchOffer,
  Driver,
  DriverDemand,
  DriverPreferences,
  DriverVehicle,
  GeoPoint,
  RoadRoute,
} from "../types";
import { DriverAccountPanel } from "./DriverAccountPanel";
import {
  DriverNavigationModal,
  SignatureCaptureModal,
  type DriverNavigationTarget,
} from "./DriverDeliveryModals";
import { DriverEarningsPanel } from "./DriverEarningsPanel";
import { DriverHomePanel } from "./DriverHomePanel";
import { DriverInboxPanel } from "./DriverInboxPanel";

export function DriverScreen({
  state,
  driver,
  busy,
  runAction,
  onLogout,
  onRefresh,
}: {
  state: AppState;
  driver: Driver;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
  onLogout: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [driverView, setDriverView] = useState<"home" | "earnings" | "inbox" | "account">("home");
  const driverScrollRef = useRef<ScrollView>(null);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [inboxUnread, setInboxUnread] = useState(0);
  const [driverDemand, setDriverDemand] = useState<DriverDemand | null>(null);
  const [driverDemandLoading, setDriverDemandLoading] = useState(false);
  const [driverDemandError, setDriverDemandError] = useState("");
  const [chatJobId, setChatJobId] = useState<string | null>(null);
  const [gpsStatus, setGpsStatus] = useState<"paused" | "requesting" | "live" | "denied">("paused");
  const [backgroundGps, setBackgroundGps] = useState<BackgroundLocationState>("stopped");
  const [driverPoint, setDriverPoint] = useState<GeoPoint | null>(driver.location || null);
  const [driverRoute, setDriverRoute] = useState<RoadRoute | null>(null);
  const [driverRouteError, setDriverRouteError] = useState("");
  const [offers, setOffers] = useState<DispatchOffer[]>([]);
  const [offersLoading, setOffersLoading] = useState(false);
  const [offerBusy, setOfferBusy] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [deliveryPins, setDeliveryPins] = useState<Record<string, string>>({});
  const [ridePickupPins, setRidePickupPins] = useState<Record<string, string>>({});
  const [deliveryEvidenceReady, setDeliveryEvidenceReady] = useState<Record<string, boolean>>({});
  const [deliverySignatureReady, setDeliverySignatureReady] = useState<Record<string, boolean>>({});
  const [deliveryEvidenceUploading, setDeliveryEvidenceUploading] = useState<string | null>(null);
  const [signatureShipmentId, setSignatureShipmentId] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<DriverVehicle[]>([]);
  const [driverPreferences, setDriverPreferences] = useState<DriverPreferences>({
    driverId: driver.id,
    navigationProvider: "system",
    updatedAt: null,
  });

  useEffect(() => {
    driverScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [driverView]);

  const loadDriverDemand = useCallback(async () => {
    setDriverDemandLoading(true);
    setDriverDemandError("");
    try {
      setDriverDemand((await api.getDriverDemand()).demand);
    } catch (error) {
      setDriverDemandError(
        error instanceof Error ? error.message : "No se pudo cargar la actividad por zonas",
      );
    } finally {
      setDriverDemandLoading(false);
    }
  }, [driver.id, driver.activeService]);
  useEffect(() => {
    if (driverView !== "home") return;
    void loadDriverDemand();
    const poll = setInterval(() => void loadDriverDemand(), 60000);
    return () => clearInterval(poll);
  }, [driverView, loadDriverDemand]);

  const loadVehicles = useCallback(async () => {
    try {
      setVehicles((await api.getDriverVehicles(driver.id)).vehicles);
    } catch (_error) {
      setVehicles([]);
    }
  }, [driver.id]);
  const loadDriverPreferences = useCallback(async () => {
    try {
      setDriverPreferences((await api.getDriverPreferences()).preferences);
    } catch (_error) {
      setDriverPreferences({ driverId: driver.id, navigationProvider: "system", updatedAt: null });
    }
  }, [driver.id]);
  useEffect(() => {
    void loadVehicles();
    void loadDriverPreferences();
  }, [loadVehicles, loadDriverPreferences]);
  useEffect(() => {
    void getBackgroundLocationState().then(setBackgroundGps);
  }, [driver.online]);
  const captureDeliveryEvidence = async (shipmentId: string) => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permiso necesario", "Habilitá la cámara para registrar la entrega.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 0.55,
      base64: true,
      exif: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset.base64) {
      Alert.alert("Flash", "La cámara no devolvió una imagen válida.");
      return;
    }
    setDeliveryEvidenceUploading(shipmentId);
    try {
      let location = driverPoint || undefined;
      if (!location) {
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }).catch(() => null);
        if (current) location = { lat: current.coords.latitude, lng: current.coords.longitude };
      }
      await api.addShipmentDeliveryEvidence(shipmentId, {
        type: "photo",
        mimeType: (asset.mimeType || "image/jpeg") as "image/jpeg" | "image/png" | "image/webp",
        contentBase64: asset.base64,
        capturedAt: new Date().toISOString(),
        location,
      });
      setDeliveryEvidenceReady((current) => ({ ...current, [shipmentId]: true }));
      Alert.alert(
        "Evidencia protegida",
        "La foto quedó cifrada y vinculada al envío. Ahora pedí el PIN.",
      );
    } catch (error) {
      Alert.alert(
        "Flash",
        error instanceof Error ? error.message : "No se pudo guardar la evidencia",
      );
    } finally {
      setDeliveryEvidenceUploading(null);
    }
  };
  const saveDeliverySignature = async (input: {
    contentBase64: string;
    signerName: string;
    signerRelationship: "recipient" | "authorized_person";
  }) => {
    if (!signatureShipmentId) return;
    const shipmentId = signatureShipmentId;
    setDeliveryEvidenceUploading(shipmentId);
    try {
      let location = driverPoint || undefined;
      if (!location) {
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }).catch(() => null);
        if (current) location = { lat: current.coords.latitude, lng: current.coords.longitude };
      }
      await api.addShipmentDeliveryEvidence(shipmentId, {
        type: "signature",
        mimeType: "image/png",
        contentBase64: input.contentBase64,
        capturedAt: new Date().toISOString(),
        location,
        signerName: input.signerName,
        signerRelationship: input.signerRelationship,
        consentVersion: "shipment-receipt-v1",
      });
      setDeliverySignatureReady((current) => ({ ...current, [shipmentId]: true }));
      setSignatureShipmentId(null);
      Alert.alert("Firma protegida", "La recepción quedó cifrada y vinculada al envío.");
    } catch (error) {
      Alert.alert("Flash", error instanceof Error ? error.message : "No se pudo guardar la firma");
    } finally {
      setDeliveryEvidenceUploading(null);
    }
  };

  const loadOffers = useCallback(async () => {
    if (!driver.online) {
      setOffers([]);
      return;
    }
    setOffersLoading(true);
    try {
      setOffers((await api.getDriverOffers()).offers);
    } catch (_error) {
      setOffers([]);
    } finally {
      setOffersLoading(false);
    }
  }, [driver.online]);
  useEffect(() => {
    void loadOffers();
    const poll = setInterval(() => void loadOffers(), 5000),
      ticker = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(ticker);
    };
  }, [loadOffers]);

  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;
    let disposed = false;

    const startLocationTracking = async () => {
      if (!driver.online) {
        setGpsStatus("paused");
        return;
      }
      setGpsStatus("requesting");
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setGpsStatus("denied");
        return;
      }
      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 15000,
          distanceInterval: 50,
        },
        ({ coords }) => {
          if (disposed) return;
          const nextPoint = { lat: coords.latitude, lng: coords.longitude };
          setDriverPoint(nextPoint);
          void api
            .updateDriverLocation(driver.id, {
              ...nextPoint,
              label: "Ubicacion GPS",
              source: "foreground",
              accuracyM: coords.accuracy ?? undefined,
            })
            .then(() => setGpsStatus("live"))
            .catch(() => setGpsStatus("denied"));
        },
      );
    };

    void startLocationTracking().catch(() => setGpsStatus("denied"));
    return () => {
      disposed = true;
      subscription?.remove();
    };
  }, [driver.id, driver.online]);

  const activeOrders = state.orders.filter(
    (order) => order.courierId === driver.id && !["delivered", "cancelled"].includes(order.status),
  );
  const activeRides = state.rides.filter(
    (ride) => ride.driverId === driver.id && !["completed", "cancelled"].includes(ride.status),
  );
  const activeShipments = state.shipments.filter(
    (shipment) =>
      shipment.driverId === driver.id && !["delivered", "cancelled"].includes(shipment.status),
  );
  const visibleOffers = offers.filter((offer) =>
    driver.activeService === "ride" ? offer.kind === "ride" : offer.kind === "delivery",
  );
  const navigationTarget = useMemo<DriverNavigationTarget | null>(() => {
    const ride = activeRides[0];
    if (ride) {
      const toPickup = ride.status !== "in_progress";
      return {
        id: ride.id,
        kind: "Viaje",
        phase: toPickup ? "Buscar pasajero" : "Llevar pasajero",
        point: toPickup ? ride.pickupLocation : ride.destinationLocation,
        address: toPickup ? ride.pickup : ride.destination,
      };
    }
    const order = activeOrders[0];
    if (order) {
      const toPickup = !["picked_up", "delivering"].includes(order.status);
      return {
        id: order.id,
        kind: "Comida",
        phase: toPickup ? "Ir al comercio" : "Entregar pedido",
        point: toPickup ? order.pickupLocation : order.deliveryLocation,
        address: toPickup ? "Punto de retiro" : order.deliveryAddress,
      };
    }
    const shipment = activeShipments[0];
    if (shipment) {
      const toPickup = !["picked_up", "delivering"].includes(shipment.status);
      return {
        id: shipment.id,
        kind: "Envío",
        phase: toPickup ? "Retirar paquete" : "Entregar paquete",
        point: toPickup ? shipment.pickupLocation : shipment.destinationLocation,
        address: toPickup ? shipment.pickup : shipment.destination,
      };
    }
    return null;
  }, [activeRides, activeOrders, activeShipments]);
  const activeVehicle =
    vehicles.find((vehicle) => vehicle.active && vehicle.status === "approved") || null;
  const navigationTravelMode = activeVehicle?.kind === "bicycle" ? "bicycling" : "driving";
  const openExternalNavigation = async () => {
    const point = navigationTarget?.point;
    if (!point) return;
    const url = buildExternalNavigationUrl(
      Platform.OS,
      point,
      navigationTravelMode,
      driverPreferences.navigationProvider,
    );
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch (_error) {
      Alert.alert(
        "Navegación no disponible",
        "No pudimos abrir la aplicación de mapas de este dispositivo.",
      );
    }
  };
  useEffect(() => {
    if (!navigationTarget) setNavigationOpen(false);
  }, [navigationTarget?.id]);

  const activeChats = [
    ...activeOrders.map((order) => ({
      id: order.id,
      label: "Pedido de comida",
      detail: order.deliveryAddress,
      icon: "restaurant" as const,
    })),
    ...activeRides.map((ride) => ({
      id: ride.id,
      label: "Viaje con pasajero",
      detail: ride.destination,
      icon: "car-sport" as const,
    })),
    ...activeShipments.map((shipment) => ({
      id: shipment.id,
      label: "Envío activo",
      detail: shipment.destination,
      icon: "cube" as const,
    })),
  ];

  useEffect(() => {
    if (!driverPoint || !navigationTarget?.point) {
      setDriverRoute(null);
      setDriverRouteError("");
      return;
    }
    let cancelled = false;
    setDriverRoute(null);
    setDriverRouteError("");
    void api
      .route(driverPoint, navigationTarget.point)
      .then((response) => {
        if (!cancelled) setDriverRoute(response.route);
      })
      .catch(() => {
        if (!cancelled)
          setDriverRouteError(
            "No pudimos actualizar la ruta. Conservá el destino y reintentá con conexión.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [driverPoint?.lat, driverPoint?.lng, navigationTarget?.id, navigationTarget?.phase]);

  return (
    <View style={styles.driverShell}>
      <SignatureCaptureModal
        visible={Boolean(signatureShipmentId)}
        onClose={() => {
          if (!deliveryEvidenceUploading) setSignatureShipmentId(null);
        }}
        onSave={saveDeliverySignature}
        busy={Boolean(deliveryEvidenceUploading)}
      />
      <ServiceChatModal
        jobId={chatJobId}
        currentUserId={driver.userId}
        onClose={() => setChatJobId(null)}
      />
      <DriverNavigationModal
        visible={navigationOpen}
        target={navigationTarget}
        origin={driverPoint}
        route={driverRoute}
        routeError={driverRouteError}
        vehicleIcon={activeVehicle?.kind === "bicycle" ? "bicycle" : "car-sport"}
        onExternal={() => void openExternalNavigation()}
        onChat={() => {
          setNavigationOpen(false);
          if (navigationTarget) setChatJobId(navigationTarget.id);
        }}
        onClose={() => setNavigationOpen(false)}
      />
      <ScrollView
        ref={driverScrollRef}
        contentContainerStyle={styles.driverContent}
        refreshControl={
          <RefreshControl
            refreshing={busy}
            onRefresh={async () => {
              await Promise.all([onRefresh(), loadDriverDemand(), loadOffers()]);
            }}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.driverAppHeader}>
          <View>
            <Text style={styles.driverBrand}>FLASH DRIVER</Text>
            <Text style={styles.driverGreeting}>
              {driverView === "home"
                ? "Tu jornada"
                : driverView === "earnings"
                  ? "Ganancias"
                  : driverView === "inbox"
                    ? "Inbox"
                    : "Cuenta"}
            </Text>
          </View>
          <Pressable
            style={styles.driverHeaderAction}
            onPress={() => void onLogout()}
            accessibilityRole="button"
            accessibilityLabel="Cerrar sesión"
          >
            <Ionicons name="log-out-outline" size={22} color="#17131c" />
          </Pressable>
        </View>
        {driverView === "account" && (
          <DriverAccountPanel
            driverId={driver.id}
            vehicles={vehicles}
            onVehiclesChange={setVehicles}
            preferences={driverPreferences}
            onPreferencesChange={setDriverPreferences}
          />
        )}
        {driverView === "earnings" && (
          <DriverEarningsPanel
            driverId={driver.id}
            fallbackEarningsToday={driver.earningsToday}
            rating={driver.rating}
          />
        )}
        {driverView === "inbox" && (
          <DriverInboxPanel
            activeChats={activeChats}
            onOpenChat={setChatJobId}
            onUnreadChange={setInboxUnread}
          />
        )}
        {driverView === "home" && (
          <DriverHomePanel
            driver={driver}
            busy={busy}
            runAction={runAction}
            backgroundGps={backgroundGps}
            setBackgroundGps={setBackgroundGps}
            gpsStatus={gpsStatus}
            navigationTarget={navigationTarget}
            driverPoint={driverPoint}
            driverRoute={driverRoute}
            driverRouteError={driverRouteError}
            activeVehicle={activeVehicle}
            driverDemand={driverDemand}
            driverDemandLoading={driverDemandLoading}
            driverDemandError={driverDemandError}
            loadDriverDemand={loadDriverDemand}
            activeOrders={activeOrders}
            activeRides={activeRides}
            activeShipments={activeShipments}
            deliveryPins={deliveryPins}
            setDeliveryPins={setDeliveryPins}
            ridePickupPins={ridePickupPins}
            setRidePickupPins={setRidePickupPins}
            deliveryEvidenceReady={deliveryEvidenceReady}
            deliverySignatureReady={deliverySignatureReady}
            deliveryEvidenceUploading={deliveryEvidenceUploading}
            setSignatureShipmentId={setSignatureShipmentId}
            captureDeliveryEvidence={captureDeliveryEvidence}
            visibleOffers={visibleOffers}
            offersLoading={offersLoading}
            offerBusy={offerBusy}
            setOfferBusy={setOfferBusy}
            loadOffers={loadOffers}
            clock={clock}
            setNavigationOpen={setNavigationOpen}
            setChatJobId={setChatJobId}
            openExternalNavigation={openExternalNavigation}
          />
        )}
      </ScrollView>
      <View style={styles.driverBottomNav}>
        {(
          [
            ["home", "map-outline", "Mapa"],
            ["earnings", "wallet-outline", "Ganancias"],
            ["inbox", "chatbox-ellipses-outline", "Inbox"],
            ["account", "person-circle-outline", "Cuenta"],
          ] as const
        ).map(([value, icon, label]) => (
          <Pressable
            key={value}
            style={styles.driverBottomItem}
            onPress={() => setDriverView(value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: driverView === value }}
          >
            <View style={styles.driverBottomIconWrap}>
              <Ionicons
                name={icon}
                size={22}
                color={driverView === value ? "#7c3cff" : "#8a828f"}
              />
              {value === "inbox" && inboxUnread > 0 ? (
                <View style={styles.driverBottomDot} />
              ) : null}
            </View>
            <Text
              style={[
                styles.driverBottomLabel,
                driverView === value && styles.driverBottomLabelActive,
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
