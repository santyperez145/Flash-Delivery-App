// Coordinador del cliente (ticket ARC-001). El shell, Actividad, Cuenta, Viajes,
// Envíos y las hojas de seguimiento ya viven en módulos separados; este archivo
// conserva la coordinación de Comidas durante la extracción.

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
import { TipSelector } from "../TipSelector";
import { RescheduleControl, SchedulePicker } from "../SchedulePicker";
import { flashDesign } from "../design-system";
import { mobileOrderStatusLabel, money } from "../format";
import { styles } from "../styles";
import { ActionButton, ServiceChatModal } from "../ui";
import { CustomerActivityScreen } from "./CustomerActivityScreen";
import { CustomerAccountScreen } from "./CustomerAccountScreen";
import { CustomerRideScreen } from "./CustomerRideScreen";
import { CustomerShipmentScreen } from "./CustomerShipmentScreen";
import {
  OrderTrackingSheet,
  RideTrackingSheet,
  ShipmentTrackingSheet,
} from "./CustomerTrackingSheets";
import type {
  AppState,
  DietaryPreferences,
  FoodCheckoutQuote,
  GeoPoint,
  MobileCartLine,
  GroupOrder as GroupOrderType,
  Order,
  OrderSubstitution,
  Restaurant,
  Ride,
  RideTrustedContact,
  ServiceReceipt,
  Shipment,
  ShipmentClaim,
  ShipmentReturn,
  User,
} from "../types";

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
  const [rideAddressSelection, setRideAddressSelection] = useState<{
    address: string;
    point: GeoPoint | null;
  } | null>(null);
  const [shipmentAddressSelection, setShipmentAddressSelection] = useState<{
    address: string;
    point: GeoPoint | null;
  } | null>(null);
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
  const [rideTrustedContacts, setRideTrustedContacts] = useState<RideTrustedContact[]>([]);
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

        <CustomerRideScreen
          visible={sharedView === "service" && customerWindow === "ride"}
          addresses={state.addresses}
          onlineDrivers={state.metrics.onlineDrivers}
          user={user}
          busy={busy}
          runAction={runAction}
          activeRides={activeRides}
          trustedContacts={rideTrustedContacts}
          selectedAddress={rideAddressSelection}
          onTrustedContactsChange={setRideTrustedContacts}
          onOpenTracking={setTrackingRideId}
          onShareRide={shareRideLive}
          onSos={confirmRideSos}
          onCancelRide={(rideId) => cancelService("ride", rideId)}
        />

        <CustomerShipmentScreen
          visible={sharedView === "service" && customerWindow === "shipment"}
          addresses={state.addresses}
          user={user}
          busy={busy}
          runAction={runAction}
          activeShipments={activeShipments}
          shipmentCodes={shipmentCodes}
          selectedAddress={shipmentAddressSelection}
          onCodeRevealed={(shipmentId, code) =>
            setShipmentCodes((current) => ({ ...current, [shipmentId]: code }))
          }
          onShareStatus={shareStatus}
          onCancelShipment={(shipmentId) => cancelService("shipment", shipmentId)}
        />
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
        <CustomerAccountScreen
          visible={sharedView === "account"}
          state={state}
          user={user}
          busy={busy}
          runAction={runAction}
          onLogout={onLogout}
          dietaryPreferences={dietaryPreferences}
          setDietaryPreferences={setDietaryPreferences}
          onUseAddress={(address, point) => {
            setDeliveryAddress(address);
            setRideAddressSelection({ address, point });
            setShipmentAddressSelection({ address, point });
          }}
        />
      </ScrollView>
      <OrderTrackingSheet
        order={
          activityOrders.find(
            (order) => order.id === trackingOrderId && order.customerId === user.id,
          ) || null
        }
        driver={
          state.drivers.find(
            (driver) =>
              driver.id === activityOrders.find((order) => order.id === trackingOrderId)?.courierId,
          ) || null
        }
        onClose={() => setTrackingOrderId(null)}
      />
      <RideTrackingSheet
        ride={
          activityRides.find((ride) => ride.id === trackingRideId && ride.customerId === user.id) ||
          null
        }
        driver={
          state.drivers.find(
            (driver) =>
              driver.id === activityRides.find((ride) => ride.id === trackingRideId)?.driverId,
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
          const ride = activityRides.find((entry) => entry.id === trackingRideId);
          if (ride) shareRideLive(ride, contact);
        }}
        onSos={() => {
          const ride = activityRides.find((entry) => entry.id === trackingRideId);
          if (ride) confirmRideSos(ride);
        }}
        onCancel={() => {
          if (trackingRideId) cancelService("ride", trackingRideId);
        }}
        onClose={() => setTrackingRideId(null)}
      />
      <ShipmentTrackingSheet
        shipment={
          activityShipments.find(
            (shipment) => shipment.id === trackingShipmentId && shipment.customerId === user.id,
          ) || null
        }
        driver={
          state.drivers.find(
            (driver) =>
              driver.id ===
              activityShipments.find((shipment) => shipment.id === trackingShipmentId)?.driverId,
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
