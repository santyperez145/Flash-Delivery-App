// Superficie de cliente en la web (ticket ARC-001, paso 15).
//
// Coordinador de Cliente extraído de `src/App.tsx`. Sólo conserva selección y
// estado entre tareas. Wallet, Cuenta, Actividad, Envíos, carrito/checkout y
// los trackings tienen límites propios; restaurante y descubrimiento son los
// próximos cortes de ARC-001.
//
// De las veinticinco piezas **sólo dos cruzan la frontera**: `CustomerApp`, que
// es la superficie, y `ItemSheet`, que `App` renderiza como hoja global porque
// se abre desde cualquier pantalla de comida.
//
// `SectionTitle`, `TopBar` e `IconButton` iban en sentido contrario: las usan
// también las consolas de operaciones, así que salieron antes a
// [`../ui/panels.tsx`](../ui/panels.tsx). El criterio fue contar usos por zona,
// no leer nombres.
import { lazy, Suspense, useState } from "react";
import {
  ArrowLeft,
  Bell,
  Bike,
  Car,
  Clock3,
  Heart,
  Home,
  Leaf,
  ListChecks,
  LocateFixed,
  MapPin,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Star,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { api } from "../api";
import { Beneficios, SubscriptionPanel, useSubscription } from "./SubscriptionPanel";
import { GroupOrderPanel } from "./GroupOrderPanel";
import { WalletScreen } from "./WalletScreen";
import { CustomerProfileScreen } from "./CustomerProfileScreen";
import { CustomerActivityScreen } from "./CustomerActivityScreen";
import { ShipmentHome } from "./ShipmentHome";
import { CartScreen } from "./FoodCartScreen";
import { Counter } from "./QuantityCounter";
import { EmptyState } from "./EmptyState";
import { allergenOptions, dietOptions, itemMatchesDietary } from "../dietary";
import { money } from "../format";
import { IconButton, SectionTitle } from "../ui/panels";
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
      <BottomNav tab={tab} onTabChange={setTab} />
    </div>
  );
}

/**
 * Selector de servicio, con el envío detrás de su flag.
 *
 * `shipment_beta` y `public_rides` existían en la base desde la migración 093 y
 * **nadie los leía**:
 * el panel de operaciones podía apagarlo y la pestaña seguía ahí. Ahora apagarlo
 * la esconde, que es lo que un control de release tiene que hacer.
 *
 * Un flag desconocido —`features` en `null` porque la llamada falló o todavía no
 * volvió— deja la pestaña visible. Esconder producto por una llamada que no
 * respondió sería peor que mostrar de más.
 */
function ServiceToggle({
  service,
  setService,
  features,
}: {
  service: Service;
  setService: (service: Service) => void;
  features: Record<string, { active: boolean; variant: Record<string, unknown> }> | null;
}) {
  const enviosHabilitados = features?.shipment_beta?.active ?? true;
  const viajesHabilitados = features?.public_rides?.active ?? true;
  return (
    <div className="service-toggle">
      <button
        className={service === "food" ? "active" : ""}
        onClick={() => setService("food")}
        type="button"
      >
        <ShoppingBag size={16} /> Comida
      </button>
      {viajesHabilitados && (
        <button
          className={service === "ride" ? "active" : ""}
          onClick={() => setService("ride")}
          type="button"
        >
          <Car size={16} /> Taxi
        </button>
      )}
      {enviosHabilitados && (
        <button
          className={service === "shipment" ? "active" : ""}
          onClick={() => setService("shipment")}
          type="button"
        >
          <PackageCheck size={16} /> Envíos
        </button>
      )}
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
  onOpenSubscription,
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
  onOpenSubscription: () => void;
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
      <FlashPassTeaser onOpen={onOpenSubscription} />
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

/**
 * Anuncio de la suscripción en la portada.
 *
 * **Esto era una tarjeta decorativa.** Prometía «Flash Pass — envíos gratis,
 * soporte prioritario y promos cross-food/taxi», decía «Disponible en checkout»,
 * y detrás no había tabla, ruta ni concepto: ni el nombre ni dos de los tres
 * beneficios existían en ninguna parte del producto. Vender algo que no existe
 * en la primera pantalla es peor que no venderlo, porque la persona lo busca en
 * el checkout y no lo encuentra.
 *
 * Ahora anuncia el plan real con sus beneficios reales, leídos del servidor, y
 * lleva a donde se contrata. **Se esconde para quien ya está suscripto**: seguir
 * ofreciéndole lo que ya paga es el error más barato de cometer y el que más
 * rápido enseña que la app no sabe quién es.
 */
function FlashPassTeaser({ onOpen }: { onOpen: () => void }) {
  const { planes, suscripcion, cargando } = useSubscription();
  const plan = planes[0];
  if (cargando || suscripcion || !plan) return null;
  return (
    <button type="button" className="flash-pass" onClick={onOpen}>
      <div>
        <span>{plan.planName}</span>
        {/* La descripción del plan repite exactamente estos tres beneficios. Se
            muestra la lista y no la prosa: sale de los valores del plan, así que
            no puede prometer un umbral distinto del que aplica la tarifa. */}
        <Beneficios plan={plan} />
      </div>
      <span className="flash-pass-status">
        <Sparkles size={15} /> {money.format(plan.priceCents / 100)} / {plan.billingPeriodDays} días
      </span>
    </button>
  );
}

function FlashPromiseGrid() {
  // Las cuatro promesas de la portada, y las cuatro tienen que existir. «Grupal
  // — Pedido compartido» estaba acá y **no existe**: el backlog lo lista como
  // hueco abierto (GTM-001). Se reemplaza por las sustituciones, que sí existen,
  // están probadas y son el momento en que un pedido se salva o se pierde.
  const promises = [
    ["Tracking vivo", "Mapa + ETA", LocateFixed],
    ["Garantia", "Credito si falla", ShieldCheck],
    ["Sustituciones", "Vos elegis el reemplazo", UserRound],
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
