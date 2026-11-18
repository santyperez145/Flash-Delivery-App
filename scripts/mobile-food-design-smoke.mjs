import fs from "node:fs";
import { contains, readMobileSource } from "./source-contract.mjs";

// La fuente se lee por audiencia y no por archivo (ARC-001 paso 8): la mitad del
// trabajo que queda del ticket es partir `App.tsx`, y un contrato con la ruta
// fija se rompe —o se vacía— en cuanto un componente cambia de archivo.
const { source: app } = await readMobileSource();
const customerCoordinator = fs.readFileSync("apps/mobile/src/screens/CustomerScreen.tsx", "utf8");
const foodCheckout = fs.readFileSync(
  "apps/mobile/src/screens/CustomerFoodCheckoutScreen.tsx",
  "utf8",
);
const foodRestaurant = fs.readFileSync(
  "apps/mobile/src/screens/CustomerFoodRestaurantScreen.tsx",
  "utf8",
);
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
  contains(foodCheckout, "foodCheckoutHero") &&
    contains(foodCheckout, "quote.expiresAt") &&
    contains(foodCheckout, "quote.pricingVersion"),
  "checkout must present signed quote expiry and pricing provenance",
);
assert(
  contains(foodCheckout, "servidor vuelve a validar stock") &&
    contains(foodCheckout, "quote.total + propina / 100"),
  "checkout must disclose server revalidation and use the authoritative total",
);
assert(
  contains(foodRestaurant, "modifierTotal") &&
    contains(foodRestaurant, "customizingSelectionValid") &&
    contains(foodRestaurant, "productCustomizerActionPrice"),
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
  [
    "CustomerFoodBrowseScreen",
    "CustomerFoodRestaurantScreen",
    "CustomerFoodCartScreen",
    "CustomerFoodCheckoutScreen",
    "CustomerFoodOrdersScreen",
  ].every((component) => contains(customerCoordinator, `<${component}`)),
  "food discovery, restaurant, cart, checkout and orders must stay outside the shrinking coordinator",
);
assert(
  contains(roadmap, "Foodu") && contains(roadmap, "Definición de terminado visual"),
  "the visual implementation must remain governed by the design roadmap",
);

console.log("ok - Customer Comidas usa sistema visual y datos reales");

// ---------------------------------------------------------------------------
// Propina en el checkout (GTM-001): los topes del cliente son los del servidor.
//
// El cliente duplica el piso y el techo para no ofrecer un monto que el
// confirmar va a rechazar. **Esa copia es el riesgo**: el dia que el servidor
// cambie el techo y el cliente no, la pantalla ofrece un boton que devuelve 409,
// y quien lo toca no entiende por que su propina «no anda».
//
// Los numeros se leen del servidor en vez de escribirse aca, para que este
// contrato no pueda quedar viejo junto con el codigo que vigila.
const propinaServidor = fs.readFileSync("server/tip-repository.js", "utf8");
const pisoServidor = propinaServidor.match(/CHECKOUT_TIP_MIN_CENTS = (\d+)/)?.[1];
const techoServidor = propinaServidor.match(/Math\.min\((\d+),/)?.[1];
const proporcionServidor = propinaServidor.match(/orderTotalCents \* ([\d.]+)/)?.[1];
if (!pisoServidor || !techoServidor || !proporcionServidor)
  throw new Error("No se pudieron leer los topes de propina del servidor");

const propinaMovil = fs.readFileSync("apps/mobile/src/TipSelector.tsx", "utf8");
assert(
  contains(propinaMovil, `const MIN_CENTS = ${pisoServidor}`) &&
    contains(propinaMovil, `Math.min(${techoServidor}, Math.max(MIN_CENTS`) &&
    contains(propinaMovil, `* ${proporcionServidor})`),
  "los topes de propina del checkout movil son los mismos que aplica el servidor",
);
assert(
  contains(propinaMovil, "Sin propina") && contains(propinaMovil, "subtotal * 100 *"),
  "el movil ofrece no dejar propina y calcula los porcentajes sobre el subtotal",
);
assert(
  contains(propinaMovil, "minHeight: 44") ||
    contains(fs.readFileSync("apps/mobile/src/styles.ts", "utf8"), "minHeight: 44"),
  "las opciones de propina son objetivos tactiles de 44px",
);
assert(contains(api, "tipCents?: number"), "la propina viaja a la API movil en centavos");

// **Los topes de reserva del cliente son los del servidor.** Mismo riesgo que
// con la propina: los dos clientes duplican la ventana para no ofrecer un
// horario que el confirmar va a rechazar, y esa copia es lo que se desincroniza.
// Los numeros se leen del servidor en vez de escribirse aca, para que este
// contrato no pueda quedar viejo junto con el codigo que vigila.
const reglaServidor = fs.readFileSync("server/scheduling.js", "utf8");
const minimoServidor = reglaServidor.match(/MINUTOS_MINIMOS_DE_ANTICIPACION = (\d+)/)?.[1];
const horizonteServidor = reglaServidor.match(/DIAS_MAXIMOS_DE_HORIZONTE = (\d+)/)?.[1];
if (!minimoServidor || !horizonteServidor)
  throw new Error("No se pudieron leer los topes de reserva del servidor");
const programador = fs.readFileSync("apps/mobile/src/SchedulePicker.tsx", "utf8");
assert(
  contains(programador, `MINUTOS_MINIMOS = ${minimoServidor}`) &&
    contains(programador, `DIAS_MAXIMOS = ${horizonteServidor}`),
  "los topes de reserva del checkout movil son los mismos que aplica el servidor",
);
assert(
  contains(app, "api.rescheduleJob") && contains(app, "SchedulePicker"),
  "el checkout movil reserva horario y la lista de pedidos permite moverlo",
);

// ---------------------------------------------------------------------------
// Retiro en el local desde la app (P-11). El servidor y la web lo ofrecían desde
// GTM-002; la app móvil, que es la superficie principal del cliente, no.
{
  const leerMovil = (archivo) => fs.readFileSync(`apps/mobile/src/${archivo}`, "utf8");
  const coordinador = await leerMovil("screens/CustomerScreen.tsx");
  const carrito = await leerMovil("screens/CustomerFoodCartScreen.tsx");
  const checkout = await leerMovil("screens/CustomerFoodCheckoutScreen.tsx");
  const pedidos = await leerMovil("screens/CustomerFoodOrdersScreen.tsx");
  const selector = await leerMovil("FulfillmentToggle.tsx");
  assert(
    contains(carrito, "{pickupAddress ? ( <FulfillmentToggle") &&
      // Y sólo en una sucursal que hoy puede atender: el servidor no cotiza una
      // pausada ni fuera de horario, y la app no ofrece elegir otra.
      contains(selector, 'branch.pickupEnabled && branch.status === "active" && branch.open'),
    "the cart offers pickup only at a branch that enabled it and can serve now",
  );
  assert(
    contains(coordinador, 'fulfillment: esRetiro ? "pickup" : "delivery",') &&
      contains(coordinador, "deliveryAddressId: esRetiro ? undefined : selectedFoodAddress?.id,"),
    "pickup quotes without a customer address",
  );
  // El modo del pedido sale de la cotización firmada, no del botón: el servidor
  // compara los dos y rechaza el que no coincida.
  assert(
    contains(coordinador, 'const retiro = foodCheckoutQuote?.fulfillment === "pickup";') &&
      contains(coordinador, "fulfillment: foodCheckoutQuote.fulfillment,") &&
      contains(coordinador, "tipCents: retiro ? 0 : foodTipCents,"),
    "the order takes its mode from the signed quote and sends no tip on pickup",
  );
  assert(
    contains(checkout, '{quote.fulfillment !== "pickup" && ( <TipSelector') &&
      contains(
        pedidos,
        '{order.fulfillment !== "pickup" && ( <Pressable style={styles.foodActiveOrderPrimary}',
      ),
    "pickup hides the courier tip and the courier tracking",
  );
  // Una propina elegida antes de pasar a retiro no se suma al total que se muestra:
  // el pedido la manda en cero, y lo mostrado es lo que se cobra.
  assert(
    contains(checkout, 'const propina = quote.fulfillment === "pickup" ? 0 : tipCents;') &&
      contains(checkout, "`Confirmar · ${money.format(quote.total + propina / 100)}`") &&
      !contains(checkout, "quote.total + tipCents"),
    "the pickup total shown matches the charge, without a previously chosen tip",
  );
  // El seguimiento de un retiro no muestra repartidor ni mapa, venga de donde venga.
  const seguimiento = await leerMovil("screens/CustomerTrackingSheets.tsx");
  assert(
    contains(seguimiento, 'const retiro = order.fulfillment === "pickup";') &&
      contains(
        seguimiento,
        'resourceId: order?.fulfillment === "pickup" ? undefined : order?.id,',
      ) &&
      contains(seguimiento, "{retiro ? ( <Text style={styles.cardText}> Retirás en"),
    "pickup tracking shows courier stages or a map",
  );
  console.log("ok - la app móvil ofrece retiro en el local de punta a punta");
}
