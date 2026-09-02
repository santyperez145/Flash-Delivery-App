// Medios de pago de cuenta (ARC-001).
//
// Uber Wallet y DoorDash aíslan tokens del PSP de sesiones y soporte.
// El alta sandbox no se presenta como cobro productivo.
import { Ionicons } from "@expo/vector-icons";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { api } from "../api";
import { styles } from "../styles";
import type { AppState, User } from "../types";
import type { AccountRunAction } from "./CustomerAccountTypes";

export function CustomerAccountPayments({
  state,
  user,
  busy,
  runAction,
  paymentToken,
  setPaymentToken,
  paymentBrand,
  setPaymentBrand,
  paymentLast4,
  setPaymentLast4,
  paymentExpiry,
  setPaymentExpiry,
}: {
  state: AppState;
  user: User;
  busy: boolean;
  runAction: AccountRunAction;
  paymentToken: string;
  setPaymentToken: (value: string) => void;
  paymentBrand: "visa" | "mastercard" | "amex" | "cabal";
  setPaymentBrand: (value: "visa" | "mastercard" | "amex" | "cabal") => void;
  paymentLast4: string;
  setPaymentLast4: (value: string) => void;
  paymentExpiry: string;
  setPaymentExpiry: (value: string) => void;
}) {
  return (
    <View style={styles.addressBookCard}>
      <View style={styles.addressBookHeading}>
        <View>
          <Text style={styles.foodRestaurantTitle}>Métodos de pago</Text>
          <Text style={styles.cardText}>Sólo guardamos tokens y datos enmascarados.</Text>
        </View>
        <Ionicons name="card-outline" size={24} color="#7c3cff" />
      </View>
      {state.paymentMethods
        .filter((method) => method.userId === user.id)
        .map((method) => (
          <View style={styles.paymentMethodRow} key={method.id}>
            <View
              style={[styles.savedAddressIcon, method.isDefault && styles.savedAddressIconDefault]}
            >
              <Ionicons
                name={method.type === "wallet" ? "wallet-outline" : "card-outline"}
                size={19}
                color={method.isDefault ? "#fff" : "#7c3cff"}
              />
            </View>
            <View style={styles.savedAddressCopy}>
              <View style={styles.savedAddressTitle}>
                <Text style={styles.sectionTitle}>{method.label}</Text>
                {method.isDefault && <Text style={styles.defaultAddressBadge}>Principal</Text>}
              </View>
              {method.expiryMonth && (
                <Text style={styles.cardText}>
                  Vence {String(method.expiryMonth).padStart(2, "0")}/{method.expiryYear}
                </Text>
              )}
            </View>
            {method.type !== "wallet" && (
              <View style={styles.savedAddressActions}>
                {!method.isDefault && (
                  <Pressable
                    disabled={busy}
                    onPress={() =>
                      runAction(
                        () => api.setDefaultPaymentMethod(method.id),
                        "Método principal actualizado",
                      )
                    }
                  >
                    <Ionicons name="star-outline" size={20} color="#7c3cff" />
                  </Pressable>
                )}
                <Pressable
                  disabled={busy}
                  onPress={() =>
                    Alert.alert("Eliminar método", `¿Eliminar ${method.label}?`, [
                      { text: "Cancelar", style: "cancel" },
                      {
                        text: "Eliminar",
                        style: "destructive",
                        onPress: () =>
                          runAction(() => api.deletePaymentMethod(method.id), "Método eliminado"),
                      },
                    ])
                  }
                >
                  <Ionicons name="trash-outline" size={20} color="#d74a43" />
                </Pressable>
              </View>
            )}
          </View>
        ))}
      <View style={styles.newAddressForm}>
        <Text style={styles.sectionTitle}>Agregar tarjeta sandbox</Text>
        <Text style={styles.cardText}>
          El SDK del PSP genera el token; Flash nunca recibe el número completo ni el CVV.
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.paymentBrandRail}
        >
          {(["visa", "mastercard", "amex", "cabal"] as const).map((brand) => (
            <Pressable
              key={brand}
              style={[
                styles.issueCategoryPill,
                paymentBrand === brand && styles.issueCategoryPillActive,
              ]}
              onPress={() => setPaymentBrand(brand)}
            >
              <Text
                style={[
                  styles.issueCategoryText,
                  paymentBrand === brand && styles.issueCategoryTextActive,
                ]}
              >
                {brand.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <TextInput
          style={styles.input}
          value={paymentToken}
          onChangeText={setPaymentToken}
          autoCapitalize="none"
          placeholder="pm_test_token_seguro"
        />
        <View style={styles.paymentCompactFields}>
          <TextInput
            style={[styles.input, styles.paymentCompactInput]}
            value={paymentLast4}
            onChangeText={(value) => setPaymentLast4(value.replace(/[^0-9]/g, "").slice(0, 4))}
            keyboardType="numeric"
            placeholder="Últimos 4"
          />
          <TextInput
            style={[styles.input, styles.paymentCompactInput]}
            value={paymentExpiry}
            onChangeText={(value) => setPaymentExpiry(value.replace(/[^0-9/]/g, "").slice(0, 7))}
            keyboardType="numeric"
            placeholder="MM/AAAA"
          />
        </View>
        <Pressable
          disabled={
            busy ||
            !/^pm_test_[A-Za-z0-9_-]{8,120}$/.test(paymentToken) ||
            paymentLast4.length !== 4 ||
            !/^\d{2}\/\d{4}$/.test(paymentExpiry)
          }
          style={[
            styles.primaryButton,
            (busy ||
              !/^pm_test_[A-Za-z0-9_-]{8,120}$/.test(paymentToken) ||
              paymentLast4.length !== 4 ||
              !/^\d{2}\/\d{4}$/.test(paymentExpiry)) &&
              styles.disabledButton,
          ]}
          onPress={() => {
            const [month, year] = paymentExpiry.split("/").map(Number);
            runAction(async () => {
              await api.createSandboxPaymentMethod({
                providerToken: paymentToken,
                brand: paymentBrand,
                last4: paymentLast4,
                expiryMonth: month,
                expiryYear: year,
              });
              setPaymentToken("");
              setPaymentLast4("");
              setPaymentExpiry("");
            }, "Método tokenizado agregado");
          }}
        >
          <Ionicons name="shield-checkmark-outline" size={19} color="#fff" />
          <Text style={styles.primaryButtonText}>Guardar token seguro</Text>
        </Pressable>
      </View>
    </View>
  );
}
