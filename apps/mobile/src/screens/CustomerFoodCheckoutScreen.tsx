import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable, Text, View } from "react-native";

import { flashDesign } from "../design-system";
import { money } from "../format";
import { SchedulePicker } from "../SchedulePicker";
import { styles } from "../styles";
import { TipSelector } from "../TipSelector";
import type { FoodCheckoutQuote, PaymentMethod } from "../types";

export function CustomerFoodCheckoutScreen({
  visible,
  quote,
  restaurantName,
  paymentMethod,
  busy,
  tipCents,
  scheduledFor,
  onTipChange,
  onScheduleChange,
  onBack,
  onConfirm,
  onRefreshQuote,
}: {
  visible: boolean;
  quote: FoodCheckoutQuote | null;
  restaurantName?: string;
  paymentMethod?: PaymentMethod;
  busy: boolean;
  tipCents: number;
  scheduledFor: string | null;
  onTipChange: (value: number) => void;
  onScheduleChange: (value: string | null) => void;
  onBack: () => void;
  onConfirm: () => void;
  onRefreshQuote: () => void;
}) {
  if (!visible || !quote) return null;

  const quoteExpired = new Date(quote.expiresAt) <= new Date();

  return (
    <>
      <View style={styles.foodPageHeader}>
        <Pressable onPress={onBack} style={styles.foodBack}>
          <Ionicons name="chevron-back" size={20} color={flashDesign.color.ink} />
        </Pressable>
        <View style={styles.foodPageHeaderCopy}>
          <Text style={styles.foodPageTitle}>Confirmar pedido</Text>
          <Text style={styles.foodPageSubtitle}>Última revisión antes de cobrar</Text>
        </View>
      </View>
      <LinearGradient colors={[flashDesign.color.ink, "#36293D"]} style={styles.foodCheckoutHero}>
        <View style={styles.foodCheckoutHeroTop}>
          <View style={styles.foodCheckoutVerified}>
            <Ionicons name="shield-checkmark" size={15} color="#BDF3D7" />
            <Text style={styles.foodCheckoutVerifiedText}>PRECIO FIRMADO</Text>
          </View>
          <Text style={styles.foodCheckoutExpiry}>
            Hasta{" "}
            {new Date(quote.expiresAt).toLocaleTimeString("es-AR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
        </View>
        <Text style={styles.foodCheckoutMerchant}>{restaurantName}</Text>
        <Text style={styles.foodCheckoutEta}>Llega en aproximadamente {quote.etaMin} min</Text>
        <View style={styles.foodCheckoutHeroFacts}>
          <View>
            <Text style={styles.foodCheckoutHeroFactLabel}>DISTANCIA</Text>
            <Text style={styles.foodCheckoutHeroFactValue}>{quote.distanceKm} km</Text>
          </View>
          <View style={styles.foodCheckoutHeroDivider} />
          <View style={styles.itemCopy}>
            <Text style={styles.foodCheckoutHeroFactLabel}>TARIFA</Text>
            <Text style={styles.foodCheckoutHeroFactValue} numberOfLines={1}>
              {quote.pricingVersion}
            </Text>
          </View>
        </View>
      </LinearGradient>
      <View style={styles.foodSectionHeader}>
        <Text style={styles.foodSectionTitle}>Entrega y pago</Text>
        <Pressable onPress={onBack}>
          <Text style={styles.foodSeeAll}>Editar</Text>
        </Pressable>
      </View>
      <View style={styles.foodCheckoutInfoList}>
        <View style={styles.foodCheckoutInfoCard}>
          <View
            style={[
              styles.foodCheckoutInfoIcon,
              { backgroundColor: flashDesign.color.warningSoft },
            ]}
          >
            <Ionicons name="location" size={20} color={flashDesign.color.food} />
          </View>
          <View style={styles.itemCopy}>
            <Text style={styles.foodCheckoutInfoTitle}>Entregar en</Text>
            <Text style={styles.foodCheckoutInfoValue} numberOfLines={2}>
              {quote.deliveryAddress}
            </Text>
            <Text style={styles.foodCheckoutInfoMeta}>Dirección validada con coordenadas</Text>
          </View>
          <Ionicons name="checkmark-circle" size={21} color={flashDesign.color.shipment} />
        </View>
        <View style={styles.foodCheckoutInfoCard}>
          <View style={[styles.foodCheckoutInfoIcon, { backgroundColor: "#EEE7FF" }]}>
            <Ionicons
              name={paymentMethod?.type === "wallet" ? "wallet" : "card"}
              size={20}
              color={flashDesign.color.brand}
            />
          </View>
          <View style={styles.itemCopy}>
            <Text style={styles.foodCheckoutInfoTitle}>Pagar con</Text>
            <Text style={styles.foodCheckoutInfoValue}>{quote.paymentMethod}</Text>
            <Text style={styles.foodCheckoutInfoMeta}>
              {paymentMethod?.type === "wallet"
                ? "Captura atómica al confirmar"
                : "Token seguro · captura según proveedor"}
            </Text>
          </View>
          <Ionicons name="checkmark-circle" size={21} color={flashDesign.color.shipment} />
        </View>
      </View>
      <View style={styles.foodSectionHeader}>
        <Text style={styles.foodSectionTitle}>Tu pedido</Text>
        <Text style={styles.foodSeeAll}>
          {quote.items.reduce((sum, item) => sum + item.quantity, 0)} unidades
        </Text>
      </View>
      <View style={styles.foodCheckoutItems}>
        {quote.items.map((item, index) => (
          <View key={`${item.menuItemId}-${index}`} style={styles.checkoutItem}>
            <View style={styles.foodCheckoutItemQuantity}>
              <Text style={styles.foodCheckoutItemQuantityText}>{item.quantity}×</Text>
            </View>
            <View style={styles.itemCopy}>
              <Text style={styles.foodCheckoutItemName}>{item.name}</Text>
              {item.modifiers.map((modifier) => (
                <Text key={modifier.id} style={styles.foodCheckoutItemMeta}>
                  + {modifier.name}
                  {modifier.price ? ` · ${money.format(modifier.price)}` : ""}
                </Text>
              ))}
              {item.note ? <Text style={styles.foodCheckoutItemNote}>“{item.note}”</Text> : null}
            </View>
            <Text style={styles.foodCheckoutItemPrice}>
              {money.format(item.unitPrice * item.quantity)}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.foodSectionHeader}>
        <Text style={styles.foodSectionTitle}>Detalle del total</Text>
        <Text style={styles.foodSeeAll}>ARS</Text>
      </View>
      <View style={styles.foodCheckoutTotals}>
        <View style={styles.foodTotalRow}>
          <Text style={styles.foodCheckoutTotalLabel}>Productos</Text>
          <Text style={styles.foodCheckoutTotalAmount}>{money.format(quote.subtotal)}</Text>
        </View>
        <View style={styles.foodTotalRow}>
          <Text style={styles.foodCheckoutTotalLabel}>Envío</Text>
          <Text style={styles.foodCheckoutTotalAmount}>{money.format(quote.deliveryFee)}</Text>
        </View>
        <View style={styles.foodTotalRow}>
          <Text style={styles.foodCheckoutTotalLabel}>Tarifa de servicio</Text>
          <Text style={styles.foodCheckoutTotalAmount}>{money.format(quote.serviceFee)}</Text>
        </View>
        {quote.discount > 0 ? (
          <View style={styles.foodTotalRow}>
            <Text style={styles.foodCheckoutDiscountLabel}>Descuento {quote.promotionCode}</Text>
            <Text style={styles.foodCheckoutDiscountAmount}>− {money.format(quote.discount)}</Text>
          </View>
        ) : null}
        {quote.subscriptionDiscount > 0 ? (
          <View style={styles.foodTotalRow}>
            <Text style={styles.foodCheckoutDiscountLabel}>Envío con Flash Más</Text>
            <Text style={styles.foodCheckoutDiscountAmount}>
              − {money.format(quote.subscriptionDiscount)}
            </Text>
          </View>
        ) : null}
        {tipCents > 0 ? (
          <View style={styles.foodTotalRow}>
            <Text style={styles.foodCheckoutTotalLabel}>Propina</Text>
            <Text style={styles.foodCheckoutTotalAmount}>{money.format(tipCents / 100)}</Text>
          </View>
        ) : null}
        <View style={styles.foodCheckoutTotalDivider} />
        <View style={styles.foodTotalRow}>
          <Text style={styles.foodCheckoutGrandLabel}>Total</Text>
          <Text style={styles.foodCheckoutGrandAmount}>
            {money.format(quote.total + tipCents / 100)}
          </Text>
        </View>
      </View>
      <SchedulePicker scheduledFor={scheduledFor} onChange={onScheduleChange} disabled={busy} />
      <TipSelector
        subtotal={quote.subtotal}
        tipCents={tipCents}
        onChange={onTipChange}
        orderTotal={quote.total}
        disabled={busy}
      />
      <View style={styles.foodCheckoutSecurity}>
        <View style={styles.foodCheckoutSecurityIcon}>
          <Ionicons name="lock-closed" size={18} color={flashDesign.color.shipment} />
        </View>
        <Text style={styles.foodCheckoutSecurityText}>
          Al confirmar, el servidor vuelve a validar stock, cupón, propiedad de la dirección y monto
          firmado antes de cobrar.
        </Text>
      </View>
      <Pressable
        disabled={busy || quoteExpired}
        style={[styles.foodCheckoutPrimary, (busy || quoteExpired) && styles.disabledButton]}
        onPress={onConfirm}
      >
        <Text style={styles.foodCheckoutPrimaryText}>
          {busy ? "Confirmando…" : `Confirmar · ${money.format(quote.total + tipCents / 100)}`}
        </Text>
        <Ionicons name="arrow-forward" size={18} color="#fff" />
      </Pressable>
      {quoteExpired ? (
        <Pressable disabled={busy} style={styles.foodCheckoutRefresh} onPress={onRefreshQuote}>
          <Ionicons name="refresh" size={17} color={flashDesign.color.food} />
          <Text style={styles.foodCheckoutRefreshText}>El precio venció · actualizar</Text>
        </Pressable>
      ) : null}
    </>
  );
}
