import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, Text, TextInput, View } from "react-native";

import { flashDesign } from "../design-system";
import { money } from "../format";
import { styles } from "../styles";
import type { MobileCartLine, PaymentMethod, Promotion, Restaurant, UserAddress } from "../types";

export function CustomerFoodCartScreen({
  visible,
  cart,
  restaurant,
  addresses,
  userId,
  deliveryAddress,
  paymentMethods,
  selectedPayment,
  promotion,
  promotionCode,
  subtotal,
  busy,
  canCheckout,
  onBack,
  onHome,
  onOpenRestaurant,
  onChangeQuantity,
  onSelectAddress,
  onOpenAccount,
  onSelectPayment,
  onPromotionChange,
  onCheckout,
}: {
  visible: boolean;
  cart: MobileCartLine[];
  restaurant?: Restaurant;
  addresses: UserAddress[];
  userId: string;
  deliveryAddress: string;
  paymentMethods: PaymentMethod[];
  selectedPayment?: PaymentMethod;
  promotion: Promotion | null;
  promotionCode: string;
  subtotal: number;
  busy: boolean;
  canCheckout: boolean;
  onBack: () => void;
  onHome: () => void;
  onOpenRestaurant: (restaurantId: string) => void;
  onChangeQuantity: (lineId: string, delta: number) => void;
  onSelectAddress: (address: string) => void;
  onOpenAccount: () => void;
  onSelectPayment: (paymentMethodId: string) => void;
  onPromotionChange: (code: string) => void;
  onCheckout: () => void;
}) {
  if (!visible) return null;

  const geocodedAddresses = addresses.filter(
    (item) =>
      item.userId === userId &&
      !item.id.startsWith("profile-") &&
      item.lat !== null &&
      item.lng !== null,
  );

  return (
    <>
      <View style={styles.foodPageHeader}>
        <Pressable onPress={onBack} style={styles.foodBack}>
          <Ionicons name="chevron-back" size={20} color={flashDesign.color.ink} />
        </Pressable>
        <View style={styles.foodPageHeaderCopy}>
          <Text style={styles.foodPageTitle}>Mi carrito</Text>
          <Text style={styles.foodPageSubtitle}>Revisá productos, entrega y pago</Text>
        </View>
      </View>
      {cart.length === 0 ? (
        <View style={styles.foodEmpty}>
          <View style={styles.foodEmptyIcon}>
            <Ionicons name="bag-handle-outline" size={31} color={flashDesign.color.food} />
          </View>
          <Text style={styles.foodEmptyTitle}>Tu carrito está vacío</Text>
          <Text style={styles.foodEmptyCopy}>
            Explorá restaurantes abiertos y agregá productos para calcular entrega y total.
          </Text>
          <Pressable disabled={busy} style={styles.foodEmptyAction} onPress={onHome}>
            <Text style={styles.foodEmptyActionText}>Explorar restaurantes</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {restaurant ? (
            <Pressable
              style={styles.foodCartMerchant}
              onPress={() => onOpenRestaurant(restaurant.id)}
            >
              <Image
                source={{ uri: restaurant.image || restaurant.cover }}
                style={styles.foodCartMerchantImage}
              />
              <View style={styles.itemCopy}>
                <Text style={styles.foodCartMerchantEyebrow}>PEDIDO EN</Text>
                <Text style={styles.foodCartMerchantName}>{restaurant.name}</Text>
                <Text style={styles.foodCartMerchantMeta}>
                  {restaurant.etaMin} min · {restaurant.distanceKm.toFixed(1)} km
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color={flashDesign.color.muted} />
            </Pressable>
          ) : null}
          <View style={styles.foodSectionHeader}>
            <Text style={styles.foodSectionTitle}>Productos</Text>
            <Text style={styles.foodSeeAll}>
              {cart.reduce((sum, line) => sum + line.quantity, 0)} unidades
            </Text>
          </View>
          {cart.map((line) => (
            <View key={line.lineId} style={styles.foodCartLine}>
              <View style={styles.foodCartLineIcon}>
                <Ionicons name="restaurant-outline" size={19} color={flashDesign.color.food} />
              </View>
              <View style={styles.itemCopy}>
                <Text style={styles.foodCartLineName}>{line.name}</Text>
                <Text style={styles.foodProductPrice}>
                  {money.format(line.unitPrice * line.quantity)}
                </Text>
                {line.extras.length > 0 ? (
                  <Text style={styles.foodCartLineMeta}>
                    {line.extras.length} agregado{line.extras.length === 1 ? "" : "s"}
                  </Text>
                ) : null}
                {line.note ? (
                  <Text style={styles.foodCartLineNote} numberOfLines={2}>
                    “{line.note}”
                  </Text>
                ) : null}
              </View>
              <View style={styles.foodQuantity}>
                <Pressable
                  accessibilityLabel={`Quitar una unidad de ${line.name}`}
                  style={styles.foodQuantityButton}
                  onPress={() => onChangeQuantity(line.lineId, -1)}
                >
                  <Ionicons name="remove" size={17} color={flashDesign.color.ink} />
                </Pressable>
                <Text style={styles.foodQuantityValue}>{line.quantity}</Text>
                <Pressable
                  accessibilityLabel={`Agregar una unidad de ${line.name}`}
                  style={[styles.foodQuantityButton, styles.foodQuantityButtonAdd]}
                  onPress={() => onChangeQuantity(line.lineId, 1)}
                >
                  <Ionicons name="add" size={17} color="#fff" />
                </Pressable>
              </View>
            </View>
          ))}
          <View style={styles.foodSectionHeader}>
            <Text style={styles.foodSectionTitle}>Entrega</Text>
            <Text style={styles.foodSeeAll}>Dirección verificada</Text>
          </View>
          <View style={styles.foodCartOptionList}>
            {geocodedAddresses.map((address) => {
              const selected = deliveryAddress === address.address;
              return (
                <Pressable
                  key={address.id}
                  onPress={() => onSelectAddress(address.address)}
                  style={[styles.foodCartOption, selected && styles.foodCartOptionSelected]}
                  accessibilityState={{ selected }}
                >
                  <View
                    style={[
                      styles.foodCartOptionIcon,
                      selected && styles.foodCartOptionIconSelected,
                    ]}
                  >
                    <Ionicons
                      name={address.isDefault ? "home" : "location-outline"}
                      size={19}
                      color={selected ? "#fff" : flashDesign.color.food}
                    />
                  </View>
                  <View style={styles.savedAddressCopy}>
                    <View style={styles.foodCartOptionTitleRow}>
                      <Text style={styles.foodCartOptionTitle}>{address.label}</Text>
                      {address.isDefault ? (
                        <Text style={styles.foodCartDefaultBadge}>PREDETERMINADA</Text>
                      ) : null}
                    </View>
                    <Text style={styles.foodCartOptionMeta} numberOfLines={2}>
                      {address.address}
                    </Text>
                  </View>
                  <Ionicons
                    name={selected ? "checkmark-circle" : "ellipse-outline"}
                    size={22}
                    color={selected ? flashDesign.color.food : flashDesign.color.muted}
                  />
                </Pressable>
              );
            })}
            {!geocodedAddresses.length ? (
              <Pressable style={styles.foodCartMissingOption} onPress={onOpenAccount}>
                <Ionicons name="location-outline" size={20} color={flashDesign.color.danger} />
                <View style={styles.itemCopy}>
                  <Text style={styles.foodCartOptionTitle}>Falta una dirección geocodificada</Text>
                  <Text style={styles.foodCartOptionMeta}>
                    Agregala en Cuenta para poder cotizar la entrega.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={flashDesign.color.muted} />
              </Pressable>
            ) : null}
          </View>
          <View style={styles.foodSectionHeader}>
            <Text style={styles.foodSectionTitle}>Pago</Text>
            <Text style={styles.foodSeeAll}>Token seguro</Text>
          </View>
          <View style={styles.foodCartOptionList}>
            {paymentMethods.map((method) => {
              const selected = selectedPayment?.id === method.id;
              return (
                <Pressable
                  key={method.id}
                  onPress={() => onSelectPayment(method.id)}
                  style={[styles.foodCartOption, selected && styles.foodCartOptionSelected]}
                  accessibilityState={{ selected }}
                >
                  <View
                    style={[
                      styles.foodCartOptionIcon,
                      styles.foodCartPaymentIcon,
                      selected && styles.foodCartPaymentIconSelected,
                    ]}
                  >
                    <Ionicons
                      name={method.type === "wallet" ? "wallet" : "card"}
                      size={19}
                      color={selected ? "#fff" : flashDesign.color.brand}
                    />
                  </View>
                  <View style={styles.itemCopy}>
                    <Text style={styles.foodCartOptionTitle}>{method.label}</Text>
                    <Text style={styles.foodCartOptionMeta}>
                      {method.type === "wallet"
                        ? "Saldo y movimientos en Flash Wallet"
                        : method.brand
                          ? `${method.brand.toUpperCase()} terminada en ${method.last4 || "••••"}`
                          : "Método tokenizado"}
                    </Text>
                  </View>
                  <Ionicons
                    name={selected ? "checkmark-circle" : "ellipse-outline"}
                    size={22}
                    color={selected ? flashDesign.color.brand : flashDesign.color.muted}
                  />
                </Pressable>
              );
            })}
            {!paymentMethods.length ? (
              <Pressable style={styles.foodCartMissingOption} onPress={onOpenAccount}>
                <Ionicons name="card-outline" size={20} color={flashDesign.color.danger} />
                <View style={styles.itemCopy}>
                  <Text style={styles.foodCartOptionTitle}>Falta un método de pago</Text>
                  <Text style={styles.foodCartOptionMeta}>
                    Agregalo de forma segura desde Cuenta.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={flashDesign.color.muted} />
              </Pressable>
            ) : null}
          </View>
          <View style={styles.foodSectionHeader}>
            <Text style={styles.foodSectionTitle}>Promoción</Text>
            {promotion?.code ? (
              <Pressable onPress={() => onPromotionChange(promotion.code || "")}>
                <Text style={styles.foodSeeAll}>Usar {promotion.code}</Text>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.foodCouponField}>
            <View style={styles.foodCouponIcon}>
              <Ionicons name="ticket-outline" size={19} color={flashDesign.color.food} />
            </View>
            <TextInput
              value={promotionCode}
              onChangeText={(value) => onPromotionChange(value.toUpperCase())}
              autoCapitalize="characters"
              placeholder="Código promocional (opcional)"
              placeholderTextColor={flashDesign.color.muted}
              style={styles.foodCouponInput}
            />
            {promotionCode ? (
              <Pressable
                accessibilityLabel="Quitar promoción"
                style={styles.foodSearchClear}
                onPress={() => onPromotionChange("")}
              >
                <Ionicons name="close" size={17} color={flashDesign.color.inkSoft} />
              </Pressable>
            ) : null}
          </View>
          <View style={styles.foodCartTotalCard}>
            <View>
              <Text style={styles.foodCartTotalLabel}>SUBTOTAL DE PRODUCTOS</Text>
              <Text style={styles.foodCartTotalHelp}>
                Envío, servicio y descuento se calculan al continuar.
              </Text>
            </View>
            <Text style={styles.foodCartTotalValue}>{money.format(subtotal)}</Text>
          </View>
          <Pressable
            disabled={busy || !canCheckout}
            style={[styles.foodCheckoutPrimary, (busy || !canCheckout) && styles.disabledButton]}
            onPress={onCheckout}
          >
            <Text style={styles.foodCheckoutPrimaryText}>
              {busy ? "Calculando precio…" : "Continuar al checkout"}
            </Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </Pressable>
        </>
      )}
    </>
  );
}
