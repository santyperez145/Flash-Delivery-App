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
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Star,
  Store,
  TicketPercent,
  Truck,
  UserRound,
  WalletCards,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, subscribeToEvents } from "./api";
import type {
  AppState,
  AdminDashboard,
  CartLine,
  CustomerTab,
  Driver,
  GeoPoint,
  MenuItem,
  Mode,
  Order,
  OrderStatus,
  Restaurant,
  Ride,
  RideQuote,
  RideStatus,
  RealtimeEvent,
  RideForm,
  Service,
  User
} from "./types";

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0
});

const demoAccountByMode: Record<Mode, string> = {
  customer: "cliente@flash.app",
  merchant: "comercio@flash.app",
  driver: "conductor@flash.app",
  ops: "ops@flash.app"
};

const userIdByMode: Record<Mode, string> = {
  customer: "usr_customer",
  merchant: "usr_merchant",
  driver: "usr_driver",
  ops: "usr_admin"
};

const orderStatusLabel: Record<OrderStatus, string> = {
  accepted: "Aceptado",
  preparing: "Preparando",
  ready_for_pickup: "Listo para retirar",
  courier_assigned: "Repartidor asignado",
  picked_up: "Retirado",
  delivering: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado"
};

const rideStatusLabel: Record<RideStatus, string> = {
  requested: "Buscando conductor",
  driver_assigned: "Conductor asignado",
  arriving: "Llegando",
  in_progress: "En viaje",
  completed: "Completado",
  cancelled: "Cancelado"
};

const orderSteps: OrderStatus[] = [
  "accepted",
  "preparing",
  "ready_for_pickup",
  "courier_assigned",
  "picked_up",
  "delivering",
  "delivered"
];

const rideSteps: RideStatus[] = [
  "requested",
  "driver_assigned",
  "arriving",
  "in_progress",
  "completed"
];

const rideServices: Array<{ id: Ride["service"]; label: string; icon: LucideIcon }> = [
  { id: "economy", label: "Flash", icon: Car },
  { id: "comfort", label: "Comfort", icon: Sparkles },
  { id: "moto", label: "Moto", icon: Bike },
  { id: "xl", label: "XL", icon: Truck }
];

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
  const [itemDraft, setItemDraft] = useState<{ restaurant: Restaurant; item: MenuItem } | null>(null);
  const [itemQuantity, setItemQuantity] = useState(1);
  const [draftExtras, setDraftExtras] = useState<string[]>([]);
  const [draftNote, setDraftNote] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [rideForm, setRideForm] = useState<RideForm>({
    pickup: "Defensa 982, San Telmo",
    destination: "Aeroparque Jorge Newbery",
    service: "economy" as Ride["service"],
    pickupCoords: { lat: -34.6177, lng: -58.3621 },
    destinationCoords: { lat: -34.5596, lng: -58.4156 }
  });
  const [quote, setQuote] = useState<RideQuote | null>(null);
  const [locationStatus, setLocationStatus] = useState<"idle" | "locating" | "ready" | "denied">("idle");
  const [locationMessage, setLocationMessage] = useState("");
  const [newDish, setNewDish] = useState({
    name: "Menu ejecutivo",
    description: "Principal, bebida y postre del dia.",
    category: "Especiales",
    price: 6900
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<"connecting" | "live" | "reconnecting" | "offline">("offline");
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(min-width: 900px)").matches
  );

  const refresh = useCallback(async () => {
    const response = await api.state();
    setState(response.state);
    if (isDesktop) {
      try {
        const dashboardResponse = await api.adminDashboard();
        setAdminDashboard(dashboardResponse.dashboard);
      } catch (_requestError) {
        setAdminDashboard(null);
      }
    } else {
      setAdminDashboard(null);
    }
  }, [isDesktop]);

  const bootstrapSession = useCallback(async () => {
    const activeMode = isDesktop ? "ops" : mode;
    const session = await api.login(demoAccountByMode[activeMode]);
    setSessionUserId(session.user.id);
    await refresh();
  }, [isDesktop, mode, refresh]);

  useEffect(() => {
    setLoading(true);
    bootstrapSession()
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [bootstrapSession]);

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
    const stopRealtime = subscribeToEvents(
      (event: RealtimeEvent) => {
        if (event.type !== "connected" && event.type !== "heartbeat") {
          refresh().catch(() => undefined);
        }
      },
      setRealtimeStatus
    );
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
        setToast(requestError instanceof Error ? requestError.message : "No se pudo completar");
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const activeUser = useMemo(() => {
    if (!state) return null;
    return state.users.find((user) => user.id === sessionUserId) || state.users[0];
  }, [sessionUserId, state]);

  const selectedRestaurant = useMemo(() => {
    if (!state || !selectedRestaurantId) return null;
    return state.restaurants.find((restaurant) => restaurant.id === selectedRestaurantId) || null;
  }, [selectedRestaurantId, state]);

  const categories = useMemo(() => {
    if (!state) return ["Todo"];
    const unique = new Set<string>();
    state.restaurants.forEach((restaurant) =>
      restaurant.menu.forEach((item) => unique.add(item.category))
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
      return categoryMatch && queryMatch;
    });
  }, [category, query, state]);

  const allItems = useMemo(() => {
    if (!state) return [];
    return state.restaurants.flatMap((restaurant) =>
      restaurant.menu.map((item) => ({
        restaurant,
        item
      }))
    );
  }, [state]);

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
    return {
      subtotal,
      deliveryFee,
      serviceFee,
      total: subtotal + deliveryFee + serviceFee
    };
  }, [cart, cartRestaurant, state]);

  const driver = state?.drivers.find((entry) => entry.userId === "usr_driver") || null;
  const merchantRestaurant =
    state?.restaurants.find((restaurant) => restaurant.id === "rest_roja") || null;

  const switchMode = (nextMode: Mode) => {
    setMode(nextMode);
    setSessionUserId(userIdByMode[nextMode]);
    setSelectedRestaurantId(null);
    setCartOpen(false);
    setCheckoutOpen(false);
  };

  const openItem = (restaurant: Restaurant, item: MenuItem) => {
    setItemDraft({ restaurant, item });
    setItemQuantity(1);
    setDraftExtras(restaurant.extras.slice(0, item.category === "Burger" ? 1 : 0).map((extra) => extra.id));
    setDraftNote("");
  };

  const addDraftToCart = () => {
    if (!itemDraft) return;
    const nextLine: CartLine = {
      restaurantId: itemDraft.restaurant.id,
      item: itemDraft.item,
      quantity: itemQuantity,
      extras: draftExtras,
      note: draftNote
    };
    setCart((current) => {
      const sameRestaurant = current.every((line) => line.restaurantId === itemDraft.restaurant.id);
      const base = sameRestaurant ? current : [];
      const index = base.findIndex(
        (line) =>
          line.item.id === nextLine.item.id &&
          line.note === nextLine.note &&
          line.extras.slice().sort().join(",") === nextLine.extras.slice().sort().join(",")
      );
      if (index < 0) return [...base, nextLine];
      return base.map((line, lineIndex) =>
        lineIndex === index ? { ...line, quantity: line.quantity + nextLine.quantity } : line
      );
    });
    setItemDraft(null);
    setToast("Producto agregado al carrito");
  };

  const createOrder = () => {
    if (!activeUser || !cartRestaurant || !cart.length) return;
    runAction(
      async () => {
        await api.createOrder({
          customerId: activeUser.id,
          restaurantId: cartRestaurant.id,
          deliveryAddress: activeUser.defaultAddress || "Direccion demo",
          paymentMethod: "Flash Wallet",
          items: cart.map((line) => ({
            menuItemId: line.item.id,
            quantity: line.quantity,
            extras: line.extras,
            note: line.note
          }))
        });
        setCart([]);
        setCheckoutOpen(false);
        setCartOpen(false);
        setTab("activity");
      },
      "Pedido creado y enviado al comercio"
    );
  };

  const quoteRide = () =>
    runAction(
      async () => {
        const response = await api.quoteRide(rideForm);
        setQuote(response.quote);
      },
      "Tarifa calculada"
    );

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
          pickupCoords: point
        }));
        setLocationStatus("ready");
        setLocationMessage(`GPS listo: ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`);
      },
      () => {
        setLocationStatus("denied");
        setLocationMessage("No pudimos acceder al GPS. Puedes escribir el origen.");
      },
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 10000 }
    );
  }, []);

  const requestRide = () => {
    if (!activeUser) return;
    runAction(
      async () => {
        await api.createRide({
          customerId: activeUser.id,
          pickup: rideForm.pickup,
          destination: rideForm.destination,
          service: rideForm.service,
          pickupCoords: rideForm.pickupCoords,
          destinationCoords: rideForm.destinationCoords,
          paymentMethod: "Flash Wallet"
        });
        setTab("activity");
      },
      "Viaje solicitado"
    );
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
    return (
      <SuperAdminConsole
        state={state}
        dashboard={adminDashboard}
        busy={busy}
        realtimeStatus={realtimeStatus}
        runAction={runAction}
      />
    );
  }

  return (
    <main className="app">
      <section className="workspace">
        <BrandPanel state={state} mode={mode} onModeChange={switchMode} user={activeUser} />
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
                  cartOpen={cartOpen}
                  setCartOpen={setCartOpen}
                  checkoutOpen={checkoutOpen}
                  setCheckoutOpen={setCheckoutOpen}
                  cartTotals={cartTotals}
                  cartRestaurant={cartRestaurant}
                  openItem={openItem}
                  createOrder={createOrder}
                  rideForm={rideForm}
                  setRideForm={setRideForm}
                  quote={quote}
                  quoteRide={quoteRide}
                  requestRide={requestRide}
                  locatePickup={locatePickup}
                  locationStatus={locationStatus}
                  locationMessage={locationMessage}
                  busy={busy}
                  runAction={runAction}
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
                <DriverApp state={state} driver={driver} busy={busy} runAction={runAction} />
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

function PhoneStatus() {
  return (
    <div className="phone-status" aria-hidden="true">
      <span>14:32</span>
      <span className="dynamic-island" />
      <span>5G 82%</span>
    </div>
  );
}

function SuperAdminConsole({
  state,
  dashboard,
  busy,
  realtimeStatus,
  runAction
}: {
  state: AppState;
  dashboard: AdminDashboard | null;
  busy: boolean;
  realtimeStatus: "connecting" | "live" | "reconnecting" | "offline";
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const [section, setSection] = useState<
    "overview" | "dispatch" | "merchants" | "drivers" | "finance" | "investors" | "support" | "infra"
  >("overview");
  const activeOrders = state.orders.filter((order) => !["delivered", "cancelled"].includes(order.status));
  const activeRides = state.rides.filter((ride) => !["completed", "cancelled"].includes(ride.status));
  const grossVolume = [...state.orders.map((order) => order.total), ...state.rides.map((ride) => ride.fare)].reduce(
    (sum, value) => sum + value,
    0
  );
  const takeRate = Math.round(grossVolume * 0.18);
  const cancellationCount =
    state.orders.filter((order) => order.status === "cancelled").length +
    state.rides.filter((ride) => ride.status === "cancelled").length;
  const marketplace = dashboard?.marketplace;
  const investor = dashboard?.investor;
  const platformRevenue = marketplace?.estimatedPlatformRevenue ?? takeRate;
  const readinessScore = investor?.readinessScore ?? 68;
  const nav = [
    ["overview", "Resumen", LineChart],
    ["dispatch", "Dispatch", LocateFixed],
    ["merchants", "Comercios", Store],
    ["drivers", "Drivers", Bike],
    ["finance", "Finanzas", WalletCards],
    ["investors", "Inversion", BadgeDollarSign],
    ["support", "Soporte", MessageCircle],
    ["infra", "Infra", ShieldCheck]
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
        </nav>
        <div className="admin-note">
          <strong>Superficie correcta</strong>
          <span>En escritorio solo se muestra gestion de plataforma. Cliente, comercio y driver quedan como app mobile/PWA.</span>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div>
            <span>Seed-ready ops · SQLite local</span>
            <h1>Control de marketplace, movilidad y delivery</h1>
          </div>
          <div className="admin-actions">
            <RealtimeStatus status={realtimeStatus} />
            <button type="button" onClick={() => window.location.reload()}>
              <RefreshCw size={16} /> Refrescar
            </button>
            <button
              className="danger"
              type="button"
              disabled={busy}
              onClick={() => runAction(() => api.reset(), "Datos demo reiniciados")}
            >
              <RefreshCw size={16} /> Reset demo
            </button>
          </div>
        </header>

        {section === "overview" && (
          <>
            <div className="admin-kpis">
              <AdminKpi label="Pedidos activos" value={state.metrics.activeOrders} detail={`${state.metrics.avgOrderEta}m ETA`} tone="orange" />
              <AdminKpi label="Viajes activos" value={state.metrics.activeRides} detail={`${state.metrics.avgRideEta}m pickup`} tone="teal" />
              <AdminKpi label="Drivers online" value={state.metrics.onlineDrivers} detail={`${state.drivers.length} registrados`} tone="green" />
              <AdminKpi label="GMV demo" value={money.format(grossVolume)} detail={`Revenue ${money.format(platformRevenue)}`} tone="dark" />
            </div>
            <section className="admin-card">
              <AdminSectionHeader title="Investor pulse" action={`${readinessScore}/100 readiness`} />
              <InvestorPulse dashboard={dashboard} grossVolume={grossVolume} platformRevenue={platformRevenue} />
            </section>
            <div className="admin-grid two">
              <section className="admin-card">
                <AdminSectionHeader title="Salud del marketplace" action={`${state.restaurants.length} comercios`} />
                <MarketplaceHealth state={state} dashboard={dashboard} cancellationCount={cancellationCount} />
              </section>
              <section className="admin-card">
                <AdminSectionHeader title="Zonas calientes" action="Live" />
                <ZoneBoard state={state} />
              </section>
            </div>
            <section className="admin-card">
              <AdminSectionHeader title="Actividad en vivo" action={`${activeOrders.length + activeRides.length} activos`} />
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
            <AdminSectionHeader title="Dispatch y asignaciones" action="Food + Taxi" />
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
                    <span>{restaurant.cuisine} · {restaurant.address}</span>
                  </div>
                  <b>{restaurant.open ? "Abierto" : "Pausado"}</b>
                  <small>{restaurant.etaMin}m · {restaurant.menu.length} items</small>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      runAction(
                        () => api.updateRestaurant(restaurant.id, { open: !restaurant.open }),
                        restaurant.open ? "Comercio pausado" : "Comercio abierto"
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
            <AdminSectionHeader title="Conductores y repartidores" action="Supply" />
            <div className="admin-table">
              {state.drivers.map((driver) => (
                <article className="admin-row" key={driver.id}>
                  <div className="avatar">{initials(driver.name)}</div>
                  <div>
                    <strong>{driver.name}</strong>
                    <span>{driver.vehicle} · {driver.plate} · {driver.location.label}</span>
                  </div>
                  <b>{driver.online ? "Online" : "Offline"}</b>
                  <small>{driver.activeService} · {driver.rating}</small>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      runAction(
                        () => api.updateDriver(driver.id, { online: !driver.online }),
                        "Disponibilidad actualizada"
                      )
                    }
                  >
                    {driver.online ? "Pausar" : "Activar"}
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}

        {section === "finance" && (
          <section className="admin-card">
            <AdminSectionHeader title="Finanzas y conciliacion" action="Demo ledger" />
            <div className="admin-kpis finance">
              <AdminKpi label="GMV total" value={money.format(grossVolume)} detail="Pedidos + viajes" tone="orange" />
              <AdminKpi label="Ingreso plataforma" value={money.format(platformRevenue)} detail={`${marketplace?.takeRatePercent ?? 18}% simulado`} tone="green" />
              <AdminKpi label="Wallet clientes" value={money.format(state.users.reduce((sum, user) => sum + user.wallet, 0))} detail="Saldo total" tone="teal" />
              <AdminKpi label="Cancelaciones" value={cancellationCount} detail="Pedidos + viajes" tone="dark" />
            </div>
            <div className="admin-table">
              {[...state.orders.slice(0, 4), ...state.rides.slice(0, 4)].map((entry) => (
                <article className="admin-row compact" key={entry.id}>
                  <ReceiptText size={18} />
                  <div>
                    <strong>{entry.id}</strong>
                    <span>{"restaurantId" in entry ? "Pedido de comida" : "Viaje/taxi"}</span>
                  </div>
                  <b>{money.format("total" in entry ? entry.total : entry.fare)}</b>
                  <small>{entry.paymentMethod}</small>
                </article>
              ))}
            </div>
          </section>
        )}

        {section === "investors" && (
          <div className="admin-grid">
            <section className="admin-card">
              <AdminSectionHeader title="Ronda seed readiness" action={`${readinessScore}/100`} />
              <InvestorPulse dashboard={dashboard} grossVolume={grossVolume} platformRevenue={platformRevenue} />
            </section>
            <div className="admin-grid two">
              <section className="admin-card">
                <AdminSectionHeader title="Unit economics" action="Modelo demo" />
                <UnitEconomicsBoard dashboard={dashboard} />
              </section>
              <section className="admin-card">
                <AdminSectionHeader title="Milestones para levantar capital" action="18 meses" />
                <MilestoneBoard dashboard={dashboard} />
              </section>
            </div>
            <div className="admin-grid two">
              <section className="admin-card">
                <AdminSectionHeader title="Funnel de crecimiento" action="Seed metrics" />
                <GrowthFunnel state={state} dashboard={dashboard} />
              </section>
              <section className="admin-card">
                <AdminSectionHeader title="Riesgos y mitigacion" action={`${dashboard?.riskSignals.length ?? 0} senales`} />
                <RiskSignalBoard dashboard={dashboard} />
              </section>
            </div>
          </div>
        )}

        {section === "support" && (
          <section className="admin-card">
            <AdminSectionHeader title="Soporte, seguridad y trust" action={`${state.supportTickets.length} tickets`} />
            <div className="admin-table">
              {state.supportTickets.map((ticket) => (
                <article className="admin-row compact" key={ticket.id}>
                  <MessageCircle size={18} />
                  <div>
                    <strong>{ticket.title}</strong>
                    <span>{ticket.service} · {ticket.status}</span>
                  </div>
                  <b>{ticket.priority}</b>
                  <small>{ticket.id}</small>
                </article>
              ))}
            </div>
          </section>
        )}

        {section === "infra" && (
          <section className="admin-card">
            <AdminSectionHeader title="Ruta de infraestructura" action="Escalable" />
            <div className="infra-list">
              <InfraItem title="Apps nativas" text="Migrar la experiencia mobile a Expo/React Native con EAS, manteniendo esta API como backend." />
              <InfraItem title="API modular" text="Separar auth, marketplace, dispatch, payments, notifications, support y admin en modulos o servicios." />
              <InfraItem title="Datos" text="Pasar de SQLite local a Postgres + PostGIS, Redis para presencia/colas y object storage para imagenes." />
              <InfraItem title="Tiempo real" text="WebSockets/SSE para tracking, ofertas a drivers, chats, eventos de cocina y consola admin." />
              <InfraItem title="Operabilidad" text="Contenedores, Kubernetes HPA, observabilidad, alertas, feature flags y auditoria de acciones." />
              <InfraItem title="Seguridad" text="RBAC real por rol, proteccion OWASP API Top 10, rate limits, secretos gestionados y trazabilidad." />
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

function RealtimeStatus({ status }: { status: "connecting" | "live" | "reconnecting" | "offline" }) {
  const labels = {
    connecting: "Conectando live",
    live: "Realtime activo",
    reconnecting: "Reconectando",
    offline: "Realtime offline"
  } as const;
  return (
    <span className={`realtime-status ${status}`} title="Canal de actualizaciones de la plataforma">
      <span />
      {labels[status]}
    </span>
  );
}

function AdminKpi({
  label,
  value,
  detail,
  tone
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

function AdminSectionHeader({ title, action }: { title: string; action: string }) {
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
  cancellationCount
}: {
  state: AppState;
  dashboard: AdminDashboard | null;
  cancellationCount: number;
}) {
  const rows = [
    [
      "Fill rate delivery",
      dashboard ? `${dashboard.marketplace.fillRateDelivery}%` : `${state.orders.filter((order) => order.courierId).length}/${state.orders.length}`,
      "Asignacion"
    ],
    [
      "Fill rate taxi",
      dashboard ? `${dashboard.marketplace.fillRateRide}%` : `${state.rides.filter((ride) => ride.driverId).length}/${state.rides.length}`,
      "Conductores"
    ],
    ["Locales abiertos", `${state.metrics.openRestaurants}/${state.restaurants.length}`, "Supply"],
    ["Cancelaciones", String(cancellationCount), "Riesgo"]
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
  platformRevenue
}: {
  dashboard: AdminDashboard | null;
  grossVolume: number;
  platformRevenue: number;
}) {
  const investor = dashboard?.investor;
  const score = investor?.readinessScore ?? 68;
  const margin = investor?.contributionMarginPercent ?? 0;
  const runway = investor?.runwayMonths ?? 0;
  return (
    <div className="investor-pulse">
      <div className="readiness-meter" style={{ "--score": `${score}%` } as CSSProperties}>
        <strong>{score}</strong>
        <span>readiness</span>
      </div>
      <div className="investor-summary">
        <h3>Historia para inversores</h3>
        <p>
          Marketplace multi-servicio con demanda de comida y movilidad, supply flexible y backoffice
          operativo. El foco de la ronda es convertir el MVP local en beta con realtime, pagos y app nativa.
        </p>
        <div className="investor-stats">
          <span>GMV {money.format(grossVolume)}</span>
          <span>Revenue {money.format(platformRevenue)}</span>
          <span>Runway {runway || 18}m</span>
          <span>Margen {margin}%</span>
        </div>
      </div>
    </div>
  );
}

function UnitEconomicsBoard({ dashboard }: { dashboard: AdminDashboard | null }) {
  const rows =
    dashboard?.investor.unitEconomics || [
      { label: "AOV comida", value: "$0", detail: "Ticket promedio" },
      { label: "Fare taxi", value: "$0", detail: "Tarifa promedio" },
      { label: "Take rate", value: "18%", detail: "Comision demo" }
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

function GrowthFunnel({ state, dashboard }: { state: AppState; dashboard: AdminDashboard | null }) {
  const activatedUsers = state.users.filter((user) => user.roles.includes("customer")).length;
  const completedJobs =
    state.orders.filter((order) => order.status === "delivered").length +
    state.rides.filter((ride) => ride.status === "completed").length;
  const funnel = [
    { label: "Usuarios", value: state.users.length, detail: "Cuentas demo" },
    { label: "Activados", value: activatedUsers, detail: "Cliente con wallet" },
    { label: "Jobs", value: state.orders.length + state.rides.length, detail: "Pedidos + viajes" },
    { label: "Cumplidos", value: completedJobs, detail: "Conversion operativa" },
    { label: "Fill delivery", value: `${dashboard?.marketplace.fillRateDelivery ?? 0}%`, detail: "Asignacion" },
    { label: "Fill taxi", value: `${dashboard?.marketplace.fillRateRide ?? 0}%`, detail: "Asignacion" }
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
          <small>{risk.level === "low" ? "Controlado" : risk.level === "medium" ? "Monitorear" : "Accion inmediata"}</small>
        </article>
      ))}
    </div>
  );
}

function ZoneBoard({ state }: { state: AppState }) {
  return (
    <div className="zone-board">
      {state.zones?.map((zone) => (
        <article className={zone.demandLevel === "high" ? "hot" : ""} key={zone.id}>
          <strong>{zone.name}</strong>
          <span>{zone.demandLevel}</span>
          <small>{zone.activeOrders} pedidos · {zone.activeRides} viajes</small>
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
  runAction
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
          const restaurant = state.restaurants.find((entry) => entry.id === order.restaurantId);
          const driver = state.drivers.find((entry) => entry.id === order.courierId);
          return (
            <article className="admin-row compact" key={order.id}>
              <ShoppingBag size={18} />
              <div>
                <strong>{restaurant?.name || order.id}</strong>
                <span>{orderStatusLabel[order.status]} · {order.deliveryAddress}</span>
              </div>
              <b>{money.format(order.total)}</b>
              <small>{driver?.name || "Sin repartidor"}</small>
              <button
                type="button"
                disabled={busy || ["ready_for_pickup", "delivered", "cancelled"].includes(order.status)}
                onClick={() => runAction(() => api.advanceOrder(order.id), "Pedido avanzado")}
              >
                Avanzar
              </button>
            </article>
          );
        })}
      </div>
      <div className="admin-table">
        {rides.map((ride) => {
          const driver = state.drivers.find((entry) => entry.id === ride.driverId);
          return (
            <article className="admin-row compact" key={ride.id}>
              <Car size={18} />
              <div>
                <strong>{ride.pickup}</strong>
                <span>{rideStatusLabel[ride.status]} → {ride.destination}</span>
              </div>
              <b>{money.format(ride.fare)}</b>
              <small>{driver?.name || "Sin conductor"}</small>
              <button
                type="button"
                disabled={busy || ["requested", "completed", "cancelled"].includes(ride.status)}
                onClick={() => runAction(() => api.advanceRide(ride.id), "Viaje avanzado")}
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

function AppModeBar({ mode, onModeChange }: { mode: Mode; onModeChange: (mode: Mode) => void }) {
  const modes: Array<{ id: Mode; label: string; icon: LucideIcon }> = [
    { id: "customer", label: "Cliente", icon: UserRound },
    { id: "merchant", label: "Local", icon: Store },
    { id: "driver", label: "Driver", icon: Bike },
    { id: "ops", label: "Ops", icon: ShieldCheck }
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
  user
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
          <span>Sesion demo</span>
          <strong>{user?.email}</strong>
        </div>
      </div>
      <div className="market-strip">
        <Metric label="Pedidos activos" value={String(state.metrics.activeOrders)} trend={`${state.metrics.avgOrderEta}m ETA`} />
        <Metric label="Viajes activos" value={String(state.metrics.activeRides)} trend={`${state.metrics.avgRideEta}m espera`} />
        <Metric label="Drivers online" value={String(state.metrics.onlineDrivers)} trend={`${state.metrics.openRestaurants} locales`} />
      </div>
      <div className="dispatch-map">
        <div className="zone zone-one">Palermo</div>
        <div className="zone zone-two">Centro</div>
        <div className="zone zone-three">San Telmo</div>
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
  cartOpen: boolean;
  setCartOpen: (open: boolean) => void;
  checkoutOpen: boolean;
  setCheckoutOpen: (open: boolean) => void;
  cartTotals: { subtotal: number; deliveryFee: number; serviceFee: number; total: number };
  cartRestaurant: Restaurant | null;
  openItem: (restaurant: Restaurant, item: MenuItem) => void;
  createOrder: () => void;
  rideForm: RideForm;
  setRideForm: React.Dispatch<React.SetStateAction<RideForm>>;
  quote: RideQuote | null;
  quoteRide: () => void;
  requestRide: () => void;
  locatePickup: () => void;
  locationStatus: "idle" | "locating" | "ready" | "denied";
  locationMessage: string;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
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
    cartOpen,
    setCartOpen,
    checkoutOpen,
    setCheckoutOpen,
    cartTotals,
    cartRestaurant,
    openItem,
    createOrder,
    rideForm,
    setRideForm,
    quote,
    quoteRide,
    requestRide,
    locatePickup,
    locationStatus,
    locationMessage,
    busy,
    runAction
  } = props;

  if (selectedRestaurant) {
    return (
      <RestaurantDetail
        restaurant={selectedRestaurant}
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
        setCart={setCart}
        totals={cartTotals}
        restaurant={cartRestaurant}
        checkoutOpen={checkoutOpen}
        setCheckoutOpen={setCheckoutOpen}
        onBack={() => {
          setCartOpen(false);
          setCheckoutOpen(false);
        }}
        onCreateOrder={createOrder}
        busy={busy}
      />
    );
  }

  return (
    <div className="screen with-nav">
      <header className="home-header">
        <div>
          <span className="muted-label">Enviar a</span>
          <button className="location-button" type="button">
            <MapPin size={15} /> {user?.defaultAddress || "Definir direccion"}
          </button>
        </div>
        <div className="header-actions">
          <IconButton icon={Bell} label="Notificaciones" badge={4} />
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
          onOpenRestaurant={(restaurant) => setSelectedRestaurantId(restaurant.id)}
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
      {tab === "activity" && (
        <CustomerActivity state={state} user={user} runAction={runAction} busy={busy} />
      )}
      {tab === "wallet" && <WalletScreen user={user} promotions={state.promotions} />}
      {tab === "profile" && <ProfileScreen user={user} />}
      <BottomNav tab={tab} onTabChange={setTab} />
    </div>
  );
}

function ServiceToggle({
  service,
  setService
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
  onOpenRestaurant,
  onOpenItem
}: {
  restaurants: Restaurant[];
  allItems: Array<{ restaurant: Restaurant; item: MenuItem }>;
  query: string;
  setQuery: (query: string) => void;
  category: string;
  setCategory: (category: string) => void;
  categories: string[];
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
      <button type="button">
        <Sparkles size={15} /> Activar
      </button>
    </section>
  );
}

function FlashPromiseGrid() {
  const promises = [
    ["Tracking vivo", "Mapa + ETA", LocateFixed],
    ["Garantia", "Credito si falla", ShieldCheck],
    ["Grupal", "Pedido compartido", UserRound],
    ["Programar", "Food o taxi", Clock3]
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
  busy
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
    (ride) => ride.customerId === user?.id && !["completed", "cancelled"].includes(ride.status)
  );
  const driver = state.drivers.find((entry) => entry.id === activeRide?.driverId);

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
              setRideForm((current) => ({ ...current, pickup: event.target.value, pickupCoords: null }))
            }
          />
        </label>
        <label>
          <span>Destino</span>
          <input
            value={rideForm.destination}
            onChange={(event) =>
              setRideForm((current) => ({ ...current, destination: event.target.value, destinationCoords: null }))
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
          {locationStatus === "locating" ? "Buscando GPS..." : "Usar mi ubicacion actual"}
        </button>
        {locationMessage && <small className={`location-message ${locationStatus}`}>{locationMessage}</small>}
        <div className="ride-services">
          {rideServices.map(({ id, label, icon: Icon }) => (
            <button
              className={rideForm.service === id ? "active" : ""}
              key={id}
              onClick={() => setRideForm((current) => ({ ...current, service: id }))}
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
              <span>{quote.distanceKm} km · {quote.durationMin} min</span>
              <strong>{money.format(quote.fare)}</strong>
            </div>
            <small>
              {quote.etaMin} min hasta el punto · {quote.routingMode === "coordinates" ? "basado en coordenadas" : "estimacion por direccion"}
            </small>
          </div>
        )}
        <div className="two-actions">
          <button className="ghost-action" onClick={quoteRide} type="button" disabled={busy}>
            <BadgeDollarSign size={16} /> Cotizar
          </button>
          <button className="primary-button" onClick={requestRide} type="button" disabled={busy}>
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
    ["SOS", "Soporte prioritario"]
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

function CustomerActivity({
  state,
  user,
  runAction,
  busy
}: {
  state: AppState;
  user: User | null;
  runAction: (action: () => Promise<unknown>, success: string) => void;
  busy: boolean;
}) {
  const orders = state.orders.filter((order) => order.customerId === user?.id);
  const rides = state.rides.filter((ride) => ride.customerId === user?.id);
  return (
    <div className="activity-stack">
      <SectionTitle title="Pedidos" />
      {orders.map((order) => {
        const restaurant = state.restaurants.find((entry) => entry.id === order.restaurantId);
        return (
          <StatusCard
            key={order.id}
            icon={ShoppingBag}
            title={`${restaurant?.name || "Restaurante"} · ${orderStatusLabel[order.status]}`}
            subtitle={`${order.items.length} items · ${order.deliveryAddress}`}
            amount={order.total}
            status={order.status}
            actionLabel={order.status === "delivered" ? undefined : "Cancelar"}
            onAction={() =>
              runAction(() => api.setOrderStatus(order.id, "cancelled"), "Pedido cancelado")
            }
            disabled={busy}
          />
        );
      })}
      <SectionTitle title="Viajes" />
      {rides.map((ride) => {
        const driver = state.drivers.find((entry) => entry.id === ride.driverId);
        return (
          <StatusCard
            key={ride.id}
            icon={Car}
            title={`${rideStatusLabel[ride.status]} · ${driver?.name || "Sin conductor"}`}
            subtitle={`${ride.pickup} → ${ride.destination}`}
            amount={ride.fare}
            status={ride.status}
            actionLabel={ride.status === "completed" ? undefined : "Cancelar"}
            onAction={() =>
              runAction(() => api.setRideStatus(ride.id, "cancelled"), "Viaje cancelado")
            }
            disabled={busy}
          />
        );
      })}
    </div>
  );
}

function WalletScreen({ user, promotions }: { user: User | null; promotions: AppState["promotions"] }) {
  return (
    <div className="activity-stack">
      <section className="wallet-card">
        <WalletCards size={25} />
        <div>
          <span>Flash Wallet</span>
          <strong>{money.format(user?.wallet || 0)}</strong>
        </div>
        <button type="button">Cargar</button>
      </section>
      <section className="loyalty-card">
        <div>
          <span>Nivel Pro</span>
          <strong>7 de 10 pedidos para envios gratis</strong>
        </div>
        <div className="loyalty-progress">
          <span style={{ width: "70%" }} />
        </div>
        <small>Aplica en comida, taxi y promos de comercios aliados.</small>
      </section>
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

function ProfileScreen({ user }: { user: User | null }) {
  const rows = [
    ["Direcciones", user?.defaultAddress || "Sin direccion", MapPin],
    ["Pagos", "Wallet y Mastercard 7234", CreditCard],
    ["Seguridad", "Sesion demo local", ShieldCheck],
    ["Soporte", "Pedidos, viajes y comercios", MessageCircle]
  ] as const;
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
        {rows.map(([title, text, Icon]) => (
          <button className="settings-row" type="button" key={title}>
            <Icon size={18} />
            <div>
              <strong>{title}</strong>
              <span>{text}</span>
            </div>
            <ChevronRight size={17} />
          </button>
        ))}
      </div>
    </div>
  );
}

function RestaurantDetail({
  restaurant,
  cartCount,
  onBack,
  onOpenCart,
  onOpenItem
}: {
  restaurant: Restaurant;
  cartCount: number;
  onBack: () => void;
  onOpenCart: () => void;
  onOpenItem: (item: MenuItem) => void;
}) {
  const [category, setCategory] = useState("Todo");
  const categories = ["Todo", ...Array.from(new Set(restaurant.menu.map((item) => item.category)))];
  const menu = restaurant.menu.filter((item) => category === "Todo" || item.category === category);
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
        <p>{restaurant.cuisine} · {restaurant.address}</p>
        <div className="summary-grid">
          <span><Star size={14} /> {restaurant.rating}</span>
          <span><Bike size={14} /> {restaurant.distanceKm} km</span>
          <span><Clock3 size={14} /> {restaurant.etaMin} min</span>
        </div>
      </section>
      <CategoryRail categories={categories} category={category} setCategory={setCategory} />
      <div className="item-list">
        {menu.map((item) => (
          <FoodRow
            key={item.id}
            item={item}
            restaurant={restaurant}
            onClick={() => onOpenItem(item)}
          />
        ))}
      </div>
    </div>
  );
}

function CartScreen({
  cart,
  setCart,
  totals,
  restaurant,
  checkoutOpen,
  setCheckoutOpen,
  onBack,
  onCreateOrder,
  busy
}: {
  cart: CartLine[];
  setCart: React.Dispatch<React.SetStateAction<CartLine[]>>;
  totals: { subtotal: number; deliveryFee: number; serviceFee: number; total: number };
  restaurant: Restaurant | null;
  checkoutOpen: boolean;
  setCheckoutOpen: (open: boolean) => void;
  onBack: () => void;
  onCreateOrder: () => void;
  busy: boolean;
}) {
  return (
    <div className="screen">
      <TopBar title={checkoutOpen ? "Checkout" : "Carrito"} onBack={onBack} actionIcon={TicketPercent} />
      {!cart.length ? (
        <EmptyState icon={ShoppingBag} title="Carrito vacio" text="Agrega un producto para generar un pedido real." />
      ) : (
        <>
          <div className="context-card">
            <Store size={17} />
            <div>
              <strong>{restaurant?.name}</strong>
              <span>{restaurant?.etaMin} min · envio {money.format(restaurant?.deliveryFee || 0)}</span>
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
                    setCart((current) =>
                      quantity <= 0
                        ? current.filter((_, lineIndex) => lineIndex !== index)
                        : current.map((entry, lineIndex) =>
                            lineIndex === index ? { ...entry, quantity } : entry
                          )
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
              <div className="checkout-line">
                <WalletCards size={18} />
                <div>
                  <strong>Flash Wallet</strong>
                  <span>Saldo disponible para demo</span>
                </div>
                <ChevronRight size={17} />
              </div>
            </section>
          )}
          <SummaryBlock totals={totals} />
          <button
            className="primary-button sticky-action"
            type="button"
            onClick={() => (checkoutOpen ? onCreateOrder() : setCheckoutOpen(true))}
            disabled={busy}
          >
            <ReceiptText size={17} />
            {checkoutOpen ? "Confirmar pedido" : "Ir a pagar"}
          </button>
        </>
      )}
    </div>
  );
}

function MerchantApp({
  state,
  restaurant,
  newDish,
  setNewDish,
  busy,
  runAction
}: {
  state: AppState;
  restaurant: Restaurant;
  newDish: { name: string; description: string; category: string; price: number };
  setNewDish: React.Dispatch<React.SetStateAction<{ name: string; description: string; category: string; price: number }>>;
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
              () => api.updateRestaurant(restaurant.id, { open: event.target.checked }),
              event.target.checked ? "Local abierto" : "Local pausado"
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
                () => api.updateRestaurant(restaurant.id, { etaMin: Math.max(5, restaurant.etaMin - 5) }),
                "ETA reducida"
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
                () => api.updateRestaurant(restaurant.id, { etaMin: restaurant.etaMin + 5 }),
                "ETA ampliada"
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
                  "Stock actualizado"
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
            setNewDish((current) => ({ ...current, description: event.target.value }))
          }
        />
        <div className="two-fields">
          <input
            value={newDish.category}
            onChange={(event) =>
              setNewDish((current) => ({ ...current, category: event.target.value }))
            }
          />
          <input
            value={newDish.price}
            onChange={(event) =>
              setNewDish((current) => ({ ...current, price: Number(event.target.value) }))
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
  busy,
  runAction
}: {
  state: AppState;
  driver: Driver;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const lastLocationSentAt = useRef(0);
  const [gpsStatus, setGpsStatus] = useState<"idle" | "locating" | "live" | "denied">("idle");

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
            label: "Ubicacion GPS"
          })
          .then(() => setGpsStatus("live"))
          .catch(() => setGpsStatus("denied"));
      },
      () => setGpsStatus("denied"),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [driver.id, driver.online]);

  const availableOrders = state.orders.filter(
    (order) => !order.courierId && !["delivered", "cancelled"].includes(order.status)
  );
  const activeOrders = state.orders.filter(
    (order) => order.courierId === driver.id && !["delivered", "cancelled"].includes(order.status)
  );
  const availableRides = state.rides.filter(
    (ride) => !ride.driverId && ride.status === "requested"
  );
  const activeRides = state.rides.filter(
    (ride) => ride.driverId === driver.id && !["completed", "cancelled"].includes(ride.status)
  );
  const hotZone = state.zones.find((zone) => zone.demandLevel === "high") || state.zones[0];
  return (
    <div className="screen">
      <TopBar title="Driver" actionIcon={Bike} />
      <section className="driver-card">
        <div className="avatar large">{initials(driver.name)}</div>
        <div>
          <span>{driver.vehicle} · {driver.plate}</span>
          <h2>{driver.name}</h2>
          <p>{driver.location.label} · rating {driver.rating}</p>
          <small className={`driver-gps-status ${gpsStatus}`}>
            {gpsStatus === "live" ? "GPS activo" : gpsStatus === "locating" ? "Conectando GPS" : gpsStatus === "denied" ? "GPS no disponible" : "GPS pausado"}
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
              event.target.checked ? "Driver online" : "Driver offline"
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
              runAction(() => api.updateDriver(driver.id, { activeService: mode }), "Modo actualizado")
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
          <span>Mision activa</span>
          <strong>Completa 3 trabajos y desbloquea bono</strong>
          <small>{hotZone?.name || "Zona centro"} con demanda alta</small>
        </div>
        <b>{money.format(driver.earningsToday)}</b>
      </section>
      <div className="driver-ops-grid">
        <article>
          <LocateFixed size={16} />
          <strong>{availableOrders.length + availableRides.length}</strong>
          <span>Ofertas</span>
        </article>
        <article>
          <ShieldCheck size={16} />
          <strong>99%</strong>
          <span>Safety score</span>
        </article>
        <article>
          <WalletCards size={16} />
          <strong>Now</strong>
          <span>Cashout</span>
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

      <SectionTitle title="Ofertas disponibles" action={`${availableOrders.length + availableRides.length}`} />
      <div className="activity-stack">
        {availableOrders.map((order) => (
          <OfferCard
            key={order.id}
            icon={ShoppingBag}
            title={state.restaurants.find((entry) => entry.id === order.restaurantId)?.name || "Pedido"}
            subtitle={`${orderStatusLabel[order.status]} · ${order.deliveryAddress}`}
            amount={order.total}
            action="Aceptar delivery"
            onAction={() =>
              runAction(() => api.acceptDelivery(order.id, driver.id), "Delivery aceptado")
            }
            busy={busy}
          />
        ))}
        {availableRides.map((ride) => (
          <OfferCard
            key={ride.id}
            icon={Car}
            title={`${ride.pickup} → ${ride.destination}`}
            subtitle={`${ride.distanceKm} km · ${ride.durationMin} min`}
            amount={ride.fare}
            action="Aceptar viaje"
            onAction={() => runAction(() => api.acceptRide(ride.id, driver.id), "Viaje aceptado")}
            busy={busy}
          />
        ))}
      </div>
    </div>
  );
}

function OpsApp({
  state,
  busy,
  runAction
}: {
  state: AppState;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const activeOrders = state.orders.filter((order) => !["delivered", "cancelled"].includes(order.status));
  const activeRides = state.rides.filter((ride) => !["completed", "cancelled"].includes(ride.status));
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
        <div className="zone zone-one">Demanda alta</div>
        <div className="zone zone-two">Autos</div>
        <div className="zone zone-three">Delivery</div>
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
      <button
        className="danger-button"
        type="button"
        disabled={busy}
        onClick={() => runAction(() => api.reset(), "Datos demo reiniciados")}
      >
        <RefreshCw size={16} /> Reiniciar demo
      </button>
    </div>
  );
}

function OpsRiskBoard({ state }: { state: AppState }) {
  const unassignedOrders = state.orders.filter(
    (order) => !order.courierId && !["delivered", "cancelled"].includes(order.status)
  ).length;
  const unassignedRides = state.rides.filter(
    (ride) => !ride.driverId && !["completed", "cancelled"].includes(ride.status)
  ).length;
  const risks = [
    ["Backlog", unassignedOrders + unassignedRides, "Asignaciones pendientes"],
    ["Supply", state.metrics.onlineDrivers, "Drivers online"],
    ["SLA", state.metrics.avgOrderEta + state.metrics.avgRideEta, "Minutos combinados"]
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
  runAction
}: {
  mode: Mode;
  state: AppState;
  user: User | null;
  cartCount: number;
  cartTotal: number;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const driver = state.drivers.find((entry) => entry.userId === "usr_driver");
  const activeOrder = state.orders.find((order) => !["delivered", "cancelled"].includes(order.status));
  const activeRide = state.rides.find((ride) => !["completed", "cancelled"].includes(ride.status));
  return (
    <aside className="ops-panel">
      <PanelHeader
        title={mode === "customer" ? "Cliente" : mode === "merchant" ? "Comercio" : mode === "driver" ? "Driver" : "Ops"}
        icon={mode === "customer" ? UserRound : mode === "merchant" ? Store : mode === "driver" ? Bike : ShieldCheck}
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
            <p>{state.orders.filter((order) => order.restaurantId === "rest_roja").length} pedidos historicos</p>
          </div>
          {state.orders
            .filter((order) => order.restaurantId === "rest_roja")
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
            <p>{driver.online ? "Online" : "Fuera de linea"} · {driver.vehicle}</p>
          </div>
          <button
            className="rail-action"
            type="button"
            disabled={busy}
            onClick={() =>
              runAction(() => api.updateDriver(driver.id, { online: !driver.online }), "Disponibilidad actualizada")
            }
          >
            <LocateFixed size={16} /> {driver.online ? "Pausar" : "Activar"}
          </button>
        </>
      )}
      {mode === "ops" && (
        <>
          <div className="capacity-grid">
            <Metric label="Facturado" value={money.format(state.metrics.completedRevenue)} trend="completado" />
            <Metric label="Tickets" value={String(state.metrics.openTickets)} trend="soporte" />
          </div>
          {state.supportTickets.map((ticket) => (
            <article className="ops-card" key={ticket.id}>
              <span>{ticket.priority}</span>
              <strong>{ticket.title}</strong>
              <p>{ticket.service} · {ticket.status}</p>
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
      <span><Icon size={18} /></span>
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
      <button type="button" aria-label="Filtros" title="Filtros">
        <SlidersHorizontal size={17} />
      </button>
    </div>
  );
}

function CategoryRail({
  categories,
  category,
  setCategory
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

function RestaurantCard({ restaurant, onClick }: { restaurant: Restaurant; onClick: () => void }) {
  return (
    <button className="restaurant-card" type="button" onClick={onClick}>
      <img src={restaurant.image} alt={restaurant.name} />
      <span className={restaurant.open ? "badge" : "badge closed"}>{restaurant.open ? restaurant.badge : "Cerrado"}</span>
      <div className="restaurant-card-body">
        <div>
          <strong>{restaurant.name}</strong>
          <span>{restaurant.cuisine}</span>
        </div>
        <Heart size={18} />
      </div>
      <div className="restaurant-meta">
        <span><Star size={13} /> {restaurant.rating}</span>
        <span>{restaurant.etaMin} min</span>
        <span>{money.format(restaurant.deliveryFee)}</span>
      </div>
    </button>
  );
}

function FoodRow({
  item,
  restaurant,
  onClick
}: {
  item: MenuItem;
  restaurant: Restaurant;
  onClick: () => void;
}) {
  return (
    <button className={item.stock ? "food-row" : "food-row disabled"} type="button" onClick={onClick} disabled={!item.stock}>
      <img src={item.image} alt={item.name} />
      <div className="food-row-main">
        <strong>{item.name}</strong>
        <span>{restaurant.name}</span>
        <div className="food-row-meta">
          <span><Star size={12} /> {item.rating}</span>
          <span><Clock3 size={12} /> {item.timeMin} min</span>
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
  onClose
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
        <button className="sheet-close" onClick={onClose} type="button" aria-label="Cerrar" title="Cerrar">
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
          <span><Star size={13} /> {item.rating}</span>
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
                          : [...extras, extra.id]
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
  min = 0
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
}) {
  return (
    <div className="counter">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label="Restar" title="Restar">
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
  totals
}: {
  totals: { subtotal: number; deliveryFee: number; serviceFee: number; total: number };
}) {
  return (
    <section className="summary-block">
      <div><span>Subtotal</span><strong>{money.format(totals.subtotal)}</strong></div>
      <div><span>Envio</span><strong>{money.format(totals.deliveryFee)}</strong></div>
      <div><span>Servicio</span><strong>{money.format(totals.serviceFee)}</strong></div>
      <div className="total-line"><span>Total</span><strong>{money.format(totals.total)}</strong></div>
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
  labels
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
          <div className={index <= currentIndex ? "step active" : "step"} key={step}>
            <span>{index < currentIndex ? <Check size={12} /> : index + 1}</span>
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
  busy
}: {
  order: Order;
  restaurant?: Restaurant;
  driver?: Driver;
  onAdvance: () => void;
  busy: boolean;
}) {
  const canAdvance = !["ready_for_pickup", "delivered", "cancelled"].includes(order.status);
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
  busy
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
  onAction,
  busy
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  amount: number;
  action: string;
  onAction: () => void;
  busy: boolean;
}) {
  return (
    <article className="offer-card">
      <span className="offer-icon"><Icon size={18} /></span>
      <div>
        <strong>{title}</strong>
        <small>{subtitle}</small>
        <b>{money.format(amount)}</b>
      </div>
      <button type="button" onClick={onAction} disabled={busy}>{action}</button>
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
  disabled
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  amount: number;
  status: string;
  actionLabel?: string;
  onAction?: () => void;
  disabled: boolean;
}) {
  return (
    <article className="status-card">
      <span className="status-icon"><Icon size={18} /></span>
      <div>
        <strong>{title}</strong>
        <span>{subtitle}</span>
        <small>{status} · {money.format(amount)}</small>
      </div>
      {actionLabel && (
        <button type="button" onClick={onAction} disabled={disabled}>
          {actionLabel}
        </button>
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
      <strong>{restaurant?.name} · {orderStatusLabel[order.status]}</strong>
      <p>{money.format(order.total)} · {order.items.length} items</p>
    </article>
  );
}

function MiniRide({ state, ride }: { state: AppState; ride: Ride }) {
  const driver = state.drivers.find((entry) => entry.id === ride.driverId);
  return (
    <article className="ops-card">
      <span>{ride.id}</span>
      <strong>{rideStatusLabel[ride.status]} · {driver?.name || "Sin conductor"}</strong>
      <p>{money.format(ride.fare)} · {ride.distanceKm} km</p>
    </article>
  );
}

function SectionTitle({ title, action }: { title: string; action?: string }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {action && <button type="button">{action}</button>}
    </div>
  );
}

function BottomNav({ tab, onTabChange }: { tab: CustomerTab; onTabChange: (tab: CustomerTab) => void }) {
  const tabs: Array<{ id: CustomerTab; label: string; icon: LucideIcon }> = [
    { id: "home", label: "Inicio", icon: Home },
    { id: "activity", label: "Actividad", icon: ListChecks },
    { id: "wallet", label: "Wallet", icon: WalletCards },
    { id: "profile", label: "Perfil", icon: UserRound }
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
  actionIcon
}: {
  title: string;
  onBack?: () => void;
  actionIcon?: LucideIcon;
}) {
  const ActionIcon = actionIcon;
  return (
    <header className="topbar">
      {onBack ? <IconButton icon={ArrowLeft} label="Volver" onClick={onBack} /> : <span className="topbar-spacer" />}
      <h1>{title}</h1>
      {ActionIcon ? <IconButton icon={ActionIcon} label={title} /> : <span className="topbar-spacer" />}
    </header>
  );
}

function IconButton({
  icon: Icon,
  label,
  onClick,
  badge
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  badge?: number;
}) {
  return (
    <button className="icon-button" type="button" onClick={onClick} aria-label={label} title={label}>
      <Icon size={18} />
      {!!badge && <span className="mini-badge">{badge}</span>}
    </button>
  );
}

function EmptyState({
  icon: Icon,
  title,
  text
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

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export default App;
