// Modales operativos del conductor (ARC-001).
//
// Guía giro a giro y captura de firma de recepción. Salen de DriverScreen
// porque son límites de UI autocontenidos y no dependen del estado del cockpit.

import { useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { captureRef } from "react-native-view-shot";
import Svg, { Path } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Alert,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import FlashNativeMap from "../FlashNativeMap";
import { navigationInstruction } from "../format";
import { styles } from "../styles";
import { NativeMapUnavailable } from "../ui";
import type { GeoPoint, RoadRoute } from "../types";

/** El destino que el conductor tiene enfrente: sólo esta pantalla lo construye. */
export type DriverNavigationTarget = {
  id: string;
  kind: "Viaje" | "Comida" | "Envío";
  phase: string;
  point: GeoPoint | null | undefined;
  address: string;
};

export function DriverNavigationModal({
  visible,
  target,
  origin,
  route,
  routeError,
  vehicleIcon,
  onExternal,
  onChat,
  onClose,
}: {
  visible: boolean;
  target: DriverNavigationTarget | null;
  origin: GeoPoint | null;
  route: RoadRoute | null;
  routeError: string;
  vehicleIcon: "bicycle" | "car-sport";
  onExternal: () => void;
  onChat: () => void;
  onClose: () => void;
}) {
  const { height } = useWindowDimensions(),
    mapHeight = Math.max(250, Math.min(420, height * 0.48)),
    step = route?.steps[0] || null,
    routeColor =
      target?.kind === "Comida" ? "#ff6a21" : target?.kind === "Envío" ? "#087a50" : "#7c3cff",
    turnIcon = step?.modifier.includes("left")
      ? "arrow-back"
      : step?.modifier.includes("right")
        ? "arrow-forward"
        : "arrow-up";
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.driverNavScreen}>
        <View style={styles.driverNavTop}>
          <Pressable
            style={styles.driverNavClose}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cerrar guía"
          >
            <Ionicons name="chevron-down" size={24} color="#fff" />
          </Pressable>
          <View style={styles.driverNavTurn}>
            <Ionicons name={turnIcon} size={30} color="#15121a" />
          </View>
          <View style={styles.itemCopy}>
            <Text style={styles.driverNavPhase}>
              {target?.kind.toUpperCase()} · {target?.phase.toUpperCase()}
            </Text>
            <Text style={styles.driverNavInstruction}>
              {step
                ? navigationInstruction(step)
                : routeError || "Calculando la mejor ruta disponible…"}
            </Text>
            {step ? (
              <Text style={styles.driverNavDistance}>
                en {Math.max(10, Math.round(step.distanceM))} m
              </Text>
            ) : null}
          </View>
        </View>
        {origin && target?.point ? (
          <FlashNativeMap
            origin={origin}
            destination={target.point}
            route={route?.coordinates || []}
            originRole="driver"
            driverIcon={vehicleIcon}
            routeColor={routeColor}
            caption={target.phase}
            detail={
              route
                ? `${route.distanceKm} km · ${route.durationMin} min restantes`
                : routeError || "Actualizando recorrido vial…"
            }
            height={mapHeight}
            accessibilityLabel="Mapa de la guía operativa del conductor"
          />
        ) : (
          <NativeMapUnavailable
            height={mapHeight}
            message={
              origin
                ? "El próximo punto todavía no tiene coordenadas verificadas."
                : "Activá el GPS para iniciar la guía."
            }
          />
        )}
        <ScrollView
          style={styles.driverNavSheet}
          contentContainerStyle={styles.driverNavSheetContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.driverNavEtaRow}>
            <View>
              <Text style={styles.driverNavEta}>{route ? `${route.durationMin} min` : "--"}</Text>
              <Text style={styles.helperText}>
                {route ? `${route.distanceKm} km restantes` : "Esperando ruta"}
              </Text>
            </View>
            <View style={[styles.driverNavKind, { backgroundColor: routeColor }]}>
              <Ionicons
                name={
                  target?.kind === "Comida"
                    ? "restaurant"
                    : target?.kind === "Envío"
                      ? "cube"
                      : "car-sport"
                }
                size={21}
                color="#fff"
              />
            </View>
          </View>
          <Text style={styles.driverNavDestinationLabel}>PRÓXIMO PUNTO</Text>
          <Text style={styles.driverNavDestination}>{target?.address}</Text>
          {route?.steps.slice(0, 3).map((item, index) => (
            <View
              style={styles.driverNavStep}
              key={`${item.type}-${item.location.lat}-${item.location.lng}-${index}`}
            >
              <View
                style={[styles.driverNavStepIndex, index === 0 && { backgroundColor: routeColor }]}
              >
                <Text style={styles.driverNavStepIndexText}>{index + 1}</Text>
              </View>
              <View style={styles.itemCopy}>
                <Text style={styles.driverNavStepText}>{navigationInstruction(item)}</Text>
                <Text style={styles.helperText}>{Math.max(10, Math.round(item.distanceM))} m</Text>
              </View>
            </View>
          ))}
          <View style={styles.driverNavActions}>
            <Pressable style={styles.driverNavSecondary} onPress={onChat}>
              <Ionicons name="chatbubble-ellipses-outline" size={20} color="#17131c" />
              <Text style={styles.driverNavSecondaryText}>Chat</Text>
            </Pressable>
            <Pressable
              style={styles.driverNavPrimary}
              disabled={!target?.point}
              onPress={onExternal}
            >
              <Ionicons name="navigate" size={20} color="#fff" />
              <Text style={styles.primaryButtonText}>Abrir guía giro a giro</Text>
            </Pressable>
          </View>
          <Text style={styles.driverNavDisclaimer}>
            Flash mantiene etapa, destino y recorrido. Google Maps o Apple Maps aporta la navegación
            completa mientras tráfico y voz propios no estén habilitados.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

export function SignatureCaptureModal({
  visible,
  onClose,
  onSave,
  busy,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (input: {
    contentBase64: string;
    signerName: string;
    signerRelationship: "recipient" | "authorized_person";
  }) => Promise<void>;
  busy: boolean;
}) {
  const [paths, setPaths] = useState<string[]>([]),
    [signerName, setSignerName] = useState(""),
    [relationship, setRelationship] = useState<"recipient" | "authorized_person">("recipient");
  const canvasRef = useRef<View>(null),
    pathsRef = useRef<string[]>([]);
  const updatePaths = (next: string[]) => {
    pathsRef.current = next;
    setPaths(next);
  };
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          updatePaths([...pathsRef.current, `M ${locationX.toFixed(1)} ${locationY.toFixed(1)}`]);
        },
        onPanResponderMove: (event) => {
          const { locationX, locationY } = event.nativeEvent,
            copy = [...pathsRef.current];
          if (!copy.length) return;
          copy[copy.length - 1] =
            `${copy[copy.length - 1]} L ${locationX.toFixed(1)} ${locationY.toFixed(1)}`;
          updatePaths(copy);
        },
      }),
    [],
  );
  const save = async () => {
    if (signerName.trim().length < 2)
      return Alert.alert("Firma incompleta", "Indicá el nombre de quien recibe.");
    if (!paths.some((path) => path.includes(" L ")))
      return Alert.alert("Firma incompleta", "Pedile al receptor que firme dentro del recuadro.");
    if (!canvasRef.current) return;
    const contentBase64 = await captureRef(canvasRef, {
      format: "png",
      quality: 0.8,
      result: "base64",
    });
    await onSave({
      contentBase64,
      signerName: signerName.trim(),
      signerRelationship: relationship,
    });
    updatePaths([]);
    setSignerName("");
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.signatureBackdrop}>
        <View style={styles.signatureSheet}>
          <View style={styles.trackingHeader}>
            <View>
              <Text style={styles.orderConfirmationEyebrow}>RECEPCIÓN VERIFICADA</Text>
              <Text style={styles.foodRestaurantTitle}>Firma del receptor</Text>
            </View>
            <Pressable style={styles.foodBack} onPress={onClose}>
              <Ionicons name="close" size={21} color="#222" />
            </Pressable>
          </View>
          <Text style={styles.cardText}>
            Declaro haber recibido el envío. La firma, identidad declarada, hora y ubicación se
            guardarán cifradas como evidencia.
          </Text>
          <TextInput
            value={signerName}
            onChangeText={setSignerName}
            placeholder="Nombre y apellido"
            style={styles.input}
          />
          <View style={styles.signatureRelationshipRow}>
            {(["recipient", "authorized_person"] as const).map((value) => (
              <Pressable
                key={value}
                style={[
                  styles.signatureChoice,
                  relationship === value && styles.signatureChoiceActive,
                ]}
                onPress={() => setRelationship(value)}
              >
                <Text
                  style={
                    relationship === value
                      ? styles.signatureChoiceTextActive
                      : styles.signatureChoiceText
                  }
                >
                  {value === "recipient" ? "Destinatario" : "Persona autorizada"}
                </Text>
              </Pressable>
            ))}
          </View>
          <View
            ref={canvasRef}
            collapsable={false}
            style={styles.signatureCanvas}
            {...responder.panHandlers}
          >
            <Svg style={StyleSheet.absoluteFill}>
              {paths.map((path, index) => (
                <Path
                  key={index}
                  d={path}
                  stroke="#17131c"
                  strokeWidth={3}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </Svg>
            <Text pointerEvents="none" style={styles.signatureGuide}>
              {paths.length ? "" : "Firmar aquí"}
            </Text>
          </View>
          <View style={styles.signatureActions}>
            <Pressable
              style={styles.secondaryButton}
              disabled={busy}
              onPress={() => updatePaths([])}
            >
              <Text style={styles.secondaryButtonText}>Limpiar</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryButton, { flex: 1 }, busy && styles.disabledButton]}
              disabled={busy}
              onPress={() => void save()}
            >
              <Text style={styles.primaryButtonText}>{busy ? "Cifrando…" : "Guardar firma"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
