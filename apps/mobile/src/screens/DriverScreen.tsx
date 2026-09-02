// Pantalla del conductor (ticket ARC-001).
//
// Shell del turno: composición de pestañas, modales y cabecera. GPS, ofertas,
// evidencia y ruta viven en `useDriverShift` (paridad Uber Driver: cockpit vs
// lógica de turno).

import { useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { styles } from "../styles";
import { ServiceChatModal } from "../ui";
import type { AppState, Driver } from "../types";
import { DriverAccountPanel } from "./DriverAccountPanel";
import { DriverNavigationModal, SignatureCaptureModal } from "./DriverDeliveryModals";
import { DriverEarningsPanel } from "./DriverEarningsPanel";
import { DriverHomePanel } from "./DriverHomePanel";
import { DriverInboxPanel } from "./DriverInboxPanel";
import { useDriverShift } from "./useDriverShift";

// Marcador ASCII único para `test:mobile-variant-bundles` (Hermes lo conserva).
// Debe coincidir con la etiqueta GPS del turno en `useDriverShift`.
export const DRIVER_VARIANT_MARKER = "Ubicacion GPS";

export function DriverScreen({
  state,
  driver,
  busy,
  runAction,
  onLogout,
  onRefresh,
}: {
  state: AppState;
  driver: Driver;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
  onLogout: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [driverView, setDriverView] = useState<"home" | "earnings" | "inbox" | "account">("home");
  const driverScrollRef = useRef<ScrollView>(null);
  const shift = useDriverShift({ state, driver, driverView });
  if (shift.gpsLabel !== DRIVER_VARIANT_MARKER) {
    throw new Error("Etiqueta GPS del turno desalineada del marcador de variante");
  }

  useEffect(() => {
    driverScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [driverView]);

  return (
    <View style={styles.driverShell}>
      <SignatureCaptureModal
        visible={Boolean(shift.signatureShipmentId)}
        onClose={() => {
          if (!shift.deliveryEvidenceUploading) shift.setSignatureShipmentId(null);
        }}
        onSave={shift.saveDeliverySignature}
        busy={Boolean(shift.deliveryEvidenceUploading)}
      />
      <ServiceChatModal
        jobId={shift.chatJobId}
        currentUserId={driver.userId}
        onClose={() => shift.setChatJobId(null)}
      />
      <DriverNavigationModal
        visible={shift.navigationOpen}
        target={shift.navigationTarget}
        origin={shift.driverPoint}
        route={shift.driverRoute}
        routeError={shift.driverRouteError}
        vehicleIcon={shift.activeVehicle?.kind === "bicycle" ? "bicycle" : "car-sport"}
        onExternal={() => void shift.openExternalNavigation()}
        onChat={() => {
          shift.setNavigationOpen(false);
          if (shift.navigationTarget) shift.setChatJobId(shift.navigationTarget.id);
        }}
        onClose={() => shift.setNavigationOpen(false)}
      />
      <ScrollView
        ref={driverScrollRef}
        contentContainerStyle={styles.driverContent}
        refreshControl={
          <RefreshControl
            refreshing={busy}
            onRefresh={async () => {
              await Promise.all([onRefresh(), shift.loadDriverDemand(), shift.loadOffers()]);
            }}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.driverAppHeader}>
          <View>
            <Text style={styles.driverBrand}>FLASH DRIVER</Text>
            <Text style={styles.driverGreeting}>
              {driverView === "home"
                ? "Tu jornada"
                : driverView === "earnings"
                  ? "Ganancias"
                  : driverView === "inbox"
                    ? "Inbox"
                    : "Cuenta"}
            </Text>
          </View>
          <Pressable
            style={styles.driverHeaderAction}
            onPress={() => void onLogout()}
            accessibilityRole="button"
            accessibilityLabel="Cerrar sesión"
          >
            <Ionicons name="log-out-outline" size={22} color="#17131c" />
          </Pressable>
        </View>
        {driverView === "account" && (
          <DriverAccountPanel
            driverId={driver.id}
            vehicles={shift.vehicles}
            onVehiclesChange={shift.setVehicles}
            preferences={shift.driverPreferences}
            onPreferencesChange={shift.setDriverPreferences}
          />
        )}
        {driverView === "earnings" && (
          <DriverEarningsPanel
            driverId={driver.id}
            fallbackEarningsToday={driver.earningsToday}
            rating={driver.rating}
          />
        )}
        {driverView === "inbox" && (
          <DriverInboxPanel
            activeChats={shift.activeChats}
            onOpenChat={shift.setChatJobId}
            onUnreadChange={shift.setInboxUnread}
          />
        )}
        {driverView === "home" && (
          <DriverHomePanel
            driver={driver}
            busy={busy}
            runAction={runAction}
            backgroundGps={shift.backgroundGps}
            setBackgroundGps={shift.setBackgroundGps}
            gpsStatus={shift.gpsStatus}
            navigationTarget={shift.navigationTarget}
            driverPoint={shift.driverPoint}
            driverRoute={shift.driverRoute}
            driverRouteError={shift.driverRouteError}
            activeVehicle={shift.activeVehicle}
            driverDemand={shift.driverDemand}
            driverDemandLoading={shift.driverDemandLoading}
            driverDemandError={shift.driverDemandError}
            loadDriverDemand={shift.loadDriverDemand}
            activeOrders={shift.activeOrders}
            activeRides={shift.activeRides}
            activeShipments={shift.activeShipments}
            deliveryPins={shift.deliveryPins}
            setDeliveryPins={shift.setDeliveryPins}
            ridePickupPins={shift.ridePickupPins}
            setRidePickupPins={shift.setRidePickupPins}
            deliveryEvidenceReady={shift.deliveryEvidenceReady}
            deliverySignatureReady={shift.deliverySignatureReady}
            deliveryEvidenceUploading={shift.deliveryEvidenceUploading}
            setSignatureShipmentId={shift.setSignatureShipmentId}
            captureDeliveryEvidence={shift.captureDeliveryEvidence}
            visibleOffers={shift.visibleOffers}
            offersLoading={shift.offersLoading}
            offerBusy={shift.offerBusy}
            setOfferBusy={shift.setOfferBusy}
            loadOffers={shift.loadOffers}
            clock={shift.clock}
            setNavigationOpen={shift.setNavigationOpen}
            setChatJobId={shift.setChatJobId}
            openExternalNavigation={shift.openExternalNavigation}
          />
        )}
      </ScrollView>
      <View style={styles.driverBottomNav}>
        {(
          [
            ["home", "map-outline", "Mapa"],
            ["earnings", "wallet-outline", "Ganancias"],
            ["inbox", "chatbox-ellipses-outline", "Inbox"],
            ["account", "person-circle-outline", "Cuenta"],
          ] as const
        ).map(([value, icon, label]) => (
          <Pressable
            key={value}
            style={styles.driverBottomItem}
            onPress={() => setDriverView(value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: driverView === value }}
          >
            <View style={styles.driverBottomIconWrap}>
              <Ionicons
                name={icon}
                size={22}
                color={driverView === value ? "#7c3cff" : "#8a828f"}
              />
              {value === "inbox" && shift.inboxUnread > 0 ? (
                <View style={styles.driverBottomDot} />
              ) : null}
            </View>
            <Text
              style={[
                styles.driverBottomLabel,
                driverView === value && styles.driverBottomLabelActive,
              ]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
