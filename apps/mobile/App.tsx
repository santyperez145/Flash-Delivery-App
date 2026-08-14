import { useCallback, useEffect, useMemo, useState } from "react";
import * as Location from "expo-location";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { api, demoAccounts } from "./src/api";
import type {
  AppState,
  Driver,
  GeoPoint,
  Mode,
  Order,
  Restaurant,
  Ride,
  RideQuote,
  RideService,
  User
} from "./src/types";

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0
});

export default function App() {
  const [mode, setMode] = useState<Mode>("customer");
  const [state, setState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const response = await api.state();
    setState(response.state);
  }, []);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    try {
      await api.login(demoAccounts[mode]);
      await refresh();
    } catch (error) {
      Alert.alert("Flash", error instanceof Error ? error.message : "No se pudo cargar");
    } finally {
      setLoading(false);
    }
  }, [mode, refresh]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const runAction = useCallback(
    async (action: () => Promise<unknown>, success: string) => {
      setBusy(true);
      try {
        await action();
        await refresh();
        Alert.alert("Flash", success);
      } catch (error) {
        Alert.alert("Flash", error instanceof Error ? error.message : "No se pudo completar");
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const activeRestaurant = state?.restaurants.find((restaurant) => restaurant.id === "rest_roja") || null;
  const activeDriver = state?.drivers.find((driver) => driver.id === "drv_lautaro") || null;
  const activeUser = state?.users.find((user) => user.email === demoAccounts[mode]) || null;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>Flash native</Text>
          <Text style={styles.title}>Food, taxi and driver ops</Text>
        </View>
        <Text style={styles.badge}>{state ? "Live API" : "Offline"}</Text>
      </View>

      <View style={styles.tabs}>
        {(["customer", "merchant", "driver"] as Mode[]).map((entry) => (
          <Pressable
            key={entry}
            onPress={() => setMode(entry)}
            style={[styles.tab, mode === entry && styles.tabActive]}
          >
            <Text style={[styles.tabText, mode === entry && styles.tabTextActive]}>
              {entry === "customer" ? "Cliente" : entry === "merchant" ? "Comercio" : "Driver"}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading || !state ? (
        <View style={styles.loader}>
          <ActivityIndicator color="#f4511e" />
          <Text style={styles.muted}>Conectando con backend...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={bootstrap} />}
        >
          {mode === "customer" && activeUser && (
            <CustomerScreen state={state} user={activeUser} busy={busy} runAction={runAction} />
          )}
          {mode === "merchant" && activeRestaurant && (
            <MerchantScreen restaurant={activeRestaurant} orders={state.orders} busy={busy} runAction={runAction} />
          )}
          {mode === "driver" && activeDriver && (
            <DriverScreen state={state} driver={activeDriver} busy={busy} runAction={runAction} />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

type MobileCartLine = {
  restaurantId: string;
  menuItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
};

function CustomerScreen({
  state,
  user,
  busy,
  runAction
}: {
  state: AppState;
  user: User;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const openRestaurants = state.restaurants.filter((restaurant) => restaurant.open);
  const [cart, setCart] = useState<MobileCartLine[]>([]);
  const [deliveryAddress, setDeliveryAddress] = useState(user.defaultAddress || "");
  const [pickup, setPickup] = useState(user.defaultAddress || "Ubicacion actual");
  const [destination, setDestination] = useState("Aeroparque Jorge Newbery");
  const [pickupCoords, setPickupCoords] = useState<GeoPoint | null>(null);
  const [rideService, setRideService] = useState<RideService>("economy");
  const [rideQuote, setRideQuote] = useState<RideQuote | null>(null);
  const [locationMessage, setLocationMessage] = useState("");
  const activeOrders = state.orders.filter(
    (order) => order.customerId === user.id && !["delivered", "cancelled"].includes(order.status)
  );
  const activeRides = state.rides.filter(
    (ride) => ride.customerId === user.id && !["completed", "cancelled"].includes(ride.status)
  );

  const addItem = (restaurant: Restaurant, item: Restaurant["menu"][number]) => {
    if (!item.stock || !restaurant.open) return;
    if (cart.length > 0 && cart[0].restaurantId !== restaurant.id) {
      Alert.alert("Carrito de un comercio", "Finaliza o vacia el carrito antes de pedir en otro local.");
      return;
    }
    setCart((current) => {
      const existing = current.find((line) => line.menuItemId === item.id);
      if (existing) {
        return current.map((line) =>
          line.menuItemId === item.id ? { ...line, quantity: line.quantity + 1 } : line
        );
      }
      return [
        ...current,
        {
          restaurantId: restaurant.id,
          menuItemId: item.id,
          name: item.name,
          unitPrice: item.price,
          quantity: 1
        }
      ];
    });
  };

  const cartTotal = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const cartRestaurant = openRestaurants.find((restaurant) => restaurant.id === cart[0]?.restaurantId);

  const createOrder = () => {
    if (!cart.length || !cartRestaurant || !deliveryAddress.trim()) {
      Alert.alert("Pedido incompleto", "Selecciona productos y confirma una direccion de entrega.");
      return;
    }
    runAction(
      async () => {
        await api.createOrder({
          customerId: user.id,
          restaurantId: cartRestaurant.id,
          deliveryAddress: deliveryAddress.trim(),
          paymentMethod: "Flash Wallet",
          items: cart.map((line) => ({
            menuItemId: line.menuItemId,
            quantity: line.quantity,
            extras: [],
            note: ""
          }))
        });
        setCart([]);
      },
      "Pedido enviado al comercio"
    );
  };

  const useCurrentLocation = async () => {
    setLocationMessage("Solicitando ubicacion...");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setLocationMessage("Permiso de ubicacion rechazado");
        return;
      }
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setPickup("Ubicacion actual");
      setPickupCoords({ lat: current.coords.latitude, lng: current.coords.longitude });
      setLocationMessage("Origen tomado desde el GPS del dispositivo");
    } catch (_error) {
      setLocationMessage("No se pudo obtener la ubicacion");
    }
  };

  const quoteRide = () => {
    if (!pickup.trim() || !destination.trim()) {
      Alert.alert("Viaje incompleto", "Indica origen y destino para cotizar.");
      return;
    }
    runAction(
      async () => {
        const response = await api.quoteRide({
          pickup: pickup.trim(),
          destination: destination.trim(),
          service: rideService,
          pickupCoords,
          destinationCoords: null
        });
        setRideQuote(response.quote);
      },
      "Cotizacion actualizada"
    );
  };

  const requestRide = () => {
    if (!rideQuote) {
      Alert.alert("Cotiza primero", "La tarifa debe confirmarse antes de solicitar el viaje.");
      return;
    }
    runAction(
      () =>
        api.createRide({
          customerId: user.id,
          pickup: pickup.trim(),
          destination: destination.trim(),
          service: rideService,
          pickupCoords,
          destinationCoords: null,
          paymentMethod: "Flash Wallet"
        }),
      "Viaje solicitado"
    );
  };

  return (
    <View style={styles.stack}>
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>Cliente conectado</Text>
        <Text style={styles.heroTitle}>Pide comida o solicita un viaje</Text>
        <Text style={styles.heroCopy}>Cada accion se valida y persiste en la API de Flash.</Text>
      </View>
      <KpiRow
        items={[
          ["Pedidos activos", activeOrders.length],
          ["Viajes activos", activeRides.length],
          ["Saldo", user.wallet],
          ["Locales", state.metrics.openRestaurants]
        ]}
      />

      <Text style={styles.sectionTitle}>Comida</Text>
      {openRestaurants.map((restaurant) => (
        <View key={restaurant.id} style={styles.card}>
          <Text style={styles.cardTitle}>{restaurant.name}</Text>
          <Text style={styles.cardText}>{restaurant.cuisine} - {restaurant.etaMin} min - {money.format(restaurant.deliveryFee)}</Text>
          {restaurant.menu.filter((item) => item.stock).map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <View style={styles.itemCopy}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.cardText}>{money.format(item.price)}</Text>
              </View>
              <ActionButton label="Agregar" disabled={busy} onPress={() => addItem(restaurant, item)} />
            </View>
          ))}
        </View>
      ))}
      {cart.length > 0 && (
        <View style={styles.formCard}>
          <Text style={styles.sectionTitle}>Carrito de {cartRestaurant?.name}</Text>
          {cart.map((line) => (
            <Text style={styles.cardText} key={line.menuItemId}>
              {line.quantity} x {line.name} - {money.format(line.unitPrice * line.quantity)}
            </Text>
          ))}
          <TextInput
            value={deliveryAddress}
            onChangeText={setDeliveryAddress}
            placeholder="Direccion de entrega"
            style={styles.input}
          />
          <Text style={styles.totalText}>Total productos: {money.format(cartTotal)}</Text>
          <ActionButton label="Enviar pedido" disabled={busy} onPress={createOrder} />
          <ActionButton label="Vaciar carrito" disabled={busy} onPress={() => setCart([])} />
        </View>
      )}

      <Text style={styles.sectionTitle}>Taxi</Text>
      <View style={styles.formCard}>
        <TextInput value={pickup} onChangeText={(value) => { setPickup(value); setPickupCoords(null); }} placeholder="Origen" style={styles.input} />
        <Pressable onPress={useCurrentLocation} style={styles.secondaryAction}>
          <Text style={styles.secondaryActionText}>Usar mi ubicacion actual</Text>
        </Pressable>
        <TextInput value={destination} onChangeText={(value) => { setDestination(value); setRideQuote(null); }} placeholder="Destino" style={styles.input} />
        <View style={styles.choiceRow}>
          {(["economy", "comfort", "moto", "xl"] as RideService[]).map((service) => (
            <Pressable key={service} onPress={() => { setRideService(service); setRideQuote(null); }} style={[styles.choice, rideService === service && styles.choiceActive]}>
              <Text style={[styles.choiceText, rideService === service && styles.choiceTextActive]}>{service}</Text>
            </Pressable>
          ))}
        </View>
        {locationMessage ? <Text style={styles.helperText}>{locationMessage}</Text> : null}
        {rideQuote && (
          <View style={styles.quoteBox}>
            <Text style={styles.cardTitle}>{money.format(rideQuote.fare)}</Text>
            <Text style={styles.cardText}>{rideQuote.distanceKm} km - {rideQuote.durationMin} min - {rideQuote.routingMode === "coordinates" ? "GPS" : "estimacion por direccion"}</Text>
          </View>
        )}
        <View style={styles.actionRow}>
          <ActionButton label="Cotizar" disabled={busy} onPress={quoteRide} />
          <ActionButton label="Solicitar" disabled={busy || !rideQuote} onPress={requestRide} />
        </View>
      </View>

      <Text style={styles.sectionTitle}>Seguimiento</Text>
      {activeOrders.map((order) => (
        <View key={order.id} style={styles.card}>
          <Text style={styles.cardTitle}>Pedido {order.status}</Text>
          <Text style={styles.cardText}>{order.deliveryAddress} - {money.format(order.total)}</Text>
          <ActionButton label="Cancelar pedido" disabled={busy || ["delivered", "cancelled"].includes(order.status)} onPress={() => runAction(() => api.setOrderStatus(order.id, "cancelled"), "Pedido cancelado")} />
        </View>
      ))}
      {activeRides.map((ride) => (
        <View key={ride.id} style={styles.card}>
          <Text style={styles.cardTitle}>Viaje {ride.status}</Text>
          <Text style={styles.cardText}>{ride.pickup} - {ride.destination} - {money.format(ride.fare)}</Text>
          <ActionButton label="Cancelar viaje" disabled={busy || ["completed", "cancelled"].includes(ride.status)} onPress={() => runAction(() => api.setRideStatus(ride.id, "cancelled"), "Viaje cancelado")} />
        </View>
      ))}
    </View>
  );
}

function MerchantScreen({
  restaurant,
  orders,
  busy,
  runAction
}: {
  restaurant: Restaurant;
  orders: Order[];
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const [newItem, setNewItem] = useState({
    name: "",
    description: "",
    category: "Especiales",
    price: ""
  });
  const restaurantOrders = orders.filter((order) => order.restaurantId === restaurant.id);
  const activeOrders = restaurantOrders.filter((order) => !["delivered", "cancelled"].includes(order.status));
  const revenue = restaurantOrders.reduce((sum, order) => sum + order.total, 0);
  return (
    <View style={styles.stack}>
      <View style={styles.cardDark}>
        <Text style={styles.heroLabel}>{restaurant.open ? "Abierto" : "Pausado"}</Text>
        <Text style={styles.heroTitle}>{restaurant.name}</Text>
        <Text style={styles.heroCopy}>{restaurant.address}</Text>
      </View>
      <KpiRow
        items={[
          ["Venta", revenue],
          ["Activos", activeOrders.length],
          ["ETA", restaurant.etaMin],
          ["Stock", restaurant.menu.filter((item) => item.stock).length]
        ]}
      />
      <View style={styles.actionRow}>
        <ActionButton
          label={restaurant.open ? "Pausar" : "Abrir"}
          disabled={busy}
          onPress={() =>
            runAction(() => api.updateRestaurant(restaurant.id, { open: !restaurant.open }), "Estado actualizado")
          }
        />
        <ActionButton
          label="+5 min ETA"
          disabled={busy}
          onPress={() =>
            runAction(() => api.updateRestaurant(restaurant.id, { etaMin: restaurant.etaMin + 5 }), "ETA actualizada")
          }
        />
      </View>
      <Text style={styles.sectionTitle}>Cocina en vivo</Text>
      {activeOrders.map((order) => (
        <OrderCard
          key={order.id}
          order={order}
          disabled={busy}
          onPress={() => runAction(() => api.advanceOrder(order.id), "Pedido avanzado")}
        />
      ))}
      {activeOrders.length === 0 && <Text style={styles.muted}>No hay pedidos activos para gestionar.</Text>}
      <Text style={styles.sectionTitle}>Menu y stock</Text>
      {restaurant.menu.map((item) => (
        <View key={item.id} style={styles.itemRow}>
          <View style={styles.itemCopy}>
            <Text style={styles.itemName}>{item.name}</Text>
            <Text style={styles.cardText}>{money.format(item.price)} - {item.stock ? "Disponible" : "Agotado"}</Text>
          </View>
          <ActionButton
            label={item.stock ? "Agotar" : "Reponer"}
            disabled={busy}
            onPress={() => runAction(() => api.updateMenuStock(restaurant.id, item.id, !item.stock), "Stock actualizado")}
          />
        </View>
      ))}
      <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>Agregar producto</Text>
        <TextInput value={newItem.name} onChangeText={(value) => setNewItem((current) => ({ ...current, name: value }))} placeholder="Nombre" style={styles.input} />
        <TextInput value={newItem.description} onChangeText={(value) => setNewItem((current) => ({ ...current, description: value }))} placeholder="Descripcion" style={styles.input} />
        <TextInput value={newItem.category} onChangeText={(value) => setNewItem((current) => ({ ...current, category: value }))} placeholder="Categoria" style={styles.input} />
        <TextInput value={newItem.price} onChangeText={(value) => setNewItem((current) => ({ ...current, price: value }))} placeholder="Precio" keyboardType="numeric" style={styles.input} />
        <ActionButton
          label="Crear producto"
          disabled={busy || !newItem.name.trim() || Number(newItem.price) <= 0}
          onPress={() => runAction(async () => {
            await api.addMenuItem(restaurant.id, {
              name: newItem.name.trim(),
              description: newItem.description.trim(),
              category: newItem.category.trim() || "Especiales",
              price: Number(newItem.price)
            });
            setNewItem({ name: "", description: "", category: "Especiales", price: "" });
          }, "Producto creado")}
        />
      </View>
    </View>
  );
}

function DriverScreen({
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
  const [gpsStatus, setGpsStatus] = useState<"paused" | "requesting" | "live" | "denied">("paused");

  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;
    let disposed = false;

    const startLocationTracking = async () => {
      if (!driver.online) {
        setGpsStatus("paused");
        return;
      }
      setGpsStatus("requesting");
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setGpsStatus("denied");
        return;
      }
      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 15000,
          distanceInterval: 50
        },
        ({ coords }) => {
          if (disposed) return;
          void api
            .updateDriverLocation(driver.id, {
              lat: coords.latitude,
              lng: coords.longitude,
              label: "Ubicacion GPS"
            })
            .then(() => setGpsStatus("live"))
            .catch(() => setGpsStatus("denied"));
        }
      );
    };

    void startLocationTracking().catch(() => setGpsStatus("denied"));
    return () => {
      disposed = true;
      subscription?.remove();
    };
  }, [driver.id, driver.online]);

  const activeOrders = state.orders.filter((order) => order.courierId === driver.id && !["delivered", "cancelled"].includes(order.status));
  const availableOrders = state.orders.filter(
    (order) => driver.activeService === "delivery" && !order.courierId && !["delivered", "cancelled"].includes(order.status)
  );
  const activeRides = state.rides.filter((ride) => ride.driverId === driver.id && !["completed", "cancelled"].includes(ride.status));
  const availableRides = state.rides.filter(
    (ride) => driver.activeService === "ride" && !ride.driverId && ride.status === "requested"
  );

  return (
    <View style={styles.stack}>
      <View style={styles.cardDark}>
        <Text style={styles.heroLabel}>{driver.online ? "Online" : "Offline"}</Text>
        <Text style={styles.heroTitle}>{driver.name}</Text>
        <Text style={styles.heroCopy}>{driver.vehicle} - {driver.plate} - rating {driver.rating}</Text>
        <Text style={styles.gpsText}>
          {gpsStatus === "live" ? "GPS activo" : gpsStatus === "requesting" ? "Solicitando GPS" : gpsStatus === "denied" ? "GPS no disponible" : "GPS pausado"}
        </Text>
      </View>
      <KpiRow
        items={[
          ["Ganancias", driver.earningsToday],
          ["Activos", activeOrders.length + activeRides.length],
          ["Ofertas", availableOrders.length + availableRides.length],
          ["Modo", driver.activeService === "delivery" ? "Delivery" : "Taxi"]
        ]}
      />
      <View style={styles.actionRow}>
        <ActionButton
          label={driver.online ? "Pausar" : "Activar"}
          disabled={busy}
          onPress={() => runAction(() => api.updateDriver(driver.id, { online: !driver.online }), "Disponibilidad actualizada")}
        />
        <ActionButton
          label={driver.activeService === "delivery" ? "Modo taxi" : "Modo delivery"}
          disabled={busy}
          onPress={() =>
            runAction(
              () => api.updateDriver(driver.id, { activeService: driver.activeService === "delivery" ? "ride" : "delivery" }),
              "Modo actualizado"
            )
          }
        />
      </View>
      <Text style={styles.sectionTitle}>Activos</Text>
      {activeOrders.map((order) => (
        <OrderCard key={order.id} order={order} disabled={busy} onPress={() => runAction(() => api.advanceOrder(order.id), "Delivery avanzado")} />
      ))}
      {activeRides.map((ride) => (
        <RideCard key={ride.id} ride={ride} disabled={busy} onPress={() => runAction(() => api.advanceRide(ride.id), "Viaje avanzado")} />
      ))}
      {activeOrders.length === 0 && activeRides.length === 0 && <Text style={styles.muted}>No tienes trabajos activos.</Text>}
      <Text style={styles.sectionTitle}>Ofertas</Text>
      {availableOrders.map((order) => (
        <OrderCard key={order.id} order={order} disabled={busy} onPress={() => runAction(() => api.acceptDelivery(order.id, driver.id), "Delivery aceptado")} />
      ))}
      {availableRides.map((ride) => (
        <RideCard key={ride.id} ride={ride} disabled={busy} onPress={() => runAction(() => api.acceptRide(ride.id, driver.id), "Viaje aceptado")} />
      ))}
      {availableOrders.length === 0 && availableRides.length === 0 && <Text style={styles.muted}>No hay ofertas para el modo seleccionado.</Text>}
    </View>
  );
}

function KpiRow({ items }: { items: Array<[string, number | string]> }) {
  return (
    <View style={styles.kpiGrid}>
      {items.map(([label, value]) => (
        <View key={label} style={styles.kpi}>
          <Text style={styles.kpiLabel}>{label}</Text>
          <Text style={styles.kpiValue}>
            {typeof value === "number" && value > 999 ? money.format(value) : value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function OrderCard({
  order,
  disabled,
  onPress
}: {
  order: Order;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{order.status}</Text>
      <Text style={styles.cardText}>{order.deliveryAddress}</Text>
      <Text style={styles.cardText}>{order.items.length} items - {money.format(order.total)}</Text>
      {onPress && <ActionButton label="Avanzar" disabled={disabled} onPress={onPress} />}
    </View>
  );
}

function RideCard({
  ride,
  disabled,
  onPress
}: {
  ride: Ride;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{ride.status}</Text>
      <Text style={styles.cardText}>{ride.pickup} {"->"} {ride.destination}</Text>
      <Text style={styles.cardText}>{ride.distanceKm} km - {money.format(ride.fare)}</Text>
      {onPress && <ActionButton label="Gestionar" disabled={disabled} onPress={onPress} />}
    </View>
  );
}

function ActionButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.action, disabled && styles.actionDisabled]}>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#f4f6f8"
  },
  header: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: "#161b22",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  eyebrow: {
    color: "#ffcc1c",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  title: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "900"
  },
  badge: {
    color: "#fff",
    backgroundColor: "#16a66a",
    borderRadius: 8,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: "900"
  },
  tabs: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    backgroundColor: "#fff"
  },
  tab: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: "#f0f2f5",
    alignItems: "center",
    justifyContent: "center"
  },
  tabActive: {
    backgroundColor: "#f4511e"
  },
  tabText: {
    color: "#626a78",
    fontWeight: "900"
  },
  tabTextActive: {
    color: "#fff"
  },
  loader: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10
  },
  muted: {
    color: "#626a78"
  },
  content: {
    padding: 14,
    paddingBottom: 40
  },
  stack: {
    gap: 12
  },
  hero: {
    padding: 16,
    borderRadius: 8,
    backgroundColor: "#f4511e"
  },
  cardDark: {
    padding: 16,
    borderRadius: 8,
    backgroundColor: "#161b22"
  },
  heroLabel: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  heroTitle: {
    marginTop: 6,
    color: "#fff",
    fontSize: 21,
    fontWeight: "900"
  },
  heroCopy: {
    marginTop: 6,
    color: "rgba(255,255,255,0.76)",
    lineHeight: 20
  },
  gpsText: {
    marginTop: 8,
    color: "#8df0c3",
    fontSize: 12,
    fontWeight: "900"
  },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  kpi: {
    width: "47.8%",
    minHeight: 84,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e6e9ef"
  },
  kpiLabel: {
    color: "#626a78",
    fontSize: 12,
    fontWeight: "900"
  },
  kpiValue: {
    marginTop: 10,
    color: "#222832",
    fontSize: 22,
    fontWeight: "900"
  },
  sectionTitle: {
    color: "#222832",
    fontSize: 17,
    fontWeight: "900"
  },
  card: {
    padding: 14,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e6e9ef",
    gap: 5
  },
  cardTitle: {
    color: "#222832",
    fontSize: 16,
    fontWeight: "900"
  },
  cardText: {
    color: "#626a78"
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eef0f3"
  },
  itemCopy: {
    flex: 1,
    gap: 3
  },
  itemName: {
    color: "#222832",
    fontWeight: "800"
  },
  formCard: {
    padding: 14,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e6e9ef",
    gap: 10
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: "#d8dde5",
    borderRadius: 8,
    paddingHorizontal: 12,
    color: "#222832",
    backgroundColor: "#fff"
  },
  secondaryAction: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#f4511e",
    alignItems: "center",
    justifyContent: "center"
  },
  secondaryActionText: {
    color: "#d74317",
    fontWeight: "800"
  },
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  choice: {
    minWidth: 70,
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "#eef0f3",
    alignItems: "center",
    justifyContent: "center"
  },
  choiceActive: {
    backgroundColor: "#f4511e"
  },
  choiceText: {
    color: "#626a78",
    fontWeight: "800",
    textTransform: "capitalize"
  },
  choiceTextActive: {
    color: "#fff"
  },
  helperText: {
    color: "#627080",
    fontSize: 12
  },
  quoteBox: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#e8f7ef",
    gap: 4
  },
  totalText: {
    color: "#222832",
    fontWeight: "900"
  },
  actionRow: {
    flexDirection: "row",
    gap: 10
  },
  action: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: "#252b33",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12
  },
  actionDisabled: {
    opacity: 0.55
  },
  actionText: {
    color: "#fff",
    fontWeight: "900"
  }
});
