import fs from "node:fs";

const app = fs.readFileSync("apps/mobile/App.tsx", "utf8");
const api = fs.readFileSync("apps/mobile/src/api.ts", "utf8");
const types = fs.readFileSync("apps/mobile/src/types.ts", "utf8");
const design = fs.readFileSync("apps/mobile/src/design-system.ts", "utf8");
const roadmap = fs.readFileSync("docs/DESIGN_ROADMAP.md", "utf8");

const assert = (value, message) => {
  if (!value) throw new Error(message);
};

assert(design.includes('brand: "#7C3CFF"') && design.includes('food: "#FF6A21"'), "mobile design tokens must preserve the Flash brand and food accent");
assert(app.includes('from "./src/design-system"') && app.includes("foodPromoBanner") && app.includes("foodMerchantCard"), "food home must consume the shared visual system");
assert(app.includes("const foodCategories=useMemo") && !app.includes("images.unsplash.com"), "food categories must be derived from the live catalog without decorative remote fixtures");
assert(app.includes("activeFoodPromotion") && api.includes('request<{promotions:import("./types").Promotion[]}>("/promotions")'), "promotion banner must consume the promotions contract");
assert(!app.includes("Hurry Offers!") && !app.includes("#FLASH25"), "legacy promotional demo content must stay removed");
assert(app.includes("toggleFavorite") && api.includes("/favorites/${restaurantId}") && types.includes("favoriteRestaurantIds?: string[]"), "favorite controls must persist through the authenticated API");
assert(app.includes("aspectRatio: 16/9"), "merchant media must preserve a stable 16:9 ratio");
assert(roadmap.includes("Foodu") && roadmap.includes("Definición de terminado visual"), "the visual implementation must remain governed by the design roadmap");

console.log("ok - Customer Comidas usa sistema visual y datos reales");
