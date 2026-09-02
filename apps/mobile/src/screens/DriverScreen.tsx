// Pantalla del conductor (ticket ARC-001).
//
// Cockpit operativo del turno. Guía/firma, cuenta, ganancias, inbox y tarjetas
// de trabajo viven en módulos propios.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { api } from "../api";
import {
  getBackgroundLocationState,
  startDriverBackgroundLocation,
  stopDriverBackgroundLocation,
  type BackgroundLocationState,
} from "../background-location";
import DriverDemandMap from "../DriverDemandMap";
import FlashNativeMap from "../FlashNativeMap";
import { money, navigationInstruction } from "../format";
import { buildExternalNavigationUrl } from "../navigation-links";
import { styles } from "../styles";
import { ActionButton, KpiRow, NativeMapUnavailable, OrderCard, ServiceChatModal } from "../ui";
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
import { DriverInboxPanel } from "./DriverInboxPanel";
import { RideCard, ShipmentCard } from "./DriverJobCards";

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
          <>
            <View style={styles.actionRow}>
              <ActionButton
                label={driver.online ? "Pausar" : "Activar"}
                disabled={busy}
                onPress={() =>
                  runAction(async () => {
                    if (driver.online) {
                      await api.updateDriver(driver.id, { online: false });
                      setBackgroundGps(await stopDriverBackgroundLocation());
                    } else {
                      await api.updateDriver(driver.id, { online: true });
                      const tracking = await startDriverBackgroundLocation();
                      setBackgroundGps(tracking);
                      if (tracking !== "active")
                        Alert.alert(
                          "Ubicación limitada",
                          tracking === "foreground_only"
                            ? "Seguirás online, pero esta instalación sólo enviará GPS mientras la app esté abierta. Para background usá un development build y habilitá el permiso Siempre."
                            : "Habilitá ubicación para recibir ofertas y compartir seguimiento.",
                        );
                    }
                  }, "Disponibilidad actualizada")
                }
              />
              <ActionButton
                label={driver.activeService === "delivery" ? "Modo taxi" : "Modo delivery"}
                disabled={busy}
                onPress={() =>
                  runAction(
                    () =>
                      api.updateDriver(driver.id, {
                        activeService: driver.activeService === "delivery" ? "ride" : "delivery",
                      }),
                    "Modo actualizado",
                  )
                }
              />
            </View>
            <View style={styles.driverSectionHeading}>
              <View>
                <Text style={styles.driverSectionEyebrow}>
                  {navigationTarget ? "SERVICIO EN CURSO" : "ACTIVIDAD OBSERVADA"}
                </Text>
                <Text style={styles.sectionTitle}>
                  {navigationTarget ? "Trabajo activo" : "Demanda por zonas"}
                </Text>
              </View>
              {!navigationTarget ? (
                <Pressable
                  onPress={() => void loadDriverDemand()}
                  disabled={driverDemandLoading}
                  accessibilityRole="button"
                  accessibilityLabel="Actualizar demanda por zonas"
                >
                  <Ionicons name="refresh-outline" size={21} color="#7c3cff" />
                </Pressable>
              ) : null}
            </View>
            {navigationTarget ? (
              driverPoint && navigationTarget.point ? (
                <FlashNativeMap
                  origin={driverPoint}
                  destination={navigationTarget.point}
                  route={driverRoute?.coordinates || []}
                  originRole="driver"
                  driverIcon={activeVehicle?.kind === "bicycle" ? "bicycle" : "car-sport"}
                  routeColor={
                    navigationTarget.kind === "Comida"
                      ? "#ff6a21"
                      : navigationTarget.kind === "Envío"
                        ? "#087a50"
                        : "#7c3cff"
                  }
                  caption={`${navigationTarget.kind} · ${navigationTarget.phase}`}
                  detail={
                    driverRoute
                      ? `${driverRoute.distanceKm} km · ${driverRoute.durationMin} min`
                      : driverRouteError || "Calculando recorrido vial…"
                  }
                  height={270}
                  accessibilityLabel="Mapa interactivo de navegación del conductor"
                />
              ) : (
                <NativeMapUnavailable
                  message={
                    driverPoint
                      ? "El servicio todavía no tiene un punto geográfico verificable."
                      : "Activá el GPS para calcular el recorrido al próximo punto."
                  }
                  height={270}
                />
              )
            ) : driverDemandLoading && !driverDemand ? (
              <View style={styles.driverDemandLoading}>
                <ActivityIndicator color="#7c3cff" />
                <Text style={styles.cardText}>
                  Consultando trabajos y oferta elegible en PostgreSQL…
                </Text>
              </View>
            ) : driverDemand?.zones.length ? (
              <>
                <DriverDemandMap
                  zones={driverDemand.zones}
                  driver={driverPoint}
                  caption={`${driverDemand.city.name} · ${driver.activeService === "delivery" ? "Delivery" : "Viajes"}`}
                  detail={`Observado ${new Date(driverDemand.observedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`}
                  accessibilityLabel="Mapa nativo de demanda agregada para conductores"
                />
                {driverDemandError ? (
                  <Pressable
                    style={styles.driverDemandError}
                    onPress={() => void loadDriverDemand()}
                  >
                    <Ionicons name="cloud-offline-outline" size={20} color="#a33939" />
                    <View style={styles.itemCopy}>
                      <Text style={styles.sectionTitle}>Snapshot sin actualizar</Text>
                      <Text style={styles.cardText}>
                        {driverDemandError} · Conservamos la hora visible del último dato.
                      </Text>
                    </View>
                  </Pressable>
                ) : null}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.driverDemandRail}
                >
                  {driverDemand.zones.map((zone) => {
                    const color =
                      zone.level === "high"
                        ? "#ce263b"
                        : zone.level === "medium"
                          ? "#e66d13"
                          : "#857b8b";
                    return (
                      <View
                        key={zone.id}
                        style={[
                          styles.driverDemandCard,
                          zone.containsDriver && styles.driverDemandCardCurrent,
                        ]}
                      >
                        <View style={styles.driverDemandCardTop}>
                          <View style={[styles.driverDemandLevelDot, { backgroundColor: color }]} />
                          <Text style={[styles.driverDemandLevel, { color }]}>
                            {zone.level === "high"
                              ? "ALTA"
                              : zone.level === "medium"
                                ? "MEDIA"
                                : "SIN PEDIDOS"}
                          </Text>
                          {zone.containsDriver ? (
                            <Text style={styles.driverDemandHere}>ACÁ</Text>
                          ) : null}
                        </View>
                        <Text style={styles.driverDemandName}>{zone.name}</Text>
                        <Text style={styles.driverDemandJobs}>
                          {zone.openJobs === 0
                            ? "Sin trabajos abiertos"
                            : `${zone.openJobs} ${zone.openJobs === 1 ? "trabajo" : "trabajos"} sin asignar`}
                        </Text>
                        <Text style={styles.driverDemandSupply}>
                          {zone.eligibleDrivers}{" "}
                          {zone.eligibleDrivers === 1
                            ? "conductor elegible"
                            : "conductores elegibles"}
                        </Text>
                      </View>
                    );
                  })}
                </ScrollView>
                <View style={styles.driverTransparencyCard}>
                  <Ionicons name="information-circle-outline" size={22} color="#087a50" />
                  <View style={styles.itemCopy}>
                    <Text style={styles.sectionTitle}>Actividad, no promesa</Text>
                    <Text style={styles.cardText}>
                      Es un conteo zonal actual: no garantiza una oferta o ganancia y no modifica la
                      tarifa. Nunca muestra la ubicación de otras personas.
                    </Text>
                  </View>
                </View>
              </>
            ) : (
              <Pressable style={styles.driverDemandError} onPress={() => void loadDriverDemand()}>
                <Ionicons
                  name={driverDemandError ? "cloud-offline-outline" : "map-outline"}
                  size={22}
                  color="#a33939"
                />
                <View style={styles.itemCopy}>
                  <Text style={styles.sectionTitle}>
                    {driverDemandError ? "No pudimos leer las zonas" : "No hay zonas operativas"}
                  </Text>
                  <Text style={styles.cardText}>
                    {driverDemandError ||
                      "Operaciones todavía no publicó polígonos activos para esta ciudad."}{" "}
                    · Tocá para reintentar.
                  </Text>
                </View>
              </Pressable>
            )}
            {driverRoute?.steps[0] && (
              <View style={styles.driverNavigation}>
                <View style={styles.navigationTurn}>
                  <Ionicons
                    name={
                      driverRoute.steps[0].modifier.includes("left")
                        ? "arrow-back"
                        : driverRoute.steps[0].modifier.includes("right")
                          ? "arrow-forward"
                          : "arrow-up"
                    }
                    size={26}
                    color="#fff"
                  />
                </View>
                <View style={styles.itemCopy}>
                  <Text style={styles.navigationLabel}>
                    {navigationTarget?.kind.toUpperCase()} · {navigationTarget?.phase.toUpperCase()}
                  </Text>
                  <Text style={styles.navigationInstruction}>
                    {navigationInstruction(driverRoute.steps[0])}
                  </Text>
                  <Text style={styles.helperText}>
                    {driverRoute.distanceKm} km · {driverRoute.durationMin} min restantes
                  </Text>
                  <Text style={styles.helperText} numberOfLines={1}>
                    {navigationTarget?.address}
                  </Text>
                </View>
                <Pressable
                  style={styles.proofCameraButton}
                  onPress={() => setNavigationOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Abrir guía operativa del conductor"
                >
                  <Ionicons name="navigate" size={19} color="#fff" />
                  <Text style={styles.primaryButtonText}>Ver guía</Text>
                </Pressable>
              </View>
            )}
            {driverRouteError ? (
              <Text style={styles.complianceRejection}>{driverRouteError}</Text>
            ) : null}
            <View style={styles.cardDark}>
              <Text style={styles.heroLabel}>{driver.online ? "Online" : "Offline"}</Text>
              <Text style={styles.heroTitle}>{driver.name}</Text>
              <Text style={styles.heroCopy}>
                {driver.vehicle} - {driver.plate} - rating {driver.rating}
              </Text>
              <Text style={styles.gpsText}>
                {gpsStatus === "live"
                  ? "GPS activo"
                  : gpsStatus === "requesting"
                    ? "Solicitando GPS"
                    : gpsStatus === "denied"
                      ? "GPS no disponible"
                      : "GPS pausado"}
              </Text>
              <Text style={styles.gpsText}>
                {backgroundGps === "active"
                  ? "Segundo plano activo"
                  : backgroundGps === "foreground_only"
                    ? "Sólo mientras la app está abierta"
                    : backgroundGps === "denied"
                      ? "Permiso background rechazado"
                      : "Segundo plano detenido"}{" "}
                · sesión {api.sessionStorage === "native-keychain-keystore" ? "protegida" : "web"}
              </Text>
            </View>
            <KpiRow
              items={[
                ["Ganancias", driver.earningsToday],
                ["Activos", activeOrders.length + activeRides.length + activeShipments.length],
                ["Ofertas", visibleOffers.length],
                ["Modo", driver.activeService === "delivery" ? "Delivery" : "Taxi"],
              ]}
            />
            {activeOrders.map((order) => (
              <View key={order.id} style={styles.stack}>
                <OrderCard
                  order={order}
                  disabled={busy}
                  onPress={() => runAction(() => api.advanceOrder(order.id), "Delivery avanzado")}
                />
                <Pressable style={styles.shareAction} onPress={() => setChatJobId(order.id)}>
                  <Ionicons name="chatbubbles-outline" size={18} color="#7c3cff" />
                  <Text style={styles.shareActionText}>Chat del servicio</Text>
                </Pressable>
              </View>
            ))}
            {activeRides.map((ride) => (
              <View key={ride.id} style={styles.stack}>
                <RideCard
                  ride={ride}
                  disabled={busy || ride.status === "arriving"}
                  onPress={() => runAction(() => api.advanceRide(ride.id), "Viaje avanzado")}
                />
                <Pressable style={styles.shareAction} onPress={() => setChatJobId(ride.id)}>
                  <Ionicons name="chatbubbles-outline" size={18} color="#7c3cff" />
                  <Text style={styles.shareActionText}>Chat con pasajero</Text>
                </Pressable>
                {ride.status === "arriving" ? (
                  <View style={styles.deliveryProofCard}>
                    <View style={[styles.deliveryProofIcon, { backgroundColor: "#7c3cff" }]}>
                      <Ionicons name="keypad-outline" size={22} color="#fff" />
                    </View>
                    <View style={styles.itemCopy}>
                      <Text style={styles.sectionTitle}>Verificá al pasajero</Text>
                      <Text style={styles.cardText}>
                        Pedile el PIN de 4 dígitos antes de iniciar.
                      </Text>
                      <TextInput
                        value={ridePickupPins[ride.id] || ""}
                        onChangeText={(value) =>
                          setRidePickupPins((current) => ({
                            ...current,
                            [ride.id]: value.replace(/\D/g, "").slice(0, 4),
                          }))
                        }
                        keyboardType="numeric"
                        secureTextEntry
                        maxLength={4}
                        placeholder="••••"
                        style={styles.input}
                      />
                    </View>
                    <Pressable
                      disabled={busy || (ridePickupPins[ride.id] || "").length !== 4}
                      style={[
                        styles.proofCameraButton,
                        (busy || (ridePickupPins[ride.id] || "").length !== 4) &&
                          styles.disabledButton,
                      ]}
                      onPress={() =>
                        runAction(async () => {
                          await api.verifyRidePickup(ride.id, ridePickupPins[ride.id]);
                          await api.advanceRide(ride.id);
                          setRidePickupPins((current) => ({ ...current, [ride.id]: "" }));
                        }, "Pasajero verificado; viaje iniciado")
                      }
                    >
                      <Ionicons name="shield-checkmark-outline" size={18} color="#fff" />
                      <Text style={styles.primaryButtonText}>Verificar e iniciar</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ))}
            {activeShipments.map((shipment) => (
              <View key={shipment.id} style={styles.stack}>
                <ShipmentCard
                  shipment={shipment}
                  disabled={busy}
                  pin={deliveryPins[shipment.id] || ""}
                  onPinChange={(pin) =>
                    setDeliveryPins((current) => ({
                      ...current,
                      [shipment.id]: pin.replace(/\D/g, "").slice(0, 4),
                    }))
                  }
                  onPress={() =>
                    runAction(
                      () =>
                        shipment.status === "delivering"
                          ? api.verifyShipmentDelivery(shipment.id, deliveryPins[shipment.id] || "")
                          : api.advanceShipment(shipment.id),
                      shipment.status === "delivering" ? "Entrega verificada" : "Envio avanzado",
                    )
                  }
                />
                <Pressable style={styles.shareAction} onPress={() => setChatJobId(shipment.id)}>
                  <Ionicons name="chatbubbles-outline" size={18} color="#7c3cff" />
                  <Text style={styles.shareActionText}>Chat con cliente</Text>
                </Pressable>
                {shipment.status === "delivering" && (
                  <>
                    <View style={styles.deliveryProofCard}>
                      <View style={styles.deliveryProofIcon}>
                        <Ionicons
                          name={deliveryEvidenceReady[shipment.id] ? "shield-checkmark" : "camera"}
                          size={22}
                          color="#fff"
                        />
                      </View>
                      <View style={styles.itemCopy}>
                        <Text style={styles.sectionTitle}>
                          {deliveryEvidenceReady[shipment.id]
                            ? "Foto protegida"
                            : "Prueba de entrega"}
                        </Text>
                        <Text style={styles.cardText}>
                          {deliveryEvidenceReady[shipment.id]
                            ? "Foto cifrada lista."
                            : "Tomá una foto en destino antes de pedir el PIN."}
                        </Text>
                      </View>
                      <Pressable
                        disabled={deliveryEvidenceUploading === shipment.id || busy}
                        style={[
                          styles.proofCameraButton,
                          (deliveryEvidenceUploading === shipment.id || busy) &&
                            styles.disabledButton,
                        ]}
                        onPress={() => void captureDeliveryEvidence(shipment.id)}
                      >
                        <Ionicons name="camera-outline" size={18} color="#fff" />
                        <Text style={styles.primaryButtonText}>
                          {deliveryEvidenceUploading === shipment.id
                            ? "Guardando…"
                            : deliveryEvidenceReady[shipment.id]
                              ? "Repetir"
                              : "Tomar foto"}
                        </Text>
                      </Pressable>
                    </View>
                    {shipment.signatureRequired && (
                      <View style={styles.deliveryProofCard}>
                        <View style={[styles.deliveryProofIcon, { backgroundColor: "#17131c" }]}>
                          <Ionicons
                            name={deliverySignatureReady[shipment.id] ? "checkmark" : "pencil"}
                            size={22}
                            color="#fff"
                          />
                        </View>
                        <View style={styles.itemCopy}>
                          <Text style={styles.sectionTitle}>
                            {deliverySignatureReady[shipment.id]
                              ? "Firma protegida"
                              : "Firma requerida"}
                          </Text>
                          <Text style={styles.cardText}>
                            {deliverySignatureReady[shipment.id]
                              ? "Identidad y consentimiento cifrados."
                              : "Pedile al receptor que firme en pantalla."}
                          </Text>
                        </View>
                        <Pressable
                          disabled={deliveryEvidenceUploading === shipment.id || busy}
                          style={[
                            styles.proofCameraButton,
                            (deliveryEvidenceUploading === shipment.id || busy) &&
                              styles.disabledButton,
                          ]}
                          onPress={() => setSignatureShipmentId(shipment.id)}
                        >
                          <Ionicons name="create-outline" size={18} color="#fff" />
                          <Text style={styles.primaryButtonText}>
                            {deliverySignatureReady[shipment.id] ? "Repetir" : "Firmar"}
                          </Text>
                        </Pressable>
                      </View>
                    )}
                  </>
                )}
              </View>
            ))}
            {activeOrders.length === 0 &&
              activeRides.length === 0 &&
              activeShipments.length === 0 && (
                <Text style={styles.muted}>No tienes trabajos activos.</Text>
              )}
            <Text style={styles.sectionTitle}>Ofertas</Text>
            {offersLoading && visibleOffers.length === 0 && <ActivityIndicator color="#7c3cff" />}
            {visibleOffers.map((offer) => {
              const seconds = Math.max(
                0,
                Math.ceil((new Date(offer.expiresAt).getTime() - clock) / 1000),
              );
              const accepting = offerBusy === offer.id;
              return (
                <View key={offer.id} style={styles.dispatchOffer}>
                  <View style={styles.dispatchOfferHeader}>
                    <View style={styles.dispatchOfferIcon}>
                      <Ionicons
                        name={offer.kind === "ride" ? "car-sport" : "cube"}
                        size={22}
                        color="#fff"
                      />
                    </View>
                    <View style={styles.itemCopy}>
                      <Text style={styles.dispatchOfferType}>
                        {offer.kind === "ride"
                          ? "NUEVO VIAJE"
                          : offer.subtype === "shipment"
                            ? "NUEVO ENVÍO"
                            : "NUEVO DELIVERY"}
                      </Text>
                      <Text style={styles.dispatchOfferTimer}>{seconds}s</Text>
                    </View>
                    <Text style={styles.dispatchOfferFare}>{money.format(offer.fare)}</Text>
                  </View>
                  <View style={styles.dispatchRoute}>
                    <View style={styles.routeDot} />
                    <Text style={styles.dispatchAddress} numberOfLines={1}>
                      {offer.pickup}
                    </Text>
                  </View>
                  <View style={styles.dispatchRoute}>
                    <View style={[styles.routeDot, styles.routeDotDestination]} />
                    <Text style={styles.dispatchAddress} numberOfLines={1}>
                      {offer.destination}
                    </Text>
                  </View>
                  <Text style={styles.helperText}>
                    {offer.distanceKm} km · {offer.durationMin} min · puntaje{" "}
                    {Math.round(offer.score)}
                  </Text>
                  {offer.scoreBreakdown && (
                    <Text style={styles.helperText}>
                      Historial: {Math.round(offer.scoreBreakdown.acceptanceRate * 100)}% aceptación
                      · {Math.round(offer.scoreBreakdown.averageResponseSeconds)}s respuesta
                    </Text>
                  )}
                  <View style={styles.offerActions}>
                    <Pressable
                      disabled={busy || accepting || seconds === 0}
                      style={styles.rejectOfferButton}
                      onPress={async () => {
                        setOfferBusy(offer.id);
                        await runAction(() => api.rejectDriverOffer(offer.id), "Oferta rechazada");
                        await loadOffers();
                        setOfferBusy(null);
                      }}
                    >
                      <Text style={styles.rejectOfferText}>Rechazar</Text>
                    </Pressable>
                    <Pressable
                      disabled={busy || accepting || seconds === 0}
                      style={styles.acceptOfferButton}
                      onPress={async () => {
                        setOfferBusy(offer.id);
                        const action =
                          offer.kind === "ride"
                            ? () => api.acceptRide(offer.jobId, driver.id)
                            : offer.subtype === "shipment"
                              ? () => api.acceptShipment(offer.jobId, driver.id)
                              : () => api.acceptDelivery(offer.jobId, driver.id);
                        await runAction(action, "Servicio aceptado");
                        await loadOffers();
                        setOfferBusy(null);
                      }}
                    >
                      {accepting ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.acceptOfferText}>Aceptar</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              );
            })}
            {!offersLoading && visibleOffers.length === 0 && (
              <Text style={styles.muted}>
                {driver.online
                  ? "No hay ofertas vigentes para el modo seleccionado."
                  : "Actívate para recibir ofertas."}
              </Text>
            )}
          </>
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
