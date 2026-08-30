// Superficie de cliente en la web (ticket ARC-001, paso 15).
//
// Coordinador de Cliente extraído de `src/App.tsx`. Sólo conserva selección y
// estado entre tareas. Wallet, Cuenta, Actividad, Envíos, descubrimiento,
// restaurante, carrito/checkout y los trackings tienen límites propios.
//
// `CustomerApp` es la única pieza que cruza esta frontera. La personalización
// global de producto se carga desde `FoodItemSheet` sin volver a atravesar el
// coordinador.
//
// `SectionTitle`, `TopBar` e `IconButton` iban en sentido contrario: las usan
// también las consolas de operaciones, así que salieron antes a
// [`../ui/panels.tsx`](../ui/panels.tsx). El criterio fue contar usos por zona,
// no leer nombres.
import { lazy, Suspense, useState } from "react";
import { Bell, MapPin, RefreshCw, ShoppingBag } from "lucide-react";

import { api } from "../api";
import { SubscriptionPanel } from "./SubscriptionPanel";
import { GroupOrderPanel } from "./GroupOrderPanel";
import { WalletScreen } from "./WalletScreen";
import { CustomerProfileScreen } from "./CustomerProfileScreen";
import { CustomerActivityScreen } from "./CustomerActivityScreen";
import { ShipmentHome } from "./ShipmentHome";
import { CartScreen } from "./FoodCartScreen";
import { RestaurantDetail } from "./FoodRestaurantScreen";
import { FoodDiscoveryHome } from "./FoodDiscoveryHome";
import { CustomerBottomNav, ServiceToggle } from "./CustomerNavigation";
import { IconButton } from "../ui/panels";
import type {
  AppState,
  CartLine,
  CustomerTab,
  DietaryPreferences,
  FoodCheckoutSelection,
  GroupOrder,
  MenuItem,
  Restaurant,
  RideForm,
  RideQuote,
  Service,
  ShipmentCreatePayload,
  User,
  UserAddress,
} from "../types";

// Notificaciones y Viajes se cargan sólo cuando el cliente entra en esa tarea.
const NotificationCenter = lazy(() => import("../NotificationCenter"));
const RideHome = lazy(() => import("../RideHome"));

export function CustomerApp(props: {
  state: AppState;
  user: User | null;
  service: Service;
  setService: (service: Service) => void;
  features: Record<string, { active: boolean; variant: Record<string, unknown> }> | null;
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
  onCheckoutGroup: (group: GroupOrder) => void;
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
    validationToken: string;
  }) => Promise<boolean>;
  onUpdateAddress: (
    addressId: string,
    payload: {
      label: string;
      address: string;
      lat: number;
      lng: number;
      isDefault: boolean;
      validationToken: string;
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
    onCheckoutGroup,
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

      <ServiceToggle service={service} setService={setService} features={props.features} />

      {tab === "home" && service === "food" && (
        <FoodDiscoveryHome
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
          onOpenSubscription={() => setTab("profile")}
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
        <CustomerActivityScreen state={state} user={user} runAction={runAction} busy={busy} />
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
        <CustomerProfileScreen
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
      {/* La suscripción vive en Perfil, que es donde la persona ya va a mirar lo
          que paga. Se monta al lado del perfil y no dentro para que su carga
          fallida no se lleve puesta la pantalla de la cuenta. */}
      {tab === "profile" && <SubscriptionPanel />}
      {/* Los grupos viven en Actividad y no en Perfil: son pedidos en curso, y
          es donde alguien vuelve a mirar «cómo va lo que pedimos». */}
      {tab === "activity" && (
        <GroupOrderPanel
          restaurantId={cartRestaurant?.id ?? null}
          cart={cart}
          userId={user?.id ?? null}
          onCheckoutGroup={onCheckoutGroup}
          busy={busy}
        />
      )}
      <CustomerBottomNav tab={tab} onTabChange={setTab} />
    </div>
  );
}
