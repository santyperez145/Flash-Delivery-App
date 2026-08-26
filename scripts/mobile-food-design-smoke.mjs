import fs from "node:fs";
import { contains, readMobileSource } from "./source-contract.mjs";

// La fuente se lee por audiencia y no por archivo (ARC-001 paso 8): la mitad del
// trabajo que queda del ticket es partir `App.tsx`, y un contrato con la ruta
// fija se rompe —o se vacía— en cuanto un componente cambia de archivo.
const { source: app } = await readMobileSource();
const api = fs.readFileSync("apps/mobile/src/api.ts", "utf8");
const types = fs.readFileSync("apps/mobile/src/types.ts", "utf8");
const design = fs.readFileSync("apps/mobile/src/design-system.ts", "utf8");
const roadmap = fs.readFileSync("docs/DESIGN_ROADMAP.md", "utf8");

const assert = (value, message) => {
  if (!value) throw new Error(message);
};

assert(
  contains(design, 'brand: "#7C3CFF"') && contains(design, 'food: "#FF6A21"'),
  "mobile design tokens must preserve the Flash brand and food accent",
);
assert(
  contains(app, 'from "./src/design-system"') &&
    contains(app, "foodPromoBanner") &&
    contains(app, "foodMerchantCard"),
  "food home must consume the shared visual system",
);
assert(
  contains(app, "const foodCategories=useMemo") && !contains(app, "images.unsplash.com"),
  "food categories must be derived from the live catalog without decorative remote fixtures",
);
assert(
  contains(app, "activeFoodPromotion") &&
    contains(api, 'request<{promotions:import("./types").Promotion[]}>("/promotions")'),
  "promotion banner must consume the promotions contract",
);
assert(
  !contains(app, "Hurry Offers!") && !contains(app, "#FLASH25"),
  "legacy promotional demo content must stay removed",
);
assert(
  contains(app, "toggleFavorite") &&
    contains(api, "/favorites/${restaurantId}") &&
    contains(types, "favoriteRestaurantIds?: string[]"),
  "favorite controls must persist through the authenticated API",
);
assert(contains(app, "aspectRatio: 16/9"), "merchant media must preserve a stable 16:9 ratio");
assert(
  contains(app, "foodSearchCategoryRail") &&
    contains(app, "foodSearchResultCard") &&
    contains(app, "catalogSearchNonce"),
  "search must expose responsive catalog discovery and a real retry state",
);
assert(
  contains(app, "foodMenuCategories=useMemo") &&
    contains(app, "visibleFoodMenuItems") &&
    !contains(app, "Preparado al momento con ingredientes seleccionados."),
  "restaurant menu tabs and descriptions must come from catalog data",
);
assert(
  !contains(app, "<Text style={styles.foodMenuTabActive}>Popular</Text>") &&
    contains(app, "foodProductUnavailable"),
  "restaurant must not present decorative menu tabs and must surface real stock",
);
assert(
  contains(app, "foodCartMerchant") &&
    contains(app, "foodCartOptionSelected") &&
    contains(app, "selectedFoodAddress"),
  "cart must compose products, geocoded address and payment from real account state",
);
assert(
  contains(app, "foodCheckoutHero") &&
    contains(app, "foodCheckoutQuote.expiresAt") &&
    contains(app, "foodCheckoutQuote.pricingVersion"),
  "checkout must present signed quote expiry and pricing provenance",
);
assert(
  contains(app, "servidor vuelve a validar stock") && contains(app, "foodCheckoutQuote.total"),
  "checkout must disclose server revalidation and use the authoritative total",
);
assert(
  contains(app, "customizingModifierTotal") &&
    contains(app, "customizingSelectionValid") &&
    contains(app, "productCustomizerActionPrice"),
  "product customization must enforce modifier limits and calculate the displayed total from catalog prices",
);
assert(
  contains(app, "Información de alérgenos") &&
    contains(app, "modifierRowBlocked") &&
    contains(app, "customizingNote.length"),
  "customization must surface allergens, max selections and note length honestly",
);
assert(
  contains(app, "mobileOrderStatusLabel[order.status]") && contains(app, "foodActiveOrderCard"),
  "order activity must translate backend status into an actionable customer card",
);
assert(
  contains(roadmap, "Foodu") && contains(roadmap, "Definición de terminado visual"),
  "the visual implementation must remain governed by the design roadmap",
);

console.log("ok - Customer Comidas usa sistema visual y datos reales");
