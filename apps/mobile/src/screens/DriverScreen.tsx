// Pantalla del conductor (ticket ARC-001, paso 12).
//
// El cockpit operativo más los cuatro componentes que **sólo él usa**: la guía
// giro a giro, la captura de firma, y las tarjetas de viaje y envío. Se verificó
// contando usos por zona antes de mover nada; las que comparten audiencias
// quedaron en `../ui.tsx` en el paso 11.
//
// La guía de navegación vive acá y no en un módulo de mapas a propósito: consume
// el estado del turno del conductor, no sólo una ruta.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { captureRef } from "react-native-view-shot";
import Svg, { Path } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
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
import { compactMoney, money, navigationInstruction, operationalDuration } from "../format";
import { buildExternalNavigationUrl } from "../navigation-links";
import { styles } from "../styles";
import { ActionButton, KpiRow, NativeMapUnavailable, OrderCard, ServiceChatModal } from "../ui";
import type {
  AppNotification,
  AppState,
  DispatchOffer,
  Driver,
  DriverCompliance,
  DriverDemand,
  DriverDocument,
  DriverEarnings,
  DriverPreferences,
  DriverVehicle,
  GeoPoint,
  Ride,
  RoadRoute,
} from "../types";

/** El destino que el conductor tiene enfrente: sólo esta pantalla lo construye. */
type DriverNavigationTarget = {
  id: string;
  kind: "Viaje" | "Comida" | "Envío";
  phase: string;
  point: GeoPoint | null | undefined;
  address: string;
};

function DriverNavigationModal({
  visible,
  target,
  origin,
  route,
  routeError,
  vehicleIcon,
  onExternal,
  onChat,
  onClose,
}: {
  visible: boolean;
  target: DriverNavigationTarget | null;
  origin: GeoPoint | null;
  route: RoadRoute | null;
  routeError: string;
  vehicleIcon: "bicycle" | "car-sport";
  onExternal: () => void;
  onChat: () => void;
  onClose: () => void;
}) {
  const { height } = useWindowDimensions(),
    mapHeight = Math.max(250, Math.min(420, height * 0.48)),
    step = route?.steps[0] || null,
    routeColor =
      target?.kind === "Comida" ? "#ff6a21" : target?.kind === "Envío" ? "#087a50" : "#7c3cff",
    turnIcon = step?.modifier.includes("left")
      ? "arrow-back"
      : step?.modifier.includes("right")
        ? "arrow-forward"
        : "arrow-up";
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.driverNavScreen}>
        <View style={styles.driverNavTop}>
          <Pressable
            style={styles.driverNavClose}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cerrar guía"
          >
            <Ionicons name="chevron-down" size={24} color="#fff" />
          </Pressable>
          <View style={styles.driverNavTurn}>
            <Ionicons name={turnIcon} size={30} color="#15121a" />
          </View>
          <View style={styles.itemCopy}>
            <Text style={styles.driverNavPhase}>
              {target?.kind.toUpperCase()} · {target?.phase.toUpperCase()}
            </Text>
            <Text style={styles.driverNavInstruction}>
              {step
                ? navigationInstruction(step)
                : routeError || "Calculando la mejor ruta disponible…"}
            </Text>
            {step ? (
              <Text style={styles.driverNavDistance}>
                en {Math.max(10, Math.round(step.distanceM))} m
              </Text>
            ) : null}
          </View>
        </View>
        {origin && target?.point ? (
          <FlashNativeMap
            origin={origin}
            destination={target.point}
            route={route?.coordinates || []}
            originRole="driver"
            driverIcon={vehicleIcon}
            routeColor={routeColor}
            caption={target.phase}
            detail={
              route
                ? `${route.distanceKm} km · ${route.durationMin} min restantes`
                : routeError || "Actualizando recorrido vial…"
            }
            height={mapHeight}
            accessibilityLabel="Mapa de la guía operativa del conductor"
          />
        ) : (
          <NativeMapUnavailable
            height={mapHeight}
            message={
              origin
                ? "El próximo punto todavía no tiene coordenadas verificadas."
                : "Activá el GPS para iniciar la guía."
            }
          />
        )}
        <ScrollView
          style={styles.driverNavSheet}
          contentContainerStyle={styles.driverNavSheetContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.driverNavEtaRow}>
            <View>
              <Text style={styles.driverNavEta}>{route ? `${route.durationMin} min` : "--"}</Text>
              <Text style={styles.helperText}>
                {route ? `${route.distanceKm} km restantes` : "Esperando ruta"}
              </Text>
            </View>
            <View style={[styles.driverNavKind, { backgroundColor: routeColor }]}>
              <Ionicons
                name={
                  target?.kind === "Comida"
                    ? "restaurant"
                    : target?.kind === "Envío"
                      ? "cube"
                      : "car-sport"
                }
                size={21}
                color="#fff"
              />
            </View>
          </View>
          <Text style={styles.driverNavDestinationLabel}>PRÓXIMO PUNTO</Text>
          <Text style={styles.driverNavDestination}>{target?.address}</Text>
          {route?.steps.slice(0, 3).map((item, index) => (
            <View
              style={styles.driverNavStep}
              key={`${item.type}-${item.location.lat}-${item.location.lng}-${index}`}
            >
              <View
                style={[styles.driverNavStepIndex, index === 0 && { backgroundColor: routeColor }]}
              >
                <Text style={styles.driverNavStepIndexText}>{index + 1}</Text>
              </View>
              <View style={styles.itemCopy}>
                <Text style={styles.driverNavStepText}>{navigationInstruction(item)}</Text>
                <Text style={styles.helperText}>{Math.max(10, Math.round(item.distanceM))} m</Text>
              </View>
            </View>
          ))}
          <View style={styles.driverNavActions}>
            <Pressable style={styles.driverNavSecondary} onPress={onChat}>
              <Ionicons name="chatbubble-ellipses-outline" size={20} color="#17131c" />
              <Text style={styles.driverNavSecondaryText}>Chat</Text>
            </Pressable>
            <Pressable
              style={styles.driverNavPrimary}
              disabled={!target?.point}
              onPress={onExternal}
            >
              <Ionicons name="navigate" size={20} color="#fff" />
              <Text style={styles.primaryButtonText}>Abrir guía giro a giro</Text>
            </Pressable>
          </View>
          <Text style={styles.driverNavDisclaimer}>
            Flash mantiene etapa, destino y recorrido. Google Maps o Apple Maps aporta la navegación
            completa mientras tráfico y voz propios no estén habilitados.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function SignatureCaptureModal({
  visible,
  onClose,
  onSave,
  busy,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (input: {
    contentBase64: string;
    signerName: string;
    signerRelationship: "recipient" | "authorized_person";
  }) => Promise<void>;
  busy: boolean;
}) {
  const [paths, setPaths] = useState<string[]>([]),
    [signerName, setSignerName] = useState(""),
    [relationship, setRelationship] = useState<"recipient" | "authorized_person">("recipient");
  const canvasRef = useRef<View>(null),
    pathsRef = useRef<string[]>([]);
  const updatePaths = (next: string[]) => {
    pathsRef.current = next;
    setPaths(next);
  };
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          updatePaths([...pathsRef.current, `M ${locationX.toFixed(1)} ${locationY.toFixed(1)}`]);
        },
        onPanResponderMove: (event) => {
          const { locationX, locationY } = event.nativeEvent,
            copy = [...pathsRef.current];
          if (!copy.length) return;
          copy[copy.length - 1] =
            `${copy[copy.length - 1]} L ${locationX.toFixed(1)} ${locationY.toFixed(1)}`;
          updatePaths(copy);
        },
      }),
    [],
  );
  const save = async () => {
    if (signerName.trim().length < 2)
      return Alert.alert("Firma incompleta", "Indicá el nombre de quien recibe.");
    if (!paths.some((path) => path.includes(" L ")))
      return Alert.alert("Firma incompleta", "Pedile al receptor que firme dentro del recuadro.");
    if (!canvasRef.current) return;
    const contentBase64 = await captureRef(canvasRef, {
      format: "png",
      quality: 0.8,
      result: "base64",
    });
    await onSave({
      contentBase64,
      signerName: signerName.trim(),
      signerRelationship: relationship,
    });
    updatePaths([]);
    setSignerName("");
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.signatureBackdrop}>
        <View style={styles.signatureSheet}>
          <View style={styles.trackingHeader}>
            <View>
              <Text style={styles.orderConfirmationEyebrow}>RECEPCIÓN VERIFICADA</Text>
              <Text style={styles.foodRestaurantTitle}>Firma del receptor</Text>
            </View>
            <Pressable style={styles.foodBack} onPress={onClose}>
              <Ionicons name="close" size={21} color="#222" />
            </Pressable>
          </View>
          <Text style={styles.cardText}>
            Declaro haber recibido el envío. La firma, identidad declarada, hora y ubicación se
            guardarán cifradas como evidencia.
          </Text>
          <TextInput
            value={signerName}
            onChangeText={setSignerName}
            placeholder="Nombre y apellido"
            style={styles.input}
          />
          <View style={styles.signatureRelationshipRow}>
            {(["recipient", "authorized_person"] as const).map((value) => (
              <Pressable
                key={value}
                style={[
                  styles.signatureChoice,
                  relationship === value && styles.signatureChoiceActive,
                ]}
                onPress={() => setRelationship(value)}
              >
                <Text
                  style={
                    relationship === value
                      ? styles.signatureChoiceTextActive
                      : styles.signatureChoiceText
                  }
                >
                  {value === "recipient" ? "Destinatario" : "Persona autorizada"}
                </Text>
              </Pressable>
            ))}
          </View>
          <View
            ref={canvasRef}
            collapsable={false}
            style={styles.signatureCanvas}
            {...responder.panHandlers}
          >
            <Svg style={StyleSheet.absoluteFill}>
              {paths.map((path, index) => (
                <Path
                  key={index}
                  d={path}
                  stroke="#17131c"
                  strokeWidth={3}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </Svg>
            <Text pointerEvents="none" style={styles.signatureGuide}>
              {paths.length ? "" : "Firmar aquí"}
            </Text>
          </View>
          <View style={styles.signatureActions}>
            <Pressable
              style={styles.secondaryButton}
              disabled={busy}
              onPress={() => updatePaths([])}
            >
              <Text style={styles.secondaryButtonText}>Limpiar</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryButton, { flex: 1 }, busy && styles.disabledButton]}
              disabled={busy}
              onPress={() => void save()}
            >
              <Text style={styles.primaryButtonText}>{busy ? "Cifrando…" : "Guardar firma"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

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
  const [driverNotifications, setDriverNotifications] = useState<AppNotification[]>([]);
  const [driverNotificationsLoading, setDriverNotificationsLoading] = useState(false);
  const [driverEarnings, setDriverEarnings] = useState<DriverEarnings | null>(null);
  const [driverEarningsLoading, setDriverEarningsLoading] = useState(false);
  const [driverEarningsError, setDriverEarningsError] = useState("");
  const [selectedDriverDay, setSelectedDriverDay] = useState<string | null>(null);
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
  const [compliance, setCompliance] = useState<DriverCompliance | null>(null);
  const [documentType, setDocumentType] = useState<DriverDocument["type"]>("identity");
  const [documentExpiry, setDocumentExpiry] = useState("2099-12-31");
  const [documentUploading, setDocumentUploading] = useState(false);
  const [vehicles, setVehicles] = useState<DriverVehicle[]>([]);
  const [vehicleBusy, setVehicleBusy] = useState(false);
  const [driverPreferences, setDriverPreferences] = useState<DriverPreferences>({
    driverId: driver.id,
    navigationProvider: "system",
    updatedAt: null,
  });
  const [driverPreferenceBusy, setDriverPreferenceBusy] = useState(false);
  const [vehicleDraft, setVehicleDraft] = useState<{
    kind: DriverVehicle["kind"];
    model: string;
    plate: string;
    color: string;
    seats: string;
  }>({ kind: "car", model: "", plate: "", color: "", seats: "4" });

  useEffect(() => {
    if (driverView !== "inbox") return;
    let cancelled = false;
    setDriverNotificationsLoading(true);
    void api
      .getNotifications()
      .then((result) => {
        if (!cancelled) setDriverNotifications(result.notifications);
      })
      .catch(() => {
        if (!cancelled) setDriverNotifications([]);
      })
      .finally(() => {
        if (!cancelled) setDriverNotificationsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [driverView, driver.id]);
  useEffect(() => {
    driverScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [driverView]);

  const loadDriverEarnings = useCallback(async () => {
    setDriverEarningsLoading(true);
    setDriverEarningsError("");
    try {
      setDriverEarnings((await api.getDriverEarnings()).earnings);
    } catch (error) {
      setDriverEarningsError(
        error instanceof Error ? error.message : "No se pudieron cargar las ganancias",
      );
    } finally {
      setDriverEarningsLoading(false);
    }
  }, [driver.id]);
  useEffect(() => {
    if (driverView !== "earnings") return;
    void loadDriverEarnings();
    const poll = setInterval(() => void loadDriverEarnings(), 60000);
    return () => clearInterval(poll);
  }, [driverView, loadDriverEarnings]);

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

  const loadCompliance = useCallback(async () => {
    try {
      setCompliance((await api.getDriverCompliance(driver.id)).compliance);
    } catch (_error) {
      setCompliance(null);
    }
  }, [driver.id]);
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
    void loadCompliance();
    void loadVehicles();
    void loadDriverPreferences();
  }, [loadCompliance, loadVehicles, loadDriverPreferences]);
  useEffect(() => {
    void getBackgroundLocationState().then(setBackgroundGps);
  }, [driver.online]);
  const addVehicle = async () => {
    setVehicleBusy(true);
    try {
      const ride = ["car", "van"].includes(vehicleDraft.kind);
      await api.createDriverVehicle(driver.id, {
        kind: vehicleDraft.kind,
        model: vehicleDraft.model.trim(),
        plate: vehicleDraft.plate.trim(),
        color: vehicleDraft.color.trim() || null,
        seats: ride ? Number(vehicleDraft.seats) : 1,
        serviceModes: ride ? ["delivery", "ride"] : ["delivery"],
      });
      setVehicleDraft({ kind: "car", model: "", plate: "", color: "", seats: "4" });
      await loadVehicles();
      Alert.alert(
        "Vehículo enviado",
        "Operaciones debe verificarlo antes de que puedas conectarte.",
      );
    } catch (error) {
      Alert.alert(
        "Flash",
        error instanceof Error ? error.message : "No se pudo registrar el vehículo",
      );
    } finally {
      setVehicleBusy(false);
    }
  };
  const runVehicleAction = async (action: () => Promise<unknown>, message: string) => {
    setVehicleBusy(true);
    try {
      await action();
      await loadVehicles();
      Alert.alert("Flash", message);
    } catch (error) {
      Alert.alert(
        "Flash",
        error instanceof Error ? error.message : "No se pudo actualizar el vehículo",
      );
    } finally {
      setVehicleBusy(false);
    }
  };
  const pickComplianceDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["image/jpeg", "image/png", "application/pdf"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if ((asset.size || 0) > 750000) {
      Alert.alert("Documento demasiado grande", "El máximo seguro es 750 KB.");
      return;
    }
    const mimeType = (asset.mimeType || "application/pdf") as
      | "image/jpeg"
      | "image/png"
      | "application/pdf";
    setDocumentUploading(true);
    try {
      const contentBase64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await api.submitDriverDocument(driver.id, {
        type: documentType,
        mimeType,
        contentBase64,
        expiresAt: ["driver_license", "vehicle_registration", "insurance"].includes(documentType)
          ? documentExpiry
          : null,
      });
      await loadCompliance();
      Alert.alert("Flash", "Documento cifrado y enviado a revisión");
    } catch (error) {
      Alert.alert(
        "Flash",
        error instanceof Error ? error.message : "No se pudo subir el documento",
      );
    } finally {
      setDocumentUploading(false);
    }
  };
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

  const notificationTitles: Record<string, string> = {
    order_status: "Actualización de entrega",
    ride_status: "Actualización de viaje",
    shipment_status: "Actualización de envío",
    tip_received: "Recibiste una propina",
    support_reply: "Nueva respuesta de soporte",
    support_ticket_created: "Caso de soporte creado",
    driver_document_status: "Estado de documento",
    driver_vehicle_status: "Estado de vehículo",
  };
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

  const onlineToday = driverEarnings?.today.onlineSeconds;
  const activeToday = driverEarnings?.today.activeSeconds;
  const operationalRatio =
    onlineToday != null && activeToday != null && onlineToday > 0 && activeToday <= onlineToday
      ? Math.round((activeToday / onlineToday) * 100)
      : null;
  const operationalAnomaly =
    onlineToday != null && activeToday != null && activeToday > onlineToday;
  const driverWeekMagnitude = Math.max(
    1,
    ...(driverEarnings?.days || []).map((day) => Math.abs(day.amount)),
  );
  const driverSelectedDay =
    driverEarnings?.days.find((day) => day.date === selectedDriverDay) ||
    driverEarnings?.days.at(-1) ||
    null;

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
          <>
            <View style={styles.complianceCard}>
              <View style={styles.complianceHeader}>
                <View>
                  <Text style={styles.heroLabel}>NAVEGACIÓN</Text>
                  <Text style={styles.sectionTitle}>Guía externa preferida</Text>
                </View>
                <View style={styles.driverInsightIcon}>
                  <Ionicons name="navigate-outline" size={22} color="#7c3cff" />
                </View>
              </View>
              <Text style={styles.cardText}>
                Flash conserva etapa y trabajo activo. Esta preferencia sólo decide qué app abre el
                botón de guía completa.
              </Text>
              <View style={styles.driverPreferenceOptions}>
                {(
                  [
                    [
                      "system",
                      "Predeterminada",
                      "Usa Apple Maps en iPhone y Google Maps en el resto",
                    ],
                    [
                      "google_maps",
                      "Google Maps",
                      "Mantiene conducción o bicicleta según tu vehículo",
                    ],
                    ...(Platform.OS === "ios"
                      ? [["apple_maps", "Apple Maps", "Disponible para conducción en iPhone"]]
                      : []),
                  ] as Array<[DriverPreferences["navigationProvider"], string, string]>
                ).map(([value, label, detail]) => (
                  <Pressable
                    key={value}
                    disabled={driverPreferenceBusy}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: driverPreferences.navigationProvider === value }}
                    onPress={async () => {
                      setDriverPreferenceBusy(true);
                      try {
                        setDriverPreferences(
                          (await api.updateDriverPreferences(value)).preferences,
                        );
                      } catch (error) {
                        Alert.alert(
                          "Flash",
                          error instanceof Error
                            ? error.message
                            : "No se pudo guardar la preferencia",
                        );
                      } finally {
                        setDriverPreferenceBusy(false);
                      }
                    }}
                    style={[
                      styles.driverPreferenceOption,
                      driverPreferences.navigationProvider === value &&
                        styles.driverPreferenceOptionActive,
                    ]}
                  >
                    <View
                      style={[
                        styles.driverPreferenceRadio,
                        driverPreferences.navigationProvider === value &&
                          styles.driverPreferenceRadioActive,
                      ]}
                    >
                      {driverPreferences.navigationProvider === value ? (
                        <View style={styles.driverPreferenceDot} />
                      ) : null}
                    </View>
                    <View style={styles.itemCopy}>
                      <Text style={styles.sectionTitle}>{label}</Text>
                      <Text style={styles.cardText}>{detail}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.notificationTime}>
                {driverPreferences.updatedAt
                  ? `Guardado ${new Date(driverPreferences.updatedAt).toLocaleString("es-AR")}`
                  : "Preferencia predeterminada"}
              </Text>
            </View>
            <View style={styles.complianceCard}>
              <View style={styles.complianceHeader}>
                <View>
                  <Text style={styles.heroLabel}>LEGAJO Y SEGURIDAD</Text>
                  <Text style={styles.sectionTitle}>Verificación del conductor</Text>
                </View>
                <Text
                  style={[
                    styles.complianceBadge,
                    compliance?.status === "approved" && styles.complianceBadgeApproved,
                    compliance?.status === "rejected" && styles.complianceBadgeRejected,
                  ]}
                >
                  {(compliance?.status || "cargando").replaceAll("_", " ").toUpperCase()}
                </Text>
              </View>
              <Text style={styles.cardText}>
                Los archivos se cifran antes de persistir y sólo operaciones puede aprobarlos.
              </Text>
              <View style={styles.complianceDocuments}>
                {compliance?.requiredTypes.map((type) => {
                  const current = compliance.documents.find(
                    (document) =>
                      document.type === type && !["superseded"].includes(document.status),
                  );
                  const labels = {
                    identity: "Identidad",
                    driver_license: "Licencia",
                    vehicle_registration: "Cédula del vehículo",
                    insurance: "Seguro",
                    background_check: "Antecedentes",
                  };
                  return (
                    <View style={styles.complianceDocumentRow} key={type}>
                      <Ionicons
                        name={
                          current?.status === "approved"
                            ? "checkmark-circle"
                            : current?.status === "rejected"
                              ? "close-circle"
                              : "document-text-outline"
                        }
                        size={20}
                        color={
                          current?.status === "approved"
                            ? "#087a50"
                            : current?.status === "rejected"
                              ? "#c43d38"
                              : "#7c3cff"
                        }
                      />
                      <View style={styles.itemCopy}>
                        <Text style={styles.sectionTitle}>{labels[type]}</Text>
                        <Text style={styles.cardText}>
                          {current ? current.status.replaceAll("_", " ") : "Pendiente de envío"}
                          {current?.expiresAt ? ` · vence ${current.expiresAt}` : ""}
                        </Text>
                        {current?.rejectionReason && (
                          <Text style={styles.complianceRejection}>{current.rejectionReason}</Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.paymentBrandRail}
              >
                {(
                  [
                    ["identity", "Identidad"],
                    ["driver_license", "Licencia"],
                    ["vehicle_registration", "Cédula"],
                    ["insurance", "Seguro"],
                    ["background_check", "Antecedentes"],
                  ] as const
                ).map(([value, label]) => (
                  <Pressable
                    key={value}
                    onPress={() => setDocumentType(value)}
                    style={[
                      styles.issueCategoryPill,
                      documentType === value && styles.issueCategoryPillActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.issueCategoryText,
                        documentType === value && styles.issueCategoryTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              {["driver_license", "vehicle_registration", "insurance"].includes(documentType) && (
                <TextInput
                  style={styles.input}
                  value={documentExpiry}
                  onChangeText={setDocumentExpiry}
                  placeholder="Vencimiento AAAA-MM-DD"
                />
              )}
              <Pressable
                disabled={documentUploading}
                style={[styles.primaryButton, documentUploading && styles.disabledButton]}
                onPress={pickComplianceDocument}
              >
                <Ionicons name="cloud-upload-outline" size={19} color="#fff" />
                <Text style={styles.primaryButtonText}>
                  {documentUploading ? "Cifrando y enviando…" : "Elegir PDF o imagen"}
                </Text>
              </Pressable>
            </View>
            <View style={styles.complianceCard}>
              <View style={styles.complianceHeader}>
                <View>
                  <Text style={styles.heroLabel}>FLOTA PERSONAL</Text>
                  <Text style={styles.sectionTitle}>Vehículo operativo</Text>
                </View>
                <Text style={styles.complianceBadge}>{vehicles.length}/5</Text>
              </View>
              <Text style={styles.cardText}>
                Sólo el vehículo activo, aprobado y compatible recibe ofertas. Un cambio vuelve a
                revisión y te desconecta.
              </Text>
              {vehicles.map((vehicle) => (
                <View key={vehicle.id} style={styles.complianceDocumentRow}>
                  <Ionicons
                    name={
                      vehicle.kind === "bicycle"
                        ? "bicycle"
                        : vehicle.kind === "motorcycle"
                          ? "speedometer-outline"
                          : "car-sport-outline"
                    }
                    size={22}
                    color={vehicle.active ? "#7c3cff" : "#777"}
                  />
                  <View style={styles.itemCopy}>
                    <Text style={styles.sectionTitle}>
                      {vehicle.model} · {vehicle.plate}
                    </Text>
                    <Text style={styles.cardText}>
                      {vehicle.kind} · {vehicle.serviceModes.join(" + ")} · {vehicle.status}
                      {vehicle.active ? " · activo" : ""}
                    </Text>
                    {vehicle.rejectionReason && (
                      <Text style={styles.complianceRejection}>{vehicle.rejectionReason}</Text>
                    )}
                  </View>
                  {!vehicle.active && vehicle.status === "approved" ? (
                    <Pressable
                      disabled={vehicleBusy}
                      onPress={() =>
                        void runVehicleAction(
                          () => api.activateDriverVehicle(vehicle.id),
                          "Vehículo activado; revisá tu disponibilidad.",
                        )
                      }
                    >
                      <Ionicons name="checkmark-circle-outline" size={25} color="#087a50" />
                    </Pressable>
                  ) : null}
                  <Pressable
                    disabled={vehicleBusy}
                    onPress={() =>
                      Alert.alert(
                        "Retirar vehículo",
                        `¿Retirar ${vehicle.model}? La evidencia histórica se conservará.`,
                        [
                          { text: "Cancelar", style: "cancel" },
                          {
                            text: "Retirar",
                            style: "destructive",
                            onPress: () =>
                              void runVehicleAction(
                                () => api.retireDriverVehicle(vehicle.id),
                                "Vehículo retirado",
                              ),
                          },
                        ],
                      )
                    }
                  >
                    <Ionicons name="trash-outline" size={21} color="#a33939" />
                  </Pressable>
                </View>
              ))}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.paymentBrandRail}
              >
                {(
                  [
                    ["bicycle", "Bici"],
                    ["motorcycle", "Moto"],
                    ["car", "Auto"],
                    ["van", "Van"],
                  ] as const
                ).map(([value, label]) => (
                  <Pressable
                    key={value}
                    onPress={() =>
                      setVehicleDraft((current) => ({
                        ...current,
                        kind: value,
                        seats: ["car", "van"].includes(value) ? current.seats || "4" : "1",
                      }))
                    }
                    style={[
                      styles.issueCategoryPill,
                      vehicleDraft.kind === value && styles.issueCategoryPillActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.issueCategoryText,
                        vehicleDraft.kind === value && styles.issueCategoryTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              <TextInput
                style={styles.input}
                value={vehicleDraft.model}
                onChangeText={(model) => setVehicleDraft((current) => ({ ...current, model }))}
                placeholder="Marca y modelo"
              />
              <TextInput
                style={styles.input}
                value={vehicleDraft.plate}
                onChangeText={(plate) =>
                  setVehicleDraft((current) => ({ ...current, plate: plate.toUpperCase() }))
                }
                autoCapitalize="characters"
                placeholder="Patente"
              />
              <TextInput
                style={styles.input}
                value={vehicleDraft.color}
                onChangeText={(color) => setVehicleDraft((current) => ({ ...current, color }))}
                placeholder="Color"
              />
              {["car", "van"].includes(vehicleDraft.kind) ? (
                <TextInput
                  style={styles.input}
                  value={vehicleDraft.seats}
                  onChangeText={(seats) =>
                    setVehicleDraft((current) => ({
                      ...current,
                      seats: seats.replace(/\D/g, "").slice(0, 1),
                    }))
                  }
                  keyboardType="numeric"
                  placeholder="Asientos"
                />
              ) : null}
              <Pressable
                disabled={
                  vehicleBusy || !vehicleDraft.model.trim() || vehicleDraft.plate.trim().length < 3
                }
                style={[
                  styles.primaryButton,
                  (vehicleBusy ||
                    !vehicleDraft.model.trim() ||
                    vehicleDraft.plate.trim().length < 3) &&
                    styles.disabledButton,
                ]}
                onPress={() => void addVehicle()}
              >
                <Ionicons name="add-circle-outline" size={19} color="#fff" />
                <Text style={styles.primaryButtonText}>
                  {vehicleBusy ? "Guardando…" : "Registrar vehículo"}
                </Text>
              </Pressable>
            </View>
          </>
        )}
        {driverView === "earnings" && (
          <>
            <LinearGradient
              colors={["#21132f", "#6f25d8"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.driverEarningsHero}
            >
              <Text style={styles.driverEarningsLabel}>INGRESOS REGISTRADOS HOY</Text>
              <Text style={styles.driverEarningsValue}>
                {money.format(driverEarnings?.today.amount ?? driver.earningsToday)}
              </Text>
              <Text style={styles.driverEarningsCopy}>
                {driverEarnings?.source === "postgres-ledger"
                  ? "Calculado desde asientos contables posteados. Incluye servicios, propinas y ajustes reales."
                  : "Runtime local de prueba: los importes provienen de movimientos persistidos, sin proyecciones."}
              </Text>
            </LinearGradient>
            {driverEarningsLoading && !driverEarnings ? (
              <ActivityIndicator color="#7c3cff" />
            ) : null}
            {driverEarningsError ? (
              <Pressable
                style={styles.driverEarningsError}
                onPress={() => void loadDriverEarnings()}
              >
                <Ionicons name="refresh-circle-outline" size={23} color="#a33939" />
                <View style={styles.itemCopy}>
                  <Text style={styles.sectionTitle}>No pudimos leer el ledger</Text>
                  <Text style={styles.cardText}>{driverEarningsError} · Tocá para reintentar.</Text>
                </View>
              </Pressable>
            ) : null}
            <View style={styles.driverPeriodGrid}>
              <View style={styles.driverPeriodCard}>
                <Text style={styles.driverPeriodLabel}>ESTA SEMANA</Text>
                <Text style={styles.driverPeriodValue}>
                  {money.format(driverEarnings?.week.amount ?? 0)}
                </Text>
                <Text style={styles.driverPeriodMeta}>
                  {driverEarnings?.week.services ?? 0} servicios
                </Text>
              </View>
              <View style={styles.driverPeriodCard}>
                <Text style={styles.driverPeriodLabel}>SALDO WALLET</Text>
                <Text style={styles.driverPeriodValue}>
                  {money.format(driverEarnings?.walletBalance ?? 0)}
                </Text>
                <Text style={styles.driverPeriodMeta}>retiro aún no habilitado</Text>
              </View>
            </View>
            {driverEarnings?.days.length ? (
              <View style={styles.driverWeekChartCard}>
                <View style={styles.driverSectionHeading}>
                  <View>
                    <Text style={styles.driverSectionEyebrow}>SEMANA EN CURSO</Text>
                    <Text style={styles.driverTimeTitle}>Ingresos por día</Text>
                  </View>
                  <Text style={styles.driverWeekChartTotal}>
                    {money.format(driverEarnings.week.amount)}
                  </Text>
                </View>
                <View
                  style={styles.driverWeekChart}
                  accessibilityRole="summary"
                  accessibilityLabel={`Ingresos de la semana ${money.format(driverEarnings.week.amount)}`}
                >
                  {driverEarnings.days.map((day) => {
                    const height = Math.max(
                      day.amount === 0 ? 3 : 8,
                      Math.round((Math.abs(day.amount) / driverWeekMagnitude) * 52),
                    );
                    const weekday = new Date(`${day.date}T12:00:00`)
                      .toLocaleDateString("es-AR", { weekday: "short" })
                      .replace(".", "")
                      .toUpperCase();
                    const selected = driverSelectedDay?.date === day.date;
                    return (
                      <Pressable
                        key={day.date}
                        onPress={() => setSelectedDriverDay(day.date)}
                        style={[
                          styles.driverWeekColumn,
                          selected && styles.driverWeekColumnSelected,
                        ]}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`${weekday}: ${money.format(day.amount)}, ${day.services} servicios`}
                      >
                        <Text
                          style={[
                            styles.driverWeekAmount,
                            day.amount < 0 && styles.driverWeekAmountNegative,
                          ]}
                        >
                          {compactMoney(day.amount)}
                        </Text>
                        <View style={styles.driverWeekUpper}>
                          {day.amount >= 0 ? (
                            <View
                              style={[
                                styles.driverWeekBar,
                                {
                                  height,
                                  backgroundColor: day.amount === 0 ? "#d9d2dd" : "#7c3cff",
                                },
                              ]}
                            />
                          ) : null}
                        </View>
                        <View style={styles.driverWeekBaseline} />
                        <View style={styles.driverWeekLower}>
                          {day.amount < 0 ? (
                            <View
                              style={[styles.driverWeekBar, { height, backgroundColor: "#c44a45" }]}
                            />
                          ) : null}
                        </View>
                        <Text
                          style={[styles.driverWeekDay, selected && styles.driverWeekDaySelected]}
                        >
                          {weekday}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {driverSelectedDay ? (
                  <View style={styles.driverWeekDetail}>
                    <View style={styles.driverWeekDetailHeader}>
                      <View>
                        <Text style={styles.driverTimeLabel}>DETALLE SELECCIONADO</Text>
                        <Text style={styles.driverWeekDetailDate}>
                          {new Date(`${driverSelectedDay.date}T12:00:00`).toLocaleDateString(
                            "es-AR",
                            { weekday: "long", day: "numeric", month: "long" },
                          )}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.driverWeekDetailAmount,
                          driverSelectedDay.amount < 0 && styles.driverWeekAmountNegative,
                        ]}
                      >
                        {money.format(driverSelectedDay.amount)}
                      </Text>
                    </View>
                    <View style={styles.driverWeekDetailGrid}>
                      <View style={styles.driverWeekDetailMetric}>
                        <Text style={styles.driverTimeMeta}>Servicios</Text>
                        <Text style={styles.driverWeekDetailValue}>
                          {driverSelectedDay.services}
                        </Text>
                      </View>
                      <View style={styles.driverWeekDetailMetric}>
                        <Text style={styles.driverTimeMeta}>Propinas</Text>
                        <Text style={styles.driverWeekDetailValue}>
                          {money.format(driverSelectedDay.tips)}
                        </Text>
                      </View>
                      <View style={styles.driverWeekDetailMetric}>
                        <Text style={styles.driverTimeMeta}>Conectado</Text>
                        <Text style={styles.driverWeekDetailValue}>
                          {operationalDuration(driverSelectedDay.onlineSeconds)}
                        </Text>
                      </View>
                      <View style={styles.driverWeekDetailMetric}>
                        <Text style={styles.driverTimeMeta}>En servicio</Text>
                        <Text style={styles.driverWeekDetailValue}>
                          {operationalDuration(driverSelectedDay.activeSeconds)}
                        </Text>
                      </View>
                    </View>
                  </View>
                ) : null}
                <Text style={styles.driverTimeSource}>
                  Neto diario posteado: servicios, propinas y ajustes. Los días vacíos son cero, no
                  una proyección.
                </Text>
              </View>
            ) : null}
            {driverEarnings?.timeTracking.status === "available" ? (
              <View style={styles.driverTimeCard}>
                <View style={styles.driverSectionHeading}>
                  <View>
                    <Text style={styles.driverSectionEyebrow}>JORNADA OBSERVADA</Text>
                    <Text style={styles.driverTimeTitle}>Tu tiempo de hoy</Text>
                  </View>
                  <View style={styles.driverTimeClock}>
                    <Ionicons name="time-outline" size={22} color="#7c3cff" />
                  </View>
                </View>
                <View style={styles.driverTimeGrid}>
                  <View style={styles.driverTimeMetric}>
                    <View style={styles.driverTimeMetricTop}>
                      <View style={[styles.driverTimeDot, { backgroundColor: "#7c3cff" }]} />
                      <Text style={styles.driverTimeLabel}>CONECTADO</Text>
                    </View>
                    <Text style={styles.driverTimeValue}>{operationalDuration(onlineToday)}</Text>
                    <Text style={styles.driverTimeMeta}>incluye espera online</Text>
                  </View>
                  <View style={styles.driverTimeMetric}>
                    <View style={styles.driverTimeMetricTop}>
                      <View style={[styles.driverTimeDot, { backgroundColor: "#087a50" }]} />
                      <Text style={styles.driverTimeLabel}>EN SERVICIO</Text>
                    </View>
                    <Text style={styles.driverTimeValue}>{operationalDuration(activeToday)}</Text>
                    <Text style={styles.driverTimeMeta}>asignación a cierre</Text>
                  </View>
                </View>
                {operationalRatio != null ? (
                  <View style={styles.driverTimeRatio}>
                    <View style={styles.driverTimeTrack}>
                      <View style={[styles.driverTimeFill, { width: `${operationalRatio}%` }]} />
                    </View>
                    <Text style={styles.driverTimeRatioText}>
                      {operationalRatio}% de la jornada conectada estuvo en servicio
                    </Text>
                  </View>
                ) : null}
                {operationalAnomaly ? (
                  <View style={styles.driverTimeWarning}>
                    <Ionicons name="alert-circle-outline" size={18} color="#9b5b00" />
                    <Text style={styles.driverTimeWarningText}>
                      Hay tiempo asignado fuera de una sesión online. El registro se conserva para
                      revisión operativa.
                    </Text>
                  </View>
                ) : null}
                <View style={styles.driverTimeWeek}>
                  <Text style={styles.driverTimeWeekLabel}>SEMANA</Text>
                  <Text style={styles.driverTimeWeekValue}>
                    {operationalDuration(driverEarnings.week.onlineSeconds)} conectado
                  </Text>
                  <View style={styles.driverTimeWeekDivider} />
                  <Text style={styles.driverTimeWeekValue}>
                    {operationalDuration(driverEarnings.week.activeSeconds)} en servicio
                  </Text>
                </View>
                <Text style={styles.driverTimeSource}>
                  PostgreSQL · actualizado{" "}
                  {new Date(driverEarnings.timeTracking.observedAt).toLocaleTimeString("es-AR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · los solapamientos cuentan una sola vez
                </Text>
              </View>
            ) : driverEarnings ? (
              <View style={styles.driverTimeUnavailable}>
                <Ionicons name="cloud-offline-outline" size={21} color="#a33939" />
                <View style={styles.itemCopy}>
                  <Text style={styles.sectionTitle}>Jornada no disponible</Text>
                  <Text style={styles.cardText}>
                    Este runtime no tiene sesiones PostgreSQL. No mostramos horas aproximadas.
                  </Text>
                </View>
              </View>
            ) : null}
            <KpiRow
              items={[
                ["Servicios", driverEarnings?.today.services ?? 0],
                ["Propinas", money.format(driverEarnings?.today.tips ?? 0)],
                ["Ajustes", money.format(driverEarnings?.today.adjustments ?? 0)],
                ["Rating", driver.rating],
              ]}
            />
            <View style={styles.complianceCard}>
              <View style={styles.driverSectionHeading}>
                <View>
                  <Text style={styles.driverSectionEyebrow}>MOVIMIENTOS CONTABLES</Text>
                  <Text style={styles.sectionTitle}>Detalle reciente</Text>
                </View>
                <Pressable
                  onPress={() => void loadDriverEarnings()}
                  accessibilityRole="button"
                  accessibilityLabel="Actualizar ganancias"
                >
                  <Ionicons name="refresh-outline" size={21} color="#7c3cff" />
                </Pressable>
              </View>
              {driverEarnings?.recent.length ? (
                driverEarnings.recent.map((entry) => (
                  <View key={entry.id} style={styles.driverEarningRow}>
                    <View
                      style={[
                        styles.driverInboxIcon,
                        entry.amount < 0 && styles.driverEarningAdjustment,
                      ]}
                    >
                      <Ionicons
                        name={
                          entry.category === "tip"
                            ? "heart-outline"
                            : entry.category === "adjustment"
                              ? "remove-circle-outline"
                              : entry.category === "ride"
                                ? "car-sport-outline"
                                : entry.category === "shipment"
                                  ? "cube-outline"
                                  : "bag-handle-outline"
                        }
                        size={20}
                        color={entry.amount < 0 ? "#a33939" : "#7c3cff"}
                      />
                    </View>
                    <View style={styles.itemCopy}>
                      <Text style={styles.sectionTitle}>{entry.description}</Text>
                      <Text style={styles.cardText}>
                        {entry.jobId || "Movimiento de cuenta"} ·{" "}
                        {new Date(entry.createdAt).toLocaleString("es-AR")}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.driverEarningAmount,
                        entry.amount < 0 && styles.driverEarningAmountNegative,
                      ]}
                    >
                      {entry.amount > 0 ? "+" : ""}
                      {money.format(entry.amount)}
                    </Text>
                  </View>
                ))
              ) : (
                <View style={styles.driverEmptyState}>
                  <Ionicons name="receipt-outline" size={34} color="#7c3cff" />
                  <Text style={styles.sectionTitle}>Sin movimientos todavía</Text>
                  <Text style={styles.cardText}>
                    Los servicios completados, propinas y ajustes aparecerán al postearse en el
                    ledger.
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.driverTransparencyCard}>
              <Ionicons name="shield-checkmark-outline" size={22} color="#087a50" />
              <View style={styles.itemCopy}>
                <Text style={styles.sectionTitle}>Datos honestos</Text>
                <Text style={styles.cardText}>
                  Ingresos y jornada provienen del ledger y de sesiones operativas. Metas,
                  promociones y retiros siguen ocultos hasta tener contratos productivos.
                </Text>
              </View>
            </View>
          </>
        )}
        {driverView === "inbox" && (
          <>
            <View style={styles.driverSectionHeading}>
              <View>
                <Text style={styles.driverSectionEyebrow}>COMUNICACIONES</Text>
                <Text style={styles.driverSectionTitle}>Inbox</Text>
              </View>
              <View style={styles.driverUnreadBadge}>
                <Text style={styles.driverUnreadText}>
                  {driverNotifications.filter((item) => !item.readAt).length}
                </Text>
              </View>
            </View>
            {activeChats.length > 0 ? (
              <View style={styles.complianceCard}>
                <Text style={styles.sectionTitle}>Chats de trabajos activos</Text>
                <Text style={styles.cardText}>
                  El chat queda ligado al servicio y conserva participantes autorizados.
                </Text>
                {activeChats.map((chat) => (
                  <Pressable
                    key={chat.id}
                    style={styles.driverInboxRow}
                    onPress={() => setChatJobId(chat.id)}
                  >
                    <View style={styles.driverInboxIcon}>
                      <Ionicons name={chat.icon} size={20} color="#7c3cff" />
                    </View>
                    <View style={styles.itemCopy}>
                      <Text style={styles.sectionTitle}>{chat.label}</Text>
                      <Text style={styles.cardText} numberOfLines={1}>
                        {chat.detail}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={19} color="#968c9e" />
                  </Pressable>
                ))}
              </View>
            ) : null}
            <View style={styles.complianceCard}>
              <Text style={styles.sectionTitle}>Novedades de tu cuenta</Text>
              {driverNotificationsLoading ? (
                <ActivityIndicator color="#7c3cff" />
              ) : driverNotifications.length === 0 ? (
                <View style={styles.driverEmptyState}>
                  <Ionicons name="mail-open-outline" size={34} color="#7c3cff" />
                  <Text style={styles.sectionTitle}>Todo al día</Text>
                  <Text style={styles.cardText}>
                    Los estados de servicios, documentos y soporte aparecerán acá.
                  </Text>
                </View>
              ) : (
                driverNotifications.slice(0, 20).map((item) => (
                  <Pressable
                    key={item.id}
                    disabled={Boolean(item.readAt)}
                    onPress={async () => {
                      const result = await api.markNotificationRead(item.id);
                      setDriverNotifications(result.notifications);
                    }}
                    style={[styles.driverInboxRow, !item.readAt && styles.driverInboxUnread]}
                  >
                    <View style={styles.driverInboxIcon}>
                      <Ionicons
                        name={item.readAt ? "mail-open-outline" : "mail-unread-outline"}
                        size={20}
                        color={item.readAt ? "#777" : "#7c3cff"}
                      />
                    </View>
                    <View style={styles.itemCopy}>
                      <Text style={styles.sectionTitle}>
                        {notificationTitles[item.template] || "Novedad de Flash"}
                      </Text>
                      <Text style={styles.cardText}>
                        {String(
                          item.payload.status ||
                            item.payload.kind ||
                            "Revisá el detalle de tu cuenta",
                        )}
                      </Text>
                      <Text style={styles.notificationTime}>
                        {new Date(item.createdAt).toLocaleString("es-AR")}
                      </Text>
                    </View>
                    {!item.readAt ? <Text style={styles.notificationNew}>NUEVA</Text> : null}
                  </Pressable>
                ))
              )}
            </View>
          </>
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
              {value === "inbox" && driverNotifications.some((item) => !item.readAt) ? (
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

function RideCard({
  ride,
  disabled,
  onPress,
}: {
  ride: Ride;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{ride.status}</Text>
      <Text style={styles.cardText}>
        {ride.pickup} {"->"} {ride.destination}
      </Text>
      <Text style={styles.cardText}>
        {ride.distanceKm} km - {money.format(ride.fare)}
      </Text>
      {onPress && <ActionButton label="Gestionar" disabled={disabled} onPress={onPress} />}
    </View>
  );
}

function ShipmentCard({
  shipment,
  disabled,
  onPress,
  pin = "",
  onPinChange,
}: {
  shipment: AppState["shipments"][number];
  disabled?: boolean;
  onPress?: () => void;
  pin?: string;
  onPinChange?: (value: string) => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Envio · {shipment.status}</Text>
      <Text style={styles.cardText}>
        {shipment.pickup} → {shipment.destination}
      </Text>
      <Text style={styles.cardText}>
        {shipment.weightKg} kg · {money.format(shipment.fare)}
      </Text>
      <Text style={styles.helperText}>
        {shipment.serviceLevel?.toUpperCase()} · {shipment.itemCategory}
        {shipment.handlingInstructions ? ` · ${shipment.handlingInstructions}` : ""}
      </Text>
      {(shipment.deliveryEvidenceCount || 0) > 0 && (
        <View style={styles.deliveryEvidenceBadge}>
          <Ionicons name="shield-checkmark" size={16} color="#087a50" />
          <Text style={styles.deliveryEvidenceBadgeText}>
            {shipment.status === "delivered"
              ? shipment.signatureRequired
                ? "Entrega verificada con foto + firma + PIN"
                : "Entrega verificada con foto + PIN"
              : shipment.signatureRequired
                ? "Evidencia de entrega protegida"
                : "Foto de entrega protegida"}
          </Text>
        </View>
      )}
      {shipment.status === "delivering" && onPinChange ? (
        <>
          <Text style={styles.cardText}>Solicitá el PIN al destinatario</Text>
          <TextInput
            value={pin}
            onChangeText={onPinChange}
            keyboardType="number-pad"
            maxLength={4}
            secureTextEntry
            placeholder="PIN de 4 dígitos"
            style={styles.input}
          />
        </>
      ) : null}
      {onPress && (
        <ActionButton
          label={shipment.status === "delivering" ? "Confirmar entrega" : "Gestionar envio"}
          disabled={disabled || (shipment.status === "delivering" && pin.length !== 4)}
          onPress={onPress}
        />
      )}
    </View>
  );
}
