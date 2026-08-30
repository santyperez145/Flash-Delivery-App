import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Image, ImageBackground, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { flashDesign } from "../design-system";
import { money } from "../format";
import { styles } from "../styles";
import type { MobileCartLine, Promotion, Restaurant, User } from "../types";

export type CatalogSearchResult = {
  restaurantId: string;
  restaurantName: string;
  cuisine: string;
  image: string;
  cover: string;
  etaMin: number;
  deliveryFee: number;
  matchedItems: Array<{ id: string; name: string; category: string }>;
  matchCount: number;
  score: number;
};

type FoodCategory = { name: string; image: string; count: number };

export function CustomerFoodBrowseScreen({
  screen,
  user,
  deliveryAddress,
  cart,
  promotion,
  promotionValue,
  categories,
  selectedCategory,
  favoriteRestaurants,
  restaurants,
  favoriteRestaurantIds,
  favoritePendingId,
  query,
  catalogResults,
  catalogLoading,
  catalogError,
  catalogNextOffset,
  onOpenAccount,
  onOpenCart,
  onHome,
  onOpenSearch,
  onPromotionAction,
  onSelectCategory,
  onOpenRestaurant,
  onToggleFavorite,
  onQueryChange,
  onRetrySearch,
  onLoadMore,
}: {
  screen: string;
  user: User;
  deliveryAddress: string;
  cart: MobileCartLine[];
  promotion: Promotion | null;
  promotionValue: string;
  categories: FoodCategory[];
  selectedCategory: string;
  favoriteRestaurants: Restaurant[];
  restaurants: Restaurant[];
  favoriteRestaurantIds: string[];
  favoritePendingId: string | null;
  query: string;
  catalogResults: CatalogSearchResult[];
  catalogLoading: boolean;
  catalogError: string;
  catalogNextOffset: number | null;
  onOpenAccount: () => void;
  onOpenCart: () => void;
  onHome: () => void;
  onOpenSearch: () => void;
  onPromotionAction: (code?: string) => void;
  onSelectCategory: (category: string) => void;
  onOpenRestaurant: (restaurantId: string) => void;
  onToggleFavorite: (restaurantId: string) => void;
  onQueryChange: (query: string) => void;
  onRetrySearch: () => void;
  onLoadMore: () => void;
}) {
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  if (screen === "home") {
    return (
      <>
        <View style={styles.foodTopbar}>
          <View style={styles.foodLocationBlock}>
            <View style={styles.foodLocationIcon}>
              <Ionicons name="location" size={18} color={flashDesign.color.food} />
            </View>
            <View style={styles.foodLocationCopy}>
              <Text style={styles.foodDeliverLabel}>ENTREGAR EN</Text>
              <Text style={styles.foodAddress} numberOfLines={1}>
                {deliveryAddress || "Elegí una dirección"}
              </Text>
            </View>
          </View>
          <View style={styles.foodTopActions}>
            <Pressable
              onPress={onOpenAccount}
              style={styles.foodAvatar}
              accessibilityLabel="Abrir cuenta"
            >
              <Text style={styles.foodAvatarText}>
                {user.name.trim().slice(0, 1).toUpperCase()}
              </Text>
            </Pressable>
            <Pressable
              onPress={onOpenCart}
              style={styles.foodCartIcon}
              accessibilityLabel={`Abrir carrito con ${itemCount} productos`}
            >
              <Ionicons name="bag-handle-outline" size={20} color="#fff" />
              {itemCount > 0 ? <Text style={styles.foodCartCount}>{itemCount}</Text> : null}
            </Pressable>
          </View>
        </View>
        <View style={styles.foodHomeHeading}>
          <Text style={styles.foodHomeEyebrow}>HOLA, {user.name.split(" ")[0].toUpperCase()}</Text>
          <Text style={styles.foodHomeTitle}>¿Qué te gustaría pedir?</Text>
        </View>
        {promotion ? (
          <LinearGradient
            colors={[flashDesign.color.ink, "#33253B"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.foodPromoBanner}
          >
            <View style={styles.foodPromoCopy}>
              <View style={styles.foodPromoBadge}>
                <Ionicons name="sparkles" size={14} color={flashDesign.color.food} />
                <Text style={styles.foodPromoBadgeText}>{promotionValue}</Text>
              </View>
              <Text style={styles.foodPromoTitle}>{promotion.title}</Text>
              <Text style={styles.foodPromoDescription} numberOfLines={2}>
                {promotion.description}
              </Text>
              <Pressable
                style={styles.foodPromoAction}
                onPress={() => onPromotionAction(promotion.code)}
              >
                <Text style={styles.foodPromoActionText}>
                  {cart.length ? "Ver carrito" : "Explorar opciones"}
                </Text>
                <Ionicons name="arrow-forward" size={16} color={flashDesign.color.ink} />
              </Pressable>
            </View>
            <View style={styles.foodPromoArt}>
              <Ionicons name="fast-food" size={45} color="#fff" />
              <View style={styles.foodPromoArtDot} />
            </View>
          </LinearGradient>
        ) : null}
        <Pressable onPress={onOpenSearch} style={styles.foodSearchButton}>
          <Ionicons name="search" size={20} color={flashDesign.color.inkSoft} />
          <Text style={styles.foodSearchPlaceholder}>Buscar platos, tiendas o restaurantes</Text>
          <View style={styles.foodSearchFilter}>
            <Ionicons name="options-outline" size={18} color="#fff" />
          </View>
        </Pressable>
        <View style={styles.foodSectionHeader}>
          <Text style={styles.foodSectionTitle}>Todas las categorías</Text>
          <Text style={styles.foodSeeAll}>Ver todas ›</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.foodCategoryRail}
        >
          {categories.map((category) => (
            <Pressable
              key={category.name}
              onPress={() => onSelectCategory(category.name)}
              style={styles.foodCategoryItem}
              accessibilityState={{ selected: selectedCategory === category.name }}
            >
              <View
                style={[
                  styles.foodCategoryArt,
                  selectedCategory === category.name && styles.foodCategoryArtActive,
                ]}
              >
                {category.image ? (
                  <Image source={{ uri: category.image }} style={styles.foodCategoryImage} />
                ) : (
                  <Ionicons name="restaurant" size={24} color={flashDesign.color.food} />
                )}
              </View>
              <Text
                style={[
                  styles.foodCategoryName,
                  selectedCategory === category.name && styles.foodCategoryNameActive,
                ]}
                numberOfLines={2}
              >
                {category.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        {favoriteRestaurants.length > 0 ? (
          <>
            <View style={styles.foodSectionHeader}>
              <Text style={styles.foodSectionTitle}>Tus favoritos</Text>
              <Text style={styles.foodSeeAll}>{favoriteRestaurants.length} guardados</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.foodFavoriteRail}
            >
              {favoriteRestaurants.map((restaurant) => (
                <Pressable
                  key={restaurant.id}
                  style={styles.foodFavoriteCard}
                  onPress={() => onOpenRestaurant(restaurant.id)}
                >
                  <ImageBackground
                    source={{ uri: restaurant.cover }}
                    imageStyle={styles.foodFavoriteImageStyle}
                    style={styles.foodFavoriteImage}
                  >
                    <View style={styles.foodFavoriteEta}>
                      <Ionicons name="time-outline" size={13} color={flashDesign.color.ink} />
                      <Text style={styles.foodFavoriteEtaText}>{restaurant.etaMin} min</Text>
                    </View>
                  </ImageBackground>
                  <Text style={styles.foodFavoriteName} numberOfLines={1}>
                    {restaurant.name}
                  </Text>
                  <Text style={styles.foodFavoriteMeta} numberOfLines={1}>
                    {restaurant.cuisine}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : null}
        <View style={styles.foodSectionHeader}>
          <Text style={styles.foodSectionTitle}>
            {selectedCategory === "Todos" ? "Elegidos para vos" : selectedCategory}
          </Text>
          <Text style={styles.foodSeeAll}>{restaurants.length} abiertos</Text>
        </View>
        {restaurants.map((restaurant) => (
          <Pressable
            key={restaurant.id}
            onPress={() => onOpenRestaurant(restaurant.id)}
            style={styles.foodMerchantCard}
          >
            <ImageBackground
              source={{ uri: restaurant.cover }}
              imageStyle={styles.foodMerchantBannerImage}
              style={styles.foodCardBannerLarge}
            >
              <View style={styles.foodCardTopline}>
                <Text style={styles.foodCardPromo}>{restaurant.badge}</Text>
                <Pressable
                  disabled={favoritePendingId === restaurant.id}
                  style={styles.foodHeart}
                  accessibilityLabel={
                    favoriteRestaurantIds.includes(restaurant.id)
                      ? `Quitar ${restaurant.name} de favoritos`
                      : `Guardar ${restaurant.name} en favoritos`
                  }
                  accessibilityState={{
                    checked: favoriteRestaurantIds.includes(restaurant.id),
                    busy: favoritePendingId === restaurant.id,
                  }}
                  onPress={(event) => {
                    event.stopPropagation();
                    onToggleFavorite(restaurant.id);
                  }}
                >
                  <Ionicons
                    name={favoriteRestaurantIds.includes(restaurant.id) ? "heart" : "heart-outline"}
                    size={19}
                    color={
                      favoriteRestaurantIds.includes(restaurant.id)
                        ? flashDesign.color.food
                        : flashDesign.color.ink
                    }
                  />
                </Pressable>
              </View>
            </ImageBackground>
            <View style={styles.foodMerchantBody}>
              <View style={styles.foodMerchantTitleRow}>
                <View style={styles.itemCopy}>
                  <Text style={styles.foodMerchantName} numberOfLines={1}>
                    {restaurant.name}
                  </Text>
                  <Text style={styles.foodMerchantCuisine} numberOfLines={1}>
                    {restaurant.cuisine}
                  </Text>
                </View>
                <View style={styles.foodRatingPill}>
                  <Ionicons name="star" size={12} color="#E98A00" />
                  <Text style={styles.foodRatingText}>{restaurant.rating.toFixed(1)}</Text>
                </View>
              </View>
              <View style={styles.foodMetaRow}>
                <View style={styles.foodMetaItem}>
                  <Ionicons name="time-outline" size={15} color={flashDesign.color.inkSoft} />
                  <Text style={styles.foodMetaText}>{restaurant.etaMin} min</Text>
                </View>
                <View style={styles.foodMetaDot} />
                <View style={styles.foodMetaItem}>
                  <Ionicons name="bicycle-outline" size={15} color={flashDesign.color.inkSoft} />
                  <Text style={styles.foodMetaText}>
                    {restaurant.deliveryFee ? money.format(restaurant.deliveryFee) : "Envío gratis"}
                  </Text>
                </View>
                <View style={styles.foodMetaDot} />
                <Text style={styles.foodMetaText}>{restaurant.distanceKm.toFixed(1)} km</Text>
              </View>
            </View>
          </Pressable>
        ))}
        {restaurants.length === 0 ? (
          <View style={styles.foodEmpty}>
            <View style={styles.foodEmptyIcon}>
              <Ionicons name="restaurant-outline" size={30} color={flashDesign.color.food} />
            </View>
            <Text style={styles.foodEmptyTitle}>No hay opciones abiertas</Text>
            <Text style={styles.foodEmptyCopy}>
              Probá otra categoría o volvé a buscar cuando los comercios estén disponibles.
            </Text>
            <Pressable style={styles.foodEmptyAction} onPress={() => onSelectCategory("Todos")}>
              <Text style={styles.foodEmptyActionText}>Ver todas</Text>
            </Pressable>
          </View>
        ) : null}
      </>
    );
  }

  if (screen !== "search") return null;

  return (
    <>
      <View style={styles.foodPageHeader}>
        <Pressable onPress={onHome} style={styles.foodBack}>
          <Ionicons name="chevron-back" size={20} color="#222" />
        </Pressable>
        <View style={styles.foodPageHeaderCopy}>
          <Text style={styles.foodPageTitle}>Buscar</Text>
          <Text style={styles.foodPageSubtitle}>Catálogo y disponibilidad actual</Text>
        </View>
      </View>
      <View style={styles.foodSearchButton}>
        <Ionicons name="search" size={20} color={flashDesign.color.inkSoft} />
        <TextInput
          autoFocus
          value={query}
          onChangeText={onQueryChange}
          placeholder="¿Qué querés comer?"
          style={styles.foodSearchInput}
        />
        {query ? (
          <Pressable
            accessibilityLabel="Limpiar búsqueda"
            style={styles.foodSearchClear}
            onPress={() => onQueryChange("")}
          >
            <Ionicons name="close" size={17} color={flashDesign.color.inkSoft} />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.foodSectionHeader}>
        <Text style={styles.foodSectionTitle}>{query ? "Resultados" : "Explorá el catálogo"}</Text>
        {!catalogLoading && !catalogError ? (
          <Text style={styles.foodSeeAll}>
            {catalogResults.length}
            {catalogNextOffset !== null ? "+" : ""} opciones
          </Text>
        ) : null}
      </View>
      {!query ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.foodSearchCategoryRail}
        >
          {categories
            .filter((category) => category.name !== "Todos")
            .slice(0, 6)
            .map((category) => (
              <Pressable
                key={category.name}
                onPress={() => onQueryChange(category.name)}
                style={styles.foodSearchCategoryCard}
              >
                {category.image ? (
                  <Image source={{ uri: category.image }} style={styles.foodSearchCategoryImage} />
                ) : (
                  <View style={styles.foodSearchCategoryImageFallback}>
                    <Ionicons name="restaurant" size={20} color={flashDesign.color.food} />
                  </View>
                )}
                <Text style={styles.foodSearchCategoryName} numberOfLines={2}>
                  {category.name}
                </Text>
                <Text style={styles.foodSearchCategoryCount}>
                  {category.count} {category.count === 1 ? "lugar" : "lugares"}
                </Text>
              </Pressable>
            ))}
        </ScrollView>
      ) : null}
      {catalogLoading ? (
        <View style={styles.foodSearchSkeletonList}>
          {[0, 1, 2].map((index) => (
            <View key={index} style={styles.foodSearchSkeletonCard}>
              <View style={styles.foodSearchSkeletonImage} />
              <View style={styles.foodSearchSkeletonCopy}>
                <View style={styles.foodSearchSkeletonTitle} />
                <View style={styles.foodSearchSkeletonLine} />
                <View style={styles.foodSearchSkeletonShort} />
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {catalogError ? (
        <View style={styles.foodSearchState}>
          <View style={styles.foodSearchStateIcon}>
            <Ionicons name="cloud-offline-outline" size={25} color={flashDesign.color.danger} />
          </View>
          <Text style={styles.foodSearchStateTitle}>No pudimos buscar</Text>
          <Text style={styles.foodSearchStateCopy}>{catalogError}</Text>
          <Pressable style={styles.foodSearchRetry} onPress={onRetrySearch}>
            <Text style={styles.foodSearchRetryText}>Reintentar</Text>
          </Pressable>
        </View>
      ) : null}
      {!catalogLoading && !catalogError && !catalogResults.length && query.trim() ? (
        <View style={styles.foodSearchState}>
          <View style={styles.foodSearchStateIcon}>
            <Ionicons name="search-outline" size={26} color={flashDesign.color.food} />
          </View>
          <Text style={styles.foodSearchStateTitle}>Sin coincidencias</Text>
          <Text style={styles.foodSearchStateCopy}>
            Probá con otro plato, categoría o restaurante.
          </Text>
          <Pressable style={styles.foodSearchRetry} onPress={() => onQueryChange("")}>
            <Text style={styles.foodSearchRetryText}>Limpiar búsqueda</Text>
          </Pressable>
        </View>
      ) : null}
      {catalogResults.map((result) => (
        <Pressable
          key={result.restaurantId}
          onPress={() => onOpenRestaurant(result.restaurantId)}
          style={styles.foodSearchResultCard}
        >
          <ImageBackground
            source={{ uri: result.cover }}
            imageStyle={styles.foodCardBannerImage}
            style={styles.foodSearchResultImage}
          >
            <View style={styles.foodSearchResultEta}>
              <Ionicons name="time-outline" size={12} color={flashDesign.color.ink} />
              <Text style={styles.foodSearchResultEtaText}>{result.etaMin} min</Text>
            </View>
          </ImageBackground>
          <View style={styles.foodSearchResultBody}>
            <View style={styles.foodSearchResultHeading}>
              <Text style={styles.foodSearchResultName} numberOfLines={1}>
                {result.restaurantName}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={flashDesign.color.muted} />
            </View>
            <Text style={styles.foodSearchResultCuisine} numberOfLines={1}>
              {result.cuisine}
            </Text>
            <View style={styles.foodSearchResultMeta}>
              <Ionicons name="bicycle-outline" size={14} color={flashDesign.color.inkSoft} />
              <Text style={styles.foodSearchResultMetaText}>
                {result.deliveryFee ? money.format(result.deliveryFee) : "Envío gratis"}
              </Text>
              <View style={styles.foodMetaDot} />
              <Text style={styles.foodSearchResultMetaText}>
                {result.matchCount} {result.matchCount === 1 ? "coincidencia" : "coincidencias"}
              </Text>
            </View>
            {result.matchedItems.length ? (
              <Text style={styles.searchMatchText} numberOfLines={1}>
                {result.matchedItems.map((item) => item.name).join(" · ")}
              </Text>
            ) : null}
          </View>
        </Pressable>
      ))}
      {catalogNextOffset !== null && !catalogLoading ? (
        <Pressable style={styles.searchMoreButton} onPress={onLoadMore}>
          <Text style={styles.searchMoreText}>Ver más resultados</Text>
        </Pressable>
      ) : null}
    </>
  );
}
