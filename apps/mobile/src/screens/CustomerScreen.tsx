// Pantalla del cliente (ticket ARC-001). El shell, las primitivas compartidas y
// Actividad ya viven en módulos separados; este archivo conserva la coordinación
// de Comidas, Viajes, Envíos y Cuenta mientras continúa la extracción por dominio.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Location from "expo-location";
import * as Sharing from "expo-sharing";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
  Modal,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from "react-native";

import { track } from "../analytics";
import { api } from "../api";
import { SubscriptionCard } from "../SubscriptionCard";
import { TipSelector } from "../TipSelector";
import { RescheduleControl, SchedulePicker } from "../SchedulePicker";
import { flashDesign } from "../design-system";
import FlashNativeMap from "../FlashNativeMap";
import { mobileOrderStatusLabel, money, navigationInstruction } from "../format";
import { styles } from "../styles";
import { ActionButton, NativeMapUnavailable, ServiceChatModal } from "../ui";
import { CustomerActivityScreen } from "./CustomerActivityScreen";
import type {
  AppNotification,
  AppState,
  DietaryPreferences,
  Driver,
  FoodCheckoutQuote,
  GeoPoint,
  MobileCartLine,
  GroupOrder as GroupOrderType,
  NotificationPreference,
  Order,
  OrderSubstitution,
  Restaurant,
  Ride,
  RideDestination,
  RideQuote,
  RideService,
  RideTrustedContact,
  RoadRoute,
  ServiceReceipt,
  Shipment,
  ShipmentClaim,
  ShipmentOptions,
  ShipmentQuote,
  ShipmentReturn,
  User,
} from "../types";
function OrderTrackingSheet({
  order,
  driver,
  onClose,
}: {
  order: Order | null;
  driver: Driver | null;
  onClose: () => void;
}) {
  const [route, setRoute] = useState<RoadRoute | null>(null),
    [routeError, setRouteError] = useState("");
  useEffect(() => {
    if (!order?.pickupLocation || !order.deliveryLocation) {
      setRoute(null);
      return;
    }
    let cancelled = false;
    setRouteError("");
    void api
      .route(order.pickupLocation, order.deliveryLocation)
      .then((result) => {
        if (!cancelled) setRoute(result.route);
      })
      .catch(() => {
        if (!cancelled)
          setRouteError("No pudimos cargar la ruta; el estado del pedido sigue actualizado.");
      });
    return () => {
      cancelled = true;
    };
  }, [
    order?.id,
    order?.pickupLocation?.lat,
    order?.pickupLocation?.lng,
    order?.deliveryLocation?.lat,
    order?.deliveryLocation?.lng,
  ]);
  const hasMap = Boolean(order?.pickupLocation && order.deliveryLocation);
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
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.trackingBackdrop}>
        <View style={styles.trackingSheet}>
          <View style={styles.trackingHeader}>
            <View>
              <Text style={styles.orderConfirmationEyebrow}>SEGUIMIENTO EN VIVO</Text>
              <Text style={styles.foodRestaurantTitle}>Pedido {order.id}</Text>
            </View>
            <Pressable style={styles.foodBack} onPress={onClose}>
              <Ionicons name="close" size={21} color="#222" />
            </Pressable>
          </View>
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
              detail={
                driver ? `${driver.name} · ${driver.vehicle}` : "Buscando repartidor disponible"
              }
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
            <View style={styles.trackingProgress}>
              {labels.map((label, index) => (
                <View style={styles.trackingStage} key={label}>
                  <View
                    style={[
                      styles.trackingStageDot,
                      index <= current && styles.trackingStageDotActive,
                    ]}
                  >
                    {index < current ? <Ionicons name="checkmark" size={11} color="#fff" /> : null}
                  </View>
                  <Text
                    style={[
                      styles.trackingStageText,
                      index === current && styles.trackingStageTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </View>
              ))}
            </View>
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
        </View>
      </View>
    </Modal>
  );
}

function RideTrackingSheet({
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
  const [route, setRoute] = useState<RoadRoute | null>(null),
    [routeError, setRouteError] = useState("");
  useEffect(() => {
    if (!ride?.pickupLocation || !ride.destinationLocation) {
      setRoute(null);
      return;
    }
    let cancelled = false;
    setRouteError("");
    void api
      .route(ride.pickupLocation, ride.destinationLocation)
      .then((result) => {
        if (!cancelled) setRoute(result.route);
      })
      .catch(() => {
        if (!cancelled)
          setRouteError("La ruta no está disponible; el estado del viaje sigue actualizado.");
      });
    return () => {
      cancelled = true;
    };
  }, [
    ride?.id,
    ride?.pickupLocation?.lat,
    ride?.pickupLocation?.lng,
    ride?.destinationLocation?.lat,
    ride?.destinationLocation?.lng,
  ]);
  const hasMap = Boolean(ride?.pickupLocation && ride.destinationLocation);
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
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.trackingBackdrop}>
        <View style={styles.trackingSheet}>
          <View style={styles.trackingHeader}>
            <View>
              <Text style={styles.orderConfirmationEyebrow}>VIAJE EN VIVO</Text>
              <Text style={styles.foodRestaurantTitle}>{headline}</Text>
            </View>
            <Pressable style={styles.foodBack} onPress={onClose}>
              <Ionicons name="close" size={21} color="#222" />
            </Pressable>
          </View>
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
              <View style={styles.trackingProgress}>
                {labels.map((label, index) => (
                  <View style={styles.trackingStage} key={label}>
                    <View
                      style={[
                        styles.trackingStageDot,
                        index <= current && styles.trackingStageDotActive,
                      ]}
                    >
                      {index < current ? (
                        <Ionicons name="checkmark" size={11} color="#fff" />
                      ) : null}
                    </View>
                    <Text
                      style={[
                        styles.trackingStageText,
                        index === current && styles.trackingStageTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </View>
                ))}
              </View>
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
                  <Pressable
                    style={styles.orderConfirmationAction}
                    onPress={() => void onRevealCode()}
                  >
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
              <Text style={[styles.shareActionText, { color: "#c92626" }]}>
                Seguridad Flash · SOS
              </Text>
            </Pressable>
            <Pressable style={styles.reportIssueButton} onPress={onCancel}>
              <Ionicons name="close-circle-outline" size={18} color="#8f3840" />
              <Text style={styles.reportIssueText}>Cancelar viaje</Text>
              <Ionicons name="chevron-forward" size={17} color="#a29aa5" />
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ShipmentTrackingSheet({
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
  const [route, setRoute] = useState<RoadRoute | null>(null),
    [routeError, setRouteError] = useState(""),
    [evidence, setEvidence] = useState<import("../types").DeliveryEvidence[]>([]),
    [pinBusy, setPinBusy] = useState(false);
  useEffect(() => {
    if (!shipment?.pickupLocation || !shipment.destinationLocation) {
      setRoute(null);
      return;
    }
    let cancelled = false;
    setRouteError("");
    void Promise.all([
      api.route(shipment.pickupLocation, shipment.destinationLocation),
      api.getShipmentDeliveryEvidence(shipment.id).catch(() => ({ evidence: [] })),
    ])
      .then(([routeResult, evidenceResult]) => {
        if (!cancelled) {
          setRoute(routeResult.route);
          setEvidence(evidenceResult.evidence);
        }
      })
      .catch(() => {
        if (!cancelled)
          setRouteError("No pudimos cargar la ruta; el estado operativo sigue actualizado.");
      });
    return () => {
      cancelled = true;
    };
  }, [
    shipment?.id,
    shipment?.pickupLocation?.lat,
    shipment?.pickupLocation?.lng,
    shipment?.destinationLocation?.lat,
    shipment?.destinationLocation?.lng,
    shipment?.deliveryEvidenceCount,
  ]);
  const hasMap = Boolean(shipment?.pickupLocation && shipment.destinationLocation);
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
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.trackingBackdrop}>
        <View style={styles.trackingSheet}>
          <View style={styles.trackingHeader}>
            <View>
              <Text style={styles.orderConfirmationEyebrow}>ENVÍO EN VIVO</Text>
              <Text style={styles.foodRestaurantTitle}>{shipment.id}</Text>
            </View>
            <Pressable style={styles.foodBack} onPress={onClose}>
              <Ionicons name="close" size={21} color="#222" />
            </Pressable>
          </View>
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
              detail={
                driver ? `${driver.name} · ${driver.vehicle}` : "Buscando conductor disponible"
              }
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
              <View style={styles.trackingProgress}>
                {labels.map((label, index) => (
                  <View style={styles.trackingStage} key={label}>
                    <View
                      style={[
                        styles.trackingStageDot,
                        index <= current && styles.trackingStageDotActive,
                      ]}
                    >
                      {index < current ? (
                        <Ionicons name="checkmark" size={11} color="#fff" />
                      ) : null}
                    </View>
                    <Text
                      style={[
                        styles.trackingStageText,
                        index === current && styles.trackingStageTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </View>
                ))}
              </View>
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
        </View>
      </View>
    </Modal>
  );
}

export function CustomerScreen({
  state,
  user,
  busy,
  runAction,
  refresh,
  onLogout,
}: {
  state: AppState;
  user: User;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
  refresh: () => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const customerScrollRef = useRef<ScrollView>(null);
  const [customerWindow, setCustomerWindow] = useState<"food" | "ride" | "shipment">("food");
  const [sharedView, setSharedView] = useState<"service" | "activity" | "account">("service");
  const [foodScreen, setFoodScreen] = useState<
    "home" | "search" | "restaurant" | "cart" | "checkout" | "orders"
  >("home");
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<string | null>(null);
  const lastActivityAnalyticsKey = useRef("");
  const previousFoodQuery = useRef("");
  const previousCartCount = useRef<number | null>(null);
  useEffect(() => {
    customerScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [foodScreen, customerWindow, sharedView]);
  const [foodQuery, setFoodQuery] = useState("");
  type CatalogSearchResult = {
    restaurantId: string;
    restaurantName: string;
    cuisine: string;
    image: string;
    cover: string;
    etaMin: number;
    deliveryFee: number;
    matchedItems: Array<{ id: string; name: string; category: string }>;
    matchCount: number;
    score: number;
  };
  const [catalogResults, setCatalogResults] = useState<CatalogSearchResult[]>([]),
    [catalogSearchLoading, setCatalogSearchLoading] = useState(false),
    [catalogSearchError, setCatalogSearchError] = useState(""),
    [catalogNextOffset, setCatalogNextOffset] = useState<number | null>(null);
  const [catalogSearchNonce, setCatalogSearchNonce] = useState(0);
  const [foodCategory, setFoodCategory] = useState("Todos");
  const [foodMenuCategory, setFoodMenuCategory] = useState("Todos");
  const [favoriteRestaurantIds, setFavoriteRestaurantIds] = useState<string[]>(
    state.favoriteRestaurantIds || [],
  );
  const [favoritePendingId, setFavoritePendingId] = useState<string | null>(null);
  useEffect(
    () => setFavoriteRestaurantIds(state.favoriteRestaurantIds || []),
    [state.favoriteRestaurantIds],
  );
  const foodCategories = useMemo(() => {
    const restaurants = state.restaurants.filter((restaurant) => restaurant.open);
    const byCuisine = new Map<string, { name: string; image: string; count: number }>();
    for (const restaurant of restaurants) {
      const name = restaurant.cuisine.trim() || "Otros";
      const current = byCuisine.get(name);
      byCuisine.set(name, {
        name,
        image: current?.image || restaurant.image || restaurant.cover,
        count: (current?.count || 0) + 1,
      });
    }
    return [
      {
        name: "Todos",
        image: restaurants[0]?.image || restaurants[0]?.cover || "",
        count: restaurants.length,
      },
      ...Array.from(byCuisine.values()).sort(
        (left, right) => right.count - left.count || left.name.localeCompare(right.name, "es"),
      ),
    ];
  }, [state.restaurants]);
  const activeFoodPromotion = useMemo(
    () =>
      state.promotions?.find((promotion) => promotion.active && promotion.service === "food") ||
      null,
    [state.promotions],
  );
  const foodPromotionValue = activeFoodPromotion
    ? activeFoodPromotion.kind === "free_delivery"
      ? "Envío bonificado"
      : activeFoodPromotion.kind === "fixed"
        ? `${money.format(activeFoodPromotion.value || 0)} menos`
        : activeFoodPromotion.kind === "wallet_credit"
          ? `${money.format(activeFoodPromotion.value || 0)} en Wallet`
          : `${activeFoodPromotion.discountPercent || activeFoodPromotion.value || 0}% menos`
    : "";
  const [dietaryPreferences, setDietaryPreferences] = useState<DietaryPreferences>({
    dietaryLabels: [],
    avoidedAllergens: [],
    hideIncompatible: false,
  });
  const itemMatchesDiet = (item: Restaurant["menu"][number]) => {
    const itemDiets = new Set((item.dietaryLabels || []).map((entry) => entry.code)),
      itemAllergens = new Set((item.allergens || []).map((entry) => entry.code));
    return (
      dietaryPreferences.dietaryLabels.every((entry) => itemDiets.has(entry.code)) &&
      !dietaryPreferences.avoidedAllergens.some((entry) => itemAllergens.has(entry.code))
    );
  };
  const openRestaurants = state.restaurants.filter(
    (restaurant) =>
      restaurant.open &&
      (foodCategory === "Todos" ||
        restaurant.cuisine.toLowerCase().includes(foodCategory.toLowerCase())) &&
      (!dietaryPreferences.hideIncompatible ||
        restaurant.menu.some((item) => item.stock && itemMatchesDiet(item))) &&
      (!foodQuery.trim() ||
        `${restaurant.name} ${restaurant.cuisine} ${restaurant.menu.map((item) => item.name).join(" ")}`
          .toLowerCase()
          .includes(foodQuery.trim().toLowerCase())),
  );
  const favoriteRestaurants = openRestaurants.filter((restaurant) =>
    favoriteRestaurantIds.includes(restaurant.id),
  );
  const [cart, setCart] = useState<MobileCartLine[]>([]);
  const [lastCreatedOrder, setLastCreatedOrder] = useState<Order | null>(null);
  const [cartHydrated, setCartHydrated] = useState(false);
  const [customizingItem, setCustomizingItem] = useState<Restaurant["menu"][number] | null>(null);
  const [customizingRestaurant, setCustomizingRestaurant] = useState<Restaurant | null>(null);
  const [customizingExtras, setCustomizingExtras] = useState<string[]>([]);
  const [customizingNote, setCustomizingNote] = useState("");
  const toggleFavorite = async (restaurantId: string) => {
    if (favoritePendingId) return;
    const favorite = !favoriteRestaurantIds.includes(restaurantId);
    setFavoritePendingId(restaurantId);
    try {
      const result = await api.setFavorite(restaurantId, favorite);
      setFavoriteRestaurantIds(result.restaurantIds);
    } catch (error) {
      Alert.alert(
        "No pudimos actualizar favoritos",
        error instanceof Error ? error.message : "Intentá nuevamente.",
      );
    } finally {
      setFavoritePendingId(null);
    }
  };
  useEffect(() => {
    let cancelled = false;
    setCartHydrated(false);
    void api
      .cart()
      .then((result) => {
        if (cancelled) return;
        setCart(
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
        setCartHydrated(true);
      })
      .catch(() => {
        if (!cancelled) setCartHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user.id]);
  useEffect(() => {
    if (!cartHydrated) return;
    const timer = setTimeout(() => {
      void api
        .saveMobileCart(
          cart[0]?.restaurantId,
          cart.map((line) => ({
            menuItemId: line.menuItemId,
            quantity: line.quantity,
            extras: line.extras,
            note: line.note,
          })),
        )
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [cart, cartHydrated]);
  useEffect(() => {
    if (sharedView !== "activity") return;
    const key = `${user.id}:${customerWindow}`;
    if (lastActivityAnalyticsKey.current === key) return;
    lastActivityAnalyticsKey.current = key;
    track("activity_viewed", "customer_app", { service: customerWindow });
  }, [customerWindow, sharedView, user.id]);
  useEffect(() => {
    const trimmedQuery = foodQuery.trim();
    if (trimmedQuery && !previousFoodQuery.current.trim()) {
      track("search_started", "customer_app", { service: "food" });
    }
    previousFoodQuery.current = foodQuery;
  }, [foodQuery]);
  useEffect(() => {
    if (selectedRestaurantId) {
      track("merchant_viewed", "customer_app", { merchant_id: selectedRestaurantId });
    }
  }, [selectedRestaurantId]);
  useEffect(() => {
    if (!cartHydrated) return;
    const itemCount = cart.reduce((total, line) => total + line.quantity, 0);
    if (previousCartCount.current !== null && previousCartCount.current !== itemCount) {
      track("cart_updated", "customer_app", { item_count: itemCount });
    }
    previousCartCount.current = itemCount;
  }, [cart, cartHydrated]);
  useEffect(() => {
    if (foodScreen === "checkout") track("checkout_started", "customer_app", { service: "food" });
  }, [foodScreen]);
  const [deliveryAddress, setDeliveryAddress] = useState(user.defaultAddress || "");
  const [foodPromotionCode, setFoodPromotionCode] = useState("");
  const [foodCheckoutQuote, setFoodCheckoutQuote] = useState<FoodCheckoutQuote | null>(null);
  // Propina del checkout (GTM-001). En centavos, como viaja a la API.
  const [foodTipCents, setFoodTipCents] = useState(0);
  // Reserva de horario (GTM-001). `null` es «lo antes posible».
  const [foodScheduledFor, setFoodScheduledFor] = useState<string | null>(null);
  // Grupo que se está por confirmar (GTM-001).
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);
  const [selectedFoodPaymentId, setSelectedFoodPaymentId] = useState(
    () =>
      state.paymentMethods.find((method) => method.userId === user.id && method.isDefault)?.id ||
      state.paymentMethods.find((method) => method.userId === user.id)?.id ||
      "",
  );
  const [newAddressLabel, setNewAddressLabel] = useState("Casa");
  const [newAddressText, setNewAddressText] = useState("");
  const [paymentToken, setPaymentToken] = useState("");
  const [paymentBrand, setPaymentBrand] = useState<"visa" | "mastercard" | "amex" | "cabal">(
    "visa",
  );
  const [paymentLast4, setPaymentLast4] = useState("");
  const [paymentExpiry, setPaymentExpiry] = useState("");
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [accountSessions, setAccountSessions] = useState<import("../types").AccountSession[]>([]);
  const [phoneVerificationCode, setPhoneVerificationCode] = useState("");
  const [phoneVerified, setPhoneVerified] = useState(Boolean(user.phoneVerifiedAt));
  const [phoneRetrySeconds, setPhoneRetrySeconds] = useState(0);
  const [referral, setReferral] = useState<import("../types").ReferralSummary | null>(null);
  const [referralClaim, setReferralClaim] = useState("");
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreference[]>(
    [],
  );
  const [supportSubject, setSupportSubject] = useState("");
  const [supportBody, setSupportBody] = useState("");
  const [supportCategory, setSupportCategory] = useState<
    "food" | "ride" | "shipment" | "payment" | "account" | "safety" | "other"
  >("food");
  const [supportReplies, setSupportReplies] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    api
      .getDietaryPreferences()
      .then((result) => {
        if (!cancelled) setDietaryPreferences(result.preferences);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user.id]);
  useEffect(() => {
    if (foodScreen !== "search") return;
    let cancelled = false;
    setCatalogSearchLoading(true);
    setCatalogSearchError("");
    const timer = setTimeout(() => {
      void api
        .searchCatalog(foodQuery, 0)
        .then((result) => {
          if (!cancelled) {
            setCatalogResults(result.results);
            setCatalogNextOffset(result.nextOffset);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setCatalogResults([]);
            setCatalogSearchError(error instanceof Error ? error.message : "No se pudo buscar");
          }
        })
        .finally(() => {
          if (!cancelled) setCatalogSearchLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    foodScreen,
    foodQuery,
    catalogSearchNonce,
    dietaryPreferences.hideIncompatible,
    dietaryPreferences.dietaryLabels,
    dietaryPreferences.avoidedAllergens,
  ]);
  useEffect(() => {
    if (sharedView !== "account") return;
    let cancelled = false;
    Promise.all([
      api.getNotifications(),
      api.getNotificationPreferences(),
      api.getDietaryPreferences(),
      api.getReferralSummary(),
      api.getAccountSessions(),
    ])
      .then(([inbox, settings, dietary, referrals, sessions]) => {
        if (!cancelled) {
          setNotifications(inbox.notifications);
          setNotificationPreferences(settings.preferences);
          setDietaryPreferences(dietary.preferences);
          setReferral(referrals.referral);
          setAccountSessions(sessions.sessions);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sharedView]);
  useEffect(() => {
    if (phoneRetrySeconds <= 0) return;
    const timer = setInterval(() => setPhoneRetrySeconds((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [phoneRetrySeconds > 0]);
  const [pickup, setPickup] = useState(user.defaultAddress || "Ubicacion actual");
  const [destination, setDestination] = useState("");
  const [pickupCoords, setPickupCoords] = useState<GeoPoint | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<GeoPoint | null>(null);
  const [roadRoute, setRoadRoute] = useState<RoadRoute | null>(null);
  const [activeRoadStep, setActiveRoadStep] = useState(0);
  const [rideService, setRideService] = useState<RideService>("economy");
  const [rideQuote, setRideQuote] = useState<RideQuote | null>(null);
  const [rideOptions, setRideOptions] = useState<RideQuote[]>([]);
  const [rideDestinations, setRideDestinations] = useState<RideDestination[]>([]);
  const [rideTrustedContacts, setRideTrustedContacts] = useState<RideTrustedContact[]>([]),
    [trustedContactName, setTrustedContactName] = useState(""),
    [trustedContactPhone, setTrustedContactPhone] = useState(""),
    [trustedContactRelationship, setTrustedContactRelationship] =
      useState<RideTrustedContact["relationship"]>("family");
  useEffect(() => {
    let cancelled = false;
    void api
      .getRideDestinations()
      .then((result) => {
        if (!cancelled) setRideDestinations(result.destinations);
      })
      .catch(() => {
        if (!cancelled) setRideDestinations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user.id]);
  useEffect(() => {
    let cancelled = false;
    void api
      .getRideTrustedContacts()
      .then((result) => {
        if (!cancelled) setRideTrustedContacts(result.contacts);
      })
      .catch(() => {
        if (!cancelled) setRideTrustedContacts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user.id]);
  const rideQuickPlaces = useMemo(() => {
    const saved = state.addresses
        .filter((item) => item.userId === user.id && item.lat !== null && item.lng !== null)
        .map((item) => ({
          id: `saved-${item.id}`,
          icon: item.label.toLowerCase().includes("trab") ? "briefcase" : "home",
          label: item.label,
          address: item.address,
          point: { lat: item.lat!, lng: item.lng! },
          recentId: null as string | null,
        })),
      savedKeys = new Set(saved.map((item) => item.address.trim().toLowerCase())),
      recent = rideDestinations
        .filter((item) => !savedKeys.has(item.address.trim().toLowerCase()))
        .map((item) => ({
          id: `recent-${item.id}`,
          icon: "time",
          label: item.label,
          address: item.address,
          point: item.point,
          recentId: item.id,
        }));
    return [...saved, ...recent].slice(0, 8);
  }, [state.addresses, user.id, rideDestinations]);
  const [rideSchedule, setRideSchedule] = useState<"now" | "hour" | "tomorrow">("now");
  const [locationMessage, setLocationMessage] = useState("");
  const [shipmentPickup, setShipmentPickup] = useState(user.defaultAddress || "");
  const [shipmentDestination, setShipmentDestination] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [packageDescription, setPackageDescription] = useState("");
  const [packageSize, setPackageSize] = useState<"small" | "medium" | "large">("small");
  const [packageWeight, setPackageWeight] = useState("1");
  const [declaredValue, setDeclaredValue] = useState("0"),
    [shipmentProtection, setShipmentProtection] = useState<"none" | "standard">("none"),
    [shipmentSignatureRequired, setShipmentSignatureRequired] = useState(false),
    [shipmentItemCategory, setShipmentItemCategory] =
      useState<NonNullable<Shipment["itemCategory"]>>("standard"),
    [shipmentServiceLevel, setShipmentServiceLevel] =
      useState<NonNullable<Shipment["serviceLevel"]>>("standard"),
    [shipmentPickupCoords, setShipmentPickupCoords] = useState<GeoPoint | null>(null),
    [shipmentDestinationCoords, setShipmentDestinationCoords] = useState<GeoPoint | null>(null),
    [shipmentRoadRoute, setShipmentRoadRoute] = useState<RoadRoute | null>(null);
  const defaultLocationSeededForUser = useRef("");
  useEffect(() => {
    if (defaultLocationSeededForUser.current === user.id) return;
    const locatedAddresses = state.addresses.filter(
      (item) => item.userId === user.id && item.lat !== null && item.lng !== null,
    );
    const normalizedDefaultAddress = user.defaultAddress?.trim().toLowerCase();
    const primaryAddress =
      locatedAddresses.find((item) => item.isDefault) ||
      locatedAddresses.find(
        (item) =>
          normalizedDefaultAddress &&
          item.address.trim().toLowerCase() === normalizedDefaultAddress,
      );
    if (!primaryAddress) return;
    defaultLocationSeededForUser.current = user.id;
    const point = { lat: primaryAddress.lat!, lng: primaryAddress.lng! };
    if (
      !pickupCoords &&
      (!pickup.trim() || pickup === user.defaultAddress || pickup === "Ubicacion actual")
    ) {
      setPickup(primaryAddress.address);
      setPickupCoords(point);
    }
    if (
      !shipmentPickupCoords &&
      (!shipmentPickup.trim() || shipmentPickup === user.defaultAddress)
    ) {
      setShipmentPickup(primaryAddress.address);
      setShipmentPickupCoords(point);
    }
  }, [
    pickup,
    pickupCoords,
    shipmentPickup,
    shipmentPickupCoords,
    state.addresses,
    user.defaultAddress,
    user.id,
  ]);
  const [shipmentQuote, setShipmentQuote] = useState<ShipmentQuote | null>(null);
  const [shipmentOptions, setShipmentOptions] = useState<ShipmentOptions | null>(null),
    [shipmentOptionsError, setShipmentOptionsError] = useState("");
  useEffect(() => {
    if (customerWindow !== "shipment") return;
    let cancelled = false;
    setShipmentOptionsError("");
    void api
      .getShipmentOptions()
      .then((options) => {
        if (cancelled) return;
        setShipmentOptions(options);
        if (
          !options.categories.some((option) => option.code === shipmentItemCategory) &&
          options.categories[0]
        )
          setShipmentItemCategory(options.categories[0].code);
        if (
          !options.serviceLevels.some((option) => option.code === shipmentServiceLevel) &&
          options.serviceLevels[0]
        )
          setShipmentServiceLevel(options.serviceLevels[0].code);
      })
      .catch((error) => {
        if (!cancelled)
          setShipmentOptionsError(
            error instanceof Error ? error.message : "No se pudieron cargar las opciones",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [customerWindow]);
  const [shipmentCodes, setShipmentCodes] = useState<Record<string, string>>({});
  const [ridePickupCodes, setRidePickupCodes] = useState<Record<string, string>>({});
  const [receipts, setReceipts] = useState<Record<string, ServiceReceipt>>({});
  const [shipmentReturns, setShipmentReturns] = useState<ShipmentReturn[]>([]),
    [returnShipmentId, setReturnShipmentId] = useState<string | null>(null),
    [returnReason, setReturnReason] = useState("");
  const [shipmentClaims, setShipmentClaims] = useState<ShipmentClaim[]>([]),
    [claimShipmentId, setClaimShipmentId] = useState<string | null>(null),
    [claimType, setClaimType] = useState<ShipmentClaim["claimType"]>("damaged"),
    [claimDescription, setClaimDescription] = useState(""),
    [claimAmount, setClaimAmount] = useState("");
  useEffect(() => {
    if (sharedView !== "activity") return;
    let cancelled = false;
    void api
      .getShipmentReturns()
      .then((result) => {
        if (!cancelled) setShipmentReturns(result.returns);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sharedView]);
  useEffect(() => {
    if (sharedView !== "activity") return;
    let cancelled = false;
    void api
      .getShipmentClaims()
      .then((result) => {
        if (!cancelled) setShipmentClaims(result.claims);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sharedView]);
  const attachClaimEvidence = async (claimId: string) => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["image/jpeg", "image/png", "application/pdf"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0],
      mimeType = asset.mimeType as "image/jpeg" | "image/png" | "application/pdf";
    if (!["image/jpeg", "image/png", "application/pdf"].includes(mimeType)) {
      Alert.alert("Formato no permitido", "Elegí una foto JPEG/PNG o un PDF.");
      return;
    }
    if (!asset.size || asset.size > 768000) {
      Alert.alert("Archivo demasiado grande", "La evidencia debe pesar hasta 750 KB.");
      return;
    }
    const contentBase64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      }),
      uploaded = (
        await api.addShipmentClaimEvidence(claimId, {
          fileName: asset.name || "evidencia",
          mimeType,
          contentBase64,
        })
      ).evidence;
    setShipmentClaims((current) =>
      current.map((claim) =>
        claim.id === claimId
          ? { ...claim, evidence: [...(claim.evidence || []), uploaded] }
          : claim,
      ),
    );
  };
  const openClaimEvidence = async (id: string) => {
    const result = await api.getShipmentClaimEvidenceContent(id),
      safe = result.evidence.fileName.replace(/[^a-zA-Z0-9._-]/g, "_") || "evidencia",
      uri = `${FileSystem.cacheDirectory}${id}-${safe}`;
    await FileSystem.writeAsStringAsync(uri, result.contentBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (await Sharing.isAvailableAsync())
      await Sharing.shareAsync(uri, {
        mimeType: result.evidence.mimeType,
        dialogTitle: "Abrir evidencia cifrada",
      });
    else Alert.alert("Flash", "El dispositivo no permite abrir este archivo.");
  };
  const [issueOrderId, setIssueOrderId] = useState<string | null>(null);
  const [issueCategory, setIssueCategory] = useState<
    "missing_item" | "wrong_item" | "damaged_item" | "quality" | "late" | "other"
  >("missing_item");
  const [issueDescription, setIssueDescription] = useState("");
  const [issueRefund, setIssueRefund] = useState("");
  const [trackingOrderId, setTrackingOrderId] = useState<string | null>(null);
  const [trackingRideId, setTrackingRideId] = useState<string | null>(null);
  const [trackingShipmentId, setTrackingShipmentId] = useState<string | null>(null);
  const [chatJobId, setChatJobId] = useState<string | null>(null);
  const [activityItems, setActivityItems] = useState<Array<{
      id: string;
      kind: "order" | "ride" | "shipment";
      createdAt: string;
      resource: Order | Ride | Shipment;
    }> | null>(null),
    [activityCursor, setActivityCursor] = useState<string | null>(null),
    [activityLoading, setActivityLoading] = useState(false);
  const loadActivity = useCallback(
    async (append = false) => {
      if (activityLoading) return;
      setActivityLoading(true);
      try {
        const result = await api.getActivity(append ? activityCursor || undefined : undefined, 20);
        setActivityItems((current) =>
          append && current ? [...current, ...result.items] : result.items,
        );
        setActivityCursor(result.nextCursor);
      } finally {
        setActivityLoading(false);
      }
    },
    [activityCursor, activityLoading],
  );
  useEffect(() => {
    if (sharedView === "activity") void loadActivity(false);
  }, [sharedView, user.id]);
  useEffect(() => {
    if (!trackingRideId) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [trackingRideId, refresh]);
  const activityOrders =
    activityItems?.filter((item) => item.kind === "order").map((item) => item.resource as Order) ||
    state.orders;
  const activityRides =
    activityItems?.filter((item) => item.kind === "ride").map((item) => item.resource as Ride) ||
    state.rides;
  const activityShipments =
    activityItems
      ?.filter((item) => item.kind === "shipment")
      .map((item) => item.resource as Shipment) || state.shipments;
  const activeOrders = activityOrders.filter(
    (order) => order.customerId === user.id && !["delivered", "cancelled"].includes(order.status),
  );
  const activeRides = activityRides.filter(
    (ride) => ride.customerId === user.id && !["completed", "cancelled"].includes(ride.status),
  );
  const activeShipments = activityShipments.filter(
    (shipment) =>
      shipment.customerId === user.id && !["delivered", "cancelled"].includes(shipment.status),
  );
  const [orderSubstitutions, setOrderSubstitutions] = useState<OrderSubstitution[]>([]);
  const activeOrderIds = activeOrders.map((order) => order.id).join(",");
  useEffect(() => {
    let cancelled = false;
    if (sharedView !== "activity" || !activeOrderIds) {
      setOrderSubstitutions([]);
      return;
    }
    void Promise.all(activeOrders.map((order) => api.getOrderSubstitutions(order.id)))
      .then((results) => {
        if (!cancelled) setOrderSubstitutions(results.flatMap((result) => result.substitutions));
      })
      .catch(() => {
        if (!cancelled) setOrderSubstitutions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sharedView, activeOrderIds]);
  const pendingSubstitutions = orderSubstitutions.filter((entry) => entry.status === "pending");
  const completedForTips = [
    ...activityOrders
      .filter(
        (order) => order.customerId === user.id && order.status === "delivered" && order.courierId,
      )
      .map((order) => ({
        id: order.id,
        kind: "order" as const,
        label: `Pedido ${order.id}`,
        amount: order.total,
      })),
    ...activityRides
      .filter((ride) => ride.customerId === user.id && ride.status === "completed" && ride.driverId)
      .map((ride) => ({
        id: ride.id,
        kind: "ride" as const,
        label: `Viaje ${ride.pickup} → ${ride.destination}`,
        amount: ride.fare,
      })),
    ...activityShipments
      .filter(
        (shipment) =>
          shipment.customerId === user.id && shipment.status === "delivered" && shipment.driverId,
      )
      .map((shipment) => ({
        id: shipment.id,
        kind: "shipment" as const,
        label: `Envío a ${shipment.destination}`,
        amount: shipment.fare,
      })),
  ].slice(0, 5);
  const recentCancellations = [
    ...state.orders
      .filter((order) => order.customerId === user.id && order.cancellation)
      .map((order) => ({
        label: "Pedido cancelado",
        ...order.cancellation!,
      })),
    ...state.rides
      .filter((ride) => ride.customerId === user.id && ride.cancellation)
      .map((ride) => ({
        label: "Viaje cancelado",
        ...ride.cancellation!,
      })),
    ...state.shipments
      .filter((shipment) => shipment.customerId === user.id && shipment.cancellation)
      .map((shipment) => ({
        label: "Envío cancelado",
        ...shipment.cancellation!,
      })),
  ]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 5);
  const cancelService = (kind: "order" | "ride" | "shipment", id: string) =>
    Alert.alert("¿Por qué cancelás?", "El motivo y el reintegro quedarán registrados.", [
      {
        text: "Demora",
        onPress: () =>
          runAction(
            () =>
              kind === "order"
                ? api.setOrderStatus(id, "cancelled", "long_wait")
                : kind === "ride"
                  ? api.setRideStatus(id, "cancelled", "long_wait")
                  : api.setShipmentStatus(id, "cancelled", "long_wait"),
            "Servicio cancelado",
          ),
      },
      {
        text: kind === "shipment" ? "Destinatario no disponible" : "Cambié de idea",
        onPress: () =>
          runAction(
            () =>
              kind === "order"
                ? api.setOrderStatus(id, "cancelled", "changed_mind")
                : kind === "ride"
                  ? api.setRideStatus(id, "cancelled", "changed_mind")
                  : api.setShipmentStatus(id, "cancelled", "recipient_unavailable"),
            "Servicio cancelado",
          ),
      },
      { text: "Volver", style: "cancel" },
    ]);
  const addItem = (
    restaurant: Restaurant,
    item: Restaurant["menu"][number],
    extras: string[] = [],
    note = "",
  ) => {
    if (!item.stock || !restaurant.open) return;
    if (cart.length > 0 && cart[0].restaurantId !== restaurant.id) {
      Alert.alert(
        "Carrito de un comercio",
        "Finaliza o vacia el carrito antes de pedir en otro local.",
      );
      return;
    }
    const lineId = `${item.id}:${extras.slice().sort().join(",")}:${note.trim()}`,
      modifierPrice = (item.modifierGroups || [])
        .flatMap((group) => group.modifiers)
        .filter((modifier) => extras.includes(modifier.id))
        .reduce((sum, modifier) => sum + modifier.price, 0);
    setCart((current) => {
      const existing = current.find((line) => line.lineId === lineId);
      if (existing) {
        return current.map((line) =>
          line.lineId === lineId ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [
        ...current,
        {
          lineId,
          restaurantId: restaurant.id,
          menuItemId: item.id,
          name: item.name,
          unitPrice: item.price + modifierPrice,
          quantity: 1,
          extras,
          note: note.trim(),
        },
      ];
    });
  };

  const cartTotal = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const cartRestaurant = state.restaurants.find(
    (restaurant) => restaurant.id === cart[0]?.restaurantId,
  );
  const customerPaymentMethods = state.paymentMethods.filter((method) => method.userId === user.id);
  const selectedFoodPayment =
    customerPaymentMethods.find((method) => method.id === selectedFoodPaymentId) ||
    customerPaymentMethods.find((method) => method.isDefault) ||
    customerPaymentMethods[0];
  const selectedRestaurant =
    state.restaurants.find((restaurant) => restaurant.id === selectedRestaurantId) || null;
  const foodMenuCategories = useMemo(
    () => [
      "Todos",
      ...Array.from(
        new Set((selectedRestaurant?.menu || []).map((item) => item.category?.trim() || "Otros")),
      ),
    ],
    [selectedRestaurant],
  );
  useEffect(() => setFoodMenuCategory("Todos"), [selectedRestaurantId]);
  const visibleFoodMenuItems = (selectedRestaurant?.menu || []).filter(
    (item) =>
      (foodMenuCategory === "Todos" || (item.category?.trim() || "Otros") === foodMenuCategory) &&
      (!dietaryPreferences.hideIncompatible || itemMatchesDiet(item)),
  );
  const customizingModifierTotal = (customizingItem?.modifierGroups || [])
    .flatMap((group) => group.modifiers)
    .filter((modifier) => customizingExtras.includes(modifier.id))
    .reduce((sum, modifier) => sum + modifier.price, 0);
  const customizingTotal = (customizingItem?.price || 0) + customizingModifierTotal;
  const customizingSelectionValid = !customizingItem?.modifierGroups?.some(
    (group) =>
      customizingExtras.filter((id) => group.modifiers.some((modifier) => modifier.id === id))
        .length < group.min,
  );

  const changeCartQuantity = (lineId: string, delta: number) => {
    setCart((current) =>
      current
        .map((line) =>
          line.lineId === lineId ? { ...line, quantity: line.quantity + delta } : line,
        )
        .filter((line) => line.quantity > 0),
    );
  };

  const shareStatus = (title: string, message: string) => {
    void Share.share({ title, message });
  };

  const shareRideLive = (ride: Ride, contact?: RideTrustedContact) =>
    runAction(
      async () => {
        const { link } = await api.createRideTrackingLink(ride.id);
        // El saludo cambia según haya o no un contacto de confianza elegido, y el
        // vencimiento va dentro del mensaje: un enlace de seguimiento que no dice
        // cuándo caduca invita a reenviarlo cuando ya no sirve.
        const saludo = contact ? `${contact.name}, s` : "S";
        const vence = new Date(link.expiresAt).toLocaleString("es-AR");
        await Share.share({
          title: "Seguimiento de mi viaje Flash",
          message:
            `${saludo}eguí mi viaje en tiempo real hasta ${ride.destination}: ` +
            `${link.trackingUrl}\nEl enlace vence ${vence}.`,
        });
      },
      contact ? `Enlace seguro listo para ${contact.name}` : "Enlace seguro creado",
    );

  const confirmRideSos = (ride: Ride) => {
    Alert.alert(
      "Activar Seguridad Flash",
      "Se enviará una alerta urgente vinculada al viaje y tu ubicación actual al equipo de operaciones.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Enviar SOS",
          style: "destructive",
          onPress: () =>
            runAction(async () => {
              let location: GeoPoint | undefined;
              try {
                const permission = await Location.requestForegroundPermissionsAsync();
                if (permission.status === "granted") {
                  const current = await Location.getCurrentPositionAsync({
                    accuracy: Location.Accuracy.High,
                  });
                  location = { lat: current.coords.latitude, lng: current.coords.longitude };
                }
              } catch (_error) {
                // La alerta se envía igualmente; ubicación es evidencia opcional.
              }
              await api.createRideSafetyIncident(ride.id, { type: "sos", location });
            }, "SOS enviado a Seguridad Flash"),
        },
      ],
    );
  };

  const selectedFoodAddress = state.addresses.find(
    (item) =>
      item.userId === user.id &&
      !item.id.startsWith("profile-") &&
      item.address === deliveryAddress.trim() &&
      item.lat !== null &&
      item.lng !== null,
  );
  const foodCheckoutItems = cart.map((line) => ({
    menuItemId: line.menuItemId,
    quantity: line.quantity,
    extras: line.extras,
    note: line.note,
  }));

  const openFoodCheckout = () => {
    if (!cart.length || !cartRestaurant || !selectedFoodAddress || !selectedFoodPayment) {
      Alert.alert(
        "Checkout incompleto",
        "Seleccioná una dirección geocodificada y un método de pago.",
      );
      return;
    }
    runAction(async () => {
      const result = await api.quoteFoodCheckout({
        customerId: user.id,
        restaurantId: cartRestaurant.id,
        deliveryAddressId: selectedFoodAddress.id,
        branchId: cartRestaurant.branches?.find((branch) => branch.isPrimary)?.id,
        paymentMethod: selectedFoodPayment.label,
        paymentMethodId: selectedFoodPayment.id,
        promotionCode: foodPromotionCode.trim().toUpperCase() || undefined,
        items: foodCheckoutItems,
      });
      setFoodCheckoutQuote(result.quote);
      setFoodScreen("checkout");
    }, "Precio final actualizado");
  };

  /**
   * Lleva un grupo cerrado al checkout de siempre.
   *
   * Se vuelcan sus ítems en el carrito y se abre el checkout normal, en vez de
   * tener un camino propio: un segundo checkout serían dos versiones de la
   * cotización firmada, la propina, el horario y el riesgo.
   */
  const checkoutGroupOrder = (group: GroupOrderType) =>
    runAction(async () => {
      const checkout = await api.getGroupOrderCheckout(group.id);
      const restaurante = state.restaurants.find((entry) => entry.id === checkout.merchantPublicId);
      if (!restaurante) throw new Error("El restaurante del grupo ya no está disponible");
      const lineas: MobileCartLine[] = checkout.items.map((entrada, indice) => {
        const item = restaurante.menu.find((plato) => plato.id === entrada.menuItemId);
        if (!item) throw new Error("Un producto del grupo ya no está disponible");
        return {
          lineId: `${group.id}-${indice}`,
          restaurantId: restaurante.id,
          menuItemId: item.id,
          name: item.name,
          unitPrice: item.price,
          quantity: entrada.quantity,
          extras: entrada.extras,
          note: entrada.note,
        };
      });
      setCart(lineas);
      // Se recuerda para atarlo al pedido **después** de que el pedido exista:
      // marcarlo antes dejaría grupos «confirmados» apuntando a pedidos que
      // nunca se crearon.
      setPendingGroupId(group.id);
      setSharedView("service");
      setFoodScreen("checkout");
    }, "Revisá el pedido del grupo y confirmá");

  const createOrder = () => {
    const selectedDeliveryAddress = state.addresses.find(
      (item) =>
        item.userId === user.id &&
        !item.id.startsWith("profile-") &&
        item.address === deliveryAddress.trim() &&
        item.lat !== null &&
        item.lng !== null,
    );
    if (
      !cart.length ||
      !cartRestaurant ||
      !deliveryAddress.trim() ||
      !selectedDeliveryAddress ||
      !selectedFoodPayment ||
      !foodCheckoutQuote
    ) {
      Alert.alert(
        "Pedido incompleto",
        "Selecciona productos y una dirección guardada con coordenadas reales.",
      );
      return;
    }
    runAction(async () => {
      const result = await api.createOrder({
        customerId: user.id,
        restaurantId: cartRestaurant.id,
        deliveryAddressId: selectedDeliveryAddress.id,
        deliveryAddress: deliveryAddress.trim(),
        paymentMethod: selectedFoodPayment.label,
        paymentMethodId: selectedFoodPayment.id,
        promotionCode: foodCheckoutQuote.promotionCode || undefined,
        quoteToken: foodCheckoutQuote.quoteToken,
        tipCents: foodTipCents,
        scheduledFor: foodScheduledFor ?? undefined,
        items: foodCheckoutItems,
      });
      // El grupo se marca con el pedido ya creado. Si esto fallara, el pedido
      // igual existe y el grupo queda cerrado sin atar — el lado seguro de
      // fallar: se cobró una vez y hay un pedido real detrás.
      if (pendingGroupId) {
        await api.markGroupOrderPlaced(pendingGroupId, result.order.id);
        setPendingGroupId(null);
      }
      setLastCreatedOrder(result.order);
      setCart([]);
      setFoodCheckoutQuote(null);
      setFoodPromotionCode("");
      // Sin esto la próxima compra arrancaría con la propina de la anterior ya
      // elegida, que es cobrar sin preguntar; y con el horario de la anterior,
      // que es reservar sin preguntar.
      setFoodTipCents(0);
      setFoodScheduledFor(null);
      setFoodScreen("orders");
      track("job_created", "customer_app", { service: "food" });
    }, "Pedido enviado al comercio");
  };

  const useCurrentLocation = async () => {
    setLocationMessage("Solicitando ubicacion...");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setLocationMessage("Permiso de ubicacion rechazado");
        return;
      }
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setPickup("Ubicacion actual");
      setPickupCoords({
        lat: current.coords.latitude,
        lng: current.coords.longitude,
      });
      setLocationMessage("Origen tomado desde el GPS del dispositivo");
    } catch (_error) {
      setLocationMessage("No se pudo obtener la ubicacion");
    }
  };

  const quoteRide = () => {
    if (!pickup.trim() || !destination.trim()) {
      Alert.alert("Viaje incompleto", "Indica origen y destino para cotizar.");
      return;
    }
    runAction(async () => {
      let resolvedPickup = pickupCoords;
      if (!resolvedPickup) {
        const originResult = await api.geocode(pickup.trim());
        resolvedPickup = originResult.results[0]?.point || null;
      }
      let destinationMatch: { label: string; point: GeoPoint; type: string } | undefined,
        resolvedDestination = destinationCoords;
      if (!resolvedDestination) {
        const destinationResult = await api.geocode(destination.trim());
        destinationMatch = destinationResult.results[0];
        resolvedDestination = destinationMatch?.point || null;
      }
      if (!resolvedPickup || !resolvedDestination)
        throw new Error("No pudimos ubicar una de las direcciones en el mapa");
      const routed = await api.route(resolvedPickup, resolvedDestination);
      setPickupCoords(resolvedPickup);
      setDestinationCoords(resolvedDestination);
      setRoadRoute(routed.route);
      setActiveRoadStep(0);
      const response = await api.quoteRideOptions({
        pickup: pickup.trim(),
        destination: destination.trim(),
        pickupCoords: resolvedPickup,
        destinationCoords: resolvedDestination,
      });
      setRideOptions(response.options);
      setRideQuote(
        response.options.find((option) => option.service === rideService) || response.options[0],
      );
      track("quote_received", "customer_app", { service: "ride" });
      const recorded = await api
        .recordRideDestination({
          label: (destinationMatch?.label || destination.trim()).split(",")[0],
          address: destinationMatch?.label || destination.trim(),
          lat: resolvedDestination.lat,
          lng: resolvedDestination.lng,
        })
        .catch(() => null);
      if (recorded) setRideDestinations(recorded.destinations);
    }, "Cotizacion actualizada");
  };

  const requestRide = () => {
    if (!rideQuote?.quoteToken) {
      Alert.alert("Cotiza primero", "La tarifa debe confirmarse antes de solicitar el viaje.");
      return;
    }
    const quoteToken = rideQuote.quoteToken;
    const scheduledFor =
      rideSchedule === "hour"
        ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
        : rideSchedule === "tomorrow"
          ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          : undefined;
    runAction(
      async () => {
        await api.createRide({
          customerId: user.id,
          pickup: pickup.trim(),
          destination: destination.trim(),
          service: rideService,
          pickupCoords,
          destinationCoords,
          paymentMethod: "Flash Wallet",
          quoteToken,
          scheduledFor,
        });
        track("job_created", "customer_app", { service: "ride" });
      },
      scheduledFor ? "Viaje reservado" : "Viaje solicitado",
    );
  };

  const quoteShipment = () => {
    if (!shipmentPickup.trim() || !shipmentDestination.trim() || Number(packageWeight) <= 0) {
      Alert.alert("Envio incompleto", "Confirma direcciones y peso del paquete.");
      return;
    }
    runAction(async () => {
      const [pickupResult, destinationResult] = await Promise.all([
        api.geocode(shipmentPickup.trim()),
        api.geocode(shipmentDestination.trim()),
      ]);
      const pickupPoint = pickupResult.results[0]?.point,
        destinationPoint = destinationResult.results[0]?.point;
      if (!pickupPoint || !destinationPoint)
        throw new Error("No pudimos ubicar una de las direcciones");
      setShipmentPickupCoords(pickupPoint);
      setShipmentDestinationCoords(destinationPoint);
      const [response, routed] = await Promise.all([
        api.quoteShipment({
          pickup: shipmentPickup.trim(),
          destination: shipmentDestination.trim(),
          packageSize,
          weightKg: Number(packageWeight),
          declaredValue: Number(declaredValue) || 0,
          protection: shipmentProtection,
          signatureRequired: shipmentSignatureRequired,
          itemCategory: shipmentItemCategory,
          serviceLevel: shipmentServiceLevel,
          pickupCoords: pickupPoint,
          destinationCoords: destinationPoint,
        }),
        api.route(pickupPoint, destinationPoint).catch(() => null),
      ]);
      setShipmentRoadRoute(routed?.route || null);
      setShipmentQuote(response.quote);
      track("quote_received", "customer_app", { service: "shipment" });
    }, "Envio cotizado");
  };

  const createShipment = () => {
    if (
      !shipmentQuote ||
      !recipientName.trim() ||
      !recipientPhone.trim() ||
      !packageDescription.trim()
    ) {
      Alert.alert(
        "Envio incompleto",
        "Cotiza e ingresa destinatario, telefono y contenido general.",
      );
      return;
    }
    runAction(async () => {
      await api.createShipment({
        customerId: user.id,
        pickup: shipmentPickup.trim(),
        destination: shipmentDestination.trim(),
        recipientName: recipientName.trim(),
        recipientPhone: recipientPhone.trim(),
        packageSize,
        description: packageDescription.trim(),
        weightKg: Number(packageWeight),
        declaredValue: Number(declaredValue) || 0,
        protection: shipmentProtection,
        signatureRequired: shipmentSignatureRequired,
        itemCategory: shipmentItemCategory,
        serviceLevel: shipmentServiceLevel,
        deliveryNotes: "Entregar en mano",
        paymentMethod: "Flash Wallet",
        termsAccepted: true,
        pickupCoords: shipmentPickupCoords,
        destinationCoords: shipmentDestinationCoords,
        quoteToken: shipmentQuote.quoteToken,
      });
      track("job_created", "customer_app", { service: "shipment" });
      setShipmentQuote(null);
      setShipmentPickupCoords(null);
      setShipmentDestinationCoords(null);
      setShipmentRoadRoute(null);
      setRecipientName("");
      setRecipientPhone("");
      setPackageDescription("");
    }, "Envio solicitado");
  };

  return (
    <View style={styles.customerShell}>
      <ScrollView
        ref={customerScrollRef}
        contentContainerStyle={[styles.stack, styles.customerScrollContent]}
      >
        <View style={styles.serviceNav}>
          {(["food", "ride", "shipment"] as const).map((entry) => (
            <Pressable
              key={entry}
              onPress={() => {
                setCustomerWindow(entry);
                setSharedView("service");
              }}
              style={[
                styles.serviceNavItem,
                customerWindow === entry && styles.serviceNavItemActive,
              ]}
            >
              <View
                style={[
                  styles.serviceIconBubble,
                  customerWindow === entry && styles.serviceIconBubbleActive,
                ]}
              >
                <Ionicons
                  name={entry === "food" ? "fast-food" : entry === "ride" ? "car-sport" : "cube"}
                  size={20}
                  color={customerWindow === entry ? "#fff" : "#f4511e"}
                />
              </View>
              <Text
                style={[
                  styles.serviceNavText,
                  customerWindow === entry && styles.serviceNavTextActive,
                ]}
              >
                {entry === "food" ? "Comidas" : entry === "ride" ? "Viajes" : "Envios"}
              </Text>
            </Pressable>
          ))}
        </View>

        {sharedView === "service" && customerWindow === "food" && (
          <>
            {foodScreen === "home" && (
              <>
                <View style={styles.foodTopbar}>
                  <View style={styles.foodLocationBlock}>
                    <View style={styles.foodLocationIcon}>
                      <Ionicons name="location" size={18} color={flashDesign.color.food} />
                    </View>
                    <View style={styles.foodLocationCopy}>
                      <Text style={styles.foodDeliverLabel}>ENTREGAR EN</Text>
                      <Text style={styles.foodAddress} numberOfLines={1}>
                        {deliveryAddress || "Elegí una dirección"}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.foodTopActions}>
                    <Pressable
                      onPress={() => setSharedView("account")}
                      style={styles.foodAvatar}
                      accessibilityLabel="Abrir cuenta"
                    >
                      <Text style={styles.foodAvatarText}>
                        {user.name.trim().slice(0, 1).toUpperCase()}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setFoodScreen("cart")}
                      style={styles.foodCartIcon}
                      accessibilityLabel={`Abrir carrito con ${cart.reduce((sum, line) => sum + line.quantity, 0)} productos`}
                    >
                      <Ionicons name="bag-handle-outline" size={20} color="#fff" />
                      {cart.length > 0 && (
                        <Text style={styles.foodCartCount}>
                          {cart.reduce((sum, line) => sum + line.quantity, 0)}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                </View>
                <View style={styles.foodHomeHeading}>
                  <Text style={styles.foodHomeEyebrow}>
                    HOLA, {user.name.split(" ")[0].toUpperCase()}
                  </Text>
                  <Text style={styles.foodHomeTitle}>¿Qué te gustaría pedir?</Text>
                </View>
                {activeFoodPromotion ? (
                  <LinearGradient
                    colors={[flashDesign.color.ink, "#33253B"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.foodPromoBanner}
                  >
                    <View style={styles.foodPromoCopy}>
                      <View style={styles.foodPromoBadge}>
                        <Ionicons name="sparkles" size={14} color={flashDesign.color.food} />
                        <Text style={styles.foodPromoBadgeText}>{foodPromotionValue}</Text>
                      </View>
                      <Text style={styles.foodPromoTitle}>{activeFoodPromotion.title}</Text>
                      <Text style={styles.foodPromoDescription} numberOfLines={2}>
                        {activeFoodPromotion.description}
                      </Text>
                      <Pressable
                        style={styles.foodPromoAction}
                        onPress={() => {
                          if (activeFoodPromotion.code)
                            setFoodPromotionCode(activeFoodPromotion.code);
                          setFoodScreen(cart.length ? "cart" : "search");
                        }}
                      >
                        <Text style={styles.foodPromoActionText}>
                          {cart.length ? "Ver carrito" : "Explorar opciones"}
                        </Text>
                        <Ionicons name="arrow-forward" size={16} color={flashDesign.color.ink} />
                      </Pressable>
                    </View>
                    <View style={styles.foodPromoArt}>
                      <Ionicons name="fast-food" size={45} color="#fff" />
                      <View style={styles.foodPromoArtDot} />
                    </View>
                  </LinearGradient>
                ) : null}
                <Pressable onPress={() => setFoodScreen("search")} style={styles.foodSearchButton}>
                  <Ionicons name="search" size={20} color={flashDesign.color.inkSoft} />
                  <Text style={styles.foodSearchPlaceholder}>
                    Buscar platos, tiendas o restaurantes
                  </Text>
                  <View style={styles.foodSearchFilter}>
                    <Ionicons name="options-outline" size={18} color="#fff" />
                  </View>
                </Pressable>
                <View style={styles.foodSectionHeader}>
                  <Text style={styles.foodSectionTitle}>Todas las categorías</Text>
                  <Text style={styles.foodSeeAll}>Ver todas ›</Text>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.foodCategoryRail}
                >
                  {foodCategories.map((category) => (
                    <Pressable
                      key={category.name}
                      onPress={() => setFoodCategory(category.name)}
                      style={styles.foodCategoryItem}
                      accessibilityState={{ selected: foodCategory === category.name }}
                    >
                      <View
                        style={[
                          styles.foodCategoryArt,
                          foodCategory === category.name && styles.foodCategoryArtActive,
                        ]}
                      >
                        {category.image ? (
                          <Image
                            source={{ uri: category.image }}
                            style={styles.foodCategoryImage}
                          />
                        ) : (
                          <Ionicons name="restaurant" size={24} color={flashDesign.color.food} />
                        )}
                      </View>
                      <Text
                        style={[
                          styles.foodCategoryName,
                          foodCategory === category.name && styles.foodCategoryNameActive,
                        ]}
                        numberOfLines={2}
                      >
                        {category.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
                {favoriteRestaurants.length > 0 ? (
                  <>
                    <View style={styles.foodSectionHeader}>
                      <Text style={styles.foodSectionTitle}>Tus favoritos</Text>
                      <Text style={styles.foodSeeAll}>{favoriteRestaurants.length} guardados</Text>
                    </View>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.foodFavoriteRail}
                    >
                      {favoriteRestaurants.map((restaurant) => (
                        <Pressable
                          key={restaurant.id}
                          style={styles.foodFavoriteCard}
                          onPress={() => {
                            setSelectedRestaurantId(restaurant.id);
                            setFoodScreen("restaurant");
                          }}
                        >
                          <ImageBackground
                            source={{ uri: restaurant.cover }}
                            imageStyle={styles.foodFavoriteImageStyle}
                            style={styles.foodFavoriteImage}
                          >
                            <View style={styles.foodFavoriteEta}>
                              <Ionicons
                                name="time-outline"
                                size={13}
                                color={flashDesign.color.ink}
                              />
                              <Text style={styles.foodFavoriteEtaText}>
                                {restaurant.etaMin} min
                              </Text>
                            </View>
                          </ImageBackground>
                          <Text style={styles.foodFavoriteName} numberOfLines={1}>
                            {restaurant.name}
                          </Text>
                          <Text style={styles.foodFavoriteMeta} numberOfLines={1}>
                            {restaurant.cuisine}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </>
                ) : null}
                <View style={styles.foodSectionHeader}>
                  <Text style={styles.foodSectionTitle}>
                    {foodCategory === "Todos" ? "Elegidos para vos" : foodCategory}
                  </Text>
                  <Text style={styles.foodSeeAll}>{openRestaurants.length} abiertos</Text>
                </View>
                {openRestaurants.map((restaurant) => (
                  <Pressable
                    key={restaurant.id}
                    onPress={() => {
                      setSelectedRestaurantId(restaurant.id);
                      setFoodScreen("restaurant");
                    }}
                    style={styles.foodMerchantCard}
                  >
                    <ImageBackground
                      source={{ uri: restaurant.cover }}
                      imageStyle={styles.foodMerchantBannerImage}
                      style={styles.foodCardBannerLarge}
                    >
                      <View style={styles.foodCardTopline}>
                        <Text style={styles.foodCardPromo}>{restaurant.badge}</Text>
                        <Pressable
                          disabled={favoritePendingId === restaurant.id}
                          style={styles.foodHeart}
                          accessibilityLabel={
                            favoriteRestaurantIds.includes(restaurant.id)
                              ? `Quitar ${restaurant.name} de favoritos`
                              : `Guardar ${restaurant.name} en favoritos`
                          }
                          accessibilityState={{
                            checked: favoriteRestaurantIds.includes(restaurant.id),
                            busy: favoritePendingId === restaurant.id,
                          }}
                          onPress={(event) => {
                            event.stopPropagation();
                            void toggleFavorite(restaurant.id);
                          }}
                        >
                          <Ionicons
                            name={
                              favoriteRestaurantIds.includes(restaurant.id)
                                ? "heart"
                                : "heart-outline"
                            }
                            size={19}
                            color={
                              favoriteRestaurantIds.includes(restaurant.id)
                                ? flashDesign.color.food
                                : flashDesign.color.ink
                            }
                          />
                        </Pressable>
                      </View>
                    </ImageBackground>
                    <View style={styles.foodMerchantBody}>
                      <View style={styles.foodMerchantTitleRow}>
                        <View style={styles.itemCopy}>
                          <Text style={styles.foodMerchantName} numberOfLines={1}>
                            {restaurant.name}
                          </Text>
                          <Text style={styles.foodMerchantCuisine} numberOfLines={1}>
                            {restaurant.cuisine}
                          </Text>
                        </View>
                        <View style={styles.foodRatingPill}>
                          <Ionicons name="star" size={12} color="#E98A00" />
                          <Text style={styles.foodRatingText}>{restaurant.rating.toFixed(1)}</Text>
                        </View>
                      </View>
                      <View style={styles.foodMetaRow}>
                        <View style={styles.foodMetaItem}>
                          <Ionicons
                            name="time-outline"
                            size={15}
                            color={flashDesign.color.inkSoft}
                          />
                          <Text style={styles.foodMetaText}>{restaurant.etaMin} min</Text>
                        </View>
                        <View style={styles.foodMetaDot} />
                        <View style={styles.foodMetaItem}>
                          <Ionicons
                            name="bicycle-outline"
                            size={15}
                            color={flashDesign.color.inkSoft}
                          />
                          <Text style={styles.foodMetaText}>
                            {restaurant.deliveryFee
                              ? money.format(restaurant.deliveryFee)
                              : "Envío gratis"}
                          </Text>
                        </View>
                        <View style={styles.foodMetaDot} />
                        <Text style={styles.foodMetaText}>
                          {restaurant.distanceKm.toFixed(1)} km
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                ))}
                {openRestaurants.length === 0 ? (
                  <View style={styles.foodEmpty}>
                    <View style={styles.foodEmptyIcon}>
                      <Ionicons
                        name="restaurant-outline"
                        size={30}
                        color={flashDesign.color.food}
                      />
                    </View>
                    <Text style={styles.foodEmptyTitle}>No hay opciones abiertas</Text>
                    <Text style={styles.foodEmptyCopy}>
                      Probá otra categoría o volvé a buscar cuando los comercios estén disponibles.
                    </Text>
                    <Pressable
                      style={styles.foodEmptyAction}
                      onPress={() => setFoodCategory("Todos")}
                    >
                      <Text style={styles.foodEmptyActionText}>Ver todas</Text>
                    </Pressable>
                  </View>
                ) : null}
              </>
            )}

            {foodScreen === "search" && (
              <>
                <View style={styles.foodPageHeader}>
                  <Pressable onPress={() => setFoodScreen("home")} style={styles.foodBack}>
                    <Ionicons name="chevron-back" size={20} color="#222" />
                  </Pressable>
                  <View style={styles.foodPageHeaderCopy}>
                    <Text style={styles.foodPageTitle}>Buscar</Text>
                    <Text style={styles.foodPageSubtitle}>Catálogo y disponibilidad actual</Text>
                  </View>
                </View>
                <View style={styles.foodSearchButton}>
                  <Ionicons name="search" size={20} color={flashDesign.color.inkSoft} />
                  <TextInput
                    autoFocus
                    value={foodQuery}
                    onChangeText={setFoodQuery}
                    placeholder="¿Qué querés comer?"
                    style={styles.foodSearchInput}
                  />
                  {foodQuery ? (
                    <Pressable
                      accessibilityLabel="Limpiar búsqueda"
                      style={styles.foodSearchClear}
                      onPress={() => setFoodQuery("")}
                    >
                      <Ionicons name="close" size={17} color={flashDesign.color.inkSoft} />
                    </Pressable>
                  ) : null}
                </View>
                <View style={styles.foodSectionHeader}>
                  <Text style={styles.foodSectionTitle}>
                    {foodQuery ? "Resultados" : "Explorá el catálogo"}
                  </Text>
                  {!catalogSearchLoading && !catalogSearchError ? (
                    <Text style={styles.foodSeeAll}>
                      {catalogResults.length}
                      {catalogNextOffset !== null ? "+" : ""} opciones
                    </Text>
                  ) : null}
                </View>
                {!foodQuery && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.foodSearchCategoryRail}
                  >
                    {foodCategories
                      .filter((category) => category.name !== "Todos")
                      .slice(0, 6)
                      .map((category) => (
                        <Pressable
                          key={category.name}
                          onPress={() => setFoodQuery(category.name)}
                          style={styles.foodSearchCategoryCard}
                        >
                          {category.image ? (
                            <Image
                              source={{ uri: category.image }}
                              style={styles.foodSearchCategoryImage}
                            />
                          ) : (
                            <View style={styles.foodSearchCategoryImageFallback}>
                              <Ionicons
                                name="restaurant"
                                size={20}
                                color={flashDesign.color.food}
                              />
                            </View>
                          )}
                          <Text style={styles.foodSearchCategoryName} numberOfLines={2}>
                            {category.name}
                          </Text>
                          <Text style={styles.foodSearchCategoryCount}>
                            {category.count} {category.count === 1 ? "lugar" : "lugares"}
                          </Text>
                        </Pressable>
                      ))}
                  </ScrollView>
                )}
                {catalogSearchLoading ? (
                  <View style={styles.foodSearchSkeletonList}>
                    {[0, 1, 2].map((index) => (
                      <View key={index} style={styles.foodSearchSkeletonCard}>
                        <View style={styles.foodSearchSkeletonImage} />
                        <View style={styles.foodSearchSkeletonCopy}>
                          <View style={styles.foodSearchSkeletonTitle} />
                          <View style={styles.foodSearchSkeletonLine} />
                          <View style={styles.foodSearchSkeletonShort} />
                        </View>
                      </View>
                    ))}
                  </View>
                ) : null}
                {Boolean(catalogSearchError) && (
                  <View style={styles.foodSearchState}>
                    <View style={styles.foodSearchStateIcon}>
                      <Ionicons
                        name="cloud-offline-outline"
                        size={25}
                        color={flashDesign.color.danger}
                      />
                    </View>
                    <Text style={styles.foodSearchStateTitle}>No pudimos buscar</Text>
                    <Text style={styles.foodSearchStateCopy}>{catalogSearchError}</Text>
                    <Pressable
                      style={styles.foodSearchRetry}
                      onPress={() => setCatalogSearchNonce((current) => current + 1)}
                    >
                      <Text style={styles.foodSearchRetryText}>Reintentar</Text>
                    </Pressable>
                  </View>
                )}
                {!catalogSearchLoading &&
                !catalogSearchError &&
                !catalogResults.length &&
                foodQuery.trim() ? (
                  <View style={styles.foodSearchState}>
                    <View style={styles.foodSearchStateIcon}>
                      <Ionicons name="search-outline" size={26} color={flashDesign.color.food} />
                    </View>
                    <Text style={styles.foodSearchStateTitle}>Sin coincidencias</Text>
                    <Text style={styles.foodSearchStateCopy}>
                      Probá con otro plato, categoría o restaurante.
                    </Text>
                    <Pressable style={styles.foodSearchRetry} onPress={() => setFoodQuery("")}>
                      <Text style={styles.foodSearchRetryText}>Limpiar búsqueda</Text>
                    </Pressable>
                  </View>
                ) : null}
                {catalogResults.map((result) => (
                  <Pressable
                    key={result.restaurantId}
                    onPress={() => {
                      setSelectedRestaurantId(result.restaurantId);
                      setFoodScreen("restaurant");
                    }}
                    style={styles.foodSearchResultCard}
                  >
                    <ImageBackground
                      source={{ uri: result.cover }}
                      imageStyle={styles.foodCardBannerImage}
                      style={styles.foodSearchResultImage}
                    >
                      <View style={styles.foodSearchResultEta}>
                        <Ionicons name="time-outline" size={12} color={flashDesign.color.ink} />
                        <Text style={styles.foodSearchResultEtaText}>{result.etaMin} min</Text>
                      </View>
                    </ImageBackground>
                    <View style={styles.foodSearchResultBody}>
                      <View style={styles.foodSearchResultHeading}>
                        <Text style={styles.foodSearchResultName} numberOfLines={1}>
                          {result.restaurantName}
                        </Text>
                        <Ionicons
                          name="chevron-forward"
                          size={18}
                          color={flashDesign.color.muted}
                        />
                      </View>
                      <Text style={styles.foodSearchResultCuisine} numberOfLines={1}>
                        {result.cuisine}
                      </Text>
                      <View style={styles.foodSearchResultMeta}>
                        <Ionicons
                          name="bicycle-outline"
                          size={14}
                          color={flashDesign.color.inkSoft}
                        />
                        <Text style={styles.foodSearchResultMetaText}>
                          {result.deliveryFee ? money.format(result.deliveryFee) : "Envío gratis"}
                        </Text>
                        <View style={styles.foodMetaDot} />
                        <Text style={styles.foodSearchResultMetaText}>
                          {result.matchCount}{" "}
                          {result.matchCount === 1 ? "coincidencia" : "coincidencias"}
                        </Text>
                      </View>
                      {result.matchedItems.length ? (
                        <Text style={styles.searchMatchText} numberOfLines={1}>
                          {result.matchedItems.map((item) => item.name).join(" · ")}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                ))}
                {catalogNextOffset !== null && !catalogSearchLoading && (
                  <Pressable
                    style={styles.searchMoreButton}
                    onPress={() => {
                      setCatalogSearchLoading(true);
                      void api
                        .searchCatalog(foodQuery, catalogNextOffset)
                        .then((result) => {
                          setCatalogResults((current) => [...current, ...result.results]);
                          setCatalogNextOffset(result.nextOffset);
                        })
                        .catch((error) =>
                          setCatalogSearchError(
                            error instanceof Error ? error.message : "No se pudo continuar",
                          ),
                        )
                        .finally(() => setCatalogSearchLoading(false));
                    }}
                  >
                    <Text style={styles.searchMoreText}>Ver más resultados</Text>
                  </Pressable>
                )}
              </>
            )}

            {foodScreen === "restaurant" && selectedRestaurant && (
              <>
                <ImageBackground
                  source={{ uri: selectedRestaurant.cover }}
                  imageStyle={styles.foodRestaurantHeroImage}
                  style={styles.foodRestaurantHero}
                >
                  <Pressable
                    onPress={() => setFoodScreen("home")}
                    style={styles.foodFloatingButton}
                  >
                    <Ionicons name="chevron-back" size={22} color={flashDesign.color.ink} />
                  </Pressable>
                  <Pressable
                    disabled={favoritePendingId === selectedRestaurant.id}
                    style={styles.foodFloatingButton}
                    accessibilityLabel={
                      favoriteRestaurantIds.includes(selectedRestaurant.id)
                        ? `Quitar ${selectedRestaurant.name} de favoritos`
                        : `Guardar ${selectedRestaurant.name} en favoritos`
                    }
                    accessibilityState={{
                      checked: favoriteRestaurantIds.includes(selectedRestaurant.id),
                      busy: favoritePendingId === selectedRestaurant.id,
                    }}
                    onPress={() => void toggleFavorite(selectedRestaurant.id)}
                  >
                    <Ionicons
                      name={
                        favoriteRestaurantIds.includes(selectedRestaurant.id)
                          ? "heart"
                          : "heart-outline"
                      }
                      size={22}
                      color={
                        favoriteRestaurantIds.includes(selectedRestaurant.id)
                          ? flashDesign.color.food
                          : flashDesign.color.ink
                      }
                    />
                  </Pressable>
                </ImageBackground>
                <View style={styles.foodRestaurantInfo}>
                  <View style={styles.foodRestaurantStatusRow}>
                    <View style={styles.foodRestaurantOpenBadge}>
                      <View style={styles.foodRestaurantOpenDot} />
                      <Text style={styles.foodRestaurantOpenText}>Abierto ahora</Text>
                    </View>
                    {selectedRestaurant.badge ? (
                      <Text style={styles.foodRestaurantOfferBadge}>
                        {selectedRestaurant.badge}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.foodRestaurantTitle}>{selectedRestaurant.name}</Text>
                  <Text style={styles.foodRestaurantCuisine}>
                    {selectedRestaurant.cuisine} · {selectedRestaurant.address}
                  </Text>
                  <View style={styles.foodRestaurantFacts}>
                    <View style={styles.foodRestaurantFact}>
                      <View style={styles.foodRestaurantFactIcon}>
                        <Ionicons name="star" size={15} color="#E98A00" />
                      </View>
                      <View>
                        <Text style={styles.foodRestaurantFactValue}>
                          {selectedRestaurant.rating.toFixed(1)}
                        </Text>
                        <Text style={styles.foodRestaurantFactLabel}>calificación</Text>
                      </View>
                    </View>
                    <View style={styles.foodRestaurantFact}>
                      <View style={styles.foodRestaurantFactIcon}>
                        <Ionicons name="time-outline" size={16} color={flashDesign.color.food} />
                      </View>
                      <View>
                        <Text style={styles.foodRestaurantFactValue}>
                          {selectedRestaurant.etaMin} min
                        </Text>
                        <Text style={styles.foodRestaurantFactLabel}>estimado</Text>
                      </View>
                    </View>
                    <View style={styles.foodRestaurantFact}>
                      <View style={styles.foodRestaurantFactIcon}>
                        <Ionicons
                          name="bicycle-outline"
                          size={16}
                          color={flashDesign.color.shipment}
                        />
                      </View>
                      <View>
                        <Text style={styles.foodRestaurantFactValue}>
                          {selectedRestaurant.deliveryFee
                            ? money.format(selectedRestaurant.deliveryFee)
                            : "Gratis"}
                        </Text>
                        <Text style={styles.foodRestaurantFactLabel}>
                          {selectedRestaurant.distanceKm.toFixed(1)} km
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
                <View style={styles.foodSectionHeader}>
                  <Text style={styles.foodSectionTitle}>Menú</Text>
                  <Text style={styles.foodSeeAll}>{visibleFoodMenuItems.length} disponibles</Text>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.foodMenuTabs}
                >
                  {foodMenuCategories.map((category) => (
                    <Pressable
                      key={category}
                      style={[
                        styles.foodMenuTabButton,
                        foodMenuCategory === category && styles.foodMenuTabButtonActive,
                      ]}
                      onPress={() => setFoodMenuCategory(category)}
                      accessibilityState={{ selected: foodMenuCategory === category }}
                    >
                      <Text
                        style={[
                          styles.foodMenuTab,
                          foodMenuCategory === category && styles.foodMenuTabActive,
                        ]}
                      >
                        {category}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
                {dietaryPreferences.hideIncompatible && (
                  <View style={styles.dietaryFilterBanner}>
                    <Ionicons name="options-outline" size={17} color="#087a50" />
                    <Text style={styles.dietaryBadgeText}>
                      Filtro personal activo · sólo productos declarados compatibles
                    </Text>
                  </View>
                )}
                {visibleFoodMenuItems.map((item) => (
                  <View key={item.id} style={styles.foodProductCard}>
                    <ImageBackground
                      source={{ uri: selectedRestaurant.image || selectedRestaurant.cover }}
                      imageStyle={styles.foodProductImageStyle}
                      style={styles.foodProductImage}
                    >
                      {!item.stock ? (
                        <View style={styles.foodProductUnavailable}>
                          <Text style={styles.foodProductUnavailableText}>AGOTADO</Text>
                        </View>
                      ) : null}
                    </ImageBackground>
                    <View style={styles.itemCopy}>
                      <View style={styles.foodProductHeading}>
                        <Text style={styles.foodProductName} numberOfLines={2}>
                          {item.name}
                        </Text>
                        {item.dietaryLabels?.length ? (
                          <Ionicons
                            name="leaf-outline"
                            size={16}
                            color={flashDesign.color.shipment}
                          />
                        ) : null}
                      </View>
                      <Text style={styles.foodProductDescription} numberOfLines={2}>
                        {item.description?.trim() ||
                          item.category ||
                          "Información del producto no declarada"}
                      </Text>
                      <Text style={styles.foodProductPrice}>{money.format(item.price)}</Text>
                    </View>
                    <Pressable
                      disabled={!item.stock || busy}
                      onPress={() => {
                        if (item.modifierGroups?.length) {
                          setCustomizingRestaurant(selectedRestaurant);
                          setCustomizingItem(item);
                          setCustomizingExtras([]);
                          setCustomizingNote("");
                        } else addItem(selectedRestaurant, item);
                      }}
                      style={[styles.foodAddButton, !item.stock && styles.foodAddButtonDisabled]}
                      accessibilityLabel={
                        item.stock ? `Agregar ${item.name}` : `${item.name} agotado`
                      }
                    >
                      <Ionicons name="add" size={22} color="#fff" />
                    </Pressable>
                  </View>
                ))}
                {visibleFoodMenuItems.length === 0 ? (
                  <View style={styles.foodSearchState}>
                    <View style={styles.foodSearchStateIcon}>
                      <Ionicons
                        name="restaurant-outline"
                        size={25}
                        color={flashDesign.color.food}
                      />
                    </View>
                    <Text style={styles.foodSearchStateTitle}>No hay productos disponibles</Text>
                    <Text style={styles.foodSearchStateCopy}>
                      Probá otra categoría o revisá tus preferencias alimentarias.
                    </Text>
                    <Pressable
                      style={styles.foodSearchRetry}
                      onPress={() => setFoodMenuCategory("Todos")}
                    >
                      <Text style={styles.foodSearchRetryText}>Ver todo el menú</Text>
                    </Pressable>
                  </View>
                ) : null}
                {cart.length > 0 && (
                  <Pressable onPress={() => setFoodScreen("cart")} style={styles.foodStickyCart}>
                    <Text style={styles.foodStickyCount}>
                      {cart.reduce((sum, line) => sum + line.quantity, 0)}
                    </Text>
                    <Text style={styles.foodStickyLabel}>Ver carrito</Text>
                    <Text style={styles.foodStickyPrice}>{money.format(cartTotal)}</Text>
                  </Pressable>
                )}
                <Modal
                  visible={Boolean(customizingItem && customizingRestaurant)}
                  transparent
                  animationType="slide"
                  onRequestClose={() => setCustomizingItem(null)}
                >
                  <View style={styles.productCustomizerBackdrop}>
                    <View style={styles.productCustomizerSheet}>
                      <View style={styles.productCustomizerHandle} />
                      <View style={styles.productCustomizerHeader}>
                        <View style={styles.itemCopy}>
                          <Text style={styles.productCustomizerEyebrow}>PERSONALIZAR</Text>
                          <Text style={styles.productCustomizerTitle}>{customizingItem?.name}</Text>
                          <Text style={styles.productCustomizerRestaurant}>
                            {customizingRestaurant?.name}
                          </Text>
                        </View>
                        <Pressable
                          style={styles.foodBack}
                          accessibilityLabel="Cerrar personalización"
                          onPress={() => setCustomizingItem(null)}
                        >
                          <Ionicons name="close" size={21} color={flashDesign.color.ink} />
                        </Pressable>
                      </View>
                      <ScrollView
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={styles.productCustomizerContent}
                      >
                        <View style={styles.productCustomizerSummary}>
                          {customizingRestaurant ? (
                            <Image
                              source={{
                                uri: customizingRestaurant.image || customizingRestaurant.cover,
                              }}
                              style={styles.productCustomizerImage}
                            />
                          ) : null}
                          <View style={styles.itemCopy}>
                            <Text style={styles.productCustomizerSummaryPrice}>
                              {money.format(customizingItem?.price || 0)}
                            </Text>
                            <Text
                              style={styles.productCustomizerSummaryDescription}
                              numberOfLines={3}
                            >
                              {customizingItem?.description?.trim() ||
                                customizingItem?.category ||
                                "Información del producto no declarada"}
                            </Text>
                          </View>
                        </View>
                        {Boolean(customizingItem?.dietaryLabels?.length) ? (
                          <View style={styles.dietaryBadgeRow}>
                            {customizingItem?.dietaryLabels?.map((label) => (
                              <View style={styles.dietaryBadge} key={label.code}>
                                <Ionicons
                                  name="leaf-outline"
                                  size={14}
                                  color={flashDesign.color.shipment}
                                />
                                <Text style={styles.dietaryBadgeText}>{label.name}</Text>
                              </View>
                            ))}
                          </View>
                        ) : null}
                        {Boolean(customizingItem?.allergens?.length) ? (
                          <View style={styles.allergenWarning}>
                            <View style={styles.productCustomizerWarningIcon}>
                              <Ionicons name="warning-outline" size={19} color="#9A4B00" />
                            </View>
                            <View style={styles.itemCopy}>
                              <Text style={styles.allergenWarningTitle}>
                                Información de alérgenos
                              </Text>
                              <Text style={styles.allergenWarningText}>
                                {customizingItem?.allergens
                                  ?.map(
                                    (entry) =>
                                      `${entry.presence === "contains" ? "Contiene" : "Puede contener"} ${entry.name.toLowerCase()}`,
                                  )
                                  .join(" · ")}
                              </Text>
                            </View>
                          </View>
                        ) : null}
                        {customizingItem?.modifierGroups?.map((group) => {
                          const selected = customizingExtras.filter((id) =>
                            group.modifiers.some((modifier) => modifier.id === id),
                          );
                          return (
                            <View key={group.id} style={styles.foodCustomizerGroup}>
                              <View style={styles.foodCustomizerGroupHeader}>
                                <View style={styles.itemCopy}>
                                  <View style={styles.foodCustomizerGroupTitleRow}>
                                    <Text style={styles.foodCustomizerGroupTitle}>
                                      {group.name}
                                    </Text>
                                    <Text
                                      style={[
                                        styles.foodCustomizerRequirement,
                                        group.required && styles.foodCustomizerRequirementRequired,
                                      ]}
                                    >
                                      {group.required ? "OBLIGATORIO" : "OPCIONAL"}
                                    </Text>
                                  </View>
                                  <Text style={styles.foodCustomizerGroupMeta}>
                                    Elegí entre {group.min} y {group.max}
                                  </Text>
                                </View>
                                <Text style={styles.modifierCounter}>
                                  {selected.length}/{group.max}
                                </Text>
                              </View>
                              {group.modifiers
                                .filter((modifier) => modifier.available)
                                .map((modifier) => {
                                  const checked = customizingExtras.includes(modifier.id),
                                    blocked = !checked && selected.length >= group.max;
                                  return (
                                    <Pressable
                                      key={modifier.id}
                                      disabled={blocked}
                                      style={[
                                        styles.modifierRow,
                                        checked && styles.modifierRowSelected,
                                        blocked && styles.modifierRowBlocked,
                                      ]}
                                      onPress={() =>
                                        setCustomizingExtras((current) =>
                                          checked
                                            ? current.filter((id) => id !== modifier.id)
                                            : [...current, modifier.id],
                                        )
                                      }
                                      accessibilityState={{ checked, disabled: blocked }}
                                    >
                                      <View
                                        style={[
                                          styles.modifierControl,
                                          checked && styles.modifierControlSelected,
                                        ]}
                                      >
                                        {checked ? (
                                          <Ionicons name="checkmark" size={15} color="#fff" />
                                        ) : null}
                                      </View>
                                      <Text style={styles.modifierName}>{modifier.name}</Text>
                                      <Text style={styles.modifierPrice}>
                                        {modifier.price
                                          ? `+ ${money.format(modifier.price)}`
                                          : "Incluido"}
                                      </Text>
                                    </Pressable>
                                  );
                                })}
                            </View>
                          );
                        })}
                        <View style={styles.foodCustomizerNoteSection}>
                          <View style={styles.foodCustomizerNoteHeading}>
                            <View>
                              <Text style={styles.foodCustomizerGroupTitle}>
                                Indicaciones para cocina
                              </Text>
                              <Text style={styles.foodCustomizerGroupMeta}>
                                Opcional · máximo 500 caracteres
                              </Text>
                            </View>
                            <Text style={styles.foodCustomizerNoteCount}>
                              {customizingNote.length}/500
                            </Text>
                          </View>
                          <TextInput
                            value={customizingNote}
                            onChangeText={setCustomizingNote}
                            maxLength={500}
                            multiline
                            placeholder="Ej. sin sal, cortar por la mitad"
                            placeholderTextColor={flashDesign.color.muted}
                            style={styles.productNote}
                          />
                        </View>
                      </ScrollView>
                      <Pressable
                        disabled={busy || !customizingSelectionValid}
                        style={[
                          styles.productCustomizerAction,
                          (busy || !customizingSelectionValid) && styles.disabledButton,
                        ]}
                        onPress={() => {
                          if (customizingRestaurant && customizingItem)
                            addItem(
                              customizingRestaurant,
                              customizingItem,
                              customizingExtras,
                              customizingNote,
                            );
                          setCustomizingItem(null);
                        }}
                      >
                        <View style={styles.productCustomizerActionCount}>
                          <Text style={styles.productCustomizerActionCountText}>1</Text>
                        </View>
                        <Text style={styles.productCustomizerActionText}>
                          {busy ? "Agregando…" : "Agregar al carrito"}
                        </Text>
                        <Text style={styles.productCustomizerActionPrice}>
                          {money.format(customizingTotal)}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                </Modal>
              </>
            )}

            {foodScreen === "cart" && (
              <>
                <View style={styles.foodPageHeader}>
                  <Pressable
                    onPress={() => setFoodScreen(selectedRestaurant ? "restaurant" : "home")}
                    style={styles.foodBack}
                  >
                    <Ionicons name="chevron-back" size={20} color={flashDesign.color.ink} />
                  </Pressable>
                  <View style={styles.foodPageHeaderCopy}>
                    <Text style={styles.foodPageTitle}>Mi carrito</Text>
                    <Text style={styles.foodPageSubtitle}>Revisá productos, entrega y pago</Text>
                  </View>
                </View>
                {cart.length === 0 ? (
                  <View style={styles.foodEmpty}>
                    <View style={styles.foodEmptyIcon}>
                      <Ionicons
                        name="bag-handle-outline"
                        size={31}
                        color={flashDesign.color.food}
                      />
                    </View>
                    <Text style={styles.foodEmptyTitle}>Tu carrito está vacío</Text>
                    <Text style={styles.foodEmptyCopy}>
                      Explorá restaurantes abiertos y agregá productos para calcular entrega y
                      total.
                    </Text>
                    <Pressable
                      disabled={busy}
                      style={styles.foodEmptyAction}
                      onPress={() => setFoodScreen("home")}
                    >
                      <Text style={styles.foodEmptyActionText}>Explorar restaurantes</Text>
                    </Pressable>
                  </View>
                ) : (
                  <>
                    {cartRestaurant ? (
                      <Pressable
                        style={styles.foodCartMerchant}
                        onPress={() => {
                          setSelectedRestaurantId(cartRestaurant.id);
                          setFoodScreen("restaurant");
                        }}
                      >
                        <Image
                          source={{ uri: cartRestaurant.image || cartRestaurant.cover }}
                          style={styles.foodCartMerchantImage}
                        />
                        <View style={styles.itemCopy}>
                          <Text style={styles.foodCartMerchantEyebrow}>PEDIDO EN</Text>
                          <Text style={styles.foodCartMerchantName}>{cartRestaurant.name}</Text>
                          <Text style={styles.foodCartMerchantMeta}>
                            {cartRestaurant.etaMin} min · {cartRestaurant.distanceKm.toFixed(1)} km
                          </Text>
                        </View>
                        <Ionicons
                          name="chevron-forward"
                          size={19}
                          color={flashDesign.color.muted}
                        />
                      </Pressable>
                    ) : null}
                    <View style={styles.foodSectionHeader}>
                      <Text style={styles.foodSectionTitle}>Productos</Text>
                      <Text style={styles.foodSeeAll}>
                        {cart.reduce((sum, line) => sum + line.quantity, 0)} unidades
                      </Text>
                    </View>
                    {cart.map((line) => (
                      <View key={line.lineId} style={styles.foodCartLine}>
                        <View style={styles.foodCartLineIcon}>
                          <Ionicons
                            name="restaurant-outline"
                            size={19}
                            color={flashDesign.color.food}
                          />
                        </View>
                        <View style={styles.itemCopy}>
                          <Text style={styles.foodCartLineName}>{line.name}</Text>
                          <Text style={styles.foodProductPrice}>
                            {money.format(line.unitPrice * line.quantity)}
                          </Text>
                          {line.extras.length > 0 && (
                            <Text style={styles.foodCartLineMeta}>
                              {line.extras.length} agregado{line.extras.length === 1 ? "" : "s"}
                            </Text>
                          )}
                          {line.note && (
                            <Text style={styles.foodCartLineNote} numberOfLines={2}>
                              “{line.note}”
                            </Text>
                          )}
                        </View>
                        <View style={styles.foodQuantity}>
                          <Pressable
                            accessibilityLabel={`Quitar una unidad de ${line.name}`}
                            style={styles.foodQuantityButton}
                            onPress={() => changeCartQuantity(line.lineId, -1)}
                          >
                            <Ionicons name="remove" size={17} color={flashDesign.color.ink} />
                          </Pressable>
                          <Text style={styles.foodQuantityValue}>{line.quantity}</Text>
                          <Pressable
                            accessibilityLabel={`Agregar una unidad de ${line.name}`}
                            style={[styles.foodQuantityButton, styles.foodQuantityButtonAdd]}
                            onPress={() => changeCartQuantity(line.lineId, 1)}
                          >
                            <Ionicons name="add" size={17} color="#fff" />
                          </Pressable>
                        </View>
                      </View>
                    ))}
                    <View style={styles.foodSectionHeader}>
                      <Text style={styles.foodSectionTitle}>Entrega</Text>
                      <Text style={styles.foodSeeAll}>Dirección verificada</Text>
                    </View>
                    <View style={styles.foodCartOptionList}>
                      {state.addresses
                        .filter(
                          (item) =>
                            item.userId === user.id &&
                            !item.id.startsWith("profile-") &&
                            item.lat !== null &&
                            item.lng !== null,
                        )
                        .map((address) => {
                          const selected = deliveryAddress === address.address;
                          return (
                            <Pressable
                              key={address.id}
                              onPress={() => {
                                setDeliveryAddress(address.address);
                                setFoodCheckoutQuote(null);
                              }}
                              style={[
                                styles.foodCartOption,
                                selected && styles.foodCartOptionSelected,
                              ]}
                              accessibilityState={{ selected }}
                            >
                              <View
                                style={[
                                  styles.foodCartOptionIcon,
                                  selected && styles.foodCartOptionIconSelected,
                                ]}
                              >
                                <Ionicons
                                  name={address.isDefault ? "home" : "location-outline"}
                                  size={19}
                                  color={selected ? "#fff" : flashDesign.color.food}
                                />
                              </View>
                              <View style={styles.savedAddressCopy}>
                                <View style={styles.foodCartOptionTitleRow}>
                                  <Text style={styles.foodCartOptionTitle}>{address.label}</Text>
                                  {address.isDefault ? (
                                    <Text style={styles.foodCartDefaultBadge}>PREDETERMINADA</Text>
                                  ) : null}
                                </View>
                                <Text style={styles.foodCartOptionMeta} numberOfLines={2}>
                                  {address.address}
                                </Text>
                              </View>
                              <Ionicons
                                name={selected ? "checkmark-circle" : "ellipse-outline"}
                                size={22}
                                color={selected ? flashDesign.color.food : flashDesign.color.muted}
                              />
                            </Pressable>
                          );
                        })}
                      {!state.addresses.some(
                        (item) =>
                          item.userId === user.id &&
                          !item.id.startsWith("profile-") &&
                          item.lat !== null &&
                          item.lng !== null,
                      ) ? (
                        <Pressable
                          style={styles.foodCartMissingOption}
                          onPress={() => setSharedView("account")}
                        >
                          <Ionicons
                            name="location-outline"
                            size={20}
                            color={flashDesign.color.danger}
                          />
                          <View style={styles.itemCopy}>
                            <Text style={styles.foodCartOptionTitle}>
                              Falta una dirección geocodificada
                            </Text>
                            <Text style={styles.foodCartOptionMeta}>
                              Agregala en Cuenta para poder cotizar la entrega.
                            </Text>
                          </View>
                          <Ionicons
                            name="chevron-forward"
                            size={18}
                            color={flashDesign.color.muted}
                          />
                        </Pressable>
                      ) : null}
                    </View>
                    <View style={styles.foodSectionHeader}>
                      <Text style={styles.foodSectionTitle}>Pago</Text>
                      <Text style={styles.foodSeeAll}>Token seguro</Text>
                    </View>
                    <View style={styles.foodCartOptionList}>
                      {customerPaymentMethods.map((method) => {
                        const selected = selectedFoodPayment?.id === method.id;
                        return (
                          <Pressable
                            key={method.id}
                            onPress={() => {
                              setSelectedFoodPaymentId(method.id);
                              setFoodCheckoutQuote(null);
                            }}
                            style={[
                              styles.foodCartOption,
                              selected && styles.foodCartOptionSelected,
                            ]}
                            accessibilityState={{ selected }}
                          >
                            <View
                              style={[
                                styles.foodCartOptionIcon,
                                styles.foodCartPaymentIcon,
                                selected && styles.foodCartPaymentIconSelected,
                              ]}
                            >
                              <Ionicons
                                name={method.type === "wallet" ? "wallet" : "card"}
                                size={19}
                                color={selected ? "#fff" : flashDesign.color.brand}
                              />
                            </View>
                            <View style={styles.itemCopy}>
                              <Text style={styles.foodCartOptionTitle}>{method.label}</Text>
                              <Text style={styles.foodCartOptionMeta}>
                                {method.type === "wallet"
                                  ? "Saldo y movimientos en Flash Wallet"
                                  : method.brand
                                    ? `${method.brand.toUpperCase()} terminada en ${method.last4 || "••••"}`
                                    : "Método tokenizado"}
                              </Text>
                            </View>
                            <Ionicons
                              name={selected ? "checkmark-circle" : "ellipse-outline"}
                              size={22}
                              color={selected ? flashDesign.color.brand : flashDesign.color.muted}
                            />
                          </Pressable>
                        );
                      })}
                      {!customerPaymentMethods.length ? (
                        <Pressable
                          style={styles.foodCartMissingOption}
                          onPress={() => setSharedView("account")}
                        >
                          <Ionicons
                            name="card-outline"
                            size={20}
                            color={flashDesign.color.danger}
                          />
                          <View style={styles.itemCopy}>
                            <Text style={styles.foodCartOptionTitle}>Falta un método de pago</Text>
                            <Text style={styles.foodCartOptionMeta}>
                              Agregalo de forma segura desde Cuenta.
                            </Text>
                          </View>
                          <Ionicons
                            name="chevron-forward"
                            size={18}
                            color={flashDesign.color.muted}
                          />
                        </Pressable>
                      ) : null}
                    </View>
                    <View style={styles.foodSectionHeader}>
                      <Text style={styles.foodSectionTitle}>Promoción</Text>
                      {activeFoodPromotion?.code ? (
                        <Pressable
                          onPress={() => {
                            setFoodPromotionCode(activeFoodPromotion.code || "");
                            setFoodCheckoutQuote(null);
                          }}
                        >
                          <Text style={styles.foodSeeAll}>Usar {activeFoodPromotion.code}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    <View style={styles.foodCouponField}>
                      <View style={styles.foodCouponIcon}>
                        <Ionicons name="ticket-outline" size={19} color={flashDesign.color.food} />
                      </View>
                      <TextInput
                        value={foodPromotionCode}
                        onChangeText={(value) => {
                          setFoodPromotionCode(value.toUpperCase());
                          setFoodCheckoutQuote(null);
                        }}
                        autoCapitalize="characters"
                        placeholder="Código promocional (opcional)"
                        placeholderTextColor={flashDesign.color.muted}
                        style={styles.foodCouponInput}
                      />
                      {foodPromotionCode ? (
                        <Pressable
                          accessibilityLabel="Quitar promoción"
                          style={styles.foodSearchClear}
                          onPress={() => {
                            setFoodPromotionCode("");
                            setFoodCheckoutQuote(null);
                          }}
                        >
                          <Ionicons name="close" size={17} color={flashDesign.color.inkSoft} />
                        </Pressable>
                      ) : null}
                    </View>
                    <View style={styles.foodCartTotalCard}>
                      <View>
                        <Text style={styles.foodCartTotalLabel}>SUBTOTAL DE PRODUCTOS</Text>
                        <Text style={styles.foodCartTotalHelp}>
                          Envío, servicio y descuento se calculan al continuar.
                        </Text>
                      </View>
                      <Text style={styles.foodCartTotalValue}>{money.format(cartTotal)}</Text>
                    </View>
                    <Pressable
                      disabled={busy || !selectedFoodAddress || !selectedFoodPayment}
                      style={[
                        styles.foodCheckoutPrimary,
                        (busy || !selectedFoodAddress || !selectedFoodPayment) &&
                          styles.disabledButton,
                      ]}
                      onPress={openFoodCheckout}
                    >
                      <Text style={styles.foodCheckoutPrimaryText}>
                        {busy ? "Calculando precio…" : "Continuar al checkout"}
                      </Text>
                      <Ionicons name="arrow-forward" size={18} color="#fff" />
                    </Pressable>
                  </>
                )}
              </>
            )}

            {foodScreen === "checkout" && foodCheckoutQuote && (
              <>
                <View style={styles.foodPageHeader}>
                  <Pressable onPress={() => setFoodScreen("cart")} style={styles.foodBack}>
                    <Ionicons name="chevron-back" size={20} color={flashDesign.color.ink} />
                  </Pressable>
                  <View style={styles.foodPageHeaderCopy}>
                    <Text style={styles.foodPageTitle}>Confirmar pedido</Text>
                    <Text style={styles.foodPageSubtitle}>Última revisión antes de cobrar</Text>
                  </View>
                </View>
                <LinearGradient
                  colors={[flashDesign.color.ink, "#36293D"]}
                  style={styles.foodCheckoutHero}
                >
                  <View style={styles.foodCheckoutHeroTop}>
                    <View style={styles.foodCheckoutVerified}>
                      <Ionicons name="shield-checkmark" size={15} color="#BDF3D7" />
                      <Text style={styles.foodCheckoutVerifiedText}>PRECIO FIRMADO</Text>
                    </View>
                    <Text style={styles.foodCheckoutExpiry}>
                      Hasta{" "}
                      {new Date(foodCheckoutQuote.expiresAt).toLocaleTimeString("es-AR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                  </View>
                  <Text style={styles.foodCheckoutMerchant}>{cartRestaurant?.name}</Text>
                  <Text style={styles.foodCheckoutEta}>
                    Llega en aproximadamente {foodCheckoutQuote.etaMin} min
                  </Text>
                  <View style={styles.foodCheckoutHeroFacts}>
                    <View>
                      <Text style={styles.foodCheckoutHeroFactLabel}>DISTANCIA</Text>
                      <Text style={styles.foodCheckoutHeroFactValue}>
                        {foodCheckoutQuote.distanceKm} km
                      </Text>
                    </View>
                    <View style={styles.foodCheckoutHeroDivider} />
                    <View style={styles.itemCopy}>
                      <Text style={styles.foodCheckoutHeroFactLabel}>TARIFA</Text>
                      <Text style={styles.foodCheckoutHeroFactValue} numberOfLines={1}>
                        {foodCheckoutQuote.pricingVersion}
                      </Text>
                    </View>
                  </View>
                </LinearGradient>
                <View style={styles.foodSectionHeader}>
                  <Text style={styles.foodSectionTitle}>Entrega y pago</Text>
                  <Pressable onPress={() => setFoodScreen("cart")}>
                    <Text style={styles.foodSeeAll}>Editar</Text>
                  </Pressable>
                </View>
                <View style={styles.foodCheckoutInfoList}>
                  <View style={styles.foodCheckoutInfoCard}>
                    <View
                      style={[
                        styles.foodCheckoutInfoIcon,
                        { backgroundColor: flashDesign.color.warningSoft },
                      ]}
                    >
                      <Ionicons name="location" size={20} color={flashDesign.color.food} />
                    </View>
                    <View style={styles.itemCopy}>
                      <Text style={styles.foodCheckoutInfoTitle}>Entregar en</Text>
                      <Text style={styles.foodCheckoutInfoValue} numberOfLines={2}>
                        {foodCheckoutQuote.deliveryAddress}
                      </Text>
                      <Text style={styles.foodCheckoutInfoMeta}>
                        Dirección validada con coordenadas
                      </Text>
                    </View>
                    <Ionicons
                      name="checkmark-circle"
                      size={21}
                      color={flashDesign.color.shipment}
                    />
                  </View>
                  <View style={styles.foodCheckoutInfoCard}>
                    <View style={[styles.foodCheckoutInfoIcon, { backgroundColor: "#EEE7FF" }]}>
                      <Ionicons
                        name={selectedFoodPayment?.type === "wallet" ? "wallet" : "card"}
                        size={20}
                        color={flashDesign.color.brand}
                      />
                    </View>
                    <View style={styles.itemCopy}>
                      <Text style={styles.foodCheckoutInfoTitle}>Pagar con</Text>
                      <Text style={styles.foodCheckoutInfoValue}>
                        {foodCheckoutQuote.paymentMethod}
                      </Text>
                      <Text style={styles.foodCheckoutInfoMeta}>
                        {selectedFoodPayment?.type === "wallet"
                          ? "Captura atómica al confirmar"
                          : "Token seguro · captura según proveedor"}
                      </Text>
                    </View>
                    <Ionicons
                      name="checkmark-circle"
                      size={21}
                      color={flashDesign.color.shipment}
                    />
                  </View>
                </View>
                <View style={styles.foodSectionHeader}>
                  <Text style={styles.foodSectionTitle}>Tu pedido</Text>
                  <Text style={styles.foodSeeAll}>
                    {foodCheckoutQuote.items.reduce((sum, item) => sum + item.quantity, 0)} unidades
                  </Text>
                </View>
                <View style={styles.foodCheckoutItems}>
                  {foodCheckoutQuote.items.map((item, index) => (
                    <View key={`${item.menuItemId}-${index}`} style={styles.checkoutItem}>
                      <View style={styles.foodCheckoutItemQuantity}>
                        <Text style={styles.foodCheckoutItemQuantityText}>{item.quantity}×</Text>
                      </View>
                      <View style={styles.itemCopy}>
                        <Text style={styles.foodCheckoutItemName}>{item.name}</Text>
                        {item.modifiers.map((modifier) => (
                          <Text key={modifier.id} style={styles.foodCheckoutItemMeta}>
                            + {modifier.name}
                            {modifier.price ? ` · ${money.format(modifier.price)}` : ""}
                          </Text>
                        ))}
                        {item.note ? (
                          <Text style={styles.foodCheckoutItemNote}>“{item.note}”</Text>
                        ) : null}
                      </View>
                      <Text style={styles.foodCheckoutItemPrice}>
                        {money.format(item.unitPrice * item.quantity)}
                      </Text>
                    </View>
                  ))}
                </View>
                <View style={styles.foodSectionHeader}>
                  <Text style={styles.foodSectionTitle}>Detalle del total</Text>
                  <Text style={styles.foodSeeAll}>ARS</Text>
                </View>
                <View style={styles.foodCheckoutTotals}>
                  <View style={styles.foodTotalRow}>
                    <Text style={styles.foodCheckoutTotalLabel}>Productos</Text>
                    <Text style={styles.foodCheckoutTotalAmount}>
                      {money.format(foodCheckoutQuote.subtotal)}
                    </Text>
                  </View>
                  <View style={styles.foodTotalRow}>
                    <Text style={styles.foodCheckoutTotalLabel}>Envío</Text>
                    <Text style={styles.foodCheckoutTotalAmount}>
                      {money.format(foodCheckoutQuote.deliveryFee)}
                    </Text>
                  </View>
                  <View style={styles.foodTotalRow}>
                    <Text style={styles.foodCheckoutTotalLabel}>Tarifa de servicio</Text>
                    <Text style={styles.foodCheckoutTotalAmount}>
                      {money.format(foodCheckoutQuote.serviceFee)}
                    </Text>
                  </View>
                  {foodCheckoutQuote.discount > 0 ? (
                    <View style={styles.foodTotalRow}>
                      <Text style={styles.foodCheckoutDiscountLabel}>
                        Descuento {foodCheckoutQuote.promotionCode}
                      </Text>
                      <Text style={styles.foodCheckoutDiscountAmount}>
                        − {money.format(foodCheckoutQuote.discount)}
                      </Text>
                    </View>
                  ) : null}
                  {/* El beneficio se nombra en vez de sumarse al descuento: quien
                      paga una suscripción tiene que ver qué le devolvió en cada
                      pedido, y esconderlo en «Descuento» lo borra. */}
                  {foodCheckoutQuote.subscriptionDiscount > 0 ? (
                    <View style={styles.foodTotalRow}>
                      <Text style={styles.foodCheckoutDiscountLabel}>Envío con Flash Más</Text>
                      <Text style={styles.foodCheckoutDiscountAmount}>
                        − {money.format(foodCheckoutQuote.subscriptionDiscount)}
                      </Text>
                    </View>
                  ) : null}
                  {/* Suma, no resta. Es la única línea que sube el total por
                      decisión de la persona, y por eso se nombra: verla dentro
                      del total sin nombrarla se siente un cargo que nadie eligió. */}
                  {foodTipCents > 0 ? (
                    <View style={styles.foodTotalRow}>
                      <Text style={styles.foodCheckoutTotalLabel}>Propina</Text>
                      <Text style={styles.foodCheckoutTotalAmount}>
                        {money.format(foodTipCents / 100)}
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.foodCheckoutTotalDivider} />
                  <View style={styles.foodTotalRow}>
                    <Text style={styles.foodCheckoutGrandLabel}>Total</Text>
                    <Text style={styles.foodCheckoutGrandAmount}>
                      {money.format(foodCheckoutQuote.total + foodTipCents / 100)}
                    </Text>
                  </View>
                </View>
                {/* El horario antes que la propina: primero cuándo llega,
                    después cuánto se deja. Al revés obligaría a repensar la
                    propina tras descubrir que el pedido es para mañana. */}
                <SchedulePicker
                  scheduledFor={foodScheduledFor}
                  onChange={setFoodScheduledFor}
                  disabled={busy}
                />
                {/* Antes del bloque de seguridad y del botón de confirmar: la
                    propina se elige mirando el total, no después de darlo por
                    bueno. */}
                <TipSelector
                  subtotal={foodCheckoutQuote.subtotal}
                  tipCents={foodTipCents}
                  onChange={setFoodTipCents}
                  orderTotal={foodCheckoutQuote.total}
                  disabled={busy}
                />
                <View style={styles.foodCheckoutSecurity}>
                  <View style={styles.foodCheckoutSecurityIcon}>
                    <Ionicons name="lock-closed" size={18} color={flashDesign.color.shipment} />
                  </View>
                  <Text style={styles.foodCheckoutSecurityText}>
                    Al confirmar, el servidor vuelve a validar stock, cupón, propiedad de la
                    dirección y monto firmado antes de cobrar.
                  </Text>
                </View>
                <Pressable
                  disabled={busy || new Date(foodCheckoutQuote.expiresAt) <= new Date()}
                  style={[
                    styles.foodCheckoutPrimary,
                    (busy || new Date(foodCheckoutQuote.expiresAt) <= new Date()) &&
                      styles.disabledButton,
                  ]}
                  onPress={createOrder}
                >
                  <Text style={styles.foodCheckoutPrimaryText}>
                    {busy ? "Confirmando…" : `Confirmar · ${money.format(foodCheckoutQuote.total)}`}
                  </Text>
                  <Ionicons name="arrow-forward" size={18} color="#fff" />
                </Pressable>
                {new Date(foodCheckoutQuote.expiresAt) <= new Date() ? (
                  <Pressable
                    disabled={busy}
                    style={styles.foodCheckoutRefresh}
                    onPress={openFoodCheckout}
                  >
                    <Ionicons name="refresh" size={17} color={flashDesign.color.food} />
                    <Text style={styles.foodCheckoutRefreshText}>
                      El precio venció · actualizar
                    </Text>
                  </Pressable>
                ) : null}
              </>
            )}

            {foodScreen === "orders" && (
              <>
                {lastCreatedOrder ? (
                  <LinearGradient
                    colors={["#FFF4E9", "#FFE7D6"]}
                    style={styles.orderConfirmationCard}
                  >
                    <View style={styles.orderConfirmationIcon}>
                      <Ionicons name="checkmark" size={29} color="#fff" />
                    </View>
                    <Text style={styles.orderConfirmationEyebrow}>PEDIDO CONFIRMADO</Text>
                    <Text style={styles.orderConfirmationTitle}>El comercio ya lo recibió</Text>
                    <Text style={styles.orderConfirmationCopy}>
                      Pedido {lastCreatedOrder.id} · entrega estimada en {lastCreatedOrder.etaMin}{" "}
                      min.
                    </Text>
                    <Text style={styles.orderConfirmationTotal}>
                      {money.format(lastCreatedOrder.total)}
                    </Text>
                    <Pressable
                      style={styles.orderConfirmationAction}
                      onPress={() => {
                        setLastCreatedOrder(null);
                        setSharedView("activity");
                      }}
                    >
                      <Text style={styles.orderConfirmationActionText}>Seguir en Actividad</Text>
                      <Ionicons name="arrow-forward" size={18} color="#fff" />
                    </Pressable>
                  </LinearGradient>
                ) : null}
                <View style={styles.foodPageHeader}>
                  <Pressable onPress={() => setFoodScreen("home")} style={styles.foodBack}>
                    <Ionicons name="chevron-back" size={20} color={flashDesign.color.ink} />
                  </Pressable>
                  <View style={styles.foodPageHeaderCopy}>
                    <Text style={styles.foodPageTitle}>Tus pedidos</Text>
                    <Text style={styles.foodPageSubtitle}>
                      Estado y próxima acción en tiempo real
                    </Text>
                  </View>
                </View>
                <View style={styles.foodSectionHeader}>
                  <Text style={styles.foodSectionTitle}>En curso</Text>
                  <Text style={styles.foodSeeAll}>{activeOrders.length} activos</Text>
                </View>
                {activeOrders.length === 0 && (
                  <View style={styles.foodEmpty}>
                    <View style={styles.foodEmptyIcon}>
                      <Ionicons name="receipt-outline" size={30} color={flashDesign.color.food} />
                    </View>
                    <Text style={styles.foodEmptyTitle}>No hay pedidos en curso</Text>
                    <Text style={styles.foodEmptyCopy}>
                      Cuando confirmes una compra, su preparación y entrega aparecerán acá y en
                      Actividad.
                    </Text>
                    <Pressable style={styles.foodEmptyAction} onPress={() => setFoodScreen("home")}>
                      <Text style={styles.foodEmptyActionText}>Explorar restaurantes</Text>
                    </Pressable>
                  </View>
                )}
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
                      <Pressable
                        style={styles.foodActiveOrderSecondary}
                        onPress={() =>
                          shareStatus(
                            "Pedido Flash",
                            `Mi pedido Flash está ${mobileOrderStatusLabel[order.status].toLowerCase()}. Entrega en ${order.deliveryAddress}.`,
                          )
                        }
                      >
                        <Ionicons
                          name="share-social-outline"
                          size={17}
                          color={flashDesign.color.food}
                        />
                        <Text style={styles.foodActiveOrderSecondaryText}>Compartir</Text>
                      </Pressable>
                      <Pressable
                        style={styles.foodActiveOrderPrimary}
                        onPress={() => setTrackingOrderId(order.id)}
                      >
                        <Ionicons name="map-outline" size={17} color="#fff" />
                        <Text style={styles.foodActiveOrderPrimaryText}>Ver seguimiento</Text>
                      </Pressable>
                    </View>
                    {/* Sólo mientras nadie empezó. Después el comercio ya está
                        cocinando o hay conductor en camino, y el servidor lo
                        rechaza: ofrecerlo igual sería prometer un 409. */}
                    {order.scheduledFor && ["requested", "accepted"].includes(order.status) ? (
                      <RescheduleControl
                        scheduledFor={order.scheduledFor}
                        disabled={busy}
                        onReschedule={(iso) =>
                          runAction(() => api.rescheduleJob(order.id, iso), "Pedido reprogramado")
                        }
                      />
                    ) : null}
                    {!["delivered", "cancelled"].includes(order.status) ? (
                      <Pressable
                        disabled={busy}
                        style={styles.foodActiveOrderCancel}
                        onPress={() => cancelService("order", order.id)}
                      >
                        <Text style={styles.foodActiveOrderCancelText}>Cancelar pedido</Text>
                        <Ionicons
                          name="chevron-forward"
                          size={16}
                          color={flashDesign.color.danger}
                        />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </>
            )}
          </>
        )}

        {sharedView === "service" && customerWindow === "ride" && (
          <>
            <View style={styles.rideHeading}>
              <View>
                <Text style={styles.rideEyebrow}>VIAJES</Text>
                <Text style={styles.rideTitle}>¿A dónde vamos?</Text>
              </View>
              <View style={styles.livePill}>
                <Text style={styles.livePillText}>{state.metrics.onlineDrivers} online</Text>
              </View>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickPlacesRail}
            >
              {rideQuickPlaces.map((place) => (
                <Pressable
                  key={place.id}
                  onPress={() => {
                    setDestination(place.address);
                    setDestinationCoords(place.point);
                    setRoadRoute(null);
                    setRideQuote(null);
                    setRideOptions([]);
                  }}
                  style={styles.quickPlace}
                >
                  <View style={styles.quickPlaceIcon}>
                    <Ionicons name={place.icon as never} size={18} color="#7c3cff" />
                  </View>
                  <View style={styles.quickPlaceCopy}>
                    <Text style={styles.quickPlaceTitle}>{place.label}</Text>
                    <Text style={styles.quickPlaceAddress} numberOfLines={1}>
                      {place.address}
                    </Text>
                  </View>
                  {place.recentId && (
                    <Pressable
                      hitSlop={8}
                      disabled={busy}
                      onPress={(event) => {
                        event.stopPropagation();
                        runAction(async () => {
                          const result = await api.deleteRideDestination(place.recentId!);
                          setRideDestinations(result.destinations);
                        }, "Destino reciente eliminado");
                      }}
                    >
                      <Ionicons name="close-circle" size={18} color="#a89ead" />
                    </Pressable>
                  )}
                </Pressable>
              ))}
              {rideQuickPlaces.length === 0 && (
                <View style={styles.quickPlaceEmpty}>
                  <Ionicons name="time-outline" size={18} color="#7c3cff" />
                  <Text style={styles.quickPlaceAddress}>
                    Tus destinos recientes aparecerán acá.
                  </Text>
                </View>
              )}
            </ScrollView>
            {pickupCoords && destinationCoords ? (
              <FlashNativeMap
                origin={pickupCoords}
                destination={destinationCoords}
                route={roadRoute?.coordinates || []}
                caption={
                  roadRoute
                    ? `Ruta real · ${roadRoute.distanceKm} km · ${roadRoute.durationMin} min`
                    : "Origen y destino confirmados"
                }
                detail={
                  roadRoute
                    ? "Arrastrá para explorar · tocá el control para reencuadrar"
                    : "Cotizá para calcular el recorrido vial"
                }
                routeColor="#7c3cff"
                height={210}
                accessibilityLabel="Mapa interactivo de la cotización del viaje"
              />
            ) : (
              <NativeMapUnavailable
                height={210}
                message={
                  !pickupCoords
                    ? "Usá GPS o elegí un origen para comenzar."
                    : "Elegí un destino para mostrar el recorrido."
                }
              />
            )}
            {roadRoute?.steps.length ? (
              <View style={styles.navigationCard}>
                <View style={styles.navigationTurn}>
                  <Ionicons
                    name={
                      roadRoute.steps[activeRoadStep]?.modifier.includes("left")
                        ? "arrow-back"
                        : roadRoute.steps[activeRoadStep]?.modifier.includes("right")
                          ? "arrow-forward"
                          : "arrow-up"
                    }
                    size={26}
                    color="#fff"
                  />
                </View>
                <View style={styles.itemCopy}>
                  <Text style={styles.navigationLabel}>
                    GUÍA DE RUTA · PASO {activeRoadStep + 1}/{roadRoute.steps.length}
                  </Text>
                  <Text style={styles.navigationInstruction}>
                    {navigationInstruction(roadRoute.steps[activeRoadStep])}
                  </Text>
                  <Text style={styles.helperText}>
                    En{" "}
                    {roadRoute.steps[activeRoadStep].distanceM < 1000
                      ? `${roadRoute.steps[activeRoadStep].distanceM} m`
                      : `${(roadRoute.steps[activeRoadStep].distanceM / 1000).toFixed(1)} km`}
                  </Text>
                </View>
                <Pressable
                  disabled={activeRoadStep >= roadRoute.steps.length - 1}
                  onPress={() =>
                    setActiveRoadStep((step) => Math.min(step + 1, roadRoute.steps.length - 1))
                  }
                  style={styles.navigationNext}
                >
                  <Ionicons name="chevron-forward" size={20} color="#7c3cff" />
                </Pressable>
              </View>
            ) : null}
            <View style={styles.rideSheet}>
              <TextInput
                value={pickup}
                onChangeText={(value) => {
                  setPickup(value);
                  setPickupCoords(null);
                }}
                placeholder="Origen"
                style={styles.input}
              />
              <Pressable onPress={useCurrentLocation} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>Usar mi ubicacion actual</Text>
              </Pressable>
              <TextInput
                value={destination}
                onChangeText={(value) => {
                  setDestination(value);
                  setDestinationCoords(null);
                  setRoadRoute(null);
                  setRideQuote(null);
                  setRideOptions([]);
                }}
                placeholder="Destino"
                style={styles.input}
              />
              {locationMessage ? <Text style={styles.helperText}>{locationMessage}</Text> : null}
              {rideOptions.map((option) => (
                <Pressable
                  key={option.service}
                  disabled={!option.available}
                  onPress={() => {
                    setRideService(option.service);
                    setRideQuote(option);
                  }}
                  style={[
                    styles.rideOption,
                    rideService === option.service && styles.rideOptionActive,
                    !option.available && styles.actionDisabled,
                  ]}
                >
                  <View style={styles.vehicleBadge}>
                    <Ionicons
                      name={option.service === "moto" ? "bicycle" : "car-sport"}
                      size={24}
                      color="#fff"
                    />
                  </View>
                  <View style={styles.rideOptionCopy}>
                    <Text style={styles.rideOptionTitle}>{option.label}</Text>
                    <Text style={styles.helperText}>
                      {option.description} · {option.capacity} pasajeros
                    </Text>
                    <Text style={styles.helperText}>
                      {option.available
                        ? `${option.pickupEtaMin} min · ${option.availableDrivers} conductores`
                        : "Sin conductores disponibles"}
                    </Text>
                  </View>
                  <Text style={styles.ridePrice}>{money.format(option.fare)}</Text>
                </Pressable>
              ))}
              {rideQuote && (
                <Text style={styles.routeSummary}>
                  {rideQuote.distanceKm} km · {rideQuote.durationMin} min
                </Text>
              )}
              {rideQuote?.breakdown && (
                <View style={styles.fareBreakdown}>
                  <View style={styles.fareBreakdownHeader}>
                    <View>
                      <Text style={styles.rideOptionTitle}>Precio adelantado</Text>
                      <Text style={styles.helperText}>
                        Bloqueado por 5 minutos · {rideQuote.pricingVersion}
                      </Text>
                    </View>
                    <Text style={styles.fareTotal}>{money.format(rideQuote.fare)}</Text>
                  </View>
                  <View style={styles.fareLine}>
                    <Text style={styles.cardText}>Base</Text>
                    <Text style={styles.cardText}>
                      {money.format(rideQuote.breakdown.baseFare)}
                    </Text>
                  </View>
                  <View style={styles.fareLine}>
                    <Text style={styles.cardText}>Distancia y tiempo estimados</Text>
                    <Text style={styles.cardText}>
                      {money.format(
                        rideQuote.breakdown.distanceFare + rideQuote.breakdown.timeFare,
                      )}
                    </Text>
                  </View>
                  <View style={styles.fareLine}>
                    <Text style={styles.cardText}>Tarifa de servicio</Text>
                    <Text style={styles.cardText}>
                      {money.format(rideQuote.breakdown.serviceFee)}
                    </Text>
                  </View>
                  {rideQuote.breakdown.demandAdjustment > 0 && (
                    <View style={styles.fareLine}>
                      <Text style={styles.demandText}>
                        Demanda actual ×{rideQuote.breakdown.demandMultiplier.toFixed(2)}
                      </Text>
                      <Text style={styles.demandText}>
                        {money.format(rideQuote.breakdown.demandAdjustment)}
                      </Text>
                    </View>
                  )}
                  {rideQuote.breakdown.tolls > 0 && (
                    <View style={styles.fareLine}>
                      <Text style={styles.cardText}>Peajes estimados</Text>
                      <Text style={styles.cardText}>{money.format(rideQuote.breakdown.tolls)}</Text>
                    </View>
                  )}
                </View>
              )}
              <Text style={styles.rideOptionTitle}>¿Cuándo viajás?</Text>
              <View style={styles.choiceRow}>
                {(
                  [
                    ["now", "Ahora"],
                    ["hour", "En 1 hora"],
                    ["tomorrow", "Mañana"],
                  ] as const
                ).map(([value, label]) => (
                  <Pressable
                    key={value}
                    onPress={() => setRideSchedule(value)}
                    style={[styles.choice, rideSchedule === value && styles.choiceActive]}
                  >
                    <Text
                      style={[styles.choiceText, rideSchedule === value && styles.choiceTextActive]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.actionRow}>
                <ActionButton label="Cotizar" disabled={busy} onPress={quoteRide} />
                <ActionButton
                  label="Solicitar"
                  disabled={busy || !rideQuote}
                  onPress={requestRide}
                />
              </View>
            </View>
            <View style={styles.safetyStrip}>
              <View style={styles.safetyIcon}>
                <Ionicons name="shield-checkmark" size={21} color="#087a4b" />
              </View>
              <View style={styles.itemCopy}>
                <Text style={styles.safetyTitle}>Tu seguridad, visible siempre</Text>
                <Text style={styles.helperText}>
                  Viaje identificado, ubicación compartible y soporte desde la actividad.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color="#8a858e" />
            </View>
            <View style={styles.newAddressForm}>
              <View style={styles.addressBookHeading}>
                <View>
                  <Text style={styles.rideOptionTitle}>Contactos de confianza</Text>
                  <Text style={styles.helperText}>
                    Hasta 5 personas. El teléfono queda cifrado y sólo se usa para ayudarte a
                    compartir.
                  </Text>
                </View>
                <Ionicons name="people-circle-outline" size={28} color="#7c3cff" />
              </View>
              {rideTrustedContacts.map((contact) => (
                <View key={contact.id} style={styles.quickPlace}>
                  <View style={styles.quickPlaceIcon}>
                    <Ionicons name="person" size={18} color="#7c3cff" />
                  </View>
                  <View style={styles.quickPlaceCopy}>
                    <Text style={styles.quickPlaceTitle}>{contact.name}</Text>
                    <Text style={styles.quickPlaceAddress}>
                      {contact.relationship} · •••• {contact.last4}
                    </Text>
                  </View>
                  <Pressable
                    disabled={busy}
                    onPress={() =>
                      runAction(async () => {
                        const result = await api.deleteRideTrustedContact(contact.id);
                        setRideTrustedContacts(result.contacts);
                      }, "Contacto eliminado")
                    }
                  >
                    <Ionicons name="close-circle-outline" size={22} color="#9a939d" />
                  </Pressable>
                </View>
              ))}
              {rideTrustedContacts.length < 5 && (
                <>
                  <TextInput
                    style={styles.input}
                    value={trustedContactName}
                    onChangeText={setTrustedContactName}
                    placeholder="Nombre del contacto"
                  />
                  <TextInput
                    style={styles.input}
                    value={trustedContactPhone}
                    onChangeText={(value) => setTrustedContactPhone(value.replace(/[^+0-9]/g, ""))}
                    keyboardType="phone-pad"
                    placeholder="+5491112345678"
                  />
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.paymentBrandRail}
                  >
                    {(
                      [
                        ["family", "Familia"],
                        ["friend", "Amistad"],
                        ["partner", "Pareja"],
                        ["coworker", "Trabajo"],
                        ["other", "Otro"],
                      ] as const
                    ).map(([value, label]) => (
                      <Pressable
                        key={value}
                        style={[
                          styles.issueCategoryPill,
                          trustedContactRelationship === value && styles.issueCategoryPillActive,
                        ]}
                        onPress={() => setTrustedContactRelationship(value)}
                      >
                        <Text
                          style={[
                            styles.issueCategoryText,
                            trustedContactRelationship === value && styles.issueCategoryTextActive,
                          ]}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                  <Pressable
                    disabled={
                      busy ||
                      trustedContactName.trim().length < 2 ||
                      !/^\+[1-9][0-9]{7,14}$/.test(trustedContactPhone)
                    }
                    style={[
                      styles.primaryButton,
                      (busy ||
                        trustedContactName.trim().length < 2 ||
                        !/^\+[1-9][0-9]{7,14}$/.test(trustedContactPhone)) &&
                        styles.disabledButton,
                    ]}
                    onPress={() =>
                      runAction(async () => {
                        const result = await api.createRideTrustedContact({
                          name: trustedContactName.trim(),
                          phone: trustedContactPhone,
                          relationship: trustedContactRelationship,
                        });
                        setRideTrustedContacts(result.contacts);
                        setTrustedContactName("");
                        setTrustedContactPhone("");
                      }, "Contacto protegido y guardado")
                    }
                  >
                    <Ionicons name="shield-checkmark-outline" size={18} color="#fff" />
                    <Text style={styles.primaryButtonText}>Guardar contacto seguro</Text>
                  </Pressable>
                </>
              )}
            </View>
            <Text style={styles.sectionTitle}>Viajes en curso</Text>
            {activeRides.map((ride) => (
              <View key={ride.id} style={styles.card}>
                <Text style={styles.cardTitle}>
                  {ride.scheduledFor ? "Viaje reservado" : ride.status}
                </Text>
                {ride.scheduledFor ? (
                  <Text style={styles.totalText}>
                    {new Date(ride.scheduledFor).toLocaleString("es-AR", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </Text>
                ) : null}
                <Text style={styles.cardText}>
                  {ride.pickup} → {ride.destination}
                </Text>
                <Text style={styles.totalText}>{money.format(ride.fare)}</Text>
                <Pressable
                  style={styles.orderConfirmationAction}
                  disabled={Boolean(ride.scheduledFor)}
                  onPress={() => setTrackingRideId(ride.id)}
                >
                  <Ionicons name="navigate-outline" size={18} color="#fff" />
                  <Text style={styles.orderConfirmationActionText}>
                    {ride.scheduledFor
                      ? "Seguimiento disponible al iniciar"
                      : "Abrir viaje en vivo"}
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.shareAction}
                  disabled={busy || Boolean(ride.scheduledFor)}
                  onPress={() => shareRideLive(ride)}
                >
                  <Ionicons name="share-social-outline" size={18} color="#7c3cff" />
                  <Text style={[styles.shareActionText, { color: "#7c3cff" }]}>
                    Compartir seguimiento en vivo
                  </Text>
                </Pressable>
                {rideTrustedContacts.length > 0 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.paymentBrandRail}
                  >
                    {rideTrustedContacts.map((contact) => (
                      <Pressable
                        key={contact.id}
                        style={styles.issueCategoryPill}
                        disabled={busy || Boolean(ride.scheduledFor)}
                        onPress={() => shareRideLive(ride, contact)}
                      >
                        <Ionicons name="person-outline" size={15} color="#7c3cff" />
                        <Text style={styles.issueCategoryText}>Enviar a {contact.name}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
                {!ride.scheduledFor && (
                  <Pressable
                    style={[styles.shareAction, { backgroundColor: "#fff0f0" }]}
                    disabled={busy}
                    onPress={() => confirmRideSos(ride)}
                  >
                    <Ionicons name="shield-checkmark" size={18} color="#c92626" />
                    <Text style={[styles.shareActionText, { color: "#c92626" }]}>
                      Seguridad · SOS
                    </Text>
                  </Pressable>
                )}
                <ActionButton
                  label="Cancelar viaje"
                  disabled={busy}
                  onPress={() => cancelService("ride", ride.id)}
                />
              </View>
            ))}
          </>
        )}

        {sharedView === "service" && customerWindow === "shipment" && (
          <>
            <View style={styles.shipmentHero}>
              <Text style={styles.rideEyebrow}>FLASH ENVIOS</Text>
              <Text style={styles.rideTitle}>Mandá algo hoy</Text>
              <Text style={styles.shipmentHeroCopy}>
                Entrega local en el día con seguimiento y PIN.
              </Text>
              <View style={styles.shipmentBenefits}>
                <Text style={styles.shipmentBenefit}>✓ Cotización previa</Text>
                <Text style={styles.shipmentBenefit}>✓ PIN de entrega</Text>
              </View>
            </View>
            {shipmentPickupCoords && shipmentDestinationCoords ? (
              <FlashNativeMap
                origin={shipmentPickupCoords}
                destination={shipmentDestinationCoords}
                route={shipmentRoadRoute?.coordinates || []}
                caption={
                  shipmentRoadRoute
                    ? `${shipmentRoadRoute.distanceKm} km · ${shipmentRoadRoute.durationMin} min de recorrido`
                    : "Retiro y entrega confirmados"
                }
                detail={
                  shipmentQuote
                    ? "Cotización vigente · recorrido real"
                    : "Cotizá para validar cobertura y recorrido"
                }
                routeColor="#087a50"
                driverIcon="bicycle"
                height={210}
                accessibilityLabel="Mapa interactivo de la cotización del envío"
              />
            ) : (
              <NativeMapUnavailable
                height={210}
                message="Ingresá direcciones y cotizá para validar el recorrido real."
              />
            )}
            <View style={styles.rideSheet}>
              <TextInput
                value={shipmentPickup}
                onChangeText={(value) => {
                  setShipmentPickup(value);
                  setShipmentQuote(null);
                  setShipmentPickupCoords(null);
                  setShipmentRoadRoute(null);
                }}
                placeholder="Retirar en"
                style={styles.input}
              />
              <TextInput
                value={shipmentDestination}
                onChangeText={(value) => {
                  setShipmentDestination(value);
                  setShipmentQuote(null);
                  setShipmentDestinationCoords(null);
                  setShipmentRoadRoute(null);
                }}
                placeholder="Entregar en"
                style={styles.input}
              />
              <View style={styles.choiceRow}>
                {(["small", "medium", "large"] as const).map((size) => (
                  <Pressable
                    key={size}
                    onPress={() => {
                      setPackageSize(size);
                      setShipmentQuote(null);
                    }}
                    style={[styles.choice, packageSize === size && styles.choiceActive]}
                  >
                    <Text
                      style={[styles.choiceText, packageSize === size && styles.choiceTextActive]}
                    >
                      {size === "small" ? "Chico" : size === "medium" ? "Mediano" : "Grande"}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={packageWeight}
                onChangeText={(value) => {
                  setPackageWeight(value);
                  setShipmentQuote(null);
                }}
                placeholder="Peso en kg (max. 20)"
                keyboardType="numeric"
                style={styles.input}
              />
              <Text style={styles.foodSectionTitle}>Qué enviás</Text>
              {!shipmentOptions && !shipmentOptionsError ? (
                <ActivityIndicator color="#7c3cff" />
              ) : null}
              {shipmentOptionsError ? (
                <Text style={styles.errorText}>{shipmentOptionsError}</Text>
              ) : null}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.shipmentOptionRail}
              >
                {(shipmentOptions?.categories || []).map((category) => (
                  <Pressable
                    key={category.code}
                    onPress={() => {
                      setShipmentItemCategory(category.code);
                      setShipmentQuote(null);
                    }}
                    style={[
                      styles.shipmentOptionCard,
                      shipmentItemCategory === category.code && styles.shipmentOptionCardActive,
                    ]}
                  >
                    <Ionicons
                      name={
                        category.code === "documents"
                          ? "document-text"
                          : category.code === "fragile"
                            ? "wine"
                            : category.code === "electronics"
                              ? "phone-portrait"
                              : "cube"
                      }
                      size={20}
                      color={shipmentItemCategory === category.code ? "#fff" : "#7c3cff"}
                    />
                    <Text
                      style={
                        shipmentItemCategory === category.code
                          ? styles.shipmentOptionTextActive
                          : styles.shipmentOptionText
                      }
                    >
                      {category.name}
                    </Text>
                    <Text
                      style={
                        shipmentItemCategory === category.code
                          ? styles.shipmentOptionMetaActive
                          : styles.shipmentOptionMeta
                      }
                    >
                      hasta {category.maximumWeightKg} kg
                      {category.surcharge ? ` · +${money.format(category.surcharge)}` : ""}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Text style={styles.foodSectionTitle}>Velocidad</Text>
              <View style={styles.shipmentSlaGrid}>
                {(shipmentOptions?.serviceLevels || []).map((level) => (
                  <Pressable
                    key={level.code}
                    onPress={() => {
                      setShipmentServiceLevel(level.code);
                      setShipmentQuote(null);
                    }}
                    style={[
                      styles.shipmentSlaCard,
                      shipmentServiceLevel === level.code && styles.shipmentSlaCardActive,
                    ]}
                  >
                    <Text
                      style={
                        shipmentServiceLevel === level.code
                          ? styles.shipmentSlaTitleActive
                          : styles.shipmentSlaTitle
                      }
                    >
                      {level.name}
                    </Text>
                    <Text
                      style={
                        shipmentServiceLevel === level.code
                          ? styles.shipmentSlaCaptionActive
                          : styles.shipmentSlaCaption
                      }
                    >
                      ETA ×{level.etaMultiplier}
                      {level.maximumDistanceKm ? ` · hasta ${level.maximumDistanceKm} km` : ""}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={declaredValue}
                onChangeText={(value) => {
                  setDeclaredValue(value.replace(/[^0-9]/g, ""));
                  setShipmentQuote(null);
                }}
                placeholder="Valor declarado (ARS)"
                keyboardType="numeric"
                style={styles.input}
              />
              <Pressable
                style={[
                  styles.shipmentProtectionCard,
                  shipmentProtection === "standard" && styles.shipmentProtectionCardActive,
                ]}
                onPress={() => {
                  setShipmentProtection((current) =>
                    current === "standard" ? "none" : "standard",
                  );
                  setShipmentQuote(null);
                }}
              >
                <View style={styles.shipmentProtectionIcon}>
                  <Ionicons name="shield-checkmark" size={21} color="#fff" />
                </View>
                <View style={styles.savedAddressCopy}>
                  <Text style={styles.sectionTitle}>Protección Flash</Text>
                  <Text style={styles.cardText}>
                    Prima calculada por servidor sobre el valor declarado.
                  </Text>
                </View>
                <Ionicons
                  name={shipmentProtection === "standard" ? "checkmark-circle" : "ellipse-outline"}
                  size={23}
                  color={shipmentProtection === "standard" ? "#087a50" : "#aaa"}
                />
              </Pressable>
              <Pressable
                style={[
                  styles.shipmentProtectionCard,
                  shipmentSignatureRequired && styles.shipmentProtectionCardActive,
                ]}
                onPress={() => {
                  setShipmentSignatureRequired((current) => !current);
                  setShipmentQuote(null);
                }}
              >
                <View style={[styles.shipmentProtectionIcon, { backgroundColor: "#17131c" }]}>
                  <Ionicons name="pencil" size={20} color="#fff" />
                </View>
                <View style={styles.savedAddressCopy}>
                  <Text style={styles.sectionTitle}>Exigir firma al entregar</Text>
                  <Text style={styles.cardText}>
                    El conductor no podrá completar sin foto, firma e identidad del receptor.
                  </Text>
                </View>
                <Ionicons
                  name={shipmentSignatureRequired ? "checkmark-circle" : "ellipse-outline"}
                  size={23}
                  color={shipmentSignatureRequired ? "#087a50" : "#aaa"}
                />
              </Pressable>
              <TextInput
                value={packageDescription}
                onChangeText={setPackageDescription}
                placeholder="Contenido general (sin datos sensibles)"
                style={styles.input}
              />
              <TextInput
                value={recipientName}
                onChangeText={setRecipientName}
                placeholder="Nombre del destinatario"
                style={styles.input}
              />
              <TextInput
                value={recipientPhone}
                onChangeText={setRecipientPhone}
                placeholder="Telefono del destinatario"
                keyboardType="phone-pad"
                style={styles.input}
              />
              <Text style={styles.helperText}>
                Debe estar cerrado, pesar hasta 20 kg y no contener dinero, armas, sustancias,
                medicamentos ni productos peligrosos.
              </Text>
              {shipmentQuote && (
                <View style={styles.quoteBox}>
                  <Text style={styles.cardTitle}>{money.format(shipmentQuote.fare)}</Text>
                  <Text style={styles.cardText}>
                    {shipmentQuote.distanceKm} km · llega en {shipmentQuote.etaMin} min
                  </Text>
                  <Text style={styles.protectionQuoteText}>
                    {shipmentQuote.serviceLevelName} · {shipmentQuote.itemCategoryName}
                  </Text>
                  {shipmentQuote.handlingInstructions ? (
                    <Text style={styles.helperText}>{shipmentQuote.handlingInstructions}</Text>
                  ) : null}
                  {shipmentQuote.protection === "standard" && (
                    <Text style={styles.protectionQuoteText}>
                      Protección {money.format(shipmentQuote.protectionPremium || 0)} · valor{" "}
                      {money.format(shipmentQuote.declaredValue || 0)} · franquicia{" "}
                      {money.format(shipmentQuote.deductible || 0)}
                    </Text>
                  )}
                </View>
              )}
              <View style={styles.actionRow}>
                <ActionButton label="Cotizar" disabled={busy} onPress={quoteShipment} />
                <ActionButton
                  label="Solicitar envio"
                  disabled={busy || !shipmentQuote}
                  onPress={createShipment}
                />
              </View>
            </View>
            <Text style={styles.sectionTitle}>Envios en curso</Text>
            {activeShipments.map((shipment) => (
              <View key={shipment.id} style={styles.card}>
                <Text style={styles.cardTitle}>{shipment.status}</Text>
                <Text style={styles.cardText}>
                  {shipment.pickup} → {shipment.destination}
                </Text>
                <Text style={styles.cardText}>Destinatario: {shipment.recipientName}</Text>
                {shipmentCodes[shipment.id] ? (
                  <Text style={styles.foodRestaurantTitle}>PIN {shipmentCodes[shipment.id]}</Text>
                ) : (
                  <ActionButton
                    label="Ver PIN de entrega"
                    disabled={busy}
                    onPress={() =>
                      runAction(async () => {
                        const response = await api.getShipmentDeliveryCode(shipment.id);
                        setShipmentCodes((current) => ({
                          ...current,
                          [shipment.id]: response.deliveryCode,
                        }));
                      }, "PIN disponible")
                    }
                  />
                )}
                <Text style={styles.totalText}>{money.format(shipment.fare)}</Text>
                <Pressable
                  style={styles.shareAction}
                  onPress={() =>
                    shareStatus(
                      "Envío Flash",
                      `Seguimiento ${shipment.id}: ${shipment.status}. Destino ${shipment.destination}.`,
                    )
                  }
                >
                  <Ionicons name="share-social-outline" size={18} color="#7c3cff" />
                  <Text style={[styles.shareActionText, { color: "#7c3cff" }]}>
                    Compartir seguimiento
                  </Text>
                </Pressable>
                <ActionButton
                  label="Cancelar envio"
                  disabled={busy}
                  onPress={() => cancelService("shipment", shipment.id)}
                />
              </View>
            ))}
          </>
        )}
        {sharedView === "activity" && (
          <CustomerActivityScreen
            restaurantId={cartRestaurant?.id ?? null}
            cart={cart}
            userId={user.id}
            busy={busy}
            activeOrders={activeOrders}
            activeRides={activeRides}
            activeShipments={activeShipments}
            pendingSubstitutions={pendingSubstitutions}
            completedServices={completedForTips}
            recentCancellations={recentCancellations}
            tips={state.tips || []}
            receipts={receipts}
            shipments={state.shipments}
            shipmentReturns={shipmentReturns}
            shipmentClaims={shipmentClaims}
            activityCursor={activityCursor}
            activityLoading={activityLoading}
            onCheckoutGroup={checkoutGroupOrder}
            runAction={runAction}
            onSubstitutionResolved={(resolved) =>
              setOrderSubstitutions((current) =>
                current.map((entry) => (entry.id === resolved.id ? resolved : entry)),
              )
            }
            onTrackOrder={setTrackingOrderId}
            onTrackRide={setTrackingRideId}
            onTrackShipment={setTrackingShipmentId}
            onChat={setChatJobId}
            onReceiptLoaded={(serviceId, receipt) =>
              setReceipts((current) => ({ ...current, [serviceId]: receipt }))
            }
            onReorderLoaded={(nextCart) => {
              setCart(nextCart);
              setCartHydrated(true);
              setCustomerWindow("food");
              setSharedView("service");
              setFoodScreen("cart");
            }}
            onReportOrderIssue={(orderId) => {
              setIssueOrderId(orderId);
              setIssueCategory("missing_item");
              setIssueDescription("");
              setIssueRefund("");
            }}
            onRequestReturn={(shipmentId) => {
              setReturnShipmentId(shipmentId);
              setReturnReason("");
            }}
            onOpenClaimEvidence={openClaimEvidence}
            onAttachClaimEvidence={attachClaimEvidence}
            onReportShipmentClaim={(shipmentId, declaredValue) => {
              setClaimShipmentId(shipmentId);
              setClaimType("damaged");
              setClaimDescription("");
              setClaimAmount(String(declaredValue));
            }}
            onLoadMore={() => void loadActivity(true)}
          />
        )}
        {sharedView === "account" && (
          <>
            <View style={styles.customerAccountHeading}>
              <View style={styles.itemCopy}>
                <Text style={styles.foodRestaurantTitle}>Tu cuenta</Text>
                <Text style={styles.cardText}>Datos utilizados por todos los servicios Flash.</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cerrar sesión"
                disabled={busy}
                onPress={() => void onLogout()}
                style={({ pressed }) => [
                  styles.customerLogoutButton,
                  (pressed || busy) && styles.disabledButton,
                ]}
              >
                <Ionicons name="log-out-outline" size={18} color="#27242a" />
                <Text style={styles.customerLogoutText}>Salir</Text>
              </Pressable>
            </View>
            {/* La suscripción va en Cuenta, que es donde la persona ya mira lo
                que paga, y arriba del perfil porque es lo que cambia el precio
                de todo lo demás. */}
            <SubscriptionCard busy={busy} />
            <View style={styles.accountCard}>
              <View style={styles.accountAvatar}>
                <Text style={styles.accountInitial}>{user.name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <Text style={styles.foodRestaurantTitle}>{user.name}</Text>
              <Text style={styles.cardText}>{user.email}</Text>
              <View style={styles.accountDetail}>
                <Ionicons name="location-outline" size={20} color="#7c3cff" />
                <Text style={styles.cardText}>
                  {user.defaultAddress || "Sin dirección guardada"}
                </Text>
              </View>
              <View style={styles.accountDetail}>
                <Ionicons name="wallet-outline" size={20} color="#7c3cff" />
                <Text style={styles.totalText}>Wallet {money.format(user.wallet)}</Text>
              </View>
            </View>
            <View style={styles.addressBookCard}>
              <View style={styles.addressBookHeading}>
                <View style={styles.savedAddressCopy}>
                  <Text style={styles.foodRestaurantTitle}>Teléfono de seguridad</Text>
                  <Text style={styles.cardText}>
                    {user.phone || "Agregá un teléfono internacional desde tu perfil."}
                  </Text>
                </View>
                <Ionicons
                  name={phoneVerified ? "checkmark-circle" : "shield-outline"}
                  size={28}
                  color={phoneVerified ? "#087a50" : "#7c3cff"}
                />
              </View>
              {phoneVerified ? (
                <View style={styles.dietarySafetyNote}>
                  <Ionicons name="checkmark-circle-outline" size={19} color="#087a50" />
                  <Text style={styles.cardText}>
                    Número verificado. Si lo cambiás, Flash solicitará una verificación nueva.
                  </Text>
                </View>
              ) : user.phone ? (
                <>
                  <Text style={styles.cardText}>
                    Confirmá que tenés acceso a este número. El código vence en 10 minutos y admite
                    cinco intentos.
                  </Text>
                  <TextInput
                    value={phoneVerificationCode}
                    onChangeText={(value) =>
                      setPhoneVerificationCode(value.replace(/\D/g, "").slice(0, 6))
                    }
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="sms-otp"
                    maxLength={6}
                    placeholder="Código de 6 dígitos"
                    style={styles.input}
                  />
                  <Pressable
                    disabled={busy || phoneVerificationCode.length !== 6}
                    style={[
                      styles.primaryButton,
                      (busy || phoneVerificationCode.length !== 6) && styles.disabledButton,
                    ]}
                    onPress={() =>
                      runAction(async () => {
                        await api.confirmPhoneVerification(phoneVerificationCode);
                        setPhoneVerified(true);
                        setPhoneVerificationCode("");
                      }, "Teléfono verificado")
                    }
                  >
                    <Ionicons name="shield-checkmark-outline" size={19} color="#fff" />
                    <Text style={styles.primaryButtonText}>Verificar teléfono</Text>
                  </Pressable>
                  <Pressable
                    disabled={busy || phoneRetrySeconds > 0}
                    style={[
                      styles.secondaryButton,
                      (busy || phoneRetrySeconds > 0) && styles.disabledButton,
                    ]}
                    onPress={() =>
                      runAction(async () => {
                        const result = await api.requestPhoneVerification();
                        setPhoneVerificationCode(result.developmentCode || "");
                        setPhoneRetrySeconds(result.retryAfterSeconds);
                      }, "Código solicitado")
                    }
                  >
                    <Ionicons name="chatbubble-ellipses-outline" size={18} color="#7c3cff" />
                    <Text style={styles.secondaryButtonText}>
                      {phoneRetrySeconds > 0
                        ? `Reenviar en ${phoneRetrySeconds}s`
                        : "Enviar código por SMS"}
                    </Text>
                  </Pressable>
                </>
              ) : null}
            </View>
            <View style={styles.addressBookCard}>
              <View style={styles.addressBookHeading}>
                <View style={styles.savedAddressCopy}>
                  <Text style={styles.foodRestaurantTitle}>Dispositivos y sesiones</Text>
                  <Text style={styles.cardText}>
                    Cerrá accesos que no reconozcas. Flash nunca muestra tus credenciales.
                  </Text>
                </View>
                <Ionicons name="shield-checkmark-outline" size={26} color="#087a50" />
              </View>
              {accountSessions.length ? (
                accountSessions.map((session) => (
                  <View key={session.id} style={styles.notificationRow}>
                    <View style={styles.notificationBell}>
                      <Ionicons name="phone-portrait-outline" size={20} color="#fff" />
                    </View>
                    <View style={styles.savedAddressCopy}>
                      <Text style={styles.sectionTitle}>{session.deviceName}</Text>
                      <Text style={styles.notificationTime}>
                        Iniciada {new Date(session.createdAt).toLocaleString("es-AR")} · vence{" "}
                        {new Date(session.expiresAt).toLocaleDateString("es-AR")}
                      </Text>
                    </View>
                    <Pressable
                      disabled={busy}
                      accessibilityLabel={`Cerrar sesión ${session.deviceName}`}
                      onPress={() =>
                        Alert.alert(
                          "Cerrar sesión",
                          `¿Cerrar el acceso de ${session.deviceName}?`,
                          [
                            { text: "Cancelar", style: "cancel" },
                            {
                              text: "Cerrar",
                              style: "destructive",
                              onPress: () =>
                                runAction(async () => {
                                  await api.revokeAccountSession(session.id);
                                  setAccountSessions((current) =>
                                    current.filter((item) => item.id !== session.id),
                                  );
                                }, "Sesión cerrada"),
                            },
                          ],
                        )
                      }
                    >
                      <Ionicons name="log-out-outline" size={21} color="#c43b36" />
                    </Pressable>
                  </View>
                ))
              ) : (
                <Text style={styles.cardText}>No hay otras sesiones activas para mostrar.</Text>
              )}
              {accountSessions.length > 1 ? (
                <Pressable
                  disabled={busy}
                  style={styles.secondaryButton}
                  onPress={() =>
                    Alert.alert(
                      "Proteger cuenta",
                      "Se cerrarán todas las sesiones excepto la de este dispositivo.",
                      [
                        { text: "Cancelar", style: "cancel" },
                        {
                          text: "Cerrar las demás",
                          style: "destructive",
                          onPress: () =>
                            runAction(async () => {
                              await api.revokeOtherAccountSessions();
                              const result = await api.getAccountSessions();
                              setAccountSessions(result.sessions);
                            }, "Las demás sesiones fueron cerradas"),
                        },
                      ],
                    )
                  }
                >
                  <Ionicons name="lock-closed-outline" size={18} color="#7c3cff" />
                  <Text style={styles.secondaryButtonText}>Cerrar las demás sesiones</Text>
                </Pressable>
              ) : null}
            </View>
            {referral && (
              <View style={styles.addressBookCard}>
                <View style={styles.addressBookHeading}>
                  <View style={styles.savedAddressCopy}>
                    <Text style={styles.foodRestaurantTitle}>Invitá y ganá</Text>
                    <Text style={styles.cardText}>
                      {referral.campaign
                        ? `Vos recibís ${money.format(referral.campaign.advocateReward)} y tu amistad ${money.format(referral.campaign.friendReward)} después de su primer servicio pagado.`
                        : "No hay una campaña activa ahora."}
                    </Text>
                  </View>
                  <Ionicons name="gift-outline" size={27} color="#7c3cff" />
                </View>
                <View style={styles.shipmentPinCard}>
                  <Text style={styles.orderConfirmationEyebrow}>TU CÓDIGO</Text>
                  <Text style={styles.referralCode}>{referral.code}</Text>
                  <Text style={styles.helperText}>
                    {referral.invited} invitaciones · {referral.rewarded} recompensadas
                  </Text>
                </View>
                <Pressable
                  disabled={!referral.campaign}
                  style={[styles.primaryButton, !referral.campaign && styles.disabledButton]}
                  onPress={() =>
                    Share.share({
                      message: `Sumate a Flash con mi código ${referral.code}. La recompensa se acredita después de tu primer servicio pagado.`,
                    })
                  }
                >
                  <Ionicons name="share-social-outline" size={19} color="#fff" />
                  <Text style={styles.primaryButtonText}>Compartir invitación</Text>
                </Pressable>
                {referral.attribution ? (
                  <View style={styles.dietarySafetyNote}>
                    <Ionicons
                      name={
                        referral.attribution.status === "rewarded"
                          ? "checkmark-circle-outline"
                          : "time-outline"
                      }
                      size={18}
                      color="#087a50"
                    />
                    <Text style={styles.cardText}>
                      {referral.attribution.status === "rewarded"
                        ? "Tu recompensa de referido ya fue acreditada en Wallet."
                        : "Código aplicado. Se acredita al completar tu primer servicio pagado."}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.newAddressForm}>
                    <Text style={styles.sectionTitle}>¿Te invitó alguien?</Text>
                    <TextInput
                      value={referralClaim}
                      onChangeText={(value) => setReferralClaim(value.toUpperCase())}
                      autoCapitalize="characters"
                      maxLength={13}
                      placeholder="FLASHXXXXXXXX"
                      style={styles.input}
                    />
                    <Pressable
                      disabled={busy || !/^FLASH[A-Z0-9]{8}$/.test(referralClaim)}
                      style={[
                        styles.primaryButton,
                        (busy || !/^FLASH[A-Z0-9]{8}$/.test(referralClaim)) &&
                          styles.disabledButton,
                      ]}
                      onPress={() =>
                        runAction(async () => {
                          const result = await api.claimReferral(referralClaim);
                          setReferral(result.referral);
                          setReferralClaim("");
                        }, "Código aplicado; la recompensa queda pendiente del primer servicio")
                      }
                    >
                      <Ionicons name="ticket-outline" size={19} color="#fff" />
                      <Text style={styles.primaryButtonText}>Aplicar código</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}
            <View style={styles.addressBookCard}>
              <View style={styles.addressBookHeading}>
                <View>
                  <Text style={styles.foodRestaurantTitle}>Preferencias alimentarias</Text>
                  <Text style={styles.cardText}>
                    Se guardan en tu cuenta y ayudan a ocultar incompatibles.
                  </Text>
                </View>
                <Ionicons name="leaf-outline" size={25} color="#087a50" />
              </View>
              <Text style={styles.sectionTitle}>Mi alimentación</Text>
              <View style={styles.dietaryPreferenceGrid}>
                {[
                  { code: "vegetarian", name: "Vegetariano" },
                  { code: "vegan", name: "Vegano" },
                  { code: "gluten_free", name: "Sin gluten" },
                  { code: "halal", name: "Halal" },
                  { code: "kosher", name: "Kosher" },
                ].map((option) => {
                  const selected = dietaryPreferences.dietaryLabels.some(
                    (entry) => entry.code === option.code,
                  );
                  return (
                    <Pressable
                      key={option.code}
                      style={[
                        styles.dietaryPreferenceChip,
                        selected && styles.dietaryPreferenceChipActive,
                      ]}
                      onPress={() => {
                        const dietaryLabels = selected
                          ? dietaryPreferences.dietaryLabels
                              .filter((entry) => entry.code !== option.code)
                              .map((entry) => entry.code)
                          : [
                              ...dietaryPreferences.dietaryLabels.map((entry) => entry.code),
                              option.code,
                            ];
                        runAction(async () => {
                          const result = await api.updateDietaryPreferences({
                            dietaryLabels,
                            avoidedAllergens: dietaryPreferences.avoidedAllergens.map(
                              (entry) => entry.code,
                            ),
                            hideIncompatible: dietaryPreferences.hideIncompatible,
                          });
                          setDietaryPreferences(result.preferences);
                        }, "Preferencias alimentarias actualizadas");
                      }}
                    >
                      <Text
                        style={[
                          styles.dietaryPreferenceText,
                          selected && styles.dietaryPreferenceTextActive,
                        ]}
                      >
                        {option.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.sectionTitle}>Evito estos alérgenos</Text>
              <View style={styles.dietaryPreferenceGrid}>
                {[
                  { code: "gluten", name: "Gluten" },
                  { code: "milk", name: "Leche" },
                  { code: "eggs", name: "Huevo" },
                  { code: "peanuts", name: "Maní" },
                  { code: "tree_nuts", name: "Frutos secos" },
                  { code: "soy", name: "Soja" },
                  { code: "fish", name: "Pescado" },
                  { code: "shellfish", name: "Crustáceos" },
                  { code: "sesame", name: "Sésamo" },
                ].map((option) => {
                  const selected = dietaryPreferences.avoidedAllergens.some(
                    (entry) => entry.code === option.code,
                  );
                  return (
                    <Pressable
                      key={option.code}
                      style={[
                        styles.dietaryPreferenceChip,
                        selected && styles.dietaryAllergenChipActive,
                      ]}
                      onPress={() => {
                        const avoidedAllergens = selected
                          ? dietaryPreferences.avoidedAllergens
                              .filter((entry) => entry.code !== option.code)
                              .map((entry) => entry.code)
                          : [
                              ...dietaryPreferences.avoidedAllergens.map((entry) => entry.code),
                              option.code,
                            ];
                        runAction(async () => {
                          const result = await api.updateDietaryPreferences({
                            dietaryLabels: dietaryPreferences.dietaryLabels.map(
                              (entry) => entry.code,
                            ),
                            avoidedAllergens,
                            hideIncompatible: dietaryPreferences.hideIncompatible,
                          });
                          setDietaryPreferences(result.preferences);
                        }, "Alérgenos actualizados");
                      }}
                    >
                      <Text
                        style={[
                          styles.dietaryPreferenceText,
                          selected && styles.dietaryAllergenTextActive,
                        ]}
                      >
                        {option.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.preferenceRow}>
                <View style={styles.savedAddressCopy}>
                  <Text style={styles.sectionTitle}>Ocultar productos incompatibles</Text>
                  <Text style={styles.cardText}>
                    Sólo usa declaraciones del comercio; “sin datos” nunca significa seguro.
                  </Text>
                </View>
                <Pressable
                  disabled={busy}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: dietaryPreferences.hideIncompatible }}
                  style={[
                    styles.preferenceSwitch,
                    dietaryPreferences.hideIncompatible && styles.preferenceSwitchActive,
                  ]}
                  onPress={() =>
                    runAction(async () => {
                      const result = await api.updateDietaryPreferences({
                        dietaryLabels: dietaryPreferences.dietaryLabels.map((entry) => entry.code),
                        avoidedAllergens: dietaryPreferences.avoidedAllergens.map(
                          (entry) => entry.code,
                        ),
                        hideIncompatible: !dietaryPreferences.hideIncompatible,
                      });
                      setDietaryPreferences(result.preferences);
                    }, "Filtro alimentario actualizado")
                  }
                >
                  <View
                    style={[
                      styles.preferenceKnob,
                      dietaryPreferences.hideIncompatible && styles.preferenceKnobActive,
                    ]}
                  />
                </Pressable>
              </View>
              <View style={styles.dietarySafetyNote}>
                <Ionicons name="information-circle-outline" size={18} color="#9a4b00" />
                <Text style={styles.allergenWarningText}>
                  Ante una alergia severa, confirmá siempre con el comercio. Las indicaciones de
                  cocina no eliminan contaminación cruzada.
                </Text>
              </View>
            </View>
            <View style={styles.addressBookCard}>
              <View style={styles.addressBookHeading}>
                <View>
                  <Text style={styles.foodRestaurantTitle}>Notificaciones</Text>
                  <Text style={styles.cardText}>
                    {notifications.filter((item) => !item.readAt).length} sin leer · historial
                    persistente
                  </Text>
                </View>
                <View style={styles.notificationBell}>
                  <Ionicons name="notifications-outline" size={22} color="#fff" />
                </View>
              </View>
              {notifications.slice(0, 8).map((item) => {
                const titles: Record<string, string> = {
                  order_status: "Actualización del pedido",
                  ride_status: "Actualización del viaje",
                  shipment_status: "Actualización del envío",
                  order_substitution: "El comercio propone un cambio",
                  order_issue_resolved: "Incidencia resuelta",
                  tip_received: "Recibiste una propina",
                  support_reply: "Nueva respuesta de soporte",
                  support_ticket_created: "Caso de soporte creado",
                };
                return (
                  <Pressable
                    key={item.id}
                    disabled={Boolean(item.readAt) || busy}
                    onPress={() =>
                      runAction(async () => {
                        const result = await api.markNotificationRead(item.id);
                        setNotifications(result.notifications);
                      }, "Notificación leída")
                    }
                    style={[styles.notificationRow, !item.readAt && styles.notificationUnread]}
                  >
                    <View style={styles.notificationStatusDot} />
                    <View style={styles.savedAddressCopy}>
                      <Text style={styles.sectionTitle}>
                        {titles[item.template] || "Novedad de Flash"}
                      </Text>
                      <Text style={styles.cardText}>
                        {String(
                          item.payload.status ||
                            item.payload.kind ||
                            "Revisá la actividad de tu cuenta",
                        )}
                      </Text>
                      <Text style={styles.notificationTime}>
                        {new Date(item.createdAt).toLocaleString("es-AR")}
                      </Text>
                    </View>
                    {!item.readAt && <Text style={styles.notificationNew}>NUEVA</Text>}
                  </Pressable>
                );
              })}
              {!notifications.length && (
                <View style={styles.notificationEmpty}>
                  <Ionicons name="checkmark-circle-outline" size={27} color="#087a50" />
                  <Text style={styles.cardText}>
                    Estás al día. Las novedades reales aparecerán acá.
                  </Text>
                </View>
              )}
              <View style={styles.preferenceGroup}>
                <Text style={styles.sectionTitle}>Preferencias push</Text>
                {notificationPreferences.map((preference) => {
                  const labels = {
                    service_updates: "Servicios",
                    promotions: "Promociones",
                    support: "Soporte",
                    wallet: "Wallet",
                    account: "Cuenta",
                  };
                  return (
                    <View style={styles.preferenceRow} key={preference.category}>
                      <View>
                        <Text style={styles.sectionTitle}>{labels[preference.category]}</Text>
                        <Text style={styles.cardText}>
                          {preference.pushEnabled ? "Push activado" : "Sólo dentro de la app"}
                        </Text>
                      </View>
                      <Pressable
                        disabled={busy}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: preference.pushEnabled }}
                        style={[
                          styles.preferenceSwitch,
                          preference.pushEnabled && styles.preferenceSwitchActive,
                        ]}
                        onPress={() =>
                          runAction(async () => {
                            const result = await api.updateNotificationPreference(
                              preference.category,
                              {
                                pushEnabled: !preference.pushEnabled,
                                emailEnabled: preference.emailEnabled,
                              },
                            );
                            setNotificationPreferences(result.preferences);
                          }, "Preferencia actualizada")
                        }
                      >
                        <View
                          style={[
                            styles.preferenceKnob,
                            preference.pushEnabled && styles.preferenceKnobActive,
                          ]}
                        />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            </View>
            <View style={styles.addressBookCard}>
              <View style={styles.addressBookHeading}>
                <View>
                  <Text style={styles.foodRestaurantTitle}>Ayuda y soporte</Text>
                  <Text style={styles.cardText}>Casos reales con seguimiento y SLA.</Text>
                </View>
                <Ionicons name="headset-outline" size={25} color="#7c3cff" />
              </View>
              {state.supportTickets
                .filter((ticket) => ticket.userId === user.id)
                .map((ticket) => (
                  <View style={styles.supportTicketCard} key={ticket.id}>
                    <View style={styles.supportTicketHeader}>
                      <View style={styles.savedAddressCopy}>
                        <Text style={styles.sectionTitle}>{ticket.title}</Text>
                        <Text style={styles.cardText}>
                          {ticket.id} · {ticket.status.replaceAll("_", " ")}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.supportSla,
                          ticket.slaStatus.includes("breached") && styles.supportSlaLate,
                        ]}
                      >
                        {ticket.slaStatus === "on_track"
                          ? "EN SLA"
                          : ticket.slaStatus === "met"
                            ? "RESUELTO"
                            : "DEMORADO"}
                      </Text>
                    </View>
                    <Text style={styles.notificationTime}>
                      Respuesta antes de{" "}
                      {new Date(ticket.firstResponseDueAt).toLocaleString("es-AR")}
                    </Text>
                    <View style={styles.supportMessages}>
                      {ticket.messages.map((message) => (
                        <View
                          key={message.id}
                          style={[
                            styles.supportMessage,
                            message.senderId === user.id
                              ? styles.supportMessageOwn
                              : styles.supportMessageStaff,
                          ]}
                        >
                          <Text
                            style={[
                              styles.supportMessageText,
                              message.senderId === user.id && styles.supportMessageTextOwn,
                            ]}
                          >
                            {message.body}
                          </Text>
                          <Text
                            style={[
                              styles.supportMessageTime,
                              message.senderId === user.id && styles.supportMessageTextOwn,
                            ]}
                          >
                            {new Date(message.createdAt).toLocaleTimeString("es-AR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </Text>
                        </View>
                      ))}
                    </View>
                    {!["resolved", "closed"].includes(ticket.status) && (
                      <View style={styles.supportReplyRow}>
                        <TextInput
                          style={[styles.input, styles.supportReplyInput]}
                          value={supportReplies[ticket.id] || ""}
                          onChangeText={(value) =>
                            setSupportReplies((current) => ({ ...current, [ticket.id]: value }))
                          }
                          placeholder="Escribí una respuesta"
                        />
                        <Pressable
                          disabled={busy || (supportReplies[ticket.id] || "").trim().length < 1}
                          style={[
                            styles.supportSendButton,
                            (busy || (supportReplies[ticket.id] || "").trim().length < 1) &&
                              styles.disabledButton,
                          ]}
                          onPress={() =>
                            runAction(async () => {
                              await api.sendSupportMessage(
                                ticket.id,
                                (supportReplies[ticket.id] || "").trim(),
                              );
                              setSupportReplies((current) => ({ ...current, [ticket.id]: "" }));
                            }, "Respuesta enviada")
                          }
                        >
                          <Ionicons name="send" size={18} color="#fff" />
                        </Pressable>
                      </View>
                    )}
                  </View>
                ))}
              <View style={styles.newAddressForm}>
                <Text style={styles.sectionTitle}>Abrir un caso</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.paymentBrandRail}
                >
                  {(
                    [
                      ["food", "Comida"],
                      ["ride", "Viaje"],
                      ["shipment", "Envío"],
                      ["payment", "Pago"],
                      ["account", "Cuenta"],
                      ["safety", "Seguridad"],
                      ["other", "Otro"],
                    ] as const
                  ).map(([value, label]) => (
                    <Pressable
                      key={value}
                      style={[
                        styles.issueCategoryPill,
                        supportCategory === value && styles.issueCategoryPillActive,
                      ]}
                      onPress={() => setSupportCategory(value)}
                    >
                      <Text
                        style={[
                          styles.issueCategoryText,
                          supportCategory === value && styles.issueCategoryTextActive,
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <TextInput
                  style={styles.input}
                  value={supportSubject}
                  onChangeText={setSupportSubject}
                  placeholder="Resumen del problema"
                />
                <TextInput
                  multiline
                  numberOfLines={4}
                  style={[styles.input, styles.issueDescriptionInput]}
                  value={supportBody}
                  onChangeText={setSupportBody}
                  placeholder="Contanos qué pasó con el mayor detalle posible"
                />
                <Pressable
                  disabled={
                    busy || supportSubject.trim().length < 4 || supportBody.trim().length < 4
                  }
                  style={[
                    styles.primaryButton,
                    (busy || supportSubject.trim().length < 4 || supportBody.trim().length < 4) &&
                      styles.disabledButton,
                  ]}
                  onPress={() =>
                    runAction(async () => {
                      await api.createSupportTicket({
                        category: supportCategory,
                        priority: supportCategory === "safety" ? "urgent" : "normal",
                        subject: supportSubject.trim(),
                        body: supportBody.trim(),
                      });
                      setSupportSubject("");
                      setSupportBody("");
                    }, "Caso creado; operaciones ya puede verlo")
                  }
                >
                  <Ionicons name="chatbox-ellipses-outline" size={19} color="#fff" />
                  <Text style={styles.primaryButtonText}>Enviar a soporte</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.addressBookCard}>
              <View style={styles.addressBookHeading}>
                <View>
                  <Text style={styles.foodRestaurantTitle}>Direcciones guardadas</Text>
                  <Text style={styles.cardText}>Se comparten entre comidas, viajes y envíos.</Text>
                </View>
                <Ionicons name="map-outline" size={24} color="#7c3cff" />
              </View>
              {state.addresses
                .filter((item) => item.userId === user.id)
                .map((item) => (
                  <View style={styles.savedAddressRow} key={item.id}>
                    <View
                      style={[
                        styles.savedAddressIcon,
                        item.isDefault && styles.savedAddressIconDefault,
                      ]}
                    >
                      <Ionicons
                        name={
                          item.label.toLowerCase().includes("trab")
                            ? "business-outline"
                            : "home-outline"
                        }
                        size={19}
                        color={item.isDefault ? "#fff" : "#7c3cff"}
                      />
                    </View>
                    <Pressable
                      style={styles.savedAddressCopy}
                      onPress={() => {
                        setDeliveryAddress(item.address);
                        setPickup(item.address);
                        setShipmentPickup(item.address);
                        setShipmentQuote(null);
                        setShipmentRoadRoute(null);
                        if (item.lat !== null && item.lng !== null) {
                          const point = { lat: item.lat, lng: item.lng };
                          setPickupCoords(point);
                          setShipmentPickupCoords(point);
                        }
                      }}
                    >
                      <View style={styles.savedAddressTitle}>
                        <Text style={styles.sectionTitle}>{item.label}</Text>
                        {item.isDefault && (
                          <Text style={styles.defaultAddressBadge}>Principal</Text>
                        )}
                      </View>
                      <Text style={styles.cardText}>{item.address}</Text>
                    </Pressable>
                    {!item.id.startsWith("profile-") && (
                      <View style={styles.savedAddressActions}>
                        {!item.isDefault && (
                          <Pressable
                            disabled={busy}
                            onPress={() =>
                              runAction(
                                () => api.setDefaultAddress(item.id),
                                "Dirección principal actualizada",
                              )
                            }
                          >
                            <Ionicons name="star-outline" size={20} color="#7c3cff" />
                          </Pressable>
                        )}
                        <Pressable
                          disabled={busy}
                          onPress={() =>
                            Alert.alert("Eliminar dirección", `¿Eliminar ${item.label}?`, [
                              { text: "Cancelar", style: "cancel" },
                              {
                                text: "Eliminar",
                                style: "destructive",
                                onPress: () =>
                                  runAction(
                                    () => api.deleteAddress(item.id),
                                    "Dirección eliminada",
                                  ),
                              },
                            ])
                          }
                        >
                          <Ionicons name="trash-outline" size={20} color="#d74a43" />
                        </Pressable>
                      </View>
                    )}
                  </View>
                ))}
              <View style={styles.newAddressForm}>
                <Text style={styles.sectionTitle}>Agregar dirección</Text>
                <View style={styles.newAddressFields}>
                  <TextInput
                    style={[styles.input, styles.addressLabelInput]}
                    value={newAddressLabel}
                    onChangeText={setNewAddressLabel}
                    placeholder="Etiqueta"
                  />
                  <TextInput
                    style={[styles.input, styles.addressTextInput]}
                    value={newAddressText}
                    onChangeText={setNewAddressText}
                    placeholder="Calle, número y ciudad"
                  />
                </View>
                <Pressable
                  style={[
                    styles.primaryButton,
                    (!newAddressLabel.trim() || newAddressText.trim().length < 3 || busy) &&
                      styles.disabledButton,
                  ]}
                  disabled={!newAddressLabel.trim() || newAddressText.trim().length < 3 || busy}
                  onPress={() =>
                    runAction(async () => {
                      const result = await api.geocode(newAddressText.trim());
                      const match = result.results[0];
                      if (!match) throw new Error("No encontramos esa dirección");
                      await api.createAddress({
                        label: newAddressLabel.trim(),
                        address: match.label,
                        lat: match.point.lat,
                        lng: match.point.lng,
                        isDefault: !state.addresses.some(
                          (item) => item.userId === user.id && !item.id.startsWith("profile-"),
                        ),
                      });
                      setDeliveryAddress(match.label);
                      setPickup(match.label);
                      setPickupCoords(match.point);
                      setShipmentPickup(match.label);
                      setShipmentPickupCoords(match.point);
                      setShipmentQuote(null);
                      setShipmentRoadRoute(null);
                      setNewAddressText("");
                    }, "Dirección guardada con coordenadas reales")
                  }
                >
                  <Ionicons name="add-circle-outline" size={19} color="#fff" />
                  <Text style={styles.primaryButtonText}>Guardar dirección</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.addressBookCard}>
              <View style={styles.addressBookHeading}>
                <View>
                  <Text style={styles.foodRestaurantTitle}>Métodos de pago</Text>
                  <Text style={styles.cardText}>Sólo guardamos tokens y datos enmascarados.</Text>
                </View>
                <Ionicons name="card-outline" size={24} color="#7c3cff" />
              </View>
              {state.paymentMethods
                .filter((method) => method.userId === user.id)
                .map((method) => (
                  <View style={styles.paymentMethodRow} key={method.id}>
                    <View
                      style={[
                        styles.savedAddressIcon,
                        method.isDefault && styles.savedAddressIconDefault,
                      ]}
                    >
                      <Ionicons
                        name={method.type === "wallet" ? "wallet-outline" : "card-outline"}
                        size={19}
                        color={method.isDefault ? "#fff" : "#7c3cff"}
                      />
                    </View>
                    <View style={styles.savedAddressCopy}>
                      <View style={styles.savedAddressTitle}>
                        <Text style={styles.sectionTitle}>{method.label}</Text>
                        {method.isDefault && (
                          <Text style={styles.defaultAddressBadge}>Principal</Text>
                        )}
                      </View>
                      {method.expiryMonth && (
                        <Text style={styles.cardText}>
                          Vence {String(method.expiryMonth).padStart(2, "0")}/{method.expiryYear}
                        </Text>
                      )}
                    </View>
                    {method.type !== "wallet" && (
                      <View style={styles.savedAddressActions}>
                        {!method.isDefault && (
                          <Pressable
                            disabled={busy}
                            onPress={() =>
                              runAction(
                                () => api.setDefaultPaymentMethod(method.id),
                                "Método principal actualizado",
                              )
                            }
                          >
                            <Ionicons name="star-outline" size={20} color="#7c3cff" />
                          </Pressable>
                        )}
                        <Pressable
                          disabled={busy}
                          onPress={() =>
                            Alert.alert("Eliminar método", `¿Eliminar ${method.label}?`, [
                              { text: "Cancelar", style: "cancel" },
                              {
                                text: "Eliminar",
                                style: "destructive",
                                onPress: () =>
                                  runAction(
                                    () => api.deletePaymentMethod(method.id),
                                    "Método eliminado",
                                  ),
                              },
                            ])
                          }
                        >
                          <Ionicons name="trash-outline" size={20} color="#d74a43" />
                        </Pressable>
                      </View>
                    )}
                  </View>
                ))}
              <View style={styles.newAddressForm}>
                <Text style={styles.sectionTitle}>Agregar tarjeta sandbox</Text>
                <Text style={styles.cardText}>
                  El SDK del PSP genera el token; Flash nunca recibe el número completo ni el CVV.
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.paymentBrandRail}
                >
                  {(["visa", "mastercard", "amex", "cabal"] as const).map((brand) => (
                    <Pressable
                      key={brand}
                      style={[
                        styles.issueCategoryPill,
                        paymentBrand === brand && styles.issueCategoryPillActive,
                      ]}
                      onPress={() => setPaymentBrand(brand)}
                    >
                      <Text
                        style={[
                          styles.issueCategoryText,
                          paymentBrand === brand && styles.issueCategoryTextActive,
                        ]}
                      >
                        {brand.toUpperCase()}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <TextInput
                  style={styles.input}
                  value={paymentToken}
                  onChangeText={setPaymentToken}
                  autoCapitalize="none"
                  placeholder="pm_test_token_seguro"
                />
                <View style={styles.paymentCompactFields}>
                  <TextInput
                    style={[styles.input, styles.paymentCompactInput]}
                    value={paymentLast4}
                    onChangeText={(value) =>
                      setPaymentLast4(value.replace(/[^0-9]/g, "").slice(0, 4))
                    }
                    keyboardType="numeric"
                    placeholder="Últimos 4"
                  />
                  <TextInput
                    style={[styles.input, styles.paymentCompactInput]}
                    value={paymentExpiry}
                    onChangeText={(value) =>
                      setPaymentExpiry(value.replace(/[^0-9/]/g, "").slice(0, 7))
                    }
                    keyboardType="numeric"
                    placeholder="MM/AAAA"
                  />
                </View>
                <Pressable
                  disabled={
                    busy ||
                    !/^pm_test_[A-Za-z0-9_-]{8,120}$/.test(paymentToken) ||
                    paymentLast4.length !== 4 ||
                    !/^\d{2}\/\d{4}$/.test(paymentExpiry)
                  }
                  style={[
                    styles.primaryButton,
                    (busy ||
                      !/^pm_test_[A-Za-z0-9_-]{8,120}$/.test(paymentToken) ||
                      paymentLast4.length !== 4 ||
                      !/^\d{2}\/\d{4}$/.test(paymentExpiry)) &&
                      styles.disabledButton,
                  ]}
                  onPress={() => {
                    const [month, year] = paymentExpiry.split("/").map(Number);
                    runAction(async () => {
                      await api.createSandboxPaymentMethod({
                        providerToken: paymentToken,
                        brand: paymentBrand,
                        last4: paymentLast4,
                        expiryMonth: month,
                        expiryYear: year,
                      });
                      setPaymentToken("");
                      setPaymentLast4("");
                      setPaymentExpiry("");
                    }, "Método tokenizado agregado");
                  }}
                >
                  <Ionicons name="shield-checkmark-outline" size={19} color="#fff" />
                  <Text style={styles.primaryButtonText}>Guardar token seguro</Text>
                </Pressable>
              </View>
            </View>
          </>
        )}
      </ScrollView>
      <OrderTrackingSheet
        order={
          state.orders.find(
            (order) => order.id === trackingOrderId && order.customerId === user.id,
          ) || null
        }
        driver={
          state.drivers.find(
            (driver) =>
              driver.id === state.orders.find((order) => order.id === trackingOrderId)?.courierId,
          ) || null
        }
        onClose={() => setTrackingOrderId(null)}
      />
      <RideTrackingSheet
        ride={
          state.rides.find((ride) => ride.id === trackingRideId && ride.customerId === user.id) ||
          null
        }
        driver={
          state.drivers.find(
            (driver) =>
              driver.id === state.rides.find((ride) => ride.id === trackingRideId)?.driverId,
          ) || null
        }
        contacts={rideTrustedContacts}
        pickupCode={trackingRideId ? ridePickupCodes[trackingRideId] || null : null}
        onRevealCode={async () => {
          if (!trackingRideId) return;
          const result = await api.getRidePickupCode(trackingRideId);
          setRidePickupCodes((current) => ({ ...current, [trackingRideId]: result.pickupCode }));
        }}
        onShare={(contact) => {
          const ride = state.rides.find((entry) => entry.id === trackingRideId);
          if (ride) shareRideLive(ride, contact);
        }}
        onSos={() => {
          const ride = state.rides.find((entry) => entry.id === trackingRideId);
          if (ride) confirmRideSos(ride);
        }}
        onCancel={() => {
          if (trackingRideId) cancelService("ride", trackingRideId);
        }}
        onClose={() => setTrackingRideId(null)}
      />
      <ShipmentTrackingSheet
        shipment={
          state.shipments.find(
            (shipment) => shipment.id === trackingShipmentId && shipment.customerId === user.id,
          ) || null
        }
        driver={
          state.drivers.find(
            (driver) =>
              driver.id ===
              state.shipments.find((shipment) => shipment.id === trackingShipmentId)?.driverId,
          ) || null
        }
        shipmentReturn={
          shipmentReturns.find((entry) => entry.shipmentId === trackingShipmentId) || null
        }
        pin={trackingShipmentId ? shipmentCodes[trackingShipmentId] || null : null}
        onRevealPin={async () => {
          if (!trackingShipmentId) return;
          const response = await api.getShipmentDeliveryCode(trackingShipmentId);
          setShipmentCodes((current) => ({
            ...current,
            [trackingShipmentId]: response.deliveryCode,
          }));
        }}
        onClose={() => setTrackingShipmentId(null)}
      />
      <ServiceChatModal
        jobId={chatJobId}
        currentUserId={user.id}
        onClose={() => setChatJobId(null)}
      />
      <Modal
        transparent
        visible={Boolean(returnShipmentId)}
        animationType="slide"
        onRequestClose={() => setReturnShipmentId(null)}
      >
        <View style={styles.issueModalBackdrop}>
          <View style={styles.issueModalSheet}>
            <View style={styles.issueModalHandle} />
            <View style={styles.issueModalHeader}>
              <View>
                <Text style={styles.substitutionEyebrow}>LOGÍSTICA INVERSA</Text>
                <Text style={styles.foodRestaurantTitle}>Solicitar devolución</Text>
              </View>
              <Pressable style={styles.issueModalClose} onPress={() => setReturnShipmentId(null)}>
                <Ionicons name="close" size={21} color="#403a43" />
              </Pressable>
            </View>
            <Text style={styles.cardText}>
              Operaciones validará el motivo antes de programar el retiro.
            </Text>
            <TextInput
              multiline
              numberOfLines={4}
              value={returnReason}
              onChangeText={setReturnReason}
              maxLength={500}
              placeholder="Explicá por qué necesitás devolver el envío"
              style={[styles.input, styles.issueDescriptionInput]}
            />
            <Pressable
              disabled={busy || returnReason.trim().length < 5}
              style={[
                styles.issueSubmitButton,
                (busy || returnReason.trim().length < 5) && styles.disabledButton,
              ]}
              onPress={() => {
                const shipmentId = returnShipmentId;
                if (!shipmentId) return;
                runAction(async () => {
                  const result = await api.requestShipmentReturn(shipmentId, returnReason.trim());
                  setShipmentReturns((current) => [result.return, ...current]);
                  setReturnShipmentId(null);
                  setReturnReason("");
                }, "Solicitud de devolución registrada");
              }}
            >
              <Ionicons name="return-down-back" size={18} color="#fff" />
              <Text style={styles.issueSubmitText}>Enviar solicitud</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        visible={Boolean(claimShipmentId)}
        animationType="slide"
        onRequestClose={() => setClaimShipmentId(null)}
      >
        <View style={styles.issueModalBackdrop}>
          <View style={styles.issueModalSheet}>
            <View style={styles.issueModalHandle} />
            <View style={styles.issueModalHeader}>
              <View>
                <Text style={styles.substitutionEyebrow}>PROTECCIÓN FLASH</Text>
                <Text style={styles.foodRestaurantTitle}>Reportar siniestro</Text>
              </View>
              <Pressable style={styles.issueModalClose} onPress={() => setClaimShipmentId(null)}>
                <Ionicons name="close" size={21} color="#403a43" />
              </Pressable>
            </View>
            <Text style={styles.cardText}>
              La cobertura y franquicia se validan contra el contrato del envío. La aprobación no
              simula un pago externo.
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.issueCategoryRail}
            >
              {(
                [
                  ["lost", "Extraviado"],
                  ["damaged", "Dañado"],
                  ["stolen", "Robado"],
                ] as const
              ).map(([value, label]) => (
                <Pressable
                  key={value}
                  style={[
                    styles.issueCategoryPill,
                    claimType === value && styles.issueCategoryPillActive,
                  ]}
                  onPress={() => setClaimType(value)}
                >
                  <Text
                    style={[
                      styles.issueCategoryText,
                      claimType === value && styles.issueCategoryTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <TextInput
              multiline
              numberOfLines={4}
              value={claimDescription}
              onChangeText={setClaimDescription}
              maxLength={1000}
              placeholder="Describí qué ocurrió y qué evidencia tenés"
              style={[styles.input, styles.issueDescriptionInput]}
            />
            <TextInput
              value={claimAmount}
              onChangeText={(value) => setClaimAmount(value.replace(/[^0-9]/g, ""))}
              keyboardType="numeric"
              placeholder="Monto reclamado"
              style={styles.input}
            />
            <Pressable
              disabled={busy || claimDescription.trim().length < 10 || !Number(claimAmount)}
              style={[
                styles.issueSubmitButton,
                (busy || claimDescription.trim().length < 10 || !Number(claimAmount)) &&
                  styles.disabledButton,
              ]}
              onPress={() => {
                const shipmentId = claimShipmentId;
                if (!shipmentId) return;
                runAction(async () => {
                  const result = await api.createShipmentClaim(shipmentId, {
                    claimType,
                    description: claimDescription.trim(),
                    requestedAmount: Number(claimAmount),
                  });
                  setShipmentClaims((current) => [result.claim, ...current]);
                  setClaimShipmentId(null);
                }, "Siniestro registrado para revisión");
              }}
            >
              <Ionicons name="shield-checkmark-outline" size={18} color="#fff" />
              <Text style={styles.issueSubmitText}>Enviar reclamo</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        visible={Boolean(issueOrderId)}
        animationType="slide"
        onRequestClose={() => setIssueOrderId(null)}
      >
        <View style={styles.issueModalBackdrop}>
          <View style={styles.issueModalSheet}>
            <View style={styles.issueModalHandle} />
            <View style={styles.issueModalHeader}>
              <View>
                <Text style={styles.substitutionEyebrow}>Ayuda con tu pedido</Text>
                <Text style={styles.foodRestaurantTitle}>Reportar un problema</Text>
              </View>
              <Pressable style={styles.issueModalClose} onPress={() => setIssueOrderId(null)}>
                <Ionicons name="close" size={21} color="#403a43" />
              </Pressable>
            </View>
            <Text style={styles.cardText}>
              Operaciones revisará el caso y, si corresponde, realizará un reintegro parcial a tu
              Wallet.
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.issueCategoryRail}
            >
              {(
                [
                  ["missing_item", "Faltó un producto"],
                  ["wrong_item", "Producto incorrecto"],
                  ["damaged_item", "Llegó dañado"],
                  ["quality", "Problema de calidad"],
                  ["late", "Demora"],
                  ["other", "Otro"],
                ] as const
              ).map(([value, label]) => (
                <Pressable
                  key={value}
                  style={[
                    styles.issueCategoryPill,
                    issueCategory === value && styles.issueCategoryPillActive,
                  ]}
                  onPress={() => setIssueCategory(value)}
                >
                  <Text
                    style={[
                      styles.issueCategoryText,
                      issueCategory === value && styles.issueCategoryTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={styles.issueFieldLabel}>Contanos qué pasó</Text>
            <TextInput
              multiline
              numberOfLines={4}
              value={issueDescription}
              onChangeText={setIssueDescription}
              placeholder="Ej.: faltaron las papas del combo"
              style={[styles.input, styles.issueDescriptionInput]}
            />
            <Text style={styles.issueFieldLabel}>Reintegro solicitado</Text>
            <View style={styles.issueMoneyInput}>
              <Text style={styles.issueMoneyPrefix}>$</Text>
              <TextInput
                value={issueRefund}
                onChangeText={(value) => setIssueRefund(value.replace(/[^0-9]/g, ""))}
                keyboardType="numeric"
                placeholder="0"
                style={styles.issueMoneyTextInput}
              />
            </View>
            <View style={styles.issueSecurityNote}>
              <Ionicons name="shield-checkmark-outline" size={18} color="#087a50" />
              <Text style={styles.issueSecurityText}>
                No se mueve dinero hasta que operaciones valide la evidencia y el importe.
              </Text>
            </View>
            <Pressable
              disabled={
                busy || issueDescription.trim().length < 5 || !Number(issueRefund) || !issueOrderId
              }
              style={[
                styles.issueSubmitButton,
                (busy || issueDescription.trim().length < 5 || !Number(issueRefund)) &&
                  styles.disabledButton,
              ]}
              onPress={() => {
                const orderId = issueOrderId;
                if (!orderId) return;
                runAction(async () => {
                  await api.createOrderIssue(orderId, {
                    category: issueCategory,
                    description: issueDescription.trim(),
                    requestedRefund: Number(issueRefund),
                  });
                  setIssueOrderId(null);
                  setIssueDescription("");
                  setIssueRefund("");
                }, "Incidencia enviada a operaciones");
              }}
            >
              <Ionicons name="paper-plane-outline" size={18} color="#fff" />
              <Text style={styles.issueSubmitText}>Enviar incidencia</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <View style={styles.foodBottomNav}>
        <Pressable
          onPress={() => {
            setSharedView("service");
            setFoodScreen("home");
          }}
          style={styles.foodBottomItem}
        >
          <Ionicons
            name="home-outline"
            size={21}
            color={sharedView === "service" && foodScreen === "home" ? "#ff6a21" : "#9c989f"}
          />
          <Text
            style={[
              styles.foodBottomLabel,
              sharedView === "service" && foodScreen === "home" && styles.foodBottomLabelActive,
            ]}
          >
            Inicio
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setSharedView("service");
            if (customerWindow === "food") setFoodScreen("search");
          }}
          style={styles.foodBottomItem}
        >
          <Ionicons
            name="search-outline"
            size={21}
            color={sharedView === "service" && foodScreen === "search" ? "#ff6a21" : "#9c989f"}
          />
          <Text
            style={[
              styles.foodBottomLabel,
              sharedView === "service" && foodScreen === "search" && styles.foodBottomLabelActive,
            ]}
          >
            Buscar
          </Text>
        </Pressable>
        <Pressable onPress={() => setSharedView("activity")} style={styles.foodBottomItem}>
          <Ionicons
            name="time-outline"
            size={21}
            color={sharedView === "activity" ? "#ff6a21" : "#9c989f"}
          />
          <Text
            style={[
              styles.foodBottomLabel,
              sharedView === "activity" && styles.foodBottomLabelActive,
            ]}
          >
            Actividad
          </Text>
        </Pressable>
        <Pressable onPress={() => setSharedView("account")} style={styles.foodBottomItem}>
          <Ionicons
            name="person-outline"
            size={21}
            color={sharedView === "account" ? "#ff6a21" : "#9c989f"}
          />
          <Text
            style={[
              styles.foodBottomLabel,
              sharedView === "account" && styles.foodBottomLabelActive,
            ]}
          >
            Cuenta
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
