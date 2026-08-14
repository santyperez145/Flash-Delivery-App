import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { api, demoAccounts } from "./src/api";
import type { AppState, Driver, Mode, Order, Restaurant, Ride } from "./src/types";

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
          {mode === "customer" && <CustomerScreen state={state} />}
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

function CustomerScreen({ state }: { state: AppState }) {
  const openRestaurants = state.restaurants.filter((restaurant) => restaurant.open);
  const activeRide = state.rides.find((ride) => !["completed", "cancelled"].includes(ride.status));
  return (
    <View style={styles.stack}>
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>Flash Pass</Text>
        <Text style={styles.heroTitle}>Envios gratis, taxi protegido y soporte prioritario</Text>
        <Text style={styles.heroCopy}>La app nativa comparte backend con la web y queda lista para push, location y EAS builds.</Text>
      </View>
      <KpiRow
        items={[
          ["Pedidos", state.metrics.activeOrders],
          ["Viajes", state.metrics.activeRides],
          ["Drivers", state.metrics.onlineDrivers],
          ["Locales", state.metrics.openRestaurants]
        ]}
      />
      <Text style={styles.sectionTitle}>Restaurantes abiertos</Text>
      {openRestaurants.map((restaurant) => (
        <View key={restaurant.id} style={styles.card}>
          <Text style={styles.cardTitle}>{restaurant.name}</Text>
          <Text style={styles.cardText}>{restaurant.cuisine} - {restaurant.etaMin} min - {money.format(restaurant.deliveryFee)}</Text>
          <Text style={styles.cardText}>{restaurant.menu.filter((item) => item.stock).length} productos disponibles</Text>
        </View>
      ))}
      {activeRide && <RideCard ride={activeRide} />}
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
  const activeOrders = state.orders.filter((order) => order.courierId === driver.id && !["delivered", "cancelled"].includes(order.status));
  const availableOrders = state.orders.filter((order) => !order.courierId && !["delivered", "cancelled"].includes(order.status));
  const activeRides = state.rides.filter((ride) => ride.driverId === driver.id && !["completed", "cancelled"].includes(ride.status));
  const availableRides = state.rides.filter((ride) => !ride.driverId && ride.status === "requested");

  return (
    <View style={styles.stack}>
      <View style={styles.cardDark}>
        <Text style={styles.heroLabel}>{driver.online ? "Online" : "Offline"}</Text>
        <Text style={styles.heroTitle}>{driver.name}</Text>
        <Text style={styles.heroCopy}>{driver.vehicle} - {driver.plate} - rating {driver.rating}</Text>
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
      <Text style={styles.sectionTitle}>Ofertas</Text>
      {availableOrders.map((order) => (
        <OrderCard key={order.id} order={order} disabled={busy} onPress={() => runAction(() => api.acceptDelivery(order.id, driver.id), "Delivery aceptado")} />
      ))}
      {availableRides.map((ride) => (
        <RideCard key={ride.id} ride={ride} disabled={busy} onPress={() => runAction(() => api.acceptRide(ride.id, driver.id), "Viaje aceptado")} />
      ))}
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
