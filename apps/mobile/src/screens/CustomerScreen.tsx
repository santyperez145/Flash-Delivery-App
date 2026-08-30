// Coordinador del cliente (ticket ARC-001). El shell, Actividad, Cuenta, Viajes,
// Envíos y las hojas de seguimiento ya viven en módulos separados; este archivo
// conserva la coordinación de Comidas durante la extracción.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Location from "expo-location";
import * as Sharing from "expo-sharing";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, Text, View } from "react-native";

import { track } from "../analytics";
import { api } from "../api";
import { flashDesign } from "../design-system";
import { mobileOrderStatusLabel, money } from "../format";
import { styles } from "../styles";
import { ActionButton, ServiceChatModal } from "../ui";
import { CustomerActivityScreen } from "./CustomerActivityScreen";
import { CustomerAccountScreen } from "./CustomerAccountScreen";
import { CustomerFoodBrowseScreen, type CatalogSearchResult } from "./CustomerFoodBrowseScreen";
import { CustomerFoodCartScreen } from "./CustomerFoodCartScreen";
import { CustomerFoodCheckoutScreen } from "./CustomerFoodCheckoutScreen";
import { CustomerFoodOrdersScreen } from "./CustomerFoodOrdersScreen";
import { CustomerFoodRestaurantScreen } from "./CustomerFoodRestaurantScreen";
import { CustomerRideScreen } from "./CustomerRideScreen";
import { CustomerShipmentScreen } from "./CustomerShipmentScreen";
import {
  CustomerServiceIssueModals,
  type CustomerServiceIssueState,
} from "./CustomerServiceIssueModals";
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
  const [shipmentReturns, setShipmentReturns] = useState<ShipmentReturn[]>([]);
  const [shipmentClaims, setShipmentClaims] = useState<ShipmentClaim[]>([]);
  const [serviceIssue, setServiceIssue] = useState<CustomerServiceIssueState>({ kind: "none" });
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
            <CustomerFoodBrowseScreen
              screen={foodScreen}
              user={user}
              deliveryAddress={deliveryAddress}
              cart={cart}
              promotion={activeFoodPromotion}
              promotionValue={foodPromotionValue}
              categories={foodCategories}
              selectedCategory={foodCategory}
              favoriteRestaurants={favoriteRestaurants}
              restaurants={openRestaurants}
              favoriteRestaurantIds={favoriteRestaurantIds}
              favoritePendingId={favoritePendingId}
              query={foodQuery}
              catalogResults={catalogResults}
              catalogLoading={catalogSearchLoading}
              catalogError={catalogSearchError}
              catalogNextOffset={catalogNextOffset}
              onOpenAccount={() => setSharedView("account")}
              onOpenCart={() => setFoodScreen("cart")}
              onHome={() => setFoodScreen("home")}
              onOpenSearch={() => setFoodScreen("search")}
              onPromotionAction={(code) => {
                if (code) setFoodPromotionCode(code);
                setFoodScreen(cart.length ? "cart" : "search");
              }}
              onSelectCategory={setFoodCategory}
              onOpenRestaurant={(restaurantId) => {
                setSelectedRestaurantId(restaurantId);
                setFoodScreen("restaurant");
              }}
              onToggleFavorite={(restaurantId) => void toggleFavorite(restaurantId)}
              onQueryChange={setFoodQuery}
              onRetrySearch={() => setCatalogSearchNonce((current) => current + 1)}
              onLoadMore={() => {
                if (catalogNextOffset === null) return;
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
            />
            <CustomerFoodRestaurantScreen
              visible={foodScreen === "restaurant"}
              restaurant={selectedRestaurant}
              menuCategories={foodMenuCategories}
              selectedMenuCategory={foodMenuCategory}
              visibleMenuItems={visibleFoodMenuItems}
              dietaryPreferences={dietaryPreferences}
              favorite={Boolean(
                selectedRestaurant && favoriteRestaurantIds.includes(selectedRestaurant.id),
              )}
              favoritePending={Boolean(
                selectedRestaurant && favoritePendingId === selectedRestaurant.id,
              )}
              cartCount={cart.reduce((sum, line) => sum + line.quantity, 0)}
              cartTotal={cartTotal}
              busy={busy}
              onHome={() => setFoodScreen("home")}
              onToggleFavorite={(restaurantId) => void toggleFavorite(restaurantId)}
              onSelectMenuCategory={setFoodMenuCategory}
              onAddItem={addItem}
              onOpenCart={() => setFoodScreen("cart")}
            />
            <CustomerFoodCartScreen
              visible={foodScreen === "cart"}
              cart={cart}
              restaurant={cartRestaurant}
              addresses={state.addresses}
              userId={user.id}
              deliveryAddress={deliveryAddress}
              paymentMethods={customerPaymentMethods}
              selectedPayment={selectedFoodPayment}
              promotion={activeFoodPromotion}
              promotionCode={foodPromotionCode}
              subtotal={cartTotal}
              busy={busy}
              canCheckout={Boolean(selectedFoodAddress && selectedFoodPayment)}
              onBack={() => setFoodScreen(selectedRestaurant ? "restaurant" : "home")}
              onHome={() => setFoodScreen("home")}
              onOpenRestaurant={(restaurantId) => {
                setSelectedRestaurantId(restaurantId);
                setFoodScreen("restaurant");
              }}
              onChangeQuantity={changeCartQuantity}
              onSelectAddress={(address) => {
                setDeliveryAddress(address);
                setFoodCheckoutQuote(null);
              }}
              onOpenAccount={() => setSharedView("account")}
              onSelectPayment={(paymentMethodId) => {
                setSelectedFoodPaymentId(paymentMethodId);
                setFoodCheckoutQuote(null);
              }}
              onPromotionChange={(code) => {
                setFoodPromotionCode(code);
                setFoodCheckoutQuote(null);
              }}
              onCheckout={openFoodCheckout}
            />
            <CustomerFoodCheckoutScreen
              visible={foodScreen === "checkout"}
              quote={foodCheckoutQuote}
              restaurantName={cartRestaurant?.name}
              paymentMethod={selectedFoodPayment}
              busy={busy}
              tipCents={foodTipCents}
              scheduledFor={foodScheduledFor}
              onTipChange={setFoodTipCents}
              onScheduleChange={setFoodScheduledFor}
              onBack={() => setFoodScreen("cart")}
              onConfirm={createOrder}
              onRefreshQuote={openFoodCheckout}
            />

            <CustomerFoodOrdersScreen
              visible={foodScreen === "orders"}
              lastCreatedOrder={lastCreatedOrder}
              activeOrders={activeOrders}
              busy={busy}
              onHome={() => setFoodScreen("home")}
              onConfirmedActivity={() => {
                setLastCreatedOrder(null);
                setSharedView("activity");
              }}
              onShare={(order) =>
                shareStatus(
                  "Pedido Flash",
                  `Mi pedido Flash está ${mobileOrderStatusLabel[order.status].toLowerCase()}. Entrega en ${order.deliveryAddress}.`,
                )
              }
              onTrack={setTrackingOrderId}
              onReschedule={(orderId, scheduledFor) =>
                runAction(() => api.rescheduleJob(orderId, scheduledFor), "Pedido reprogramado")
              }
              onCancel={(orderId) => cancelService("order", orderId)}
            />
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
              setServiceIssue({
                kind: "order",
                orderId,
                category: "missing_item",
                description: "",
                refund: "",
              });
            }}
            onRequestReturn={(shipmentId) => {
              setServiceIssue({ kind: "return", shipmentId, reason: "" });
            }}
            onOpenClaimEvidence={openClaimEvidence}
            onAttachClaimEvidence={attachClaimEvidence}
            onReportShipmentClaim={(shipmentId, declaredValue) => {
              setServiceIssue({
                kind: "claim",
                shipmentId,
                claimType: "damaged",
                description: "",
                amount: String(declaredValue),
              });
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
      <CustomerServiceIssueModals
        value={serviceIssue}
        busy={busy}
        runAction={runAction}
        onChange={setServiceIssue}
        onReturnCreated={(shipmentReturn) =>
          setShipmentReturns((current) => [shipmentReturn, ...current])
        }
        onClaimCreated={(claim) => setShipmentClaims((current) => [claim, ...current])}
      />
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
