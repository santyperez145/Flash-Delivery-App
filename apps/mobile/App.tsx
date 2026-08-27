import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Location from "expo-location";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Network from "expo-network";
import * as Sharing from "expo-sharing";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { captureRef } from "react-native-view-shot";
import Svg, { Path } from "react-native-svg";
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";
import { api, mobileAppVariant } from "./src/api";
import { configureAnalytics, track } from "./src/analytics";
import FlashNativeMap from "./src/FlashNativeMap";
import DriverDemandMap from "./src/DriverDemandMap";
import { flashDesign } from "./src/design-system";
import { buildExternalNavigationUrl } from "./src/navigation-links";
import {
  getBackgroundLocationState,
  startDriverBackgroundLocation,
  stopDriverBackgroundLocation,
  type BackgroundLocationState,
} from "./src/background-location";
import type {
  AppState,
  DispatchOffer,
  Driver,
  DriverCompliance,
  DriverDemand,
  DriverDocument,
  DriverEarnings,
  DriverPreferences,
  DriverVehicle,
  FoodCheckoutQuote,
  GeoPoint,
  MerchantOperationsDashboard,
  Mode,
  Order,
  OrderSubstitution,
  AppNotification,
  NotificationPreference,
  DietaryPreferences,
  Restaurant,
  Ride,
  RideDestination,
  RideTrustedContact,
  RideQuote,
  RideService,
  ServiceReceipt,
  ServiceMessage,
  Shipment,
  ShipmentQuote,
  ShipmentOptions,
  ShipmentReturn,
  ShipmentClaim,
  User,
  RoadRoute,
  RoadStep,
} from "./src/types";
import {
  compactMoney,
  mobileOrderStatusLabel,
  money,
  navigationInstruction,
  operationalDuration,
} from "./src/format";

import { styles } from "./src/styles";
import { ActionButton, KpiRow, NativeMapUnavailable, OrderCard, ServiceChatModal } from "./src/ui";
import { CustomerScreen } from "./src/screens/CustomerScreen";
import { DriverScreen } from "./src/screens/DriverScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MerchantScreen } from "./src/screens/MerchantScreen";

function MobileNetworkStatus({ online }: { online: boolean }) {
  if (online) return null;
  return (
    <View style={styles.networkStatusBanner} accessibilityRole="alert">
      <View style={styles.networkStatusIcon}>
        <Ionicons name="cloud-offline-outline" size={18} color="#fff" />
      </View>
      <View style={styles.networkStatusCopy}>
        <Text style={styles.networkStatusTitle}>Sin conexión</Text>
        <Text style={styles.networkStatusText}>
          Las acciones nuevas esperan hasta recuperar internet.
        </Text>
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const [mode, setMode] = useState<Mode>(mobileAppVariant);
  const [state, setState] = useState<AppState | null>(null);
  const [sessionUser, setSessionUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const networkState = Network.useNetworkState();
  const networkOnline =
    networkState.isConnected !== false && networkState.isInternetReachable !== false;
  const previousNetwork = useRef(networkOnline);
  const lastAppHomeAnalyticsKey = useRef("");

  useEffect(() => configureAnalytics((events) => api.sendAnalyticsEvents(events)), []);

  useEffect(() => {
    if (!sessionUser) return;
    const surface =
      mode === "driver" ? "driver_app" : mode === "merchant" ? "merchant_app" : "customer_app";
    const key = `${sessionUser.id}:${surface}`;
    if (lastAppHomeAnalyticsKey.current === key) return;
    lastAppHomeAnalyticsKey.current = key;
    track("home_viewed", surface, { mode });
  }, [mode, sessionUser]);

  const refresh = useCallback(async () => {
    const response = await api.state();
    setState(response.state);
  }, []);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const user = await api.restoreSession();
      if (user) {
        setSessionUser(user);
        setMode(mobileAppVariant);
        await refresh();
      }
    } catch (error) {
      Alert.alert("Flash", error instanceof Error ? error.message : "No se pudo cargar");
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const wasOnline = previousNetwork.current;
    previousNetwork.current = networkOnline;
    if (!wasOnline && networkOnline && sessionUser) {
      void refresh().catch(() => undefined);
    }
  }, [networkOnline, refresh, sessionUser]);

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
    [refresh],
  );

  const login = async (email: string, password: string) => {
    setBusy(true);
    try {
      const user = await api.login(email, password);
      setSessionUser(user);
      setMode(mobileAppVariant);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const register = async (input: {
    name: string;
    email: string;
    password: string;
    phone?: string;
  }) => {
    setBusy(true);
    try {
      return await api.register(input);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await stopDriverBackgroundLocation().catch(() => undefined);
    await api.logout();
    setSessionUser(null);
    setState(null);
  };

  const activeRestaurant =
    state?.restaurants.find((restaurant) => restaurant.id === sessionUser?.restaurantId) || null;
  const activeDriver = state?.drivers.find((driver) => driver.id === sessionUser?.driverId) || null;
  const activeUser = state?.users.find((user) => user.id === sessionUser?.id) || sessionUser;

  if (!loading && !sessionUser)
    return (
      <SafeAreaView style={styles.loginSafeArea}>
        <View style={[styles.appViewport, styles.customerViewport]}>
          <LoginScreen busy={busy} onLogin={login} onRegister={register} />
        </View>
      </SafeAreaView>
    );

  return (
    <SafeAreaView style={[styles.root, mode === "customer" && styles.customerRoot]}>
      <View
        style={[
          styles.appViewport,
          mode === "customer" ? styles.customerViewport : styles.operationsViewport,
        ]}
      >
        <MobileNetworkStatus online={networkOnline} />
        {mode === "merchant" && (
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>Flash Negocios</Text>
              <Text style={styles.title}>Control en vivo de tu local</Text>
            </View>
            <Pressable onPress={logout} style={styles.logoutButton}>
              <Text style={styles.logoutText}>Salir</Text>
            </Pressable>
          </View>
        )}

        {mode === "merchant" && (
          <View style={styles.sessionBar}>
            <Text style={styles.sessionRole}>Cuenta comercio</Text>
            <Text style={styles.sessionName} numberOfLines={1}>
              {sessionUser?.name}
            </Text>
          </View>
        )}

        {loading || !state ? (
          <View style={styles.loader}>
            <ActivityIndicator color="#f4511e" />
            <Text style={styles.muted}>Conectando con backend...</Text>
          </View>
        ) : mode === "customer" && activeUser ? (
          <CustomerScreen
            state={state}
            user={activeUser}
            busy={busy}
            runAction={runAction}
            refresh={refresh}
            onLogout={logout}
          />
        ) : mode === "driver" && activeDriver ? (
          <DriverScreen
            state={state}
            driver={activeDriver}
            busy={busy}
            runAction={runAction}
            onLogout={logout}
            onRefresh={refresh}
          />
        ) : mode === "merchant" && activeRestaurant ? (
          <MerchantScreen
            restaurant={activeRestaurant}
            orders={state.orders}
            busy={busy}
            runAction={runAction}
            onRefresh={refresh}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}
