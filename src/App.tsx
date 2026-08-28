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
import { CustomerApp, ItemSheet } from "./customer/CustomerSurface";
import { MerchantDesktopConsole } from "./merchant/MerchantConsole";
import { DriverApp, MerchantApp, OpsApp, OpsRail } from "./operations/OperationsSurface";
import { compactMinutes, initials, money } from "./format";
import { allergenOptions, dietOptions, itemMatchesDietary } from "./dietary";
import {
  orderStatusLabel,
  orderSteps,
  rideStatusLabel,
  rideSteps,
  shipmentStatusLabel,
  shipmentSteps,
} from "./labels";
import {
  AdminKpi,
  AdminSectionHeader,
  IconButton,
  Metric,
  OrderOpsCard,
  SectionTitle,
  TopBar,
} from "./ui/panels";
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
  FoodCheckoutSelection,
  GeoPoint,
  GroupOrder,
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
  ShipmentCreatePayload,
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

const NotificationCenter = lazy(() => import("./NotificationCenter"));
const RideHome = lazy(() => import("./RideHome"));
const FlashMap = lazy(() => import("./maps/FlashMap"));

function App() {
  const [state, setState] = useState<AppState | null>(null);
  // Flags evaluados por el servidor para esta sesión. `null` mientras no se
  // cargaron: la diferencia importa, porque «todavía no sé» no es «apagado».
  // Un flag desconocido deja la superficie visible; esconder producto por una
  // llamada que falló sería peor que mostrar de más.
  const [features, setFeatures] = useState<Record<
    string,
    { active: boolean; variant: Record<string, unknown> }
  > | null>(null);
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
  // Grupo que se está por confirmar (GTM-001). Se recuerda para poder atarlo al
  // pedido *después* de que el pedido exista: marcarlo antes dejaría grupos
  // «confirmados» apuntando a pedidos que nunca se crearon.
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);
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
      api
        .getFeatures()
        .then((datos) => setFeatures(datos.features))
        .catch(() => setFeatures(null));
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

  /**
   * Lleva un grupo cerrado al checkout de siempre.
   *
   * Se vuelcan sus ítems en el carrito y se abre el checkout normal, en vez de
   * tener un camino de confirmación propio: un segundo checkout serían dos
   * versiones de la cotización firmada, la propina, el horario y el riesgo.
   */
  const checkoutGroupOrder = async (group: GroupOrder) => {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      const checkout = await api.getGroupOrderCheckout(group.id);
      const restaurante = state.restaurants.find((entry) => entry.id === checkout.merchantPublicId);
      if (!restaurante) throw new Error("El restaurante del grupo ya no está disponible");
      const lineas: CartLine[] = checkout.items.map((entrada) => {
        const item = restaurante.menu.find((plato) => plato.id === entrada.menuItemId);
        if (!item) throw new Error("Un producto del grupo ya no está disponible");
        return {
          restaurantId: restaurante.id,
          item,
          quantity: entrada.quantity,
          extras: entrada.extras,
          note: entrada.note,
        };
      });
      // `saveCart` ya traduce las líneas al formato de la API: mapearlas acá
      // sería una segunda copia de esa conversión.
      await api.saveCart(restaurante.id, lineas);
      setCart(lineas);
      setPendingGroupId(group.id);
      setCartOpen(true);
      setCheckoutOpen(true);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo preparar el pedido grupal");
    } finally {
      setBusy(false);
    }
  };

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
      const { order } = await api.createOrder({
        customerId: activeUser.id,
        restaurantId: cartRestaurant.id,
        deliveryAddressId: checkout.deliveryAddressId,
        deliveryAddress: checkout.deliveryAddress,
        paymentMethod: checkout.paymentMethod,
        paymentMethodId: checkout.paymentMethodId,
        providerPayment,
        promotionCode: promotionCode.trim() || undefined,
        quoteToken: checkout.quoteToken,
        tipCents: checkout.tipCents,
        scheduledFor: checkout.scheduledFor ?? undefined,
        items: cart.map((line) => ({
          menuItemId: line.item.id,
          quantity: line.quantity,
          extras: line.extras,
          note: line.note,
        })),
      });
      const orderId = order.id;
      // El grupo se marca con el pedido ya creado. Si esto fallara, el pedido
      // igual existe y el grupo queda cerrado sin atar — que es el lado seguro
      // de fallar: se cobró una vez y hay un pedido real detrás.
      if (pendingGroupId) {
        await api.markGroupOrderPlaced(pendingGroupId, orderId);
        setPendingGroupId(null);
      }
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
                  features={features}
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
                  onCheckoutGroup={checkoutGroupOrder}
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
