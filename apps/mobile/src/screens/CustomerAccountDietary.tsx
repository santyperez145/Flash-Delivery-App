// Preferencias alimentarias de cuenta (ARC-001).
//
// Uber Eats y DoorDash guardan dieta/alérgenos fuera de pagos y sesiones.
import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import { api } from "../api";
import { styles } from "../styles";
import type { DietaryPreferences } from "../types";
import type { AccountRunAction } from "./CustomerAccountTypes";

export function CustomerAccountDietary({
  busy,
  runAction,
  dietaryPreferences,
  setDietaryPreferences,
}: {
  busy: boolean;
  runAction: AccountRunAction;
  dietaryPreferences: DietaryPreferences;
  setDietaryPreferences: (preferences: DietaryPreferences) => void;
}) {
  return (
    <View style={styles.addressBookCard}>
      <View style={styles.addressBookHeading}>
        <View>
          <Text style={styles.foodRestaurantTitle}>Preferencias alimentarias</Text>
          <Text style={styles.cardText}>
            Se guardan en tu cuenta y ayudan a ocultar incompatibles.
          </Text>
        </View>
        <Ionicons name="leaf-outline" size={25} color="#087a50" />
      </View>
      <Text style={styles.sectionTitle}>Mi alimentación</Text>
      <View style={styles.dietaryPreferenceGrid}>
        {[
          { code: "vegetarian", name: "Vegetariano" },
          { code: "vegan", name: "Vegano" },
          { code: "gluten_free", name: "Sin gluten" },
          { code: "halal", name: "Halal" },
          { code: "kosher", name: "Kosher" },
        ].map((option) => {
          const selected = dietaryPreferences.dietaryLabels.some(
            (entry) => entry.code === option.code,
          );
          return (
            <Pressable
              key={option.code}
              style={[styles.dietaryPreferenceChip, selected && styles.dietaryPreferenceChipActive]}
              onPress={() => {
                const dietaryLabels = selected
                  ? dietaryPreferences.dietaryLabels
                      .filter((entry) => entry.code !== option.code)
                      .map((entry) => entry.code)
                  : [...dietaryPreferences.dietaryLabels.map((entry) => entry.code), option.code];
                runAction(async () => {
                  const result = await api.updateDietaryPreferences({
                    dietaryLabels,
                    avoidedAllergens: dietaryPreferences.avoidedAllergens.map(
                      (entry) => entry.code,
                    ),
                    hideIncompatible: dietaryPreferences.hideIncompatible,
                  });
                  setDietaryPreferences(result.preferences);
                }, "Preferencias alimentarias actualizadas");
              }}
            >
              <Text
                style={[
                  styles.dietaryPreferenceText,
                  selected && styles.dietaryPreferenceTextActive,
                ]}
              >
                {option.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.sectionTitle}>Evito estos alérgenos</Text>
      <View style={styles.dietaryPreferenceGrid}>
        {[
          { code: "gluten", name: "Gluten" },
          { code: "milk", name: "Leche" },
          { code: "eggs", name: "Huevo" },
          { code: "peanuts", name: "Maní" },
          { code: "tree_nuts", name: "Frutos secos" },
          { code: "soy", name: "Soja" },
          { code: "fish", name: "Pescado" },
          { code: "shellfish", name: "Crustáceos" },
          { code: "sesame", name: "Sésamo" },
        ].map((option) => {
          const selected = dietaryPreferences.avoidedAllergens.some(
            (entry) => entry.code === option.code,
          );
          return (
            <Pressable
              key={option.code}
              style={[styles.dietaryPreferenceChip, selected && styles.dietaryAllergenChipActive]}
              onPress={() => {
                const avoidedAllergens = selected
                  ? dietaryPreferences.avoidedAllergens
                      .filter((entry) => entry.code !== option.code)
                      .map((entry) => entry.code)
                  : [
                      ...dietaryPreferences.avoidedAllergens.map((entry) => entry.code),
                      option.code,
                    ];
                runAction(async () => {
                  const result = await api.updateDietaryPreferences({
                    dietaryLabels: dietaryPreferences.dietaryLabels.map((entry) => entry.code),
                    avoidedAllergens,
                    hideIncompatible: dietaryPreferences.hideIncompatible,
                  });
                  setDietaryPreferences(result.preferences);
                }, "Alérgenos actualizados");
              }}
            >
              <Text
                style={[styles.dietaryPreferenceText, selected && styles.dietaryAllergenTextActive]}
              >
                {option.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.preferenceRow}>
        <View style={styles.savedAddressCopy}>
          <Text style={styles.sectionTitle}>Ocultar productos incompatibles</Text>
          <Text style={styles.cardText}>
            Sólo usa declaraciones del comercio; “sin datos” nunca significa seguro.
          </Text>
        </View>
        <Pressable
          disabled={busy}
          accessibilityRole="switch"
          accessibilityState={{ checked: dietaryPreferences.hideIncompatible }}
          style={[
            styles.preferenceSwitch,
            dietaryPreferences.hideIncompatible && styles.preferenceSwitchActive,
          ]}
          onPress={() =>
            runAction(async () => {
              const result = await api.updateDietaryPreferences({
                dietaryLabels: dietaryPreferences.dietaryLabels.map((entry) => entry.code),
                avoidedAllergens: dietaryPreferences.avoidedAllergens.map((entry) => entry.code),
                hideIncompatible: !dietaryPreferences.hideIncompatible,
              });
              setDietaryPreferences(result.preferences);
            }, "Filtro alimentario actualizado")
          }
        >
          <View
            style={[
              styles.preferenceKnob,
              dietaryPreferences.hideIncompatible && styles.preferenceKnobActive,
            ]}
          />
        </Pressable>
      </View>
      <View style={styles.dietarySafetyNote}>
        <Ionicons name="information-circle-outline" size={18} color="#9a4b00" />
        <Text style={styles.allergenWarningText}>
          Ante una alergia severa, confirmá siempre con el comercio. Las indicaciones de cocina no
          eliminan contaminación cruzada.
        </Text>
      </View>
    </View>
  );
}
