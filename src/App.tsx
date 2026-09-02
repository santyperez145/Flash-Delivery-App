import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, subscribeToEvents } from "./api";
import { configureAnalytics } from "./analytics-client";
import { AppModeBar, BrandPanel, NetworkStatusBanner, PhoneStatus } from "./ui/AppChrome";
import { DesktopAccessGate, SystemStateScreen } from "./ui/SystemStateScreen";
import { useCustomerCommerce } from "./customer/useCustomerCommerce";
import type { AppState, AdminDashboard, Mode, RealtimeEvent, User } from "./types";

const WebLogin = lazy(() =>
  import("./auth/WebLogin").then((module) => ({ default: module.WebLogin })),
);
const SuperAdminConsole = lazy(() =>
  import("./backoffice/AdminConsole").then((module) => ({ default: module.SuperAdminConsole })),
);
const CustomerApp = lazy(() =>
  import("./customer/CustomerSurface").then((module) => ({ default: module.CustomerApp })),
);
const ItemSheet = lazy(() =>
  import("./customer/FoodItemSheet").then((module) => ({ default: module.ItemSheet })),
);
const MerchantDesktopConsole = lazy(() =>
  import("./merchant/MerchantConsole").then((module) => ({
    default: module.MerchantDesktopConsole,
  })),
);
const DriverApp = lazy(() =>
  import("./operations/DriverApp").then((module) => ({ default: module.DriverApp })),
);
const MerchantApp = lazy(() =>
  import("./operations/MerchantApp").then((module) => ({ default: module.MerchantApp })),
);
const OpsApp = lazy(() =>
  import("./operations/OpsApp").then((module) => ({ default: module.OpsApp })),
);
const OpsRail = lazy(() =>
  import("./operations/OpsRail").then((module) => ({ default: module.OpsRail })),
);

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
  const initialBootstrapStarted = useRef(false);
  const resetCommerceRef = useRef(() => {});
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
      resetCommerceRef.current();
      setAdminDashboard(null);
      setAuthRequired(true);
      setRealtimeStatus("offline");
    };
    window.addEventListener("flash:auth-required", requireAuthentication);
    return () => window.removeEventListener("flash:auth-required", requireAuthentication);
  }, []);

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
    } else if (user.roles.includes("support")) {
      setMode("ops");
      setDesktopPortal("admin");
    } else if (user.roles.includes("merchant")) {
      setMode("merchant");
      setDesktopPortal("merchant");
    } else if (user.roles.includes("driver")) setMode("driver");
    else setMode("customer");
    await refresh(user.id);
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
    resetCommerce();
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

  const {
    service,
    setService,
    tab,
    setTab,
    query,
    setQuery,
    category,
    setCategory,
    setSelectedRestaurantId,
    cartOpen,
    setCartOpen,
    checkoutOpen,
    setCheckoutOpen,
    promotionCode,
    setPromotionCode,
    itemDraft,
    setItemDraft,
    itemQuantity,
    setItemQuantity,
    draftExtras,
    setDraftExtras,
    draftNote,
    setDraftNote,
    cart,
    setCart,
    dietaryPreferences,
    setDietaryPreferences,
    rideForm,
    setRideForm,
    quote,
    locationStatus,
    locationMessage,
    selectedRestaurant,
    categories,
    filteredRestaurants,
    allItems,
    cartRestaurant,
    cartTotals,
    checkoutGroupOrder,
    openItem,
    addDraftToCart,
    createOrder,
    quoteRide,
    locatePickup,
    requestRide,
    createShipment,
    resetCommerce,
    closeCommerceOverlays,
  } = useCustomerCommerce({
    state,
    sessionUserId,
    activeUser,
    mode,
    setBusy,
    setError,
    setToast,
    refresh,
    runAction,
  });
  resetCommerceRef.current = resetCommerce;

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
    closeCommerceOverlays();
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
    validationToken: string;
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
      validationToken: string;
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
      <SystemStateScreen
        tone="loading"
        eyebrow="Preparando plataforma"
        title="Iniciando Flash"
        message="Estamos conectando tu sesión con las herramientas habilitadas para esta cuenta."
      />
    );
  }

  if (authRequired) {
    return (
      <Suspense
        fallback={
          <SystemStateScreen
            tone="loading"
            eyebrow="Acceso"
            title="Preparando ingreso"
            message="Estamos cargando sólo el módulo seguro de autenticación."
          />
        }
      >
        <WebLogin
          busy={busy}
          error={error}
          mfaChallenge={mfaChallenge}
          onLogin={loginWeb}
          onMfa={completeMfaWeb}
        />
      </Suspense>
    );
  }

  if (!state || error) {
    return (
      <SystemStateScreen
        tone="error"
        eyebrow={isOnline ? "Servicio no disponible" : "Sin conexión"}
        title="No pudimos abrir Flash"
        message={
          !isOnline
            ? "Las acciones nuevas esperan hasta recuperar internet."
            : error || "No se pudo cargar el estado de la plataforma."
        }
        actionLabel="Reintentar"
        onAction={() => window.location.reload()}
      />
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
    const canSupport = Boolean(activeUser?.roles.includes("support") && !canAdmin);
    const canMerchant = Boolean(
      activeUser?.roles.includes("merchant") && merchantRestaurant && !canSupport,
    );
    if (!canAdmin && !canMerchant && !canSupport)
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
          <Suspense
            fallback={
              <SystemStateScreen
                tone="loading"
                eyebrow="Portal de comercio"
                title="Preparando Flash Negocios"
                message="Estamos cargando cocina, catálogo, ventas y finanzas de tu comercio."
              />
            }
          >
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
          </Suspense>
        </>
      );
    }
    return (
      <>
        {networkBanner}
        <Suspense
          fallback={
            <SystemStateScreen
              tone="loading"
              eyebrow="Operaciones"
              title="Preparando Flash Command"
              message="Estamos cargando control, soporte y riesgo para esta sesión."
            />
          }
        >
          <SuperAdminConsole
            state={state}
            currentUserId={activeUser!.id}
            dashboard={adminDashboard}
            busy={busy}
            realtimeStatus={realtimeStatus}
            runAction={runAction}
            onSwitchPortal={() => setDesktopPortal("merchant")}
            onLogout={logoutWeb}
            isSupport={canSupport}
          />
        </Suspense>
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
            <Suspense
              fallback={<div className="surface-loading">Preparando tu espacio Flash…</div>}
            >
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
            </Suspense>
            {toast && <div className="toast">{toast}</div>}
          </div>
        </section>
        <Suspense fallback={<aside className="ops-panel" aria-label="Preparando contexto" />}>
          <OpsRail
            mode={mode}
            state={state}
            user={activeUser}
            cartCount={cart.reduce((sum, line) => sum + line.quantity, 0)}
            cartTotal={cartTotals.total}
            busy={busy}
            runAction={runAction}
          />
        </Suspense>
      </section>
    </main>
  );
}

export default App;
