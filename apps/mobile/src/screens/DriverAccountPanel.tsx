// Cuenta operativa del conductor (ARC-001).
//
// Preferencia de navegación, legajo/documentos y flota personal. Sale de
// DriverScreen; vehículos y preferencias se sincronizan con el cockpit porque
// la guía externa y el vehículo activo se usan en home.

import { useCallback, useEffect, useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Ionicons } from "@expo/vector-icons";
import { Alert, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { api } from "../api";
import { styles } from "../styles";
import type { DriverCompliance, DriverDocument, DriverPreferences, DriverVehicle } from "../types";

export function DriverAccountPanel({
  driverId,
  vehicles,
  onVehiclesChange,
  preferences,
  onPreferencesChange,
}: {
  driverId: string;
  vehicles: DriverVehicle[];
  onVehiclesChange: (vehicles: DriverVehicle[]) => void;
  preferences: DriverPreferences;
  onPreferencesChange: (preferences: DriverPreferences) => void;
}) {
  const [compliance, setCompliance] = useState<DriverCompliance | null>(null);
  const [documentType, setDocumentType] = useState<DriverDocument["type"]>("identity");
  const [documentExpiry, setDocumentExpiry] = useState("2099-12-31");
  const [documentUploading, setDocumentUploading] = useState(false);
  const [vehicleBusy, setVehicleBusy] = useState(false);
  const [driverPreferenceBusy, setDriverPreferenceBusy] = useState(false);
  const [vehicleDraft, setVehicleDraft] = useState<{
    kind: DriverVehicle["kind"];
    model: string;
    plate: string;
    color: string;
    seats: string;
  }>({ kind: "car", model: "", plate: "", color: "", seats: "4" });

  const loadCompliance = useCallback(async () => {
    try {
      setCompliance((await api.getDriverCompliance(driverId)).compliance);
    } catch (_error) {
      setCompliance(null);
    }
  }, [driverId]);

  const loadVehicles = useCallback(async () => {
    try {
      onVehiclesChange((await api.getDriverVehicles(driverId)).vehicles);
    } catch (_error) {
      onVehiclesChange([]);
    }
  }, [driverId, onVehiclesChange]);

  useEffect(() => {
    void loadCompliance();
  }, [loadCompliance]);

  const addVehicle = async () => {
    setVehicleBusy(true);
    try {
      const ride = ["car", "van"].includes(vehicleDraft.kind);
      await api.createDriverVehicle(driverId, {
        kind: vehicleDraft.kind,
        model: vehicleDraft.model.trim(),
        plate: vehicleDraft.plate.trim(),
        color: vehicleDraft.color.trim() || null,
        seats: ride ? Number(vehicleDraft.seats) : 1,
        serviceModes: ride ? ["delivery", "ride"] : ["delivery"],
      });
      setVehicleDraft({ kind: "car", model: "", plate: "", color: "", seats: "4" });
      await loadVehicles();
      Alert.alert(
        "Vehículo enviado",
        "Operaciones debe verificarlo antes de que puedas conectarte.",
      );
    } catch (error) {
      Alert.alert(
        "Flash",
        error instanceof Error ? error.message : "No se pudo registrar el vehículo",
      );
    } finally {
      setVehicleBusy(false);
    }
  };

  const runVehicleAction = async (action: () => Promise<unknown>, message: string) => {
    setVehicleBusy(true);
    try {
      await action();
      await loadVehicles();
      Alert.alert("Flash", message);
    } catch (error) {
      Alert.alert(
        "Flash",
        error instanceof Error ? error.message : "No se pudo actualizar el vehículo",
      );
    } finally {
      setVehicleBusy(false);
    }
  };

  const pickComplianceDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["image/jpeg", "image/png", "application/pdf"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if ((asset.size || 0) > 750000) {
      Alert.alert("Documento demasiado grande", "El máximo seguro es 750 KB.");
      return;
    }
    const mimeType = (asset.mimeType || "application/pdf") as
      | "image/jpeg"
      | "image/png"
      | "application/pdf";
    setDocumentUploading(true);
    try {
      const contentBase64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await api.submitDriverDocument(driverId, {
        type: documentType,
        mimeType,
        contentBase64,
        expiresAt: ["driver_license", "vehicle_registration", "insurance"].includes(documentType)
          ? documentExpiry
          : null,
      });
      await loadCompliance();
      Alert.alert("Flash", "Documento cifrado y enviado a revisión");
    } catch (error) {
      Alert.alert(
        "Flash",
        error instanceof Error ? error.message : "No se pudo subir el documento",
      );
    } finally {
      setDocumentUploading(false);
    }
  };

  const driverPreferences = preferences;

  return (
    <>
      <View style={styles.complianceCard}>
        <View style={styles.complianceHeader}>
          <View>
            <Text style={styles.heroLabel}>NAVEGACIÓN</Text>
            <Text style={styles.sectionTitle}>Guía externa preferida</Text>
          </View>
          <View style={styles.driverInsightIcon}>
            <Ionicons name="navigate-outline" size={22} color="#7c3cff" />
          </View>
        </View>
        <Text style={styles.cardText}>
          Flash conserva etapa y trabajo activo. Esta preferencia sólo decide qué app abre el botón
          de guía completa.
        </Text>
        <View style={styles.driverPreferenceOptions}>
          {(
            [
              ["system", "Predeterminada", "Usa Apple Maps en iPhone y Google Maps en el resto"],
              ["google_maps", "Google Maps", "Mantiene conducción o bicicleta según tu vehículo"],
              ...(Platform.OS === "ios"
                ? [["apple_maps", "Apple Maps", "Disponible para conducción en iPhone"]]
                : []),
            ] as Array<[DriverPreferences["navigationProvider"], string, string]>
          ).map(([value, label, detail]) => (
            <Pressable
              key={value}
              disabled={driverPreferenceBusy}
              accessibilityRole="radio"
              accessibilityState={{ checked: driverPreferences.navigationProvider === value }}
              onPress={async () => {
                setDriverPreferenceBusy(true);
                try {
                  onPreferencesChange((await api.updateDriverPreferences(value)).preferences);
                } catch (error) {
                  Alert.alert(
                    "Flash",
                    error instanceof Error ? error.message : "No se pudo guardar la preferencia",
                  );
                } finally {
                  setDriverPreferenceBusy(false);
                }
              }}
              style={[
                styles.driverPreferenceOption,
                driverPreferences.navigationProvider === value &&
                  styles.driverPreferenceOptionActive,
              ]}
            >
              <View
                style={[
                  styles.driverPreferenceRadio,
                  driverPreferences.navigationProvider === value &&
                    styles.driverPreferenceRadioActive,
                ]}
              >
                {driverPreferences.navigationProvider === value ? (
                  <View style={styles.driverPreferenceDot} />
                ) : null}
              </View>
              <View style={styles.itemCopy}>
                <Text style={styles.sectionTitle}>{label}</Text>
                <Text style={styles.cardText}>{detail}</Text>
              </View>
            </Pressable>
          ))}
        </View>
        <Text style={styles.notificationTime}>
          {driverPreferences.updatedAt
            ? `Guardado ${new Date(driverPreferences.updatedAt).toLocaleString("es-AR")}`
            : "Preferencia predeterminada"}
        </Text>
      </View>
      <View style={styles.complianceCard}>
        <View style={styles.complianceHeader}>
          <View>
            <Text style={styles.heroLabel}>LEGAJO Y SEGURIDAD</Text>
            <Text style={styles.sectionTitle}>Verificación del conductor</Text>
          </View>
          <Text
            style={[
              styles.complianceBadge,
              compliance?.status === "approved" && styles.complianceBadgeApproved,
              compliance?.status === "rejected" && styles.complianceBadgeRejected,
            ]}
          >
            {(compliance?.status || "cargando").replaceAll("_", " ").toUpperCase()}
          </Text>
        </View>
        <Text style={styles.cardText}>
          Los archivos se cifran antes de persistir y sólo operaciones puede aprobarlos.
        </Text>
        <View style={styles.complianceDocuments}>
          {compliance?.requiredTypes.map((type) => {
            const current = compliance.documents.find(
              (document) => document.type === type && !["superseded"].includes(document.status),
            );
            const labels = {
              identity: "Identidad",
              driver_license: "Licencia",
              vehicle_registration: "Cédula del vehículo",
              insurance: "Seguro",
              background_check: "Antecedentes",
            };
            return (
              <View style={styles.complianceDocumentRow} key={type}>
                <Ionicons
                  name={
                    current?.status === "approved"
                      ? "checkmark-circle"
                      : current?.status === "rejected"
                        ? "close-circle"
                        : "document-text-outline"
                  }
                  size={20}
                  color={
                    current?.status === "approved"
                      ? "#087a50"
                      : current?.status === "rejected"
                        ? "#c43d38"
                        : "#7c3cff"
                  }
                />
                <View style={styles.itemCopy}>
                  <Text style={styles.sectionTitle}>{labels[type]}</Text>
                  <Text style={styles.cardText}>
                    {current ? current.status.replaceAll("_", " ") : "Pendiente de envío"}
                    {current?.expiresAt ? ` · vence ${current.expiresAt}` : ""}
                  </Text>
                  {current?.rejectionReason && (
                    <Text style={styles.complianceRejection}>{current.rejectionReason}</Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.paymentBrandRail}
        >
          {(
            [
              ["identity", "Identidad"],
              ["driver_license", "Licencia"],
              ["vehicle_registration", "Cédula"],
              ["insurance", "Seguro"],
              ["background_check", "Antecedentes"],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              onPress={() => setDocumentType(value)}
              style={[
                styles.issueCategoryPill,
                documentType === value && styles.issueCategoryPillActive,
              ]}
            >
              <Text
                style={[
                  styles.issueCategoryText,
                  documentType === value && styles.issueCategoryTextActive,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        {["driver_license", "vehicle_registration", "insurance"].includes(documentType) && (
          <TextInput
            style={styles.input}
            value={documentExpiry}
            onChangeText={setDocumentExpiry}
            placeholder="Vencimiento AAAA-MM-DD"
          />
        )}
        <Pressable
          disabled={documentUploading}
          style={[styles.primaryButton, documentUploading && styles.disabledButton]}
          onPress={pickComplianceDocument}
        >
          <Ionicons name="cloud-upload-outline" size={19} color="#fff" />
          <Text style={styles.primaryButtonText}>
            {documentUploading ? "Cifrando y enviando…" : "Elegir PDF o imagen"}
          </Text>
        </Pressable>
      </View>
      <View style={styles.complianceCard}>
        <View style={styles.complianceHeader}>
          <View>
            <Text style={styles.heroLabel}>FLOTA PERSONAL</Text>
            <Text style={styles.sectionTitle}>Vehículo operativo</Text>
          </View>
          <Text style={styles.complianceBadge}>{vehicles.length}/5</Text>
        </View>
        <Text style={styles.cardText}>
          Sólo el vehículo activo, aprobado y compatible recibe ofertas. Un cambio vuelve a revisión
          y te desconecta.
        </Text>
        {vehicles.map((vehicle) => (
          <View key={vehicle.id} style={styles.complianceDocumentRow}>
            <Ionicons
              name={
                vehicle.kind === "bicycle"
                  ? "bicycle"
                  : vehicle.kind === "motorcycle"
                    ? "speedometer-outline"
                    : "car-sport-outline"
              }
              size={22}
              color={vehicle.active ? "#7c3cff" : "#777"}
            />
            <View style={styles.itemCopy}>
              <Text style={styles.sectionTitle}>
                {vehicle.model} · {vehicle.plate}
              </Text>
              <Text style={styles.cardText}>
                {vehicle.kind} · {vehicle.serviceModes.join(" + ")} · {vehicle.status}
                {vehicle.active ? " · activo" : ""}
              </Text>
              {vehicle.rejectionReason && (
                <Text style={styles.complianceRejection}>{vehicle.rejectionReason}</Text>
              )}
            </View>
            {!vehicle.active && vehicle.status === "approved" ? (
              <Pressable
                disabled={vehicleBusy}
                onPress={() =>
                  void runVehicleAction(
                    () => api.activateDriverVehicle(vehicle.id),
                    "Vehículo activado; revisá tu disponibilidad.",
                  )
                }
              >
                <Ionicons name="checkmark-circle-outline" size={25} color="#087a50" />
              </Pressable>
            ) : null}
            <Pressable
              disabled={vehicleBusy}
              onPress={() =>
                Alert.alert(
                  "Retirar vehículo",
                  `¿Retirar ${vehicle.model}? La evidencia histórica se conservará.`,
                  [
                    { text: "Cancelar", style: "cancel" },
                    {
                      text: "Retirar",
                      style: "destructive",
                      onPress: () =>
                        void runVehicleAction(
                          () => api.retireDriverVehicle(vehicle.id),
                          "Vehículo retirado",
                        ),
                    },
                  ],
                )
              }
            >
              <Ionicons name="trash-outline" size={21} color="#a33939" />
            </Pressable>
          </View>
        ))}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.paymentBrandRail}
        >
          {(
            [
              ["bicycle", "Bici"],
              ["motorcycle", "Moto"],
              ["car", "Auto"],
              ["van", "Van"],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              onPress={() =>
                setVehicleDraft((current) => ({
                  ...current,
                  kind: value,
                  seats: ["car", "van"].includes(value) ? current.seats || "4" : "1",
                }))
              }
              style={[
                styles.issueCategoryPill,
                vehicleDraft.kind === value && styles.issueCategoryPillActive,
              ]}
            >
              <Text
                style={[
                  styles.issueCategoryText,
                  vehicleDraft.kind === value && styles.issueCategoryTextActive,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <TextInput
          style={styles.input}
          value={vehicleDraft.model}
          onChangeText={(model) => setVehicleDraft((current) => ({ ...current, model }))}
          placeholder="Marca y modelo"
        />
        <TextInput
          style={styles.input}
          value={vehicleDraft.plate}
          onChangeText={(plate) =>
            setVehicleDraft((current) => ({ ...current, plate: plate.toUpperCase() }))
          }
          autoCapitalize="characters"
          placeholder="Patente"
        />
        <TextInput
          style={styles.input}
          value={vehicleDraft.color}
          onChangeText={(color) => setVehicleDraft((current) => ({ ...current, color }))}
          placeholder="Color"
        />
        {["car", "van"].includes(vehicleDraft.kind) ? (
          <TextInput
            style={styles.input}
            value={vehicleDraft.seats}
            onChangeText={(seats) =>
              setVehicleDraft((current) => ({
                ...current,
                seats: seats.replace(/\D/g, "").slice(0, 1),
              }))
            }
            keyboardType="numeric"
            placeholder="Asientos"
          />
        ) : null}
        <Pressable
          disabled={
            vehicleBusy || !vehicleDraft.model.trim() || vehicleDraft.plate.trim().length < 3
          }
          style={[
            styles.primaryButton,
            (vehicleBusy || !vehicleDraft.model.trim() || vehicleDraft.plate.trim().length < 3) &&
              styles.disabledButton,
          ]}
          onPress={() => void addVehicle()}
        >
          <Ionicons name="add-circle-outline" size={19} color="#fff" />
          <Text style={styles.primaryButtonText}>
            {vehicleBusy ? "Guardando…" : "Registrar vehículo"}
          </Text>
        </Pressable>
      </View>
    </>
  );
}
