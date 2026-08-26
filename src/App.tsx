import {
  ArrowLeft,
  BadgeDollarSign,
  Bell,
  Bike,
  Car,
  Check,
  ChevronRight,
  Clock3,
  CreditCard,
  Flame,
  Leaf,
  Heart,
  Home,
  LineChart,
  ListChecks,
  LocateFixed,
  LogIn,
  MapPin,
  MessageCircle,
  Minus,
  PackageCheck,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  KeyRound,
  Copy,
  Download,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Star,
  Store,
  TicketPercent,
  TriangleAlert,
  Truck,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ComponentType, CSSProperties } from "react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, subscribeToEvents } from "./api";
import { configureAnalytics, track } from "./analytics-client";
import { SuperAdminConsole } from "./backoffice/AdminConsole";
import { initials, money } from "./format";
import { orderStatusLabel, rideStatusLabel, shipmentStatusLabel } from "./labels";
import { AdminKpi, AdminSectionHeader } from "./ui/panels";
import type {
  AppState,
  AdminDashboard,
  CartLine,
  CustomerTab,
  DeliveryEvidence,
  Driver,
  DispatchOffer,
  DietaryPreferences,
  FoodCheckoutQuote,
  GeoPoint,
  MenuItem,
  MerchantFinance,
  MerchantOperationsDashboard,
  Mode,
  Order,
  OrderSubstitution,
  OrderStatus,
  RoadRoute,
  Restaurant,
  Ride,
  RideQuote,
  RideStatus,
  RealtimeEvent,
  RideForm,
  Service,
  ShipmentQuote,
  ShipmentOptions,
  PricingChangeRequest,
  PricingPlan,
  PricingService,
  ServiceQuickReply,
  Shipment,
  ShipmentClaim,
  PaymentReconciliation,
  PaymentReconciliationCase,
  TransactionRiskAssessment,
  PayoutReview,
  ServiceTip,
  TipAdjustment,
  SupportAgent,
  SupportTicket,
  NotificationDeadLetter,
  UserAddress,
  User,
} from "./types";

function compactMinutes(totalMinutes: number) {
  const minutes = Math.max(0, Math.round(totalMinutes));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60),
    remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes ? `${hours} h ${remainingMinutes} min` : `${hours} h`;
  const days = Math.floor(hours / 24),
    remainingHours = hours % 24;
  return remainingHours ? `${days} d ${remainingHours} h` : `${days} d`;
}
const dietOptions = [
  { code: "vegetarian", name: "Vegetariano" },
  { code: "vegan", name: "Vegano" },
  { code: "gluten_free", name: "Sin gluten" },
  { code: "halal", name: "Halal" },
  { code: "kosher", name: "Kosher" },
];
const allergenOptions = [
  { code: "gluten", name: "Gluten" },
  { code: "milk", name: "Leche" },
  { code: "eggs", name: "Huevo" },
  { code: "peanuts", name: "Maní" },
  { code: "tree_nuts", name: "Frutos secos" },
  { code: "soy", name: "Soja" },
  { code: "fish", name: "Pescado" },
  { code: "shellfish", name: "Crustáceos" },
  { code: "sesame", name: "Sésamo" },
];
const itemMatchesDietary = (item: MenuItem, preferences: DietaryPreferences) => {
  const diets = new Set((item.dietaryLabels || []).map((entry) => entry.code)),
    allergens = new Set((item.allergens || []).map((entry) => entry.code));
  return (
    preferences.dietaryLabels.every((entry) => diets.has(entry.code)) &&
    !preferences.avoidedAllergens.some((entry) => allergens.has(entry.code))
  );
};

type FoodCheckoutSelection = {
  deliveryAddressId: string;
  deliveryAddress: string;
  paymentMethod: string;
  paymentMethodId?: string;
  quoteToken: string;
};
const NotificationCenter = lazy(() => import("./NotificationCenter"));
const RideHome = lazy(() => import("./RideHome"));
const FlashMap = lazy(() => import("./maps/FlashMap"));

const orderSteps: OrderStatus[] = [
  "requested",
  "accepted",
  "preparing",
  "ready_for_pickup",
  "courier_assigned",
  "picked_up",
  "delivering",
  "delivered",
];

const rideSteps: RideStatus[] = [
  "requested",
  "driver_assigned",
  "arriving",
  "in_progress",
  "completed",
];

const shipmentSteps: Shipment["status"][] = [
  "requested",
  "driver_assigned",
  "arriving",
  "picked_up",
  "delivering",
  "delivered",
];

type ShipmentCreatePayload = {
  pickup: string;
  destination: string;
  recipientName: string;
  recipientPhone: string;
  packageSize: Shipment["packageSize"];
  description: string;
  weightKg: number;
  declaredValue: number;
  protection: NonNullable<Shipment["protection"]>;
  signatureRequired: boolean;
  itemCategory: NonNullable<Shipment["itemCategory"]>;
  serviceLevel: NonNullable<Shipment["serviceLevel"]>;
  deliveryNotes: string;
  paymentMethod: string;
  termsAccepted: true;
  pickupCoords: GeoPoint;
  destinationCoords: GeoPoint;
  quoteToken: string;
};

function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [adminDashboard, setAdminDashboard] = useState<AdminDashboard | null>(null);
  const [mode, setMode] = useState<Mode>("customer");
  const [sessionUserId, setSessionUserId] = useState("usr_customer");
  const [service, setService] = useState<Service>("food");
  const [tab, setTab] = useState<CustomerTab>("home");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todo");
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [promotionCode, setPromotionCode] = useState("");
  const [itemDraft, setItemDraft] = useState<{
    restaurant: Restaurant;
    item: MenuItem;
  } | null>(null);
  const [itemQuantity, setItemQuantity] = useState(1);
  const [draftExtras, setDraftExtras] = useState<string[]>([]);
  const [draftNote, setDraftNote] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [dietaryPreferences, setDietaryPreferences] = useState<DietaryPreferences | null>(null);
  const [rideForm, setRideForm] = useState<RideForm>({
    pickup: "",
    destination: "",
    service: "economy" as Ride["service"],
    pickupCoords: null,
    destinationCoords: null,
  });
  const rideSeededUserId = useRef("");
  const initialBootstrapStarted = useRef(false);
  const [quote, setQuote] = useState<RideQuote | null>(null);
  const [locationStatus, setLocationStatus] = useState<"idle" | "locating" | "ready" | "denied">(
    "idle",
  );
  const [locationMessage, setLocationMessage] = useState("");
  const [newDish, setNewDish] = useState({
    name: "Menu ejecutivo",
    description: "Principal, bebida y postre del dia.",
    category: "Especiales",
    price: 6900,
  });
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<
    "connecting" | "live" | "reconnecting" | "offline"
  >("offline");
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(min-width: 620px)").matches,
  );
  const [desktopPortal, setDesktopPortal] = useState<"admin" | "merchant">("admin");

  useEffect(() => configureAnalytics((events) => api.sendAnalyticsEvents(events)), []);

  useEffect(() => {
    const requireAuthentication = () => {
      setSessionUserId("");
      setState(null);
      setDietaryPreferences(null);
      setAdminDashboard(null);
      setAuthRequired(true);
      setRealtimeStatus("offline");
    };
    window.addEventListener("flash:auth-required", requireAuthentication);
    return () => window.removeEventListener("flash:auth-required", requireAuthentication);
  }, []);

  useEffect(() => {
    setQuote(null);
  }, [
    rideForm.pickup,
    rideForm.destination,
    rideForm.service,
    rideForm.pickupCoords?.lat,
    rideForm.pickupCoords?.lng,
    rideForm.destinationCoords?.lat,
    rideForm.destinationCoords?.lng,
  ]);

  const refresh = useCallback(
    async (knownUserId = sessionUserId) => {
      const response = await api.state();
      setState(response.state);
      const refreshedUser = response.state.users.find((user) => user.id === knownUserId);
      if (isDesktop && desktopPortal === "admin" && refreshedUser?.roles.includes("admin")) {
        try {
          const dashboardResponse = await api.adminDashboard();
          setAdminDashboard(dashboardResponse.dashboard);
        } catch (_requestError) {
          setAdminDashboard(null);
        }
      } else {
        setAdminDashboard(null);
      }
    },
    [desktopPortal, isDesktop, sessionUserId],
  );

  const bootstrapSession = useCallback(async () => {
    const user = await api.restoreSession();
    if (!user) {
      setAuthRequired(true);
      return;
    }
    setAuthRequired(false);
    setSessionUserId(user.id);
    if (user.roles.includes("admin")) {
      setMode("ops");
      setDesktopPortal("admin");
    } else if (user.roles.includes("merchant")) {
      setMode("merchant");
      setDesktopPortal("merchant");
    } else if (user.roles.includes("driver")) setMode("driver");
    else setMode("customer");
    await refresh(user.id);
    if (user.roles.includes("customer")) {
      const [saved, dietary] = await Promise.all([api.cart(), api.getDietaryPreferences()]);
      setCart(saved.cart);
      setDietaryPreferences(dietary.preferences);
    }
  }, [refresh]);

  useEffect(() => {
    if (initialBootstrapStarted.current) return;
    initialBootstrapStarted.current = true;
    setLoading(true);
    bootstrapSession()
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [bootstrapSession]);

  const loginWeb = async (email: string, password: string) => {
    setBusy(true);
    setError(null);
    try {
      const session = await api.login(email, password);
      if (session.mfaRequired && session.mfaChallenge) {
        setMfaChallenge(session.mfaChallenge);
        return;
      }
      setLoading(true);
      await bootstrapSession();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo iniciar sesión");
    } finally {
      setLoading(false);
      setBusy(false);
    }
  };
  const completeMfaWeb = async (code: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.completeMfa(mfaChallenge, code);
      setMfaChallenge("");
      setLoading(true);
      await bootstrapSession();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo verificar MFA");
    } finally {
      setLoading(false);
      setBusy(false);
    }
  };
  const logoutWeb = async () => {
    await api.logout();
    setSessionUserId("");
    setState(null);
    setDietaryPreferences(null);
    rideSeededUserId.current = "";
    setRideForm({
      pickup: "",
      destination: "",
      service: "economy",
      pickupCoords: null,
      destinationCoords: null,
    });
    setQuote(null);
    setAdminDashboard(null);
    setAuthRequired(true);
    setDesktopPortal("admin");
  };

  useEffect(() => {
    const media = window.matchMedia("(min-width: 620px)");
    const onChange = () => setIsDesktop(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const setOnline = () => setIsOnline(true);
    const setOffline = () => setIsOnline(false);
    const onTransportStatus = (event: Event) => {
      const online = (event as CustomEvent<{ online?: boolean }>).detail?.online;
      if (typeof online === "boolean") setIsOnline(online);
    };
    window.addEventListener("online", setOnline);
    window.addEventListener("offline", setOffline);
    window.addEventListener("flash:network", onTransportStatus);
    return () => {
      window.removeEventListener("online", setOnline);
      window.removeEventListener("offline", setOffline);
      window.removeEventListener("flash:network", onTransportStatus);
    };
  }, []);

  useEffect(() => {
    if (loading || authRequired || !sessionUserId) return;
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [authRequired, loading, refresh, sessionUserId]);

  useEffect(() => {
    if (loading || authRequired || !sessionUserId) return;
    const stopRealtime = subscribeToEvents((event: RealtimeEvent) => {
      if (event.type !== "connected" && event.type !== "heartbeat") {
        refresh().catch(() => undefined);
      }
    }, setRealtimeStatus);
    return stopRealtime;
  }, [authRequired, loading, refresh, sessionUserId]);

  const runAction = useCallback(
    async (action: () => Promise<unknown>, success: string) => {
      setBusy(true);
      setError(null);
      try {
        await action();
        await refresh();
        setToast(success);
        window.setTimeout(() => setToast(null), 2600);
      } catch (requestError) {
        setToast(requestError instanceof Error ? requestError.message : "No se pudo completar");
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const activeUser = useMemo(() => {
    if (!state) return null;
    return state.users.find((user) => user.id === sessionUserId) || null;
  }, [sessionUserId, state]);

  useEffect(() => {
    if (!activeUser || !state) return;
    if (rideSeededUserId.current === activeUser.id) return;
    rideSeededUserId.current = activeUser.id;
    const saved = state.addresses.find(
      (entry) =>
        entry.userId === activeUser.id &&
        entry.isDefault &&
        !entry.id.startsWith("profile-") &&
        entry.lat !== null &&
        entry.lng !== null,
    );
    if (!saved) return;
    setRideForm((current) =>
      current.pickup.trim() || current.pickupCoords
        ? current
        : { ...current, pickup: saved.address, pickupCoords: { lat: saved.lat!, lng: saved.lng! } },
    );
  }, [activeUser, state]);

  const lastHomeAnalyticsKey = useRef("");
  const lastActivityAnalyticsKey = useRef("");
  const previousSearchQuery = useRef("");
  const previousCartCount = useRef<number | null>(null);
  const previousCheckoutOpen = useRef(false);

  useEffect(() => {
    if (!state || !sessionUserId) return;
    const key = `${mode}:${service}`;
    if (lastHomeAnalyticsKey.current === key) return;
    lastHomeAnalyticsKey.current = key;
    track("home_viewed", "web", { mode, service });
  }, [mode, service, sessionUserId, state]);

  useEffect(() => {
    if (!sessionUserId || tab !== "activity") return;
    const key = `${sessionUserId}:${service}`;
    if (lastActivityAnalyticsKey.current === key) return;
    lastActivityAnalyticsKey.current = key;
    track("activity_viewed", "web", { service });
  }, [service, sessionUserId, tab]);

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (trimmedQuery && !previousSearchQuery.current.trim()) {
      track("search_started", "web", { service });
    }
    previousSearchQuery.current = query;
  }, [query, service]);

  useEffect(() => {
    if (selectedRestaurantId)
      track("merchant_viewed", "web", { merchant_id: selectedRestaurantId });
  }, [selectedRestaurantId]);

  useEffect(() => {
    if (!sessionUserId) return;
    const itemCount = cart.reduce((total, line) => total + line.quantity, 0);
    if (previousCartCount.current !== null && previousCartCount.current !== itemCount) {
      track("cart_updated", "web", { item_count: itemCount });
    }
    previousCartCount.current = itemCount;
  }, [cart, sessionUserId]);

  useEffect(() => {
    if (checkoutOpen && !previousCheckoutOpen.current) {
      track("checkout_started", "web", { service: "food" });
    }
    previousCheckoutOpen.current = checkoutOpen;
  }, [checkoutOpen]);

  const selectedRestaurant = useMemo(() => {
    if (!state || !selectedRestaurantId) return null;
    return state.restaurants.find((restaurant) => restaurant.id === selectedRestaurantId) || null;
  }, [selectedRestaurantId, state]);

  const categories = useMemo(() => {
    if (!state) return ["Todo"];
    const unique = new Set<string>();
    state.restaurants.forEach((restaurant) =>
      restaurant.menu.forEach((item) => unique.add(item.category)),
    );
    return ["Todo", ...Array.from(unique)];
  }, [state]);

  const filteredRestaurants = useMemo(() => {
    if (!state) return [];
    const search = query.trim().toLowerCase();
    return state.restaurants.filter((restaurant) => {
      const categoryMatch =
        category === "Todo" || restaurant.menu.some((item) => item.category === category);
      const queryMatch =
        !search ||
        restaurant.name.toLowerCase().includes(search) ||
        restaurant.cuisine.toLowerCase().includes(search) ||
        restaurant.menu.some((item) => item.name.toLowerCase().includes(search));
      const dietaryMatch =
        !dietaryPreferences?.hideIncompatible ||
        restaurant.menu.some((item) => item.stock && itemMatchesDietary(item, dietaryPreferences));
      return categoryMatch && queryMatch && dietaryMatch;
    });
  }, [category, dietaryPreferences, query, state]);

  const allItems = useMemo(() => {
    if (!state) return [];
    return state.restaurants.flatMap((restaurant) =>
      restaurant.menu
        .filter(
          (item) =>
            !dietaryPreferences?.hideIncompatible || itemMatchesDietary(item, dietaryPreferences),
        )
        .map((item) => ({
          restaurant,
          item,
        })),
    );
  }, [dietaryPreferences, state]);

  const cartRestaurant = useMemo(() => {
    if (!state || !cart.length) return null;
    return state.restaurants.find((restaurant) => restaurant.id === cart[0].restaurantId) || null;
  }, [cart, state]);

  const cartTotals = useMemo(() => {
    const subtotal = cart.reduce((sum, line) => {
      const restaurant = state?.restaurants.find((entry) => entry.id === line.restaurantId);
      const extrasTotal = line.extras.reduce((extraSum, extraId) => {
        const extra = restaurant?.extras.find((entry) => entry.id === extraId);
        return extraSum + (extra?.price || 0);
      }, 0);
      return sum + (line.item.price + extrasTotal) * line.quantity;
    }, 0);
    const deliveryFee = cartRestaurant?.deliveryFee || 0;
    const serviceFee = cart.length ? 520 : 0;
    const promotion = state?.promotions.find(
      (entry) =>
        entry.code?.toUpperCase() === promotionCode.trim().toUpperCase() &&
        entry.service === "food" &&
        entry.active,
    );
    let discount = 0;
    if (promotion && subtotal >= (promotion.minSubtotal || 0)) {
      if (promotion.kind === "percentage" || promotion.discountPercent)
        discount = Math.round(
          (subtotal * (promotion.discountPercent || promotion.value || 0)) / 100,
        );
      else if (promotion.kind === "free_delivery") discount = deliveryFee;
      else if (promotion.kind === "fixed") discount = promotion.value || 0;
      if (promotion.maxDiscount) discount = Math.min(discount, promotion.maxDiscount);
    }
    return {
      subtotal,
      deliveryFee,
      serviceFee,
      discount,
      total: subtotal + deliveryFee + serviceFee - discount,
    };
  }, [cart, cartRestaurant, state, promotionCode]);

  const driver = state?.drivers.find((entry) => entry.userId === sessionUserId) || null;
  const merchantRestaurant =
    state?.restaurants.find((restaurant) => restaurant.ownerId === sessionUserId) || null;

  const switchMode = (nextMode: Mode) => {
    const requiredRole = nextMode === "ops" ? "admin" : nextMode;
    if (!activeUser?.roles.includes(requiredRole as User["roles"][number])) {
      setToast("Esta sesión no tiene permisos para cambiar a ese perfil");
      return;
    }
    setMode(nextMode);
    setSelectedRestaurantId(null);
    setCartOpen(false);
    setCheckoutOpen(false);
  };

  const openItem = (restaurant: Restaurant, item: MenuItem) => {
    setItemDraft({ restaurant, item });
    setItemQuantity(1);
    setDraftExtras(
      restaurant.extras.slice(0, item.category === "Burger" ? 1 : 0).map((extra) => extra.id),
    );
    setDraftNote("");
  };

  const addDraftToCart = () => {
    if (!itemDraft) return;
    const nextLine: CartLine = {
      restaurantId: itemDraft.restaurant.id,
      item: itemDraft.item,
      quantity: itemQuantity,
      extras: draftExtras,
      note: draftNote,
    };
    const nextCart = (() => {
      const sameRestaurant = cart.every((line) => line.restaurantId === itemDraft.restaurant.id);
      const base = sameRestaurant ? cart : [];
      const index = base.findIndex(
        (line) =>
          line.item.id === nextLine.item.id &&
          line.note === nextLine.note &&
          line.extras.slice().sort().join(",") === nextLine.extras.slice().sort().join(","),
      );
      if (index < 0) return [...base, nextLine];
      return base.map((line, lineIndex) =>
        lineIndex === index ? { ...line, quantity: line.quantity + nextLine.quantity } : line,
      );
    })();
    setCart(nextCart);
    void api
      .saveCart(itemDraft.restaurant.id, nextCart)
      .catch((requestError) => setError(requestError.message));
    setItemDraft(null);
    setToast("Producto agregado al carrito");
  };

  const createOrder = async (
    checkout: FoodCheckoutSelection,
    providerPayment?: { cardToken: string; paymentMethodId: string; installments: number },
  ) => {
    if (!activeUser || !cartRestaurant || !cart.length) return;
    setBusy(true);
    setError(null);
    try {
      await api.createOrder({
        customerId: activeUser.id,
        restaurantId: cartRestaurant.id,
        deliveryAddressId: checkout.deliveryAddressId,
        deliveryAddress: checkout.deliveryAddress,
        paymentMethod: checkout.paymentMethod,
        paymentMethodId: checkout.paymentMethodId,
        providerPayment,
        promotionCode: promotionCode.trim() || undefined,
        quoteToken: checkout.quoteToken,
        items: cart.map((line) => ({
          menuItemId: line.item.id,
          quantity: line.quantity,
          extras: line.extras,
          note: line.note,
        })),
      });
      await api.saveCart(cartRestaurant.id, []);
      setCart([]);
      setPromotionCode("");
      setCheckoutOpen(false);
      setCartOpen(false);
      setTab("activity");
      await refresh();
      setToast("Pedido creado y enviado al comercio");
      window.setTimeout(() => setToast(null), 2600);
      track("job_created", "web", { service: "food" });
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : "No se pudo crear el pedido";
      setToast(message);
      throw requestError;
    } finally {
      setBusy(false);
    }
  };

  const quoteRide = () =>
    runAction(async () => {
      const response = await api.quoteRide(rideForm);
      setQuote(response.quote);
      track("quote_received", "web", { service: "ride" });
    }, "Tarifa calculada");

  const locatePickup = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationStatus("denied");
      setLocationMessage("Este dispositivo no permite geolocalizacion.");
      return;
    }
    setLocationStatus("locating");
    setLocationMessage("Buscando tu ubicacion actual...");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const point = { lat: coords.latitude, lng: coords.longitude };
        setRideForm((current) => ({
          ...current,
          pickup: "Ubicacion actual",
          pickupCoords: point,
        }));
        setLocationStatus("ready");
        setLocationMessage(`GPS listo: ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`);
      },
      () => {
        setLocationStatus("denied");
        setLocationMessage("No pudimos acceder al GPS. Puedes escribir el origen.");
      },
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 10000 },
    );
  }, []);

  const requestRide = () => {
    if (!activeUser) return;
    runAction(async () => {
      if (!quote?.quoteToken) throw new Error("Cotizá nuevamente antes de pedir el viaje");
      await api.createRide({
        customerId: activeUser.id,
        pickup: rideForm.pickup,
        destination: rideForm.destination,
        service: rideForm.service,
        pickupCoords: rideForm.pickupCoords,
        destinationCoords: rideForm.destinationCoords,
        paymentMethod: "Flash Wallet",
        quoteToken: quote.quoteToken,
      });
      setTab("activity");
      track("job_created", "web", { service: "ride" });
    }, "Viaje solicitado");
  };

  const createShipment = async (payload: ShipmentCreatePayload) => {
    if (!activeUser) return;
    setBusy(true);
    setError(null);
    try {
      await api.createShipment({
        ...payload,
        customerId: activeUser.id,
      });
      await refresh();
      setService("shipment");
      setTab("activity");
      track("job_created", "web", { service: "shipment" });
      setToast("Envío solicitado y enviado a dispatch");
      window.setTimeout(() => setToast(null), 2600);
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : "No se pudo crear el envío";
      setToast(message);
      throw requestError;
    } finally {
      setBusy(false);
    }
  };

  const topUpWallet = (amount: number) =>
    runAction(() => api.topUpWallet(amount), "Saldo cargado en wallet sandbox");

  const updateProfile = (payload: { name: string; phone: string; defaultAddress: string }) =>
    runAction(() => api.updateProfile(payload), "Perfil actualizado");

  const runAddressAction = async (
    action: () => Promise<void>,
    success: string,
  ): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
      setToast(success);
      window.setTimeout(() => setToast(null), 2600);
      return true;
    } catch (requestError) {
      setToast(requestError instanceof Error ? requestError.message : "No se pudo completar");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const createAddress = async (payload: {
    label: string;
    address: string;
    lat: number;
    lng: number;
    isDefault: boolean;
  }): Promise<boolean> => {
    return runAddressAction(async () => {
      const response = await api.createAddress(payload);
      setState((current) => (current ? { ...current, addresses: response.addresses } : current));
    }, "Direccion guardada");
  };

  const updateAddress = async (
    addressId: string,
    payload: {
      label: string;
      address: string;
      lat: number;
      lng: number;
      isDefault: boolean;
    },
  ): Promise<boolean> => {
    return runAddressAction(async () => {
      const response = await api.updateAddress(addressId, payload);
      setState((current) => (current ? { ...current, addresses: response.addresses } : current));
    }, "Direccion actualizada");
  };

  const setDefaultAddress = async (addressId: string): Promise<boolean> => {
    return runAddressAction(async () => {
      const response = await api.setDefaultAddress(addressId);
      setState((current) => (current ? { ...current, addresses: response.addresses } : current));
    }, "Direccion predeterminada actualizada");
  };

  const deleteAddress = async (addressId: string): Promise<boolean> => {
    return runAddressAction(async () => {
      const response = await api.deleteAddress(addressId);
      setState((current) => (current ? { ...current, addresses: response.addresses } : current));
    }, "Direccion eliminada");
  };

  if (loading) {
    return (
      <main className="app loading-app">
        <div className="loader-card">
          <Flame size={28} />
          <strong>Iniciando Flash</strong>
          <span>Conectando frontend y backend</span>
        </div>
      </main>
    );
  }

  if (authRequired) {
    return (
      <WebLogin
        busy={busy}
        error={error}
        mfaChallenge={mfaChallenge}
        onLogin={loginWeb}
        onMfa={completeMfaWeb}
      />
    );
  }

  if (!state || error) {
    return (
      <main className="app loading-app">
        <div className="loader-card error-card">
          <X size={28} />
          <strong>Backend no disponible</strong>
          <span>
            {!isOnline
              ? "Sin conexión. Las acciones nuevas esperan hasta recuperar internet."
              : error || "No se pudo cargar el estado"}
          </span>
          <button type="button" onClick={() => window.location.reload()}>
            <RefreshCw size={16} /> Reintentar
          </button>
        </div>
      </main>
    );
  }

  if (isDesktop) {
    const networkBanner = (
      <NetworkStatusBanner
        online={isOnline}
        realtimeStatus={realtimeStatus}
        onRetry={() => refresh().catch(() => undefined)}
      />
    );
    const canAdmin = Boolean(activeUser?.roles.includes("admin"));
    const canMerchant = Boolean(activeUser?.roles.includes("merchant") && merchantRestaurant);
    if (!canAdmin && !canMerchant)
      return (
        <>
          {networkBanner}
          <DesktopAccessGate user={activeUser} onLogout={logoutWeb} />
        </>
      );
    if (canMerchant && (!canAdmin || desktopPortal === "merchant")) {
      return (
        <>
          {networkBanner}
          <MerchantDesktopConsole
            state={state}
            restaurant={merchantRestaurant!}
            newDish={newDish}
            setNewDish={setNewDish}
            busy={busy}
            realtimeStatus={realtimeStatus}
            runAction={runAction}
            onRefresh={refresh}
            onSwitchPortal={() => setDesktopPortal("admin")}
            canSwitchPortal={canAdmin}
            onLogout={logoutWeb}
          />
        </>
      );
    }
    return (
      <>
        {networkBanner}
        <SuperAdminConsole
          state={state}
          currentUserId={activeUser!.id}
          dashboard={adminDashboard}
          busy={busy}
          realtimeStatus={realtimeStatus}
          runAction={runAction}
          onSwitchPortal={() => setDesktopPortal("merchant")}
          onLogout={logoutWeb}
        />
      </>
    );
  }

  return (
    <main className="app">
      <section className="workspace">
        <BrandPanel state={state} mode={mode} onModeChange={switchMode} user={activeUser} />
        <section className="phone-stage" aria-label="Aplicacion">
          <div className="phone">
            <PhoneStatus online={isOnline} />
            <AppModeBar mode={mode} onModeChange={switchMode} />
            <div className="phone-content">
              <NetworkStatusBanner
                online={isOnline}
                realtimeStatus={realtimeStatus}
                onRetry={() => refresh().catch(() => undefined)}
              />
              {mode === "customer" && (
                <CustomerApp
                  state={state}
                  user={activeUser}
                  service={service}
                  setService={setService}
                  tab={tab}
                  setTab={setTab}
                  query={query}
                  setQuery={setQuery}
                  category={category}
                  setCategory={setCategory}
                  categories={categories}
                  restaurants={filteredRestaurants}
                  allItems={allItems}
                  selectedRestaurant={selectedRestaurant}
                  setSelectedRestaurantId={setSelectedRestaurantId}
                  cart={cart}
                  setCart={setCart}
                  setError={setError}
                  cartOpen={cartOpen}
                  setCartOpen={setCartOpen}
                  checkoutOpen={checkoutOpen}
                  setCheckoutOpen={setCheckoutOpen}
                  cartTotals={cartTotals}
                  promotionCode={promotionCode}
                  setPromotionCode={setPromotionCode}
                  cartRestaurant={cartRestaurant}
                  openItem={openItem}
                  createOrder={createOrder}
                  rideForm={rideForm}
                  setRideForm={setRideForm}
                  quote={quote}
                  quoteRide={quoteRide}
                  requestRide={requestRide}
                  createShipment={createShipment}
                  locatePickup={locatePickup}
                  locationStatus={locationStatus}
                  locationMessage={locationMessage}
                  onTopUpWallet={topUpWallet}
                  onUpdateProfile={updateProfile}
                  addresses={state.addresses.filter((entry) => entry.userId === activeUser?.id)}
                  onCreateAddress={createAddress}
                  onUpdateAddress={updateAddress}
                  onSetDefaultAddress={setDefaultAddress}
                  onDeleteAddress={deleteAddress}
                  busy={busy}
                  runAction={runAction}
                  dietaryPreferences={dietaryPreferences}
                  onDietaryPreferencesChange={setDietaryPreferences}
                />
              )}
              {mode === "merchant" && merchantRestaurant && (
                <MerchantApp
                  state={state}
                  restaurant={merchantRestaurant}
                  newDish={newDish}
                  setNewDish={setNewDish}
                  busy={busy}
                  runAction={runAction}
                />
              )}
              {mode === "driver" && driver && (
                <DriverApp
                  state={state}
                  driver={driver}
                  user={activeUser}
                  busy={busy}
                  runAction={runAction}
                />
              )}
              {mode === "ops" && <OpsApp state={state} busy={busy} runAction={runAction} />}
            </div>
            {itemDraft && (
              <ItemSheet
                restaurant={itemDraft.restaurant}
                item={itemDraft.item}
                quantity={itemQuantity}
                setQuantity={setItemQuantity}
                extras={draftExtras}
                setExtras={setDraftExtras}
                note={draftNote}
                setNote={setDraftNote}
                onAdd={addDraftToCart}
                onClose={() => setItemDraft(null)}
              />
            )}
            {toast && <div className="toast">{toast}</div>}
          </div>
        </section>
        <OpsRail
          mode={mode}
          state={state}
          user={activeUser}
          cartCount={cart.reduce((sum, line) => sum + line.quantity, 0)}
          cartTotal={cartTotals.total}
          busy={busy}
          runAction={runAction}
        />
      </section>
    </main>
  );
}

function DesktopAccessGate({ user, onLogout }: { user: User | null; onLogout: () => void }) {
  return (
    <main className="desktop-access-gate">
      <section>
        <span>
          <ShieldCheck size={28} />
        </span>
        <small>Flash · acceso por rol</small>
        <h1>Esta cuenta usa la app móvil</h1>
        <p>
          {user?.name || "Tu cuenta"}, el portal web está reservado para operaciones y negocios.
          Abre Flash en mobile para pedir comida, viajes y envíos.
        </p>
        <div>
          <b>{user?.roles.join(" · ") || "sin rol operativo"}</b>
          <button type="button" onClick={onLogout}>
            <LogIn size={17} /> Cambiar de cuenta
          </button>
        </div>
      </section>
    </main>
  );
}

function PhoneStatus({ online }: { online: boolean }) {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="phone-status" aria-hidden="true">
      <span>
        {time.toLocaleTimeString("es-AR", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
      <span className="dynamic-island" />
      <span>{online ? "Live" : "Offline"}</span>
    </div>
  );
}

function BranchScheduleEditor({
  restaurantId,
  branch,
  busy,
  runAction,
}: {
  restaurantId: string;
  branch: NonNullable<Restaurant["branches"]>[number];
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const defaultHours = Array.from(
    { length: 7 },
    (_, weekday) =>
      branch.weeklyHours?.find((hour) => hour.weekday === weekday) || {
        weekday,
        opensAt: "09:00",
        closesAt: "23:00",
        enabled: true,
      },
  );
  const [hours, setHours] = useState(defaultHours),
    [timezone, setTimezone] = useState(branch.timezone || "America/Argentina/Buenos_Aires"),
    [exceptionDate, setExceptionDate] = useState(""),
    [exceptionOpen, setExceptionOpen] = useState(false),
    [exceptionReason, setExceptionReason] = useState("");
  useEffect(() => {
    setHours(
      Array.from(
        { length: 7 },
        (_, weekday) =>
          branch.weeklyHours?.find((hour) => hour.weekday === weekday) || {
            weekday,
            opensAt: "09:00",
            closesAt: "23:00",
            enabled: true,
          },
      ),
    );
    setTimezone(branch.timezone || "America/Argentina/Buenos_Aires");
  }, [branch.id, branch.timezone, branch.weeklyHours]);
  const dayNames = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const change = (
    weekday: number,
    field: "opensAt" | "closesAt" | "enabled",
    value: string | boolean,
  ) =>
    setHours((current) =>
      current.map((hour) => (hour.weekday === weekday ? { ...hour, [field]: value } : hour)),
    );
  return (
    <div className="branch-schedule">
      <div className="branch-stock-title">
        <div>
          <strong>Horario automático</strong>
          <small>
            {branch.open ? "Abierta ahora" : "Cerrada ahora"} · {timezone}
          </small>
        </div>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() =>
            runAction(
              () =>
                api.replaceBranchSchedule(restaurantId, branch.id, {
                  timezone,
                  hours,
                }),
              "Horario semanal guardado",
            )
          }
        >
          Guardar horario
        </button>
      </div>
      <div className="branch-hours-grid">
        {hours.map((hour) => (
          <div className={`branch-hour-row ${hour.enabled ? "" : "disabled"}`} key={hour.weekday}>
            <label>
              <input
                type="checkbox"
                checked={hour.enabled}
                onChange={(event) => change(hour.weekday, "enabled", event.target.checked)}
              />
              <b>{dayNames[hour.weekday]}</b>
            </label>
            <input
              type="time"
              disabled={!hour.enabled}
              value={hour.opensAt}
              onChange={(event) => change(hour.weekday, "opensAt", event.target.value)}
            />
            <span>—</span>
            <input
              type="time"
              disabled={!hour.enabled}
              value={hour.closesAt}
              onChange={(event) => change(hour.weekday, "closesAt", event.target.value)}
            />
          </div>
        ))}
      </div>
      <div className="branch-exception-form">
        <strong>Cierre o apertura excepcional</strong>
        <input
          type="date"
          value={exceptionDate}
          onChange={(event) => setExceptionDate(event.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={exceptionOpen}
            onChange={(event) => setExceptionOpen(event.target.checked)}
          />{" "}
          Abrir excepcionalmente
        </label>
        <input
          placeholder="Motivo, por ejemplo feriado"
          value={exceptionReason}
          onChange={(event) => setExceptionReason(event.target.value)}
        />
        <button
          className="secondary-button"
          disabled={busy || !exceptionDate}
          onClick={() =>
            runAction(
              () =>
                api.upsertBranchScheduleException(restaurantId, branch.id, {
                  date: exceptionDate,
                  isOpen: exceptionOpen,
                  ...(exceptionOpen ? { opensAt: "09:00", closesAt: "23:00" } : {}),
                  reason: exceptionReason,
                }),
              exceptionOpen ? "Apertura excepcional guardada" : "Cierre excepcional guardado",
            )
          }
        >
          Guardar excepción
        </button>
      </div>
      {branch.scheduleExceptions?.length > 0 && (
        <div className="branch-exception-list">
          {branch.scheduleExceptions.map((exception) => (
            <span key={exception.date}>
              <b>{exception.date}</b> ·{" "}
              {exception.isOpen ? `${exception.opensAt}–${exception.closesAt}` : "cerrada"}
              {exception.reason ? ` · ${exception.reason}` : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ModifierCatalogEditor({
  restaurantId,
  item,
  busy,
  runAction,
}: {
  restaurantId: string;
  item: MenuItem;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  type Groups = NonNullable<MenuItem["modifierGroups"]>;
  const [groups, setGroups] = useState<Groups>(item.modifierGroups || []);
  useEffect(() => setGroups(item.modifierGroups || []), [item.id, item.modifierGroups]);
  const updateGroup = (index: number, patch: Partial<Groups[number]>) =>
    setGroups((current) =>
      current.map((group, position) => (position === index ? { ...group, ...patch } : group)),
    );
  const addGroup = () => {
    const stamp = Date.now().toString(36);
    setGroups((current) => [
      ...current,
      {
        id: `group_${stamp}`,
        name: "Nuevo grupo",
        min: 0,
        max: 1,
        required: false,
        modifiers: [
          {
            id: `option_${stamp}`,
            name: "Nueva opción",
            price: 0,
            available: true,
          },
        ],
      },
    ]);
  };
  const addModifier = (groupIndex: number) => {
    const stamp = Date.now().toString(36);
    setGroups((current) =>
      current.map((group, index) =>
        index === groupIndex
          ? {
              ...group,
              modifiers: [
                ...group.modifiers,
                {
                  id: `option_${stamp}`,
                  name: "Nueva opción",
                  price: 0,
                  available: true,
                },
              ],
            }
          : group,
      ),
    );
  };
  return (
    <details className="modifier-editor">
      <summary>
        <SlidersHorizontal size={16} />
        <span>Opciones y agregados</span>
        <small>{groups.length} grupos</small>
      </summary>
      <div className="modifier-editor-body">
        {groups.map((group, groupIndex) => (
          <section className="modifier-group" key={group.id}>
            <div className="modifier-group-head">
              <input
                aria-label="Nombre del grupo"
                value={group.name}
                onChange={(event) => updateGroup(groupIndex, { name: event.target.value })}
              />
              <label>
                Mín.{" "}
                <input
                  type="number"
                  min="0"
                  max="20"
                  value={group.min}
                  onChange={(event) =>
                    updateGroup(groupIndex, {
                      min: Number(event.target.value),
                      required: Number(event.target.value) > 0,
                    })
                  }
                />
              </label>
              <label>
                Máx.{" "}
                <input
                  type="number"
                  min="1"
                  max={Math.max(1, group.modifiers.length)}
                  value={group.max}
                  onChange={(event) => updateGroup(groupIndex, { max: Number(event.target.value) })}
                />
              </label>
              <button
                className="icon-button"
                title="Eliminar grupo"
                onClick={() =>
                  setGroups((current) => current.filter((_, index) => index !== groupIndex))
                }
              >
                <X size={15} />
              </button>
            </div>
            <div className="modifier-options">
              {group.modifiers.map((modifier, modifierIndex) => (
                <div key={modifier.id}>
                  <input
                    aria-label="Nombre de opción"
                    value={modifier.name}
                    onChange={(event) =>
                      updateGroup(groupIndex, {
                        modifiers: group.modifiers.map((entry, index) =>
                          index === modifierIndex ? { ...entry, name: event.target.value } : entry,
                        ),
                      })
                    }
                  />
                  <label>
                    ${" "}
                    <input
                      aria-label="Precio adicional"
                      type="number"
                      min="0"
                      step="1"
                      value={modifier.price}
                      onChange={(event) =>
                        updateGroup(groupIndex, {
                          modifiers: group.modifiers.map((entry, index) =>
                            index === modifierIndex
                              ? { ...entry, price: Number(event.target.value) }
                              : entry,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="modifier-available">
                    <input
                      type="checkbox"
                      checked={modifier.available}
                      onChange={(event) =>
                        updateGroup(groupIndex, {
                          modifiers: group.modifiers.map((entry, index) =>
                            index === modifierIndex
                              ? { ...entry, available: event.target.checked }
                              : entry,
                          ),
                        })
                      }
                    />{" "}
                    Disponible
                  </label>
                  <button
                    className="icon-button"
                    title="Eliminar opción"
                    disabled={group.modifiers.length <= group.max}
                    onClick={() =>
                      updateGroup(groupIndex, {
                        modifiers: group.modifiers.filter((_, index) => index !== modifierIndex),
                      })
                    }
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button className="text-button" onClick={() => addModifier(groupIndex)}>
              <Plus size={14} /> Agregar opción
            </button>
          </section>
        ))}
        <div className="modifier-editor-actions">
          <button className="secondary-button" onClick={addGroup}>
            <Plus size={15} /> Nuevo grupo
          </button>
          <button
            className="primary-button"
            disabled={
              busy ||
              groups.some(
                (group) =>
                  !group.name.trim() ||
                  group.min > group.max ||
                  group.max > group.modifiers.length ||
                  group.modifiers.some((modifier) => !modifier.name.trim()),
              )
            }
            onClick={() =>
              runAction(
                () => api.replaceItemModifiers(restaurantId, item.id, groups),
                "Opciones del producto guardadas",
              )
            }
          >
            Guardar opciones
          </button>
        </div>
      </div>
    </details>
  );
}

function DietaryCatalogEditor({
  restaurantId,
  item,
  busy,
  runAction,
}: {
  restaurantId: string;
  item: MenuItem;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const dietOptions = [
      { code: "vegetarian", name: "Vegetariano" },
      { code: "vegan", name: "Vegano" },
      { code: "gluten_free", name: "Sin gluten" },
      { code: "halal", name: "Halal" },
      { code: "kosher", name: "Kosher" },
    ],
    allergenOptions = [
      { code: "gluten", name: "Gluten" },
      { code: "milk", name: "Leche" },
      { code: "eggs", name: "Huevo" },
      { code: "peanuts", name: "Maní" },
      { code: "tree_nuts", name: "Frutos secos" },
      { code: "soy", name: "Soja" },
      { code: "fish", name: "Pescado" },
      { code: "shellfish", name: "Crustáceos" },
      { code: "sesame", name: "Sésamo" },
    ];
  const [diets, setDiets] = useState(() => item.dietaryLabels?.map((entry) => entry.code) || []),
    [allergens, setAllergens] = useState<Record<string, "contains" | "may_contain">>(() =>
      Object.fromEntries((item.allergens || []).map((entry) => [entry.code, entry.presence])),
    );
  useEffect(() => {
    setDiets(item.dietaryLabels?.map((entry) => entry.code) || []);
    setAllergens(
      Object.fromEntries((item.allergens || []).map((entry) => [entry.code, entry.presence])),
    );
  }, [item.id, item.dietaryLabels, item.allergens]);
  return (
    <details className="modifier-editor dietary-editor">
      <summary>
        <ShieldCheck size={16} />
        <span>Dietas y alérgenos</span>
        <small>{diets.length + Object.keys(allergens).length} declaraciones</small>
      </summary>
      <div className="modifier-editor-body">
        <strong className="dietary-subtitle">Apto para</strong>
        <div className="dietary-check-grid">
          {dietOptions.map((option) => (
            <label key={option.code}>
              <input
                type="checkbox"
                checked={diets.includes(option.code)}
                onChange={(event) =>
                  setDiets((current) =>
                    event.target.checked
                      ? [...current, option.code]
                      : current.filter((code) => code !== option.code),
                  )
                }
              />
              {option.name}
            </label>
          ))}
        </div>
        <strong className="dietary-subtitle">Alérgenos</strong>
        <div className="dietary-allergen-grid">
          {allergenOptions.map((option) => (
            <label key={option.code}>
              <span>{option.name}</span>
              <select
                value={allergens[option.code] || "none"}
                onChange={(event) =>
                  setAllergens((current) => {
                    const next = { ...current };
                    if (event.target.value === "none") delete next[option.code];
                    else next[option.code] = event.target.value as "contains" | "may_contain";
                    return next;
                  })
                }
              >
                <option value="none">No declarado</option>
                <option value="contains">Contiene</option>
                <option value="may_contain">Puede contener</option>
              </select>
            </label>
          ))}
        </div>
        <div className="modifier-editor-actions">
          <small>La declaración se muestra al cliente antes de agregar.</small>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() =>
              runAction(
                () =>
                  api.replaceItemDietary(restaurantId, item.id, {
                    dietaryLabels: diets,
                    allergens: Object.entries(allergens).map(([code, presence]) => ({
                      code,
                      presence,
                    })),
                  }),
                "Información alimentaria guardada",
              )
            }
          >
            Guardar declaración
          </button>
        </div>
      </div>
    </details>
  );
}

function MerchantOrderDetailDialog({
  order,
  restaurant,
  busy,
  onClose,
  onChanged,
}: {
  order: Order;
  restaurant: Restaurant;
  busy: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [substitutions, setSubstitutions] = useState<OrderSubstitution[]>([]),
    [selectedItemId, setSelectedItemId] = useState(""),
    [replacementId, setReplacementId] = useState(""),
    [reason, setReason] = useState(""),
    [loading, setLoading] = useState(true),
    [actionBusy, setActionBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getOrderSubstitutions(order.id);
      setSubstitutions(result.substitutions);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "No se pudieron cargar los cambios",
      );
    } finally {
      setLoading(false);
    }
  }, [order.id]);
  useEffect(() => {
    void load();
  }, [load]);
  const branch = restaurant.branches?.find((entry) => entry.id === order.branchId) || null,
    selectedOrderItem = order.items.find((item) => item.menuItemId === selectedItemId) || null,
    selectedCatalogItem = restaurant.menu.find((item) => item.id === selectedItemId) || null,
    inventoryFor = (itemId: string) => branch?.inventory[itemId];
  const originalPrice = selectedOrderItem?.unitPrice ?? selectedCatalogItem?.price ?? 0;
  const candidates = restaurant.menu
    .filter((item) => {
      const inventory = inventoryFor(item.id);
      return (
        item.id !== selectedItemId &&
        item.stock &&
        (inventory?.available ?? true) &&
        (inventory?.stockQuantity == null ||
          inventory.stockQuantity >= (selectedOrderItem?.quantity || 1)) &&
        item.price <= originalPrice
      );
    })
    .sort(
      (left, right) =>
        Number(
          Boolean(selectedCatalogItem?.category) &&
            right.category === selectedCatalogItem?.category,
        ) -
          Number(
            Boolean(selectedCatalogItem?.category) &&
              left.category === selectedCatalogItem?.category,
          ) || left.price - right.price,
    );
  const canManage = ["accepted", "preparing"].includes(order.status),
    selectedPending = substitutions.some(
      (entry) => entry.status === "pending" && entry.original.id === selectedItemId,
    );
  const submit = async () => {
    if (
      !order.branchId ||
      !selectedOrderItem?.menuItemId ||
      !replacementId ||
      reason.trim().length < 3
    )
      return;
    setActionBusy(true);
    setError("");
    try {
      const inventory = inventoryFor(selectedOrderItem.menuItemId);
      if (selectedCatalogItem?.stock && (inventory?.available ?? true))
        await api.updateBranchInventory(
          restaurant.id,
          order.branchId,
          selectedOrderItem.menuItemId,
          { available: false, stockQuantity: inventory?.stockQuantity ?? null },
        );
      const result = await api.proposeOrderSubstitution(order.id, {
        originalMenuItemId: selectedOrderItem.menuItemId,
        replacementMenuItemId: replacementId,
        reason: reason.trim(),
      });
      setSubstitutions((current) => [result.substitution, ...current]);
      setSelectedItemId("");
      setReplacementId("");
      setReason("");
      await onChanged();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "No se pudo enviar la propuesta",
      );
    } finally {
      setActionBusy(false);
    }
  };
  return (
    <div
      className="merchant-order-detail-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="merchant-order-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="merchant-order-detail-title"
      >
        <header>
          <div>
            <small>COMANDA {order.id}</small>
            <h2 id="merchant-order-detail-title">{orderStatusLabel[order.status]}</h2>
            <p>
              {new Date(order.createdAt).toLocaleTimeString("es-AR", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              · {branch?.name || order.branchId || "Sucursal no registrada"}
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Cerrar detalle"
          >
            <X size={19} />
          </button>
        </header>
        <div className="merchant-order-detail-scroll">
          <div className="merchant-order-detail-facts">
            <article>
              <small>Total</small>
              <strong>{money.format(order.total)}</strong>
            </article>
            <article>
              <small>Entrega estimada</small>
              <strong>{order.etaMin} min</strong>
            </article>
            <article>
              <small>Courier</small>
              <strong>{order.courierId ? "Asignado" : "Pendiente"}</strong>
            </article>
          </div>
          <section className="merchant-order-detail-card">
            <div className="merchant-order-detail-card-title">
              <h3>Productos</h3>
              <span>{order.items.length} líneas</span>
            </div>
            {order.items.map((item, index) => {
              const menuId = item.menuItemId || "",
                catalogItem = restaurant.menu.find((entry) => entry.id === menuId),
                inventory = menuId ? inventoryFor(menuId) : undefined,
                unavailable =
                  Boolean(catalogItem && !catalogItem.stock) || inventory?.available === false,
                hasPending = substitutions.some(
                  (entry) => entry.status === "pending" && entry.original.id === menuId,
                );
              return (
                <article
                  className={
                    selectedItemId === menuId
                      ? "merchant-order-line selected"
                      : "merchant-order-line"
                  }
                  key={`${menuId || item.name}-${index}`}
                >
                  <b>{item.quantity}×</b>
                  <div>
                    <div className="merchant-order-line-title">
                      <strong>{item.name}</strong>
                      {unavailable && <span>SIN STOCK</span>}
                    </div>
                    {typeof item.unitPrice === "number" && (
                      <small>{money.format(item.unitPrice)} c/u</small>
                    )}
                    {item.extras.length > 0 && <p>Agregados: {item.extras.join(", ")}</p>}
                    {item.note && (
                      <blockquote>
                        <MessageCircle size={14} />
                        {item.note}
                      </blockquote>
                    )}
                    {canManage && menuId && (
                      <button
                        type="button"
                        disabled={busy || actionBusy || hasPending}
                        onClick={() => {
                          setSelectedItemId(menuId);
                          setReplacementId("");
                          setReason("");
                        }}
                      >
                        <RefreshCw size={14} />
                        {hasPending ? "Esperando respuesta" : "Gestionar faltante"}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
          {selectedOrderItem && selectedCatalogItem && (
            <section className="merchant-order-substitution-composer">
              <small>SUSTITUCIÓN</small>
              <h3>Reemplazar {selectedOrderItem.name}</h3>
              <p>
                El faltante se aplica únicamente a {branch?.name || "la sucursal del pedido"}; el
                cliente conserva la decisión final.
              </p>
              {!order.branchId && (
                <div className="merchant-order-detail-error">
                  <TriangleAlert size={16} />
                  El pedido no conserva una sucursal operable.
                </div>
              )}
              {candidates.length > 0 ? (
                <>
                  <div className="merchant-replacement-list">
                    {candidates.map((item) => (
                      <label className={replacementId === item.id ? "selected" : ""} key={item.id}>
                        <input
                          type="radio"
                          name="merchant-replacement"
                          checked={replacementId === item.id}
                          onChange={() => setReplacementId(item.id)}
                        />
                        <span>
                          <strong>{item.name}</strong>
                          <small>
                            {item.category} · {money.format(item.price)}
                          </small>
                        </span>
                        {selectedCatalogItem.category &&
                          item.category === selectedCatalogItem.category && (
                            <em>Misma categoría</em>
                          )}
                      </label>
                    ))}
                  </div>
                  <textarea
                    rows={3}
                    maxLength={500}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Motivo para el cliente"
                  />
                  <button
                    className="primary-button"
                    type="button"
                    disabled={
                      !order.branchId ||
                      !replacementId ||
                      reason.trim().length < 3 ||
                      busy ||
                      actionBusy ||
                      selectedPending
                    }
                    onClick={() => void submit()}
                  >
                    {actionBusy ? (
                      <RefreshCw className="merchant-operations-spinner" size={16} />
                    ) : (
                      <RefreshCw size={16} />
                    )}{" "}
                    {actionBusy ? "Validando inventario…" : "Marcar agotado y proponer"}
                  </button>
                </>
              ) : (
                <div className="merchant-order-detail-error">
                  <TriangleAlert size={16} />
                  No hay reemplazos disponibles de precio igual o menor.
                </div>
              )}
            </section>
          )}
          <section className="merchant-order-detail-card">
            <div className="merchant-order-detail-card-title">
              <h3>Cambios del pedido</h3>
              {loading && <RefreshCw className="merchant-operations-spinner" size={16} />}
            </div>
            {substitutions.map((entry) => (
              <article className="merchant-substitution-history" key={entry.id}>
                <span className={entry.status}>
                  {entry.status === "pending"
                    ? "Pendiente"
                    : entry.status === "accepted"
                      ? "Aceptado"
                      : "Rechazado"}
                </span>
                <strong>
                  {entry.original.name} → {entry.replacement.name}
                </strong>
                <p>{entry.reason}</p>
                {entry.refundAmount > 0 && (
                  <small>Reintegro aplicado: {money.format(entry.refundAmount)}</small>
                )}
              </article>
            ))}
            {!loading && !substitutions.length && (
              <p>No se registraron cambios para esta comanda.</p>
            )}
          </section>
          {error && (
            <div className="merchant-order-detail-error">
              <TriangleAlert size={16} />
              {error}
            </div>
          )}
          <section className="merchant-order-destination">
            <MapPin size={18} />
            <div>
              <strong>Destino de entrega</strong>
              <p>{order.deliveryAddress}</p>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function MerchantDesktopConsole({
  state,
  restaurant,
  newDish,
  setNewDish,
  busy,
  realtimeStatus,
  runAction,
  onRefresh,
  onSwitchPortal,
  canSwitchPortal,
  onLogout,
}: {
  state: AppState;
  restaurant: Restaurant;
  newDish: {
    name: string;
    description: string;
    category: string;
    price: number;
  };
  setNewDish: React.Dispatch<
    React.SetStateAction<{
      name: string;
      description: string;
      category: string;
      price: number;
    }>
  >;
  busy: boolean;
  realtimeStatus: "connecting" | "live" | "reconnecting" | "offline";
  runAction: (action: () => Promise<unknown>, success: string) => void;
  onRefresh: () => Promise<void>;
  onSwitchPortal: () => void;
  canSwitchPortal: boolean;
  onLogout: () => void;
}) {
  const [section, setSection] = useState<
    "kitchen" | "catalog" | "branches" | "analytics" | "finance"
  >("kitchen");
  const [finance, setFinance] = useState<MerchantFinance | null>(null);
  const [operations, setOperations] = useState<MerchantOperationsDashboard | null>(null);
  const [merchantActiveOrders, setMerchantActiveOrders] = useState<Order[]>([]);
  const [merchantActiveOrdersHasMore, setMerchantActiveOrdersHasMore] = useState(false);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [operationsLoading, setOperationsLoading] = useState(true);
  const [operationsError, setOperationsError] = useState("");
  const [financeLoading, setFinanceLoading] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutPassword, setPayoutPassword] = useState("");
  const [paymentConnection, setPaymentConnection] = useState<
    import("./types").MerchantPaymentConnection | null
  >(null);
  const [paymentProviderConfigured, setPaymentProviderConfigured] = useState(false);
  const [paymentConnectionPassword, setPaymentConnectionPassword] = useState("");
  const loadFinance = useCallback(async () => {
    setFinanceLoading(true);
    try {
      const [financeResult, connectionResult] = await Promise.all([
        api.getMerchantFinance(restaurant.id),
        api.getMerchantPaymentConnection(restaurant.id),
      ]);
      setFinance(financeResult.finance);
      setPaymentConnection(connectionResult.connection);
      setPaymentProviderConfigured(connectionResult.configured);
    } finally {
      setFinanceLoading(false);
    }
  }, [restaurant.id]);
  const loadOperations = useCallback(async () => {
    setOperationsLoading(true);
    try {
      const [result, queue] = await Promise.all([
        api.getMerchantDashboard(restaurant.id),
        api.getMerchantActiveOrders(restaurant.id),
      ]);
      setOperations(result.dashboard);
      setMerchantActiveOrders(queue.orders);
      setMerchantActiveOrdersHasMore(queue.hasMore);
      setOperationsError("");
    } catch (error) {
      setOperationsError(
        error instanceof Error ? error.message : "No se pudo actualizar la operación",
      );
    } finally {
      setOperationsLoading(false);
    }
  }, [restaurant.id]);
  useEffect(() => {
    if (section === "finance") void loadFinance();
  }, [section, loadFinance]);
  const orders = state.orders.filter((order) => order.restaurantId === restaurant.id);
  const activeOrders = merchantActiveOrders;
  const detailOrder = activeOrders.find((order) => order.id === detailOrderId) || null;
  const orderStatusSignature = orders.map((order) => `${order.id}:${order.status}`).join("|");
  const stockSignature = restaurant.menu.map((item) => `${item.id}:${item.stock}`).join("|");
  useEffect(() => {
    void loadOperations();
    const timer = window.setInterval(() => void loadOperations(), 30_000);
    return () => window.clearInterval(timer);
  }, [
    loadOperations,
    orderStatusSignature,
    restaurant.etaMin,
    restaurant.manualOpen,
    stockSignature,
  ]);
  const metrics = operations?.metrics;
  const operationsUpdatedAt = operations
    ? new Intl.DateTimeFormat("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: operations.timezone,
      }).format(new Date(operations.generatedAt))
    : null;
  return (
    <main className="merchant-desktop-shell">
      {detailOrder && (
        <MerchantOrderDetailDialog
          order={detailOrder}
          restaurant={restaurant}
          busy={busy}
          onClose={() => setDetailOrderId(null)}
          onChanged={async () => {
            await onRefresh();
            await loadOperations();
          }}
        />
      )}
      <aside className="merchant-desktop-sidebar">
        <div className="admin-brand">
          <span>
            <Store size={22} />
          </span>
          <div>
            <strong>Flash Negocios</strong>
            <small>{restaurant.name}</small>
          </div>
        </div>
        <nav className="admin-nav">
          <button
            className={section === "kitchen" ? "active" : ""}
            onClick={() => setSection("kitchen")}
          >
            <ListChecks size={17} /> Cocina
          </button>
          <button
            className={section === "catalog" ? "active" : ""}
            onClick={() => setSection("catalog")}
          >
            <ShoppingBag size={17} /> Catalogo y stock
          </button>
          <button
            className={section === "branches" ? "active" : ""}
            onClick={() => setSection("branches")}
          >
            <MapPin size={17} /> Sucursales
          </button>
          <button
            className={section === "analytics" ? "active" : ""}
            onClick={() => setSection("analytics")}
          >
            <LineChart size={17} /> Rendimiento
          </button>
          <button
            className={section === "finance" ? "active" : ""}
            onClick={() => setSection("finance")}
          >
            <WalletCards size={17} /> Finanzas
          </button>
          {canSwitchPortal && (
            <button onClick={onSwitchPortal}>
              <ShieldCheck size={17} /> Superadmin
            </button>
          )}
          <button onClick={onLogout}>
            <LogIn size={17} /> Cerrar sesión
          </button>
        </nav>
        <label className="merchant-open-control">
          <span>
            <strong>Aceptar pedidos</strong>
            <small>
              {!restaurant.manualOpen
                ? "Local pausado"
                : restaurant.open
                  ? "Abierto ahora"
                  : "Fuera de horario"}
            </small>
          </span>
          <input
            type="checkbox"
            checked={restaurant.manualOpen ?? restaurant.open}
            disabled={busy}
            onChange={(event) =>
              runAction(
                () =>
                  api.updateRestaurant(restaurant.id, {
                    open: event.target.checked,
                  }),
                event.target.checked ? "Local habilitado" : "Local pausado",
              )
            }
          />
        </label>
      </aside>
      <section className="merchant-desktop-main">
        <header className="admin-topbar">
          <div>
            <span>Portal operativo</span>
            <h1>
              {section === "kitchen"
                ? "Cocina en vivo"
                : section === "catalog"
                  ? "Catalogo"
                  : section === "branches"
                    ? "Sucursales"
                    : section === "finance"
                      ? "Liquidaciones"
                      : "Rendimiento"}
            </h1>
          </div>
          <div className="admin-actions">
            <small className={`realtime-status ${realtimeStatus}`}>
              <span />
              {realtimeStatus}
            </small>
            <b>
              {operations?.branch ? `${operations.branch.etaMin} min ETA` : "ETA sin sincronizar"}
            </b>
          </div>
        </header>
        <section
          className={`merchant-operations-status ${operationsError ? "error" : operations?.source === "postgres-live-operations" ? "live" : "fallback"}`}
        >
          <span className="merchant-operations-dot" />
          <div>
            <strong>
              {operationsError
                ? operations
                  ? "Última lectura conservada"
                  : "Operación sin actualizar"
                : operations?.source === "postgres-live-operations"
                  ? "Operación conectada a PostgreSQL"
                  : operations
                    ? "Modo local explícito"
                    : "Conectando operación"}
            </strong>
            <small>
              {operationsError
                ? `${operationsError}${operationsUpdatedAt ? ` · Último dato ${operationsUpdatedAt}` : ""}`
                : operationsUpdatedAt
                  ? `Actualizado ${operationsUpdatedAt} · ${operations?.branch?.name || restaurant.name}`
                  : "Consultando la fuente autoritativa"}
            </small>
          </div>
          {operationsLoading ? (
            <RefreshCw className="merchant-operations-spinner" size={18} />
          ) : (
            <button type="button" onClick={() => void loadOperations()}>
              <RefreshCw size={16} /> Actualizar
            </button>
          )}
        </section>
        <div className="admin-kpis">
          <AdminKpi
            label="Pedidos activos"
            value={metrics?.activeOrders ?? "—"}
            detail={
              metrics
                ? `${compactMinutes(metrics.oldestActiveMinutes)} el más antiguo`
                : "cola sin sincronizar"
            }
            tone="orange"
          />
          <AdminKpi
            label="Ventas de hoy"
            value={metrics ? money.format(metrics.grossSalesToday) : "—"}
            detail={
              metrics ? `${metrics.completedToday} completados hoy` : "día local del comercio"
            }
            tone="green"
          />
          <AdminKpi
            label="Ticket de hoy"
            value={metrics ? money.format(metrics.averageTicketToday) : "—"}
            detail={metrics ? `${metrics.cancelledToday} cancelados hoy` : "sin estimaciones"}
            tone="blue"
          />
          <AdminKpi
            label="Requieren atención"
            value={metrics ? metrics.needsAction + metrics.lateOrders : "—"}
            detail={metrics ? `${metrics.lateOrders} fuera de plazo` : "SLA sin sincronizar"}
            tone="dark"
          />
        </div>
        <section className="merchant-pulse" aria-label="Pulso operativo de cocina">
          <div className="merchant-pulse-heading">
            <div>
              <small>Ahora</small>
              <h2>Pulso de cocina</h2>
            </div>
            <span>
              {metrics ? `${metrics.activeOrders} pedidos en flujo` : "Esperando datos reales"}
            </span>
          </div>
          <div className="merchant-pulse-stages">
            <article className={metrics?.needsAction ? "attention" : ""}>
              <span>Por aceptar</span>
              <strong>{metrics?.needsAction ?? "—"}</strong>
              <small>acción del local</small>
            </article>
            <article>
              <span>Preparando</span>
              <strong>{metrics?.preparing ?? "—"}</strong>
              <small>en cocina</small>
            </article>
            <article>
              <span>Listos</span>
              <strong>{metrics?.readyForPickup ?? "—"}</strong>
              <small>esperan retiro</small>
            </article>
            <article>
              <span>Con courier</span>
              <strong>{metrics?.courierFlow ?? "—"}</strong>
              <small>última milla</small>
            </article>
            <article className={metrics?.unavailableItems ? "stock" : ""}>
              <span>Sin stock</span>
              <strong>{metrics?.unavailableItems ?? "—"}</strong>
              <small>productos</small>
            </article>
          </div>
          {metrics && (metrics.lateOrders > 0 || metrics.untrackedPrepOrders > 0) && (
            <div className="merchant-pulse-alert">
              <TriangleAlert size={17} />
              <span>
                {metrics.lateOrders > 0
                  ? `${metrics.lateOrders} pedido${metrics.lateOrders === 1 ? "" : "s"} fuera del plazo de preparación.`
                  : ""}
                {metrics.lateOrders > 0 && metrics.untrackedPrepOrders > 0 ? " " : ""}
                {metrics.untrackedPrepOrders > 0
                  ? `${metrics.untrackedPrepOrders} pedido${metrics.untrackedPrepOrders === 1 ? "" : "s"} heredado${metrics.untrackedPrepOrders === 1 ? "" : "s"} sin SLA observado.`
                  : ""}
              </span>
            </div>
          )}
        </section>
        {section === "kitchen" && (
          <div className="merchant-kitchen-grid">
            <section className="admin-card">
              <AdminSectionHeader title="Comandas" action={`${activeOrders.length} activas`} />
              <div className="activity-stack">
                {merchantActiveOrdersHasMore && (
                  <div className="merchant-queue-limit">
                    <TriangleAlert size={16} />
                    <span>
                      Hay más de 100 pedidos activos. Priorizá la cola visible y contactá
                      Operaciones.
                    </span>
                  </div>
                )}
                {activeOrders.map((order) => (
                  <OrderOpsCard
                    key={order.id}
                    order={order}
                    restaurant={restaurant}
                    driver={state.drivers.find((entry) => entry.id === order.courierId)}
                    onAdvance={() => runAction(() => api.advanceOrder(order.id), "Pedido avanzado")}
                    canAdvance={["accepted", "preparing"].includes(order.status)}
                    onDetails={() => setDetailOrderId(order.id)}
                    busy={busy}
                  />
                ))}
                {operationsLoading && !activeOrders.length ? (
                  <p>Sincronizando comandas…</p>
                ) : (
                  !activeOrders.length && <p>No hay pedidos pendientes.</p>
                )}
              </div>
            </section>
            <section className="admin-card">
              <AdminSectionHeader title="Capacidad" action="SLA" />
              <p>Ajusta el tiempo visible para nuevos clientes según la carga real de cocina.</p>
              <div className="prep-actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    runAction(
                      () =>
                        api.updateRestaurant(restaurant.id, {
                          etaMin: Math.max(5, restaurant.etaMin - 5),
                        }),
                      "ETA reducida",
                    )
                  }
                >
                  -5 min
                </button>
                <b>{restaurant.etaMin} min</b>
                <button
                  disabled={busy}
                  onClick={() =>
                    runAction(
                      () =>
                        api.updateRestaurant(restaurant.id, {
                          etaMin: restaurant.etaMin + 5,
                        }),
                      "ETA ampliada",
                    )
                  }
                >
                  +5 min
                </button>
              </div>
              <div className="merchant-capacity-facts">
                <article>
                  <small>Fuera de plazo</small>
                  <strong>{metrics?.lateOrders ?? "—"}</strong>
                </article>
                <article>
                  <small>Más antiguo</small>
                  <strong>{metrics ? compactMinutes(metrics.oldestActiveMinutes) : "—"}</strong>
                </article>
                <article>
                  <small>Sin SLA observado</small>
                  <strong>{metrics?.untrackedPrepOrders ?? "—"}</strong>
                </article>
              </div>
            </section>
          </div>
        )}
        {section === "catalog" && (
          <div className="merchant-catalog-grid">
            <section className="admin-card">
              <AdminSectionHeader title="Productos" action={`${restaurant.menu.length} items`} />
              <div className="merchant-product-table">
                {restaurant.menu.map((item) => (
                  <article className="merchant-product-entry" key={item.id}>
                    <label>
                      <img src={item.image} alt="" />
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {item.category} · {money.format(item.price)}
                        </small>
                      </span>
                      <input
                        type="checkbox"
                        checked={item.stock}
                        disabled={busy}
                        onChange={(event) =>
                          runAction(
                            () => api.updateMenuStock(restaurant.id, item.id, event.target.checked),
                            "Stock actualizado",
                          )
                        }
                      />
                    </label>
                    <ModifierCatalogEditor
                      restaurantId={restaurant.id}
                      item={item}
                      busy={busy}
                      runAction={runAction}
                    />
                    <DietaryCatalogEditor
                      restaurantId={restaurant.id}
                      item={item}
                      busy={busy}
                      runAction={runAction}
                    />
                  </article>
                ))}
              </div>
            </section>
            <section className="admin-card merchant-create-product">
              <AdminSectionHeader title="Nuevo producto" action="Alta" />
              <input
                value={newDish.name}
                onChange={(event) =>
                  setNewDish((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Nombre"
              />
              <textarea
                value={newDish.description}
                onChange={(event) =>
                  setNewDish((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Descripcion"
              />
              <input
                value={newDish.category}
                onChange={(event) =>
                  setNewDish((current) => ({
                    ...current,
                    category: event.target.value,
                  }))
                }
                placeholder="Categoria"
              />
              <input
                type="number"
                value={newDish.price}
                onChange={(event) =>
                  setNewDish((current) => ({
                    ...current,
                    price: Number(event.target.value),
                  }))
                }
              />
              <button
                className="primary-button"
                disabled={busy}
                onClick={() =>
                  runAction(() => api.addMenuItem(restaurant.id, newDish), "Producto creado")
                }
              >
                <Plus size={17} /> Crear producto
              </button>
            </section>
          </div>
        )}
        {section === "branches" && (
          <div className="merchant-branches-grid">
            {(restaurant.branches || []).map((branch) => (
              <section className="admin-card merchant-branch-card" key={branch.id}>
                <div className="branch-card-head">
                  <span className={`branch-pin ${branch.open ? "live" : "paused"}`}>
                    <MapPin size={20} />
                  </span>
                  <div>
                    <small>{branch.isPrimary ? "Sucursal principal" : "Sucursal"}</small>
                    <h2>{branch.name}</h2>
                    <p>{branch.address}</p>
                  </div>
                  <label className="branch-switch">
                    <input
                      type="checkbox"
                      checked={branch.manualOpen}
                      disabled={busy}
                      onChange={(event) =>
                        runAction(
                          () =>
                            api.updateBranch(restaurant.id, branch.id, {
                              open: event.target.checked,
                              status: event.target.checked ? "active" : "paused",
                            }),
                          event.target.checked ? "Sucursal habilitada" : "Sucursal pausada",
                        )
                      }
                    />
                    <span>
                      {!branch.manualOpen
                        ? "Pausada manualmente"
                        : branch.open
                          ? "Abierta ahora"
                          : "Fuera de horario"}
                    </span>
                  </label>
                </div>
                <div className="branch-metrics">
                  <article>
                    <small>ETA publicado</small>
                    <strong>{branch.etaMin} min</strong>
                    <div className="branch-eta-actions">
                      <button
                        disabled={busy || branch.etaMin <= 5}
                        onClick={() =>
                          runAction(
                            () =>
                              api.updateBranch(restaurant.id, branch.id, {
                                etaMin: Math.max(5, branch.etaMin - 5),
                              }),
                            "ETA de sucursal actualizado",
                          )
                        }
                      >
                        −5
                      </button>
                      <button
                        disabled={busy || branch.etaMin >= 240}
                        onClick={() =>
                          runAction(
                            () =>
                              api.updateBranch(restaurant.id, branch.id, {
                                etaMin: Math.min(240, branch.etaMin + 5),
                              }),
                            "ETA de sucursal actualizado",
                          )
                        }
                      >
                        +5
                      </button>
                    </div>
                  </article>
                  <article>
                    <small>Coordenadas</small>
                    <strong>
                      {branch.lat.toFixed(4)}, {branch.lng.toFixed(4)}
                    </strong>
                    <span>PostGIS activo</span>
                  </article>
                  <article>
                    <small>Disponibles</small>
                    <strong>
                      {
                        restaurant.menu.filter(
                          (item) => branch.inventory[item.id]?.available ?? item.stock,
                        ).length
                      }
                      /{restaurant.menu.length}
                    </strong>
                    <span>Catálogo local</span>
                  </article>
                </div>
                <BranchScheduleEditor
                  restaurantId={restaurant.id}
                  branch={branch}
                  busy={busy}
                  runAction={runAction}
                />
                <div className="branch-stock-list">
                  <div className="branch-stock-title">
                    <strong>Inventario de esta sede</strong>
                    <small>Los cambios no afectan otras sucursales</small>
                  </div>
                  {restaurant.menu.map((item) => {
                    const inventory = branch.inventory[item.id],
                      available = inventory?.available ?? item.stock;
                    return (
                      <label key={item.id}>
                        <img src={item.image} alt="" />
                        <span>
                          <strong>{item.name}</strong>
                          <small>
                            {available
                              ? inventory?.stockQuantity == null
                                ? "Disponible"
                                : `${inventory.stockQuantity} unidades`
                              : "Agotado"}
                          </small>
                        </span>
                        <input
                          type="checkbox"
                          checked={available}
                          disabled={busy}
                          onChange={(event) =>
                            runAction(
                              () =>
                                api.updateBranchInventory(restaurant.id, branch.id, item.id, {
                                  available: event.target.checked,
                                  stockQuantity: event.target.checked ? null : 0,
                                }),
                              "Inventario de sucursal actualizado",
                            )
                          }
                        />
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}
            {!restaurant.branches?.length && (
              <section className="admin-card">
                <p>No hay sucursales configuradas.</p>
              </section>
            )}
          </div>
        )}
        {section === "analytics" && (
          <div className="admin-grid two">
            <section className="admin-card">
              <AdminSectionHeader title="Embudo operativo" action="Datos persistidos" />
              <div className="admin-table">
                <article className="admin-row compact">
                  <strong>Pedidos activos ahora</strong>
                  <b>{metrics?.activeOrders ?? "—"}</b>
                </article>
                <article className="admin-row compact">
                  <strong>Entregados hoy</strong>
                  <b>{metrics?.completedToday ?? "—"}</b>
                </article>
                <article className="admin-row compact">
                  <strong>Cancelados hoy</strong>
                  <b>{metrics?.cancelledToday ?? "—"}</b>
                </article>
              </div>
            </section>
            <section className="admin-card">
              <AdminSectionHeader title="Salud del catalogo" action="En vivo" />
              <p>
                {metrics
                  ? `${Math.max(0, restaurant.menu.length - metrics.unavailableItems)} productos disponibles y ${metrics.unavailableItems} pausados.`
                  : "Esperando el inventario autoritativo de la sucursal."}
              </p>
              <p>
                ETA publicado:{" "}
                {operations?.branch ? `${operations.branch.etaMin} minutos.` : "sin sincronizar."}
              </p>
              <p>
                Facturación de hoy:{" "}
                {metrics ? `${money.format(metrics.grossSalesToday)}.` : "sin sincronizar."}
              </p>
            </section>
          </div>
        )}
        {section === "finance" && (
          <div className="merchant-finance-grid">
            <section className="admin-card merchant-payout-history">
              <AdminSectionHeader
                title="Cobros del marketplace"
                action={
                  paymentConnection?.status === "connected"
                    ? paymentConnection.liveMode
                      ? "Cuenta real"
                      : "Cuenta de prueba"
                    : "Sin vincular"
                }
              />
              {paymentConnection?.status === "connected" ? (
                <>
                  <p>
                    Mercado Pago conectado · cuenta terminada en{" "}
                    {paymentConnection.externalAccountId.slice(-4)}.
                  </p>
                  <small>
                    Conectado {new Date(paymentConnection.connectedAt).toLocaleString("es-AR")}.
                    Flash renueva la autorización antes de vencer y nunca muestra tokens sin cifrar.
                  </small>
                  <div className="merchant-payout-form">
                    <input
                      type="password"
                      autoComplete="current-password"
                      placeholder="Contraseña para desvincular"
                      value={paymentConnectionPassword}
                      onChange={(event) => setPaymentConnectionPassword(event.target.value)}
                    />
                    <button
                      className="secondary-button"
                      disabled={busy || paymentConnectionPassword.length < 4}
                      onClick={() =>
                        runAction(async () => {
                          const result = await api.disconnectMerchantPaymentConnection(
                            restaurant.id,
                            paymentConnectionPassword,
                          );
                          setPaymentConnection(result.connection);
                          setPaymentConnectionPassword("");
                        }, "Mercado Pago desvinculado y credenciales eliminadas")
                      }
                    >
                      Desvincular de forma segura
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p>
                    {paymentConnection?.status === "revoked"
                      ? "La conexión anterior fue revocada y sus credenciales se eliminaron."
                      : paymentConnection?.status === "reconnect_required"
                        ? "Mercado Pago requiere renovar el consentimiento. Reconectá la cuenta antes de que se interrumpan los cobros."
                        : "Vinculá la cuenta seller para que Mercado Pago pueda dividir cobros entre el comercio y Flash."}
                  </p>
                  <button
                    className="primary-button"
                    disabled={busy || !paymentProviderConfigured}
                    onClick={() =>
                      runAction(async () => {
                        const result = await api.beginMerchantPaymentConnection(restaurant.id);
                        window.location.assign(result.authorizationUrl);
                      }, "Redirigiendo a Mercado Pago")
                    }
                  >
                    {paymentProviderConfigured
                      ? paymentConnection?.status === "reconnect_required"
                        ? "Reconectar Mercado Pago"
                        : "Conectar Mercado Pago"
                      : "Integración pendiente de credenciales"}
                  </button>
                </>
              )}
            </section>
            <section className="admin-card">
              <AdminSectionHeader
                title="Saldo liquidable"
                action={financeLoading ? "Actualizando…" : "PostgreSQL ledger"}
              />
              <strong className="merchant-balance">
                {money.format(finance?.availableBalance || 0)}
              </strong>
              <p>Ventas capturadas menos comisión y retiros reservados.</p>
              <div className="merchant-payout-form">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="Monto a retirar"
                  value={payoutAmount}
                  onChange={(event) => setPayoutAmount(event.target.value)}
                />
                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder="Contraseña actual"
                  value={payoutPassword}
                  onChange={(event) => setPayoutPassword(event.target.value)}
                  aria-label="Contraseña actual para autorizar el retiro"
                />
                <button
                  className="primary-button"
                  disabled={
                    busy ||
                    !Number(payoutAmount) ||
                    payoutPassword.length < 4 ||
                    Number(payoutAmount) > (finance?.availableBalance || 0)
                  }
                  onClick={async () => {
                    const amount = Number(payoutAmount);
                    await runAction(async () => {
                      const authorization = await api.authorizeMerchantPayout(
                        restaurant.id,
                        amount,
                        payoutPassword,
                      );
                      return api.requestMerchantPayout(
                        restaurant.id,
                        amount,
                        authorization.authorizationToken,
                      );
                    }, "Retiro reservado");
                    setPayoutAmount("");
                    setPayoutPassword("");
                    await loadFinance();
                  }}
                >
                  Solicitar retiro
                </button>
              </div>
              <small>
                Confirmás comercio e importe con tu contraseña. La autorización vence en 5 minutos,
                funciona una sola vez y el retiro queda pendiente del proveedor bancario.
              </small>
            </section>
            <section className="admin-card">
              <AdminSectionHeader
                title="Movimientos"
                action={`${finance?.movements.length || 0}`}
              />
              <div className="admin-table">
                {finance?.movements.map((entry) => (
                  <article className="admin-row compact" key={entry.id}>
                    <ReceiptText size={17} />
                    <div>
                      <strong>{entry.description}</strong>
                      <span>{new Date(entry.createdAt).toLocaleString("es-AR")}</span>
                    </div>
                    <b>
                      {entry.direction === "credit" ? "+" : "-"}
                      {money.format(entry.amount)}
                    </b>
                    <small>{entry.kind}</small>
                  </article>
                ))}
                {!financeLoading && !finance?.movements.length && <p>Sin liquidaciones todavía.</p>}
              </div>
            </section>
            <section className="admin-card merchant-payout-history">
              <AdminSectionHeader title="Retiros" action={`${finance?.payouts.length || 0}`} />
              <div className="admin-table">
                {finance?.payouts.map((entry) => (
                  <article className="admin-row compact" key={entry.id}>
                    <WalletCards size={17} />
                    <div>
                      <strong>{entry.id}</strong>
                      <span>{new Date(entry.createdAt).toLocaleDateString("es-AR")}</span>
                    </div>
                    <b>{money.format(entry.amount)}</b>
                    <small>{entry.status}</small>
                  </article>
                ))}
                {!financeLoading && !finance?.payouts.length && <p>No hay retiros solicitados.</p>}
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}

function NetworkStatusBanner({
  online,
  realtimeStatus,
  onRetry,
}: {
  online: boolean;
  realtimeStatus: "connecting" | "live" | "reconnecting" | "offline";
  onRetry: () => void;
}) {
  const realtimeDegraded =
    online && (realtimeStatus === "connecting" || realtimeStatus === "reconnecting");
  if (online && !realtimeDegraded) return null;
  const isOffline = !online;
  return (
    <div
      className={`network-status-banner ${isOffline ? "offline" : "reconnecting"}`}
      role="status"
      aria-live="polite"
    >
      <span className="network-status-icon">
        {isOffline ? <TriangleAlert size={16} /> : <RefreshCw size={16} />}
      </span>
      <span>
        <strong>{isOffline ? "Sin conexión" : "Actualizando Flash"}</strong>
        <small>
          {isOffline
            ? "Las acciones nuevas esperan hasta recuperar internet."
            : "El estado en vivo se está reconectando."}
        </small>
      </span>
      <button type="button" onClick={onRetry} disabled={isOffline}>
        <RefreshCw size={14} /> Reintentar
      </button>
    </div>
  );
}

function AppModeBar({ mode, onModeChange }: { mode: Mode; onModeChange: (mode: Mode) => void }) {
  const modes: Array<{ id: Mode; label: string; icon: LucideIcon }> = [
    { id: "customer", label: "Cliente", icon: UserRound },
    { id: "merchant", label: "Local", icon: Store },
    { id: "driver", label: "Driver", icon: Bike },
    { id: "ops", label: "Ops", icon: ShieldCheck },
  ];
  return (
    <div className="app-mode-bar" role="tablist" aria-label="Apps">
      {modes.map(({ id, label, icon: Icon }) => (
        <button
          className={mode === id ? "mode-tab active" : "mode-tab"}
          key={id}
          onClick={() => onModeChange(id)}
          type="button"
        >
          <Icon size={15} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function BrandPanel({
  state,
  mode,
  onModeChange,
  user,
}: {
  state: AppState;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  user: User | null;
}) {
  return (
    <aside className="brand-panel">
      <div className="brand-block">
        <div className="brand-mark">
          <Flame size={24} />
        </div>
        <div>
          <p className="eyebrow">Flash Platform</p>
          <h1>Comida, viajes y reparto en una sola operacion</h1>
        </div>
      </div>
      <div className="desktop-mode-grid">
        <AppModeBar mode={mode} onModeChange={onModeChange} />
      </div>
      <div className="session-card">
        <LogIn size={17} />
        <div>
          <span>Sesión autenticada</span>
          <strong>{user?.email}</strong>
        </div>
      </div>
      <div className="market-strip">
        <Metric
          label="Pedidos activos"
          value={String(state.metrics.activeOrders)}
          trend={`${state.metrics.avgOrderEta}m ETA`}
        />
        <Metric
          label="Viajes activos"
          value={String(state.metrics.activeRides)}
          trend={`${state.metrics.avgRideEta}m espera`}
        />
        <Metric
          label="Drivers online"
          value={String(state.metrics.onlineDrivers)}
          trend={`${state.metrics.openRestaurants} locales`}
        />
      </div>
      <div className="dispatch-map">
        {state.zones.slice(0, 3).map((zone, index) => (
          <div className={`zone zone-${["one", "two", "three"][index]}`} key={zone.id}>
            {zone.name} · {zone.demandLevel}
          </div>
        ))}
        <span className="pin pin-a" />
        <span className="pin pin-b" />
        <span className="pin pin-c" />
      </div>
    </aside>
  );
}

function Metric({ label, value, trend }: { label: string; value: string; trend: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{trend}</small>
    </div>
  );
}

function CustomerApp(props: {
  state: AppState;
  user: User | null;
  service: Service;
  setService: (service: Service) => void;
  tab: CustomerTab;
  setTab: (tab: CustomerTab) => void;
  query: string;
  setQuery: (query: string) => void;
  category: string;
  setCategory: (category: string) => void;
  categories: string[];
  restaurants: Restaurant[];
  allItems: Array<{ restaurant: Restaurant; item: MenuItem }>;
  selectedRestaurant: Restaurant | null;
  setSelectedRestaurantId: (id: string | null) => void;
  cart: CartLine[];
  setCart: React.Dispatch<React.SetStateAction<CartLine[]>>;
  setError: (message: string | null) => void;
  cartOpen: boolean;
  setCartOpen: (open: boolean) => void;
  checkoutOpen: boolean;
  setCheckoutOpen: (open: boolean) => void;
  cartTotals: {
    subtotal: number;
    deliveryFee: number;
    serviceFee: number;
    discount: number;
    total: number;
  };
  promotionCode: string;
  setPromotionCode: (code: string) => void;
  cartRestaurant: Restaurant | null;
  openItem: (restaurant: Restaurant, item: MenuItem) => void;
  createOrder: (
    checkout: FoodCheckoutSelection,
    providerPayment?: { cardToken: string; paymentMethodId: string; installments: number },
  ) => Promise<void>;
  rideForm: RideForm;
  setRideForm: React.Dispatch<React.SetStateAction<RideForm>>;
  quote: RideQuote | null;
  quoteRide: () => void;
  requestRide: () => void;
  createShipment: (payload: ShipmentCreatePayload) => Promise<void>;
  locatePickup: () => void;
  locationStatus: "idle" | "locating" | "ready" | "denied";
  locationMessage: string;
  onTopUpWallet: (amount: number) => void;
  onUpdateProfile: (payload: { name: string; phone: string; defaultAddress: string }) => void;
  addresses: UserAddress[];
  onCreateAddress: (payload: {
    label: string;
    address: string;
    lat: number;
    lng: number;
    isDefault: boolean;
  }) => Promise<boolean>;
  onUpdateAddress: (
    addressId: string,
    payload: {
      label: string;
      address: string;
      lat: number;
      lng: number;
      isDefault: boolean;
    },
  ) => Promise<boolean>;
  onSetDefaultAddress: (addressId: string) => Promise<boolean>;
  onDeleteAddress: (addressId: string) => Promise<boolean>;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
  dietaryPreferences: DietaryPreferences | null;
  onDietaryPreferencesChange: (preferences: DietaryPreferences) => void;
}) {
  const {
    state,
    user,
    service,
    setService,
    tab,
    setTab,
    query,
    setQuery,
    category,
    setCategory,
    categories,
    restaurants,
    allItems,
    selectedRestaurant,
    setSelectedRestaurantId,
    cart,
    setCart,
    setError,
    cartOpen,
    setCartOpen,
    checkoutOpen,
    setCheckoutOpen,
    cartTotals,
    promotionCode,
    setPromotionCode,
    cartRestaurant,
    openItem,
    createOrder,
    rideForm,
    setRideForm,
    quote,
    quoteRide,
    requestRide,
    createShipment,
    locatePickup,
    locationStatus,
    locationMessage,
    onTopUpWallet,
    onUpdateProfile,
    addresses,
    onCreateAddress,
    onUpdateAddress,
    onSetDefaultAddress,
    onDeleteAddress,
    busy,
    runAction,
    dietaryPreferences,
    onDietaryPreferencesChange,
  } = props;

  if (selectedRestaurant) {
    return (
      <RestaurantDetail
        restaurant={selectedRestaurant}
        dietaryPreferences={dietaryPreferences}
        cartCount={cart.reduce((sum, line) => sum + line.quantity, 0)}
        onBack={() => setSelectedRestaurantId(null)}
        onOpenCart={() => setCartOpen(true)}
        onOpenItem={(item) => openItem(selectedRestaurant, item)}
      />
    );
  }

  if (cartOpen) {
    return (
      <CartScreen
        cart={cart}
        onCartChange={(nextCart) => {
          setCart(nextCart);
          void api
            .saveCart(nextCart[0]?.restaurantId || cartRestaurant?.id || "empty", nextCart)
            .catch((requestError) => setError(requestError.message));
        }}
        totals={cartTotals}
        promotions={state.promotions}
        promotionCode={promotionCode}
        setPromotionCode={setPromotionCode}
        restaurant={cartRestaurant}
        checkoutOpen={checkoutOpen}
        setCheckoutOpen={setCheckoutOpen}
        onBack={() => {
          setCartOpen(false);
          setCheckoutOpen(false);
        }}
        onCreateOrder={createOrder}
        addresses={addresses}
        paymentMethods={state.paymentMethods.filter((entry) => entry.userId === user?.id)}
        customerEmail={user?.email || ""}
        busy={busy}
      />
    );
  }

  return (
    <div className="screen with-nav">
      <header className="home-header">
        <div>
          <span className="muted-label">Enviar a</span>
          <span className="location-button">
            <MapPin size={15} /> {user?.defaultAddress || "Definir direccion"}
          </span>
        </div>
        <div className="header-actions">
          <IconButton
            icon={Bell}
            label="Notificaciones"
            badge={state.notifications.filter((notification) => !notification.readAt).length}
            onClick={() => setTab("notifications")}
          />
          <IconButton
            icon={ShoppingBag}
            label="Carrito"
            badge={cart.reduce((sum, line) => sum + line.quantity, 0)}
            onClick={() => setCartOpen(true)}
          />
        </div>
      </header>

      <ServiceToggle service={service} setService={setService} />

      {tab === "home" && service === "food" && (
        <FoodHome
          restaurants={restaurants}
          allItems={allItems}
          query={query}
          setQuery={setQuery}
          category={category}
          setCategory={setCategory}
          categories={categories}
          favoriteRestaurantIds={state.favoriteRestaurantIds || []}
          onToggleFavorite={(restaurantId, favorite) =>
            runAction(
              () => api.setFavorite(restaurantId, favorite),
              favorite ? "Agregado a favoritos" : "Quitado de favoritos",
            )
          }
          onOpenRestaurant={(restaurant) => setSelectedRestaurantId(restaurant.id)}
          onOpenItem={openItem}
        />
      )}
      {tab === "home" && service === "ride" && (
        <Suspense
          fallback={
            <div className="ride-map ride-map-empty">
              <div className="ride-map-empty-copy">
                <RefreshCw size={20} />
                <strong>Cargando Viajes</strong>
              </div>
            </div>
          }
        >
          <RideHome
            state={state}
            user={user}
            addresses={addresses}
            rideForm={rideForm}
            setRideForm={setRideForm}
            quote={quote}
            quoteRide={quoteRide}
            requestRide={requestRide}
            locatePickup={locatePickup}
            locationStatus={locationStatus}
            locationMessage={locationMessage}
            busy={busy}
          />
        </Suspense>
      )}
      {tab === "home" && service === "shipment" && (
        <ShipmentHome state={state} user={user} busy={busy} onCreateShipment={createShipment} />
      )}
      {tab === "activity" && (
        <CustomerActivity state={state} user={user} runAction={runAction} busy={busy} />
      )}
      {tab === "notifications" && (
        <Suspense
          fallback={
            <div className="notification-empty" role="status">
              <RefreshCw size={16} />
              Cargando notificaciones…
            </div>
          }
        >
          <NotificationCenter state={state} runAction={runAction} busy={busy} />
        </Suspense>
      )}
      {tab === "wallet" && (
        <WalletScreen
          user={user}
          promotions={state.promotions}
          transactions={state.walletTransactions.filter((entry) => entry.userId === user?.id)}
          onTopUp={onTopUpWallet}
        />
      )}
      {tab === "profile" && (
        <ProfileScreen
          user={user}
          address={
            state.addresses.find((entry) => entry.userId === user?.id && entry.isDefault)?.address
          }
          paymentMethods={state.paymentMethods.filter((entry) => entry.userId === user?.id)}
          onSave={onUpdateProfile}
          addresses={addresses}
          onCreateAddress={onCreateAddress}
          onUpdateAddress={onUpdateAddress}
          onSetDefaultAddress={onSetDefaultAddress}
          onDeleteAddress={onDeleteAddress}
          dietaryPreferences={dietaryPreferences}
          onDietaryPreferencesChange={onDietaryPreferencesChange}
        />
      )}
      <BottomNav tab={tab} onTabChange={setTab} />
    </div>
  );
}

function ServiceToggle({
  service,
  setService,
}: {
  service: Service;
  setService: (service: Service) => void;
}) {
  return (
    <div className="service-toggle">
      <button
        className={service === "food" ? "active" : ""}
        onClick={() => setService("food")}
        type="button"
      >
        <ShoppingBag size={16} /> Comida
      </button>
      <button
        className={service === "ride" ? "active" : ""}
        onClick={() => setService("ride")}
        type="button"
      >
        <Car size={16} /> Taxi
      </button>
      <button
        className={service === "shipment" ? "active" : ""}
        onClick={() => setService("shipment")}
        type="button"
      >
        <PackageCheck size={16} /> Envíos
      </button>
    </div>
  );
}

function FoodHome({
  restaurants,
  allItems,
  query,
  setQuery,
  category,
  setCategory,
  categories,
  favoriteRestaurantIds,
  onToggleFavorite,
  onOpenRestaurant,
  onOpenItem,
}: {
  restaurants: Restaurant[];
  allItems: Array<{ restaurant: Restaurant; item: MenuItem }>;
  query: string;
  setQuery: (query: string) => void;
  category: string;
  setCategory: (category: string) => void;
  categories: string[];
  favoriteRestaurantIds: string[];
  onToggleFavorite: (restaurantId: string, favorite: boolean) => void;
  onOpenRestaurant: (restaurant: Restaurant) => void;
  onOpenItem: (restaurant: Restaurant, item: MenuItem) => void;
}) {
  return (
    <>
      <section className="promo-card">
        <img
          src="https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=900&q=80"
          alt="Promocion de comida"
        />
        <div className="promo-overlay">
          <span>Hot deal</span>
          <h2>Comida en minutos</h2>
          <p>Pedidos, tracking y reparto con backend activo.</p>
        </div>
      </section>
      <FlashPassTeaser />
      <FlashPromiseGrid />
      <SearchBar query={query} setQuery={setQuery} />
      <CategoryRail categories={categories} category={category} setCategory={setCategory} />
      <SectionTitle title="Cerca tuyo" action="Abiertos" />
      <div className="restaurant-rail">
        {restaurants.map((restaurant) => (
          <RestaurantCard
            key={restaurant.id}
            restaurant={restaurant}
            favorite={favoriteRestaurantIds.includes(restaurant.id)}
            onToggleFavorite={() =>
              onToggleFavorite(restaurant.id, !favoriteRestaurantIds.includes(restaurant.id))
            }
            onClick={() => onOpenRestaurant(restaurant)}
          />
        ))}
      </div>
      <SectionTitle title="Mas pedidos" action="Filtros" />
      <div className="item-list">
        {allItems.slice(0, 7).map(({ restaurant, item }) => (
          <FoodRow
            key={`${restaurant.id}-${item.id}`}
            item={item}
            restaurant={restaurant}
            onClick={() => onOpenItem(restaurant, item)}
          />
        ))}
      </div>
    </>
  );
}

function FlashPassTeaser() {
  return (
    <section className="flash-pass">
      <div>
        <span>Flash Pass</span>
        <strong>Envios gratis, soporte prioritario y promos cross-food/taxi</strong>
      </div>
      <span className="flash-pass-status">
        <Sparkles size={15} /> Disponible en checkout
      </span>
    </section>
  );
}

function FlashPromiseGrid() {
  const promises = [
    ["Tracking vivo", "Mapa + ETA", LocateFixed],
    ["Garantia", "Credito si falla", ShieldCheck],
    ["Grupal", "Pedido compartido", UserRound],
    ["Programar", "Food o taxi", Clock3],
  ] as const;
  return (
    <div className="promise-grid">
      {promises.map(([title, detail, Icon]) => (
        <article key={title}>
          <Icon size={16} />
          <strong>{title}</strong>
          <span>{detail}</span>
        </article>
      ))}
    </div>
  );
}

function ShipmentHome({
  state,
  user,
  busy,
  onCreateShipment,
}: {
  state: AppState;
  user: User | null;
  busy: boolean;
  onCreateShipment: (payload: ShipmentCreatePayload) => Promise<void>;
}) {
  const savedAddresses = state.addresses.filter(
    (address) =>
      address.userId === user?.id &&
      !address.id.startsWith("profile-") &&
      address.lat !== null &&
      address.lng !== null,
  );
  const [options, setOptions] = useState<ShipmentOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [pickup, setPickup] = useState(user?.defaultAddress || savedAddresses[0]?.address || "");
  const [destination, setDestination] = useState("");
  const [pickupCoords, setPickupCoords] = useState<GeoPoint | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<GeoPoint | null>(null);
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [description, setDescription] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [packageSize, setPackageSize] = useState<Shipment["packageSize"]>("small");
  const [weightKg, setWeightKg] = useState("1");
  const [declaredValue, setDeclaredValue] = useState("0");
  const [protection, setProtection] = useState<NonNullable<Shipment["protection"]>>("none");
  const [signatureRequired, setSignatureRequired] = useState(false);
  const [itemCategory, setItemCategory] =
    useState<NonNullable<Shipment["itemCategory"]>>("standard");
  const [serviceLevel, setServiceLevel] =
    useState<NonNullable<Shipment["serviceLevel"]>>("standard");
  const [quote, setQuote] = useState<ShipmentQuote | null>(null);
  const [quoteClock, setQuoteClock] = useState(() => Date.now());
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!quote?.expiresAt) return;
    setQuoteClock(Date.now());
    const timer = window.setInterval(() => setQuoteClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [quote?.expiresAt]);

  useEffect(() => {
    let cancelled = false;
    setOptionsLoading(true);
    setOptionsError(null);
    void api
      .getShipmentOptions()
      .then((response) => {
        if (cancelled) return;
        setOptions(response);
        const activeCategory = response.categories.find((entry) => entry.active !== false);
        const activeServiceLevel = response.serviceLevels.find((entry) => entry.active !== false);
        if (
          !response.categories.some(
            (entry) => entry.code === itemCategory && entry.active !== false,
          ) &&
          activeCategory
        )
          setItemCategory(activeCategory.code);
        if (
          !response.serviceLevels.some(
            (entry) => entry.code === serviceLevel && entry.active !== false,
          ) &&
          activeServiceLevel
        )
          setServiceLevel(activeServiceLevel.code);
      })
      .catch((error) => {
        if (!cancelled)
          setOptionsError(
            error instanceof Error ? error.message : "No se pudieron cargar las opciones de envío",
          );
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeCategories = options?.categories.filter((entry) => entry.active !== false) || [];
  const activeServiceLevels =
    options?.serviceLevels.filter((entry) => entry.active !== false) || [];
  const selectedCategory = activeCategories.find((entry) => entry.code === itemCategory);
  const selectedServiceLevel = activeServiceLevels.find((entry) => entry.code === serviceLevel);
  const quoteExpired = Boolean(
    quote?.expiresAt && new Date(quote.expiresAt).getTime() <= quoteClock,
  );

  const clearQuote = () => {
    setQuote(null);
    setQuoteError(null);
    setSubmitError(null);
  };

  const chooseSavedPickup = (addressId: string) => {
    const address = savedAddresses.find((entry) => entry.id === addressId);
    if (!address || address.lat === null || address.lng === null) return;
    setPickup(address.address);
    setPickupCoords({ lat: address.lat, lng: address.lng });
    clearQuote();
  };

  const quoteShipment = async () => {
    setQuoteBusy(true);
    setQuoteError(null);
    setSubmitError(null);
    try {
      if (optionsLoading) throw new Error("Esperá a que carguemos las opciones de envío");
      if (!options || !selectedCategory || !selectedServiceLevel)
        throw new Error("La configuración de envíos no está disponible");
      if (pickup.trim().length < 3 || destination.trim().length < 3)
        throw new Error("Completá origen y destino");
      if (recipientName.trim().length < 2) throw new Error("Indicá quién recibe el paquete");
      if (recipientPhone.trim().length < 6)
        throw new Error("Indicá un teléfono de contacto válido");
      if (description.trim().length < 2)
        throw new Error("Describí brevemente el contenido del paquete");
      const parsedWeight = Number(weightKg);
      const parsedDeclaredValue = Number(declaredValue || 0);
      if (!Number.isFinite(parsedWeight) || parsedWeight <= 0 || parsedWeight > 20)
        throw new Error("El peso debe estar entre 0,1 y 20 kg");
      if (!Number.isFinite(parsedDeclaredValue) || parsedDeclaredValue < 0)
        throw new Error("El valor declarado no es válido");
      if (protection === "standard" && parsedDeclaredValue <= 0)
        throw new Error("Indicá el valor declarado para contratar protección");

      const pickupMatch = pickupCoords
        ? { label: pickup, point: pickupCoords }
        : (await api.geocode(pickup.trim())).results[0];
      const destinationMatch = (await api.geocode(destination.trim())).results[0];
      if (!pickupMatch?.point || !destinationMatch?.point)
        throw new Error("No pudimos ubicar una de las direcciones");

      const normalizedPickup = pickupMatch.label || pickup.trim();
      const normalizedDestination = destinationMatch.label || destination.trim();
      setPickup(normalizedPickup);
      setDestination(normalizedDestination);
      setPickupCoords(pickupMatch.point);
      setDestinationCoords(destinationMatch.point);
      const response = await api.quoteShipment({
        pickup: normalizedPickup,
        destination: normalizedDestination,
        packageSize,
        weightKg: parsedWeight,
        declaredValue: parsedDeclaredValue,
        protection,
        signatureRequired,
        itemCategory,
        serviceLevel,
        pickupCoords: pickupMatch.point,
        destinationCoords: destinationMatch.point,
      });
      setQuote(response.quote);
    } catch (error) {
      setQuote(null);
      setQuoteError(error instanceof Error ? error.message : "No se pudo cotizar el envío");
    } finally {
      setQuoteBusy(false);
    }
  };

  const submitShipment = async () => {
    setSubmitError(null);
    if (!quote?.quoteToken || quoteExpired) {
      setSubmitError("La cotización venció. Calculá una nueva antes de solicitar.");
      return;
    }
    if (!termsAccepted) {
      setSubmitError("Aceptá las restricciones y condiciones del envío");
      return;
    }
    if (!pickupCoords || !destinationCoords) {
      setSubmitError("Volvé a cotizar para validar las coordenadas reales");
      return;
    }
    try {
      await onCreateShipment({
        pickup,
        destination,
        recipientName: recipientName.trim(),
        recipientPhone: recipientPhone.trim(),
        packageSize,
        description: description.trim(),
        weightKg: Number(weightKg),
        declaredValue: Number(declaredValue || 0),
        protection,
        signatureRequired,
        itemCategory,
        serviceLevel,
        deliveryNotes: deliveryNotes.trim(),
        paymentMethod: "Flash Wallet",
        termsAccepted: true,
        pickupCoords,
        destinationCoords,
        quoteToken: quote.quoteToken,
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "No se pudo solicitar el envío");
    }
  };

  return (
    <div className="shipment-home">
      <section className="shipment-hero">
        <div className="shipment-hero-icon">
          <PackageCheck size={23} />
        </div>
        <div>
          <span className="muted-label">Flash Envíos</span>
          <h1>Mandá un paquete hoy</h1>
          <p>Retiro, seguimiento y entrega con PIN desde una sola app.</p>
        </div>
      </section>
      <section className="shipment-form-card">
        <div className="shipment-section-heading">
          <div>
            <span className="muted-label">Ruta</span>
            <h2>¿De dónde a dónde?</h2>
          </div>
          <span className="shipment-live-chip">
            <LocateFixed size={13} /> Geocodificación real
          </span>
        </div>
        {savedAddresses.length > 0 && (
          <label>
            <span>Usar dirección guardada como origen</span>
            <select defaultValue="" onChange={(event) => chooseSavedPickup(event.target.value)}>
              <option value="">Elegir una dirección</option>
              {savedAddresses.map((address) => (
                <option value={address.id} key={address.id}>
                  {address.label} · {address.address}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="shipment-address-grid">
          <label>
            <span>Origen</span>
            <input
              value={pickup}
              onChange={(event) => {
                setPickup(event.target.value);
                setPickupCoords(null);
                clearQuote();
              }}
              placeholder="Calle, número y ciudad"
              autoComplete="street-address"
            />
          </label>
          <label>
            <span>Destino</span>
            <input
              value={destination}
              onChange={(event) => {
                setDestination(event.target.value);
                setDestinationCoords(null);
                clearQuote();
              }}
              placeholder="Calle, número y ciudad"
              autoComplete="shipping street-address"
            />
          </label>
        </div>
        <div className="shipment-section-heading compact">
          <div>
            <span className="muted-label">Paquete</span>
            <h2>Características del envío</h2>
          </div>
        </div>
        <div className="shipment-size-grid">
          {(["small", "medium", "large"] as const).map((size) => (
            <button
              type="button"
              key={size}
              className={packageSize === size ? "active" : ""}
              onClick={() => {
                setPackageSize(size);
                clearQuote();
              }}
            >
              <PackageCheck size={16} />
              <strong>
                {size === "small" ? "Pequeño" : size === "medium" ? "Mediano" : "Grande"}
              </strong>
              <small>
                {size === "small" ? "Hasta 2 kg" : size === "medium" ? "Hasta 8 kg" : "Hasta 20 kg"}
              </small>
            </button>
          ))}
        </div>
        <div className="shipment-fields-grid">
          <label>
            <span>Categoría</span>
            <select
              value={itemCategory}
              disabled={optionsLoading}
              onChange={(event) => {
                setItemCategory(event.target.value as typeof itemCategory);
                clearQuote();
              }}
            >
              {activeCategories.map((categoryOption) => (
                <option value={categoryOption.code} key={categoryOption.code}>
                  {categoryOption.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Nivel de servicio</span>
            <select
              value={serviceLevel}
              disabled={optionsLoading}
              onChange={(event) => {
                setServiceLevel(event.target.value as typeof serviceLevel);
                clearQuote();
              }}
            >
              {activeServiceLevels.map((level) => (
                <option value={level.code} key={level.code}>
                  {level.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Peso en kg</span>
            <input
              type="number"
              min="0.1"
              max="20"
              step="0.1"
              value={weightKg}
              onChange={(event) => {
                setWeightKg(event.target.value);
                clearQuote();
              }}
            />
          </label>
          <label>
            <span>Valor declarado</span>
            <input
              type="number"
              min="0"
              max="1000000"
              step="1"
              value={declaredValue}
              onChange={(event) => {
                setDeclaredValue(event.target.value);
                clearQuote();
              }}
            />
          </label>
        </div>
        <div className="shipment-fields-grid">
          <label>
            <span>¿Qué enviás?</span>
            <input
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                clearQuote();
              }}
              maxLength={180}
              placeholder="Ej. Documentos, regalo, electrónica"
            />
          </label>
          <label>
            <span>Protección</span>
            <select
              value={protection}
              onChange={(event) => {
                setProtection(event.target.value as typeof protection);
                clearQuote();
              }}
            >
              <option value="none">Sin protección adicional</option>
              <option value="standard">Protección estándar</option>
            </select>
          </label>
        </div>
        <label className="shipment-check-row">
          <input
            type="checkbox"
            checked={signatureRequired}
            onChange={(event) => {
              setSignatureRequired(event.target.checked);
              clearQuote();
            }}
          />
          <span>
            <strong>Solicitar firma del destinatario</strong>
            <small>La entrega conservará firma y consentimiento cifrados.</small>
          </span>
        </label>
        <div className="shipment-section-heading compact">
          <div>
            <span className="muted-label">Entrega</span>
            <h2>¿Quién recibe?</h2>
          </div>
        </div>
        <div className="shipment-fields-grid">
          <label>
            <span>Nombre del destinatario</span>
            <input
              value={recipientName}
              onChange={(event) => setRecipientName(event.target.value)}
              autoComplete="name"
              placeholder="Nombre y apellido"
            />
          </label>
          <label>
            <span>Teléfono</span>
            <input
              value={recipientPhone}
              onChange={(event) => setRecipientPhone(event.target.value)}
              autoComplete="tel"
              placeholder="Código de área y número"
            />
          </label>
        </div>
        <label>
          <span>
            Indicaciones para el retiro o entrega <small>(opcional)</small>
          </span>
          <textarea
            value={deliveryNotes}
            onChange={(event) => setDeliveryNotes(event.target.value)}
            maxLength={300}
            placeholder="Piso, horario o referencia útil"
          />
        </label>
        {selectedCategory?.handlingInstructions && (
          <p className="shipment-rule-note">
            <ShieldCheck size={15} /> {selectedCategory.handlingInstructions}
          </p>
        )}
        {optionsError && (
          <p className="form-error">
            <TriangleAlert size={15} /> {optionsError}
          </p>
        )}
        {quoteError && (
          <p className="form-error">
            <TriangleAlert size={15} /> {quoteError}
          </p>
        )}
        <button
          className="primary-button shipment-quote-button"
          type="button"
          onClick={() => void quoteShipment()}
          disabled={busy || quoteBusy || optionsLoading}
        >
          <BadgeDollarSign size={17} /> {quoteBusy ? "Ubicando y calculando…" : "Cotizar envío"}
        </button>
      </section>
      {quote && (
        <section className="shipment-quote-card">
          <div className="shipment-quote-topline">
            <div>
              <span className="muted-label">Cotización vigente</span>
              <strong>{money.format(quote.fare)}</strong>
            </div>
            <span className="shipment-quote-eta">
              <Clock3 size={14} /> {quote.etaMin} min estimados
            </span>
          </div>
          <div className="shipment-quote-details">
            <span>{quote.distanceKm} km de recorrido</span>
            <span>
              {quote.itemCategoryName || selectedCategory?.name || "Categoría configurada"}
            </span>
            <span>{quote.serviceLevelName || selectedServiceLevel?.name || "SLA configurado"}</span>
            {quote.protectionPremium ? (
              <span>Protección {money.format(quote.protectionPremium)}</span>
            ) : null}
          </div>
          <small>
            Vence{" "}
            {quote.expiresAt
              ? new Date(quote.expiresAt).toLocaleTimeString("es-AR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "en 5 minutos"}
            . Si cambiás un dato, deberás cotizar de nuevo.
          </small>
        </section>
      )}
      <section className="shipment-confirm-card">
        <div className="shipment-payment-row">
          <div>
            <span className="muted-label">Medio de pago</span>
            <strong>Flash Wallet</strong>
            <small>Saldo disponible: {money.format(user?.wallet || 0)}</small>
          </div>
          <WalletCards size={20} />
        </div>
        <label className="shipment-check-row terms">
          <input
            type="checkbox"
            checked={termsAccepted}
            onChange={(event) => {
              setTermsAccepted(event.target.checked);
              setSubmitError(null);
            }}
          />
          <span>
            Acepto las restricciones de artículos, los términos de entrega y el uso del PIN o firma
            para verificar la recepción.
          </span>
        </label>
        {submitError && (
          <p className="form-error">
            <TriangleAlert size={15} /> {submitError}
          </p>
        )}
        <button
          className="primary-button"
          type="button"
          onClick={() => void submitShipment()}
          disabled={busy || !quote?.quoteToken || quoteExpired || !termsAccepted}
        >
          <Truck size={17} /> {busy ? "Solicitando…" : "Solicitar envío"}
        </button>
      </section>
    </div>
  );
}

function CustomerActivity({
  state,
  user,
  runAction,
  busy,
}: {
  state: AppState;
  user: User | null;
  runAction: (action: () => Promise<unknown>, success: string) => void;
  busy: boolean;
}) {
  const orders = state.orders.filter((order) => order.customerId === user?.id);
  const rides = state.rides.filter((ride) => ride.customerId === user?.id);
  const shipments = state.shipments.filter((shipment) => shipment.customerId === user?.id);
  const [trackingOrderId, setTrackingOrderId] = useState<string | null>(null);
  const [trackingRideId, setTrackingRideId] = useState<string | null>(null);
  const [trackingShipmentId, setTrackingShipmentId] = useState<string | null>(null);
  const trackingOrder = orders.find((order) => order.id === trackingOrderId) || null;
  const trackingRide = rides.find((ride) => ride.id === trackingRideId) || null;
  const trackingShipment = shipments.find((shipment) => shipment.id === trackingShipmentId) || null;
  return (
    <div className="activity-stack">
      <SectionTitle title="Pedidos" />
      {orders.map((order) => {
        const restaurant = state.restaurants.find((entry) => entry.id === order.restaurantId);
        const rated = state.ratings.some(
          (entry) => entry.jobId === order.id && entry.subjectType === "merchant",
        );
        const active = !["delivered", "cancelled"].includes(order.status);
        return (
          <StatusCard
            key={order.id}
            icon={ShoppingBag}
            title={`${restaurant?.name || "Restaurante"} · ${orderStatusLabel[order.status]}`}
            subtitle={`${order.items.length} items · ${order.deliveryAddress}`}
            amount={order.total}
            status={order.status}
            actionLabel={
              active
                ? "Seguir pedido"
                : order.status === "delivered"
                  ? rated
                    ? undefined
                    : "Calificar 5★"
                  : undefined
            }
            onAction={() =>
              active
                ? setTrackingOrderId(order.id)
                : order.status === "delivered"
                  ? runAction(
                      () => api.createRating(order.id, "merchant", 5),
                      "Gracias por tu calificación",
                    )
                  : undefined
            }
            secondaryActionLabel={active ? "Cancelar" : undefined}
            onSecondaryAction={
              active
                ? () =>
                    runAction(() => api.setOrderStatus(order.id, "cancelled"), "Pedido cancelado")
                : undefined
            }
            disabled={busy}
          />
        );
      })}
      <SectionTitle title="Viajes" />
      {rides.map((ride) => {
        const driver = state.drivers.find((entry) => entry.id === ride.driverId);
        const rated = state.ratings.some(
          (entry) => entry.jobId === ride.id && entry.subjectType === "driver",
        );
        const active = !["completed", "cancelled"].includes(ride.status);
        return (
          <StatusCard
            key={ride.id}
            icon={Car}
            title={`${rideStatusLabel[ride.status]} · ${driver?.name || "Sin conductor"}`}
            subtitle={`${ride.pickup} → ${ride.destination}`}
            amount={ride.fare}
            status={ride.status}
            actionLabel={
              active
                ? "Seguir viaje"
                : ride.status === "completed"
                  ? rated
                    ? undefined
                    : "Calificar 5★"
                  : undefined
            }
            onAction={() =>
              active
                ? setTrackingRideId(ride.id)
                : ride.status === "completed"
                  ? runAction(
                      () => api.createRating(ride.id, "driver", 5),
                      "Gracias por tu calificación",
                    )
                  : undefined
            }
            secondaryActionLabel={active ? "Cancelar" : undefined}
            onSecondaryAction={
              active
                ? () => runAction(() => api.setRideStatus(ride.id, "cancelled"), "Viaje cancelado")
                : undefined
            }
            disabled={busy}
          />
        );
      })}
      <SectionTitle title="Envíos" />
      {shipments.map((shipment) => {
        const driver = state.drivers.find((entry) => entry.id === shipment.driverId);
        const active = !["delivered", "cancelled"].includes(shipment.status);
        return (
          <StatusCard
            key={shipment.id}
            icon={PackageCheck}
            title={`${shipmentStatusLabel[shipment.status]} · ${shipment.recipientName}`}
            subtitle={`${shipment.pickup} → ${shipment.destination} · ${shipment.packageSize}`}
            amount={shipment.fare}
            status={shipment.status}
            actionLabel={active ? "Seguir envío" : undefined}
            onAction={active ? () => setTrackingShipmentId(shipment.id) : undefined}
            secondaryActionLabel={active ? "Cancelar" : undefined}
            onSecondaryAction={
              active
                ? () =>
                    runAction(
                      () => api.setShipmentStatus(shipment.id, "cancelled"),
                      "Envío cancelado",
                    )
                : undefined
            }
            disabled={busy}
          />
        );
      })}
      {trackingOrder && (
        <OrderTrackingSheet
          order={trackingOrder}
          driver={state.drivers.find((driver) => driver.id === trackingOrder.courierId) || null}
          onClose={() => setTrackingOrderId(null)}
        />
      )}
      {trackingRide && (
        <RideTrackingSheet
          ride={trackingRide}
          driver={state.drivers.find((driver) => driver.id === trackingRide.driverId) || null}
          onClose={() => setTrackingRideId(null)}
        />
      )}
      {trackingShipment && (
        <ShipmentTrackingSheet
          shipment={trackingShipment}
          driver={state.drivers.find((driver) => driver.id === trackingShipment.driverId) || null}
          onClose={() => setTrackingShipmentId(null)}
        />
      )}
    </div>
  );
}

function OrderTrackingSheet({
  order,
  driver,
  onClose,
}: {
  order: Order;
  driver: Driver | null;
  onClose: () => void;
}) {
  const [route, setRoute] = useState<RoadRoute | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [shareLabel, setShareLabel] = useState("Compartir estado");

  useEffect(() => {
    let cancelled = false;
    const origin = order.pickupLocation;
    const destination = order.deliveryLocation;
    setRoute(null);
    setRouteError(null);
    if (!origin || !destination) {
      setRouteError("Mapa no disponible: faltan coordenadas del pedido.");
      return () => {
        cancelled = true;
      };
    }
    setRouteLoading(true);
    void api
      .route(origin, destination)
      .then((response) => {
        if (!cancelled) setRoute(response.route);
      })
      .catch((error) => {
        if (!cancelled)
          setRouteError(
            error instanceof Error ? error.message : "La ruta vial no está disponible ahora.",
          );
      })
      .finally(() => {
        if (!cancelled) setRouteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    order.id,
    order.pickupLocation?.lat,
    order.pickupLocation?.lng,
    order.deliveryLocation?.lat,
    order.deliveryLocation?.lng,
  ]);

  const hasMap = Boolean(order.pickupLocation && order.deliveryLocation);
  const currentIndex = Math.max(orderSteps.indexOf(order.status), 0);
  const share = async () => {
    const text = `Mi pedido ${order.id} está ${orderStatusLabel[order.status].toLowerCase()}. ETA publicada: ${order.etaMin} min.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Seguimiento Flash", text });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setShareLabel("Estado copiado");
        window.setTimeout(() => setShareLabel("Compartir estado"), 2200);
      }
    } catch (_error) {
      // El usuario puede cerrar el diálogo nativo sin cambiar el pedido.
    }
  };

  return (
    <div className="sheet-backdrop tracking-backdrop" role="presentation">
      <section
        className="item-sheet order-tracking-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-tracking-title"
      >
        <button
          className="sheet-close"
          type="button"
          onClick={onClose}
          aria-label="Cerrar seguimiento"
        >
          <X size={18} />
        </button>
        <div className="tracking-sheet-heading">
          <div>
            <span className="muted-label">Seguimiento en vivo</span>
            <h2 id="order-tracking-title">Pedido {order.id}</h2>
            <p>
              {orderStatusLabel[order.status]} · ETA publicada {order.etaMin} min
            </p>
          </div>
          <button className="tracking-share-button" type="button" onClick={() => void share()}>
            <Copy size={15} /> {shareLabel}
          </button>
        </div>
        {hasMap ? (
          <Suspense
            fallback={
              <div className="order-tracking-map flash-map-loading">
                <span>Cargando mapa…</span>
              </div>
            }
          >
            <FlashMap
              origin={order.pickupLocation!}
              destination={order.deliveryLocation!}
              route={route?.coordinates || []}
              driver={driver?.location || null}
              routeColor="#f4511e"
              ariaLabel="Mapa interactivo de seguimiento del pedido"
              caption={
                route
                  ? `${route.distanceKm} km · ${route.durationMin} min de recorrido`
                  : routeLoading
                    ? "Calculando ruta real…"
                    : routeError || "Ruta vial no disponible"
              }
              detail={
                driver ? `${driver.name} · ${driver.vehicle}` : "Buscando repartidor disponible"
              }
            />
          </Suspense>
        ) : (
          <div className="tracking-map-empty">
            <MapPin size={20} />
            <strong>El mapa se activará al recibir coordenadas</strong>
            <span>{routeError}</span>
          </div>
        )}
        <div className="tracking-status-panel">
          <div className="tracking-status-copy">
            <div>
              <span className="muted-label">Estado actual</span>
              <h3>{orderStatusLabel[order.status]}</h3>
            </div>
            {driver && (
              <div className="tracking-driver-summary">
                <span className="avatar">{initials(driver.name)}</span>
                <span>
                  <strong>{driver.name}</strong>
                  <small>
                    {driver.vehicle} · ★ {driver.rating.toFixed(1)}
                  </small>
                </span>
              </div>
            )}
          </div>
          <div className="stepper tracking-stepper">
            {orderSteps.map((step, index) => (
              <div className={index <= currentIndex ? "step active" : "step"} key={step}>
                <span>{index < currentIndex ? <Check size={12} /> : index + 1}</span>
                <small>{orderStatusLabel[step]}</small>
              </div>
            ))}
          </div>
        </div>
        <p className="tracking-integrity-note">
          La ubicación del repartidor aparece únicamente cuando el backend recibe una actualización
          válida. El timeline y la ETA siguen disponibles durante una degradación de mapas.
        </p>
      </section>
    </div>
  );
}

const rideSafetyOptions = [
  ["sos", "Necesito ayuda urgente"],
  ["unsafe_driving", "Conducción insegura"],
  ["medical", "Emergencia médica"],
  ["harassment", "Acoso o amenaza"],
  ["crash", "Choque o incidente vial"],
  ["other", "Otro problema"],
] as const;

function RideTrackingSheet({
  ride,
  driver,
  onClose,
}: {
  ride: Ride;
  driver: Driver | null;
  onClose: () => void;
}) {
  const [route, setRoute] = useState<RoadRoute | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [pickupCode, setPickupCode] = useState<string | null>(null);
  const [pickupBusy, setPickupBusy] = useState(false);
  const [trackingUrl, setTrackingUrl] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [safetyType, setSafetyType] = useState<(typeof rideSafetyOptions)[number][0]>("sos");
  const [safetyDetails, setSafetyDetails] = useState("");
  const [safetyBusy, setSafetyBusy] = useState(false);
  const [safetyNotice, setSafetyNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const origin = ride.pickupLocation;
    const destination = ride.destinationLocation;
    setRoute(null);
    setRouteError(null);
    if (!origin || !destination) {
      setRouteError("Mapa no disponible: faltan coordenadas del viaje.");
      return () => {
        cancelled = true;
      };
    }
    setRouteLoading(true);
    void api
      .route(origin, destination)
      .then((response) => {
        if (!cancelled) setRoute(response.route);
      })
      .catch((error) => {
        if (!cancelled)
          setRouteError(
            error instanceof Error ? error.message : "La ruta vial no está disponible ahora.",
          );
      })
      .finally(() => {
        if (!cancelled) setRouteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    ride.id,
    ride.pickupLocation?.lat,
    ride.pickupLocation?.lng,
    ride.destinationLocation?.lat,
    ride.destinationLocation?.lng,
  ]);

  const hasMap = Boolean(ride.pickupLocation && ride.destinationLocation);
  const currentIndex = Math.max(rideSteps.indexOf(ride.status), 0);
  const nextStep = route?.steps[0]?.instruction || null;

  const revealPickupCode = async () => {
    setPickupBusy(true);
    try {
      const response = await api.getRidePickupCode(ride.id);
      setPickupCode(response.pickupCode);
    } catch (error) {
      setShareNotice(error instanceof Error ? error.message : "No se pudo consultar el PIN.");
    } finally {
      setPickupBusy(false);
    }
  };

  const shareRide = async () => {
    setShareBusy(true);
    setShareNotice(null);
    try {
      const response = await api.createRideTrackingLink(ride.id, 180);
      const configuredUrl = response.link.trackingUrl;
      const token = configuredUrl.split("/track/")[1]?.split(/[?#]/)[0];
      const url =
        token && typeof window !== "undefined"
          ? `${window.location.origin}/track/${token}`
          : configuredUrl;
      setTrackingUrl(url);
      const text = `Seguimiento de mi viaje Flash. Conductor: ${driver?.name || "asignando"}. Vence: ${new Date(response.link.expiresAt).toLocaleString("es-AR")}. ${url}`;
      if (navigator.share) {
        await navigator.share({ title: "Viaje Flash", text, url });
        setShareNotice("Seguimiento compartido");
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setShareNotice("Enlace temporal copiado");
      } else {
        setShareNotice("Enlace temporal creado");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setShareNotice(error instanceof Error ? error.message : "No se pudo compartir el viaje.");
    } finally {
      setShareBusy(false);
    }
  };

  const submitSafetyIncident = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSafetyBusy(true);
    setSafetyNotice(null);
    try {
      await api.createRideSafetyIncident(ride.id, {
        type: safetyType,
        details: safetyDetails.trim() || undefined,
        location: driver?.location || ride.pickupLocation || undefined,
      });
      setSafetyNotice("Incidente registrado. Seguridad Flash ya recibió el caso.");
      setSafetyDetails("");
      setSafetyOpen(false);
    } catch (error) {
      setSafetyNotice(
        error instanceof Error ? error.message : "No se pudo registrar el incidente.",
      );
    } finally {
      setSafetyBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop tracking-backdrop" role="presentation">
      <section
        className="item-sheet order-tracking-sheet ride-tracking-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ride-tracking-title"
      >
        <button
          className="sheet-close"
          type="button"
          onClick={onClose}
          aria-label="Cerrar seguimiento"
        >
          <X size={18} />
        </button>
        <div className="tracking-sheet-heading">
          <div>
            <span className="muted-label">Viaje en vivo</span>
            <h2 id="ride-tracking-title">{rideStatusLabel[ride.status]}</h2>
            <p>
              {ride.pickup} → {ride.destination} · {money.format(ride.fare)}
            </p>
          </div>
          <span className="ride-service-badge">
            <Car size={14} /> {ride.service}
          </span>
        </div>
        {hasMap ? (
          <Suspense
            fallback={
              <div className="order-tracking-map flash-map-loading">
                <span>Cargando mapa…</span>
              </div>
            }
          >
            <FlashMap
              origin={ride.pickupLocation!}
              destination={ride.destinationLocation!}
              route={route?.coordinates || []}
              driver={driver?.location || null}
              routeColor="#7c3cff"
              ariaLabel="Mapa interactivo de seguimiento del viaje"
              caption={
                route
                  ? `${route.distanceKm} km · ${route.durationMin} min de recorrido`
                  : routeLoading
                    ? "Calculando ruta real…"
                    : routeError || "Ruta vial no disponible"
              }
              detail={
                driver
                  ? `${driver.name} · ${driver.vehicle} · ${driver.plate}`
                  : "Buscando un conductor disponible"
              }
            />
          </Suspense>
        ) : (
          <div className="tracking-map-empty">
            <MapPin size={20} />
            <strong>El mapa se activará al recibir coordenadas</strong>
            <span>{routeError}</span>
          </div>
        )}
        <div className="tracking-status-panel">
          <div className="tracking-status-copy">
            <div>
              <span className="muted-label">Estado actual</span>
              <h3>{rideStatusLabel[ride.status]}</h3>
            </div>
            {driver && (
              <div className="tracking-driver-summary">
                <span className="avatar">{initials(driver.name)}</span>
                <span>
                  <strong>{driver.name}</strong>
                  <small>
                    {driver.vehicle} · {driver.plate} · ★ {driver.rating.toFixed(1)}
                  </small>
                </span>
              </div>
            )}
          </div>
          <div className="stepper tracking-stepper ride-tracking-stepper">
            {rideSteps.map((step, index) => (
              <div className={index <= currentIndex ? "step active" : "step"} key={step}>
                <span>{index < currentIndex ? <Check size={12} /> : index + 1}</span>
                <small>{rideStatusLabel[step]}</small>
              </div>
            ))}
          </div>
          {nextStep && ride.status === "in_progress" && (
            <div className="next-route-step">
              <MapPin size={15} /> <span>{nextStep}</span>
            </div>
          )}
        </div>
        {driver && ["driver_assigned", "arriving"].includes(ride.status) && (
          <section className="ride-pin-card">
            <div>
              <span className="muted-label">PIN para iniciar</span>
              <strong>{pickupCode || "••••"}</strong>
              <small>Compartilo sólo cuando confirmes que estás junto al vehículo correcto.</small>
            </div>
            {!pickupCode && (
              <button type="button" onClick={() => void revealPickupCode()} disabled={pickupBusy}>
                <KeyRound size={15} /> {pickupBusy ? "Consultando…" : "Mostrar PIN"}
              </button>
            )}
          </section>
        )}
        <section className="ride-safety-actions">
          <div className="ride-safety-heading">
            <span className="safety-icon">
              <ShieldCheck size={18} />
            </span>
            <div>
              <strong>Centro de seguridad</strong>
              <small>Acciones vinculadas a este viaje</small>
            </div>
          </div>
          <div className="ride-action-grid">
            <button type="button" onClick={() => void shareRide()} disabled={shareBusy}>
              <Copy size={15} /> {shareBusy ? "Creando enlace…" : "Compartir viaje"}
            </button>
            <button type="button" className="danger" onClick={() => setSafetyOpen((open) => !open)}>
              <TriangleAlert size={15} /> Reportar incidente
            </button>
          </div>
          {shareNotice && <small className="tracking-action-notice">{shareNotice}</small>}
          {trackingUrl && (
            <a
              className="tracking-link-preview"
              href={trackingUrl}
              target="_blank"
              rel="noreferrer"
            >
              Abrir enlace temporal
            </a>
          )}
          {safetyNotice && (
            <small className="tracking-action-notice safety-notice">{safetyNotice}</small>
          )}
          {safetyOpen && (
            <form
              className="ride-safety-form"
              onSubmit={(event) => void submitSafetyIncident(event)}
            >
              <label>
                <span>Tipo de incidente</span>
                <select
                  value={safetyType}
                  onChange={(event) => setSafetyType(event.target.value as typeof safetyType)}
                >
                  {rideSafetyOptions.map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Detalle opcional</span>
                <textarea
                  value={safetyDetails}
                  onChange={(event) => setSafetyDetails(event.target.value)}
                  maxLength={1000}
                  placeholder="Contanos qué ocurrió"
                />
              </label>
              <button className="danger-button" type="submit" disabled={safetyBusy}>
                <TriangleAlert size={15} />{" "}
                {safetyBusy ? "Registrando…" : "Enviar a Seguridad Flash"}
              </button>
            </form>
          )}
        </section>
        <p className="tracking-integrity-note">
          La ubicación y los estados provienen del backend autenticado. Si una señal o el proveedor
          de mapas falla, Flash conserva el viaje y sus acciones de seguridad sin inventar
          movimiento.
        </p>
      </section>
    </div>
  );
}

function ShipmentTrackingSheet({
  shipment,
  driver,
  onClose,
}: {
  shipment: Shipment;
  driver: Driver | null;
  onClose: () => void;
}) {
  const [route, setRoute] = useState<RoadRoute | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [evidence, setEvidence] = useState<DeliveryEvidence[]>([]);
  const [deliveryCode, setDeliveryCode] = useState<string | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const origin = shipment.pickupLocation;
    const destination = shipment.destinationLocation;
    setRoute(null);
    setEvidence([]);
    setRouteError(null);
    if (!origin || !destination) {
      setRouteError("Mapa no disponible: faltan coordenadas del envío.");
      return () => {
        cancelled = true;
      };
    }
    setRouteLoading(true);
    void Promise.all([
      api.route(origin, destination),
      api
        .getShipmentDeliveryEvidence(shipment.id)
        .then((response) => response.evidence)
        .catch(() => []),
    ])
      .then(([routeResponse, shipmentEvidence]) => {
        if (cancelled) return;
        setRoute(routeResponse.route);
        setEvidence(shipmentEvidence);
      })
      .catch((error) => {
        if (!cancelled)
          setRouteError(
            error instanceof Error ? error.message : "La ruta vial no está disponible ahora.",
          );
      })
      .finally(() => {
        if (!cancelled) setRouteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    shipment.id,
    shipment.pickupLocation?.lat,
    shipment.pickupLocation?.lng,
    shipment.destinationLocation?.lat,
    shipment.destinationLocation?.lng,
  ]);

  const hasMap = Boolean(shipment.pickupLocation && shipment.destinationLocation);
  const currentIndex = Math.max(shipmentSteps.indexOf(shipment.status), 0);
  const nextStep = route?.steps[0]?.instruction || null;
  const proofCount = Math.max(evidence.length, shipment.deliveryEvidenceCount || 0);

  const revealDeliveryCode = async () => {
    setCodeBusy(true);
    setActionNotice(null);
    try {
      const response = await api.getShipmentDeliveryCode(shipment.id);
      setDeliveryCode(response.deliveryCode);
    } catch (error) {
      setActionNotice(
        error instanceof Error ? error.message : "No se pudo consultar el PIN de entrega.",
      );
    } finally {
      setCodeBusy(false);
    }
  };

  const shareShipment = async () => {
    const text = `Mi envío Flash está ${shipmentStatusLabel[shipment.status].toLowerCase()}. Destino: ${shipment.destination}. ETA publicada: ${shipment.etaMin} min.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Seguimiento de envío Flash", text });
        setActionNotice("Estado compartido");
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setActionNotice("Estado copiado");
      } else {
        setActionNotice("El estado está disponible para compartir");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setActionNotice("No se pudo compartir el estado.");
    }
  };

  return (
    <div className="sheet-backdrop tracking-backdrop" role="presentation">
      <section
        className="item-sheet order-tracking-sheet shipment-tracking-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shipment-tracking-title"
      >
        <button
          className="sheet-close"
          type="button"
          onClick={onClose}
          aria-label="Cerrar seguimiento"
        >
          <X size={18} />
        </button>
        <div className="tracking-sheet-heading">
          <div>
            <span className="muted-label">Envío en vivo</span>
            <h2 id="shipment-tracking-title">{shipmentStatusLabel[shipment.status]}</h2>
            <p>
              {shipment.pickup} → {shipment.destination} · ETA publicada {shipment.etaMin} min
            </p>
          </div>
          <button
            className="tracking-share-button"
            type="button"
            onClick={() => void shareShipment()}
          >
            <Copy size={15} /> Compartir estado
          </button>
        </div>
        {hasMap ? (
          <Suspense
            fallback={
              <div className="order-tracking-map flash-map-loading">
                <span>Cargando mapa…</span>
              </div>
            }
          >
            <FlashMap
              origin={shipment.pickupLocation!}
              destination={shipment.destinationLocation!}
              route={route?.coordinates || []}
              driver={driver?.location || null}
              routeColor="#087a50"
              ariaLabel="Mapa interactivo de seguimiento del envío"
              caption={
                route
                  ? `${route.distanceKm} km · ${route.durationMin} min de recorrido`
                  : routeLoading
                    ? "Calculando ruta real…"
                    : routeError || "Ruta vial no disponible"
              }
              detail={
                driver ? `${driver.name} · ${driver.vehicle}` : "Buscando un repartidor disponible"
              }
            />
          </Suspense>
        ) : (
          <div className="tracking-map-empty">
            <MapPin size={20} />
            <strong>El mapa se activará al recibir coordenadas</strong>
            <span>{routeError}</span>
          </div>
        )}
        <div className="tracking-status-panel">
          <div className="tracking-status-copy">
            <div>
              <span className="muted-label">Estado actual</span>
              <h3>{shipmentStatusLabel[shipment.status]}</h3>
            </div>
            {driver && (
              <div className="tracking-driver-summary">
                <span className="avatar">{initials(driver.name)}</span>
                <span>
                  <strong>{driver.name}</strong>
                  <small>
                    {driver.vehicle} · ★ {driver.rating.toFixed(1)}
                  </small>
                </span>
              </div>
            )}
          </div>
          <div className="stepper tracking-stepper shipment-tracking-stepper">
            {shipmentSteps.map((step, index) => (
              <div className={index <= currentIndex ? "step active" : "step"} key={step}>
                <span>{index < currentIndex ? <Check size={12} /> : index + 1}</span>
                <small>{shipmentStatusLabel[step]}</small>
              </div>
            ))}
          </div>
          {nextStep && shipment.status === "delivering" && (
            <div className="next-route-step">
              <MapPin size={15} /> <span>{nextStep}</span>
            </div>
          )}
        </div>
        <section className="shipment-tracking-summary">
          <div>
            <span className="muted-label">Paquete</span>
            <strong>{shipment.description || "Envío Flash"}</strong>
            <small>
              {shipment.packageSize} · {shipment.weightKg} kg ·{" "}
              {shipment.itemCategory || "standard"}
            </small>
          </div>
          <div>
            <span className="muted-label">Destinatario</span>
            <strong>{shipment.recipientName}</strong>
            <small>{shipment.signatureRequired ? "Firma requerida" : "Entrega con PIN"}</small>
          </div>
          <div>
            <span className="muted-label">Protección</span>
            <strong>{shipment.protection === "standard" ? "Protegido" : "Básica"}</strong>
            <small>
              {money.format(shipment.fare)} · {shipment.distanceKm} km
            </small>
          </div>
        </section>
        {driver &&
          ["driver_assigned", "arriving", "picked_up", "delivering"].includes(shipment.status) && (
            <section className="ride-pin-card shipment-pin-card">
              <div>
                <span className="muted-label">PIN de entrega</span>
                <strong>{deliveryCode || "••••"}</strong>
                <small>
                  Compartilo únicamente con quien recibe el paquete al momento de la entrega.
                </small>
              </div>
              {!deliveryCode && (
                <button type="button" onClick={() => void revealDeliveryCode()} disabled={codeBusy}>
                  <KeyRound size={15} /> {codeBusy ? "Consultando…" : "Mostrar PIN"}
                </button>
              )}
            </section>
          )}
        <section className="shipment-proof-summary">
          <div>
            <span className="muted-label">Prueba de entrega</span>
            <strong>{shipment.deliveryVerifiedAt ? "Verificada" : "Pendiente"}</strong>
          </div>
          <span>
            {proofCount > 0
              ? `${proofCount} evidencia${proofCount === 1 ? "" : "s"} registrada${proofCount === 1 ? "" : "s"}`
              : "Todavía no hay evidencia registrada"}
          </span>
        </section>
        {actionNotice && <small className="tracking-action-notice">{actionNotice}</small>}
        <p className="tracking-integrity-note">
          La ruta, el estado, el ETA, la ubicación del repartidor y la prueba de entrega provienen
          del backend autenticado. Si falta una señal o el proveedor de mapas falla, Flash conserva
          el estado operativo sin inventar movimiento.
        </p>
      </section>
    </div>
  );
}

function WalletScreen({
  user,
  promotions,
  transactions,
  onTopUp,
}: {
  user: User | null;
  promotions: AppState["promotions"];
  transactions: AppState["walletTransactions"];
  onTopUp: (amount: number) => void;
}) {
  const [amount, setAmount] = useState("10000");
  const parsedAmount = Number(amount);
  return (
    <div className="activity-stack">
      <section className="wallet-card">
        <WalletCards size={25} />
        <div>
          <span>Flash Wallet</span>
          <strong>{money.format(user?.wallet || 0)}</strong>
        </div>
        <div className="wallet-topup">
          <input
            type="number"
            min="1000"
            max="200000"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-label="Monto a cargar"
          />
          <button
            type="button"
            disabled={
              !Number.isInteger(parsedAmount) || parsedAmount < 1000 || parsedAmount > 200000
            }
            onClick={() => onTopUp(parsedAmount)}
          >
            Cargar saldo
          </button>
        </div>
      </section>
      <section className="loyalty-card">
        <div>
          <span>Actividad financiera</span>
          <strong>{transactions.length} movimientos registrados</strong>
        </div>
        <small>Las cargas y consumos quedan auditados en la cuenta autenticada.</small>
      </section>
      {transactions.slice(0, 5).map((transaction) => (
        <article className="promo-row" key={transaction.id}>
          <WalletCards size={18} />
          <div>
            <strong>{transaction.description}</strong>
            <span>{new Date(transaction.createdAt).toLocaleString("es-AR")}</span>
          </div>
          <small>
            {transaction.kind === "credit" ? "+" : "-"}
            {money.format(transaction.amount)}
          </small>
        </article>
      ))}
      {promotions.map((promotion) => (
        <article className="promo-row" key={promotion.id}>
          <TicketPercent size={18} />
          <div>
            <strong>{promotion.title}</strong>
            <span>{promotion.description}</span>
          </div>
          <small>{promotion.discountPercent}%</small>
        </article>
      ))}
    </div>
  );
}

function ProfileScreen({
  user,
  address,
  paymentMethods,
  addresses,
  onSave,
  onCreateAddress,
  onUpdateAddress,
  onSetDefaultAddress,
  onDeleteAddress,
  dietaryPreferences,
  onDietaryPreferencesChange,
}: {
  user: User | null;
  address?: string;
  paymentMethods: AppState["paymentMethods"];
  addresses: UserAddress[];
  onSave: (payload: { name: string; phone: string; defaultAddress: string }) => void;
  onCreateAddress: (payload: {
    label: string;
    address: string;
    lat: number;
    lng: number;
    isDefault: boolean;
  }) => Promise<boolean>;
  onUpdateAddress: (
    addressId: string,
    payload: {
      label: string;
      address: string;
      lat: number;
      lng: number;
      isDefault: boolean;
    },
  ) => Promise<boolean>;
  onSetDefaultAddress: (addressId: string) => Promise<boolean>;
  onDeleteAddress: (addressId: string) => Promise<boolean>;
  dietaryPreferences: DietaryPreferences | null;
  onDietaryPreferencesChange: (preferences: DietaryPreferences) => void;
}) {
  const [name, setName] = useState(user?.name || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [defaultAddress, setDefaultAddress] = useState(address || user?.defaultAddress || "");
  const [dietary, setDietary] = useState<DietaryPreferences | null>(dietaryPreferences),
    [dietaryBusy, setDietaryBusy] = useState(false),
    [dietaryError, setDietaryError] = useState("");
  const [addressDraft, setAddressDraft] = useState({
    label: "Casa",
    address: "",
    lat: null as number | null,
    lng: null as number | null,
    isDefault: addresses.length === 0,
  });
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [addressStatus, setAddressStatus] = useState("");
  const [addressStatusTone, setAddressStatusTone] = useState<"ready" | "denied" | "">("");
  useEffect(() => {
    setName(user?.name || "");
    setPhone(user?.phone || "");
    setDefaultAddress(address || user?.defaultAddress || "");
  }, [address, user?.defaultAddress, user?.name, user?.phone]);
  useEffect(() => setDietary(dietaryPreferences), [dietaryPreferences]);
  const toggleDiet = (code: string) =>
    setDietary((current) =>
      current
        ? {
            ...current,
            dietaryLabels: current.dietaryLabels.some((item) => item.code === code)
              ? current.dietaryLabels.filter((item) => item.code !== code)
              : [
                  ...current.dietaryLabels,
                  { code, name: dietOptions.find((item) => item.code === code)?.name || code },
                ],
          }
        : current,
    );
  const toggleAllergen = (code: string) =>
    setDietary((current) =>
      current
        ? {
            ...current,
            avoidedAllergens: current.avoidedAllergens.some((item) => item.code === code)
              ? current.avoidedAllergens.filter((item) => item.code !== code)
              : [
                  ...current.avoidedAllergens,
                  { code, name: allergenOptions.find((item) => item.code === code)?.name || code },
                ],
          }
        : current,
    );
  const saveDietary = async () => {
    if (!dietary) return;
    setDietaryBusy(true);
    setDietaryError("");
    try {
      const result = await api.updateDietaryPreferences({
        dietaryLabels: dietary.dietaryLabels.map((item) => item.code),
        avoidedAllergens: dietary.avoidedAllergens.map((item) => item.code),
        hideIncompatible: dietary.hideIncompatible,
      });
      setDietary(result.preferences);
      onDietaryPreferencesChange(result.preferences);
    } catch (error) {
      setDietaryError(
        error instanceof Error ? error.message : "No se pudieron guardar tus preferencias",
      );
    } finally {
      setDietaryBusy(false);
    }
  };
  const resetAddressDraft = () => {
    setEditingAddressId(null);
    setAddressDraft({
      label: "Casa",
      address: "",
      lat: null,
      lng: null,
      isDefault: addresses.length === 0,
    });
    setAddressStatus("");
    setAddressStatusTone("");
  };
  const editAddress = (entry: UserAddress) => {
    setEditingAddressId(entry.id);
    setAddressDraft({
      label: entry.label,
      address: entry.address,
      lat: entry.lat,
      lng: entry.lng,
      isDefault: entry.isDefault,
    });
    setAddressStatus("");
    setAddressStatusTone("");
  };
  const locateAddress = () => {
    if (!navigator.geolocation) {
      setAddressStatus("Este dispositivo no permite geolocalizacion.");
      setAddressStatusTone("denied");
      return;
    }
    setAddressStatus("Obteniendo coordenadas actuales...");
    setAddressStatusTone("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setAddressDraft((current) => ({
          ...current,
          lat: coords.latitude,
          lng: coords.longitude,
          address: current.address || "Ubicacion actual",
        }));
        setAddressStatus("Ubicacion lista. Confirma el nombre y la direccion.");
        setAddressStatusTone("ready");
      },
      () => {
        setAddressStatus(
          "No pudimos acceder al GPS. Activa el permiso o escribe la direccion y usa otro dispositivo con ubicacion.",
        );
        setAddressStatusTone("denied");
      },
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 10000 },
    );
  };
  const saveAddress = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!addressDraft.address.trim() || addressDraft.lat === null || addressDraft.lng === null) {
      setAddressStatus("Necesitamos la direccion y una ubicacion GPS para guardar este destino.");
      setAddressStatusTone("denied");
      return;
    }
    const payload = {
      label: addressDraft.label.trim() || "Otro",
      address: addressDraft.address.trim(),
      lat: addressDraft.lat,
      lng: addressDraft.lng,
      isDefault: addressDraft.isDefault,
    };
    const saved = editingAddressId
      ? await onUpdateAddress(editingAddressId, payload)
      : await onCreateAddress(payload);
    if (saved) resetAddressDraft();
  };
  return (
    <div className="activity-stack">
      <section className="profile-hero">
        <div className="avatar large">{initials(user?.name || "FD")}</div>
        <div>
          <h2>{user?.name}</h2>
          <span>{user?.email}</span>
        </div>
      </section>
      <div className="settings-list">
        <label className="settings-row">
          <UserRound size={18} />
          <div>
            <strong>Nombre</strong>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </div>
        </label>
        <label className="settings-row">
          <MessageCircle size={18} />
          <div>
            <strong>Telefono</strong>
            <input value={phone} onChange={(event) => setPhone(event.target.value)} />
          </div>
        </label>
        <label className="settings-row">
          <MapPin size={18} />
          <div>
            <strong>Direccion principal</strong>
            <input
              value={defaultAddress}
              onChange={(event) => setDefaultAddress(event.target.value)}
            />
          </div>
        </label>
        <div className="settings-row">
          <CreditCard size={18} />
          <div>
            <strong>Metodos de pago</strong>
            <span>
              {paymentMethods.length
                ? paymentMethods.map((method) => method.label).join(", ")
                : "Sin metodos configurados"}
            </span>
          </div>
        </div>
        <div className="settings-row">
          <ShieldCheck size={18} />
          <div>
            <strong>Cuenta autenticada</strong>
            <span>{user?.email}</span>
          </div>
        </div>
      </div>
      <section className="address-book-card" aria-labelledby="address-book-title">
        <div className="address-book-heading">
          <div>
            <span className="muted-label">Checkout mas rapido</span>
            <h3 id="address-book-title">Mis direcciones</h3>
            <p>
              Guarda destinos frecuentes y usa coordenadas reales para entregar o pedir un viaje.
            </p>
          </div>
          <MapPin size={22} />
        </div>
        {addresses.length > 0 ? (
          <div className="saved-address-list">
            {addresses.map((entry) => (
              <article className="saved-address-row" key={entry.id}>
                <span
                  className={entry.isDefault ? "saved-address-icon default" : "saved-address-icon"}
                >
                  {entry.label.toLowerCase().includes("trab") ? (
                    <Store size={17} />
                  ) : (
                    <Home size={17} />
                  )}
                </span>
                <div className="saved-address-copy">
                  <div>
                    <strong>{entry.label}</strong>
                    {entry.isDefault && (
                      <span className="default-address-badge">Predeterminada</span>
                    )}
                  </div>
                  <span>{entry.address}</span>
                  <small>
                    {entry.lat !== null && entry.lng !== null
                      ? "Ubicacion verificada"
                      : "Sin coordenadas"}
                  </small>
                </div>
                <div className="saved-address-actions">
                  {!entry.isDefault && (
                    <button
                      type="button"
                      className="icon-button"
                      title="Usar como predeterminada"
                      aria-label={`Usar ${entry.label} como predeterminada`}
                      onClick={() => void onSetDefaultAddress(entry.id)}
                    >
                      <Check size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-button"
                    title="Editar direccion"
                    aria-label={`Editar ${entry.label}`}
                    onClick={() => editAddress(entry)}
                  >
                    <Settings size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-button danger"
                    title="Eliminar direccion"
                    aria-label={`Eliminar ${entry.label}`}
                    onClick={() => void onDeleteAddress(entry.id)}
                  >
                    <X size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="address-empty">
            <MapPin size={17} />
            <span>Aun no tienes destinos guardados.</span>
          </div>
        )}
        <form className="address-form" onSubmit={saveAddress}>
          <div className="address-form-heading">
            <strong>{editingAddressId ? "Editar destino" : "Nuevo destino"}</strong>
            {editingAddressId && (
              <button type="button" className="text-button" onClick={resetAddressDraft}>
                Cancelar
              </button>
            )}
          </div>
          <div className="address-form-grid">
            <label>
              <span>Etiqueta</span>
              <select
                value={addressDraft.label}
                onChange={(event) =>
                  setAddressDraft((current) => ({ ...current, label: event.target.value }))
                }
              >
                <option>Casa</option>
                <option>Trabajo</option>
                <option>Otro</option>
              </select>
            </label>
            <label className="address-form-wide">
              <span>Direccion</span>
              <input
                value={addressDraft.address}
                onChange={(event) =>
                  setAddressDraft((current) => ({ ...current, address: event.target.value }))
                }
                placeholder="Ej. Av. Corrientes 1234"
              />
            </label>
          </div>
          <button type="button" className="location-action" onClick={locateAddress}>
            <LocateFixed size={15} /> Usar mi ubicacion actual
          </button>
          {addressStatus && (
            <small className={`location-message ${addressStatusTone}`}>{addressStatus}</small>
          )}
          <label className="address-default-toggle">
            <input
              type="checkbox"
              checked={addressDraft.isDefault}
              onChange={(event) =>
                setAddressDraft((current) => ({ ...current, isDefault: event.target.checked }))
              }
            />
            <span>Usar para próximos pedidos y viajes</span>
          </label>
          <button
            type="submit"
            className="secondary-button"
            disabled={
              !addressDraft.address.trim() || addressDraft.lat === null || addressDraft.lng === null
            }
          >
            <MapPin size={16} /> {editingAddressId ? "Actualizar direccion" : "Guardar direccion"}
          </button>
        </form>
      </section>
      <section className="dietary-profile-card" aria-labelledby="dietary-profile-title">
        <div className="dietary-profile-heading">
          <span>
            <Leaf size={19} />
          </span>
          <div>
            <h3 id="dietary-profile-title">Mi alimentación</h3>
            <p>Personalizá el catálogo usando declaraciones verificables del comercio.</p>
          </div>
        </div>
        {!dietary && !dietaryError && (
          <p className="dietary-loading" role="status">
            <RefreshCw size={15} /> Cargando preferencias…
          </p>
        )}
        {dietary && (
          <>
            <strong>Apto para</strong>
            <div className="dietary-chip-list">
              {dietOptions.map((option) => {
                const selected = dietary.dietaryLabels.some((item) => item.code === option.code);
                return (
                  <button
                    type="button"
                    key={option.code}
                    className={selected ? "dietary-chip selected" : "dietary-chip"}
                    aria-pressed={selected}
                    onClick={() => toggleDiet(option.code)}
                  >
                    {option.name}
                  </button>
                );
              })}
            </div>
            <strong>Evito estos alérgenos</strong>
            <div className="dietary-chip-list">
              {allergenOptions.map((option) => {
                const selected = dietary.avoidedAllergens.some((item) => item.code === option.code);
                return (
                  <button
                    type="button"
                    key={option.code}
                    className={
                      selected ? "dietary-chip allergen selected" : "dietary-chip allergen"
                    }
                    aria-pressed={selected}
                    onClick={() => toggleAllergen(option.code)}
                  >
                    {option.name}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="dietary-filter-toggle"
              role="switch"
              aria-checked={dietary.hideIncompatible}
              onClick={() =>
                setDietary((current) =>
                  current ? { ...current, hideIncompatible: !current.hideIncompatible } : current,
                )
              }
            >
              <span>
                <strong>Ocultar incompatibles</strong>
                <small>“Sin datos” nunca significa que un producto sea seguro.</small>
              </span>
              <i aria-hidden="true" className={dietary.hideIncompatible ? "active" : ""} />
            </button>
            <div className="dietary-caution">
              <TriangleAlert size={17} />
              <span>
                Ante una alergia severa, confirmá con el comercio. Las indicaciones no eliminan
                contaminación cruzada.
              </span>
            </div>
            <button
              type="button"
              className="secondary-button"
              disabled={dietaryBusy}
              onClick={() => void saveDietary()}
            >
              {dietaryBusy ? "Guardando…" : "Guardar preferencias alimentarias"}
            </button>
          </>
        )}
        {dietaryError && (
          <p className="form-error" role="alert">
            {dietaryError}
          </p>
        )}
      </section>
      <button
        className="primary-button"
        type="button"
        disabled={!name.trim() || !defaultAddress.trim()}
        onClick={() =>
          onSave({
            name: name.trim(),
            phone: phone.trim(),
            defaultAddress: defaultAddress.trim(),
          })
        }
      >
        <Check size={17} /> Guardar cambios
      </button>
    </div>
  );
}

function RestaurantDetail({
  restaurant,
  dietaryPreferences,
  cartCount,
  onBack,
  onOpenCart,
  onOpenItem,
}: {
  restaurant: Restaurant;
  dietaryPreferences: DietaryPreferences | null;
  cartCount: number;
  onBack: () => void;
  onOpenCart: () => void;
  onOpenItem: (item: MenuItem) => void;
}) {
  const [category, setCategory] = useState("Todo");
  const categories = ["Todo", ...Array.from(new Set(restaurant.menu.map((item) => item.category)))];
  const menu = restaurant.menu.filter(
    (item) =>
      (category === "Todo" || item.category === category) &&
      (!dietaryPreferences?.hideIncompatible || itemMatchesDietary(item, dietaryPreferences)),
  );
  return (
    <div className="screen detail-screen">
      <div className="restaurant-cover">
        <img src={restaurant.cover} alt={restaurant.name} />
        <div className="detail-topbar">
          <IconButton icon={ArrowLeft} label="Volver" onClick={onBack} />
          <IconButton icon={ShoppingBag} label="Carrito" badge={cartCount} onClick={onOpenCart} />
        </div>
      </div>
      <section className="detail-summary">
        <span className="badge warm">{restaurant.badge}</span>
        <h2>{restaurant.name}</h2>
        <p>
          {restaurant.cuisine} · {restaurant.address}
        </p>
        <div className="summary-grid">
          <span>
            <Star size={14} /> {restaurant.rating}
          </span>
          <span>
            <Bike size={14} /> {restaurant.distanceKm} km
          </span>
          <span>
            <Clock3 size={14} /> {restaurant.etaMin} min
          </span>
        </div>
      </section>
      <CategoryRail categories={categories} category={category} setCategory={setCategory} />
      {dietaryPreferences?.hideIncompatible && (
        <div className="dietary-filter-banner">
          <Leaf size={16} />
          <span>Filtro alimentario activo · sólo productos con declaraciones compatibles.</span>
        </div>
      )}
      <div className="item-list">
        {menu.map((item) => (
          <FoodRow
            key={item.id}
            item={item}
            restaurant={restaurant}
            onClick={() => onOpenItem(item)}
          />
        ))}
        {!menu.length && (
          <EmptyState
            icon={Search}
            title="Sin coincidencias declaradas"
            text="Probá otra categoría o revisá tu filtro alimentario en Perfil."
          />
        )}
      </div>
    </div>
  );
}

function CartScreen({
  cart,
  onCartChange,
  totals,
  promotions,
  promotionCode,
  setPromotionCode,
  restaurant,
  checkoutOpen,
  setCheckoutOpen,
  onBack,
  onCreateOrder,
  addresses,
  paymentMethods,
  customerEmail,
  busy,
}: {
  cart: CartLine[];
  onCartChange: (cart: CartLine[]) => void;
  totals: {
    subtotal: number;
    deliveryFee: number;
    serviceFee: number;
    discount: number;
    total: number;
  };
  promotions: AppState["promotions"];
  promotionCode: string;
  setPromotionCode: (code: string) => void;
  restaurant: Restaurant | null;
  checkoutOpen: boolean;
  setCheckoutOpen: (open: boolean) => void;
  onBack: () => void;
  onCreateOrder: (
    checkout: FoodCheckoutSelection,
    providerPayment?: { cardToken: string; paymentMethodId: string; installments: number },
  ) => Promise<void>;
  addresses: UserAddress[];
  paymentMethods: AppState["paymentMethods"];
  customerEmail: string;
  busy: boolean;
}) {
  const [paymentMode, setPaymentMode] = useState<"wallet" | "mercadopago">("wallet"),
    [paymentConfiguration, setPaymentConfiguration] = useState<{
      provider: "mercadopago" | "disabled";
      publicKey: string | null;
      merchantReady: boolean;
    } | null>(null),
    [paymentConfigurationError, setPaymentConfigurationError] = useState("");
  const geocodedAddresses = addresses.filter(
    (entry) => !entry.id.startsWith("profile-") && entry.lat !== null && entry.lng !== null,
  );
  const walletMethod =
    paymentMethods.find((entry) => entry.type === "wallet" && entry.isDefault) ||
    paymentMethods.find((entry) => entry.type === "wallet");
  const [selectedAddressId, setSelectedAddressId] = useState(
    () => geocodedAddresses.find((entry) => entry.isDefault)?.id || geocodedAddresses[0]?.id || "",
  );
  const [checkoutQuote, setCheckoutQuote] = useState<FoodCheckoutQuote | null>(null),
    [quoteBusy, setQuoteBusy] = useState(false),
    [quoteError, setQuoteError] = useState(""),
    [quoteRevision, setQuoteRevision] = useState(0),
    [quoteClock, setQuoteClock] = useState(Date.now());
  const selectedAddress = geocodedAddresses.find((entry) => entry.id === selectedAddressId) || null;
  useEffect(() => {
    if (!checkoutOpen || !restaurant) {
      setPaymentMode("wallet");
      setPaymentConfiguration(null);
      return;
    }
    let active = true;
    setPaymentConfigurationError("");
    api
      .getPaymentClientConfiguration(restaurant.id)
      .then((configuration) => {
        if (active) setPaymentConfiguration(configuration);
      })
      .catch((error) => {
        if (active)
          setPaymentConfigurationError(
            error instanceof Error ? error.message : "No se pudo consultar Mercado Pago",
          );
      });
    return () => {
      active = false;
    };
  }, [checkoutOpen, restaurant]);
  useEffect(() => {
    setSelectedAddressId((current) =>
      geocodedAddresses.some((entry) => entry.id === current)
        ? current
        : geocodedAddresses.find((entry) => entry.isDefault)?.id || geocodedAddresses[0]?.id || "",
    );
  }, [addresses]);
  useEffect(() => {
    if (!checkoutQuote) return;
    setQuoteClock(Date.now());
    const timer = window.setInterval(() => setQuoteClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [checkoutQuote]);
  const mercadoPagoReady =
    paymentConfiguration?.provider === "mercadopago" &&
    paymentConfiguration.merchantReady &&
    Boolean(paymentConfiguration.publicKey);
  useEffect(() => {
    if (!checkoutOpen) {
      setCheckoutQuote(null);
      setQuoteError("");
      setQuoteBusy(false);
      return;
    }
    if (!restaurant || !selectedAddress) {
      setCheckoutQuote(null);
      setQuoteError("Agregá una dirección con ubicación verificada desde Cuenta para continuar.");
      setQuoteBusy(false);
      return;
    }
    if (paymentMode === "wallet" && !walletMethod) {
      setCheckoutQuote(null);
      setQuoteError("Tu cuenta no tiene una Wallet habilitada.");
      setQuoteBusy(false);
      return;
    }
    let active = true;
    setCheckoutQuote(null);
    setQuoteError("");
    setQuoteBusy(true);
    const timer = window.setTimeout(() => {
      api
        .quoteFoodCheckout({
          customerId: selectedAddress.userId,
          restaurantId: restaurant.id,
          branchId: restaurant.branches?.find((branch) => branch.isPrimary)?.id,
          deliveryAddressId: selectedAddress.id,
          paymentMethod:
            paymentMode === "wallet" ? walletMethod?.label || "Flash Wallet" : "Mercado Pago",
          paymentMethodId: paymentMode === "wallet" ? walletMethod?.id : undefined,
          promotionCode: promotionCode.trim().toUpperCase() || undefined,
          items: cart.map((line) => ({
            menuItemId: line.item.id,
            quantity: line.quantity,
            extras: line.extras,
            note: line.note,
          })),
        })
        .then((result) => {
          if (active) {
            setCheckoutQuote(result.quote);
            setQuoteClock(Date.now());
          }
        })
        .catch((error) => {
          if (active)
            setQuoteError(
              error instanceof Error ? error.message : "No se pudo actualizar el precio final",
            );
        })
        .finally(() => {
          if (active) setQuoteBusy(false);
        });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    cart,
    checkoutOpen,
    paymentMode,
    promotionCode,
    quoteRevision,
    restaurant,
    selectedAddress,
    walletMethod,
  ]);
  const quoteExpired = Boolean(
    checkoutQuote && new Date(checkoutQuote.expiresAt).getTime() <= quoteClock,
  );
  const checkoutSelection: FoodCheckoutSelection | null =
    checkoutQuote && selectedAddress
      ? {
          deliveryAddressId: selectedAddress.id,
          deliveryAddress: checkoutQuote.deliveryAddress,
          paymentMethod: checkoutQuote.paymentMethod,
          paymentMethodId: checkoutQuote.paymentMethodId || undefined,
          quoteToken: checkoutQuote.quoteToken,
        }
      : null;
  const displayedTotals = checkoutOpen && checkoutQuote ? checkoutQuote : totals;
  return (
    <div className="screen">
      <TopBar
        title={checkoutOpen ? "Checkout" : "Carrito"}
        onBack={onBack}
        actionIcon={TicketPercent}
      />
      {!cart.length ? (
        <EmptyState
          icon={ShoppingBag}
          title="Carrito vacio"
          text="Agrega un producto para generar un pedido real."
        />
      ) : (
        <>
          <div className="context-card">
            <Store size={17} />
            <div>
              <strong>{restaurant?.name}</strong>
              <span>
                {restaurant?.etaMin} min · envio {money.format(restaurant?.deliveryFee || 0)}
              </span>
            </div>
          </div>
          <div className="cart-items">
            {cart.map((line, index) => (
              <div className="cart-row" key={`${line.item.id}-${index}`}>
                <img src={line.item.image} alt={line.item.name} />
                <div>
                  <strong>{line.item.name}</strong>
                  <span>{line.extras.length ? `${line.extras.length} extras` : "Sin extras"}</span>
                  <small>{line.note || "Sin nota"}</small>
                </div>
                <Counter
                  value={line.quantity}
                  min={0}
                  onChange={(quantity) =>
                    onCartChange(
                      quantity <= 0
                        ? cart.filter((_, lineIndex) => lineIndex !== index)
                        : cart.map((entry, lineIndex) =>
                            lineIndex === index ? { ...entry, quantity } : entry,
                          ),
                    )
                  }
                />
              </div>
            ))}
          </div>
          {checkoutOpen && (
            <section className="checkout-card">
              <div className="checkout-section-heading">
                <div>
                  <span className="muted-label">Entrega</span>
                  <strong>Elegí dónde recibir</strong>
                </div>
                <MapPin size={18} />
              </div>
              <div
                className="checkout-address-list"
                role="radiogroup"
                aria-label="Dirección de entrega"
              >
                {geocodedAddresses.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="radio"
                    aria-checked={entry.id === selectedAddressId}
                    className={
                      entry.id === selectedAddressId
                        ? "checkout-address active"
                        : "checkout-address"
                    }
                    onClick={() => setSelectedAddressId(entry.id)}
                  >
                    <span className="saved-address-icon">
                      <MapPin size={16} />
                    </span>
                    <span>
                      <strong>{entry.label}</strong>
                      <small>{entry.address}</small>
                    </span>
                    {entry.id === selectedAddressId ? <Check size={17} /> : null}
                  </button>
                ))}
                {!geocodedAddresses.length && (
                  <div className="checkout-missing-state">
                    <TriangleAlert size={17} />
                    <span>
                      Necesitás una dirección guardada con coordenadas GPS. Cerrá el carrito y
                      agregala desde Cuenta.
                    </span>
                  </div>
                )}
              </div>
              <div className="checkout-section-heading">
                <div>
                  <span className="muted-label">Pago</span>
                  <strong>Elegí cómo pagar</strong>
                </div>
                <CreditCard size={18} />
              </div>
              <div className="payment-choice" role="radiogroup" aria-label="Método de pago">
                <button
                  type="button"
                  role="radio"
                  aria-checked={paymentMode === "wallet"}
                  className={paymentMode === "wallet" ? "active" : ""}
                  disabled={!walletMethod}
                  onClick={() => setPaymentMode("wallet")}
                >
                  <WalletCards size={18} />
                  <span>
                    <strong>{walletMethod?.label || "Flash Wallet"}</strong>
                    <small>
                      {walletMethod
                        ? `Saldo ${money.format(walletMethod.balance)}`
                        : "No disponible"}
                    </small>
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={paymentMode === "mercadopago"}
                  className={paymentMode === "mercadopago" ? "active" : ""}
                  disabled={!mercadoPagoReady}
                  onClick={() => setPaymentMode("mercadopago")}
                >
                  <CreditCard size={18} />
                  <span>
                    <strong>Tarjeta</strong>
                    <small>
                      {mercadoPagoReady
                        ? "Tokenización segura con Mercado Pago"
                        : paymentConfiguration
                          ? "No disponible para este comercio"
                          : "Consultando disponibilidad…"}
                    </small>
                  </span>
                </button>
              </div>
              {paymentConfigurationError && (
                <small className="payment-provider-error">{paymentConfigurationError}</small>
              )}
              {quoteBusy && (
                <div className="checkout-quote-status" role="status">
                  <RefreshCw size={16} />
                  Recalculando precio y disponibilidad…
                </div>
              )}
              {quoteError && (
                <div className="checkout-quote-error" role="alert">
                  <TriangleAlert size={16} />
                  <span>{quoteError}</span>
                  <button type="button" onClick={() => setQuoteRevision((value) => value + 1)}>
                    Reintentar
                  </button>
                </div>
              )}
              {checkoutQuote && !quoteBusy && (
                <div
                  className={quoteExpired ? "checkout-quote-proof expired" : "checkout-quote-proof"}
                >
                  <ShieldCheck size={17} />
                  <span>
                    <strong>
                      {quoteExpired ? "Cotización vencida" : "Precio verificado por Flash"}
                    </strong>
                    <small>
                      {checkoutQuote.distanceKm} km · llega en aproximadamente{" "}
                      {checkoutQuote.etaMin} min · {checkoutQuote.pricingVersion}
                    </small>
                  </span>
                  {quoteExpired ? (
                    <button type="button" onClick={() => setQuoteRevision((value) => value + 1)}>
                      Actualizar
                    </button>
                  ) : (
                    <small>
                      Vence{" "}
                      {new Date(checkoutQuote.expiresAt).toLocaleTimeString("es-AR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </small>
                  )}
                </div>
              )}
              {paymentMode === "mercadopago" &&
                mercadoPagoReady &&
                paymentConfiguration?.publicKey &&
                checkoutQuote &&
                !quoteExpired &&
                checkoutSelection && (
                  <MercadoPagoCardCheckout
                    publicKey={paymentConfiguration.publicKey}
                    amount={checkoutQuote.total}
                    email={customerEmail}
                    busy={busy || quoteBusy}
                    onSubmit={(providerPayment) =>
                      onCreateOrder(checkoutSelection, providerPayment)
                    }
                    onError={setPaymentConfigurationError}
                  />
                )}
              <label className="checkout-line">
                <TicketPercent size={18} />
                <div>
                  <strong>Código promocional</strong>
                  <input
                    aria-label="Código promocional"
                    list="food-promotions"
                    placeholder="Ej. FLASH40"
                    value={promotionCode}
                    onChange={(event) => setPromotionCode(event.target.value.toUpperCase())}
                  />
                  <datalist id="food-promotions">
                    {promotions
                      .filter((entry) => entry.service === "food" && entry.active && entry.code)
                      .map((entry) => (
                        <option key={entry.id} value={entry.code}>
                          {entry.title}
                        </option>
                      ))}
                  </datalist>
                </div>
              </label>
            </section>
          )}
          <SummaryBlock totals={displayedTotals} />
          {paymentMode === "wallet" && (
            <button
              className="primary-button sticky-action"
              type="button"
              onClick={() =>
                checkoutOpen && checkoutSelection
                  ? void onCreateOrder(checkoutSelection)
                  : setCheckoutOpen(true)
              }
              disabled={
                busy ||
                (checkoutOpen &&
                  (quoteBusy || !checkoutSelection || quoteExpired || Boolean(quoteError)))
              }
            >
              <ReceiptText size={17} />
              {checkoutOpen
                ? quoteBusy
                  ? "Verificando total…"
                  : quoteExpired
                    ? "Actualizá el precio"
                    : "Confirmar pedido"
                : "Ir a pagar"}
            </button>
          )}
          {paymentMode === "mercadopago" && !checkoutOpen && (
            <button
              className="primary-button sticky-action"
              type="button"
              onClick={() => setCheckoutOpen(true)}
            >
              <ReceiptText size={17} />
              Ir a pagar
            </button>
          )}
        </>
      )}
    </div>
  );
}

type ProviderPaymentInput = { cardToken: string; paymentMethodId: string; installments: number };
type CardBrickForm = {
  token: string;
  payment_method_id: string;
  installments: number;
  transaction_amount: number;
};
type CardBrickProps = {
  initialization: { amount: number; payer: { email: string } };
  customization: {
    paymentMethods: {
      maxInstallments: number;
      types: { included: Array<"credit_card" | "debit_card" | "prepaid_card"> };
    };
    visual: { style: { theme: string } };
  };
  locale: "es-AR";
  onSubmit: (form: CardBrickForm) => Promise<void>;
  onReady: () => void;
  onError: (error: unknown) => void;
};

function MercadoPagoCardCheckout({
  publicKey,
  amount,
  email,
  busy,
  onSubmit,
  onError,
}: {
  publicKey: string;
  amount: number;
  email: string;
  busy: boolean;
  onSubmit: (payment: ProviderPaymentInput) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [CardBrick, setCardBrick] = useState<ComponentType<CardBrickProps> | null>(null);
  useEffect(() => {
    let active = true;
    import("@mercadopago/sdk-react")
      .then((sdk) => {
        if (!active) return;
        sdk.initMercadoPago(publicKey, { locale: "es-AR" });
        setCardBrick(() => sdk.CardPayment as unknown as ComponentType<CardBrickProps>);
      })
      .catch(() => {
        if (active) onError("No se pudo cargar el formulario seguro de Mercado Pago");
      });
    return () => {
      active = false;
    };
  }, [onError, publicKey]);
  if (!CardBrick)
    return (
      <div className="payment-brick-loading">
        <RefreshCw size={16} />
        Cargando formulario seguro…
      </div>
    );
  return (
    <div className={busy ? "payment-brick busy" : "payment-brick"}>
      <CardBrick
        initialization={{ amount, payer: { email } }}
        customization={{
          paymentMethods: {
            maxInstallments: 12,
            types: { included: ["credit_card", "debit_card", "prepaid_card"] },
          },
          visual: { style: { theme: "default" } },
        }}
        locale="es-AR"
        onReady={() => onError("")}
        onError={() => onError("Mercado Pago no pudo preparar el formulario")}
        onSubmit={async (form) => {
          if (busy) throw new Error("El pago ya se está procesando");
          if (Math.abs(Number(form.transaction_amount) - amount) > 0.01)
            throw new Error("El total del formulario cambió; revisá el pedido");
          await onSubmit({
            cardToken: form.token,
            paymentMethodId: form.payment_method_id,
            installments: Number(form.installments) || 1,
          });
        }}
      />
    </div>
  );
}

function MerchantApp({
  state,
  restaurant,
  newDish,
  setNewDish,
  busy,
  runAction,
}: {
  state: AppState;
  restaurant: Restaurant;
  newDish: {
    name: string;
    description: string;
    category: string;
    price: number;
  };
  setNewDish: React.Dispatch<
    React.SetStateAction<{
      name: string;
      description: string;
      category: string;
      price: number;
    }>
  >;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const orders = state.orders.filter((order) => order.restaurantId === restaurant.id);
  const activeOrders = orders.filter((order) => !["delivered", "cancelled"].includes(order.status));
  const soldOutItems = restaurant.menu.filter((item) => !item.stock).length;
  const todayRevenue = orders.reduce((sum, order) => sum + order.total, 0);
  return (
    <div className="screen">
      <TopBar title="Comercio" actionIcon={Store} />
      <section className="merchant-hero">
        <img src={restaurant.cover} alt={restaurant.name} />
        <div>
          <span>{restaurant.open ? "Abierto" : "Pausado"}</span>
          <h2>{restaurant.name}</h2>
          <p>{restaurant.address}</p>
        </div>
      </section>
      <label className="toggle-row light">
        <span>
          <strong>Aceptar pedidos</strong>
          <small>{restaurant.open ? "Online" : "Pausado"}</small>
        </span>
        <input
          checked={restaurant.open}
          onChange={(event) =>
            runAction(
              () =>
                api.updateRestaurant(restaurant.id, {
                  open: event.target.checked,
                }),
              event.target.checked ? "Local abierto" : "Local pausado",
            )
          }
          type="checkbox"
          disabled={busy}
        />
      </label>
      <div className="merchant-command">
        <MetricCard label="Venta" value={todayRevenue} tone="orange" />
        <MetricCard label="Activos" value={activeOrders.length} tone="teal" />
        <MetricCard label="ETA" value={restaurant.etaMin} tone="green" />
        <MetricCard label="Sin stock" value={soldOutItems} tone="dark" />
      </div>
      <section className="prep-control">
        <div>
          <strong>Control de cocina</strong>
          <span>Ajusta ETA en vivo para proteger SLA y evitar cancelaciones.</span>
        </div>
        <div className="prep-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runAction(
                () =>
                  api.updateRestaurant(restaurant.id, {
                    etaMin: Math.max(5, restaurant.etaMin - 5),
                  }),
                "ETA reducida",
              )
            }
          >
            -5m
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runAction(
                () =>
                  api.updateRestaurant(restaurant.id, {
                    etaMin: restaurant.etaMin + 5,
                  }),
                "ETA ampliada",
              )
            }
          >
            +5m
          </button>
        </div>
      </section>
      <SectionTitle title="Cocina" action={`${orders.length} pedidos`} />
      <div className="activity-stack">
        {orders.map((order) => (
          <OrderOpsCard
            key={order.id}
            order={order}
            restaurant={restaurant}
            driver={state.drivers.find((entry) => entry.id === order.courierId)}
            onAdvance={() => runAction(() => api.advanceOrder(order.id), "Pedido avanzado")}
            busy={busy}
          />
        ))}
      </div>
      <SectionTitle title="Menu" action="Stock" />
      <div className="menu-admin">
        {restaurant.menu.map((item) => (
          <label className="stock-row" key={item.id}>
            <img src={item.image} alt={item.name} />
            <span>
              <strong>{item.name}</strong>
              <small>{money.format(item.price)}</small>
            </span>
            <input
              checked={item.stock}
              onChange={(event) =>
                runAction(
                  () => api.updateMenuStock(restaurant.id, item.id, event.target.checked),
                  "Stock actualizado",
                )
              }
              type="checkbox"
              disabled={busy}
            />
          </label>
        ))}
      </div>
      <section className="new-dish">
        <h2>Alta rapida</h2>
        <input
          value={newDish.name}
          onChange={(event) => setNewDish((current) => ({ ...current, name: event.target.value }))}
        />
        <input
          value={newDish.description}
          onChange={(event) =>
            setNewDish((current) => ({
              ...current,
              description: event.target.value,
            }))
          }
        />
        <div className="two-fields">
          <input
            value={newDish.category}
            onChange={(event) =>
              setNewDish((current) => ({
                ...current,
                category: event.target.value,
              }))
            }
          />
          <input
            value={newDish.price}
            onChange={(event) =>
              setNewDish((current) => ({
                ...current,
                price: Number(event.target.value),
              }))
            }
            type="number"
          />
        </div>
        <button
          className="primary-button"
          type="button"
          disabled={busy}
          onClick={() =>
            runAction(() => api.addMenuItem(restaurant.id, newDish), "Producto creado")
          }
        >
          <Plus size={17} /> Agregar plato
        </button>
      </section>
    </div>
  );
}

function DriverApp({
  state,
  driver,
  user,
  busy,
  runAction,
}: {
  state: AppState;
  driver: Driver;
  user: User | null;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const lastLocationSentAt = useRef(0);
  const [gpsStatus, setGpsStatus] = useState<"idle" | "locating" | "live" | "denied">("idle");
  const [offers, setOffers] = useState<DispatchOffer[]>([]);
  const [offerBusy, setOfferBusy] = useState<string | null>(null);
  const [offersLoading, setOffersLoading] = useState(false);
  const [clock, setClock] = useState(Date.now());
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
    const poll = window.setInterval(() => void loadOffers(), 5000),
      ticker = window.setInterval(() => setClock(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(ticker);
    };
  }, [loadOffers]);

  useEffect(() => {
    if (!driver.online) {
      setGpsStatus("idle");
      return;
    }
    if (!navigator.geolocation) {
      setGpsStatus("denied");
      return;
    }
    setGpsStatus("locating");
    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const now = Date.now();
        if (now - lastLocationSentAt.current < 12000) return;
        lastLocationSentAt.current = now;
        api
          .updateDriverLocation(driver.id, {
            lat: coords.latitude,
            lng: coords.longitude,
            label: "Ubicacion GPS",
          })
          .then(() => setGpsStatus("live"))
          .catch(() => setGpsStatus("denied"));
      },
      () => setGpsStatus("denied"),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [driver.id, driver.online]);

  const activeOrders = state.orders.filter(
    (order) => order.courierId === driver.id && !["delivered", "cancelled"].includes(order.status),
  );
  const activeRides = state.rides.filter(
    (ride) => ride.driverId === driver.id && !["completed", "cancelled"].includes(ride.status),
  );
  const hotZone = state.zones.find((zone) => zone.demandLevel === "high") || state.zones[0];
  const visibleOffers = offers.filter((offer) =>
    driver.activeService === "ride" ? offer.kind === "ride" : offer.kind === "delivery",
  );
  return (
    <div className="screen">
      <TopBar title="Driver" actionIcon={Bike} />
      <section className="driver-card">
        <div className="avatar large">{initials(driver.name)}</div>
        <div>
          <span>
            {driver.vehicle} · {driver.plate}
          </span>
          <h2>{driver.name}</h2>
          <p>
            {driver.location.label} · rating {driver.rating}
          </p>
          <small className={`driver-gps-status ${gpsStatus}`}>
            {gpsStatus === "live"
              ? "GPS activo"
              : gpsStatus === "locating"
                ? "Conectando GPS"
                : gpsStatus === "denied"
                  ? "GPS no disponible"
                  : "GPS pausado"}
          </small>
        </div>
      </section>
      <label className="toggle-row light">
        <span>
          <strong>Disponible</strong>
          <small>{driver.online ? "Recibiendo viajes y deliveries" : "Fuera de linea"}</small>
        </span>
        <input
          checked={driver.online}
          onChange={(event) =>
            runAction(
              () => api.updateDriver(driver.id, { online: event.target.checked }),
              event.target.checked ? "Driver online" : "Driver offline",
            )
          }
          type="checkbox"
          disabled={busy}
        />
      </label>
      <div className="service-toggle compact-toggle">
        {driver.serviceModes.map((mode) => (
          <button
            className={driver.activeService === mode ? "active" : ""}
            key={mode}
            type="button"
            onClick={() =>
              runAction(
                () => api.updateDriver(driver.id, { activeService: mode }),
                "Modo actualizado",
              )
            }
            disabled={busy}
          >
            {mode === "delivery" ? <ShoppingBag size={16} /> : <Car size={16} />}
            {mode === "delivery" ? "Delivery" : "Taxi"}
          </button>
        ))}
      </div>
      <section className="driver-mission">
        <div>
          <span>Demanda actual</span>
          <strong>{hotZone?.name || "Zona sin datos"}</strong>
          <small>
            {hotZone
              ? `${hotZone.activeOrders} pedidos y ${hotZone.activeRides} viajes activos`
              : "Sin zona disponible"}
          </small>
        </div>
        <b>{money.format(driver.earningsToday)}</b>
      </section>
      <div className="driver-ops-grid">
        <article>
          <LocateFixed size={16} />
          <strong>{visibleOffers.length}</strong>
          <span>Ofertas</span>
        </article>
        <article>
          <ShieldCheck size={16} />
          <strong>{driver.rating}</strong>
          <span>Rating</span>
        </article>
        <article>
          <WalletCards size={16} />
          <strong>{money.format(user?.wallet || 0)}</strong>
          <span>Saldo Flash</span>
        </article>
      </div>

      <SectionTitle title="Activos" action={money.format(driver.earningsToday)} />
      <div className="activity-stack">
        {activeOrders.map((order) => (
          <OrderOpsCard
            key={order.id}
            order={order}
            restaurant={state.restaurants.find((entry) => entry.id === order.restaurantId)}
            driver={driver}
            onAdvance={() => runAction(() => api.advanceOrder(order.id), "Delivery avanzado")}
            busy={busy}
          />
        ))}
        {activeRides.map((ride) => (
          <RideOpsCard
            key={ride.id}
            ride={ride}
            driver={driver}
            onAdvance={() => runAction(() => api.advanceRide(ride.id), "Viaje avanzado")}
            busy={busy}
          />
        ))}
      </div>

      <SectionTitle
        title="Ofertas privadas"
        action={offersLoading ? "Actualizando…" : `${visibleOffers.length}`}
      />
      <div className="activity-stack">
        {visibleOffers.map((offer) => (
          <OfferCard
            key={offer.id}
            icon={
              offer.kind === "ride"
                ? Car
                : offer.subtype === "shipment"
                  ? PackageCheck
                  : ShoppingBag
            }
            title={`${offer.pickup} → ${offer.destination}`}
            subtitle={`${offer.distanceKm} km · ${offer.durationMin} min${offer.scoreBreakdown ? ` · ${Math.round(offer.scoreBreakdown.acceptanceRate * 100)}% aceptación` : ""} · vence en ${Math.max(0, Math.ceil((new Date(offer.expiresAt).getTime() - clock) / 1000))}s`}
            amount={offer.fare}
            action="Aceptar"
            secondaryAction="Rechazar"
            onSecondaryAction={async () => {
              setOfferBusy(offer.id);
              await runAction(() => api.rejectDriverOffer(offer.id), "Oferta rechazada");
              await loadOffers();
              setOfferBusy(null);
            }}
            onAction={async () => {
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
            busy={busy || offerBusy === offer.id}
          />
        ))}
        {!offersLoading && !visibleOffers.length && (
          <p>
            {driver.online
              ? "No hay ofertas vigentes para este modo."
              : "Actívate para recibir ofertas."}
          </p>
        )}
      </div>
    </div>
  );
}

function OpsApp({
  state,
  busy,
  runAction,
}: {
  state: AppState;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const activeOrders = state.orders.filter(
    (order) => !["delivered", "cancelled"].includes(order.status),
  );
  const activeRides = state.rides.filter(
    (ride) => !["completed", "cancelled"].includes(ride.status),
  );
  return (
    <div className="screen">
      <TopBar title="Operaciones" actionIcon={LineChart} />
      <div className="ops-grid">
        <MetricCard label="Pedidos" value={state.metrics.activeOrders} tone="orange" />
        <MetricCard label="Viajes" value={state.metrics.activeRides} tone="teal" />
        <MetricCard label="Drivers" value={state.metrics.onlineDrivers} tone="green" />
        <MetricCard label="Tickets" value={state.metrics.openTickets} tone="dark" />
      </div>
      <OpsRiskBoard state={state} />
      <section className="control-map">
        {state.zones.slice(0, 3).map((zone, index) => (
          <div className={`zone zone-${["one", "two", "three"][index]}`} key={zone.id}>
            {zone.name} · {zone.activeOrders + zone.activeRides} activos
          </div>
        ))}
        <span className="pin pin-a" />
        <span className="pin pin-b" />
        <span className="pin pin-c" />
      </section>
      <SectionTitle title="Pedidos en vivo" />
      <div className="activity-stack">
        {activeOrders.map((order) => (
          <OrderOpsCard
            key={order.id}
            order={order}
            restaurant={state.restaurants.find((entry) => entry.id === order.restaurantId)}
            driver={state.drivers.find((entry) => entry.id === order.courierId)}
            onAdvance={() => runAction(() => api.advanceOrder(order.id), "Pedido avanzado")}
            busy={busy}
          />
        ))}
      </div>
      <SectionTitle title="Viajes en vivo" />
      <div className="activity-stack">
        {activeRides.map((ride) => (
          <RideOpsCard
            key={ride.id}
            ride={ride}
            driver={state.drivers.find((entry) => entry.id === ride.driverId)}
            onAdvance={() => runAction(() => api.advanceRide(ride.id), "Viaje avanzado")}
            busy={busy}
          />
        ))}
      </div>
    </div>
  );
}

function OpsRiskBoard({ state }: { state: AppState }) {
  const unassignedOrders = state.orders.filter(
    (order) => !order.courierId && !["delivered", "cancelled"].includes(order.status),
  ).length;
  const unassignedRides = state.rides.filter(
    (ride) => !ride.driverId && !["completed", "cancelled"].includes(ride.status),
  ).length;
  const risks = [
    ["Backlog", unassignedOrders + unassignedRides, "Asignaciones pendientes"],
    ["Supply", state.metrics.onlineDrivers, "Drivers online"],
    ["SLA", state.metrics.avgOrderEta + state.metrics.avgRideEta, "Minutos combinados"],
  ] as const;
  return (
    <section className="ops-risk-board">
      {risks.map(([label, value, detail]) => (
        <article key={label}>
          <strong>{label}</strong>
          <span>{value}</span>
          <small>{detail}</small>
        </article>
      ))}
    </section>
  );
}

function OpsRail({
  mode,
  state,
  user,
  cartCount,
  cartTotal,
  busy,
  runAction,
}: {
  mode: Mode;
  state: AppState;
  user: User | null;
  cartCount: number;
  cartTotal: number;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const driver = state.drivers.find((entry) => entry.userId === user?.id);
  const merchantRestaurantId = user?.restaurantId || state.restaurants[0]?.id;
  const activeOrder = state.orders.find(
    (order) => !["delivered", "cancelled"].includes(order.status),
  );
  const activeRide = state.rides.find((ride) => !["completed", "cancelled"].includes(ride.status));
  return (
    <aside className="ops-panel">
      <PanelHeader
        title={
          mode === "customer"
            ? "Cliente"
            : mode === "merchant"
              ? "Comercio"
              : mode === "driver"
                ? "Driver"
                : "Ops"
        }
        icon={
          mode === "customer"
            ? UserRound
            : mode === "merchant"
              ? Store
              : mode === "driver"
                ? Bike
                : ShieldCheck
        }
      />
      {mode === "customer" && (
        <>
          <div className="ops-card highlight">
            <span>Carrito actual</span>
            <strong>{cartCount} items</strong>
            <p>{cartCount ? money.format(cartTotal) : "Listo para pedir comida o taxi"}</p>
          </div>
          {activeOrder && <MiniOrder state={state} order={activeOrder} />}
          {activeRide && <MiniRide state={state} ride={activeRide} />}
        </>
      )}
      {mode === "merchant" && (
        <>
          <div className="ops-card">
            <span>Cuenta</span>
            <strong>{user?.name}</strong>
            <p>
              {state.orders.filter((order) => order.restaurantId === merchantRestaurantId).length}{" "}
              pedidos historicos
            </p>
          </div>
          {state.orders
            .filter((order) => order.restaurantId === merchantRestaurantId)
            .slice(0, 3)
            .map((order) => (
              <MiniOrder key={order.id} state={state} order={order} />
            ))}
        </>
      )}
      {mode === "driver" && driver && (
        <>
          <div className="ops-card highlight">
            <span>Ganancia hoy</span>
            <strong>{money.format(driver.earningsToday)}</strong>
            <p>
              {driver.online ? "Online" : "Fuera de linea"} · {driver.vehicle}
            </p>
          </div>
          <button
            className="rail-action"
            type="button"
            disabled={busy}
            onClick={() =>
              runAction(
                () => api.updateDriver(driver.id, { online: !driver.online }),
                "Disponibilidad actualizada",
              )
            }
          >
            <LocateFixed size={16} /> {driver.online ? "Pausar" : "Activar"}
          </button>
        </>
      )}
      {mode === "ops" && (
        <>
          <div className="capacity-grid">
            <Metric
              label="Facturado"
              value={money.format(state.metrics.completedRevenue)}
              trend="completado"
            />
            <Metric label="Tickets" value={String(state.metrics.openTickets)} trend="soporte" />
          </div>
          {state.supportTickets.map((ticket) => (
            <article className="ops-card" key={ticket.id}>
              <span>
                {ticket.priority} ·{" "}
                {ticket.slaStatus === "on_track" ? "en SLA" : ticket.slaStatus.replaceAll("_", " ")}
              </span>
              <strong>{ticket.title}</strong>
              <p>
                {ticket.service} · {ticket.status}
              </p>
            </article>
          ))}
        </>
      )}
    </aside>
  );
}

function PanelHeader({ title, icon: Icon }: { title: string; icon: LucideIcon }) {
  return (
    <header className="panel-header">
      <span>
        <Icon size={18} />
      </span>
      <div>
        <p className="eyebrow">Panel</p>
        <h2>{title}</h2>
      </div>
    </header>
  );
}

function SearchBar({ query, setQuery }: { query: string; setQuery: (query: string) => void }) {
  return (
    <div className="search-bar">
      <Search size={17} />
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Que queres pedir hoy?"
      />
      <button
        type="button"
        aria-label="Limpiar busqueda"
        title="Limpiar busqueda"
        onClick={() => setQuery("")}
      >
        {query ? <X size={17} /> : <SlidersHorizontal size={17} />}
      </button>
    </div>
  );
}

function CategoryRail({
  categories,
  category,
  setCategory,
}: {
  categories: string[];
  category: string;
  setCategory: (category: string) => void;
}) {
  return (
    <div className="category-rail">
      {categories.map((entry) => (
        <button
          className={category === entry ? "category-pill active" : "category-pill"}
          key={entry}
          onClick={() => setCategory(entry)}
          type="button"
        >
          {entry}
        </button>
      ))}
    </div>
  );
}

function RestaurantCard({
  restaurant,
  onClick,
  favorite,
  onToggleFavorite,
}: {
  restaurant: Restaurant;
  onClick: () => void;
  favorite: boolean;
  onToggleFavorite: () => void;
}) {
  return (
    <button className="restaurant-card" type="button" onClick={onClick}>
      <img src={restaurant.image} alt={restaurant.name} />
      <span className={restaurant.open ? "badge" : "badge closed"}>
        {restaurant.open ? restaurant.badge : "Cerrado"}
      </span>
      <div className="restaurant-card-body">
        <div>
          <strong>{restaurant.name}</strong>
          <span>{restaurant.cuisine}</span>
        </div>
        <Heart
          size={18}
          fill={favorite ? "currentColor" : "none"}
          role="button"
          aria-label={favorite ? "Quitar de favoritos" : "Agregar a favoritos"}
          tabIndex={0}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              onToggleFavorite();
            }
          }}
        />
      </div>
      <div className="restaurant-meta">
        <span>
          <Star size={13} /> {restaurant.rating}
        </span>
        <span>{restaurant.etaMin} min</span>
        <span>{money.format(restaurant.deliveryFee)}</span>
      </div>
    </button>
  );
}

function FoodRow({
  item,
  restaurant,
  onClick,
}: {
  item: MenuItem;
  restaurant: Restaurant;
  onClick: () => void;
}) {
  return (
    <button
      className={item.stock ? "food-row" : "food-row disabled"}
      type="button"
      onClick={onClick}
      disabled={!item.stock}
    >
      <img src={item.image} alt={item.name} />
      <div className="food-row-main">
        <strong>{item.name}</strong>
        <span>{restaurant.name}</span>
        <div className="food-row-meta">
          <span>
            <Star size={12} /> {item.rating}
          </span>
          <span>
            <Clock3 size={12} /> {item.timeMin} min
          </span>
        </div>
      </div>
      <div className="price-block">
        <strong>{money.format(item.price)}</strong>
        <Plus size={16} />
      </div>
    </button>
  );
}

function ItemSheet({
  restaurant,
  item,
  quantity,
  setQuantity,
  extras,
  setExtras,
  note,
  setNote,
  onAdd,
  onClose,
}: {
  restaurant: Restaurant;
  item: MenuItem;
  quantity: number;
  setQuantity: (quantity: number) => void;
  extras: string[];
  setExtras: (extras: string[]) => void;
  note: string;
  setNote: (note: string) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const extrasTotal = extras.reduce((sum, extraId) => {
    const extra = restaurant.extras.find((entry) => entry.id === extraId);
    return sum + (extra?.price || 0);
  }, 0);
  return (
    <div className="sheet-backdrop">
      <section className="item-sheet">
        <button
          className="sheet-close"
          onClick={onClose}
          type="button"
          aria-label="Cerrar"
          title="Cerrar"
        >
          <X size={16} />
        </button>
        <div className="sheet-hero">
          <img src={item.image} alt={item.name} />
          <div>
            <span>{restaurant.name}</span>
            <h2>{item.name}</h2>
            <p>{item.description}</p>
          </div>
        </div>
        <div className="sheet-stats">
          <span>
            <Star size={13} /> {item.rating}
          </span>
          <span>{item.kcal} kcal</span>
          <span>{item.timeMin} min</span>
        </div>
        <div className="extras-list">
          <strong>Extras</strong>
          {restaurant.extras.map((extra) => {
            const checked = extras.includes(extra.id);
            return (
              <label className="extra-row" key={extra.id}>
                <span>
                  <input
                    checked={checked}
                    onChange={() =>
                      setExtras(
                        checked
                          ? extras.filter((entry) => entry !== extra.id)
                          : [...extras, extra.id],
                      )
                    }
                    type="checkbox"
                  />
                  {extra.name}
                </span>
                <small>{money.format(extra.price)}</small>
              </label>
            );
          })}
        </div>
        <textarea
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Nota para el local"
        />
        <div className="sheet-actions">
          <Counter value={quantity} min={1} onChange={setQuantity} />
          <button className="primary-button" type="button" onClick={onAdd}>
            <ShoppingBag size={17} /> Agregar {money.format((item.price + extrasTotal) * quantity)}
          </button>
        </div>
      </section>
    </div>
  );
}

function Counter({
  value,
  onChange,
  min = 0,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
}) {
  return (
    <div className="counter">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        aria-label="Restar"
        title="Restar"
      >
        <Minus size={14} />
      </button>
      <strong>{value}</strong>
      <button type="button" onClick={() => onChange(value + 1)} aria-label="Sumar" title="Sumar">
        <Plus size={14} />
      </button>
    </div>
  );
}

function SummaryBlock({
  totals,
}: {
  totals: {
    subtotal: number;
    deliveryFee: number;
    serviceFee: number;
    discount?: number;
    total: number;
  };
}) {
  return (
    <section className="summary-block">
      <div>
        <span>Subtotal</span>
        <strong>{money.format(totals.subtotal)}</strong>
      </div>
      <div>
        <span>Envio</span>
        <strong>{money.format(totals.deliveryFee)}</strong>
      </div>
      <div>
        <span>Servicio</span>
        <strong>{money.format(totals.serviceFee)}</strong>
      </div>
      {!!totals.discount && (
        <div>
          <span>Promoción</span>
          <strong>-{money.format(totals.discount)}</strong>
        </div>
      )}
      <div className="total-line">
        <span>Total</span>
        <strong>{money.format(totals.total)}</strong>
      </div>
    </section>
  );
}

function OrderOpsCard({
  order,
  restaurant,
  driver,
  onAdvance,
  canAdvance,
  onDetails,
  busy,
}: {
  order: Order;
  restaurant?: Restaurant;
  driver?: Driver;
  onAdvance: () => void;
  canAdvance?: boolean;
  onDetails?: () => void;
  busy: boolean;
}) {
  const showAdvance =
    canAdvance ?? !["ready_for_pickup", "delivered", "cancelled"].includes(order.status);
  return (
    <article className="work-card">
      <div className="work-card-top">
        <span>{order.id}</span>
        <strong>{orderStatusLabel[order.status]}</strong>
      </div>
      <h3>{restaurant?.name || "Restaurante"}</h3>
      <p>{order.items.map((item) => `${item.quantity} ${item.name}`).join(", ")}</p>
      <div className="work-meta">
        <span>{money.format(order.total)}</span>
        <span>{driver?.name || "Sin repartidor"}</span>
      </div>
      {(onDetails || showAdvance) && (
        <div className="work-card-actions">
          {onDetails && (
            <button className="secondary" type="button" onClick={onDetails}>
              <ReceiptText size={15} /> Ver comanda
            </button>
          )}
          {showAdvance && (
            <button type="button" onClick={onAdvance} disabled={busy}>
              <PackageCheck size={15} /> Avanzar
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function RideOpsCard({
  ride,
  driver,
  onAdvance,
  busy,
}: {
  ride: Ride;
  driver?: Driver;
  onAdvance: () => void;
  busy: boolean;
}) {
  const canAdvance = !["requested", "completed", "cancelled"].includes(ride.status);
  return (
    <article className="work-card">
      <div className="work-card-top">
        <span>{ride.id}</span>
        <strong>{rideStatusLabel[ride.status]}</strong>
      </div>
      <h3>{ride.pickup}</h3>
      <p>{ride.destination}</p>
      <div className="work-meta">
        <span>{money.format(ride.fare)}</span>
        <span>{driver?.name || "Sin conductor"}</span>
      </div>
      {canAdvance && (
        <button type="button" onClick={onAdvance} disabled={busy}>
          <Car size={15} /> Avanzar
        </button>
      )}
    </article>
  );
}

function OfferCard({
  icon: Icon,
  title,
  subtitle,
  amount,
  action,
  secondaryAction,
  onAction,
  onSecondaryAction,
  busy,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  amount: number;
  action: string;
  secondaryAction?: string;
  onAction: () => void;
  onSecondaryAction?: () => void;
  busy: boolean;
}) {
  return (
    <article className="offer-card">
      <span className="offer-icon">
        <Icon size={18} />
      </span>
      <div>
        <strong>{title}</strong>
        <small>{subtitle}</small>
        <b>{money.format(amount)}</b>
      </div>
      <div className="offer-card-actions">
        {secondaryAction && (
          <button className="secondary" type="button" onClick={onSecondaryAction} disabled={busy}>
            {secondaryAction}
          </button>
        )}
        <button type="button" onClick={onAction} disabled={busy}>
          {action}
        </button>
      </div>
    </article>
  );
}

function StatusCard({
  icon: Icon,
  title,
  subtitle,
  amount,
  status,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  disabled,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  amount: number;
  status: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  disabled: boolean;
}) {
  return (
    <article className="status-card">
      <span className="status-icon">
        <Icon size={18} />
      </span>
      <div>
        <strong>{title}</strong>
        <span>{subtitle}</span>
        <small>
          {status} · {money.format(amount)}
        </small>
      </div>
      {(actionLabel || secondaryActionLabel) && (
        <div className="status-card-actions">
          {secondaryActionLabel && (
            <button
              className="secondary"
              type="button"
              onClick={onSecondaryAction}
              disabled={disabled}
            >
              {secondaryActionLabel}
            </button>
          )}
          {actionLabel && (
            <button type="button" onClick={onAction} disabled={disabled}>
              {actionLabel}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <article className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function MiniOrder({ state, order }: { state: AppState; order: Order }) {
  const restaurant = state.restaurants.find((entry) => entry.id === order.restaurantId);
  return (
    <article className="ops-card">
      <span>{order.id}</span>
      <strong>
        {restaurant?.name} · {orderStatusLabel[order.status]}
      </strong>
      <p>
        {money.format(order.total)} · {order.items.length} items
      </p>
    </article>
  );
}

function MiniRide({ state, ride }: { state: AppState; ride: Ride }) {
  const driver = state.drivers.find((entry) => entry.id === ride.driverId);
  return (
    <article className="ops-card">
      <span>{ride.id}</span>
      <strong>
        {rideStatusLabel[ride.status]} · {driver?.name || "Sin conductor"}
      </strong>
      <p>
        {money.format(ride.fare)} · {ride.distanceKm} km
      </p>
    </article>
  );
}

function SectionTitle({ title, action }: { title: string; action?: string }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {action && <span className="section-action">{action}</span>}
    </div>
  );
}

function BottomNav({
  tab,
  onTabChange,
}: {
  tab: CustomerTab;
  onTabChange: (tab: CustomerTab) => void;
}) {
  const tabs: Array<{ id: CustomerTab; label: string; icon: LucideIcon }> = [
    { id: "home", label: "Inicio", icon: Home },
    { id: "activity", label: "Actividad", icon: ListChecks },
    { id: "wallet", label: "Wallet", icon: WalletCards },
    { id: "profile", label: "Perfil", icon: UserRound },
  ];
  return (
    <nav className="bottom-nav">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          className={tab === id ? "nav-item active" : "nav-item"}
          key={id}
          onClick={() => onTabChange(id)}
          type="button"
        >
          <Icon size={18} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function TopBar({
  title,
  onBack,
  actionIcon,
}: {
  title: string;
  onBack?: () => void;
  actionIcon?: LucideIcon;
}) {
  const ActionIcon = actionIcon;
  return (
    <header className="topbar">
      {onBack ? (
        <IconButton icon={ArrowLeft} label="Volver" onClick={onBack} />
      ) : (
        <span className="topbar-spacer" />
      )}
      <h1>{title}</h1>
      {ActionIcon ? (
        <IconButton icon={ActionIcon} label={title} />
      ) : (
        <span className="topbar-spacer" />
      )}
    </header>
  );
}

function IconButton({
  icon: Icon,
  label,
  onClick,
  badge,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  badge?: number;
}) {
  return (
    <button
      className="icon-button"
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <Icon size={18} />
      {!!badge && <span className="mini-badge">{badge}</span>}
    </button>
  );
}

function EmptyState({
  icon: Icon,
  title,
  text,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <section className="empty-state">
      <Icon size={34} />
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
  );
}

function WebLogin({
  busy,
  error,
  mfaChallenge,
  onLogin,
  onMfa,
}: {
  busy: boolean;
  error: string | null;
  mfaChallenge: string;
  onLogin: (email: string, password: string) => Promise<void>;
  onMfa: (code: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  return (
    <main className="app loading-app">
      <form
        className="loader-card"
        onSubmit={(event) => {
          event.preventDefault();
          void (mfaChallenge ? onMfa(mfaCode) : onLogin(email, password));
        }}
      >
        <Flame size={34} />
        <strong>{mfaChallenge ? "Verificación administrativa" : "Ingresar a Flash"}</strong>
        <span>
          {mfaChallenge
            ? "Ingresá el código de tu autenticador o un código de recuperación."
            : "Usá tu cuenta real de cliente, comercio, conductor u operaciones."}
        </span>
        {!mfaChallenge && (
          <>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email"
              required
            />
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Contraseña"
              minLength={6}
              required
            />
          </>
        )}
        {mfaChallenge && (
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={mfaCode}
            onChange={(event) => setMfaCode(event.target.value)}
            placeholder="Código MFA"
            minLength={6}
            required
            autoFocus
          />
        )}
        {error && <small className="login-error">{error}</small>}
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? "Verificando…" : mfaChallenge ? "Verificar" : "Ingresar"}
        </button>
      </form>
    </main>
  );
}

export default App;
