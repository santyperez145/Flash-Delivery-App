// Superficie de cliente en la web (ticket ARC-001, paso 15).
//
// Tercer corte de `src/App.tsx`. Se lleva las quince pantallas del cliente
// —inicio, comida, envíos, actividad, wallet, perfil, detalle de comercio,
// checkout y las tres hojas de seguimiento— más las diez primitivas que **sólo
// ellas usan**.
//
// De las veinticinco piezas **sólo dos cruzan la frontera**: `CustomerApp`, que
// es la superficie, y `ItemSheet`, que `App` renderiza como hoja global porque
// se abre desde cualquier pantalla de comida.
//
// `SectionTitle`, `TopBar` e `IconButton` iban en sentido contrario: las usan
// también las consolas de operaciones, así que salieron antes a
// [`../ui/panels.tsx`](../ui/panels.tsx). El criterio fue contar usos por zona,
// no leer nombres.
import { lazy, Suspense, useEffect, useState } from "react";
import type { ComponentType } from "react";
import {
  ArrowLeft,
  BadgeDollarSign,
  Bell,
  Bike,
  Car,
  Check,
  Clock3,
  Copy,
  CreditCard,
  Heart,
  Home,
  KeyRound,
  Leaf,
  ListChecks,
  LocateFixed,
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
  TriangleAlert,
  Truck,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { api } from "../api";
import { allergenOptions, dietOptions, itemMatchesDietary } from "../dietary";
import { initials, money } from "../format";
import {
  orderStatusLabel,
  orderSteps,
  rideStatusLabel,
  rideSteps,
  shipmentStatusLabel,
  shipmentSteps,
} from "../labels";
import { IconButton, SectionTitle, TopBar } from "../ui/panels";
import type {
  AppState,
  CartLine,
  CustomerTab,
  DeliveryEvidence,
  DietaryPreferences,
  Driver,
  FoodCheckoutQuote,
  FoodCheckoutSelection,
  GeoPoint,
  MenuItem,
  Order,
  Restaurant,
  Ride,
  RideForm,
  RideQuote,
  RoadRoute,
  Service,
  Shipment,
  ShipmentCreatePayload,
  ShipmentOptions,
  ShipmentQuote,
  User,
  UserAddress,
} from "../types";

// Las tres pesadas se cargan bajo demanda: el mapa arrastra MapLibre entero, y
// el centro de notificaciones y la vista de viajes sólo se abren si el cliente
// entra ahí. Es la misma declaración que tenía `App.tsx` antes del corte.
const NotificationCenter = lazy(() => import("../NotificationCenter"));
const RideHome = lazy(() => import("../RideHome"));
const FlashMap = lazy(() => import("../maps/FlashMap"));

export function CustomerApp(props: {
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

export function ItemSheet({
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
