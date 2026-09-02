// Home operativo del conductor (ARC-001).
//
// Disponibilidad, demanda por zonas, trabajo activo, jobs y ofertas. Sale de
// DriverScreen; el shell conserva GPS, navegación modal y evidencia porque
// cruzan pestañas.

import { type Dispatch, type SetStateAction } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { api } from "../api";
import {
  startDriverBackgroundLocation,
  stopDriverBackgroundLocation,
  type BackgroundLocationState,
} from "../background-location";
import DriverDemandMap from "../DriverDemandMap";
import FlashNativeMap from "../FlashNativeMap";
import { money, navigationInstruction } from "../format";
import { styles } from "../styles";
import { ActionButton, KpiRow, NativeMapUnavailable, OrderCard } from "../ui";
import type {
  AppState,
  DispatchOffer,
  Driver,
  DriverDemand,
  DriverVehicle,
  GeoPoint,
  RoadRoute,
} from "../types";
import type { DriverNavigationTarget } from "./DriverDeliveryModals";
import { RideCard, ShipmentCard } from "./DriverJobCards";

export function DriverHomePanel(props: {
  driver: Driver;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
  backgroundGps: BackgroundLocationState;
  setBackgroundGps: (value: BackgroundLocationState) => void;
  gpsStatus: "paused" | "requesting" | "live" | "denied";
  navigationTarget: DriverNavigationTarget | null;
  driverPoint: GeoPoint | null;
  driverRoute: RoadRoute | null;
  driverRouteError: string;
  activeVehicle: DriverVehicle | null;
  driverDemand: DriverDemand | null;
  driverDemandLoading: boolean;
  driverDemandError: string;
  loadDriverDemand: () => Promise<void>;
  activeOrders: AppState["orders"];
  activeRides: AppState["rides"];
  activeShipments: AppState["shipments"];
  deliveryPins: Record<string, string>;
  setDeliveryPins: Dispatch<SetStateAction<Record<string, string>>>;
  ridePickupPins: Record<string, string>;
  setRidePickupPins: Dispatch<SetStateAction<Record<string, string>>>;
  deliveryEvidenceReady: Record<string, boolean>;
  deliverySignatureReady: Record<string, boolean>;
  deliveryEvidenceUploading: string | null;
  setSignatureShipmentId: (id: string | null) => void;
  captureDeliveryEvidence: (shipmentId: string) => Promise<void>;
  visibleOffers: DispatchOffer[];
  offersLoading: boolean;
  offerBusy: string | null;
  setOfferBusy: (id: string | null) => void;
  loadOffers: () => Promise<void>;
  clock: number;
  setNavigationOpen: (open: boolean) => void;
  setChatJobId: (id: string | null) => void;
  openExternalNavigation: () => Promise<void>;
}) {
  const {
    driver,
    busy,
    runAction,
    setBackgroundGps,
    gpsStatus,
    navigationTarget,
    driverPoint,
    driverRoute,
    driverRouteError,
    activeVehicle,
    driverDemand,
    driverDemandLoading,
    driverDemandError,
    loadDriverDemand,
    activeOrders,
    activeRides,
    activeShipments,
    deliveryPins,
    setDeliveryPins,
    ridePickupPins,
    setRidePickupPins,
    deliveryEvidenceReady,
    deliverySignatureReady,
    deliveryEvidenceUploading,
    setSignatureShipmentId,
    captureDeliveryEvidence,
    visibleOffers,
    offersLoading,
    offerBusy,
    setOfferBusy,
    loadOffers,
    clock,
    setNavigationOpen,
    setChatJobId,
    openExternalNavigation,
    backgroundGps,
  } = props;

  return (
    <>
      <View style={styles.actionRow}>
        <ActionButton
          label={driver.online ? "Pausar" : "Activar"}
          disabled={busy}
          onPress={() =>
            runAction(async () => {
              if (driver.online) {
                await api.updateDriver(driver.id, { online: false });
                setBackgroundGps(await stopDriverBackgroundLocation());
              } else {
                await api.updateDriver(driver.id, { online: true });
                const tracking = await startDriverBackgroundLocation();
                setBackgroundGps(tracking);
                if (tracking !== "active")
                  Alert.alert(
                    "Ubicación limitada",
                    tracking === "foreground_only"
                      ? "Seguirás online, pero esta instalación sólo enviará GPS mientras la app esté abierta. Para background usá un development build y habilitá el permiso Siempre."
                      : "Habilitá ubicación para recibir ofertas y compartir seguimiento.",
                  );
              }
            }, "Disponibilidad actualizada")
          }
        />
        <ActionButton
          label={driver.activeService === "delivery" ? "Modo taxi" : "Modo delivery"}
          disabled={busy}
          onPress={() =>
            runAction(
              () =>
                api.updateDriver(driver.id, {
                  activeService: driver.activeService === "delivery" ? "ride" : "delivery",
                }),
              "Modo actualizado",
            )
          }
        />
      </View>
      <View style={styles.driverSectionHeading}>
        <View>
          <Text style={styles.driverSectionEyebrow}>
            {navigationTarget ? "SERVICIO EN CURSO" : "ACTIVIDAD OBSERVADA"}
          </Text>
          <Text style={styles.sectionTitle}>
            {navigationTarget ? "Trabajo activo" : "Demanda por zonas"}
          </Text>
        </View>
        {!navigationTarget ? (
          <Pressable
            onPress={() => void loadDriverDemand()}
            disabled={driverDemandLoading}
            accessibilityRole="button"
            accessibilityLabel="Actualizar demanda por zonas"
          >
            <Ionicons name="refresh-outline" size={21} color="#7c3cff" />
          </Pressable>
        ) : null}
      </View>
      {navigationTarget ? (
        driverPoint && navigationTarget.point ? (
          <FlashNativeMap
            origin={driverPoint}
            destination={navigationTarget.point}
            route={driverRoute?.coordinates || []}
            originRole="driver"
            driverIcon={activeVehicle?.kind === "bicycle" ? "bicycle" : "car-sport"}
            routeColor={
              navigationTarget.kind === "Comida"
                ? "#ff6a21"
                : navigationTarget.kind === "Envío"
                  ? "#087a50"
                  : "#7c3cff"
            }
            caption={`${navigationTarget.kind} · ${navigationTarget.phase}`}
            detail={
              driverRoute
                ? `${driverRoute.distanceKm} km · ${driverRoute.durationMin} min`
                : driverRouteError || "Calculando recorrido vial…"
            }
            height={270}
            accessibilityLabel="Mapa interactivo de navegación del conductor"
          />
        ) : (
          <NativeMapUnavailable
            message={
              driverPoint
                ? "El servicio todavía no tiene un punto geográfico verificable."
                : "Activá el GPS para calcular el recorrido al próximo punto."
            }
            height={270}
          />
        )
      ) : driverDemandLoading && !driverDemand ? (
        <View style={styles.driverDemandLoading}>
          <ActivityIndicator color="#7c3cff" />
          <Text style={styles.cardText}>Consultando trabajos y oferta elegible en PostgreSQL…</Text>
        </View>
      ) : driverDemand?.zones.length ? (
        <>
          <DriverDemandMap
            zones={driverDemand.zones}
            driver={driverPoint}
            caption={`${driverDemand.city.name} · ${driver.activeService === "delivery" ? "Delivery" : "Viajes"}`}
            detail={`Observado ${new Date(driverDemand.observedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`}
            accessibilityLabel="Mapa nativo de demanda agregada para conductores"
          />
          {driverDemandError ? (
            <Pressable style={styles.driverDemandError} onPress={() => void loadDriverDemand()}>
              <Ionicons name="cloud-offline-outline" size={20} color="#a33939" />
              <View style={styles.itemCopy}>
                <Text style={styles.sectionTitle}>Snapshot sin actualizar</Text>
                <Text style={styles.cardText}>
                  {driverDemandError} · Conservamos la hora visible del último dato.
                </Text>
              </View>
            </Pressable>
          ) : null}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.driverDemandRail}
          >
            {driverDemand.zones.map((zone) => {
              const color =
                zone.level === "high" ? "#ce263b" : zone.level === "medium" ? "#e66d13" : "#857b8b";
              return (
                <View
                  key={zone.id}
                  style={[
                    styles.driverDemandCard,
                    zone.containsDriver && styles.driverDemandCardCurrent,
                  ]}
                >
                  <View style={styles.driverDemandCardTop}>
                    <View style={[styles.driverDemandLevelDot, { backgroundColor: color }]} />
                    <Text style={[styles.driverDemandLevel, { color }]}>
                      {zone.level === "high"
                        ? "ALTA"
                        : zone.level === "medium"
                          ? "MEDIA"
                          : "SIN PEDIDOS"}
                    </Text>
                    {zone.containsDriver ? <Text style={styles.driverDemandHere}>ACÁ</Text> : null}
                  </View>
                  <Text style={styles.driverDemandName}>{zone.name}</Text>
                  <Text style={styles.driverDemandJobs}>
                    {zone.openJobs === 0
                      ? "Sin trabajos abiertos"
                      : `${zone.openJobs} ${zone.openJobs === 1 ? "trabajo" : "trabajos"} sin asignar`}
                  </Text>
                  <Text style={styles.driverDemandSupply}>
                    {zone.eligibleDrivers}{" "}
                    {zone.eligibleDrivers === 1 ? "conductor elegible" : "conductores elegibles"}
                  </Text>
                </View>
              );
            })}
          </ScrollView>
          <View style={styles.driverTransparencyCard}>
            <Ionicons name="information-circle-outline" size={22} color="#087a50" />
            <View style={styles.itemCopy}>
              <Text style={styles.sectionTitle}>Actividad, no promesa</Text>
              <Text style={styles.cardText}>
                Es un conteo zonal actual: no garantiza una oferta o ganancia y no modifica la
                tarifa. Nunca muestra la ubicación de otras personas.
              </Text>
            </View>
          </View>
        </>
      ) : (
        <Pressable style={styles.driverDemandError} onPress={() => void loadDriverDemand()}>
          <Ionicons
            name={driverDemandError ? "cloud-offline-outline" : "map-outline"}
            size={22}
            color="#a33939"
          />
          <View style={styles.itemCopy}>
            <Text style={styles.sectionTitle}>
              {driverDemandError ? "No pudimos leer las zonas" : "No hay zonas operativas"}
            </Text>
            <Text style={styles.cardText}>
              {driverDemandError ||
                "Operaciones todavía no publicó polígonos activos para esta ciudad."}{" "}
              · Tocá para reintentar.
            </Text>
          </View>
        </Pressable>
      )}
      {driverRoute?.steps[0] && (
        <View style={styles.driverNavigation}>
          <View style={styles.navigationTurn}>
            <Ionicons
              name={
                driverRoute.steps[0].modifier.includes("left")
                  ? "arrow-back"
                  : driverRoute.steps[0].modifier.includes("right")
                    ? "arrow-forward"
                    : "arrow-up"
              }
              size={26}
              color="#fff"
            />
          </View>
          <View style={styles.itemCopy}>
            <Text style={styles.navigationLabel}>
              {navigationTarget?.kind.toUpperCase()} · {navigationTarget?.phase.toUpperCase()}
            </Text>
            <Text style={styles.navigationInstruction}>
              {navigationInstruction(driverRoute.steps[0])}
            </Text>
            <Text style={styles.helperText}>
              {driverRoute.distanceKm} km · {driverRoute.durationMin} min restantes
            </Text>
            <Text style={styles.helperText} numberOfLines={1}>
              {navigationTarget?.address}
            </Text>
          </View>
          <Pressable
            style={styles.proofCameraButton}
            onPress={() => setNavigationOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Abrir guía operativa del conductor"
          >
            <Ionicons name="navigate" size={19} color="#fff" />
            <Text style={styles.primaryButtonText}>Ver guía</Text>
          </Pressable>
        </View>
      )}
      {driverRouteError ? <Text style={styles.complianceRejection}>{driverRouteError}</Text> : null}
      <View style={styles.cardDark}>
        <Text style={styles.heroLabel}>{driver.online ? "Online" : "Offline"}</Text>
        <Text style={styles.heroTitle}>{driver.name}</Text>
        <Text style={styles.heroCopy}>
          {driver.vehicle} - {driver.plate} - rating {driver.rating}
        </Text>
        <Text style={styles.gpsText}>
          {gpsStatus === "live"
            ? "GPS activo"
            : gpsStatus === "requesting"
              ? "Solicitando GPS"
              : gpsStatus === "denied"
                ? "GPS no disponible"
                : "GPS pausado"}
        </Text>
        <Text style={styles.gpsText}>
          {backgroundGps === "active"
            ? "Segundo plano activo"
            : backgroundGps === "foreground_only"
              ? "Sólo mientras la app está abierta"
              : backgroundGps === "denied"
                ? "Permiso background rechazado"
                : "Segundo plano detenido"}{" "}
          · sesión {api.sessionStorage === "native-keychain-keystore" ? "protegida" : "web"}
        </Text>
      </View>
      <KpiRow
        items={[
          ["Ganancias", driver.earningsToday],
          ["Activos", activeOrders.length + activeRides.length + activeShipments.length],
          ["Ofertas", visibleOffers.length],
          ["Modo", driver.activeService === "delivery" ? "Delivery" : "Taxi"],
        ]}
      />
      {activeOrders.map((order) => (
        <View key={order.id} style={styles.stack}>
          <OrderCard
            order={order}
            disabled={busy}
            onPress={() => runAction(() => api.advanceOrder(order.id), "Delivery avanzado")}
          />
          <Pressable style={styles.shareAction} onPress={() => setChatJobId(order.id)}>
            <Ionicons name="chatbubbles-outline" size={18} color="#7c3cff" />
            <Text style={styles.shareActionText}>Chat del servicio</Text>
          </Pressable>
        </View>
      ))}
      {activeRides.map((ride) => (
        <View key={ride.id} style={styles.stack}>
          <RideCard
            ride={ride}
            disabled={busy || ride.status === "arriving"}
            onPress={() => runAction(() => api.advanceRide(ride.id), "Viaje avanzado")}
          />
          <Pressable style={styles.shareAction} onPress={() => setChatJobId(ride.id)}>
            <Ionicons name="chatbubbles-outline" size={18} color="#7c3cff" />
            <Text style={styles.shareActionText}>Chat con pasajero</Text>
          </Pressable>
          {ride.status === "arriving" ? (
            <View style={styles.deliveryProofCard}>
              <View style={[styles.deliveryProofIcon, { backgroundColor: "#7c3cff" }]}>
                <Ionicons name="keypad-outline" size={22} color="#fff" />
              </View>
              <View style={styles.itemCopy}>
                <Text style={styles.sectionTitle}>Verificá al pasajero</Text>
                <Text style={styles.cardText}>Pedile el PIN de 4 dígitos antes de iniciar.</Text>
                <TextInput
                  value={ridePickupPins[ride.id] || ""}
                  onChangeText={(value) =>
                    setRidePickupPins((current) => ({
                      ...current,
                      [ride.id]: value.replace(/\D/g, "").slice(0, 4),
                    }))
                  }
                  keyboardType="numeric"
                  secureTextEntry
                  maxLength={4}
                  placeholder="••••"
                  style={styles.input}
                />
              </View>
              <Pressable
                disabled={busy || (ridePickupPins[ride.id] || "").length !== 4}
                style={[
                  styles.proofCameraButton,
                  (busy || (ridePickupPins[ride.id] || "").length !== 4) && styles.disabledButton,
                ]}
                onPress={() =>
                  runAction(async () => {
                    await api.verifyRidePickup(ride.id, ridePickupPins[ride.id]);
                    await api.advanceRide(ride.id);
                    setRidePickupPins((current) => ({ ...current, [ride.id]: "" }));
                  }, "Pasajero verificado; viaje iniciado")
                }
              >
                <Ionicons name="shield-checkmark-outline" size={18} color="#fff" />
                <Text style={styles.primaryButtonText}>Verificar e iniciar</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ))}
      {activeShipments.map((shipment) => (
        <View key={shipment.id} style={styles.stack}>
          <ShipmentCard
            shipment={shipment}
            disabled={busy}
            pin={deliveryPins[shipment.id] || ""}
            onPinChange={(pin) =>
              setDeliveryPins((current) => ({
                ...current,
                [shipment.id]: pin.replace(/\D/g, "").slice(0, 4),
              }))
            }
            onPress={() =>
              runAction(
                () =>
                  shipment.status === "delivering"
                    ? api.verifyShipmentDelivery(shipment.id, deliveryPins[shipment.id] || "")
                    : api.advanceShipment(shipment.id),
                shipment.status === "delivering" ? "Entrega verificada" : "Envio avanzado",
              )
            }
          />
          <Pressable style={styles.shareAction} onPress={() => setChatJobId(shipment.id)}>
            <Ionicons name="chatbubbles-outline" size={18} color="#7c3cff" />
            <Text style={styles.shareActionText}>Chat con cliente</Text>
          </Pressable>
          {shipment.status === "delivering" && (
            <>
              <View style={styles.deliveryProofCard}>
                <View style={styles.deliveryProofIcon}>
                  <Ionicons
                    name={deliveryEvidenceReady[shipment.id] ? "shield-checkmark" : "camera"}
                    size={22}
                    color="#fff"
                  />
                </View>
                <View style={styles.itemCopy}>
                  <Text style={styles.sectionTitle}>
                    {deliveryEvidenceReady[shipment.id] ? "Foto protegida" : "Prueba de entrega"}
                  </Text>
                  <Text style={styles.cardText}>
                    {deliveryEvidenceReady[shipment.id]
                      ? "Foto cifrada lista."
                      : "Tomá una foto en destino antes de pedir el PIN."}
                  </Text>
                </View>
                <Pressable
                  disabled={deliveryEvidenceUploading === shipment.id || busy}
                  style={[
                    styles.proofCameraButton,
                    (deliveryEvidenceUploading === shipment.id || busy) && styles.disabledButton,
                  ]}
                  onPress={() => void captureDeliveryEvidence(shipment.id)}
                >
                  <Ionicons name="camera-outline" size={18} color="#fff" />
                  <Text style={styles.primaryButtonText}>
                    {deliveryEvidenceUploading === shipment.id
                      ? "Guardando…"
                      : deliveryEvidenceReady[shipment.id]
                        ? "Repetir"
                        : "Tomar foto"}
                  </Text>
                </Pressable>
              </View>
              {shipment.signatureRequired && (
                <View style={styles.deliveryProofCard}>
                  <View style={[styles.deliveryProofIcon, { backgroundColor: "#17131c" }]}>
                    <Ionicons
                      name={deliverySignatureReady[shipment.id] ? "checkmark" : "pencil"}
                      size={22}
                      color="#fff"
                    />
                  </View>
                  <View style={styles.itemCopy}>
                    <Text style={styles.sectionTitle}>
                      {deliverySignatureReady[shipment.id] ? "Firma protegida" : "Firma requerida"}
                    </Text>
                    <Text style={styles.cardText}>
                      {deliverySignatureReady[shipment.id]
                        ? "Identidad y consentimiento cifrados."
                        : "Pedile al receptor que firme en pantalla."}
                    </Text>
                  </View>
                  <Pressable
                    disabled={deliveryEvidenceUploading === shipment.id || busy}
                    style={[
                      styles.proofCameraButton,
                      (deliveryEvidenceUploading === shipment.id || busy) && styles.disabledButton,
                    ]}
                    onPress={() => setSignatureShipmentId(shipment.id)}
                  >
                    <Ionicons name="create-outline" size={18} color="#fff" />
                    <Text style={styles.primaryButtonText}>
                      {deliverySignatureReady[shipment.id] ? "Repetir" : "Firmar"}
                    </Text>
                  </Pressable>
                </View>
              )}
            </>
          )}
        </View>
      ))}
      {activeOrders.length === 0 && activeRides.length === 0 && activeShipments.length === 0 && (
        <Text style={styles.muted}>No tienes trabajos activos.</Text>
      )}
      <Text style={styles.sectionTitle}>Ofertas</Text>
      {offersLoading && visibleOffers.length === 0 && <ActivityIndicator color="#7c3cff" />}
      {visibleOffers.map((offer) => {
        const seconds = Math.max(
          0,
          Math.ceil((new Date(offer.expiresAt).getTime() - clock) / 1000),
        );
        const accepting = offerBusy === offer.id;
        return (
          <View key={offer.id} style={styles.dispatchOffer}>
            <View style={styles.dispatchOfferHeader}>
              <View style={styles.dispatchOfferIcon}>
                <Ionicons
                  name={offer.kind === "ride" ? "car-sport" : "cube"}
                  size={22}
                  color="#fff"
                />
              </View>
              <View style={styles.itemCopy}>
                <Text style={styles.dispatchOfferType}>
                  {offer.kind === "ride"
                    ? "NUEVO VIAJE"
                    : offer.subtype === "shipment"
                      ? "NUEVO ENVÍO"
                      : "NUEVO DELIVERY"}
                </Text>
                <Text style={styles.dispatchOfferTimer}>{seconds}s</Text>
              </View>
              <Text style={styles.dispatchOfferFare}>{money.format(offer.fare)}</Text>
            </View>
            <View style={styles.dispatchRoute}>
              <View style={styles.routeDot} />
              <Text style={styles.dispatchAddress} numberOfLines={1}>
                {offer.pickup}
              </Text>
            </View>
            <View style={styles.dispatchRoute}>
              <View style={[styles.routeDot, styles.routeDotDestination]} />
              <Text style={styles.dispatchAddress} numberOfLines={1}>
                {offer.destination}
              </Text>
            </View>
            <Text style={styles.helperText}>
              {offer.distanceKm} km · {offer.durationMin} min · puntaje {Math.round(offer.score)}
            </Text>
            {offer.scoreBreakdown && (
              <Text style={styles.helperText}>
                Historial: {Math.round(offer.scoreBreakdown.acceptanceRate * 100)}% aceptación ·{" "}
                {Math.round(offer.scoreBreakdown.averageResponseSeconds)}s respuesta
              </Text>
            )}
            <View style={styles.offerActions}>
              <Pressable
                disabled={busy || accepting || seconds === 0}
                style={styles.rejectOfferButton}
                onPress={async () => {
                  setOfferBusy(offer.id);
                  await runAction(() => api.rejectDriverOffer(offer.id), "Oferta rechazada");
                  await loadOffers();
                  setOfferBusy(null);
                }}
              >
                <Text style={styles.rejectOfferText}>Rechazar</Text>
              </Pressable>
              <Pressable
                disabled={busy || accepting || seconds === 0}
                style={styles.acceptOfferButton}
                onPress={async () => {
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
              >
                {accepting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.acceptOfferText}>Aceptar</Text>
                )}
              </Pressable>
            </View>
          </View>
        );
      })}
      {!offersLoading && visibleOffers.length === 0 && (
        <Text style={styles.muted}>
          {driver.online
            ? "No hay ofertas vigentes para el modo seleccionado."
            : "Actívate para recibir ofertas."}
        </Text>
      )}
    </>
  );
}
