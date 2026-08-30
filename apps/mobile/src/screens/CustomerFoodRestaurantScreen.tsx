import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  Image,
  ImageBackground,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { flashDesign } from "../design-system";
import { money } from "../format";
import { styles } from "../styles";
import type { DietaryPreferences, Restaurant } from "../types";

type MenuItem = Restaurant["menu"][number];

export function CustomerFoodRestaurantScreen({
  visible,
  restaurant,
  menuCategories,
  selectedMenuCategory,
  visibleMenuItems,
  dietaryPreferences,
  favorite,
  favoritePending,
  cartCount,
  cartTotal,
  busy,
  onHome,
  onToggleFavorite,
  onSelectMenuCategory,
  onAddItem,
  onOpenCart,
}: {
  visible: boolean;
  restaurant: Restaurant | null;
  menuCategories: string[];
  selectedMenuCategory: string;
  visibleMenuItems: MenuItem[];
  dietaryPreferences: DietaryPreferences;
  favorite: boolean;
  favoritePending: boolean;
  cartCount: number;
  cartTotal: number;
  busy: boolean;
  onHome: () => void;
  onToggleFavorite: (restaurantId: string) => void;
  onSelectMenuCategory: (category: string) => void;
  onAddItem: (restaurant: Restaurant, item: MenuItem, extras?: string[], note?: string) => void;
  onOpenCart: () => void;
}) {
  const [customizingItem, setCustomizingItem] = useState<MenuItem | null>(null);
  const [customizingExtras, setCustomizingExtras] = useState<string[]>([]);
  const [customizingNote, setCustomizingNote] = useState("");

  if (!visible || !restaurant) return null;

  const modifierTotal = (customizingItem?.modifierGroups || [])
    .flatMap((group) => group.modifiers)
    .filter((modifier) => customizingExtras.includes(modifier.id))
    .reduce((sum, modifier) => sum + modifier.price, 0);
  const customizingTotal = (customizingItem?.price || 0) + modifierTotal;
  const customizingSelectionValid = !customizingItem?.modifierGroups?.some(
    (group) =>
      customizingExtras.filter((id) => group.modifiers.some((modifier) => modifier.id === id))
        .length < group.min,
  );

  const openCustomizer = (item: MenuItem) => {
    setCustomizingItem(item);
    setCustomizingExtras([]);
    setCustomizingNote("");
  };

  return (
    <>
      <ImageBackground
        source={{ uri: restaurant.cover }}
        imageStyle={styles.foodRestaurantHeroImage}
        style={styles.foodRestaurantHero}
      >
        <Pressable onPress={onHome} style={styles.foodFloatingButton}>
          <Ionicons name="chevron-back" size={22} color={flashDesign.color.ink} />
        </Pressable>
        <Pressable
          disabled={favoritePending}
          style={styles.foodFloatingButton}
          accessibilityLabel={
            favorite
              ? `Quitar ${restaurant.name} de favoritos`
              : `Guardar ${restaurant.name} en favoritos`
          }
          accessibilityState={{ checked: favorite, busy: favoritePending }}
          onPress={() => onToggleFavorite(restaurant.id)}
        >
          <Ionicons
            name={favorite ? "heart" : "heart-outline"}
            size={22}
            color={favorite ? flashDesign.color.food : flashDesign.color.ink}
          />
        </Pressable>
      </ImageBackground>
      <View style={styles.foodRestaurantInfo}>
        <View style={styles.foodRestaurantStatusRow}>
          <View style={styles.foodRestaurantOpenBadge}>
            <View style={styles.foodRestaurantOpenDot} />
            <Text style={styles.foodRestaurantOpenText}>Abierto ahora</Text>
          </View>
          {restaurant.badge ? (
            <Text style={styles.foodRestaurantOfferBadge}>{restaurant.badge}</Text>
          ) : null}
        </View>
        <Text style={styles.foodRestaurantTitle}>{restaurant.name}</Text>
        <Text style={styles.foodRestaurantCuisine}>
          {restaurant.cuisine} · {restaurant.address}
        </Text>
        <View style={styles.foodRestaurantFacts}>
          <View style={styles.foodRestaurantFact}>
            <View style={styles.foodRestaurantFactIcon}>
              <Ionicons name="star" size={15} color="#E98A00" />
            </View>
            <View>
              <Text style={styles.foodRestaurantFactValue}>{restaurant.rating.toFixed(1)}</Text>
              <Text style={styles.foodRestaurantFactLabel}>calificación</Text>
            </View>
          </View>
          <View style={styles.foodRestaurantFact}>
            <View style={styles.foodRestaurantFactIcon}>
              <Ionicons name="time-outline" size={16} color={flashDesign.color.food} />
            </View>
            <View>
              <Text style={styles.foodRestaurantFactValue}>{restaurant.etaMin} min</Text>
              <Text style={styles.foodRestaurantFactLabel}>estimado</Text>
            </View>
          </View>
          <View style={styles.foodRestaurantFact}>
            <View style={styles.foodRestaurantFactIcon}>
              <Ionicons name="bicycle-outline" size={16} color={flashDesign.color.shipment} />
            </View>
            <View>
              <Text style={styles.foodRestaurantFactValue}>
                {restaurant.deliveryFee ? money.format(restaurant.deliveryFee) : "Gratis"}
              </Text>
              <Text style={styles.foodRestaurantFactLabel}>
                {restaurant.distanceKm.toFixed(1)} km
              </Text>
            </View>
          </View>
        </View>
      </View>
      <View style={styles.foodSectionHeader}>
        <Text style={styles.foodSectionTitle}>Menú</Text>
        <Text style={styles.foodSeeAll}>{visibleMenuItems.length} disponibles</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.foodMenuTabs}
      >
        {menuCategories.map((category) => (
          <Pressable
            key={category}
            style={[
              styles.foodMenuTabButton,
              selectedMenuCategory === category && styles.foodMenuTabButtonActive,
            ]}
            onPress={() => onSelectMenuCategory(category)}
            accessibilityState={{ selected: selectedMenuCategory === category }}
          >
            <Text
              style={[
                styles.foodMenuTab,
                selectedMenuCategory === category && styles.foodMenuTabActive,
              ]}
            >
              {category}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {dietaryPreferences.hideIncompatible ? (
        <View style={styles.dietaryFilterBanner}>
          <Ionicons name="options-outline" size={17} color="#087a50" />
          <Text style={styles.dietaryBadgeText}>
            Filtro personal activo · sólo productos declarados compatibles
          </Text>
        </View>
      ) : null}
      {visibleMenuItems.map((item) => (
        <View key={item.id} style={styles.foodProductCard}>
          <ImageBackground
            source={{ uri: restaurant.image || restaurant.cover }}
            imageStyle={styles.foodProductImageStyle}
            style={styles.foodProductImage}
          >
            {!item.stock ? (
              <View style={styles.foodProductUnavailable}>
                <Text style={styles.foodProductUnavailableText}>AGOTADO</Text>
              </View>
            ) : null}
          </ImageBackground>
          <View style={styles.itemCopy}>
            <View style={styles.foodProductHeading}>
              <Text style={styles.foodProductName} numberOfLines={2}>
                {item.name}
              </Text>
              {item.dietaryLabels?.length ? (
                <Ionicons name="leaf-outline" size={16} color={flashDesign.color.shipment} />
              ) : null}
            </View>
            <Text style={styles.foodProductDescription} numberOfLines={2}>
              {item.description?.trim() || item.category || "Información del producto no declarada"}
            </Text>
            <Text style={styles.foodProductPrice}>{money.format(item.price)}</Text>
          </View>
          <Pressable
            disabled={!item.stock || busy}
            onPress={() =>
              item.modifierGroups?.length ? openCustomizer(item) : onAddItem(restaurant, item)
            }
            style={[styles.foodAddButton, !item.stock && styles.foodAddButtonDisabled]}
            accessibilityLabel={item.stock ? `Agregar ${item.name}` : `${item.name} agotado`}
          >
            <Ionicons name="add" size={22} color="#fff" />
          </Pressable>
        </View>
      ))}
      {visibleMenuItems.length === 0 ? (
        <View style={styles.foodSearchState}>
          <View style={styles.foodSearchStateIcon}>
            <Ionicons name="restaurant-outline" size={25} color={flashDesign.color.food} />
          </View>
          <Text style={styles.foodSearchStateTitle}>No hay productos disponibles</Text>
          <Text style={styles.foodSearchStateCopy}>
            Probá otra categoría o revisá tus preferencias alimentarias.
          </Text>
          <Pressable style={styles.foodSearchRetry} onPress={() => onSelectMenuCategory("Todos")}>
            <Text style={styles.foodSearchRetryText}>Ver todo el menú</Text>
          </Pressable>
        </View>
      ) : null}
      {cartCount > 0 ? (
        <Pressable onPress={onOpenCart} style={styles.foodStickyCart}>
          <Text style={styles.foodStickyCount}>{cartCount}</Text>
          <Text style={styles.foodStickyLabel}>Ver carrito</Text>
          <Text style={styles.foodStickyPrice}>{money.format(cartTotal)}</Text>
        </Pressable>
      ) : null}
      <Modal
        visible={Boolean(customizingItem)}
        transparent
        animationType="slide"
        onRequestClose={() => setCustomizingItem(null)}
      >
        <View style={styles.productCustomizerBackdrop}>
          <View style={styles.productCustomizerSheet}>
            <View style={styles.productCustomizerHandle} />
            <View style={styles.productCustomizerHeader}>
              <View style={styles.itemCopy}>
                <Text style={styles.productCustomizerEyebrow}>PERSONALIZAR</Text>
                <Text style={styles.productCustomizerTitle}>{customizingItem?.name}</Text>
                <Text style={styles.productCustomizerRestaurant}>{restaurant.name}</Text>
              </View>
              <Pressable
                style={styles.foodBack}
                accessibilityLabel="Cerrar personalización"
                onPress={() => setCustomizingItem(null)}
              >
                <Ionicons name="close" size={21} color={flashDesign.color.ink} />
              </Pressable>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.productCustomizerContent}
            >
              <View style={styles.productCustomizerSummary}>
                <Image
                  source={{ uri: restaurant.image || restaurant.cover }}
                  style={styles.productCustomizerImage}
                />
                <View style={styles.itemCopy}>
                  <Text style={styles.productCustomizerSummaryPrice}>
                    {money.format(customizingItem?.price || 0)}
                  </Text>
                  <Text style={styles.productCustomizerSummaryDescription} numberOfLines={3}>
                    {customizingItem?.description?.trim() ||
                      customizingItem?.category ||
                      "Información del producto no declarada"}
                  </Text>
                </View>
              </View>
              {customizingItem?.dietaryLabels?.length ? (
                <View style={styles.dietaryBadgeRow}>
                  {customizingItem.dietaryLabels.map((label) => (
                    <View style={styles.dietaryBadge} key={label.code}>
                      <Ionicons name="leaf-outline" size={14} color={flashDesign.color.shipment} />
                      <Text style={styles.dietaryBadgeText}>{label.name}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {customizingItem?.allergens?.length ? (
                <View style={styles.allergenWarning}>
                  <View style={styles.productCustomizerWarningIcon}>
                    <Ionicons name="warning-outline" size={19} color="#9A4B00" />
                  </View>
                  <View style={styles.itemCopy}>
                    <Text style={styles.allergenWarningTitle}>Información de alérgenos</Text>
                    <Text style={styles.allergenWarningText}>
                      {customizingItem.allergens
                        .map(
                          (entry) =>
                            `${entry.presence === "contains" ? "Contiene" : "Puede contener"} ${entry.name.toLowerCase()}`,
                        )
                        .join(" · ")}
                    </Text>
                  </View>
                </View>
              ) : null}
              {customizingItem?.modifierGroups?.map((group) => {
                const selected = customizingExtras.filter((id) =>
                  group.modifiers.some((modifier) => modifier.id === id),
                );
                return (
                  <View key={group.id} style={styles.foodCustomizerGroup}>
                    <View style={styles.foodCustomizerGroupHeader}>
                      <View style={styles.itemCopy}>
                        <View style={styles.foodCustomizerGroupTitleRow}>
                          <Text style={styles.foodCustomizerGroupTitle}>{group.name}</Text>
                          <Text
                            style={[
                              styles.foodCustomizerRequirement,
                              group.required && styles.foodCustomizerRequirementRequired,
                            ]}
                          >
                            {group.required ? "OBLIGATORIO" : "OPCIONAL"}
                          </Text>
                        </View>
                        <Text style={styles.foodCustomizerGroupMeta}>
                          Elegí entre {group.min} y {group.max}
                        </Text>
                      </View>
                      <Text style={styles.modifierCounter}>
                        {selected.length}/{group.max}
                      </Text>
                    </View>
                    {group.modifiers
                      .filter((modifier) => modifier.available)
                      .map((modifier) => {
                        const checked = customizingExtras.includes(modifier.id);
                        const blocked = !checked && selected.length >= group.max;
                        return (
                          <Pressable
                            key={modifier.id}
                            disabled={blocked}
                            style={[
                              styles.modifierRow,
                              checked && styles.modifierRowSelected,
                              blocked && styles.modifierRowBlocked,
                            ]}
                            onPress={() =>
                              setCustomizingExtras((current) =>
                                checked
                                  ? current.filter((id) => id !== modifier.id)
                                  : [...current, modifier.id],
                              )
                            }
                            accessibilityState={{ checked, disabled: blocked }}
                          >
                            <View
                              style={[
                                styles.modifierControl,
                                checked && styles.modifierControlSelected,
                              ]}
                            >
                              {checked ? (
                                <Ionicons name="checkmark" size={15} color="#fff" />
                              ) : null}
                            </View>
                            <Text style={styles.modifierName}>{modifier.name}</Text>
                            <Text style={styles.modifierPrice}>
                              {modifier.price ? `+ ${money.format(modifier.price)}` : "Incluido"}
                            </Text>
                          </Pressable>
                        );
                      })}
                  </View>
                );
              })}
              <View style={styles.foodCustomizerNoteSection}>
                <View style={styles.foodCustomizerNoteHeading}>
                  <View>
                    <Text style={styles.foodCustomizerGroupTitle}>Indicaciones para cocina</Text>
                    <Text style={styles.foodCustomizerGroupMeta}>
                      Opcional · máximo 500 caracteres
                    </Text>
                  </View>
                  <Text style={styles.foodCustomizerNoteCount}>{customizingNote.length}/500</Text>
                </View>
                <TextInput
                  value={customizingNote}
                  onChangeText={setCustomizingNote}
                  maxLength={500}
                  multiline
                  placeholder="Ej. sin sal, cortar por la mitad"
                  placeholderTextColor={flashDesign.color.muted}
                  style={styles.productNote}
                />
              </View>
            </ScrollView>
            <Pressable
              disabled={busy || !customizingSelectionValid}
              style={[
                styles.productCustomizerAction,
                (busy || !customizingSelectionValid) && styles.disabledButton,
              ]}
              onPress={() => {
                if (customizingItem) {
                  onAddItem(restaurant, customizingItem, customizingExtras, customizingNote);
                }
                setCustomizingItem(null);
              }}
            >
              <View style={styles.productCustomizerActionCount}>
                <Text style={styles.productCustomizerActionCountText}>1</Text>
              </View>
              <Text style={styles.productCustomizerActionText}>
                {busy ? "Agregando…" : "Agregar al carrito"}
              </Text>
              <Text style={styles.productCustomizerActionPrice}>
                {money.format(customizingTotal)}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}
