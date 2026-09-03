// Runtime del turno del conductor (ARC-001).
//
// GPS, ofertas, evidencia, ruta y destinos. Uber Driver separa el cockpit
// shell de la lógica de turno; este hook es esa frontera en Flash.

import { useCallback, useEffect, useMemo, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { Alert, Linking, Platform } from "react-native";

import { api } from "../api";
import { getBackgroundLocationState, type BackgroundLocationState } from "../background-location";
import { explainAndRequestForegroundLocation } from "../locationPermission";
import { buildExternalNavigationUrl } from "../navigation-links";
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
import type { DriverNavigationTarget } from "./DriverDeliveryModals";

const GPS_LABEL = "Ubicacion GPS";

export function useDriverShift({
  state,
  driver,
  driverView,
}: {
  state: AppState;
  driver: Driver;
  driverView: "home" | "earnings" | "inbox" | "account";
}) {
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
  const [navigationOpen, setNavigationOpen] = useState(false);

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
    const poll = setInterval(() => void loadOffers(), 5000);
    const ticker = setInterval(() => setClock(Date.now()), 1000);
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
      const permission = await explainAndRequestForegroundLocation({ audience: "driver" });
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
              label: GPS_LABEL,
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

  return {
    inboxUnread,
    setInboxUnread,
    driverDemand,
    driverDemandLoading,
    driverDemandError,
    loadDriverDemand,
    chatJobId,
    setChatJobId,
    gpsStatus,
    backgroundGps,
    setBackgroundGps,
    driverPoint,
    driverRoute,
    driverRouteError,
    offersLoading,
    offerBusy,
    setOfferBusy,
    clock,
    deliveryPins,
    setDeliveryPins,
    ridePickupPins,
    setRidePickupPins,
    deliveryEvidenceReady,
    deliverySignatureReady,
    deliveryEvidenceUploading,
    signatureShipmentId,
    setSignatureShipmentId,
    vehicles,
    setVehicles,
    driverPreferences,
    setDriverPreferences,
    navigationOpen,
    setNavigationOpen,
    captureDeliveryEvidence,
    saveDeliverySignature,
    loadOffers,
    activeOrders,
    activeRides,
    activeShipments,
    visibleOffers,
    navigationTarget,
    activeVehicle,
    openExternalNavigation,
    activeChats,
    gpsLabel: GPS_LABEL,
  };
}
