// Viajes del cliente (ARC-001): origen/destino, cotización, reserva y seguridad.
// Permanece montado al cambiar de pestaña para conservar una cotización en curso.
import { useEffect, useMemo, useRef, useState } from "react";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { track } from "../analytics";
import { api } from "../api";
import FlashNativeMap from "../FlashNativeMap";
import { money } from "../format";
import { styles } from "../styles";
import { ActionButton, NativeMapUnavailable } from "../ui";
import type {
  AppState,
  GeoPoint,
  Ride,
  RideDestination,
  RideQuote,
  RideService,
  RideTrustedContact,
  RoadRoute,
  User,
} from "../types";

type SharedAddressSelection = {
  address: string;
  point: GeoPoint | null;
};

type CustomerRideScreenProps = {
  visible: boolean;
  addresses: AppState["addresses"];
  onlineDrivers: number;
  user: User;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
  activeRides: Ride[];
  trustedContacts: RideTrustedContact[];
  selectedAddress: SharedAddressSelection | null;
  onTrustedContactsChange: (contacts: RideTrustedContact[]) => void;
  onOpenTracking: (rideId: string) => void;
  onShareRide: (ride: Ride, contact?: RideTrustedContact) => void;
  onSos: (ride: Ride) => void;
  onCancelRide: (rideId: string) => void;
};

export function CustomerRideScreen({
  visible,
  addresses,
  onlineDrivers,
  user,
  busy,
  runAction,
  activeRides,
  trustedContacts,
  selectedAddress,
  onTrustedContactsChange,
  onOpenTracking,
  onShareRide,
  onSos,
  onCancelRide,
}: CustomerRideScreenProps) {
  const [pickup, setPickup] = useState(user.defaultAddress || "Ubicacion actual");
  const [destination, setDestination] = useState("");
  const [pickupCoords, setPickupCoords] = useState<GeoPoint | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<GeoPoint | null>(null);
  const [roadRoute, setRoadRoute] = useState<RoadRoute | null>(null);
  const [rideService, setRideService] = useState<RideService>("economy");
  const [rideQuote, setRideQuote] = useState<RideQuote | null>(null);
  const [rideOptions, setRideOptions] = useState<RideQuote[]>([]);
  const [rideDestinations, setRideDestinations] = useState<RideDestination[]>([]);
  const [trustedContactName, setTrustedContactName] = useState("");
  const [trustedContactPhone, setTrustedContactPhone] = useState("");
  const [trustedContactRelationship, setTrustedContactRelationship] =
    useState<RideTrustedContact["relationship"]>("family");
  const [rideSchedule, setRideSchedule] = useState<"now" | "hour" | "tomorrow">("now");
  const [locationMessage, setLocationMessage] = useState("");
  const defaultLocationSeededForUser = useRef("");

  useEffect(() => {
    let cancelled = false;
    void api
      .getRideDestinations()
      .then((result) => {
        if (!cancelled) setRideDestinations(result.destinations);
      })
      .catch(() => {
        if (!cancelled) setRideDestinations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  const rideQuickPlaces = useMemo(() => {
    const saved = addresses
        .filter((item) => item.userId === user.id && item.lat !== null && item.lng !== null)
        .map((item) => ({
          id: `saved-${item.id}`,
          icon: item.label.toLowerCase().includes("trab") ? "briefcase" : "home",
          label: item.label,
          address: item.address,
          point: { lat: item.lat!, lng: item.lng! },
          recentId: null as string | null,
        })),
      savedKeys = new Set(saved.map((item) => item.address.trim().toLowerCase())),
      recent = rideDestinations
        .filter((item) => !savedKeys.has(item.address.trim().toLowerCase()))
        .map((item) => ({
          id: `recent-${item.id}`,
          icon: "time",
          label: item.label,
          address: item.address,
          point: item.point,
          recentId: item.id,
        }));
    return [...saved, ...recent].slice(0, 8);
  }, [addresses, user.id, rideDestinations]);

  const invalidateQuote = () => {
    setRoadRoute(null);
    setRideQuote(null);
    setRideOptions([]);
  };

  useEffect(() => {
    if (defaultLocationSeededForUser.current === user.id) return;
    const locatedAddresses = addresses.filter(
      (item) => item.userId === user.id && item.lat !== null && item.lng !== null,
    );
    const normalizedDefaultAddress = user.defaultAddress?.trim().toLowerCase();
    const primaryAddress =
      locatedAddresses.find((item) => item.isDefault) ||
      locatedAddresses.find(
        (item) =>
          normalizedDefaultAddress &&
          item.address.trim().toLowerCase() === normalizedDefaultAddress,
      );
    if (!primaryAddress) return;
    defaultLocationSeededForUser.current = user.id;
    setPickup(primaryAddress.address);
    setPickupCoords({ lat: primaryAddress.lat!, lng: primaryAddress.lng! });
  }, [addresses, user.defaultAddress, user.id]);

  useEffect(() => {
    if (!selectedAddress) return;
    setPickup(selectedAddress.address);
    setPickupCoords(selectedAddress.point);
    invalidateQuote();
  }, [selectedAddress]);

  const useCurrentLocation = async () => {
    setLocationMessage("Solicitando ubicacion...");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setLocationMessage("Permiso de ubicacion rechazado");
        return;
      }
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setPickup("Ubicacion actual");
      setPickupCoords({
        lat: current.coords.latitude,
        lng: current.coords.longitude,
      });
      invalidateQuote();
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
    runAction(async () => {
      let resolvedPickup = pickupCoords;
      if (!resolvedPickup) {
        const originResult = await api.geocode(pickup.trim());
        resolvedPickup = originResult.results[0]?.point || null;
      }
      let destinationMatch: { label: string; point: GeoPoint; type: string } | undefined;
      let resolvedDestination = destinationCoords;
      if (!resolvedDestination) {
        const destinationResult = await api.geocode(destination.trim());
        destinationMatch = destinationResult.results[0];
        resolvedDestination = destinationMatch?.point || null;
      }
      if (!resolvedPickup || !resolvedDestination)
        throw new Error("No pudimos ubicar una de las direcciones en el mapa");
      const routed = await api.route(resolvedPickup, resolvedDestination);
      setPickupCoords(resolvedPickup);
      setDestinationCoords(resolvedDestination);
      setRoadRoute(routed.route);
      const response = await api.quoteRideOptions({
        pickup: pickup.trim(),
        destination: destination.trim(),
        pickupCoords: resolvedPickup,
        destinationCoords: resolvedDestination,
      });
      setRideOptions(response.options);
      setRideQuote(
        response.options.find((option) => option.service === rideService) || response.options[0],
      );
      track("quote_received", "customer_app", { service: "ride" });
      const recorded = await api
        .recordRideDestination({
          label: (destinationMatch?.label || destination.trim()).split(",")[0],
          address: destinationMatch?.label || destination.trim(),
          lat: resolvedDestination.lat,
          lng: resolvedDestination.lng,
        })
        .catch(() => null);
      if (recorded) setRideDestinations(recorded.destinations);
    }, "Cotizacion actualizada");
  };

  const requestRide = () => {
    if (!rideQuote?.quoteToken) {
      Alert.alert("Cotiza primero", "La tarifa debe confirmarse antes de solicitar el viaje.");
      return;
    }
    const quoteToken = rideQuote.quoteToken;
    const scheduledFor =
      rideSchedule === "hour"
        ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
        : rideSchedule === "tomorrow"
          ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          : undefined;
    runAction(
      async () => {
        await api.createRide({
          customerId: user.id,
          pickup: pickup.trim(),
          destination: destination.trim(),
          service: rideService,
          pickupCoords,
          destinationCoords,
          paymentMethod: "Flash Wallet",
          quoteToken,
          scheduledFor,
        });
        track("job_created", "customer_app", { service: "ride" });
      },
      scheduledFor ? "Viaje reservado" : "Viaje solicitado",
    );
  };

  if (!visible) return null;

  return (
    <>
      <View style={styles.rideHeading}>
        <View>
          <Text style={styles.rideEyebrow}>VIAJES</Text>
          <Text style={styles.rideTitle}>¿A dónde vamos?</Text>
        </View>
        <View style={styles.livePill}>
          <Text style={styles.livePillText}>{onlineDrivers} online</Text>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.quickPlacesRail}
      >
        {rideQuickPlaces.map((place) => (
          <Pressable
            key={place.id}
            onPress={() => {
              setDestination(place.address);
              setDestinationCoords(place.point);
              invalidateQuote();
            }}
            style={styles.quickPlace}
          >
            <View style={styles.quickPlaceIcon}>
              <Ionicons name={place.icon as never} size={18} color="#7c3cff" />
            </View>
            <View style={styles.quickPlaceCopy}>
              <Text style={styles.quickPlaceTitle}>{place.label}</Text>
              <Text style={styles.quickPlaceAddress} numberOfLines={1}>
                {place.address}
              </Text>
            </View>
            {place.recentId && (
              <Pressable
                hitSlop={8}
                disabled={busy}
                onPress={(event) => {
                  event.stopPropagation();
                  runAction(async () => {
                    const result = await api.deleteRideDestination(place.recentId!);
                    setRideDestinations(result.destinations);
                  }, "Destino reciente eliminado");
                }}
              >
                <Ionicons name="close-circle" size={18} color="#a89ead" />
              </Pressable>
            )}
          </Pressable>
        ))}
        {rideQuickPlaces.length === 0 && (
          <View style={styles.quickPlaceEmpty}>
            <Ionicons name="time-outline" size={18} color="#7c3cff" />
            <Text style={styles.quickPlaceAddress}>Tus destinos recientes aparecerán acá.</Text>
          </View>
        )}
      </ScrollView>
      {pickupCoords && destinationCoords ? (
        <FlashNativeMap
          origin={pickupCoords}
          destination={destinationCoords}
          route={roadRoute?.coordinates || []}
          caption={
            roadRoute
              ? `Ruta real · ${roadRoute.distanceKm} km · ${roadRoute.durationMin} min`
              : "Origen y destino confirmados"
          }
          detail={
            roadRoute
              ? "Arrastrá para explorar · tocá el control para reencuadrar"
              : "Cotizá para calcular el recorrido vial"
          }
          routeColor="#7c3cff"
          height={210}
          accessibilityLabel="Mapa interactivo de la cotización del viaje"
        />
      ) : (
        <NativeMapUnavailable
          height={210}
          message={
            !pickupCoords
              ? "Usá GPS o elegí un origen para comenzar."
              : "Elegí un destino para mostrar el recorrido."
          }
        />
      )}
      <View style={styles.rideSheet}>
        <TextInput
          value={pickup}
          onChangeText={(value) => {
            setPickup(value);
            setPickupCoords(null);
            invalidateQuote();
          }}
          placeholder="Origen"
          style={styles.input}
        />
        <Pressable onPress={useCurrentLocation} style={styles.secondaryAction}>
          <Text style={styles.secondaryActionText}>Usar mi ubicacion actual</Text>
        </Pressable>
        <TextInput
          value={destination}
          onChangeText={(value) => {
            setDestination(value);
            setDestinationCoords(null);
            invalidateQuote();
          }}
          placeholder="Destino"
          style={styles.input}
        />
        {locationMessage ? <Text style={styles.helperText}>{locationMessage}</Text> : null}
        {rideOptions.map((option) => (
          <Pressable
            key={option.service}
            disabled={!option.available}
            onPress={() => {
              setRideService(option.service);
              setRideQuote(option);
            }}
            style={[
              styles.rideOption,
              rideService === option.service && styles.rideOptionActive,
              !option.available && styles.actionDisabled,
            ]}
          >
            <View style={styles.vehicleBadge}>
              <Ionicons
                name={option.service === "moto" ? "bicycle" : "car-sport"}
                size={24}
                color="#fff"
              />
            </View>
            <View style={styles.rideOptionCopy}>
              <Text style={styles.rideOptionTitle}>{option.label}</Text>
              <Text style={styles.helperText}>
                {option.description} · {option.capacity} pasajeros
              </Text>
              <Text style={styles.helperText}>
                {option.available
                  ? `${option.pickupEtaMin} min · ${option.availableDrivers} conductores`
                  : "Sin conductores disponibles"}
              </Text>
            </View>
            <Text style={styles.ridePrice}>{money.format(option.fare)}</Text>
          </Pressable>
        ))}
        {rideQuote && (
          <Text style={styles.routeSummary}>
            {rideQuote.distanceKm} km · {rideQuote.durationMin} min
          </Text>
        )}
        {rideQuote?.breakdown && (
          <View style={styles.fareBreakdown}>
            <View style={styles.fareBreakdownHeader}>
              <View>
                <Text style={styles.rideOptionTitle}>Precio adelantado</Text>
                <Text style={styles.helperText}>
                  Bloqueado por 5 minutos · {rideQuote.pricingVersion}
                </Text>
              </View>
              <Text style={styles.fareTotal}>{money.format(rideQuote.fare)}</Text>
            </View>
            <View style={styles.fareLine}>
              <Text style={styles.cardText}>Base</Text>
              <Text style={styles.cardText}>{money.format(rideQuote.breakdown.baseFare)}</Text>
            </View>
            <View style={styles.fareLine}>
              <Text style={styles.cardText}>Distancia y tiempo estimados</Text>
              <Text style={styles.cardText}>
                {money.format(rideQuote.breakdown.distanceFare + rideQuote.breakdown.timeFare)}
              </Text>
            </View>
            <View style={styles.fareLine}>
              <Text style={styles.cardText}>Tarifa de servicio</Text>
              <Text style={styles.cardText}>{money.format(rideQuote.breakdown.serviceFee)}</Text>
            </View>
            {rideQuote.breakdown.demandAdjustment > 0 && (
              <View style={styles.fareLine}>
                <Text style={styles.demandText}>
                  Demanda actual ×{rideQuote.breakdown.demandMultiplier.toFixed(2)}
                </Text>
                <Text style={styles.demandText}>
                  {money.format(rideQuote.breakdown.demandAdjustment)}
                </Text>
              </View>
            )}
            {rideQuote.breakdown.tolls > 0 && (
              <View style={styles.fareLine}>
                <Text style={styles.cardText}>Peajes estimados</Text>
                <Text style={styles.cardText}>{money.format(rideQuote.breakdown.tolls)}</Text>
              </View>
            )}
          </View>
        )}
        <Text style={styles.rideOptionTitle}>¿Cuándo viajás?</Text>
        <View style={styles.choiceRow}>
          {(
            [
              ["now", "Ahora"],
              ["hour", "En 1 hora"],
              ["tomorrow", "Mañana"],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              onPress={() => setRideSchedule(value)}
              style={[styles.choice, rideSchedule === value && styles.choiceActive]}
            >
              <Text style={[styles.choiceText, rideSchedule === value && styles.choiceTextActive]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.actionRow}>
          <ActionButton label="Cotizar" disabled={busy} onPress={quoteRide} />
          <ActionButton label="Solicitar" disabled={busy || !rideQuote} onPress={requestRide} />
        </View>
      </View>
      <View style={styles.safetyStrip}>
        <View style={styles.safetyIcon}>
          <Ionicons name="shield-checkmark" size={21} color="#087a4b" />
        </View>
        <View style={styles.itemCopy}>
          <Text style={styles.safetyTitle}>Tu seguridad, visible siempre</Text>
          <Text style={styles.helperText}>
            Viaje identificado, ubicación compartible y soporte desde la actividad.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={19} color="#8a858e" />
      </View>
      <View style={styles.newAddressForm}>
        <View style={styles.addressBookHeading}>
          <View>
            <Text style={styles.rideOptionTitle}>Contactos de confianza</Text>
            <Text style={styles.helperText}>
              Hasta 5 personas. El teléfono queda cifrado y sólo se usa para ayudarte a compartir.
            </Text>
          </View>
          <Ionicons name="people-circle-outline" size={28} color="#7c3cff" />
        </View>
        {trustedContacts.map((contact) => (
          <View key={contact.id} style={styles.quickPlace}>
            <View style={styles.quickPlaceIcon}>
              <Ionicons name="person" size={18} color="#7c3cff" />
            </View>
            <View style={styles.quickPlaceCopy}>
              <Text style={styles.quickPlaceTitle}>{contact.name}</Text>
              <Text style={styles.quickPlaceAddress}>
                {contact.relationship} · •••• {contact.last4}
              </Text>
            </View>
            <Pressable
              disabled={busy}
              onPress={() =>
                runAction(async () => {
                  const result = await api.deleteRideTrustedContact(contact.id);
                  onTrustedContactsChange(result.contacts);
                }, "Contacto eliminado")
              }
            >
              <Ionicons name="close-circle-outline" size={22} color="#9a939d" />
            </Pressable>
          </View>
        ))}
        {trustedContacts.length < 5 && (
          <>
            <TextInput
              style={styles.input}
              value={trustedContactName}
              onChangeText={setTrustedContactName}
              placeholder="Nombre del contacto"
            />
            <TextInput
              style={styles.input}
              value={trustedContactPhone}
              onChangeText={(value) => setTrustedContactPhone(value.replace(/[^+0-9]/g, ""))}
              keyboardType="phone-pad"
              placeholder="+5491112345678"
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.paymentBrandRail}
            >
              {(
                [
                  ["family", "Familia"],
                  ["friend", "Amistad"],
                  ["partner", "Pareja"],
                  ["coworker", "Trabajo"],
                  ["other", "Otro"],
                ] as const
              ).map(([value, label]) => (
                <Pressable
                  key={value}
                  style={[
                    styles.issueCategoryPill,
                    trustedContactRelationship === value && styles.issueCategoryPillActive,
                  ]}
                  onPress={() => setTrustedContactRelationship(value)}
                >
                  <Text
                    style={[
                      styles.issueCategoryText,
                      trustedContactRelationship === value && styles.issueCategoryTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable
              disabled={
                busy ||
                trustedContactName.trim().length < 2 ||
                !/^\+[1-9][0-9]{7,14}$/.test(trustedContactPhone)
              }
              style={[
                styles.primaryButton,
                (busy ||
                  trustedContactName.trim().length < 2 ||
                  !/^\+[1-9][0-9]{7,14}$/.test(trustedContactPhone)) &&
                  styles.disabledButton,
              ]}
              onPress={() =>
                runAction(async () => {
                  const result = await api.createRideTrustedContact({
                    name: trustedContactName.trim(),
                    phone: trustedContactPhone,
                    relationship: trustedContactRelationship,
                  });
                  onTrustedContactsChange(result.contacts);
                  setTrustedContactName("");
                  setTrustedContactPhone("");
                }, "Contacto protegido y guardado")
              }
            >
              <Ionicons name="shield-checkmark-outline" size={18} color="#fff" />
              <Text style={styles.primaryButtonText}>Guardar contacto seguro</Text>
            </Pressable>
          </>
        )}
      </View>
      <Text style={styles.sectionTitle}>Viajes en curso</Text>
      {activeRides.map((ride) => (
        <View key={ride.id} style={styles.card}>
          <Text style={styles.cardTitle}>
            {ride.scheduledFor ? "Viaje reservado" : ride.status}
          </Text>
          {ride.scheduledFor ? (
            <Text style={styles.totalText}>
              {new Date(ride.scheduledFor).toLocaleString("es-AR", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </Text>
          ) : null}
          <Text style={styles.cardText}>
            {ride.pickup} → {ride.destination}
          </Text>
          <Text style={styles.totalText}>{money.format(ride.fare)}</Text>
          <Pressable
            style={styles.orderConfirmationAction}
            disabled={Boolean(ride.scheduledFor)}
            onPress={() => onOpenTracking(ride.id)}
          >
            <Ionicons name="navigate-outline" size={18} color="#fff" />
            <Text style={styles.orderConfirmationActionText}>
              {ride.scheduledFor ? "Seguimiento disponible al iniciar" : "Abrir viaje en vivo"}
            </Text>
          </Pressable>
          <Pressable
            style={styles.shareAction}
            disabled={busy || Boolean(ride.scheduledFor)}
            onPress={() => onShareRide(ride)}
          >
            <Ionicons name="share-social-outline" size={18} color="#7c3cff" />
            <Text style={[styles.shareActionText, { color: "#7c3cff" }]}>
              Compartir seguimiento en vivo
            </Text>
          </Pressable>
          {trustedContacts.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.paymentBrandRail}
            >
              {trustedContacts.map((contact) => (
                <Pressable
                  key={contact.id}
                  style={styles.issueCategoryPill}
                  disabled={busy || Boolean(ride.scheduledFor)}
                  onPress={() => onShareRide(ride, contact)}
                >
                  <Ionicons name="person-outline" size={15} color="#7c3cff" />
                  <Text style={styles.issueCategoryText}>Enviar a {contact.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          {!ride.scheduledFor && (
            <Pressable
              style={[styles.shareAction, { backgroundColor: "#fff0f0" }]}
              disabled={busy}
              onPress={() => onSos(ride)}
            >
              <Ionicons name="shield-checkmark" size={18} color="#c92626" />
              <Text style={[styles.shareActionText, { color: "#c92626" }]}>Seguridad · SOS</Text>
            </Pressable>
          )}
          <ActionButton
            label="Cancelar viaje"
            disabled={busy}
            onPress={() => onCancelRide(ride.id)}
          />
        </View>
      ))}
    </>
  );
}
