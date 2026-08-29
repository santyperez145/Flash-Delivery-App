import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from "react-native";

import { api } from "../api";
import { styles } from "../styles";
import type { GeoPoint } from "../types";

type AddressMatch = {
  label: string;
  point: GeoPoint;
  type: string;
  placeId: string | null;
  validationToken: string;
};

export function CustomerAddressForm({
  busy,
  hasPersistedAddress,
  runAction,
  onSaved,
}: {
  busy: boolean;
  hasPersistedAddress: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
  onSaved: (match: AddressMatch) => void;
}) {
  const [label, setLabel] = useState("Casa");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<AddressMatch[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<AddressMatch | null>(null);
  const [searching, setSearching] = useState(false);
  const disabled = !label.trim() || query.trim().length < 3 || busy || searching;

  const search = () => {
    setSearching(true);
    void api
      .geocode(query.trim())
      .then((result) => {
        const nextMatches = result.results.slice(0, 5);
        if (!nextMatches.length) throw new Error("No encontramos esa dirección");
        setMatches(nextMatches);
      })
      .catch((error) => {
        Alert.alert(
          "No pudimos validar la dirección",
          error instanceof Error ? error.message : "Intentá nuevamente.",
        );
      })
      .finally(() => setSearching(false));
  };

  const save = (match: AddressMatch) =>
    runAction(async () => {
      await api.createAddress({
        label: label.trim(),
        address: match.label,
        lat: match.point.lat,
        lng: match.point.lng,
        isDefault: !hasPersistedAddress,
        validationToken: match.validationToken,
      });
      onSaved(match);
      setQuery("");
      setMatches([]);
      setSelectedMatch(null);
    }, "Dirección validada y guardada");

  return (
    <View style={styles.newAddressForm}>
      <Text style={styles.sectionTitle}>Agregar dirección</Text>
      <View style={styles.newAddressFields}>
        <TextInput
          style={[styles.input, styles.addressLabelInput]}
          value={label}
          onChangeText={setLabel}
          placeholder="Etiqueta"
        />
        <TextInput
          style={[styles.input, styles.addressTextInput]}
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            setMatches([]);
            setSelectedMatch(null);
          }}
          placeholder="Calle, número y ciudad"
        />
      </View>
      {matches.length > 0 && (
        <View style={styles.addressMatchList}>
          <Text style={styles.addressMatchHint}>
            Elegí la coincidencia correcta antes de guardarla.
          </Text>
          {matches.map((match) => (
            <Pressable
              key={`${match.placeId || match.label}:${match.point.lat}:${match.point.lng}`}
              style={styles.addressMatchRow}
              onPress={() => {
                setSelectedMatch(match);
                setQuery(match.label);
                setMatches([]);
              }}
            >
              <View style={styles.addressMatchIcon}>
                <Ionicons name="location" size={18} color="#7c3cff" />
              </View>
              <View style={styles.addressMatchCopy}>
                <Text style={styles.addressMatchLabel}>{match.label}</Text>
                <Text style={styles.addressMatchMeta}>Resultado del proveedor</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#8f8992" />
            </Pressable>
          ))}
        </View>
      )}
      {selectedMatch && (
        <View style={styles.addressSelectedNotice}>
          <Ionicons name="shield-checkmark" size={17} color="#087a50" />
          <Text style={styles.addressSelectedText}>
            Dirección validada. Las coordenadas se tomarán del resultado firmado.
          </Text>
        </View>
      )}
      <Pressable
        style={[styles.primaryButton, disabled && styles.disabledButton]}
        disabled={disabled}
        onPress={() => (selectedMatch ? save(selectedMatch) : search())}
      >
        {searching ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Ionicons
            name={selectedMatch ? "shield-checkmark-outline" : "search-outline"}
            size={19}
            color="#fff"
          />
        )}
        <Text style={styles.primaryButtonText}>
          {searching
            ? "Validando..."
            : selectedMatch
              ? "Guardar dirección validada"
              : "Buscar y validar dirección"}
        </Text>
      </Pressable>
    </View>
  );
}
