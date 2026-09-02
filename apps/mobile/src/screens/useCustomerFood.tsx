// Sesión de Comidas (ARC-001).
//
// Uber Eats separa catálogo, carrito y checkout firmado del shell de cuenta.
// Flash deja esa máquina de estado aquí; el coordinador sólo navega verticales.
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";

import { track } from "../analytics";
import { api } from "../api";
import { money } from "../format";
import type { CatalogSearchResult } from "./CustomerFoodBrowseScreen";
import type {
  AppState,
  DietaryPreferences,
  FoodCheckoutQuote,
  MobileCartLine,
  GroupOrder as GroupOrderType,
  Order,
  Restaurant,
  User,
} from "../types";

type SharedView = "service" | "activity" | "account";
type RunAction = (action: () => Promise<unknown>, success: string) => void;

export function useCustomerFood({
  state,
  user,
  runAction,
  setSharedView,
}: {
  state: AppState;
  user: User;
  runAction: RunAction;
  setSharedView: (view: SharedView) => void;
}) {
  const [foodScreen, setFoodScreen] = useState<
    "home" | "search" | "restaurant" | "cart" | "checkout" | "orders"
  >("home");
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<string | null>(null);
  const previousFoodQuery = useRef("");
  const previousCartCount = useRef<number | null>(null);
  const [foodQuery, setFoodQuery] = useState("");
  const [catalogResults, setCatalogResults] = useState<CatalogSearchResult[]>([]),
    [catalogSearchLoading, setCatalogSearchLoading] = useState(false),
    [catalogSearchError, setCatalogSearchError] = useState(""),
    [catalogNextOffset, setCatalogNextOffset] = useState<number | null>(null);
  const [catalogSearchNonce, setCatalogSearchNonce] = useState(0);
  const [foodCategory, setFoodCategory] = useState("Todos");
  const [foodMenuCategory, setFoodMenuCategory] = useState("Todos");
  const [favoriteRestaurantIds, setFavoriteRestaurantIds] = useState<string[]>(
    state.favoriteRestaurantIds || [],
  );
  const [favoritePendingId, setFavoritePendingId] = useState<string | null>(null);
  useEffect(
    () => setFavoriteRestaurantIds(state.favoriteRestaurantIds || []),
    [state.favoriteRestaurantIds],
  );
  const foodCategories = useMemo(() => {
    const restaurants = state.restaurants.filter((restaurant) => restaurant.open);
    const byCuisine = new Map<string, { name: string; image: string; count: number }>();
    for (const restaurant of restaurants) {
      const name = restaurant.cuisine.trim() || "Otros";
      const current = byCuisine.get(name);
      byCuisine.set(name, {
        name,
        image: current?.image || restaurant.image || restaurant.cover,
        count: (current?.count || 0) + 1,
      });
    }
    return [
      {
        name: "Todos",
        image: restaurants[0]?.image || restaurants[0]?.cover || "",
        count: restaurants.length,
      },
      ...Array.from(byCuisine.values()).sort(
        (left, right) => right.count - left.count || left.name.localeCompare(right.name, "es"),
      ),
    ];
  }, [state.restaurants]);
  const activeFoodPromotion = useMemo(
    () =>
      state.promotions?.find((promotion) => promotion.active && promotion.service === "food") ||
      null,
    [state.promotions],
  );
  const foodPromotionValue = activeFoodPromotion
    ? activeFoodPromotion.kind === "free_delivery"
      ? "Envío bonificado"
      : activeFoodPromotion.kind === "fixed"
        ? `${money.format(activeFoodPromotion.value || 0)} menos`
        : activeFoodPromotion.kind === "wallet_credit"
          ? `${money.format(activeFoodPromotion.value || 0)} en Wallet`
          : `${activeFoodPromotion.discountPercent || activeFoodPromotion.value || 0}% menos`
    : "";
  const [dietaryPreferences, setDietaryPreferences] = useState<DietaryPreferences>({
    dietaryLabels: [],
    avoidedAllergens: [],
    hideIncompatible: false,
  });
  const itemMatchesDiet = (item: Restaurant["menu"][number]) => {
    const itemDiets = new Set((item.dietaryLabels || []).map((entry) => entry.code)),
      itemAllergens = new Set((item.allergens || []).map((entry) => entry.code));
    return (
      dietaryPreferences.dietaryLabels.every((entry) => itemDiets.has(entry.code)) &&
      !dietaryPreferences.avoidedAllergens.some((entry) => itemAllergens.has(entry.code))
    );
  };
  const openRestaurants = state.restaurants.filter(
    (restaurant) =>
      restaurant.open &&
      (foodCategory === "Todos" ||
        restaurant.cuisine.toLowerCase().includes(foodCategory.toLowerCase())) &&
      (!dietaryPreferences.hideIncompatible ||
        restaurant.menu.some((item) => item.stock && itemMatchesDiet(item))) &&
      (!foodQuery.trim() ||
        `${restaurant.name} ${restaurant.cuisine} ${restaurant.menu.map((item) => item.name).join(" ")}`
          .toLowerCase()
          .includes(foodQuery.trim().toLowerCase())),
  );
  const favoriteRestaurants = openRestaurants.filter((restaurant) =>
    favoriteRestaurantIds.includes(restaurant.id),
  );
  const [cart, setCart] = useState<MobileCartLine[]>([]);
  const [lastCreatedOrder, setLastCreatedOrder] = useState<Order | null>(null);
  const [cartHydrated, setCartHydrated] = useState(false);
  const toggleFavorite = async (restaurantId: string) => {
    if (favoritePendingId) return;
    const favorite = !favoriteRestaurantIds.includes(restaurantId);
    setFavoritePendingId(restaurantId);
    try {
      const result = await api.setFavorite(restaurantId, favorite);
      setFavoriteRestaurantIds(result.restaurantIds);
    } catch (error) {
      Alert.alert(
        "No pudimos actualizar favoritos",
        error instanceof Error ? error.message : "Intentá nuevamente.",
      );
    } finally {
      setFavoritePendingId(null);
    }
  };
  useEffect(() => {
    let cancelled = false;
    setCartHydrated(false);
    void api
      .cart()
      .then((result) => {
        if (cancelled) return;
        setCart(
          result.cart.map((line) => ({
            lineId: `${line.item.id}:${line.extras.slice().sort().join(",")}:${line.note}`,
            restaurantId: line.restaurantId,
            menuItemId: line.item.id,
            name: line.item.name,
            unitPrice: line.item.price,
            quantity: line.quantity,
            extras: line.extras,
            note: line.note,
          })),
        );
        setCartHydrated(true);
      })
      .catch(() => {
        if (!cancelled) setCartHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user.id]);
  useEffect(() => {
    if (!cartHydrated) return;
    const timer = setTimeout(() => {
      void api
        .saveMobileCart(
          cart[0]?.restaurantId,
          cart.map((line) => ({
            menuItemId: line.menuItemId,
            quantity: line.quantity,
            extras: line.extras,
            note: line.note,
          })),
        )
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [cart, cartHydrated]);
  useEffect(() => {
    const trimmedQuery = foodQuery.trim();
    if (trimmedQuery && !previousFoodQuery.current.trim()) {
      track("search_started", "customer_app", { service: "food" });
    }
    previousFoodQuery.current = foodQuery;
  }, [foodQuery]);
  useEffect(() => {
    if (selectedRestaurantId) {
      track("merchant_viewed", "customer_app", { merchant_id: selectedRestaurantId });
    }
  }, [selectedRestaurantId]);
  useEffect(() => {
    if (!cartHydrated) return;
    const itemCount = cart.reduce((total, line) => total + line.quantity, 0);
    if (previousCartCount.current !== null && previousCartCount.current !== itemCount) {
      track("cart_updated", "customer_app", { item_count: itemCount });
    }
    previousCartCount.current = itemCount;
  }, [cart, cartHydrated]);
  useEffect(() => {
    if (foodScreen === "checkout") track("checkout_started", "customer_app", { service: "food" });
  }, [foodScreen]);
  const [deliveryAddress, setDeliveryAddress] = useState(user.defaultAddress || "");
  const [foodPromotionCode, setFoodPromotionCode] = useState("");
  const [foodCheckoutQuote, setFoodCheckoutQuote] = useState<FoodCheckoutQuote | null>(null);
  // Propina del checkout (GTM-001). En centavos, como viaja a la API.
  const [foodTipCents, setFoodTipCents] = useState(0);
  // Reserva de horario (GTM-001). `null` es «lo antes posible».
  const [foodScheduledFor, setFoodScheduledFor] = useState<string | null>(null);
  // Grupo que se está por confirmar (GTM-001).
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);
  const [selectedFoodPaymentId, setSelectedFoodPaymentId] = useState(
    () =>
      state.paymentMethods.find((method) => method.userId === user.id && method.isDefault)?.id ||
      state.paymentMethods.find((method) => method.userId === user.id)?.id ||
      "",
  );
  useEffect(() => {
    let cancelled = false;
    api
      .getDietaryPreferences()
      .then((result) => {
        if (!cancelled) setDietaryPreferences(result.preferences);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user.id]);
  useEffect(() => {
    if (foodScreen !== "search") return;
    let cancelled = false;
    setCatalogSearchLoading(true);
    setCatalogSearchError("");
    const timer = setTimeout(() => {
      void api
        .searchCatalog(foodQuery, 0)
        .then((result) => {
          if (!cancelled) {
            setCatalogResults(result.results);
            setCatalogNextOffset(result.nextOffset);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setCatalogResults([]);
            setCatalogSearchError(error instanceof Error ? error.message : "No se pudo buscar");
          }
        })
        .finally(() => {
          if (!cancelled) setCatalogSearchLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    foodScreen,
    foodQuery,
    catalogSearchNonce,
    dietaryPreferences.hideIncompatible,
    dietaryPreferences.dietaryLabels,
    dietaryPreferences.avoidedAllergens,
  ]);
  const addItem = (
    restaurant: Restaurant,
    item: Restaurant["menu"][number],
    extras: string[] = [],
    note = "",
  ) => {
    if (!item.stock || !restaurant.open) return;
    if (cart.length > 0 && cart[0].restaurantId !== restaurant.id) {
      Alert.alert(
        "Carrito de un comercio",
        "Finaliza o vacia el carrito antes de pedir en otro local.",
      );
      return;
    }
    const lineId = `${item.id}:${extras.slice().sort().join(",")}:${note.trim()}`,
      modifierPrice = (item.modifierGroups || [])
        .flatMap((group) => group.modifiers)
        .filter((modifier) => extras.includes(modifier.id))
        .reduce((sum, modifier) => sum + modifier.price, 0);
    setCart((current) => {
      const existing = current.find((line) => line.lineId === lineId);
      if (existing) {
        return current.map((line) =>
          line.lineId === lineId ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [
        ...current,
        {
          lineId,
          restaurantId: restaurant.id,
          menuItemId: item.id,
          name: item.name,
          unitPrice: item.price + modifierPrice,
          quantity: 1,
          extras,
          note: note.trim(),
        },
      ];
    });
  };

  const cartTotal = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const cartRestaurant = state.restaurants.find(
    (restaurant) => restaurant.id === cart[0]?.restaurantId,
  );
  const customerPaymentMethods = state.paymentMethods.filter((method) => method.userId === user.id);
  const selectedFoodPayment =
    customerPaymentMethods.find((method) => method.id === selectedFoodPaymentId) ||
    customerPaymentMethods.find((method) => method.isDefault) ||
    customerPaymentMethods[0];
  const selectedRestaurant =
    state.restaurants.find((restaurant) => restaurant.id === selectedRestaurantId) || null;
  const foodMenuCategories = useMemo(
    () => [
      "Todos",
      ...Array.from(
        new Set((selectedRestaurant?.menu || []).map((item) => item.category?.trim() || "Otros")),
      ),
    ],
    [selectedRestaurant],
  );
  useEffect(() => setFoodMenuCategory("Todos"), [selectedRestaurantId]);
  const visibleFoodMenuItems = (selectedRestaurant?.menu || []).filter(
    (item) =>
      (foodMenuCategory === "Todos" || (item.category?.trim() || "Otros") === foodMenuCategory) &&
      (!dietaryPreferences.hideIncompatible || itemMatchesDiet(item)),
  );
  const changeCartQuantity = (lineId: string, delta: number) => {
    setCart((current) =>
      current
        .map((line) =>
          line.lineId === lineId ? { ...line, quantity: line.quantity + delta } : line,
        )
        .filter((line) => line.quantity > 0),
    );
  };
  const selectedFoodAddress = state.addresses.find(
    (item) =>
      item.userId === user.id &&
      !item.id.startsWith("profile-") &&
      item.address === deliveryAddress.trim() &&
      item.lat !== null &&
      item.lng !== null,
  );
  const foodCheckoutItems = cart.map((line) => ({
    menuItemId: line.menuItemId,
    quantity: line.quantity,
    extras: line.extras,
    note: line.note,
  }));

  const openFoodCheckout = () => {
    if (!cart.length || !cartRestaurant || !selectedFoodAddress || !selectedFoodPayment) {
      Alert.alert(
        "Checkout incompleto",
        "Seleccioná una dirección geocodificada y un método de pago.",
      );
      return;
    }
    runAction(async () => {
      const result = await api.quoteFoodCheckout({
        customerId: user.id,
        restaurantId: cartRestaurant.id,
        deliveryAddressId: selectedFoodAddress.id,
        branchId: cartRestaurant.branches?.find((branch) => branch.isPrimary)?.id,
        paymentMethod: selectedFoodPayment.label,
        paymentMethodId: selectedFoodPayment.id,
        promotionCode: foodPromotionCode.trim().toUpperCase() || undefined,
        items: foodCheckoutItems,
      });
      setFoodCheckoutQuote(result.quote);
      setFoodScreen("checkout");
    }, "Precio final actualizado");
  };

  /**
   * Lleva un grupo cerrado al checkout de siempre.
   *
   * Se vuelcan sus ítems en el carrito y se abre el checkout normal, en vez de
   * tener un camino propio: un segundo checkout serían dos versiones de la
   * cotización firmada, la propina, el horario y el riesgo.
   */
  const checkoutGroupOrder = (group: GroupOrderType) =>
    runAction(async () => {
      const checkout = await api.getGroupOrderCheckout(group.id);
      const restaurante = state.restaurants.find((entry) => entry.id === checkout.merchantPublicId);
      if (!restaurante) throw new Error("El restaurante del grupo ya no está disponible");
      const lineas: MobileCartLine[] = checkout.items.map((entrada, indice) => {
        const item = restaurante.menu.find((plato) => plato.id === entrada.menuItemId);
        if (!item) throw new Error("Un producto del grupo ya no está disponible");
        return {
          lineId: `${group.id}-${indice}`,
          restaurantId: restaurante.id,
          menuItemId: item.id,
          name: item.name,
          unitPrice: item.price,
          quantity: entrada.quantity,
          extras: entrada.extras,
          note: entrada.note,
        };
      });
      setCart(lineas);
      // Se recuerda para atarlo al pedido **después** de que el pedido exista:
      // marcarlo antes dejaría grupos «confirmados» apuntando a pedidos que
      // nunca se crearon.
      setPendingGroupId(group.id);
      setSharedView("service");
      setFoodScreen("checkout");
    }, "Revisá el pedido del grupo y confirmá");

  const createOrder = () => {
    const selectedDeliveryAddress = state.addresses.find(
      (item) =>
        item.userId === user.id &&
        !item.id.startsWith("profile-") &&
        item.address === deliveryAddress.trim() &&
        item.lat !== null &&
        item.lng !== null,
    );
    if (
      !cart.length ||
      !cartRestaurant ||
      !deliveryAddress.trim() ||
      !selectedDeliveryAddress ||
      !selectedFoodPayment ||
      !foodCheckoutQuote
    ) {
      Alert.alert(
        "Pedido incompleto",
        "Selecciona productos y una dirección guardada con coordenadas reales.",
      );
      return;
    }
    runAction(async () => {
      const result = await api.createOrder({
        customerId: user.id,
        restaurantId: cartRestaurant.id,
        deliveryAddressId: selectedDeliveryAddress.id,
        deliveryAddress: deliveryAddress.trim(),
        paymentMethod: selectedFoodPayment.label,
        paymentMethodId: selectedFoodPayment.id,
        promotionCode: foodCheckoutQuote.promotionCode || undefined,
        quoteToken: foodCheckoutQuote.quoteToken,
        tipCents: foodTipCents,
        scheduledFor: foodScheduledFor ?? undefined,
        items: foodCheckoutItems,
      });
      // El grupo se marca con el pedido ya creado. Si esto fallara, el pedido
      // igual existe y el grupo queda cerrado sin atar — el lado seguro de
      // fallar: se cobró una vez y hay un pedido real detrás.
      if (pendingGroupId) {
        await api.markGroupOrderPlaced(pendingGroupId, result.order.id);
        setPendingGroupId(null);
      }
      setLastCreatedOrder(result.order);
      setCart([]);
      setFoodCheckoutQuote(null);
      setFoodPromotionCode("");
      // Sin esto la próxima compra arrancaría con la propina de la anterior ya
      // elegida, que es cobrar sin preguntar; y con el horario de la anterior,
      // que es reservar sin preguntar.
      setFoodTipCents(0);
      setFoodScheduledFor(null);
      setFoodScreen("orders");
      track("job_created", "customer_app", { service: "food" });
    }, "Pedido enviado al comercio");
  };
  const loadMoreCatalog = () => {
    if (catalogNextOffset === null) return;
    setCatalogSearchLoading(true);
    void api
      .searchCatalog(foodQuery, catalogNextOffset)
      .then((result) => {
        setCatalogResults((current) => [...current, ...result.results]);
        setCatalogNextOffset(result.nextOffset);
      })
      .catch((error) =>
        setCatalogSearchError(error instanceof Error ? error.message : "No se pudo continuar"),
      )
      .finally(() => setCatalogSearchLoading(false));
  };

  return {
    foodScreen,
    setFoodScreen,
    selectedRestaurantId,
    setSelectedRestaurantId,
    foodQuery,
    setFoodQuery,
    catalogResults,
    catalogSearchLoading,
    catalogSearchError,
    catalogNextOffset,
    catalogSearchNonce,
    setCatalogSearchNonce,
    foodCategory,
    setFoodCategory,
    foodMenuCategory,
    setFoodMenuCategory,
    favoriteRestaurantIds,
    favoritePendingId,
    foodCategories,
    activeFoodPromotion,
    foodPromotionValue,
    dietaryPreferences,
    setDietaryPreferences,
    openRestaurants,
    favoriteRestaurants,
    cart,
    lastCreatedOrder,
    setLastCreatedOrder,
    toggleFavorite,
    deliveryAddress,
    setDeliveryAddress,
    foodPromotionCode,
    setFoodPromotionCode,
    foodCheckoutQuote,
    setFoodCheckoutQuote,
    foodTipCents,
    setFoodTipCents,
    foodScheduledFor,
    setFoodScheduledFor,
    selectedFoodPaymentId,
    setSelectedFoodPaymentId,
    setCart,
    setCartHydrated,
    addItem,
    cartTotal,
    cartRestaurant,
    customerPaymentMethods,
    selectedFoodPayment,
    selectedRestaurant,
    foodMenuCategories,
    visibleFoodMenuItems,
    changeCartQuantity,
    selectedFoodAddress,
    openFoodCheckout,
    checkoutGroupOrder,
    createOrder,
    loadMoreCatalog,
  };
}
