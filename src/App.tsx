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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, subscribeToEvents } from "./api";
import type {
  AppState,
  AdminDashboard,
  CartLine,
  CustomerTab,
  DeliveryEvidence,
  Driver,
  DispatchOffer,
  DietaryPreferences,
  GeoPoint,
  MenuItem,
  MerchantFinance,
  Mode,
  Order,
  OrderStatus,
  PublicRideTracking,
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

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});
const dietOptions=[{code:"vegetarian",name:"Vegetariano"},{code:"vegan",name:"Vegano"},{code:"gluten_free",name:"Sin gluten"},{code:"halal",name:"Halal"},{code:"kosher",name:"Kosher"}];
const allergenOptions=[{code:"gluten",name:"Gluten"},{code:"milk",name:"Leche"},{code:"eggs",name:"Huevo"},{code:"peanuts",name:"Maní"},{code:"tree_nuts",name:"Frutos secos"},{code:"soy",name:"Soja"},{code:"fish",name:"Pescado"},{code:"shellfish",name:"Crustáceos"},{code:"sesame",name:"Sésamo"}];
const itemMatchesDietary=(item:MenuItem,preferences:DietaryPreferences)=>{const diets=new Set((item.dietaryLabels||[]).map(entry=>entry.code)),allergens=new Set((item.allergens||[]).map(entry=>entry.code));return preferences.dietaryLabels.every(entry=>diets.has(entry.code))&&!preferences.avoidedAllergens.some(entry=>allergens.has(entry.code));};

const orderStatusLabel: Record<OrderStatus, string> = {
  requested: "Validando pago",
  accepted: "Aceptado",
  preparing: "Preparando",
  ready_for_pickup: "Listo para retirar",
  courier_assigned: "Repartidor asignado",
  picked_up: "Retirado",
  delivering: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

const rideStatusLabel: Record<RideStatus, string> = {
  requested: "Buscando conductor",
  driver_assigned: "Conductor asignado",
  arriving: "Llegando",
  in_progress: "En viaje",
  completed: "Completado",
  cancelled: "Cancelado",
};

const shipmentStatusLabel: Record<Shipment["status"], string> = {
  requested: "Buscando repartidor",
  driver_assigned: "Repartidor asignado",
  arriving: "Retirando el paquete",
  picked_up: "Paquete retirado",
  delivering: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

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

const rideServices: Array<{
  id: Ride["service"];
  label: string;
  icon: LucideIcon;
}> = [
  { id: "economy", label: "Flash", icon: Car },
  { id: "comfort", label: "Comfort", icon: Sparkles },
  { id: "moto", label: "Moto", icon: Bike },
  { id: "xl", label: "XL", icon: Truck },
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

function PublicRideTrackingPage({ token }: { token: string }) {
  const [tracking, setTracking] = useState<PublicRideTracking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await api.getPublicRideTracking(token);
        if (!cancelled) {
          setTracking(response.tracking);
          setError(null);
        }
      } catch (requestError) {
        if (!cancelled)
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Este enlace no existe, venció o fue revocado.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 10000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [token]);

  const map = useMemo(
    () =>
      tracking
        ? buildWebTrackingMap(
            tracking.pickupLocation,
            tracking.destinationLocation,
            [],
            tracking.driver?.location || null,
          )
        : null,
    [tracking],
  );
  const currentIndex = tracking
    ? Math.max(rideSteps.indexOf(tracking.status), 0)
    : 0;

  return (
    <main className="public-tracking-page">
      <header className="public-tracking-header">
        <a className="public-tracking-brand" href="/" aria-label="Abrir Flash">
          <span className="brand-mark"><Flame size={20} /></span>
          <strong>Flash</strong>
        </a>
        <span className="public-tracking-secure"><ShieldCheck size={14} /> Seguimiento seguro</span>
      </header>
      {loading && !tracking ? (
        <section className="public-tracking-state" aria-live="polite">
          <RefreshCw size={22} className="spin" />
          <strong>Cargando seguimiento</strong>
          <span>Consultando el estado vigente del viaje.</span>
        </section>
      ) : error && !tracking ? (
        <section className="public-tracking-state error" role="alert">
          <TriangleAlert size={22} />
          <strong>Seguimiento no disponible</strong>
          <span>{error}</span>
        </section>
      ) : tracking && (
        <div className="public-tracking-content">
          <section className="public-tracking-intro">
            <span className="muted-label">Viaje Flash · {tracking.rideId}</span>
            <h1>{rideStatusLabel[tracking.status]}</h1>
            <p>{tracking.pickup} → {tracking.destination}</p>
          </section>
          {map && (
            <section className="public-tracking-map" aria-label="Mapa público del viaje">
              {map.tiles.map((tile) => (
                <img
                  key={tile.key}
                  className="order-map-tile"
                  src={tile.uri}
                  alt=""
                  aria-hidden="true"
                  style={{ left: `${tile.column * 33.333}%`, top: `${tile.row * 33.333}%` }}
                />
              ))}
              <span className="order-map-marker pickup" style={{ left: `${map.pickup.x / 3}%`, top: `${map.pickup.y / 3}%` }} title="Origen"><MapPin size={14} /></span>
              <span className="order-map-marker dropoff" style={{ left: `${map.dropoff.x / 3}%`, top: `${map.dropoff.y / 3}%` }} title="Destino"><Home size={14} /></span>
              {map.driver && <span className="order-map-marker driver ride-driver-marker" style={{ left: `${map.driver.x / 3}%`, top: `${map.driver.y / 3}%` }} title="Conductor"><Car size={14} /></span>}
              <div className="tracking-map-caption">
                <strong>{tracking.driver?.location ? "Ubicación del conductor actualizada" : "Conductor sin posición compartida"}</strong>
                <span>ETA publicada: {tracking.etaMin} min</span>
              </div>
              <small className="map-attribution">© OpenStreetMap contributors</small>
            </section>
          )}
          <section className="public-tracking-summary">
            <div>
              <span className="muted-label">Conductor</span>
              <strong>{tracking.driver?.firstName || "Asignando conductor"}</strong>
              <small>{tracking.driver ? `${tracking.driver.vehicle || "Vehículo Flash"} · ${tracking.driver.plate || "patente no disponible"}` : "Te avisaremos cuando haya asignación."}</small>
            </div>
            <div className="public-tracking-eta"><span>ETA</span><strong>{tracking.etaMin} min</strong></div>
          </section>
          <section className="public-tracking-progress">
            <div className="stepper tracking-stepper ride-tracking-stepper">
              {rideSteps.map((step, index) => (
                <div className={index <= currentIndex ? "step active" : "step"} key={step}>
                  <span>{index < currentIndex ? <Check size={12} /> : index + 1}</span>
                  <small>{rideStatusLabel[step]}</small>
                </div>
              ))}
            </div>
          </section>
          <p className="public-tracking-note">
            Este enlace vence el {new Date(tracking.expiresAt).toLocaleString("es-AR")}. No muestra teléfono, email ni información de pago.
          </p>
        </div>
      )}
    </main>
  );
}

function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [adminDashboard, setAdminDashboard] = useState<AdminDashboard | null>(
    null,
  );
  const [mode, setMode] = useState<Mode>("customer");
  const [sessionUserId, setSessionUserId] = useState("usr_customer");
  const [service, setService] = useState<Service>("food");
  const [tab, setTab] = useState<CustomerTab>("home");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todo");
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<
    string | null
  >(null);
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
  const [dietaryPreferences,setDietaryPreferences]=useState<DietaryPreferences|null>(null);
  const [rideForm, setRideForm] = useState<RideForm>({
    pickup: "Defensa 982, San Telmo",
    destination: "Aeroparque Jorge Newbery",
    service: "economy" as Ride["service"],
    pickupCoords: { lat: -34.6177, lng: -58.3621 },
    destinationCoords: { lat: -34.5596, lng: -58.4156 },
  });
  const [quote, setQuote] = useState<RideQuote | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "locating" | "ready" | "denied"
  >("idle");
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
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia("(min-width: 900px)").matches,
  );
  const [desktopPortal, setDesktopPortal] = useState<"admin" | "merchant">(
    "admin",
  );

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

  const refresh = useCallback(async () => {
    const response = await api.state();
    setState(response.state);
    if (isDesktop && desktopPortal === "admin") {
      try {
        const dashboardResponse = await api.adminDashboard();
        setAdminDashboard(dashboardResponse.dashboard);
      } catch (_requestError) {
        setAdminDashboard(null);
      }
    } else {
      setAdminDashboard(null);
    }
  }, [desktopPortal, isDesktop]);

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
    await refresh();
    if (user.roles.includes("customer")) {
      const [saved,dietary]=await Promise.all([api.cart(),api.getDietaryPreferences()]);
      setCart(saved.cart);setDietaryPreferences(dietary.preferences);
    }
  }, [refresh]);

  useEffect(() => {
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
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No se pudo iniciar sesión",
      );
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
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No se pudo verificar MFA",
      );
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
    setAdminDashboard(null);
    setAuthRequired(true);
    setDesktopPortal("admin");
  };

  useEffect(() => {
    const media = window.matchMedia("(min-width: 900px)");
    const onChange = () => setIsDesktop(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (loading) return;
    const stopRealtime = subscribeToEvents((event: RealtimeEvent) => {
      if (event.type !== "connected" && event.type !== "heartbeat") {
        refresh().catch(() => undefined);
      }
    }, setRealtimeStatus);
    return stopRealtime;
  }, [loading, refresh]);

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
        setToast(
          requestError instanceof Error
            ? requestError.message
            : "No se pudo completar",
        );
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

  const selectedRestaurant = useMemo(() => {
    if (!state || !selectedRestaurantId) return null;
    return (
      state.restaurants.find(
        (restaurant) => restaurant.id === selectedRestaurantId,
      ) || null
    );
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
        category === "Todo" ||
        restaurant.menu.some((item) => item.category === category);
      const queryMatch =
        !search ||
        restaurant.name.toLowerCase().includes(search) ||
        restaurant.cuisine.toLowerCase().includes(search) ||
        restaurant.menu.some((item) =>
          item.name.toLowerCase().includes(search),
        );
      const dietaryMatch=!dietaryPreferences?.hideIncompatible||restaurant.menu.some(item=>item.stock&&itemMatchesDietary(item,dietaryPreferences));
      return categoryMatch && queryMatch && dietaryMatch;
    });
  }, [category, dietaryPreferences, query, state]);

  const allItems = useMemo(() => {
    if (!state) return [];
    return state.restaurants.flatMap((restaurant) =>
      restaurant.menu.filter(item=>!dietaryPreferences?.hideIncompatible||itemMatchesDietary(item,dietaryPreferences)).map((item) => ({
        restaurant,
        item,
      })),
    );
  }, [dietaryPreferences, state]);

  const cartRestaurant = useMemo(() => {
    if (!state || !cart.length) return null;
    return (
      state.restaurants.find(
        (restaurant) => restaurant.id === cart[0].restaurantId,
      ) || null
    );
  }, [cart, state]);

  const cartTotals = useMemo(() => {
    const subtotal = cart.reduce((sum, line) => {
      const restaurant = state?.restaurants.find(
        (entry) => entry.id === line.restaurantId,
      );
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
          (subtotal * (promotion.discountPercent || promotion.value || 0)) /
            100,
        );
      else if (promotion.kind === "free_delivery") discount = deliveryFee;
      else if (promotion.kind === "fixed") discount = promotion.value || 0;
      if (promotion.maxDiscount)
        discount = Math.min(discount, promotion.maxDiscount);
    }
    return {
      subtotal,
      deliveryFee,
      serviceFee,
      discount,
      total: subtotal + deliveryFee + serviceFee - discount,
    };
  }, [cart, cartRestaurant, state, promotionCode]);

  const driver =
    state?.drivers.find((entry) => entry.userId === sessionUserId) || null;
  const merchantRestaurant =
    state?.restaurants.find(
      (restaurant) => restaurant.ownerId === sessionUserId,
    ) || null;

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
      restaurant.extras
        .slice(0, item.category === "Burger" ? 1 : 0)
        .map((extra) => extra.id),
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
      const sameRestaurant = cart.every(
        (line) => line.restaurantId === itemDraft.restaurant.id,
      );
      const base = sameRestaurant ? cart : [];
      const index = base.findIndex(
        (line) =>
          line.item.id === nextLine.item.id &&
          line.note === nextLine.note &&
          line.extras.slice().sort().join(",") ===
            nextLine.extras.slice().sort().join(","),
      );
      if (index < 0) return [...base, nextLine];
      return base.map((line, lineIndex) =>
        lineIndex === index
          ? { ...line, quantity: line.quantity + nextLine.quantity }
          : line,
      );
    })();
    setCart(nextCart);
    void api
      .saveCart(itemDraft.restaurant.id, nextCart)
      .catch((requestError) => setError(requestError.message));
    setItemDraft(null);
    setToast("Producto agregado al carrito");
  };

  const createOrder = async (providerPayment?:{cardToken:string;paymentMethodId:string;installments:number}) => {
    if (!activeUser || !cartRestaurant || !cart.length) return;
    const deliveryAddress = state?.addresses.find(
      (address) =>
        address.userId === activeUser.id &&
        address.isDefault &&
        !address.id.startsWith("profile-") &&
        address.lat !== null &&
        address.lng !== null,
    );
    setBusy(true);setError(null);
    try{
      await api.createOrder({
        customerId: activeUser.id,
        restaurantId: cartRestaurant.id,
        deliveryAddressId: deliveryAddress?.id,
        deliveryAddress:
          deliveryAddress?.address ||
          activeUser.defaultAddress ||
          "Dirección pendiente de confirmar",
        paymentMethod: providerPayment?"Mercado Pago":"Flash Wallet",
        providerPayment,
        promotionCode: promotionCode.trim() || undefined,
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
      await refresh();setToast("Pedido creado y enviado al comercio");window.setTimeout(()=>setToast(null),2600);
    }catch(requestError){const message=requestError instanceof Error?requestError.message:"No se pudo crear el pedido";setToast(message);throw requestError;}finally{setBusy(false);}
  };

  const quoteRide = () =>
    runAction(async () => {
      const response = await api.quoteRide(rideForm);
      setQuote(response.quote);
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
        setLocationMessage(
          `GPS listo: ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`,
        );
      },
      () => {
        setLocationStatus("denied");
        setLocationMessage(
          "No pudimos acceder al GPS. Puedes escribir el origen.",
        );
      },
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 10000 },
    );
  }, []);

  const requestRide = () => {
    if (!activeUser) return;
    runAction(async () => {
      if (!quote?.quoteToken)
        throw new Error("Cotizá nuevamente antes de pedir el viaje");
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
      setToast("Envío solicitado y enviado a dispatch");
      window.setTimeout(() => setToast(null), 2600);
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "No se pudo crear el envío";
      setToast(message);
      throw requestError;
    } finally {
      setBusy(false);
    }
  };

  const topUpWallet = (amount: number) =>
    runAction(() => api.topUpWallet(amount), "Saldo cargado en wallet sandbox");

  const updateProfile = (payload: {
    name: string;
    phone: string;
    defaultAddress: string;
  }) => runAction(() => api.updateProfile(payload), "Perfil actualizado");

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
      setToast(
        requestError instanceof Error
          ? requestError.message
          : "No se pudo completar",
      );
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
          <span>{error || "No se pudo cargar el estado"}</span>
          <button type="button" onClick={() => window.location.reload()}>
            <RefreshCw size={16} /> Reintentar
          </button>
        </div>
      </main>
    );
  }

  if (isDesktop) {
    const canAdmin = Boolean(activeUser?.roles.includes("admin"));
    const canMerchant = Boolean(
      activeUser?.roles.includes("merchant") && merchantRestaurant,
    );
    if (!canAdmin && !canMerchant)
      return <DesktopAccessGate user={activeUser} onLogout={logoutWeb} />;
    if (canMerchant && (!canAdmin || desktopPortal === "merchant")) {
      return (
        <MerchantDesktopConsole
          state={state}
          restaurant={merchantRestaurant!}
          newDish={newDish}
          setNewDish={setNewDish}
          busy={busy}
          realtimeStatus={realtimeStatus}
          runAction={runAction}
          onSwitchPortal={() => setDesktopPortal("admin")}
          canSwitchPortal={canAdmin}
          onLogout={logoutWeb}
        />
      );
    }
    return (
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
    );
  }

  return (
    <main className="app">
      <section className="workspace">
        <BrandPanel
          state={state}
          mode={mode}
          onModeChange={switchMode}
          user={activeUser}
        />
        <section className="phone-stage" aria-label="Aplicacion">
          <div className="phone">
            <PhoneStatus />
            <AppModeBar mode={mode} onModeChange={switchMode} />
            <div className="phone-content">
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
              {mode === "ops" && (
                <OpsApp state={state} busy={busy} runAction={runAction} />
              )}
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

function DesktopAccessGate({
  user,
  onLogout,
}: {
  user: User | null;
  onLogout: () => void;
}) {
  return (
    <main className="desktop-access-gate">
      <section>
        <span>
          <ShieldCheck size={28} />
        </span>
        <small>Flash · acceso por rol</small>
        <h1>Esta cuenta usa la app móvil</h1>
        <p>
          {user?.name || "Tu cuenta"}, el portal web está reservado para
          operaciones y negocios. Abre Flash en mobile para pedir comida, viajes
          y envíos.
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

function PhoneStatus() {
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
      <span>{navigator.onLine ? "Live" : "Offline"}</span>
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
    [timezone, setTimezone] = useState(
      branch.timezone || "America/Argentina/Buenos_Aires",
    ),
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
      current.map((hour) =>
        hour.weekday === weekday ? { ...hour, [field]: value } : hour,
      ),
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
          <div
            className={`branch-hour-row ${hour.enabled ? "" : "disabled"}`}
            key={hour.weekday}
          >
            <label>
              <input
                type="checkbox"
                checked={hour.enabled}
                onChange={(event) =>
                  change(hour.weekday, "enabled", event.target.checked)
                }
              />
              <b>{dayNames[hour.weekday]}</b>
            </label>
            <input
              type="time"
              disabled={!hour.enabled}
              value={hour.opensAt}
              onChange={(event) =>
                change(hour.weekday, "opensAt", event.target.value)
              }
            />
            <span>—</span>
            <input
              type="time"
              disabled={!hour.enabled}
              value={hour.closesAt}
              onChange={(event) =>
                change(hour.weekday, "closesAt", event.target.value)
              }
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
                  ...(exceptionOpen
                    ? { opensAt: "09:00", closesAt: "23:00" }
                    : {}),
                  reason: exceptionReason,
                }),
              exceptionOpen
                ? "Apertura excepcional guardada"
                : "Cierre excepcional guardado",
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
              {exception.isOpen
                ? `${exception.opensAt}–${exception.closesAt}`
                : "cerrada"}
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
  useEffect(
    () => setGroups(item.modifierGroups || []),
    [item.id, item.modifierGroups],
  );
  const updateGroup = (index: number, patch: Partial<Groups[number]>) =>
    setGroups((current) =>
      current.map((group, position) =>
        position === index ? { ...group, ...patch } : group,
      ),
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
                onChange={(event) =>
                  updateGroup(groupIndex, { name: event.target.value })
                }
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
                  onChange={(event) =>
                    updateGroup(groupIndex, { max: Number(event.target.value) })
                  }
                />
              </label>
              <button
                className="icon-button"
                title="Eliminar grupo"
                onClick={() =>
                  setGroups((current) =>
                    current.filter((_, index) => index !== groupIndex),
                  )
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
                          index === modifierIndex
                            ? { ...entry, name: event.target.value }
                            : entry,
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
                        modifiers: group.modifiers.filter(
                          (_, index) => index !== modifierIndex,
                        ),
                      })
                    }
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              className="text-button"
              onClick={() => addModifier(groupIndex)}
            >
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
  const [diets, setDiets] = useState(
      () => item.dietaryLabels?.map((entry) => entry.code) || [],
    ),
    [allergens, setAllergens] = useState<
      Record<string, "contains" | "may_contain">
    >(() =>
      Object.fromEntries(
        (item.allergens || []).map((entry) => [entry.code, entry.presence]),
      ),
    );
  useEffect(() => {
    setDiets(item.dietaryLabels?.map((entry) => entry.code) || []);
    setAllergens(
      Object.fromEntries(
        (item.allergens || []).map((entry) => [entry.code, entry.presence]),
      ),
    );
  }, [item.id, item.dietaryLabels, item.allergens]);
  return (
    <details className="modifier-editor dietary-editor">
      <summary>
        <ShieldCheck size={16} />
        <span>Dietas y alérgenos</span>
        <small>
          {diets.length + Object.keys(allergens).length} declaraciones
        </small>
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
                    else
                      next[option.code] = event.target.value as
                        "contains" | "may_contain";
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
                    allergens: Object.entries(allergens).map(
                      ([code, presence]) => ({ code, presence }),
                    ),
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

function MerchantDesktopConsole({
  state,
  restaurant,
  newDish,
  setNewDish,
  busy,
  realtimeStatus,
  runAction,
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
  onSwitchPortal: () => void;
  canSwitchPortal: boolean;
  onLogout: () => void;
}) {
  const [section, setSection] = useState<
    "kitchen" | "catalog" | "branches" | "analytics" | "finance"
  >("kitchen");
  const [finance, setFinance] = useState<MerchantFinance | null>(null);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutPassword, setPayoutPassword] = useState("");
  const [paymentConnection,setPaymentConnection]=useState<import("./types").MerchantPaymentConnection|null>(null);
  const [paymentProviderConfigured,setPaymentProviderConfigured]=useState(false);
  const [paymentConnectionPassword,setPaymentConnectionPassword]=useState("");
  const loadFinance = useCallback(async () => {
    setFinanceLoading(true);
    try {
      const [financeResult,connectionResult]=await Promise.all([api.getMerchantFinance(restaurant.id),api.getMerchantPaymentConnection(restaurant.id)]);
      setFinance(financeResult.finance);
      setPaymentConnection(connectionResult.connection);
      setPaymentProviderConfigured(connectionResult.configured);
    } finally {
      setFinanceLoading(false);
    }
  }, [restaurant.id]);
  useEffect(() => {
    if (section === "finance") void loadFinance();
  }, [section, loadFinance]);
  const orders = state.orders.filter(
    (order) => order.restaurantId === restaurant.id,
  );
  const activeOrders = orders.filter(
    (order) => !["delivered", "cancelled"].includes(order.status),
  );
  const deliveredOrders = orders.filter(
    (order) => order.status === "delivered",
  );
  const revenue = deliveredOrders.reduce((sum, order) => sum + order.total, 0);
  const averageTicket = deliveredOrders.length
    ? Math.round(revenue / deliveredOrders.length)
    : 0;
  const unavailable = restaurant.menu.filter((item) => !item.stock).length;
  return (
    <main className="merchant-desktop-shell">
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
            <b>{restaurant.etaMin} min ETA</b>
          </div>
        </header>
        <div className="admin-kpis">
          <AdminKpi
            label="Pedidos activos"
            value={activeOrders.length}
            detail="cola actual"
            tone="orange"
          />
          <AdminKpi
            label="Ventas entregadas"
            value={money.format(revenue)}
            detail={`${deliveredOrders.length} pedidos`}
            tone="green"
          />
          <AdminKpi
            label="Ticket promedio"
            value={money.format(averageTicket)}
            detail="pedidos completados"
            tone="blue"
          />
          <AdminKpi
            label="Sin stock"
            value={unavailable}
            detail={`${restaurant.menu.length} productos`}
            tone="dark"
          />
        </div>
        {section === "kitchen" && (
          <div className="merchant-kitchen-grid">
            <section className="admin-card">
              <AdminSectionHeader
                title="Comandas"
                action={`${activeOrders.length} activas`}
              />
              <div className="activity-stack">
                {activeOrders.map((order) => (
                  <OrderOpsCard
                    key={order.id}
                    order={order}
                    restaurant={restaurant}
                    driver={state.drivers.find(
                      (entry) => entry.id === order.courierId,
                    )}
                    onAdvance={() =>
                      runAction(
                        () => api.advanceOrder(order.id),
                        "Pedido avanzado",
                      )
                    }
                    busy={busy}
                  />
                ))}
                {!activeOrders.length && <p>No hay pedidos pendientes.</p>}
              </div>
            </section>
            <section className="admin-card">
              <AdminSectionHeader title="Capacidad" action="SLA" />
              <p>
                Ajusta el tiempo visible para nuevos clientes según la carga
                real de cocina.
              </p>
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
            </section>
          </div>
        )}
        {section === "catalog" && (
          <div className="merchant-catalog-grid">
            <section className="admin-card">
              <AdminSectionHeader
                title="Productos"
                action={`${restaurant.menu.length} items`}
              />
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
                            () =>
                              api.updateMenuStock(
                                restaurant.id,
                                item.id,
                                event.target.checked,
                              ),
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
                  runAction(
                    () => api.addMenuItem(restaurant.id, newDish),
                    "Producto creado",
                  )
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
              <section
                className="admin-card merchant-branch-card"
                key={branch.id}
              >
                <div className="branch-card-head">
                  <span
                    className={`branch-pin ${branch.open ? "live" : "paused"}`}
                  >
                    <MapPin size={20} />
                  </span>
                  <div>
                    <small>
                      {branch.isPrimary ? "Sucursal principal" : "Sucursal"}
                    </small>
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
                              status: event.target.checked
                                ? "active"
                                : "paused",
                            }),
                          event.target.checked
                            ? "Sucursal habilitada"
                            : "Sucursal pausada",
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
                          (item) =>
                            branch.inventory[item.id]?.available ?? item.stock,
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
                                api.updateBranchInventory(
                                  restaurant.id,
                                  branch.id,
                                  item.id,
                                  {
                                    available: event.target.checked,
                                    stockQuantity: event.target.checked
                                      ? null
                                      : 0,
                                  },
                                ),
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
              <AdminSectionHeader
                title="Embudo operativo"
                action="Datos persistidos"
              />
              <div className="admin-table">
                <article className="admin-row compact">
                  <strong>Pedidos recibidos</strong>
                  <b>{orders.length}</b>
                </article>
                <article className="admin-row compact">
                  <strong>Entregados</strong>
                  <b>{deliveredOrders.length}</b>
                </article>
                <article className="admin-row compact">
                  <strong>Cancelados</strong>
                  <b>
                    {
                      orders.filter((order) => order.status === "cancelled")
                        .length
                    }
                  </b>
                </article>
              </div>
            </section>
            <section className="admin-card">
              <AdminSectionHeader title="Salud del catalogo" action="En vivo" />
              <p>
                {restaurant.menu.length - unavailable} productos disponibles y{" "}
                {unavailable} pausados.
              </p>
              <p>ETA publicado: {restaurant.etaMin} minutos.</p>
              <p>Facturacion entregada: {money.format(revenue)}.</p>
            </section>
          </div>
        )}
        {section === "finance" && (
          <div className="merchant-finance-grid">
            <section className="admin-card merchant-payout-history">
              <AdminSectionHeader title="Cobros del marketplace" action={paymentConnection?.status==="connected"?(paymentConnection.liveMode?"Cuenta real":"Cuenta de prueba"):"Sin vincular"}/>
              {paymentConnection?.status==="connected"?<><p>Mercado Pago conectado · cuenta terminada en {paymentConnection.externalAccountId.slice(-4)}.</p><small>Conectado {new Date(paymentConnection.connectedAt).toLocaleString("es-AR")}. Flash renueva la autorización antes de vencer y nunca muestra tokens sin cifrar.</small><div className="merchant-payout-form"><input type="password" autoComplete="current-password" placeholder="Contraseña para desvincular" value={paymentConnectionPassword} onChange={event=>setPaymentConnectionPassword(event.target.value)}/><button className="secondary-button" disabled={busy||paymentConnectionPassword.length<4} onClick={()=>runAction(async()=>{const result=await api.disconnectMerchantPaymentConnection(restaurant.id,paymentConnectionPassword);setPaymentConnection(result.connection);setPaymentConnectionPassword("");},"Mercado Pago desvinculado y credenciales eliminadas")}>Desvincular de forma segura</button></div></>:<><p>{paymentConnection?.status==="revoked"?"La conexión anterior fue revocada y sus credenciales se eliminaron.":paymentConnection?.status==="reconnect_required"?"Mercado Pago requiere renovar el consentimiento. Reconectá la cuenta antes de que se interrumpan los cobros.":"Vinculá la cuenta seller para que Mercado Pago pueda dividir cobros entre el comercio y Flash."}</p><button className="primary-button" disabled={busy||!paymentProviderConfigured} onClick={()=>runAction(async()=>{const result=await api.beginMerchantPaymentConnection(restaurant.id);window.location.assign(result.authorizationUrl);},"Redirigiendo a Mercado Pago")}>{paymentProviderConfigured?(paymentConnection?.status==="reconnect_required"?"Reconectar Mercado Pago":"Conectar Mercado Pago"):"Integración pendiente de credenciales"}</button></>}
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
                    const amount=Number(payoutAmount);
                    await runAction(
                      async () => {
                        const authorization=await api.authorizeMerchantPayout(restaurant.id,amount,payoutPassword);
                        return api.requestMerchantPayout(restaurant.id,amount,authorization.authorizationToken);
                      },
                      "Retiro reservado",
                    );
                    setPayoutAmount("");
                    setPayoutPassword("");
                    await loadFinance();
                  }}
                >
                  Solicitar retiro
                </button>
              </div>
              <small>
                Confirmás comercio e importe con tu contraseña. La autorización
                vence en 5 minutos, funciona una sola vez y el retiro queda
                pendiente del proveedor bancario.
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
                      <span>
                        {new Date(entry.createdAt).toLocaleString("es-AR")}
                      </span>
                    </div>
                    <b>
                      {entry.direction === "credit" ? "+" : "-"}
                      {money.format(entry.amount)}
                    </b>
                    <small>{entry.kind}</small>
                  </article>
                ))}
                {!financeLoading && !finance?.movements.length && (
                  <p>Sin liquidaciones todavía.</p>
                )}
              </div>
            </section>
            <section className="admin-card merchant-payout-history">
              <AdminSectionHeader
                title="Retiros"
                action={`${finance?.payouts.length || 0}`}
              />
              <div className="admin-table">
                {finance?.payouts.map((entry) => (
                  <article className="admin-row compact" key={entry.id}>
                    <WalletCards size={17} />
                    <div>
                      <strong>{entry.id}</strong>
                      <span>
                        {new Date(entry.createdAt).toLocaleDateString("es-AR")}
                      </span>
                    </div>
                    <b>{money.format(entry.amount)}</b>
                    <small>{entry.status}</small>
                  </article>
                ))}
                {!financeLoading && !finance?.payouts.length && (
                  <p>No hay retiros solicitados.</p>
                )}
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}

function SuperAdminConsole({
  state,
  currentUserId,
  dashboard,
  busy,
  realtimeStatus,
  runAction,
  onSwitchPortal,
  onLogout,
}: {
  state: AppState;
  currentUserId: string;
  dashboard: AdminDashboard | null;
  busy: boolean;
  realtimeStatus: "connecting" | "live" | "reconnecting" | "offline";
  runAction: (action: () => Promise<unknown>, success: string) => void;
  onSwitchPortal: () => void;
  onLogout: () => void;
}) {
  const [section, setSection] = useState<
    | "overview"
    | "dispatch"
    | "merchants"
    | "drivers"
    | "shipments"
    | "claims"
    | "payments"
    | "pricing"
    | "messages"
    | "users"
    | "finance"
    | "investors"
    | "support"
    | "security"
    | "infra"
  >("overview");
  const activeOrders = state.orders.filter(
    (order) => !["delivered", "cancelled"].includes(order.status),
  );
  const activeRides = state.rides.filter(
    (ride) => !["completed", "cancelled"].includes(ride.status),
  );
  const grossVolume = [
    ...state.orders.map((order) => order.total),
    ...state.rides.map((ride) => ride.fare),
  ].reduce((sum, value) => sum + value, 0);
  const cancellationCount =
    state.orders.filter((order) => order.status === "cancelled").length +
    state.rides.filter((ride) => ride.status === "cancelled").length;
  const marketplace = dashboard?.marketplace;
  const investor = dashboard?.investor;
  const platformRevenue = marketplace?.estimatedPlatformRevenue ?? 0;
  const readinessScore = investor?.readinessScore ?? 0;
  const nav = [
    ["overview", "Resumen", LineChart],
    ["dispatch", "Dispatch", LocateFixed],
    ["merchants", "Comercios", Store],
    ["drivers", "Drivers", Bike],
    ["shipments", "Envíos", PackageCheck],
    ["claims", "Siniestros", ShieldCheck],
    ["payments", "Pagos", CreditCard],
    ["pricing", "Tarifas", SlidersHorizontal],
    ["messages", "Mensajes", MessageCircle],
    ["users", "Usuarios", UserRound],
    ["finance", "Finanzas", WalletCards],
    ["investors", "Inversion", BadgeDollarSign],
    ["support", "Soporte", MessageCircle],
    ["security", "Seguridad", KeyRound],
    ["infra", "Infra", ShieldCheck],
  ] as const;

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span>
            <Flame size={22} />
          </span>
          <div>
            <strong>Flash Command</strong>
            <small>Superadministrador</small>
          </div>
        </div>
        <nav className="admin-nav">
          <button type="button" onClick={onSwitchPortal}>
            <Store size={17} /> Portal de comercio
          </button>
          {nav.map(([id, label, Icon]) => (
            <button
              className={section === id ? "active" : ""}
              key={id}
              onClick={() => setSection(id)}
              type="button"
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
          <button type="button" onClick={onLogout}>
            <LogIn size={17} /> Cerrar sesión
          </button>
        </nav>
        <div className="admin-note">
          <strong>Superficie correcta</strong>
          <span>
            En escritorio solo se muestra gestion de plataforma. Cliente,
            comercio y driver quedan como app mobile/PWA.
          </span>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div>
            <span>Operaciones · PostgreSQL/PostGIS</span>
            <h1>Control de marketplace, movilidad y delivery</h1>
          </div>
          <div className="admin-actions">
            <RealtimeStatus status={realtimeStatus} />
            <button type="button" onClick={() => window.location.reload()}>
              <RefreshCw size={16} /> Refrescar
            </button>
          </div>
        </header>

        {section === "overview" && (
          <>
            <div className="admin-kpis">
              <AdminKpi
                label="Pedidos activos"
                value={state.metrics.activeOrders}
                detail={`${state.metrics.avgOrderEta}m ETA`}
                tone="orange"
              />
              <AdminKpi
                label="Viajes activos"
                value={state.metrics.activeRides}
                detail={`${state.metrics.avgRideEta}m pickup`}
                tone="teal"
              />
              <AdminKpi
                label="Drivers online"
                value={state.metrics.onlineDrivers}
                detail={`${state.drivers.length} registrados`}
                tone="green"
              />
              <AdminKpi
                label="GMV registrado"
                value={money.format(marketplace?.grossVolume ?? grossVolume)}
                detail={`Revenue posteado ${money.format(platformRevenue)}`}
                tone="dark"
              />
            </div>
            <section className="admin-card">
              <AdminSectionHeader
                title="Investor pulse"
                action={`${readinessScore}/100 readiness`}
              />
              <InvestorPulse
                dashboard={dashboard}
                grossVolume={grossVolume}
                platformRevenue={platformRevenue}
              />
            </section>
            <div className="admin-grid two">
              <section className="admin-card">
                <AdminSectionHeader
                  title="Salud del marketplace"
                  action={`${state.restaurants.length} comercios`}
                />
                <MarketplaceHealth
                  state={state}
                  dashboard={dashboard}
                  cancellationCount={cancellationCount}
                />
              </section>
              <section className="admin-card">
                <AdminSectionHeader title="Zonas calientes" action="Live" />
                <ZoneBoard state={state} />
              </section>
            </div>
            <section className="admin-card">
              <AdminSectionHeader
                title="Actividad en vivo"
                action={`${activeOrders.length + activeRides.length} activos`}
              />
              <AdminLiveGrid
                state={state}
                orders={activeOrders}
                rides={activeRides}
                busy={busy}
                runAction={runAction}
              />
            </section>
          </>
        )}

        {section === "dispatch" && (
          <section className="admin-card">
            <AdminSectionHeader
              title="Dispatch y asignaciones"
              action="Food + Taxi"
            />
            <AdminLiveGrid
              state={state}
              orders={activeOrders}
              rides={activeRides}
              busy={busy}
              runAction={runAction}
            />
          </section>
        )}

        {section === "merchants" && (
          <section className="admin-card">
            <AdminSectionHeader title="Comercios" action="Control operativo" />
            <div className="admin-table">
              {state.restaurants.map((restaurant) => (
                <article className="admin-row" key={restaurant.id}>
                  <img src={restaurant.image} alt={restaurant.name} />
                  <div>
                    <strong>{restaurant.name}</strong>
                    <span>
                      {restaurant.cuisine} · {restaurant.address}
                    </span>
                  </div>
                  <b>{restaurant.open ? "Abierto" : "Pausado"}</b>
                  <small>
                    {restaurant.etaMin}m · {restaurant.menu.length} items
                  </small>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      runAction(
                        () =>
                          api.updateRestaurant(restaurant.id, {
                            open: !restaurant.open,
                          }),
                        restaurant.open
                          ? "Comercio pausado"
                          : "Comercio abierto",
                      )
                    }
                  >
                    {restaurant.open ? "Pausar" : "Abrir"}
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}

        {section === "drivers" && (
          <section className="admin-card">
            <AdminSectionHeader
              title="Conductores y repartidores"
              action="Supply"
            />
            <div className="admin-table">
              {state.drivers.map((driver) => (
                <article className="admin-row" key={driver.id}>
                  <div className="avatar">{initials(driver.name)}</div>
                  <div>
                    <strong>{driver.name}</strong>
                    <span>
                      {driver.vehicle} · {driver.plate} ·{" "}
                      {driver.location.label}
                    </span>
                  </div>
                  <b>{driver.online ? "Online" : "Offline"}</b>
                  <small>
                    {driver.activeService} · {driver.rating}
                  </small>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      runAction(
                        () =>
                          api.updateDriver(driver.id, {
                            online: !driver.online,
                          }),
                        "Disponibilidad actualizada",
                      )
                    }
                  >
                    {driver.online ? "Pausar" : "Activar"}
                  </button>
                  <DriverCompliancePanel
                    driverId={driver.id}
                    busy={busy}
                    runAction={runAction}
                  />
                </article>
              ))}
            </div>
          </section>
        )}

        {section === "finance" && (
          <div className="admin-grid">
            <section className="admin-card">
              <AdminSectionHeader
                title="Finanzas y conciliacion"
                action="Ledger PostgreSQL"
              />
              <div className="admin-kpis finance">
                <AdminKpi
                  label="GMV total"
                  value={money.format(grossVolume)}
                  detail="Pedidos + viajes"
                  tone="orange"
                />
                <AdminKpi
                  label="Ingreso plataforma"
                  value={money.format(platformRevenue)}
                  detail={`${marketplace?.takeRatePercent ?? 0}% registrado`}
                  tone="green"
                />
                <AdminKpi
                  label="Wallet clientes"
                  value={money.format(
                    state.users.reduce((sum, user) => sum + user.wallet, 0),
                  )}
                  detail="Saldo total"
                  tone="teal"
                />
                <AdminKpi
                  label="Cancelaciones"
                  value={cancellationCount}
                  detail="Pedidos + viajes"
                  tone="dark"
                />
              </div>
              <div className="admin-table">
                {[...state.orders.slice(0, 4), ...state.rides.slice(0, 4)].map(
                  (entry) => (
                    <article className="admin-row compact" key={entry.id}>
                      <ReceiptText size={18} />
                      <div>
                        <strong>{entry.id}</strong>
                        <span>
                          {"restaurantId" in entry
                            ? "Pedido de comida"
                            : "Viaje/taxi"}
                        </span>
                      </div>
                      <b>
                        {money.format(
                          "total" in entry ? entry.total : entry.fare,
                        )}
                      </b>
                      <small>{entry.paymentMethod}</small>
                    </article>
                  ),
                )}
              </div>
            </section>
            <PayoutReviewPanel />
            <TipAdjustmentPanel
              tips={state.tips || []}
              currentUserId={currentUserId}
            />
          </div>
        )}

        {section === "investors" && (
          <div className="admin-grid">
            <section className="admin-card">
              <AdminSectionHeader
                title="Ronda seed readiness"
                action={`${readinessScore}/100`}
              />
              <InvestorPulse
                dashboard={dashboard}
                grossVolume={grossVolume}
                platformRevenue={platformRevenue}
              />
            </section>
            <div className="admin-grid two">
              <section className="admin-card">
                <AdminSectionHeader
                  title="Unit economics"
                  action="Modelo financiero"
                />
                <UnitEconomicsBoard dashboard={dashboard} />
              </section>
              <section className="admin-card">
                <AdminSectionHeader
                  title="Milestones para levantar capital"
                  action="18 meses"
                />
                <MilestoneBoard dashboard={dashboard} />
              </section>
            </div>
            <div className="admin-grid two">
              <section className="admin-card">
                <AdminSectionHeader
                  title="Funnel de crecimiento"
                  action="Seed metrics"
                />
                <GrowthFunnel state={state} dashboard={dashboard} />
              </section>
              <section className="admin-card">
                <AdminSectionHeader
                  title="Riesgos y mitigacion"
                  action={`${dashboard?.riskSignals.length ?? 0} senales`}
                />
                <RiskSignalBoard dashboard={dashboard} />
              </section>
            </div>
          </div>
        )}

        {section === "support" && (
          <SupportOperationsPanel
            tickets={state.supportTickets}
            currentUserId={currentUserId}
            busy={busy}
            runAction={runAction}
          />
        )}

        {section === "shipments" && (
          <ShipmentConfigurationPanel busy={busy} runAction={runAction} />
        )}

        {section === "claims" && <ShipmentClaimsPanel />}
        {section === "payments" && <PaymentReconciliationPanel />}

        {section === "pricing" && (
          <PricingGovernancePanel
            currentUserId={currentUserId}
            busy={busy}
            runAction={runAction}
          />
        )}

        {section === "messages" && <ServiceQuickReplyPanel busy={busy} />}

        {section === "users" && (
          <AdminUserModeration
            users={state.users}
            busy={busy}
            runAction={runAction}
          />
        )}

        {section === "security" && <AdminSecurityPanel />}

        {section === "infra" && (
          <div className="admin-grid">
            <section className="admin-card">
              <AdminSectionHeader
                title="Ruta de infraestructura"
                action="Escalable"
              />
              <div className="infra-list">
                <InfraItem
                  title="Apps nativas"
                  text="Migrar la experiencia mobile a Expo/React Native con EAS, manteniendo esta API como backend."
                />
                <InfraItem
                  title="API modular"
                  text="Separar auth, marketplace, dispatch, payments, notifications, support y admin en modulos o servicios."
                />
                <InfraItem
                  title="Datos"
                  text="PostgreSQL + PostGIS es el runtime primario; SQLite queda aislado como fallback de pruebas. Siguiente escala: réplicas, Redis administrado y object storage."
                />
                <InfraItem
                  title="Tiempo real"
                  text="WebSockets/SSE para tracking, ofertas a drivers, chats, eventos de cocina y consola admin."
                />
                <InfraItem
                  title="Operabilidad"
                  text="Contenedores, Kubernetes HPA, observabilidad, alertas, feature flags y auditoria de acciones."
                />
                <InfraItem
                  title="Seguridad"
                  text="RBAC real por rol, proteccion OWASP API Top 10, rate limits, secretos gestionados y trazabilidad."
                />
              </div>
            </section>
            <NotificationDeliveryPanel />
          </div>
        )}
      </section>
    </main>
  );
}

function DriverCompliancePanel({
  driverId,
  busy,
  runAction,
}: {
  driverId: string;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const [compliance, setCompliance] = useState<
    import("./types").DriverCompliance | null
  >(null);
  const [reason, setReason] = useState("");
  const [vehicles,setVehicles]=useState<import("./types").DriverVehicle[]>([]);
  const load = useCallback(
    () => Promise.all([api.getDriverCompliance(driverId),api.getDriverVehicles(driverId,true)])
      .then(([result,registry])=>{setCompliance(result.compliance);setVehicles(registry.vehicles);})
      .catch(()=>{setCompliance(null);setVehicles([]);}),
    [driverId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!compliance)
    return (
      <div className="driver-compliance-inline">
        <small>Legajo no disponible</small>
      </div>
    );
  const pending = compliance.documents.filter(
    (document) => document.status === "pending",
  );
  return (
    <div className="driver-compliance-inline">
      <div>
        <strong>Legajo {compliance.status.replaceAll("_", " ")}</strong>
        <small>
          {pending.length} pendientes ·{" "}
          {
            compliance.documents.filter(
              (document) => document.status === "approved",
            ).length
          }
          /{compliance.requiredTypes.length} aprobados
        </small>
      </div>
      {pending.map((document) => (
        <div className="driver-document-review" key={document.id}>
          <span>
            {document.type.replaceAll("_", " ")} ·{" "}
            {(document.sizeBytes / 1024).toFixed(0)} KB
          </span>
          <button
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                const result = await api.reviewDriverDocument(
                  document.id,
                  "approved",
                );
                await load();
                return result;
              }, "Documento aprobado")
            }
          >
            Aprobar
          </button>
          <button
            disabled={busy || reason.trim().length < 5}
            onClick={() =>
              runAction(async () => {
                const result = await api.reviewDriverDocument(
                  document.id,
                  "rejected",
                  reason.trim(),
                );
                setReason("");
                await load();
                return result;
              }, "Documento rechazado")
            }
          >
            Rechazar
          </button>
        </div>
      ))}
      {vehicles.filter(vehicle=>vehicle.status==="pending"&&!vehicle.retiredAt).map(vehicle=><div className="driver-document-review" key={vehicle.id}><span>{vehicle.kind} · {vehicle.model} · {vehicle.plate} · {vehicle.serviceModes.join(" + ")}</span><button disabled={busy} onClick={()=>runAction(async()=>{const result=await api.reviewDriverVehicle(vehicle.id,"approved");await load();return result;},"Vehículo aprobado")}>Aprobar vehículo</button><button disabled={busy||reason.trim().length<5} onClick={()=>runAction(async()=>{const result=await api.reviewDriverVehicle(vehicle.id,"rejected",reason.trim());setReason("");await load();return result;},"Vehículo rechazado")}>Rechazar</button></div>)}
      {(pending.length > 0 || vehicles.some(vehicle=>vehicle.status==="pending"&&!vehicle.retiredAt)) && (
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Motivo verificable para rechazo"
        />
      )}
    </div>
  );
}

const pricingFieldLabels: Record<string, string> = {
  baseFare: "Tarifa base",
  distancePerKm: "Por kilómetro",
  timePerMin: "Por minuto",
  serviceFee: "Cargo de servicio",
  tollThresholdKm: "Umbral de peaje (km)",
  tollAmount: "Peaje",
  roadFactor: "Factor vial",
  minDistanceKm: "Distancia mínima",
  maxDistanceKm: "Distancia máxima",
  durationBaseMin: "Duración base",
  durationPerKm: "Duración por km",
  etaBaseMin: "ETA base",
  etaPerKm: "ETA por km",
  baseDeliveryFee: "Envío base",
  minimumDeliveryFee: "Envío mínimo",
  maximumDeliveryFee: "Envío máximo",
  maximumDistanceKm: "Cobertura máxima",
  weightPerKg: "Por kilogramo",
  minimumEtaMin: "ETA mínimo",
  moto: "Moto",
  economy: "Economy",
  comfort: "Comfort",
  xl: "XL",
  small: "Pequeño",
  medium: "Mediano",
  large: "Grande",
};
function pricingNumbers(
  config: Record<string, unknown>,
  prefix = "",
): Array<{ path: string; label: string; value: number }> {
  return Object.entries(config).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "number")
      return [{ path, label: pricingFieldLabels[key] || key, value }];
    if (value && typeof value === "object" && !Array.isArray(value))
      return pricingNumbers(value as Record<string, unknown>, path);
    return [];
  });
}
function updatePricingNumber(
  config: Record<string, unknown>,
  path: string,
  value: number,
) {
  const copy = structuredClone(config),
    parts = path.split(".");
  let cursor: Record<string, unknown> = copy;
  for (const part of parts.slice(0, -1))
    cursor = cursor[part] as Record<string, unknown>;
  cursor[parts.at(-1)!] = value;
  return copy;
}
const localDateTime = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

function PricingGovernancePanel({
  currentUserId,
  busy,
  runAction,
}: {
  currentUserId: string;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const [plans, setPlans] = useState<PricingPlan[]>([]),
    [requests, setRequests] = useState<PricingChangeRequest[]>([]),
    [service, setService] = useState<PricingService>("shipment"),
    [config, setConfig] = useState<Record<string, unknown>>({}),
    [version, setVersion] = useState(""),
    [effectiveAt, setEffectiveAt] = useState(
      localDateTime(new Date(Date.now() + 15 * 60000)),
    ),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [planResult, changeResult] = await Promise.all([
        api.getPricingPlans(),
        api.getPricingChanges(),
      ]);
      setPlans(planResult.plans);
      setRequests(changeResult.requests);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudo cargar tarifas",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const activePlan = useMemo(
    () =>
      plans.find((plan) => plan.service === service && plan.active) ||
      plans.find((plan) => plan.service === service),
    [plans, service],
  );
  useEffect(() => {
    if (!activePlan) return;
    setConfig(structuredClone(activePlan.config));
    setVersion(
      `${service.toUpperCase()}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-V2`,
    );
  }, [activePlan, service]);
  const submit = () =>
    runAction(async () => {
      const result = await api.requestPricingChange(service, {
        version: version.trim().toUpperCase(),
        config,
        effectiveAt: new Date(effectiveAt).toISOString(),
      });
      await load();
      return result;
    }, "Cambio enviado a aprobación");
  const review = (
    entry: PricingChangeRequest,
    decision: "approved" | "rejected",
  ) =>
    runAction(
      async () => {
        const result = await api.reviewPricingChange(
          entry.id,
          decision,
          notes[entry.id]?.trim() || "",
        );
        await load();
        return result;
      },
      decision === "approved" ? "Cambio aprobado" : "Cambio rechazado",
    );
  return (
    <div className="admin-grid pricing-governance">
      <section className="admin-card">
        <AdminSectionHeader title="Proponer tarifa" action="Doble aprobación" />
        <p>
          Parte de la tarifa activa, ajusta valores y define vigencia. Nunca
          publica directamente.
        </p>
        {error && <p className="form-error">{error}</p>}
        <div className="pricing-service-tabs">
          {(["food", "ride", "shipment"] as PricingService[]).map((item) => (
            <button
              key={item}
              className={service === item ? "active" : ""}
              onClick={() => setService(item)}
            >
              {item === "food"
                ? "Comidas"
                : item === "ride"
                  ? "Viajes"
                  : "Envíos"}
            </button>
          ))}
        </div>
        {activePlan && (
          <small>
            Activa: {activePlan.version} · desde{" "}
            {new Date(activePlan.effectiveFrom).toLocaleString("es-AR")}
          </small>
        )}
        <div className="pricing-history">
          {plans
            .filter((plan) => plan.service === service && !plan.active)
            .slice(0, 4)
            .map((plan) => (
              <div key={plan.version}>
                <span>{plan.version}</span>
                <small>
                  {new Date(plan.effectiveFrom).toLocaleDateString("es-AR")}
                </small>
                <button
                  disabled={busy || !effectiveAt}
                  onClick={() =>
                    runAction(async () => {
                      const result = await api.requestPricingRollback(service, {
                        targetVersion: plan.version,
                        version: `${service.toUpperCase()}-ROLLBACK-${Date.now()}`,
                        effectiveAt: new Date(effectiveAt).toISOString(),
                      });
                      await load();
                      return result;
                    }, `Rollback de ${plan.version} enviado a revisión`)
                  }
                >
                  Proponer rollback
                </button>
              </div>
            ))}
        </div>
        <div className="pricing-fields">
          {pricingNumbers(config).map((field) => (
            <label key={field.path}>
              {field.label}
              <small>{field.path}</small>
              <input
                type="number"
                step="0.01"
                value={field.value}
                onChange={(event) =>
                  setConfig((current) =>
                    updatePricingNumber(
                      current,
                      field.path,
                      Number(event.target.value),
                    ),
                  )
                }
              />
            </label>
          ))}
        </div>
        <div className="pricing-submit">
          <label>
            Versión
            <input
              value={version}
              onChange={(event) => setVersion(event.target.value.toUpperCase())}
            />
          </label>
          <label>
            Vigencia
            <input
              type="datetime-local"
              value={effectiveAt}
              onChange={(event) => setEffectiveAt(event.target.value)}
            />
          </label>
          <button
            disabled={
              busy || !activePlan || version.trim().length < 6 || !effectiveAt
            }
            onClick={submit}
          >
            Enviar a revisión
          </button>
        </div>
      </section>
      <section className="admin-card">
        <AdminSectionHeader
          title="Cola de aprobación"
          action={`${requests.filter((entry) => entry.status === "pending").length} pendientes`}
        />
        <p>
          La persona solicitante no puede revisar su propio cambio. Riesgo alto
          exige fundamento reforzado.
        </p>
        <div className="pricing-request-list">
          {requests.length === 0 && (
            <div className="empty-state">No hay solicitudes tarifarias.</div>
          )}
          {requests.map((entry) => {
            const own = entry.requestedBy === currentUserId,
              pending = entry.status === "pending",
              minimumNote = entry.riskLevel === "high" ? 20 : 5;
            return (
              <article
                key={entry.id}
                className={`pricing-request ${entry.status} risk-${entry.riskLevel}`}
              >
                <div>
                  <span>
                    {entry.changeKind === "rollback"
                      ? "rollback"
                      : entry.service}
                  </span>
                  <strong>{entry.version}</strong>
                  <b>{entry.status}</b>
                </div>
                <div className={`pricing-risk ${entry.riskLevel}`}>
                  Riesgo {entry.riskLevel} · máximo{" "}
                  {entry.maximumChangePercent.toFixed(1)}%
                </div>
                {entry.sourceVersion && (
                  <small>Restaura configuración de {entry.sourceVersion}</small>
                )}
                <small>
                  Solicita {entry.requestedBy} · vigencia{" "}
                  {new Date(entry.effectiveAt).toLocaleString("es-AR")}
                </small>
                {entry.riskWarnings.length > 0 && (
                  <div className="pricing-warnings">
                    {entry.riskWarnings.slice(0, 3).map((warning) => (
                      <small key={warning.path}>
                        <strong>
                          {pricingFieldLabels[
                            warning.path.split(".").at(-1)!
                          ] || warning.path}
                        </strong>{" "}
                        {warning.previous} → {warning.next} (
                        {warning.direction === "increase" ? "+" : "-"}
                        {warning.changePercent.toFixed(1)}%)
                      </small>
                    ))}
                  </div>
                )}
                {entry.reviewedBy && (
                  <small>
                    Revisa {entry.reviewedBy} · {entry.reviewNote}
                  </small>
                )}
                {pending && (
                  <>
                    <textarea
                      placeholder={
                        own
                          ? "Debe revisar otro administrador"
                          : entry.riskLevel === "high"
                            ? "Fundamento reforzado: mínimo 20 caracteres"
                            : "Fundamento obligatorio de la decisión"
                      }
                      disabled={own || busy}
                      value={notes[entry.id] || ""}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [entry.id]: event.target.value,
                        }))
                      }
                    />
                    <div className="pricing-review-actions">
                      <button
                        disabled={
                          own ||
                          busy ||
                          (notes[entry.id]?.trim().length || 0) < minimumNote
                        }
                        onClick={() => review(entry, "rejected")}
                      >
                        Rechazar
                      </button>
                      <button
                        disabled={
                          own ||
                          busy ||
                          (notes[entry.id]?.trim().length || 0) < minimumNote
                        }
                        onClick={() => review(entry, "approved")}
                      >
                        Aprobar
                      </button>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function PayoutReviewPanel() {
  const [payouts, setPayouts] = useState<PayoutReview[]>([]),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setPayouts((await api.getAdminPayouts()).payouts);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudieron cargar los retiros",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const review = async (
    entry: PayoutReview,
    decision: "approved" | "rejected",
  ) => {
    try {
      setBusy(true);
      await api.reviewPayout(entry.id, decision, notes[entry.id]?.trim() || "");
      await load();
    } catch (reviewError) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : "No se pudo revisar el retiro",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="admin-card">
      <AdminSectionHeader
        title="Aprobación de retiros"
        action={`${payouts.filter((entry) => entry.status === "pending").length} pendientes`}
      />
      <p>
        El saldo se reserva al solicitar. Sólo una revisión independiente
        permite enviarlo al proveedor; rechazar libera la reserva al ledger
        comercial.
      </p>
      {error && <p className="form-error">{error}</p>}
      <div className="shipment-config-list">
        {payouts.map((entry) => (
          <article
            className={`shipment-config-card${entry.status === "cancelled" ? " inactive" : ""}`}
            key={entry.id}
          >
            <div>
              <span>
                {entry.merchantName} · {entry.id}
              </span>
              <strong>
                {money.format(entry.amount)} · {entry.status}
              </strong>
            </div>
            <small>
              Solicita {entry.requestedBy || "migrado"} ·{" "}
              {new Date(entry.createdAt).toLocaleString("es-AR")}
            </small>
            {entry.status === "pending" ? (
              <>
                <label className="wide">
                  Fundamento
                  <textarea
                    value={notes[entry.id] || ""}
                    onChange={(event) =>
                      setNotes((current) => ({
                        ...current,
                        [entry.id]: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className="pricing-review-actions">
                  <button
                    disabled={busy || (notes[entry.id]?.trim().length || 0) < 5}
                    onClick={() => void review(entry, "rejected")}
                  >
                    Rechazar y liberar saldo
                  </button>
                  <button
                    disabled={busy || (notes[entry.id]?.trim().length || 0) < 5}
                    onClick={() => void review(entry, "approved")}
                  >
                    Aprobar para procesamiento
                  </button>
                </div>
              </>
            ) : (
              <small>
                {entry.reviewDecision
                  ? `${entry.reviewDecision} por ${entry.reviewedBy} · ${entry.reviewNote}`
                  : "Esperando proveedor externo"}
              </small>
            )}
          </article>
        ))}
        {payouts.length === 0 && <p>No hay retiros solicitados.</p>}
      </div>
    </section>
  );
}

function TipAdjustmentPanel({
  tips,
  currentUserId,
}: {
  tips: ServiceTip[];
  currentUserId: string;
}) {
  const [adjustments, setAdjustments] = useState<TipAdjustment[]>([]),
    [tipId, setTipId] = useState(tips[0]?.id || ""),
    [amount, setAmount] = useState(""),
    [reason, setReason] = useState(""),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setAdjustments((await api.getTipAdjustments()).adjustments);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudieron cargar los ajustes",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const requestAdjustment = async () => {
    try {
      setBusy(true);
      await api.requestTipAdjustment(tipId, Number(amount), reason.trim());
      setAmount("");
      setReason("");
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No se pudo solicitar el ajuste",
      );
    } finally {
      setBusy(false);
    }
  };
  const review = async (
    entry: TipAdjustment,
    decision: "approved" | "rejected",
  ) => {
    try {
      setBusy(true);
      await api.reviewTipAdjustment(
        entry.id,
        decision,
        notes[entry.id]?.trim() || "",
      );
      await load();
    } catch (reviewError) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : "No se pudo revisar el ajuste",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="admin-card">
      <AdminSectionHeader
        title="Correcciones de propinas"
        action={`${adjustments.filter((entry) => entry.status === "pending").length} pendientes`}
      />
      <p>
        Una persona solicita la corrección y otra la aprueba. Al aprobar, el
        ledger revierte el importe del conductor al cliente sin alterar la
        propina histórica.
      </p>
      {error && <p className="form-error">{error}</p>}
      <div className="pricing-fields">
        <label>
          Propina
          <select
            value={tipId}
            onChange={(event) => setTipId(event.target.value)}
          >
            <option value="">Seleccionar</option>
            {tips.map((tip) => (
              <option key={tip.id} value={tip.id}>
                {tip.id} · {tip.jobId} · {money.format(tip.amount)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Importe
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label className="wide">
          Motivo
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Motivo operativo verificable"
          />
        </label>
        <button
          className="primary-button"
          disabled={
            busy || !tipId || Number(amount) <= 0 || reason.trim().length < 5
          }
          onClick={() => void requestAdjustment()}
        >
          Solicitar corrección
        </button>
      </div>
      <div className="shipment-config-list">
        {adjustments.map((entry) => {
          const own = entry.requestedBy === currentUserId;
          return (
            <article
              className={`shipment-config-card${entry.status !== "pending" ? " inactive" : ""}`}
              key={entry.id}
            >
              <div>
                <span>
                  {entry.tipId} · servicio {entry.jobId}
                </span>
                <strong>
                  {money.format(entry.amount)} / {money.format(entry.tipAmount)}{" "}
                  · {entry.status}
                </strong>
              </div>
              <p>{entry.reason}</p>
              <small>
                Solicita {entry.requestedBy} ·{" "}
                {new Date(entry.requestedAt).toLocaleString("es-AR")}
              </small>
              {entry.status === "pending" ? (
                <>
                  <label className="wide">
                    Fundamento
                    <textarea
                      disabled={own || busy}
                      value={notes[entry.id] || ""}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [entry.id]: event.target.value,
                        }))
                      }
                      placeholder={
                        own
                          ? "Debe revisar otro administrador"
                          : "Fundamento de la decisión"
                      }
                    />
                  </label>
                  <div className="pricing-review-actions">
                    <button
                      disabled={
                        own || busy || (notes[entry.id]?.trim().length || 0) < 5
                      }
                      onClick={() => void review(entry, "rejected")}
                    >
                      Rechazar
                    </button>
                    <button
                      disabled={
                        own || busy || (notes[entry.id]?.trim().length || 0) < 5
                      }
                      onClick={() => void review(entry, "approved")}
                    >
                      Aprobar y contabilizar
                    </button>
                  </div>
                </>
              ) : (
                <small>
                  {entry.reviewedBy} · {entry.reviewNote}
                </small>
              )}
            </article>
          );
        })}
        {!adjustments.length && <p>No hay correcciones solicitadas.</p>}
      </div>
    </section>
  );
}

function PaymentReconciliationPanel() {
  const [data, setData] = useState<PaymentReconciliation | null>(null),
    [risks, setRisks] = useState<TransactionRiskAssessment[]>([]),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async (scan = false) => {
    try {
      setBusy(true);
      const [reconciliation, riskResult] = await Promise.all([
        scan ? api.scanPaymentReconciliation() : api.getPaymentReconciliation(),
        api.getTransactionRisks(),
      ]);
      setData(reconciliation);
      setRisks(riskResult.assessments);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudo cargar la conciliación",
      );
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const resolve = async (
    entry: PaymentReconciliationCase,
    status: "resolved" | "ignored",
  ) => {
    try {
      setBusy(true);
      await api.resolvePaymentReconciliationCase(
        entry.id,
        status,
        notes[entry.id]?.trim() || "",
      );
      await load();
    } catch (resolveError) {
      setError(
        resolveError instanceof Error
          ? resolveError.message
          : "No se pudo cerrar la excepción",
      );
    } finally {
      setBusy(false);
    }
  };
  const reviewRisk = async (
    entry: TransactionRiskAssessment,
    reviewStatus: "confirmed_fraud" | "false_positive" | "cleared",
  ) => {
    try {
      setBusy(true);
      await api.reviewTransactionRisk(
        entry.id,
        reviewStatus,
        notes[entry.id]?.trim() || "",
      );
      await load();
    } catch (reviewError) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : "No se pudo revisar el riesgo",
      );
    } finally {
      setBusy(false);
    }
  };
  const cases = data?.cases || [],
    pendingRisks = risks.filter(
      (entry) => entry.decision !== "allow" && !entry.reviewStatus,
    );
  return (
    <div className="admin-grid">
      <section className="admin-card">
        <AdminSectionHeader
          title="Conciliación de pagos"
          action={
            data
              ? `${data.summary.openCount} excepciones abiertas`
              : "PostgreSQL"
          }
        />
        <p>
          Compara intentos, capturas, reintegros y webhooks firmados. Detecta
          diferencias persistentes; no inventa confirmaciones del PSP.
        </p>
        <div className="admin-summary-grid">
          <article>
            <span>Urgentes</span>
            <strong>{data?.summary.urgentCount || 0}</strong>
          </article>
          <article>
            <span>Abiertas</span>
            <strong>{data?.summary.openCount || 0}</strong>
          </article>
          <article>
            <span>Riesgo pendiente</span>
            <strong>{pendingRisks.length}</strong>
          </article>
        </div>
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => void load(true)}
        >
          <RefreshCw size={17} />
          {busy ? "Conciliando…" : "Ejecutar conciliación"}
        </button>
        {error && <p className="form-error">{error}</p>}
      </section>
      <section className="admin-card">
        <AdminSectionHeader
          title="Excepciones"
          action="Importes en centavos auditables"
        />
        <div className="shipment-config-list">
          {cases.map((entry) => (
            <article
              className={`shipment-config-card${entry.status !== "open" ? " inactive" : ""}`}
              key={entry.id}
            >
              <div>
                <span>
                  {entry.provider} · {entry.caseType.replaceAll("_", " ")}
                </span>
                <strong>
                  {entry.severity} · {entry.status}
                </strong>
              </div>
              <p>{entry.summary}</p>
              <small>
                {entry.externalReference || entry.entityType} · detectado{" "}
                {new Date(entry.lastDetectedAt).toLocaleString("es-AR")}
              </small>
              <details>
                <summary>Hechos conciliados</summary>
                <pre>{JSON.stringify(entry.details, null, 2)}</pre>
              </details>
              {entry.status === "open" ? (
                <>
                  <label className="wide">
                    Resolución
                    <textarea
                      value={notes[entry.id] || ""}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [entry.id]: event.target.value,
                        }))
                      }
                      placeholder="Resultado verificado contra el proveedor"
                    />
                  </label>
                  <div className="pricing-review-actions">
                    <button
                      disabled={
                        busy || (notes[entry.id]?.trim().length || 0) < 5
                      }
                      onClick={() => void resolve(entry, "ignored")}
                    >
                      Ignorar con fundamento
                    </button>
                    <button
                      disabled={
                        busy || (notes[entry.id]?.trim().length || 0) < 5
                      }
                      onClick={() => void resolve(entry, "resolved")}
                    >
                      Marcar resuelto
                    </button>
                  </div>
                </>
              ) : (
                <small>
                  {entry.resolutionNote} · {entry.resolvedBy}
                </small>
              )}
            </article>
          ))}
          {!busy && cases.length === 0 && (
            <p>
              No hay excepciones. Ejecutá la conciliación para verificar el
              estado actual.
            </p>
          )}
        </div>
      </section>
      <section className="admin-card">
        <AdminSectionHeader
          title="Riesgo transaccional"
          action={`${pendingRisks.length} para revisar`}
        />
        <p>
          Scoring explicable previo al cobro sobre importe, antigüedad,
          velocidad, gasto horario y fallos de pago.
        </p>
        <div className="shipment-config-list">
          {risks
            .filter((entry) => entry.decision !== "allow")
            .map((entry) => (
              <article
                className={`shipment-config-card${entry.reviewStatus ? " inactive" : ""}`}
                key={entry.id}
              >
                <div>
                  <span>
                    {entry.service} · {entry.customerId}
                  </span>
                  <strong>
                    {entry.score}/100 · {entry.decision}
                  </strong>
                </div>
                <small>
                  {money.format(entry.amount)} ·{" "}
                  {entry.entityId || "bloqueada antes de crear servicio"}
                </small>
                <details>
                  <summary>Señales explicables</summary>
                  <pre>{JSON.stringify(entry.rules, null, 2)}</pre>
                </details>
                {!entry.reviewStatus ? (
                  <>
                    <label className="wide">
                      Fundamento
                      <textarea
                        value={notes[entry.id] || ""}
                        onChange={(event) =>
                          setNotes((current) => ({
                            ...current,
                            [entry.id]: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <div className="pricing-review-actions">
                      <button
                        disabled={
                          busy || (notes[entry.id]?.trim().length || 0) < 5
                        }
                        onClick={() => void reviewRisk(entry, "false_positive")}
                      >
                        Falso positivo
                      </button>
                      <button
                        disabled={
                          busy || (notes[entry.id]?.trim().length || 0) < 5
                        }
                        onClick={() => void reviewRisk(entry, "cleared")}
                      >
                        Verificado
                      </button>
                      <button
                        disabled={
                          busy || (notes[entry.id]?.trim().length || 0) < 5
                        }
                        onClick={() =>
                          void reviewRisk(entry, "confirmed_fraud")
                        }
                      >
                        Confirmar fraude
                      </button>
                    </div>
                  </>
                ) : (
                  <small>
                    {entry.reviewStatus} · {entry.reviewNote}
                  </small>
                )}
              </article>
            ))}
        </div>
      </section>
    </div>
  );
}

function ShipmentClaimsPanel() {
  const [claims, setClaims] = useState<ShipmentClaim[]>([]),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [amounts, setAmounts] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setClaims((await api.getShipmentClaims()).claims);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudieron cargar siniestros",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const transition = async (
    claim: ShipmentClaim,
    status: ShipmentClaim["status"],
  ) => {
    try {
      setBusy(true);
      await api.updateShipmentClaim(claim.id, {
        status,
        resolutionNote:
          notes[claim.id]?.trim() || `Transición operativa a ${status}`,
        approvedAmount:
          status === "approved" ? Number(amounts[claim.id]) : undefined,
      });
      await load();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "No se pudo actualizar",
      );
    } finally {
      setBusy(false);
    }
  };
  const openEvidence = async (id: string) => {
    try {
      setBusy(true);
      const result = await api.getShipmentClaimEvidenceContent(id),
        bytes = Uint8Array.from(atob(result.contentBase64), (character) =>
          character.charCodeAt(0),
        ),
        url = URL.createObjectURL(
          new Blob([bytes], { type: result.evidence.mimeType }),
        ),
        link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (openError) {
      setError(
        openError instanceof Error
          ? openError.message
          : "No se pudo abrir la evidencia",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="admin-card">
      <AdminSectionHeader
        title="Siniestros de envíos protegidos"
        action={`${claims.filter((item) => !["rejected", "settled"].includes(item.status)).length} abiertos`}
      />
      <p>
        La aprobación respeta el máximo elegible. `settlement_pending` espera
        confirmación de una aseguradora o proveedor real; la consola no inventa
        transferencias.
      </p>
      {error && <p className="form-error">{error}</p>}
      <div className="shipment-config-list">
        {claims.map((claim) => {
          const next =
            claim.status === "submitted"
              ? ["under_review", "rejected"]
              : claim.status === "under_review"
                ? ["approved", "rejected"]
                : claim.status === "approved"
                  ? ["settlement_pending"]
                  : claim.status === "settlement_pending"
                    ? ["settled"]
                    : [];
          return (
            <article
              className={`shipment-config-card${claim.status === "rejected" ? " inactive" : ""}`}
              key={claim.id}
            >
              <div>
                <span>
                  {claim.claimType} · {claim.shipmentId}
                </span>
                <strong>{claim.status.replaceAll("_", " ")}</strong>
              </div>
              <p>{claim.description}</p>
              <small>
                Solicitado {money.format(claim.requestedAmount)} · elegible
                hasta {money.format(claim.eligibleAmount)}
                {claim.approvedAmount != null
                  ? ` · aprobado ${money.format(claim.approvedAmount)}`
                  : ""}
              </small>
              {claim.evidence?.length > 0 && (
                <div className="pricing-review-actions">
                  {claim.evidence.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      disabled={busy}
                      onClick={() => void openEvidence(item.id)}
                    >
                      <Download size={15} /> {item.fileName} ·{" "}
                      {Math.ceil(item.sizeBytes / 1024)} KB
                    </button>
                  ))}
                </div>
              )}
              {claim.status === "under_review" && (
                <label>
                  Monto aprobado
                  <input
                    type="number"
                    min="0.01"
                    max={claim.eligibleAmount}
                    value={amounts[claim.id] ?? claim.eligibleAmount}
                    onChange={(event) =>
                      setAmounts((current) => ({
                        ...current,
                        [claim.id]: event.target.value,
                      }))
                    }
                  />
                </label>
              )}{" "}
              {next.length > 0 && (
                <>
                  <label className="wide">
                    Fundamento
                    <textarea
                      value={notes[claim.id] || ""}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [claim.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <div className="pricing-review-actions">
                    {next.map((status) => (
                      <button
                        key={status}
                        disabled={
                          busy ||
                          (notes[claim.id]?.trim().length || 0) < 5 ||
                          (status === "approved" &&
                            !Number(amounts[claim.id] ?? claim.eligibleAmount))
                        }
                        onClick={() =>
                          void transition(
                            claim,
                            status as ShipmentClaim["status"],
                          )
                        }
                      >
                        {status.replaceAll("_", " ")}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </article>
          );
        })}
        {claims.length === 0 && <p>No hay siniestros reportados.</p>}
      </div>
    </section>
  );
}

function ServiceQuickReplyPanel({ busy: globalBusy }: { busy: boolean }) {
  const [items, setItems] = useState<ServiceQuickReply[]>([]),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [draft, setDraft] = useState({
      serviceScope: "all" as ServiceQuickReply["serviceScope"],
      audience: "customer" as ServiceQuickReply["audience"],
      locale: "es-AR",
      body: "",
      position: 50,
      active: true,
    });
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setItems((await api.getAdminServiceQuickReplies()).quickReplies);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudo cargar el catálogo",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const create = async () => {
    try {
      setSaving(true);
      await api.createServiceQuickReply(draft);
      setDraft((current) => ({
        ...current,
        body: "",
        position: current.position + 10,
      }));
      await load();
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "No se pudo crear",
      );
    } finally {
      setSaving(false);
    }
  };
  const patch = async (
    item: ServiceQuickReply,
    changes: Partial<ServiceQuickReply>,
  ) => {
    try {
      setSaving(true);
      const updated = (await api.updateServiceQuickReply(item.id, changes))
        .quickReply;
      setItems((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
      setError("");
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "No se pudo actualizar",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="admin-grid two">
      <section className="admin-card">
        <AdminSectionHeader
          title="Respuestas rápidas"
          action="PostgreSQL · es-AR"
        />
        <p>
          El cliente mobile recibe únicamente frases activas compatibles con su
          rol y vertical.
        </p>
        {error && <p className="form-error">{error}</p>}
        <div className="shipment-config-list">
          {loading ? (
            <p>Cargando catálogo…</p>
          ) : (
            items.map((item) => (
              <article
                className={`shipment-config-card${item.active ? "" : " inactive"}`}
                key={item.id}
              >
                <div>
                  <span>
                    {item.audience} · {item.serviceScope}
                  </span>
                  <strong>{item.body}</strong>
                  <button
                    className="config-toggle"
                    disabled={saving || globalBusy}
                    onClick={() => void patch(item, { active: !item.active })}
                  >
                    {item.active ? "Desactivar" : "Activar"}
                  </button>
                </div>
                <label>
                  Orden
                  <input
                    type="number"
                    min="0"
                    max="1000"
                    value={item.position}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((entry) =>
                          entry.id === item.id
                            ? { ...entry, position: Number(event.target.value) }
                            : entry,
                        ),
                      )
                    }
                  />
                </label>
                <label className="wide">
                  Texto
                  <input
                    value={item.body}
                    maxLength={160}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((entry) =>
                          entry.id === item.id
                            ? { ...entry, body: event.target.value }
                            : entry,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  className="secondary-button"
                  disabled={saving || globalBusy || !item.body.trim()}
                  onClick={() =>
                    void patch(item, {
                      body: item.body.trim(),
                      position: item.position,
                    })
                  }
                >
                  Guardar
                </button>
              </article>
            ))
          )}
        </div>
      </section>
      <section className="admin-card merchant-create-product">
        <AdminSectionHeader
          title="Nueva respuesta"
          action="Publicación inmediata"
        />
        <label>
          Vertical
          <select
            value={draft.serviceScope}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                serviceScope: event.target
                  .value as ServiceQuickReply["serviceScope"],
              }))
            }
          >
            {["all", "food", "ride", "shipment"].map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Audiencia
          <select
            value={draft.audience}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                audience: event.target.value as ServiceQuickReply["audience"],
              }))
            }
          >
            {["customer", "driver", "merchant"].map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Idioma
          <input
            value={draft.locale}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                locale: event.target.value,
              }))
            }
          />
        </label>
        <label>
          Orden
          <input
            type="number"
            min="0"
            max="1000"
            value={draft.position}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                position: Number(event.target.value),
              }))
            }
          />
        </label>
        <label>
          Texto
          <textarea
            maxLength={160}
            value={draft.body}
            onChange={(event) =>
              setDraft((current) => ({ ...current, body: event.target.value }))
            }
          />
        </label>
        <button
          className="primary-button"
          disabled={saving || globalBusy || !draft.body.trim()}
          onClick={() => void create()}
        >
          <Plus size={17} /> Crear respuesta
        </button>
      </section>
    </div>
  );
}

function ShipmentConfigurationPanel({
  busy,
  runAction,
}: {
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const [options, setOptions] = useState<ShipmentOptions | null>(null),
    [error, setError] = useState("");
  const load = useCallback(
    () =>
      api
        .getAdminShipmentOptions()
        .then(setOptions)
        .catch((requestError) =>
          setError(
            requestError instanceof Error
              ? requestError.message
              : "No se pudo cargar",
          ),
        ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!options)
    return (
      <section className="admin-card">
        <AdminSectionHeader
          title="Configuración de Envíos"
          action="PostgreSQL"
        />
        <p>{error || "Cargando categorías y SLA…"}</p>
      </section>
    );
  return (
    <div className="admin-grid">
      <section className="admin-card">
        <AdminSectionHeader
          title="Categorías de paquete"
          action={`${options.categories.filter((item) => item.active).length} activas`}
        />
        <p>
          Límites, recargos e instrucciones usados por el cotizador y el
          conductor.
        </p>
        <div className="shipment-config-list">
          {options.categories.map((category) => (
            <article
              className={`shipment-config-card${category.active === false ? " inactive" : ""}`}
              key={category.code}
            >
              <div>
                <span>{category.code}</span>
                <strong>{category.name}</strong>
                <button
                  className="config-toggle"
                  disabled={busy}
                  onClick={() =>
                    runAction(
                      async () => {
                        const result = await api.updateShipmentItemCategory(
                          category.code,
                          { active: category.active === false },
                        );
                        setOptions((current) =>
                          current
                            ? {
                                ...current,
                                categories: current.categories.map((item) =>
                                  item.code === category.code
                                    ? { ...item, ...result.category }
                                    : item,
                                ),
                              }
                            : current,
                        );
                      },
                      category.active === false
                        ? `${category.name} activada`
                        : `${category.name} desactivada`,
                    )
                  }
                >
                  {category.active === false ? "Activar" : "Desactivar"}
                </button>
              </div>
              <label>
                Recargo ARS
                <input
                  type="number"
                  min="0"
                  value={category.surcharge}
                  onChange={(event) =>
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            categories: current.categories.map((item) =>
                              item.code === category.code
                                ? {
                                    ...item,
                                    surcharge: Number(event.target.value),
                                  }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                />
              </label>
              <label>
                Peso máximo kg
                <input
                  type="number"
                  min="0.1"
                  max="20"
                  step="0.1"
                  value={category.maximumWeightKg}
                  onChange={(event) =>
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            categories: current.categories.map((item) =>
                              item.code === category.code
                                ? {
                                    ...item,
                                    maximumWeightKg: Number(event.target.value),
                                  }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                />
              </label>
              <label className="wide">
                Instrucciones
                <textarea
                  value={category.handlingInstructions}
                  onChange={(event) =>
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            categories: current.categories.map((item) =>
                              item.code === category.code
                                ? {
                                    ...item,
                                    handlingInstructions: event.target.value,
                                  }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                />
              </label>
              <button
                className="secondary-button"
                disabled={
                  busy ||
                  category.maximumWeightKg <= 0 ||
                  category.handlingInstructions.trim().length < 3
                }
                onClick={() =>
                  runAction(async () => {
                    const result = await api.updateShipmentItemCategory(
                      category.code,
                      {
                        surcharge: category.surcharge,
                        maximumWeightKg: category.maximumWeightKg,
                        handlingInstructions: category.handlingInstructions,
                      },
                    );
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            categories: current.categories.map((item) =>
                              item.code === category.code
                                ? { ...item, ...result.category }
                                : item,
                            ),
                          }
                        : current,
                    );
                  }, `${category.name} actualizada`)
                }
              >
                Guardar categoría
              </button>
            </article>
          ))}
        </div>
      </section>
      <section className="admin-card">
        <AdminSectionHeader title="Niveles de servicio" action="Precio + ETA" />
        <p>
          Los cambios afectan cotizaciones nuevas; los tokens ya emitidos
          conservan su precio bloqueado.
        </p>
        <div className="shipment-config-list">
          {options.serviceLevels.map((level) => (
            <article
              className={`shipment-config-card sla${level.active === false ? " inactive" : ""}`}
              key={level.code}
            >
              <div>
                <span>{level.code}</span>
                <strong>{level.name}</strong>
                <button
                  className="config-toggle"
                  disabled={busy}
                  onClick={() =>
                    runAction(
                      async () => {
                        const result = await api.updateShipmentServiceLevel(
                          level.code,
                          { active: level.active === false },
                        );
                        setOptions((current) =>
                          current
                            ? {
                                ...current,
                                serviceLevels: current.serviceLevels.map(
                                  (item) =>
                                    item.code === level.code
                                      ? { ...item, ...result.serviceLevel }
                                      : item,
                                ),
                              }
                            : current,
                        );
                      },
                      level.active === false
                        ? `${level.name} activado`
                        : `${level.name} desactivado`,
                    )
                  }
                >
                  {level.active === false ? "Activar" : "Desactivar"}
                </button>
              </div>
              <label>
                Multiplicador precio
                <input
                  type="number"
                  min="0.5"
                  max="5"
                  step="0.05"
                  value={level.transportMultiplier}
                  onChange={(event) =>
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            serviceLevels: current.serviceLevels.map((item) =>
                              item.code === level.code
                                ? {
                                    ...item,
                                    transportMultiplier: Number(
                                      event.target.value,
                                    ),
                                  }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                />
              </label>
              <label>
                Multiplicador ETA
                <input
                  type="number"
                  min="0.25"
                  max="3"
                  step="0.05"
                  value={level.etaMultiplier}
                  onChange={(event) =>
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            serviceLevels: current.serviceLevels.map((item) =>
                              item.code === level.code
                                ? {
                                    ...item,
                                    etaMultiplier: Number(event.target.value),
                                  }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                />
              </label>
              <label>
                Distancia máxima km
                <input
                  type="number"
                  min="1"
                  placeholder="Sin límite"
                  value={level.maximumDistanceKm ?? ""}
                  onChange={(event) =>
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            serviceLevels: current.serviceLevels.map((item) =>
                              item.code === level.code
                                ? {
                                    ...item,
                                    maximumDistanceKm:
                                      event.target.value === ""
                                        ? null
                                        : Number(event.target.value),
                                  }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                />
              </label>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  runAction(async () => {
                    const result = await api.updateShipmentServiceLevel(
                      level.code,
                      {
                        transportMultiplier: level.transportMultiplier,
                        etaMultiplier: level.etaMultiplier,
                        maximumDistanceKm: level.maximumDistanceKm,
                      },
                    );
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            serviceLevels: current.serviceLevels.map((item) =>
                              item.code === level.code
                                ? { ...item, ...result.serviceLevel }
                                : item,
                            ),
                          }
                        : current,
                    );
                  }, `${level.name} actualizado`)
                }
              >
                Guardar SLA
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function NotificationDeliveryPanel() {
  const [deadLetters, setDeadLetters] = useState<NotificationDeadLetter[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setDeadLetters((await api.getNotificationDeadLetters()).deadLetters);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudo cargar la cola de descarte",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (action: () => Promise<unknown>) => {
    try {
      setBusy(true);
      await action();
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "No se pudo procesar la notificación",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="admin-card">
      <AdminSectionHeader
        title="Entrega de notificaciones"
        action={`${deadLetters.length} descartadas`}
      />
      <p>
        Los tokens permanentemente inválidos se revocan. Los fallos terminales
        quedan retenidos para inspección y replay atribuido, sin exponer tokens
        ni payloads.
      </p>
      <button
        className="primary-button"
        disabled={busy}
        onClick={() => void act(() => api.processNotifications())}
      >
        <RefreshCw size={17} />
        {busy ? "Procesando…" : "Procesar outbox"}
      </button>
      {error && <p className="form-error">{error}</p>}
      <div className="shipment-config-list">
        {deadLetters.map((entry) => (
          <article className="shipment-config-card" key={entry.id}>
            <div>
              <span>
                {entry.channel} · {entry.template}
              </span>
              <strong>{entry.id}</strong>
            </div>
            <small>
              {entry.userId} · {entry.reason} · {entry.attempts} intentos
            </small>
            <small>
              Descartada {new Date(entry.createdAt).toLocaleString("es-AR")} ·
              replays {entry.replayCount}
            </small>
            <button
              disabled={busy}
              onClick={() =>
                void act(() => api.replayNotificationDeadLetter(entry.id))
              }
            >
              Reintentar entrega
            </button>
          </article>
        ))}
        {!deadLetters.length && <p>No hay entregas terminales pendientes.</p>}
      </div>
    </section>
  );
}

function SupportOperationsPanel({
  tickets,
  currentUserId,
  busy,
  runAction,
}: {
  tickets: SupportTicket[];
  currentUserId: string;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const [agents, setAgents] = useState<SupportAgent[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setAgents((await api.getSupportAgents()).agents);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudieron cargar los agentes",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const updateAgent = async (
    userId: string,
    payload: Parameters<typeof api.updateSupportAgent>[1],
  ) => {
    try {
      setLoading(true);
      await api.updateSupportAgent(userId, payload);
      await load();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "No se pudo actualizar el agente",
      );
    } finally {
      setLoading(false);
    }
  };
  const open = tickets.filter(
      (ticket) => !["resolved", "closed"].includes(ticket.status),
    ),
    breached = open.filter((ticket) => ticket.slaStatus.includes("breached"));
  return (
    <div className="admin-grid">
      <section className="admin-card">
        <AdminSectionHeader
          title="Soporte y SLA"
          action={`${open.length} abiertos · ${breached.length} vencidos`}
        />
        <p>
          La cola asigna por capacidad y especialidad. Los vencimientos generan
          escalaciones idempotentes, nota interna y alerta al responsable.
        </p>
        <button
          className="primary-button"
          disabled={busy || loading}
          onClick={() =>
            runAction(
              () => api.processSupportQueue(),
              "Cola distribuida y SLA procesado",
            )
          }
        >
          <RefreshCw size={17} />
          Procesar cola ahora
        </button>
        {error && <p className="form-error">{error}</p>}
        <div className="shipment-config-list">
          {tickets.map((ticket) => (
            <article
              className={`shipment-config-card${["resolved", "closed"].includes(ticket.status) ? " inactive" : ""}`}
              key={ticket.id}
            >
              <div>
                <span>
                  {ticket.service} · {ticket.id}
                </span>
                <strong>{ticket.title}</strong>
              </div>
              <div className="admin-summary-grid">
                <article>
                  <span>SLA</span>
                  <strong
                    className={
                      ticket.slaStatus.includes("breached")
                        ? "status-suspended"
                        : "status-active"
                    }
                  >
                    {ticket.slaStatus.replaceAll("_", " ")}
                  </strong>
                </article>
                <article>
                  <span>Responsable</span>
                  <strong>{ticket.assignedTo || "Sin asignar"}</strong>
                </article>
                <article>
                  <span>Escalación</span>
                  <strong>Nivel {ticket.escalationLevel}</strong>
                </article>
              </div>
              <small>
                {ticket.priority} · {ticket.resolutionDueAt
                  ? `resolución ${new Date(ticket.resolutionDueAt).toLocaleString("es-AR")}`
                  : "SLA persistido sólo con PostgreSQL"}
              </small>
              <label className="wide">
                Asignar
                <select
                  value={ticket.assignedTo || ""}
                  disabled={
                    busy ||
                    loading ||
                    ["resolved", "closed"].includes(ticket.status)
                  }
                  onChange={(event) =>
                    runAction(
                      () =>
                        api.updateSupportTicket(ticket.id, {
                          assignedTo: event.target.value,
                        }),
                      "Ticket reasignado",
                    )
                  }
                >
                  <option value="">Seleccionar agente</option>
                  {agents
                    .filter((agent) => agent.availability !== "offline")
                    .map((agent) => (
                      <option key={agent.userId} value={agent.userId}>
                        {agent.name} · {agent.activeTickets}/
                        {agent.maxActiveTickets}
                      </option>
                    ))}
                </select>
              </label>
              {!["resolved", "closed"].includes(ticket.status) && (
                <div className="pricing-review-actions">
                  <button
                    disabled={busy || ticket.assignedTo === currentUserId}
                    onClick={() =>
                      runAction(
                        () =>
                          api.updateSupportTicket(ticket.id, {
                            assignedTo: currentUserId,
                          }),
                        "Ticket tomado",
                      )
                    }
                  >
                    Tomar caso
                  </button>
                  <button
                    disabled={busy || ticket.priority === "urgent"}
                    onClick={() =>
                      runAction(
                        () =>
                          api.updateSupportTicket(ticket.id, {
                            priority: "urgent",
                          }),
                        "Prioridad elevada",
                      )
                    }
                  >
                    Marcar urgente
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      runAction(
                        () =>
                          api.updateSupportTicket(ticket.id, {
                            status: "resolved",
                          }),
                        "Ticket resuelto",
                      )
                    }
                  >
                    Resolver
                  </button>
                </div>
              )}
              {ticket.assignmentHistory.length > 0 && (
                <details>
                  <summary>
                    Historial de asignación ({ticket.assignmentHistory.length})
                  </summary>
                  {ticket.assignmentHistory.map((entry, index) => (
                    <small key={`${entry.createdAt}-${index}`}>
                      {new Date(entry.createdAt).toLocaleString("es-AR")} ·{" "}
                      {entry.assignedTo} · {entry.reason}
                    </small>
                  ))}
                </details>
              )}
            </article>
          ))}
          {!tickets.length && <p>No hay tickets en la cola.</p>}
        </div>
      </section>
      <section className="admin-card">
        <AdminSectionHeader
          title="Capacidad del equipo"
          action={`${agents.filter((agent) => agent.availability !== "offline").length} disponibles`}
        />
        <div className="shipment-config-list">
          {agents.map((agent) => (
            <article
              className={`shipment-config-card${agent.availability === "offline" ? " inactive" : ""}`}
              key={agent.userId}
            >
              <div>
                <span>{agent.userId}</span>
                <strong>{agent.name}</strong>
              </div>
              <small>
                {agent.activeTickets}/{agent.maxActiveTickets} activos · skills{" "}
                {agent.skills.join(", ")}
              </small>
              <div className="pricing-fields">
                <label>
                  Estado
                  <select
                    value={agent.availability}
                    disabled={loading}
                    onChange={(event) =>
                      void updateAgent(agent.userId, {
                        availability: event.target
                          .value as SupportAgent["availability"],
                      })
                    }
                  >
                    <option value="available">Disponible</option>
                    <option value="busy">Ocupado</option>
                    <option value="offline">Fuera de línea</option>
                  </select>
                </label>
                <label>
                  Capacidad
                  <input
                    type="number"
                    min="1"
                    max="100"
                    defaultValue={agent.maxActiveTickets}
                    disabled={loading}
                    onBlur={(event) => {
                      const value = Number(event.target.value);
                      if (
                        value >= 1 &&
                        value <= 100 &&
                        value !== agent.maxActiveTickets
                      )
                        void updateAgent(agent.userId, {
                          maxActiveTickets: value,
                        });
                    }}
                  />
                </label>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function AdminUserModeration({
  users,
  busy,
  runAction,
}: {
  users: User[];
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  return (
    <section className="admin-card">
      <AdminSectionHeader
        title="Usuarios y confianza"
        action={`${users.filter((user) => user.status === "suspended").length} suspendidos`}
      />
      <p>
        Suspender revoca sesiones, desconecta conductores y retira sus ofertas
        pendientes. Cada decisión queda auditada.
      </p>
      <div className="admin-table user-moderation-table">
        {users.map((user) => {
          const suspended = user.status === "suspended",
            reason = reasons[user.id] || "";
          return (
            <article className="admin-row user-moderation-row" key={user.id}>
              <UserRound size={19} />
              <div>
                <strong>{user.name}</strong>
                <span>
                  {user.email} · {user.roles.join(", ")}
                </span>
              </div>
              <b className={suspended ? "status-suspended" : "status-active"}>
                {suspended ? "Suspendido" : "Activo"}
              </b>
              <input
                aria-label={`Motivo para ${user.name}`}
                value={reason}
                onChange={(event) =>
                  setReasons((current) => ({
                    ...current,
                    [user.id]: event.target.value,
                  }))
                }
                placeholder={
                  suspended ? "Motivo de reactivación" : "Motivo de suspensión"
                }
              />
              <button
                type="button"
                disabled={busy || reason.trim().length < 5}
                onClick={() =>
                  runAction(
                    () =>
                      api.updateUserStatus(
                        user.id,
                        suspended ? "active" : "suspended",
                        reason.trim(),
                      ),
                    suspended ? "Cuenta reactivada" : "Cuenta suspendida",
                  )
                }
              >
                {suspended ? "Reactivar" : "Suspender"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

type AdminMfaStatus = {
  enabled: boolean;
  method: string;
  confirmedAt: string | null;
  lockedUntil: string | null;
  recoveryCodesRemaining: number;
};
type AdminMfaEnrollment = {
  secret: string;
  otpauthUri: string;
  recoveryCodes: string[];
};

function AdminSecurityPanel() {
  const [status, setStatus] = useState<AdminMfaStatus | null>(null),
    [enrollment, setEnrollment] = useState<AdminMfaEnrollment | null>(null),
    [qr, setQr] = useState(""),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    api
      .getMfaStatus()
      .then((result) => setStatus(result.mfa))
      .catch((requestError) =>
        setError(
          requestError instanceof Error
            ? requestError.message
            : "No se pudo consultar MFA",
        ),
      );
  }, []);
  useEffect(() => {
    let active = true;
    if (!enrollment) {
      setQr("");
      return;
    }
    import("qrcode")
      .then((module) =>
        module.default.toDataURL(enrollment.otpauthUri, {
          width: 260,
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#151b22", light: "#ffffff" },
        }),
      )
      .then((value) => {
        if (active) setQr(value);
      })
      .catch(() => setError("No se pudo generar el QR"));
    return () => {
      active = false;
    };
  }, [enrollment]);
  const begin = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api.enrollMfa();
      setEnrollment(result.enrollment);
      setMessage("Escaneá el QR y guardá los códigos antes de confirmar.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No se pudo iniciar MFA",
      );
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api.confirmMfa(code);
      setStatus(result.mfa);
      setCode("");
      setEnrollment(null);
      setMessage(
        "MFA quedó activo. Las próximas sesiones administrativas exigirán el segundo factor.",
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Código inválido",
      );
    } finally {
      setBusy(false);
    }
  };
  const recoveryText = enrollment
    ? `Flash Delivery · Códigos de recuperación MFA\nGenerados: ${new Date().toISOString()}\n\n${enrollment.recoveryCodes.join("\n")}\n\nCada código sirve una sola vez. Guardar fuera del dispositivo.`
    : "";
  const copyRecovery = async () => {
    if (!recoveryText) return;
    await navigator.clipboard.writeText(recoveryText);
    setMessage("Códigos copiados. Guardalos en un gestor seguro.");
  };
  const downloadRecovery = () => {
    if (!recoveryText) return;
    const url = URL.createObjectURL(
        new Blob([recoveryText], { type: "text/plain;charset=utf-8" }),
      ),
      link = document.createElement("a");
    link.href = url;
    link.download = "flash-mfa-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Archivo descargado. Movelo a un almacenamiento seguro.");
  };
  return (
    <section className="admin-card admin-security-card">
      <AdminSectionHeader
        title="Seguridad de superadministración"
        action={status?.enabled ? "MFA activo" : "Acción requerida"}
      />
      {!status && !error && (
        <div className="security-loading">
          <RefreshCw size={18} /> Consultando postura de seguridad…
        </div>
      )}
      {status && (
        <div className="security-status-grid">
          <article
            className={`security-posture ${status.enabled ? "enabled" : "warning"}`}
          >
            <span>
              <ShieldCheck size={25} />
            </span>
            <div>
              <small>Segundo factor</small>
              <strong>
                {status.enabled
                  ? "Protección TOTP activa"
                  : "MFA todavía no configurado"}
              </strong>
              <p>
                {status.enabled
                  ? `Confirmado ${status.confirmedAt ? new Date(status.confirmedAt).toLocaleString("es-AR") : ""}. Quedan ${status.recoveryCodesRemaining} códigos de recuperación.`
                  : "En producción, las operaciones administrativas permanecen bloqueadas hasta completar este enrolamiento."}
              </p>
            </div>
          </article>
          <article className="security-policy">
            <KeyRound size={22} />
            <div>
              <strong>Política de acceso</strong>
              <span>
                Contraseña + TOTP · desafío 5 min · bloqueo tras 5 fallos ·
                recuperación de un solo uso
              </span>
            </div>
          </article>
        </div>
      )}
      {status && !status.enabled && !enrollment && (
        <div className="security-enroll-start">
          <div>
            <strong>Activar una aplicación autenticadora</strong>
            <p>
              Compatible con 1Password, Google Authenticator, Microsoft
              Authenticator, Authy y cualquier cliente TOTP estándar.
            </p>
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={begin}
            disabled={busy}
          >
            <KeyRound size={17} />
            {busy ? "Preparando…" : "Configurar MFA"}
          </button>
        </div>
      )}
      {enrollment && (
        <div className="security-enrollment">
          <div className="security-qr">
            <span>Paso 1</span>
            <strong>Escaneá el QR</strong>
            {qr ? (
              <img src={qr} alt="Código QR para configurar MFA" />
            ) : (
              <div className="qr-placeholder">Generando QR…</div>
            )}
            <details>
              <summary>Ingresar clave manualmente</summary>
              <code>{enrollment.secret}</code>
            </details>
          </div>
          <div className="security-recovery">
            <span>Paso 2</span>
            <strong>Guardá los códigos de recuperación</strong>
            <p>
              Se muestran una sola vez y cada uno se invalida después de usarlo.
            </p>
            <div className="recovery-code-grid">
              {enrollment.recoveryCodes.map((item) => (
                <code key={item}>{item}</code>
              ))}
            </div>
            <div className="security-inline-actions">
              <button type="button" onClick={() => void copyRecovery()}>
                <Copy size={16} /> Copiar
              </button>
              <button type="button" onClick={downloadRecovery}>
                <Download size={16} /> Descargar
              </button>
            </div>
          </div>
          <form
            className="security-confirm"
            onSubmit={(event) => {
              event.preventDefault();
              void confirm();
            }}
          >
            <div>
              <span>Paso 3</span>
              <strong>Confirmá un código de 6 dígitos</strong>
              <p>
                La protección no se activa hasta verificar que el autenticador
                quedó configurado.
              </p>
            </div>
            <input
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              pattern="[0-9]{6}"
              required
            />
            <button
              className="primary-button"
              type="submit"
              disabled={busy || code.length !== 6}
            >
              {busy ? "Verificando…" : "Activar MFA"}
            </button>
          </form>
        </div>
      )}
      {message && (
        <p className="security-message">
          <Check size={17} />
          {message}
        </p>
      )}
      {error && (
        <p className="security-error">
          <X size={17} />
          {error}
        </p>
      )}
    </section>
  );
}

function RealtimeStatus({
  status,
}: {
  status: "connecting" | "live" | "reconnecting" | "offline";
}) {
  const labels = {
    connecting: "Conectando live",
    live: "Realtime activo",
    reconnecting: "Reconectando",
    offline: "Realtime offline",
  } as const;
  return (
    <span
      className={`realtime-status ${status}`}
      title="Canal de actualizaciones de la plataforma"
    >
      <span />
      {labels[status]}
    </span>
  );
}

function AdminKpi({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string | number;
  detail: string;
  tone: string;
}) {
  return (
    <article className={`admin-kpi ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function AdminSectionHeader({
  title,
  action,
}: {
  title: string;
  action: string;
}) {
  return (
    <div className="admin-section-header">
      <h2>{title}</h2>
      <span>{action}</span>
    </div>
  );
}

function MarketplaceHealth({
  state,
  dashboard,
  cancellationCount,
}: {
  state: AppState;
  dashboard: AdminDashboard | null;
  cancellationCount: number;
}) {
  const rows = [
    [
      "Fill rate delivery",
      dashboard
        ? `${dashboard.marketplace.fillRateDelivery}%`
        : `${state.orders.filter((order) => order.courierId).length}/${state.orders.length}`,
      "Asignacion",
    ],
    [
      "Fill rate taxi",
      dashboard
        ? `${dashboard.marketplace.fillRateRide}%`
        : `${state.rides.filter((ride) => ride.driverId).length}/${state.rides.length}`,
      "Conductores",
    ],
    [
      "Locales abiertos",
      `${state.metrics.openRestaurants}/${state.restaurants.length}`,
      "Supply",
    ],
    ["Cancelaciones", String(cancellationCount), "Riesgo"],
  ];
  return (
    <div className="health-list">
      {rows.map(([label, value, detail]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
          <small>{detail}</small>
        </div>
      ))}
    </div>
  );
}

function InvestorPulse({
  dashboard,
  grossVolume,
  platformRevenue,
}: {
  dashboard: AdminDashboard | null;
  grossVolume: number;
  platformRevenue: number;
}) {
  const investor = dashboard?.investor;
  const score = investor?.readinessScore ?? 0;
  const margin = investor?.contributionMarginPercent ?? null;
  const runway = investor?.runwayMonths ?? null;
  return (
    <div className="investor-pulse">
      <div
        className="readiness-meter"
        style={{ "--score": `${score}%` } as CSSProperties}
      >
        <strong>{score}</strong>
        <span>readiness</span>
      </div>
      <div className="investor-summary">
        <h3>Historia para inversores</h3>
        <p>
          Marketplace multi-servicio con demanda de comida y movilidad, supply
          flexible y backoffice operativo. El foco de la ronda es convertir el
          MVP local en beta con realtime, pagos y app nativa.
        </p>
        <div className="investor-stats">
          <span>GMV {money.format(grossVolume)}</span>
          <span>Revenue {money.format(platformRevenue)}</span>
          <span>
            Runway{" "}
            {runway === null || runway === 0 ? "sin configurar" : `${runway}m`}
          </span>
          <span>
            Margen {margin === null ? "sin configurar" : `${margin}%`}
          </span>
        </div>
      </div>
    </div>
  );
}

function UnitEconomicsBoard({
  dashboard,
}: {
  dashboard: AdminDashboard | null;
}) {
  const rows = dashboard?.investor.unitEconomics || [
    { label: "AOV comida", value: "$0", detail: "Ticket promedio" },
    { label: "Fare taxi", value: "$0", detail: "Tarifa promedio" },
    { label: "Take rate", value: "0%", detail: "Sin revenue posteado" },
  ];
  return (
    <div className="unit-grid">
      {rows.map((row) => (
        <div key={row.label}>
          <span>{row.label}</span>
          <strong>{row.value}</strong>
          <small>{row.detail}</small>
        </div>
      ))}
    </div>
  );
}

function MilestoneBoard({ dashboard }: { dashboard: AdminDashboard | null }) {
  const milestones = dashboard?.investor.milestones || [];
  return (
    <div className="milestone-list">
      {milestones.map((milestone) => (
        <article className={milestone.status} key={milestone.label}>
          <span />
          <div>
            <strong>{milestone.label}</strong>
            <small>{milestone.value}</small>
          </div>
          <b>{milestone.status.replace("_", " ")}</b>
        </article>
      ))}
    </div>
  );
}

function GrowthFunnel({
  state,
  dashboard,
}: {
  state: AppState;
  dashboard: AdminDashboard | null;
}) {
  const activatedUsers = state.users.filter((user) =>
    user.roles.includes("customer"),
  ).length;
  const completedJobs =
    state.orders.filter((order) => order.status === "delivered").length +
    state.rides.filter((ride) => ride.status === "completed").length;
  const funnel = [
    {
      label: "Usuarios",
      value: state.users.length,
      detail: "Cuentas registradas",
    },
    { label: "Activados", value: activatedUsers, detail: "Cliente con wallet" },
    {
      label: "Jobs",
      value: state.orders.length + state.rides.length,
      detail: "Pedidos + viajes",
    },
    {
      label: "Cumplidos",
      value: completedJobs,
      detail: "Conversion operativa",
    },
    {
      label: "Fill delivery",
      value: `${dashboard?.marketplace.fillRateDelivery ?? 0}%`,
      detail: "Asignacion",
    },
    {
      label: "Fill taxi",
      value: `${dashboard?.marketplace.fillRateRide ?? 0}%`,
      detail: "Asignacion",
    },
  ];
  return (
    <div className="funnel-list">
      {funnel.map((row, index) => (
        <article key={row.label}>
          <div style={{ width: `${100 - index * 9}%` }} />
          <span>{row.label}</span>
          <strong>{row.value}</strong>
          <small>{row.detail}</small>
        </article>
      ))}
    </div>
  );
}

function RiskSignalBoard({ dashboard }: { dashboard: AdminDashboard | null }) {
  const risks = dashboard?.riskSignals || [];
  return (
    <div className="risk-list">
      {risks.map((risk) => (
        <article className={risk.level} key={risk.id}>
          <strong>{risk.label}</strong>
          <span>{risk.value}</span>
          <small>
            {risk.level === "low"
              ? "Controlado"
              : risk.level === "medium"
                ? "Monitorear"
                : "Accion inmediata"}
          </small>
        </article>
      ))}
    </div>
  );
}

function ZoneBoard({ state }: { state: AppState }) {
  return (
    <div className="zone-board">
      {state.zones?.map((zone) => (
        <article
          className={zone.demandLevel === "high" ? "hot" : ""}
          key={zone.id}
        >
          <strong>{zone.name}</strong>
          <span>{zone.demandLevel}</span>
          <small>
            {zone.activeOrders} pedidos · {zone.activeRides} viajes
          </small>
        </article>
      ))}
    </div>
  );
}

function AdminLiveGrid({
  state,
  orders,
  rides,
  busy,
  runAction,
}: {
  state: AppState;
  orders: Order[];
  rides: Ride[];
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  return (
    <div className="admin-live-grid">
      <div className="admin-table">
        {orders.map((order) => {
          const restaurant = state.restaurants.find(
            (entry) => entry.id === order.restaurantId,
          );
          const driver = state.drivers.find(
            (entry) => entry.id === order.courierId,
          );
          return (
            <article className="admin-row compact" key={order.id}>
              <ShoppingBag size={18} />
              <div>
                <strong>{restaurant?.name || order.id}</strong>
                <span>
                  {orderStatusLabel[order.status]} · {order.deliveryAddress}
                </span>
              </div>
              <b>{money.format(order.total)}</b>
              <small>{driver?.name || "Sin repartidor"}</small>
              <button
                type="button"
                disabled={
                  busy ||
                  ["ready_for_pickup", "delivered", "cancelled"].includes(
                    order.status,
                  )
                }
                onClick={() =>
                  runAction(() => api.advanceOrder(order.id), "Pedido avanzado")
                }
              >
                Avanzar
              </button>
            </article>
          );
        })}
      </div>
      <div className="admin-table">
        {rides.map((ride) => {
          const driver = state.drivers.find(
            (entry) => entry.id === ride.driverId,
          );
          return (
            <article className="admin-row compact" key={ride.id}>
              <Car size={18} />
              <div>
                <strong>{ride.pickup}</strong>
                <span>
                  {rideStatusLabel[ride.status]} → {ride.destination}
                </span>
              </div>
              <b>{money.format(ride.fare)}</b>
              <small>{driver?.name || "Sin conductor"}</small>
              <button
                type="button"
                disabled={
                  busy ||
                  ["requested", "completed", "cancelled"].includes(ride.status)
                }
                onClick={() =>
                  runAction(() => api.advanceRide(ride.id), "Viaje avanzado")
                }
              >
                Avanzar
              </button>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function InfraItem({ title, text }: { title: string; text: string }) {
  return (
    <article>
      <ShieldCheck size={18} />
      <div>
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
    </article>
  );
}

function AppModeBar({
  mode,
  onModeChange,
}: {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
}) {
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
          <div
            className={`zone zone-${["one", "two", "three"][index]}`}
            key={zone.id}
          >
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

function Metric({
  label,
  value,
  trend,
}: {
  label: string;
  value: string;
  trend: string;
}) {
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
  createOrder: (providerPayment?:{cardToken:string;paymentMethodId:string;installments:number}) => Promise<void>;
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
  onUpdateProfile: (payload: {
    name: string;
    phone: string;
    defaultAddress: string;
  }) => void;
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
  dietaryPreferences:DietaryPreferences|null;
  onDietaryPreferencesChange:(preferences:DietaryPreferences)=>void;
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
            .saveCart(
              nextCart[0]?.restaurantId || cartRestaurant?.id || "empty",
              nextCart,
            )
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
        customerEmail={user?.email||""}
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
            badge={
              state.supportTickets.filter((ticket) => ticket.status === "open")
                .length
            }
            onClick={() => setTab("activity")}
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
          onOpenRestaurant={(restaurant) =>
            setSelectedRestaurantId(restaurant.id)
          }
          onOpenItem={openItem}
        />
      )}
      {tab === "home" && service === "ride" && (
        <RideHome
          state={state}
          user={user}
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
      )}
      {tab === "home" && service === "shipment" && (
        <ShipmentHome
          state={state}
          user={user}
          busy={busy}
          onCreateShipment={createShipment}
        />
      )}
      {tab === "activity" && (
        <CustomerActivity
          state={state}
          user={user}
          runAction={runAction}
          busy={busy}
        />
      )}
      {tab === "wallet" && (
        <WalletScreen
          user={user}
          promotions={state.promotions}
          transactions={state.walletTransactions.filter(
            (entry) => entry.userId === user?.id,
          )}
          onTopUp={onTopUpWallet}
        />
      )}
      {tab === "profile" && (
        <ProfileScreen
          user={user}
          address={
            state.addresses.find(
              (entry) => entry.userId === user?.id && entry.isDefault,
            )?.address
          }
          paymentMethods={state.paymentMethods.filter(
            (entry) => entry.userId === user?.id,
          )}
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
      <CategoryRail
        categories={categories}
        category={category}
        setCategory={setCategory}
      />
      <SectionTitle title="Cerca tuyo" action="Abiertos" />
      <div className="restaurant-rail">
        {restaurants.map((restaurant) => (
          <RestaurantCard
            key={restaurant.id}
            restaurant={restaurant}
            favorite={favoriteRestaurantIds.includes(restaurant.id)}
            onToggleFavorite={() =>
              onToggleFavorite(
                restaurant.id,
                !favoriteRestaurantIds.includes(restaurant.id),
              )
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
        <strong>
          Envios gratis, soporte prioritario y promos cross-food/taxi
        </strong>
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

function RideHome({
  state,
  user,
  rideForm,
  setRideForm,
  quote,
  quoteRide,
  requestRide,
  locatePickup,
  locationStatus,
  locationMessage,
  busy,
}: {
  state: AppState;
  user: User | null;
  rideForm: RideForm;
  setRideForm: React.Dispatch<React.SetStateAction<RideForm>>;
  quote: RideQuote | null;
  quoteRide: () => void;
  requestRide: () => void;
  locatePickup: () => void;
  locationStatus: "idle" | "locating" | "ready" | "denied";
  locationMessage: string;
  busy: boolean;
}) {
  const activeRide = state.rides.find(
    (ride) =>
      ride.customerId === user?.id &&
      !["completed", "cancelled"].includes(ride.status),
  );
  const driver = state.drivers.find(
    (entry) => entry.id === activeRide?.driverId,
  );

  return (
    <>
      <section className="ride-map">
        <div className="route-line" />
        <span className="map-dot pickup">
          <MapPin size={13} />
        </span>
        <span className="map-dot car-dot">
          <Car size={13} />
        </span>
        <span className="map-dot destination">
          <Home size={13} />
        </span>
      </section>
      <section className="booking-card">
        <label>
          <span>Origen</span>
          <input
            value={rideForm.pickup}
            onChange={(event) =>
              setRideForm((current) => ({
                ...current,
                pickup: event.target.value,
                pickupCoords: null,
              }))
            }
          />
        </label>
        <label>
          <span>Destino</span>
          <input
            value={rideForm.destination}
            onChange={(event) =>
              setRideForm((current) => ({
                ...current,
                destination: event.target.value,
                destinationCoords: null,
              }))
            }
          />
        </label>
        <button
          className="location-action"
          type="button"
          onClick={locatePickup}
          disabled={busy || locationStatus === "locating"}
        >
          <LocateFixed size={15} />
          {locationStatus === "locating"
            ? "Buscando GPS..."
            : "Usar mi ubicacion actual"}
        </button>
        {locationMessage && (
          <small className={`location-message ${locationStatus}`}>
            {locationMessage}
          </small>
        )}
        <div className="ride-services">
          {rideServices.map(({ id, label, icon: Icon }) => (
            <button
              className={rideForm.service === id ? "active" : ""}
              key={id}
              onClick={() =>
                setRideForm((current) => ({ ...current, service: id }))
              }
              type="button"
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        {quote && (
          <div className="quote-card">
            <div>
              <span>
                {quote.distanceKm} km · {quote.durationMin} min
              </span>
              <strong>{money.format(quote.fare)}</strong>
            </div>
            <small>
              {quote.etaMin} min hasta el punto ·{" "}
              {quote.routingMode === "coordinates"
                ? "basado en coordenadas"
                : "estimacion por direccion"}
            </small>
          </div>
        )}
        <div className="two-actions">
          <button
            className="ghost-action"
            onClick={quoteRide}
            type="button"
            disabled={busy}
          >
            <BadgeDollarSign size={16} /> Cotizar
          </button>
          <button
            className="primary-button"
            onClick={requestRide}
            type="button"
            disabled={busy || !quote?.quoteToken}
          >
            <Car size={16} /> Pedir taxi
          </button>
        </div>
      </section>
      <RideSafetyPanel />
      {activeRide && (
        <TrackingCard
          title={`${rideStatusLabel[activeRide.status]} · ${activeRide.etaMin} min`}
          subtitle={`${activeRide.pickup} → ${activeRide.destination}`}
          amount={activeRide.fare}
          person={driver?.name || "Asignando conductor"}
          steps={rideSteps}
          currentStatus={activeRide.status}
          labels={rideStatusLabel}
        />
      )}
    </>
  );
}

function RideSafetyPanel() {
  const items = [
    ["PIN", "Verificacion al subir"],
    ["Share", "Compartir recorrido"],
    ["SOS", "Soporte prioritario"],
  ];
  return (
    <section className="safety-panel">
      <div>
        <ShieldCheck size={18} />
        <strong>Viaje protegido</strong>
      </div>
      {items.map(([label, detail]) => (
        <span key={label}>
          <b>{label}</b>
          {detail}
        </span>
      ))}
    </section>
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
  const [pickup, setPickup] = useState(
    user?.defaultAddress || savedAddresses[0]?.address || "",
  );
  const [destination, setDestination] = useState("");
  const [pickupCoords, setPickupCoords] = useState<GeoPoint | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<GeoPoint | null>(
    null,
  );
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [description, setDescription] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [packageSize, setPackageSize] = useState<Shipment["packageSize"]>(
    "small",
  );
  const [weightKg, setWeightKg] = useState("1");
  const [declaredValue, setDeclaredValue] = useState("0");
  const [protection, setProtection] = useState<NonNullable<Shipment["protection"]>>(
    "none",
  );
  const [signatureRequired, setSignatureRequired] = useState(false);
  const [itemCategory, setItemCategory] = useState<
    NonNullable<Shipment["itemCategory"]>
  >("standard");
  const [serviceLevel, setServiceLevel] = useState<
    NonNullable<Shipment["serviceLevel"]>
  >("standard");
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
        const activeCategory = response.categories.find(
          (entry) => entry.active !== false,
        );
        const activeServiceLevel = response.serviceLevels.find(
          (entry) => entry.active !== false,
        );
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
            error instanceof Error
              ? error.message
              : "No se pudieron cargar las opciones de envío",
          );
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeCategories =
    options?.categories.filter((entry) => entry.active !== false) || [];
  const activeServiceLevels =
    options?.serviceLevels.filter((entry) => entry.active !== false) || [];
  const selectedCategory = activeCategories.find(
    (entry) => entry.code === itemCategory,
  );
  const selectedServiceLevel = activeServiceLevels.find(
    (entry) => entry.code === serviceLevel,
  );
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
      if (recipientName.trim().length < 2)
        throw new Error("Indicá quién recibe el paquete");
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
      setQuoteError(
        error instanceof Error ? error.message : "No se pudo cotizar el envío",
      );
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
      setSubmitError(
        error instanceof Error ? error.message : "No se pudo solicitar el envío",
      );
    }
  };

  return (
    <div className="shipment-home">
      <section className="shipment-hero">
        <div className="shipment-hero-icon"><PackageCheck size={23} /></div>
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
          <span className="shipment-live-chip"><LocateFixed size={13} /> Geocodificación real</span>
        </div>
        {savedAddresses.length > 0 && (
          <label>
            <span>Usar dirección guardada como origen</span>
            <select defaultValue="" onChange={(event) => chooseSavedPickup(event.target.value)}>
              <option value="">Elegir una dirección</option>
              {savedAddresses.map((address) => (
                <option value={address.id} key={address.id}>{address.label} · {address.address}</option>
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
              onClick={() => { setPackageSize(size); clearQuote(); }}
            >
              <PackageCheck size={16} />
              <strong>{size === "small" ? "Pequeño" : size === "medium" ? "Mediano" : "Grande"}</strong>
              <small>{size === "small" ? "Hasta 2 kg" : size === "medium" ? "Hasta 8 kg" : "Hasta 20 kg"}</small>
            </button>
          ))}
        </div>
        <div className="shipment-fields-grid">
          <label>
            <span>Categoría</span>
            <select value={itemCategory} disabled={optionsLoading} onChange={(event) => { setItemCategory(event.target.value as typeof itemCategory); clearQuote(); }}>
              {activeCategories.map((categoryOption) => <option value={categoryOption.code} key={categoryOption.code}>{categoryOption.name}</option>)}
            </select>
          </label>
          <label>
            <span>Nivel de servicio</span>
            <select value={serviceLevel} disabled={optionsLoading} onChange={(event) => { setServiceLevel(event.target.value as typeof serviceLevel); clearQuote(); }}>
              {activeServiceLevels.map((level) => <option value={level.code} key={level.code}>{level.name}</option>)}
            </select>
          </label>
          <label>
            <span>Peso en kg</span>
            <input type="number" min="0.1" max="20" step="0.1" value={weightKg} onChange={(event) => { setWeightKg(event.target.value); clearQuote(); }} />
          </label>
          <label>
            <span>Valor declarado</span>
            <input type="number" min="0" max="1000000" step="1" value={declaredValue} onChange={(event) => { setDeclaredValue(event.target.value); clearQuote(); }} />
          </label>
        </div>
        <div className="shipment-fields-grid">
          <label>
            <span>¿Qué enviás?</span>
            <input value={description} onChange={(event) => { setDescription(event.target.value); clearQuote(); }} maxLength={180} placeholder="Ej. Documentos, regalo, electrónica" />
          </label>
          <label>
            <span>Protección</span>
            <select value={protection} onChange={(event) => { setProtection(event.target.value as typeof protection); clearQuote(); }}>
              <option value="none">Sin protección adicional</option>
              <option value="standard">Protección estándar</option>
            </select>
          </label>
        </div>
        <label className="shipment-check-row">
          <input type="checkbox" checked={signatureRequired} onChange={(event) => { setSignatureRequired(event.target.checked); clearQuote(); }} />
          <span><strong>Solicitar firma del destinatario</strong><small>La entrega conservará firma y consentimiento cifrados.</small></span>
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
            <input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} autoComplete="name" placeholder="Nombre y apellido" />
          </label>
          <label>
            <span>Teléfono</span>
            <input value={recipientPhone} onChange={(event) => setRecipientPhone(event.target.value)} autoComplete="tel" placeholder="Código de área y número" />
          </label>
        </div>
        <label>
          <span>Indicaciones para el retiro o entrega <small>(opcional)</small></span>
          <textarea value={deliveryNotes} onChange={(event) => setDeliveryNotes(event.target.value)} maxLength={300} placeholder="Piso, horario o referencia útil" />
        </label>
        {selectedCategory?.handlingInstructions && (
          <p className="shipment-rule-note"><ShieldCheck size={15} /> {selectedCategory.handlingInstructions}</p>
        )}
        {optionsError && <p className="form-error"><TriangleAlert size={15} /> {optionsError}</p>}
        {quoteError && <p className="form-error"><TriangleAlert size={15} /> {quoteError}</p>}
        <button className="primary-button shipment-quote-button" type="button" onClick={() => void quoteShipment()} disabled={busy || quoteBusy || optionsLoading}>
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
            <span className="shipment-quote-eta"><Clock3 size={14} /> {quote.etaMin} min estimados</span>
          </div>
          <div className="shipment-quote-details">
            <span>{quote.distanceKm} km de recorrido</span>
            <span>{quote.itemCategoryName || selectedCategory?.name || "Categoría configurada"}</span>
            <span>{quote.serviceLevelName || selectedServiceLevel?.name || "SLA configurado"}</span>
            {quote.protectionPremium ? <span>Protección {money.format(quote.protectionPremium)}</span> : null}
          </div>
          <small>Vence {quote.expiresAt ? new Date(quote.expiresAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "en 5 minutos"}. Si cambiás un dato, deberás cotizar de nuevo.</small>
        </section>
      )}
      <section className="shipment-confirm-card">
        <div className="shipment-payment-row">
          <div><span className="muted-label">Medio de pago</span><strong>Flash Wallet</strong><small>Saldo disponible: {money.format(user?.wallet || 0)}</small></div>
          <WalletCards size={20} />
        </div>
        <label className="shipment-check-row terms">
          <input type="checkbox" checked={termsAccepted} onChange={(event) => { setTermsAccepted(event.target.checked); setSubmitError(null); }} />
          <span>Acepto las restricciones de artículos, los términos de entrega y el uso del PIN o firma para verificar la recepción.</span>
        </label>
        {submitError && <p className="form-error"><TriangleAlert size={15} /> {submitError}</p>}
        <button className="primary-button" type="button" onClick={() => void submitShipment()} disabled={busy || !quote?.quoteToken || quoteExpired || !termsAccepted}>
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
  const shipments = state.shipments.filter(
    (shipment) => shipment.customerId === user?.id,
  );
  const [trackingOrderId, setTrackingOrderId] = useState<string | null>(null);
  const [trackingRideId, setTrackingRideId] = useState<string | null>(null);
  const [trackingShipmentId, setTrackingShipmentId] = useState<string | null>(null);
  const trackingOrder = orders.find((order) => order.id === trackingOrderId) || null;
  const trackingRide = rides.find((ride) => ride.id === trackingRideId) || null;
  const trackingShipment =
    shipments.find((shipment) => shipment.id === trackingShipmentId) || null;
  return (
    <div className="activity-stack">
      <SectionTitle title="Pedidos" />
      {orders.map((order) => {
        const restaurant = state.restaurants.find(
          (entry) => entry.id === order.restaurantId,
        );
        const rated = state.ratings.some(
          (entry) =>
            entry.jobId === order.id && entry.subjectType === "merchant",
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
                    runAction(
                      () => api.setOrderStatus(order.id, "cancelled"),
                      "Pedido cancelado",
                    )
                : undefined
            }
            disabled={busy}
          />
        );
      })}
      <SectionTitle title="Viajes" />
      {rides.map((ride) => {
        const driver = state.drivers.find(
          (entry) => entry.id === ride.driverId,
        );
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
                ? () =>
                    runAction(
                      () => api.setRideStatus(ride.id, "cancelled"),
                      "Viaje cancelado",
                    )
                : undefined
            }
            disabled={busy}
          />
        );
      })}
      <SectionTitle title="Envíos" />
      {shipments.map((shipment) => {
        const driver = state.drivers.find(
          (entry) => entry.id === shipment.driverId,
        );
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
          driver={
            state.drivers.find(
              (driver) => driver.id === trackingOrder.courierId,
            ) || null
          }
          onClose={() => setTrackingOrderId(null)}
        />
      )}
      {trackingRide && (
        <RideTrackingSheet
          ride={trackingRide}
          driver={
            state.drivers.find((driver) => driver.id === trackingRide.driverId) ||
            null
          }
          onClose={() => setTrackingRideId(null)}
        />
      )}
      {trackingShipment && (
        <ShipmentTrackingSheet
          shipment={trackingShipment}
          driver={
            state.drivers.find(
              (driver) => driver.id === trackingShipment.driverId,
            ) || null
          }
          onClose={() => setTrackingShipmentId(null)}
        />
      )}
    </div>
  );
}

type ProjectedMapPoint = { x: number; y: number };

function buildWebTrackingMap(
  origin: GeoPoint,
  destination: GeoPoint,
  routeCoordinates: GeoPoint[] = [],
  driverPoint: GeoPoint | null = null,
) {
  const points = [origin, destination, ...routeCoordinates, ...(driverPoint ? [driverPoint] : [])];
  const world = (point: GeoPoint, zoom: number) => {
    const scale = 2 ** zoom;
    const latitude = Math.max(-85.0511, Math.min(85.0511, point.lat));
    const latitudeRadians = (latitude * Math.PI) / 180;
    return {
      x: ((point.lng + 180) / 360) * scale,
      y: ((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2) * scale,
    };
  };

  let zoom = 15;
  for (; zoom > 8; zoom -= 1) {
    const projected = points.map((point) => world(point, zoom));
    const xs = projected.map((point) => point.x);
    const ys = projected.map((point) => point.y);
    if (
      Math.max(...xs) - Math.min(...xs) <= 2.35 &&
      Math.max(...ys) - Math.min(...ys) <= 2.35
    )
      break;
  }

  const projected = points.map((point) => world(point, zoom));
  const centerX =
    (Math.min(...projected.map((point) => point.x)) +
      Math.max(...projected.map((point) => point.x))) /
    2;
  const centerY =
    (Math.min(...projected.map((point) => point.y)) +
      Math.max(...projected.map((point) => point.y))) /
    2;
  const baseX = Math.floor(centerX) - 1;
  const baseY = Math.floor(centerY) - 1;
  const project = (point: GeoPoint): ProjectedMapPoint => {
    const value = world(point, zoom);
    return { x: (value.x - baseX) * 100, y: (value.y - baseY) * 100 };
  };

  return {
    zoom,
    tiles: Array.from({ length: 9 }, (_, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const scale = 2 ** zoom;
      const tileX = ((baseX + column) % scale + scale) % scale;
      const tileY = Math.max(0, Math.min(scale - 1, baseY + row));
      return {
        key: `${zoom}-${tileX}-${tileY}`,
        uri: `https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`,
        column,
        row,
      };
    }),
    route: routeCoordinates.map((point) => project(point)),
    pickup: project(origin),
    dropoff: project(destination),
    driver: driverPoint ? project(driverPoint) : null,
  };
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
            error instanceof Error
              ? error.message
              : "La ruta vial no está disponible ahora.",
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

  const map =
    order.pickupLocation && order.deliveryLocation
      ? buildWebTrackingMap(
          order.pickupLocation,
          order.deliveryLocation,
          route?.coordinates || [],
          driver?.location || null,
        )
      : null;
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
        <button className="sheet-close" type="button" onClick={onClose} aria-label="Cerrar seguimiento">
          <X size={18} />
        </button>
        <div className="tracking-sheet-heading">
          <div>
            <span className="muted-label">Seguimiento en vivo</span>
            <h2 id="order-tracking-title">Pedido {order.id}</h2>
            <p>{orderStatusLabel[order.status]} · ETA publicada {order.etaMin} min</p>
          </div>
          <button className="tracking-share-button" type="button" onClick={() => void share()}>
            <Copy size={15} /> {shareLabel}
          </button>
        </div>
        {map ? (
          <div className="order-tracking-map" aria-label="Mapa de seguimiento del pedido">
            {map.tiles.map((tile) => (
              <img
                key={tile.key}
                className="order-map-tile"
                src={tile.uri}
                alt=""
                aria-hidden="true"
                style={{
                  left: `${tile.column * 33.333}%`,
                  top: `${tile.row * 33.333}%`,
                }}
              />
            ))}
            {map.route.length > 1 && (
              <svg className="order-map-route" viewBox="0 0 300 300" preserveAspectRatio="none" aria-hidden="true">
                <polyline
                  points={map.route.map((point) => `${point.x},${point.y}`).join(" ")}
                  fill="none"
                  stroke="rgba(255,255,255,.96)"
                  strokeWidth="11"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <polyline
                  points={map.route.map((point) => `${point.x},${point.y}`).join(" ")}
                  fill="none"
                  stroke="#f4511e"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            <span className="order-map-marker pickup" style={{ left: `${map.pickup.x / 3}%`, top: `${map.pickup.y / 3}%` }} title="Comercio">
              <Store size={14} />
            </span>
            <span className="order-map-marker dropoff" style={{ left: `${map.dropoff.x / 3}%`, top: `${map.dropoff.y / 3}%` }} title="Entrega">
              <Home size={14} />
            </span>
            {map.driver && (
              <span className="order-map-marker driver" style={{ left: `${map.driver.x / 3}%`, top: `${map.driver.y / 3}%` }} title="Repartidor">
                <Bike size={14} />
              </span>
            )}
            <div className="tracking-map-caption">
              <strong>
                {route
                  ? `${route.distanceKm} km · ${route.durationMin} min de recorrido`
                  : routeLoading
                    ? "Calculando ruta real…"
                    : routeError || "Ruta vial no disponible"}
              </strong>
              <span>{driver ? `${driver.name} · ${driver.vehicle}` : "Buscando repartidor disponible"}</span>
            </div>
            <small className="map-attribution">© OpenStreetMap contributors</small>
          </div>
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
                <span><strong>{driver.name}</strong><small>{driver.vehicle} · ★ {driver.rating.toFixed(1)}</small></span>
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
          La ubicación del repartidor aparece únicamente cuando el backend recibe una actualización válida. El timeline y la ETA siguen disponibles durante una degradación de mapas.
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
            error instanceof Error
              ? error.message
              : "La ruta vial no está disponible ahora.",
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

  const map =
    ride.pickupLocation && ride.destinationLocation
      ? buildWebTrackingMap(
          ride.pickupLocation,
          ride.destinationLocation,
          route?.coordinates || [],
          driver?.location || null,
        )
      : null;
  const currentIndex = Math.max(rideSteps.indexOf(ride.status), 0);
  const nextStep = route?.steps[0]?.instruction || null;

  const revealPickupCode = async () => {
    setPickupBusy(true);
    try {
      const response = await api.getRidePickupCode(ride.id);
      setPickupCode(response.pickupCode);
    } catch (error) {
      setShareNotice(
        error instanceof Error ? error.message : "No se pudo consultar el PIN.",
      );
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
        setShareNotice(
          error instanceof Error
            ? error.message
            : "No se pudo compartir el viaje.",
        );
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
        error instanceof Error
          ? error.message
          : "No se pudo registrar el incidente.",
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
        <button className="sheet-close" type="button" onClick={onClose} aria-label="Cerrar seguimiento">
          <X size={18} />
        </button>
        <div className="tracking-sheet-heading">
          <div>
            <span className="muted-label">Viaje en vivo</span>
            <h2 id="ride-tracking-title">{rideStatusLabel[ride.status]}</h2>
            <p>{ride.pickup} → {ride.destination} · {money.format(ride.fare)}</p>
          </div>
          <span className="ride-service-badge"><Car size={14} /> {ride.service}</span>
        </div>
        {map ? (
          <div className="order-tracking-map" aria-label="Mapa de seguimiento del viaje">
            {map.tiles.map((tile) => (
              <img
                key={tile.key}
                className="order-map-tile"
                src={tile.uri}
                alt=""
                aria-hidden="true"
                style={{
                  left: `${tile.column * 33.333}%`,
                  top: `${tile.row * 33.333}%`,
                }}
              />
            ))}
            {map.route.length > 1 && (
              <svg className="order-map-route" viewBox="0 0 300 300" preserveAspectRatio="none" aria-hidden="true">
                <polyline
                  points={map.route.map((point) => `${point.x},${point.y}`).join(" ")}
                  fill="none"
                  stroke="rgba(255,255,255,.96)"
                  strokeWidth="11"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <polyline
                  points={map.route.map((point) => `${point.x},${point.y}`).join(" ")}
                  fill="none"
                  stroke="#7c3cff"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            <span className="order-map-marker pickup" style={{ left: `${map.pickup.x / 3}%`, top: `${map.pickup.y / 3}%` }} title="Origen">
              <MapPin size={14} />
            </span>
            <span className="order-map-marker dropoff" style={{ left: `${map.dropoff.x / 3}%`, top: `${map.dropoff.y / 3}%` }} title="Destino">
              <Home size={14} />
            </span>
            {map.driver && (
              <span className="order-map-marker driver ride-driver-marker" style={{ left: `${map.driver.x / 3}%`, top: `${map.driver.y / 3}%` }} title="Conductor">
                <Car size={14} />
              </span>
            )}
            <div className="tracking-map-caption">
              <strong>
                {route
                  ? `${route.distanceKm} km · ${route.durationMin} min de recorrido`
                  : routeLoading
                    ? "Calculando ruta real…"
                    : routeError || "Ruta vial no disponible"}
              </strong>
              <span>{driver ? `${driver.name} · ${driver.vehicle} · ${driver.plate}` : "Buscando un conductor disponible"}</span>
            </div>
            <small className="map-attribution">© OpenStreetMap contributors</small>
          </div>
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
                <span><strong>{driver.name}</strong><small>{driver.vehicle} · {driver.plate} · ★ {driver.rating.toFixed(1)}</small></span>
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
            <span className="safety-icon"><ShieldCheck size={18} /></span>
            <div><strong>Centro de seguridad</strong><small>Acciones vinculadas a este viaje</small></div>
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
          {trackingUrl && <a className="tracking-link-preview" href={trackingUrl} target="_blank" rel="noreferrer">Abrir enlace temporal</a>}
          {safetyNotice && <small className="tracking-action-notice safety-notice">{safetyNotice}</small>}
          {safetyOpen && (
            <form className="ride-safety-form" onSubmit={(event) => void submitSafetyIncident(event)}>
              <label>
                <span>Tipo de incidente</span>
                <select value={safetyType} onChange={(event) => setSafetyType(event.target.value as typeof safetyType)}>
                  {rideSafetyOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
              </label>
              <label>
                <span>Detalle opcional</span>
                <textarea value={safetyDetails} onChange={(event) => setSafetyDetails(event.target.value)} maxLength={1000} placeholder="Contanos qué ocurrió" />
              </label>
              <button className="danger-button" type="submit" disabled={safetyBusy}>
                <TriangleAlert size={15} /> {safetyBusy ? "Registrando…" : "Enviar a Seguridad Flash"}
              </button>
            </form>
          )}
        </section>
        <p className="tracking-integrity-note">
          La ubicación y los estados provienen del backend autenticado. Si una señal o el proveedor de mapas falla, Flash conserva el viaje y sus acciones de seguridad sin inventar movimiento.
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
            error instanceof Error
              ? error.message
              : "La ruta vial no está disponible ahora.",
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

  const map =
    shipment.pickupLocation && shipment.destinationLocation
      ? buildWebTrackingMap(
          shipment.pickupLocation,
          shipment.destinationLocation,
          route?.coordinates || [],
          driver?.location || null,
        )
      : null;
  const currentIndex = Math.max(shipmentSteps.indexOf(shipment.status), 0);
  const nextStep = route?.steps[0]?.instruction || null;
  const proofCount = Math.max(
    evidence.length,
    shipment.deliveryEvidenceCount || 0,
  );

  const revealDeliveryCode = async () => {
    setCodeBusy(true);
    setActionNotice(null);
    try {
      const response = await api.getShipmentDeliveryCode(shipment.id);
      setDeliveryCode(response.deliveryCode);
    } catch (error) {
      setActionNotice(
        error instanceof Error
          ? error.message
          : "No se pudo consultar el PIN de entrega.",
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
            <h2 id="shipment-tracking-title">
              {shipmentStatusLabel[shipment.status]}
            </h2>
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
        {map ? (
          <div className="order-tracking-map" aria-label="Mapa de seguimiento del envío">
            {map.tiles.map((tile) => (
              <img
                key={tile.key}
                className="order-map-tile"
                src={tile.uri}
                alt=""
                aria-hidden="true"
                style={{
                  left: `${tile.column * 33.333}%`,
                  top: `${tile.row * 33.333}%`,
                }}
              />
            ))}
            {map.route.length > 1 && (
              <svg
                className="order-map-route"
                viewBox="0 0 300 300"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <polyline
                  points={map.route.map((point) => `${point.x},${point.y}`).join(" ")}
                  fill="none"
                  stroke="rgba(255,255,255,.96)"
                  strokeWidth="11"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <polyline
                  points={map.route.map((point) => `${point.x},${point.y}`).join(" ")}
                  fill="none"
                  stroke="#087a50"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            <span
              className="order-map-marker pickup"
              style={{ left: `${map.pickup.x / 3}%`, top: `${map.pickup.y / 3}%` }}
              title="Origen"
            >
              <Store size={14} />
            </span>
            <span
              className="order-map-marker dropoff"
              style={{ left: `${map.dropoff.x / 3}%`, top: `${map.dropoff.y / 3}%` }}
              title="Destino"
            >
              <Home size={14} />
            </span>
            {map.driver && (
              <span
                className="order-map-marker driver shipment-driver-marker"
                style={{ left: `${map.driver.x / 3}%`, top: `${map.driver.y / 3}%` }}
                title="Repartidor"
              >
                <Truck size={14} />
              </span>
            )}
            <div className="tracking-map-caption">
              <strong>
                {route
                  ? `${route.distanceKm} km · ${route.durationMin} min de recorrido`
                  : routeLoading
                    ? "Calculando ruta real…"
                    : routeError || "Ruta vial no disponible"}
              </strong>
              <span>
                {driver
                  ? `${driver.name} · ${driver.vehicle}`
                  : "Buscando un repartidor disponible"}
              </span>
            </div>
            <small className="map-attribution">© OpenStreetMap contributors</small>
          </div>
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
                  <small>{driver.vehicle} · ★ {driver.rating.toFixed(1)}</small>
                </span>
              </div>
            )}
          </div>
          <div className="stepper tracking-stepper shipment-tracking-stepper">
            {shipmentSteps.map((step, index) => (
              <div
                className={index <= currentIndex ? "step active" : "step"}
                key={step}
              >
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
              {shipment.packageSize} · {shipment.weightKg} kg · {shipment.itemCategory || "standard"}
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
            <small>{money.format(shipment.fare)} · {shipment.distanceKm} km</small>
          </div>
        </section>
        {driver && ["driver_assigned", "arriving", "picked_up", "delivering"].includes(shipment.status) && (
          <section className="ride-pin-card shipment-pin-card">
            <div>
              <span className="muted-label">PIN de entrega</span>
              <strong>{deliveryCode || "••••"}</strong>
              <small>Compartilo únicamente con quien recibe el paquete al momento de la entrega.</small>
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
          La ruta, el estado, el ETA, la ubicación del repartidor y la prueba de entrega provienen del backend autenticado. Si falta una señal o el proveedor de mapas falla, Flash conserva el estado operativo sin inventar movimiento.
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
              !Number.isInteger(parsedAmount) ||
              parsedAmount < 1000 ||
              parsedAmount > 200000
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
        <small>
          Las cargas y consumos quedan auditados en la cuenta autenticada.
        </small>
      </section>
      {transactions.slice(0, 5).map((transaction) => (
        <article className="promo-row" key={transaction.id}>
          <WalletCards size={18} />
          <div>
            <strong>{transaction.description}</strong>
            <span>
              {new Date(transaction.createdAt).toLocaleString("es-AR")}
            </span>
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
  onSave: (payload: {
    name: string;
    phone: string;
    defaultAddress: string;
  }) => void;
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
  dietaryPreferences:DietaryPreferences|null;
  onDietaryPreferencesChange:(preferences:DietaryPreferences)=>void;
}) {
  const [name, setName] = useState(user?.name || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [defaultAddress, setDefaultAddress] = useState(
    address || user?.defaultAddress || "",
  );
  const [dietary,setDietary]=useState<DietaryPreferences|null>(dietaryPreferences),[dietaryBusy,setDietaryBusy]=useState(false),[dietaryError,setDietaryError]=useState("");
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
  useEffect(()=>setDietary(dietaryPreferences),[dietaryPreferences]);
  const toggleDiet=(code:string)=>setDietary(current=>current?{...current,dietaryLabels:current.dietaryLabels.some(item=>item.code===code)?current.dietaryLabels.filter(item=>item.code!==code):[...current.dietaryLabels,{code,name:dietOptions.find(item=>item.code===code)?.name||code}]}:current);
  const toggleAllergen=(code:string)=>setDietary(current=>current?{...current,avoidedAllergens:current.avoidedAllergens.some(item=>item.code===code)?current.avoidedAllergens.filter(item=>item.code!==code):[...current.avoidedAllergens,{code,name:allergenOptions.find(item=>item.code===code)?.name||code}]}:current);
  const saveDietary=async()=>{if(!dietary)return;setDietaryBusy(true);setDietaryError("");try{const result=await api.updateDietaryPreferences({dietaryLabels:dietary.dietaryLabels.map(item=>item.code),avoidedAllergens:dietary.avoidedAllergens.map(item=>item.code),hideIncompatible:dietary.hideIncompatible});setDietary(result.preferences);onDietaryPreferencesChange(result.preferences);}catch(error){setDietaryError(error instanceof Error?error.message:"No se pudieron guardar tus preferencias");}finally{setDietaryBusy(false);}};
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
        setAddressStatus("No pudimos acceder al GPS. Activa el permiso o escribe la direccion y usa otro dispositivo con ubicacion.");
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
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </label>
        <label className="settings-row">
          <MessageCircle size={18} />
          <div>
            <strong>Telefono</strong>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
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
            <p>Guarda destinos frecuentes y usa coordenadas reales para entregar o pedir un viaje.</p>
          </div>
          <MapPin size={22} />
        </div>
        {addresses.length > 0 ? (
          <div className="saved-address-list">
            {addresses.map((entry) => (
              <article className="saved-address-row" key={entry.id}>
                <span className={entry.isDefault ? "saved-address-icon default" : "saved-address-icon"}>
                  {entry.label.toLowerCase().includes("trab") ? <Store size={17} /> : <Home size={17} />}
                </span>
                <div className="saved-address-copy">
                  <div>
                    <strong>{entry.label}</strong>
                    {entry.isDefault && <span className="default-address-badge">Predeterminada</span>}
                  </div>
                  <span>{entry.address}</span>
                  <small>{entry.lat !== null && entry.lng !== null ? "Ubicacion verificada" : "Sin coordenadas"}</small>
                </div>
                <div className="saved-address-actions">
                  {!entry.isDefault && (
                    <button type="button" className="icon-button" title="Usar como predeterminada" aria-label={`Usar ${entry.label} como predeterminada`} onClick={() => void onSetDefaultAddress(entry.id)}>
                      <Check size={15} />
                    </button>
                  )}
                  <button type="button" className="icon-button" title="Editar direccion" aria-label={`Editar ${entry.label}`} onClick={() => editAddress(entry)}>
                    <Settings size={15} />
                  </button>
                  <button type="button" className="icon-button danger" title="Eliminar direccion" aria-label={`Eliminar ${entry.label}`} onClick={() => void onDeleteAddress(entry.id)}>
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
            {editingAddressId && <button type="button" className="text-button" onClick={resetAddressDraft}>Cancelar</button>}
          </div>
          <div className="address-form-grid">
            <label>
              <span>Etiqueta</span>
              <select value={addressDraft.label} onChange={(event) => setAddressDraft((current) => ({ ...current, label: event.target.value }))}>
                <option>Casa</option>
                <option>Trabajo</option>
                <option>Otro</option>
              </select>
            </label>
            <label className="address-form-wide">
              <span>Direccion</span>
              <input value={addressDraft.address} onChange={(event) => setAddressDraft((current) => ({ ...current, address: event.target.value }))} placeholder="Ej. Av. Corrientes 1234" />
            </label>
          </div>
          <button type="button" className="location-action" onClick={locateAddress}>
            <LocateFixed size={15} /> Usar mi ubicacion actual
          </button>
          {addressStatus && <small className={`location-message ${addressStatusTone}`}>{addressStatus}</small>}
          <label className="address-default-toggle">
            <input type="checkbox" checked={addressDraft.isDefault} onChange={(event) => setAddressDraft((current) => ({ ...current, isDefault: event.target.checked }))} />
            <span>Usar para próximos pedidos y viajes</span>
          </label>
          <button type="submit" className="secondary-button" disabled={!addressDraft.address.trim() || addressDraft.lat === null || addressDraft.lng === null}>
            <MapPin size={16} /> {editingAddressId ? "Actualizar direccion" : "Guardar direccion"}
          </button>
        </form>
      </section>
      <section className="dietary-profile-card" aria-labelledby="dietary-profile-title">
        <div className="dietary-profile-heading"><span><Leaf size={19}/></span><div><h3 id="dietary-profile-title">Mi alimentación</h3><p>Personalizá el catálogo usando declaraciones verificables del comercio.</p></div></div>
        {!dietary&&!dietaryError&&<p className="dietary-loading" role="status"><RefreshCw size={15}/> Cargando preferencias…</p>}
        {dietary&&<><strong>Apto para</strong><div className="dietary-chip-list">{dietOptions.map(option=>{const selected=dietary.dietaryLabels.some(item=>item.code===option.code);return <button type="button" key={option.code} className={selected?"dietary-chip selected":"dietary-chip"} aria-pressed={selected} onClick={()=>toggleDiet(option.code)}>{option.name}</button>;})}</div><strong>Evito estos alérgenos</strong><div className="dietary-chip-list">{allergenOptions.map(option=>{const selected=dietary.avoidedAllergens.some(item=>item.code===option.code);return <button type="button" key={option.code} className={selected?"dietary-chip allergen selected":"dietary-chip allergen"} aria-pressed={selected} onClick={()=>toggleAllergen(option.code)}>{option.name}</button>;})}</div><button type="button" className="dietary-filter-toggle" role="switch" aria-checked={dietary.hideIncompatible} onClick={()=>setDietary(current=>current?{...current,hideIncompatible:!current.hideIncompatible}:current)}><span><strong>Ocultar incompatibles</strong><small>“Sin datos” nunca significa que un producto sea seguro.</small></span><i aria-hidden="true" className={dietary.hideIncompatible?"active":""}/></button><div className="dietary-caution"><TriangleAlert size={17}/><span>Ante una alergia severa, confirmá con el comercio. Las indicaciones no eliminan contaminación cruzada.</span></div><button type="button" className="secondary-button" disabled={dietaryBusy} onClick={()=>void saveDietary()}>{dietaryBusy?"Guardando…":"Guardar preferencias alimentarias"}</button></>}
        {dietaryError&&<p className="form-error" role="alert">{dietaryError}</p>}
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
  dietaryPreferences:DietaryPreferences|null;
  cartCount: number;
  onBack: () => void;
  onOpenCart: () => void;
  onOpenItem: (item: MenuItem) => void;
}) {
  const [category, setCategory] = useState("Todo");
  const categories = [
    "Todo",
    ...Array.from(new Set(restaurant.menu.map((item) => item.category))),
  ];
  const menu = restaurant.menu.filter(
    (item) => (category === "Todo" || item.category === category)&&(!dietaryPreferences?.hideIncompatible||itemMatchesDietary(item,dietaryPreferences)),
  );
  return (
    <div className="screen detail-screen">
      <div className="restaurant-cover">
        <img src={restaurant.cover} alt={restaurant.name} />
        <div className="detail-topbar">
          <IconButton icon={ArrowLeft} label="Volver" onClick={onBack} />
          <IconButton
            icon={ShoppingBag}
            label="Carrito"
            badge={cartCount}
            onClick={onOpenCart}
          />
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
      <CategoryRail
        categories={categories}
        category={category}
        setCategory={setCategory}
      />
      {dietaryPreferences?.hideIncompatible&&<div className="dietary-filter-banner"><Leaf size={16}/><span>Filtro alimentario activo · sólo productos con declaraciones compatibles.</span></div>}
      <div className="item-list">
        {menu.map((item) => (
          <FoodRow
            key={item.id}
            item={item}
            restaurant={restaurant}
            onClick={() => onOpenItem(item)}
          />
        ))}
        {!menu.length&&<EmptyState icon={Search} title="Sin coincidencias declaradas" text="Probá otra categoría o revisá tu filtro alimentario en Perfil."/>}
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
  onCreateOrder: (providerPayment?:{cardToken:string;paymentMethodId:string;installments:number}) => Promise<void>;
  customerEmail:string;
  busy: boolean;
}) {
  const[paymentMode,setPaymentMode]=useState<"wallet"|"mercadopago">("wallet"),[paymentConfiguration,setPaymentConfiguration]=useState<{provider:"mercadopago"|"disabled";publicKey:string|null;merchantReady:boolean}|null>(null),[paymentConfigurationError,setPaymentConfigurationError]=useState("");
  useEffect(()=>{if(!checkoutOpen||!restaurant){setPaymentMode("wallet");setPaymentConfiguration(null);return;}let active=true;setPaymentConfigurationError("");api.getPaymentClientConfiguration(restaurant.id).then(configuration=>{if(active)setPaymentConfiguration(configuration);}).catch(error=>{if(active)setPaymentConfigurationError(error instanceof Error?error.message:"No se pudo consultar Mercado Pago");});return()=>{active=false};},[checkoutOpen,restaurant]);
  const mercadoPagoReady=paymentConfiguration?.provider==="mercadopago"&&paymentConfiguration.merchantReady&&Boolean(paymentConfiguration.publicKey);
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
                {restaurant?.etaMin} min · envio{" "}
                {money.format(restaurant?.deliveryFee || 0)}
              </span>
            </div>
          </div>
          <div className="cart-items">
            {cart.map((line, index) => (
              <div className="cart-row" key={`${line.item.id}-${index}`}>
                <img src={line.item.image} alt={line.item.name} />
                <div>
                  <strong>{line.item.name}</strong>
                  <span>
                    {line.extras.length
                      ? `${line.extras.length} extras`
                      : "Sin extras"}
                  </span>
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
                            lineIndex === index
                              ? { ...entry, quantity }
                              : entry,
                          ),
                    )
                  }
                />
              </div>
            ))}
          </div>
          {checkoutOpen && (
            <section className="checkout-card">
              <div className="checkout-line">
                <MapPin size={18} />
                <div>
                  <strong>Casa</strong>
                  <span>Defensa 982, San Telmo</span>
                </div>
                <ChevronRight size={17} />
              </div>
              <div className="payment-choice" role="radiogroup" aria-label="Método de pago">
                <button type="button" role="radio" aria-checked={paymentMode==="wallet"} className={paymentMode==="wallet"?"active":""} onClick={()=>setPaymentMode("wallet")}><WalletCards size={18}/><span><strong>Flash Wallet</strong><small>Saldo disponible al instante</small></span></button>
                <button type="button" role="radio" aria-checked={paymentMode==="mercadopago"} className={paymentMode==="mercadopago"?"active":""} disabled={!mercadoPagoReady} onClick={()=>setPaymentMode("mercadopago")}><CreditCard size={18}/><span><strong>Tarjeta</strong><small>{mercadoPagoReady?"Tokenización segura con Mercado Pago":paymentConfiguration?"No disponible para este comercio":"Consultando disponibilidad…"}</small></span></button>
              </div>
              {paymentConfigurationError&&<small className="payment-provider-error">{paymentConfigurationError}</small>}
              {paymentMode==="mercadopago"&&mercadoPagoReady&&paymentConfiguration?.publicKey&&<MercadoPagoCardCheckout publicKey={paymentConfiguration.publicKey} amount={totals.total} email={customerEmail} busy={busy} onSubmit={onCreateOrder} onError={setPaymentConfigurationError}/>}
              <label className="checkout-line">
                <TicketPercent size={18} />
                <div>
                  <strong>Código promocional</strong>
                  <input
                    aria-label="Código promocional"
                    list="food-promotions"
                    placeholder="Ej. FLASH40"
                    value={promotionCode}
                    onChange={(event) =>
                      setPromotionCode(event.target.value.toUpperCase())
                    }
                  />
                  <datalist id="food-promotions">
                    {promotions
                      .filter(
                        (entry) =>
                          entry.service === "food" &&
                          entry.active &&
                          entry.code,
                      )
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
          <SummaryBlock totals={totals} />
          {paymentMode==="wallet"&&<button
            className="primary-button sticky-action"
            type="button"
            onClick={() =>
              checkoutOpen ? void onCreateOrder() : setCheckoutOpen(true)
            }
            disabled={busy}
          >
            <ReceiptText size={17} />
            {checkoutOpen ? "Confirmar pedido" : "Ir a pagar"}
          </button>}
          {paymentMode==="mercadopago"&&!checkoutOpen&&<button className="primary-button sticky-action" type="button" onClick={()=>setCheckoutOpen(true)}><ReceiptText size={17}/>Ir a pagar</button>}
        </>
      )}
    </div>
  );
}

type ProviderPaymentInput={cardToken:string;paymentMethodId:string;installments:number};
type CardBrickForm={token:string;payment_method_id:string;installments:number;transaction_amount:number};
type CardBrickProps={initialization:{amount:number;payer:{email:string}};customization:{paymentMethods:{maxInstallments:number;types:{included:Array<"credit_card"|"debit_card"|"prepaid_card">}};visual:{style:{theme:string}}};locale:"es-AR";onSubmit:(form:CardBrickForm)=>Promise<void>;onReady:()=>void;onError:(error:unknown)=>void};

function MercadoPagoCardCheckout({publicKey,amount,email,busy,onSubmit,onError}:{publicKey:string;amount:number;email:string;busy:boolean;onSubmit:(payment:ProviderPaymentInput)=>Promise<void>;onError:(message:string)=>void}){
  const[CardBrick,setCardBrick]=useState<ComponentType<CardBrickProps>|null>(null);
  useEffect(()=>{let active=true;import("@mercadopago/sdk-react").then(sdk=>{if(!active)return;sdk.initMercadoPago(publicKey,{locale:"es-AR"});setCardBrick(()=>sdk.CardPayment as unknown as ComponentType<CardBrickProps>);}).catch(()=>{if(active)onError("No se pudo cargar el formulario seguro de Mercado Pago")});return()=>{active=false};},[onError,publicKey]);
  if(!CardBrick)return<div className="payment-brick-loading"><RefreshCw size={16}/>Cargando formulario seguro…</div>;
  return <div className={busy?"payment-brick busy":"payment-brick"}><CardBrick initialization={{amount,payer:{email}}} customization={{paymentMethods:{maxInstallments:12,types:{included:["credit_card","debit_card","prepaid_card"]}},visual:{style:{theme:"default"}}}} locale="es-AR" onReady={()=>onError("")} onError={()=>onError("Mercado Pago no pudo preparar el formulario")} onSubmit={async form=>{if(busy)throw new Error("El pago ya se está procesando");if(Math.abs(Number(form.transaction_amount)-amount)>.01)throw new Error("El total del formulario cambió; revisá el pedido");await onSubmit({cardToken:form.token,paymentMethodId:form.payment_method_id,installments:Number(form.installments)||1});}}/></div>;
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
  const orders = state.orders.filter(
    (order) => order.restaurantId === restaurant.id,
  );
  const activeOrders = orders.filter(
    (order) => !["delivered", "cancelled"].includes(order.status),
  );
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
          <span>
            Ajusta ETA en vivo para proteger SLA y evitar cancelaciones.
          </span>
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
            onAdvance={() =>
              runAction(() => api.advanceOrder(order.id), "Pedido avanzado")
            }
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
                  () =>
                    api.updateMenuStock(
                      restaurant.id,
                      item.id,
                      event.target.checked,
                    ),
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
          onChange={(event) =>
            setNewDish((current) => ({ ...current, name: event.target.value }))
          }
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
            runAction(
              () => api.addMenuItem(restaurant.id, newDish),
              "Producto creado",
            )
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
  const [gpsStatus, setGpsStatus] = useState<
    "idle" | "locating" | "live" | "denied"
  >("idle");
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
    (order) =>
      order.courierId === driver.id &&
      !["delivered", "cancelled"].includes(order.status),
  );
  const activeRides = state.rides.filter(
    (ride) =>
      ride.driverId === driver.id &&
      !["completed", "cancelled"].includes(ride.status),
  );
  const hotZone =
    state.zones.find((zone) => zone.demandLevel === "high") || state.zones[0];
  const visibleOffers = offers.filter((offer) =>
    driver.activeService === "ride"
      ? offer.kind === "ride"
      : offer.kind === "delivery",
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
          <small>
            {driver.online
              ? "Recibiendo viajes y deliveries"
              : "Fuera de linea"}
          </small>
        </span>
        <input
          checked={driver.online}
          onChange={(event) =>
            runAction(
              () =>
                api.updateDriver(driver.id, { online: event.target.checked }),
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
            {mode === "delivery" ? (
              <ShoppingBag size={16} />
            ) : (
              <Car size={16} />
            )}
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

      <SectionTitle
        title="Activos"
        action={money.format(driver.earningsToday)}
      />
      <div className="activity-stack">
        {activeOrders.map((order) => (
          <OrderOpsCard
            key={order.id}
            order={order}
            restaurant={state.restaurants.find(
              (entry) => entry.id === order.restaurantId,
            )}
            driver={driver}
            onAdvance={() =>
              runAction(() => api.advanceOrder(order.id), "Delivery avanzado")
            }
            busy={busy}
          />
        ))}
        {activeRides.map((ride) => (
          <RideOpsCard
            key={ride.id}
            ride={ride}
            driver={driver}
            onAdvance={() =>
              runAction(() => api.advanceRide(ride.id), "Viaje avanzado")
            }
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
              await runAction(
                () => api.rejectDriverOffer(offer.id),
                "Oferta rechazada",
              );
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
        <MetricCard
          label="Pedidos"
          value={state.metrics.activeOrders}
          tone="orange"
        />
        <MetricCard
          label="Viajes"
          value={state.metrics.activeRides}
          tone="teal"
        />
        <MetricCard
          label="Drivers"
          value={state.metrics.onlineDrivers}
          tone="green"
        />
        <MetricCard
          label="Tickets"
          value={state.metrics.openTickets}
          tone="dark"
        />
      </div>
      <OpsRiskBoard state={state} />
      <section className="control-map">
        {state.zones.slice(0, 3).map((zone, index) => (
          <div
            className={`zone zone-${["one", "two", "three"][index]}`}
            key={zone.id}
          >
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
            restaurant={state.restaurants.find(
              (entry) => entry.id === order.restaurantId,
            )}
            driver={state.drivers.find((entry) => entry.id === order.courierId)}
            onAdvance={() =>
              runAction(() => api.advanceOrder(order.id), "Pedido avanzado")
            }
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
            onAdvance={() =>
              runAction(() => api.advanceRide(ride.id), "Viaje avanzado")
            }
            busy={busy}
          />
        ))}
      </div>
    </div>
  );
}

function OpsRiskBoard({ state }: { state: AppState }) {
  const unassignedOrders = state.orders.filter(
    (order) =>
      !order.courierId && !["delivered", "cancelled"].includes(order.status),
  ).length;
  const unassignedRides = state.rides.filter(
    (ride) =>
      !ride.driverId && !["completed", "cancelled"].includes(ride.status),
  ).length;
  const risks = [
    ["Backlog", unassignedOrders + unassignedRides, "Asignaciones pendientes"],
    ["Supply", state.metrics.onlineDrivers, "Drivers online"],
    [
      "SLA",
      state.metrics.avgOrderEta + state.metrics.avgRideEta,
      "Minutos combinados",
    ],
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
  const activeRide = state.rides.find(
    (ride) => !["completed", "cancelled"].includes(ride.status),
  );
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
            <p>
              {cartCount
                ? money.format(cartTotal)
                : "Listo para pedir comida o taxi"}
            </p>
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
              {
                state.orders.filter(
                  (order) => order.restaurantId === merchantRestaurantId,
                ).length
              }{" "}
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
            <Metric
              label="Tickets"
              value={String(state.metrics.openTickets)}
              trend="soporte"
            />
          </div>
          {state.supportTickets.map((ticket) => (
            <article className="ops-card" key={ticket.id}>
              <span>
                {ticket.priority} ·{" "}
                {ticket.slaStatus === "on_track"
                  ? "en SLA"
                  : ticket.slaStatus.replaceAll("_", " ")}
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

function PanelHeader({
  title,
  icon: Icon,
}: {
  title: string;
  icon: LucideIcon;
}) {
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

function SearchBar({
  query,
  setQuery,
}: {
  query: string;
  setQuery: (query: string) => void;
}) {
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
          className={
            category === entry ? "category-pill active" : "category-pill"
          }
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
            <ShoppingBag size={17} /> Agregar{" "}
            {money.format((item.price + extrasTotal) * quantity)}
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
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        aria-label="Sumar"
        title="Sumar"
      >
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

function TrackingCard<TStatus extends string>({
  title,
  subtitle,
  amount,
  person,
  steps,
  currentStatus,
  labels,
}: {
  title: string;
  subtitle: string;
  amount: number;
  person: string;
  steps: TStatus[];
  currentStatus: TStatus;
  labels: Record<TStatus, string>;
}) {
  const currentIndex = steps.indexOf(currentStatus);
  return (
    <section className="tracking-card">
      <div>
        <span className="muted-label">Tracking</span>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="courier-card">
        <div className="avatar">{initials(person)}</div>
        <div>
          <strong>{person}</strong>
          <span>{money.format(amount)}</span>
        </div>
        <IconButton icon={MessageCircle} label="Chat" />
      </div>
      <div className="stepper">
        {steps.map((step, index) => (
          <div
            className={index <= currentIndex ? "step active" : "step"}
            key={step}
          >
            <span>
              {index < currentIndex ? <Check size={12} /> : index + 1}
            </span>
            <small>{labels[step]}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function OrderOpsCard({
  order,
  restaurant,
  driver,
  onAdvance,
  busy,
}: {
  order: Order;
  restaurant?: Restaurant;
  driver?: Driver;
  onAdvance: () => void;
  busy: boolean;
}) {
  const canAdvance = !["ready_for_pickup", "delivered", "cancelled"].includes(
    order.status,
  );
  return (
    <article className="work-card">
      <div className="work-card-top">
        <span>{order.id}</span>
        <strong>{orderStatusLabel[order.status]}</strong>
      </div>
      <h3>{restaurant?.name || "Restaurante"}</h3>
      <p>
        {order.items.map((item) => `${item.quantity} ${item.name}`).join(", ")}
      </p>
      <div className="work-meta">
        <span>{money.format(order.total)}</span>
        <span>{driver?.name || "Sin repartidor"}</span>
      </div>
      {canAdvance && (
        <button type="button" onClick={onAdvance} disabled={busy}>
          <PackageCheck size={15} /> Avanzar
        </button>
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
  const canAdvance = !["requested", "completed", "cancelled"].includes(
    ride.status,
  );
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
          <button
            className="secondary"
            type="button"
            onClick={onSecondaryAction}
            disabled={busy}
          >
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

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function MiniOrder({ state, order }: { state: AppState; order: Order }) {
  const restaurant = state.restaurants.find(
    (entry) => entry.id === order.restaurantId,
  );
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
        <strong>
          {mfaChallenge ? "Verificación administrativa" : "Ingresar a Flash"}
        </strong>
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

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export { PublicRideTrackingPage };

export default App;
