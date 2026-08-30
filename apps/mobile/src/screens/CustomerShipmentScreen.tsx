// Envíos del cliente (ARC-001): cotización, mapa, protección y solicitud persistida.
// Permanece montado al cambiar de pestaña para conservar una cotización en curso.
import { useEffect, useRef, useState } from "react";
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

import { track } from "../analytics";
import { api } from "../api";
import FlashNativeMap from "../FlashNativeMap";
import { money } from "../format";
import { styles } from "../styles";
import { ActionButton, NativeMapUnavailable } from "../ui";
import type {
  AppState,
  GeoPoint,
  RoadRoute,
  Shipment,
  ShipmentOptions,
  ShipmentQuote,
  User,
} from "../types";

type SharedAddressSelection = {
  address: string;
  point: GeoPoint | null;
};

type CustomerShipmentScreenProps = {
  visible: boolean;
  addresses: AppState["addresses"];
  user: User;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
  activeShipments: Shipment[];
  shipmentCodes: Record<string, string>;
  selectedAddress: SharedAddressSelection | null;
  onCodeRevealed: (shipmentId: string, code: string) => void;
  onShareStatus: (title: string, message: string) => void;
  onCancelShipment: (shipmentId: string) => void;
};

export function CustomerShipmentScreen({
  visible,
  addresses,
  user,
  busy,
  runAction,
  activeShipments,
  shipmentCodes,
  selectedAddress,
  onCodeRevealed,
  onShareStatus,
  onCancelShipment,
}: CustomerShipmentScreenProps) {
  const [shipmentPickup, setShipmentPickup] = useState(user.defaultAddress || "");
  const [shipmentDestination, setShipmentDestination] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [packageDescription, setPackageDescription] = useState("");
  const [packageSize, setPackageSize] = useState<"small" | "medium" | "large">("small");
  const [packageWeight, setPackageWeight] = useState("1");
  const [declaredValue, setDeclaredValue] = useState("0");
  const [shipmentProtection, setShipmentProtection] = useState<"none" | "standard">("none");
  const [shipmentSignatureRequired, setShipmentSignatureRequired] = useState(false);
  const [shipmentItemCategory, setShipmentItemCategory] =
    useState<NonNullable<Shipment["itemCategory"]>>("standard");
  const [shipmentServiceLevel, setShipmentServiceLevel] =
    useState<NonNullable<Shipment["serviceLevel"]>>("standard");
  const [shipmentPickupCoords, setShipmentPickupCoords] = useState<GeoPoint | null>(null);
  const [shipmentDestinationCoords, setShipmentDestinationCoords] = useState<GeoPoint | null>(null);
  const [shipmentRoadRoute, setShipmentRoadRoute] = useState<RoadRoute | null>(null);
  const [shipmentQuote, setShipmentQuote] = useState<ShipmentQuote | null>(null);
  const [shipmentOptions, setShipmentOptions] = useState<ShipmentOptions | null>(null);
  const [shipmentOptionsError, setShipmentOptionsError] = useState("");
  const defaultLocationSeededForUser = useRef("");

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
    setShipmentPickup(primaryAddress.address);
    setShipmentPickupCoords({ lat: primaryAddress.lat!, lng: primaryAddress.lng! });
  }, [addresses, user.defaultAddress, user.id]);

  useEffect(() => {
    if (!selectedAddress) return;
    setShipmentPickup(selectedAddress.address);
    setShipmentPickupCoords(selectedAddress.point);
    setShipmentQuote(null);
    setShipmentRoadRoute(null);
  }, [selectedAddress]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setShipmentOptionsError("");
    void api
      .getShipmentOptions()
      .then((options) => {
        if (cancelled) return;
        setShipmentOptions(options);
        if (
          !options.categories.some((option) => option.code === shipmentItemCategory) &&
          options.categories[0]
        )
          setShipmentItemCategory(options.categories[0].code);
        if (
          !options.serviceLevels.some((option) => option.code === shipmentServiceLevel) &&
          options.serviceLevels[0]
        )
          setShipmentServiceLevel(options.serviceLevels[0].code);
      })
      .catch((error) => {
        if (!cancelled)
          setShipmentOptionsError(
            error instanceof Error ? error.message : "No se pudieron cargar las opciones",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const quoteShipment = () => {
    if (!shipmentPickup.trim() || !shipmentDestination.trim() || Number(packageWeight) <= 0) {
      Alert.alert("Envio incompleto", "Confirma direcciones y peso del paquete.");
      return;
    }
    runAction(async () => {
      const [pickupResult, destinationResult] = await Promise.all([
        api.geocode(shipmentPickup.trim()),
        api.geocode(shipmentDestination.trim()),
      ]);
      const pickupPoint = pickupResult.results[0]?.point;
      const destinationPoint = destinationResult.results[0]?.point;
      if (!pickupPoint || !destinationPoint)
        throw new Error("No pudimos ubicar una de las direcciones");
      setShipmentPickupCoords(pickupPoint);
      setShipmentDestinationCoords(destinationPoint);
      const [response, routed] = await Promise.all([
        api.quoteShipment({
          pickup: shipmentPickup.trim(),
          destination: shipmentDestination.trim(),
          packageSize,
          weightKg: Number(packageWeight),
          declaredValue: Number(declaredValue) || 0,
          protection: shipmentProtection,
          signatureRequired: shipmentSignatureRequired,
          itemCategory: shipmentItemCategory,
          serviceLevel: shipmentServiceLevel,
          pickupCoords: pickupPoint,
          destinationCoords: destinationPoint,
        }),
        api.route(pickupPoint, destinationPoint).catch(() => null),
      ]);
      setShipmentRoadRoute(routed?.route || null);
      setShipmentQuote(response.quote);
      track("quote_received", "customer_app", { service: "shipment" });
    }, "Envio cotizado");
  };

  const createShipment = () => {
    if (
      !shipmentQuote ||
      !recipientName.trim() ||
      !recipientPhone.trim() ||
      !packageDescription.trim()
    ) {
      Alert.alert(
        "Envio incompleto",
        "Cotiza e ingresa destinatario, telefono y contenido general.",
      );
      return;
    }
    runAction(async () => {
      await api.createShipment({
        customerId: user.id,
        pickup: shipmentPickup.trim(),
        destination: shipmentDestination.trim(),
        recipientName: recipientName.trim(),
        recipientPhone: recipientPhone.trim(),
        packageSize,
        description: packageDescription.trim(),
        weightKg: Number(packageWeight),
        declaredValue: Number(declaredValue) || 0,
        protection: shipmentProtection,
        signatureRequired: shipmentSignatureRequired,
        itemCategory: shipmentItemCategory,
        serviceLevel: shipmentServiceLevel,
        deliveryNotes: "Entregar en mano",
        paymentMethod: "Flash Wallet",
        termsAccepted: true,
        pickupCoords: shipmentPickupCoords,
        destinationCoords: shipmentDestinationCoords,
        quoteToken: shipmentQuote.quoteToken,
      });
      track("job_created", "customer_app", { service: "shipment" });
      setShipmentQuote(null);
      setShipmentPickupCoords(null);
      setShipmentDestinationCoords(null);
      setShipmentRoadRoute(null);
      setRecipientName("");
      setRecipientPhone("");
      setPackageDescription("");
    }, "Envio solicitado");
  };

  if (!visible) return null;

  return (
    <>
      <View style={styles.shipmentHero}>
        <Text style={styles.rideEyebrow}>FLASH ENVIOS</Text>
        <Text style={styles.rideTitle}>Mandá algo hoy</Text>
        <Text style={styles.shipmentHeroCopy}>Entrega local en el día con seguimiento y PIN.</Text>
        <View style={styles.shipmentBenefits}>
          <Text style={styles.shipmentBenefit}>✓ Cotización previa</Text>
          <Text style={styles.shipmentBenefit}>✓ PIN de entrega</Text>
        </View>
      </View>
      {shipmentPickupCoords && shipmentDestinationCoords ? (
        <FlashNativeMap
          origin={shipmentPickupCoords}
          destination={shipmentDestinationCoords}
          route={shipmentRoadRoute?.coordinates || []}
          caption={
            shipmentRoadRoute
              ? `${shipmentRoadRoute.distanceKm} km · ${shipmentRoadRoute.durationMin} min de recorrido`
              : "Retiro y entrega confirmados"
          }
          detail={
            shipmentQuote
              ? "Cotización vigente · recorrido real"
              : "Cotizá para validar cobertura y recorrido"
          }
          routeColor="#087a50"
          driverIcon="bicycle"
          height={210}
          accessibilityLabel="Mapa interactivo de la cotización del envío"
        />
      ) : (
        <NativeMapUnavailable
          height={210}
          message="Ingresá direcciones y cotizá para validar el recorrido real."
        />
      )}
      <View style={styles.rideSheet}>
        <TextInput
          value={shipmentPickup}
          onChangeText={(value) => {
            setShipmentPickup(value);
            setShipmentQuote(null);
            setShipmentPickupCoords(null);
            setShipmentRoadRoute(null);
          }}
          placeholder="Retirar en"
          style={styles.input}
        />
        <TextInput
          value={shipmentDestination}
          onChangeText={(value) => {
            setShipmentDestination(value);
            setShipmentQuote(null);
            setShipmentDestinationCoords(null);
            setShipmentRoadRoute(null);
          }}
          placeholder="Entregar en"
          style={styles.input}
        />
        <View style={styles.choiceRow}>
          {(["small", "medium", "large"] as const).map((size) => (
            <Pressable
              key={size}
              onPress={() => {
                setPackageSize(size);
                setShipmentQuote(null);
              }}
              style={[styles.choice, packageSize === size && styles.choiceActive]}
            >
              <Text style={[styles.choiceText, packageSize === size && styles.choiceTextActive]}>
                {size === "small" ? "Chico" : size === "medium" ? "Mediano" : "Grande"}
              </Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={packageWeight}
          onChangeText={(value) => {
            setPackageWeight(value);
            setShipmentQuote(null);
          }}
          placeholder="Peso en kg (max. 20)"
          keyboardType="numeric"
          style={styles.input}
        />
        <Text style={styles.foodSectionTitle}>Qué enviás</Text>
        {!shipmentOptions && !shipmentOptionsError ? <ActivityIndicator color="#7c3cff" /> : null}
        {shipmentOptionsError ? <Text style={styles.errorText}>{shipmentOptionsError}</Text> : null}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.shipmentOptionRail}
        >
          {(shipmentOptions?.categories || []).map((category) => (
            <Pressable
              key={category.code}
              onPress={() => {
                setShipmentItemCategory(category.code);
                setShipmentQuote(null);
              }}
              style={[
                styles.shipmentOptionCard,
                shipmentItemCategory === category.code && styles.shipmentOptionCardActive,
              ]}
            >
              <Ionicons
                name={
                  category.code === "documents"
                    ? "document-text"
                    : category.code === "fragile"
                      ? "wine"
                      : category.code === "electronics"
                        ? "phone-portrait"
                        : "cube"
                }
                size={20}
                color={shipmentItemCategory === category.code ? "#fff" : "#7c3cff"}
              />
              <Text
                style={
                  shipmentItemCategory === category.code
                    ? styles.shipmentOptionTextActive
                    : styles.shipmentOptionText
                }
              >
                {category.name}
              </Text>
              <Text
                style={
                  shipmentItemCategory === category.code
                    ? styles.shipmentOptionMetaActive
                    : styles.shipmentOptionMeta
                }
              >
                hasta {category.maximumWeightKg} kg
                {category.surcharge ? ` · +${money.format(category.surcharge)}` : ""}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <Text style={styles.foodSectionTitle}>Velocidad</Text>
        <View style={styles.shipmentSlaGrid}>
          {(shipmentOptions?.serviceLevels || []).map((level) => (
            <Pressable
              key={level.code}
              onPress={() => {
                setShipmentServiceLevel(level.code);
                setShipmentQuote(null);
              }}
              style={[
                styles.shipmentSlaCard,
                shipmentServiceLevel === level.code && styles.shipmentSlaCardActive,
              ]}
            >
              <Text
                style={
                  shipmentServiceLevel === level.code
                    ? styles.shipmentSlaTitleActive
                    : styles.shipmentSlaTitle
                }
              >
                {level.name}
              </Text>
              <Text
                style={
                  shipmentServiceLevel === level.code
                    ? styles.shipmentSlaCaptionActive
                    : styles.shipmentSlaCaption
                }
              >
                ETA ×{level.etaMultiplier}
                {level.maximumDistanceKm ? ` · hasta ${level.maximumDistanceKm} km` : ""}
              </Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={declaredValue}
          onChangeText={(value) => {
            setDeclaredValue(value.replace(/[^0-9]/g, ""));
            setShipmentQuote(null);
          }}
          placeholder="Valor declarado (ARS)"
          keyboardType="numeric"
          style={styles.input}
        />
        <Pressable
          style={[
            styles.shipmentProtectionCard,
            shipmentProtection === "standard" && styles.shipmentProtectionCardActive,
          ]}
          onPress={() => {
            setShipmentProtection((current) => (current === "standard" ? "none" : "standard"));
            setShipmentQuote(null);
          }}
        >
          <View style={styles.shipmentProtectionIcon}>
            <Ionicons name="shield-checkmark" size={21} color="#fff" />
          </View>
          <View style={styles.savedAddressCopy}>
            <Text style={styles.sectionTitle}>Protección Flash</Text>
            <Text style={styles.cardText}>
              Prima calculada por servidor sobre el valor declarado.
            </Text>
          </View>
          <Ionicons
            name={shipmentProtection === "standard" ? "checkmark-circle" : "ellipse-outline"}
            size={23}
            color={shipmentProtection === "standard" ? "#087a50" : "#aaa"}
          />
        </Pressable>
        <Pressable
          style={[
            styles.shipmentProtectionCard,
            shipmentSignatureRequired && styles.shipmentProtectionCardActive,
          ]}
          onPress={() => {
            setShipmentSignatureRequired((current) => !current);
            setShipmentQuote(null);
          }}
        >
          <View style={[styles.shipmentProtectionIcon, { backgroundColor: "#17131c" }]}>
            <Ionicons name="pencil" size={20} color="#fff" />
          </View>
          <View style={styles.savedAddressCopy}>
            <Text style={styles.sectionTitle}>Exigir firma al entregar</Text>
            <Text style={styles.cardText}>
              El conductor no podrá completar sin foto, firma e identidad del receptor.
            </Text>
          </View>
          <Ionicons
            name={shipmentSignatureRequired ? "checkmark-circle" : "ellipse-outline"}
            size={23}
            color={shipmentSignatureRequired ? "#087a50" : "#aaa"}
          />
        </Pressable>
        <TextInput
          value={packageDescription}
          onChangeText={setPackageDescription}
          placeholder="Contenido general (sin datos sensibles)"
          style={styles.input}
        />
        <TextInput
          value={recipientName}
          onChangeText={setRecipientName}
          placeholder="Nombre del destinatario"
          style={styles.input}
        />
        <TextInput
          value={recipientPhone}
          onChangeText={setRecipientPhone}
          placeholder="Telefono del destinatario"
          keyboardType="phone-pad"
          style={styles.input}
        />
        <Text style={styles.helperText}>
          Debe estar cerrado, pesar hasta 20 kg y no contener dinero, armas, sustancias,
          medicamentos ni productos peligrosos.
        </Text>
        {shipmentQuote && (
          <View style={styles.quoteBox}>
            <Text style={styles.cardTitle}>{money.format(shipmentQuote.fare)}</Text>
            <Text style={styles.cardText}>
              {shipmentQuote.distanceKm} km · llega en {shipmentQuote.etaMin} min
            </Text>
            <Text style={styles.protectionQuoteText}>
              {shipmentQuote.serviceLevelName} · {shipmentQuote.itemCategoryName}
            </Text>
            {shipmentQuote.handlingInstructions ? (
              <Text style={styles.helperText}>{shipmentQuote.handlingInstructions}</Text>
            ) : null}
            {shipmentQuote.protection === "standard" && (
              <Text style={styles.protectionQuoteText}>
                Protección {money.format(shipmentQuote.protectionPremium || 0)} · valor{" "}
                {money.format(shipmentQuote.declaredValue || 0)} · franquicia{" "}
                {money.format(shipmentQuote.deductible || 0)}
              </Text>
            )}
          </View>
        )}
        <View style={styles.actionRow}>
          <ActionButton label="Cotizar" disabled={busy} onPress={quoteShipment} />
          <ActionButton
            label="Solicitar envio"
            disabled={busy || !shipmentQuote}
            onPress={createShipment}
          />
        </View>
      </View>
      <Text style={styles.sectionTitle}>Envios en curso</Text>
      {activeShipments.map((shipment) => (
        <View key={shipment.id} style={styles.card}>
          <Text style={styles.cardTitle}>{shipment.status}</Text>
          <Text style={styles.cardText}>
            {shipment.pickup} → {shipment.destination}
          </Text>
          <Text style={styles.cardText}>Destinatario: {shipment.recipientName}</Text>
          {shipmentCodes[shipment.id] ? (
            <Text style={styles.foodRestaurantTitle}>PIN {shipmentCodes[shipment.id]}</Text>
          ) : (
            <ActionButton
              label="Ver PIN de entrega"
              disabled={busy}
              onPress={() =>
                runAction(async () => {
                  const response = await api.getShipmentDeliveryCode(shipment.id);
                  onCodeRevealed(shipment.id, response.deliveryCode);
                }, "PIN disponible")
              }
            />
          )}
          <Text style={styles.totalText}>{money.format(shipment.fare)}</Text>
          <Pressable
            style={styles.shareAction}
            onPress={() =>
              onShareStatus(
                "Envío Flash",
                `Seguimiento ${shipment.id}: ${shipment.status}. Destino ${shipment.destination}.`,
              )
            }
          >
            <Ionicons name="share-social-outline" size={18} color="#7c3cff" />
            <Text style={[styles.shareActionText, { color: "#7c3cff" }]}>
              Compartir seguimiento
            </Text>
          </Pressable>
          <ActionButton
            label="Cancelar envio"
            disabled={busy}
            onPress={() => onCancelShipment(shipment.id)}
          />
        </View>
      ))}
    </>
  );
}
