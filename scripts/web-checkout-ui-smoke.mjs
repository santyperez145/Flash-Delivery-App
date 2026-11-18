import fs from "node:fs/promises";
import { contains, containsAll, containsNone, readWebSource, section } from "./source-contract.mjs";

// La fuente se lee por audiencia y no por archivo (ARC-001 paso 8): la mitad del
// trabajo que queda del ticket es partir `App.tsx`, y un contrato con la ruta
// fija se rompe —o se vacía— en cuanto un componente cambia de archivo.
const { source: app } = await readWebSource();
const api = await fs.readFile("src/api.ts", "utf8");
const coordinator = await fs.readFile("src/customer/CustomerSurface.tsx", "utf8");
const foodCart = await fs.readFile("src/customer/FoodCartScreen.tsx", "utf8");
const fulfillmentPicker = await fs.readFile("src/customer/FoodFulfillmentPicker.tsx", "utf8");
const cardPayment = await fs.readFile("src/customer/FoodCardPayment.tsx", "utf8");
const quantityCounter = await fs.readFile("src/customer/QuantityCounter.tsx", "utf8");
const emptyState = await fs.readFile("src/customer/EmptyState.tsx", "utf8");
const foodCatalog = await fs.readFile("src/customer/FoodCatalogComponents.tsx", "utf8");
const foodRestaurant = await fs.readFile("src/customer/FoodRestaurantScreen.tsx", "utf8");
const foodItemSheet = await fs.readFile("src/customer/FoodItemSheet.tsx", "utf8");
const foodDiscovery = await fs.readFile("src/customer/FoodDiscoveryHome.tsx", "utf8");
// El recorte se hace sobre el archivo del carrito y no sobre la web entera: el
// marcador de cierre anterior se mudó a FoodCardPayment.tsx, que ordena antes,
// y la región dejaba de terminar en el checkout. Lo que el checkout delega
// (destino y tarjeta) se afirma sobre su propio archivo.
// El resumen de totales salió a FoodCheckoutSummary.tsx: la región va hasta el
// final del archivo, que ahora termina en el carrito.
const checkout = section(foodCart, "function CartScreen(");
if (!checkout) throw new Error("No se encontró el checkout web");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`ok - ${message}`);
};

// El techo del carrito baja de 690 a 625: el modo de entrega y el formulario de
// tarjeta salieron a sus propios archivos, y un techo que no acompaña al
// refactor deja espacio libre para que el monolito vuelva a crecer.
assert(
  coordinator.trimEnd().split(/\r?\n/).length <= 375 &&
    // 625 → 585 (P-02): el resumen de totales salió a FoodCheckoutSummary.tsx.
    foodCart.trimEnd().split(/\r?\n/).length <= 585 &&
    fulfillmentPicker.trimEnd().split(/\r?\n/).length <= 175 &&
    cardPayment.trimEnd().split(/\r?\n/).length <= 115 &&
    quantityCounter.trimEnd().split(/\r?\n/).length <= 35 &&
    emptyState.trimEnd().split(/\r?\n/).length <= 25 &&
    contains(coordinator, "<CartScreen") &&
    !contains(coordinator, "function CartScreen") &&
    !contains(foodCart, "function MercadoPagoCardCheckout") &&
    contains(foodCart, "<MercadoPagoCardCheckout") &&
    contains(foodCart, "<FoodFulfillmentPicker"),
  "carrito, checkout, pago y primitivas conservan límites propios",
);

assert(
  foodCatalog.trimEnd().split(/\r?\n/).length <= 155 &&
    foodRestaurant.trimEnd().split(/\r?\n/).length <= 95 &&
    foodItemSheet.trimEnd().split(/\r?\n/).length <= 110 &&
    contains(coordinator, "<RestaurantDetail") &&
    !contains(coordinator, "function RestaurantDetail") &&
    !contains(coordinator, "function ItemSheet") &&
    containsAll(foodRestaurant, ["itemMatchesDietary", "<CategoryRail", "<FoodRow"]) &&
    containsAll(foodItemSheet, ["<QuantityCounter", "restaurant.extras.map", "setNote"]),
  "restaurante, catálogo y personalización conservan límites propios",
);

assert(
  foodDiscovery.trimEnd().split(/\r?\n/).length <= 130 &&
    contains(coordinator, "<FoodDiscoveryHome") &&
    !contains(coordinator, "function FoodDiscoveryHome") &&
    containsAll(foodDiscovery, [
      'state.promotions.filter((p) => p.active && p.service === "food")',
      "<RestaurantCard",
      "<FoodRow",
    ]) &&
    containsNone(foodDiscovery, ["Hot deal", "backend activo", "Mas pedidos"]) &&
    containsNone(foodDiscovery, ["images.unsplash.com"]),
  "home y descubrimiento usan catálogo real y conservan un límite propio",
);

assert(
  containsNone(checkout, ["Defensa 982", "Dirección pendiente"]) &&
    containsNone(fulfillmentPicker, ["Defensa 982", "Dirección pendiente"]),
  "checkout web no representa una dirección hardcodeada",
);
assert(
  containsAll(fulfillmentPicker, ['aria-label="Dirección de entrega"', "geocodedAddresses.map"]) &&
    contains(checkout, "addresses={geocodedAddresses}"),
  "checkout elige una dirección geocodificada de la cuenta",
);
assert(
  containsAll(checkout, ["api.quoteFoodCheckout", "quoteToken: checkoutQuote.quoteToken"]),
  "checkout muestra y confirma la misma cotización firmada",
);
assert(
  containsAll(checkout, ["quoteExpired", "pricingVersion"]),
  "checkout expone vencimiento y versión de precio",
);
assert(
  contains(api, "payload.quoteToken || (await this.quoteFoodCheckout"),
  "cliente API reutiliza la cotización aceptada y conserva fallback seguro",
);
assert(
  containsAll(checkout, ["walletMethod?.id", 'paymentMode === "mercadopago"']),
  "checkout diferencia Wallet propia de tokenización externa",
);

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
const propinaServidor = await fs.readFile("server/tip-repository.js", "utf8");
const pisoServidor = propinaServidor.match(/CHECKOUT_TIP_MIN_CENTS = (\d+)/)?.[1];
const techoServidor = propinaServidor.match(/Math\.min\((\d+),/)?.[1];
const proporcionServidor = propinaServidor.match(/orderTotalCents \* ([\d.]+)/)?.[1];
if (!pisoServidor || !techoServidor || !proporcionServidor)
  throw new Error("No se pudieron leer los topes de propina del servidor");

const propinaWeb = await fs.readFile("src/customer/TipSelector.tsx", "utf8");
const checkoutFuente = app;
assert(
  contains(checkoutFuente, `const propinaMin = ${pisoServidor}`) &&
    contains(checkoutFuente, `Math.min(${techoServidor}, Math.max(propinaMin`) &&
    contains(checkoutFuente, `* ${proporcionServidor})`),
  "los topes de propina del checkout web son los mismos que aplica el servidor",
);
assert(
  containsAll(propinaWeb, ["Sin propina", "subtotal * 100 *"]),
  "la web ofrece no dejar propina y calcula los porcentajes sobre el subtotal",
);
assert(
  contains(checkoutFuente, "tipCents,") && contains(api, "tipCents?: number"),
  "la propina elegida viaja a la API en centavos",
);

// **Los topes de reserva del cliente son los del servidor.** Mismo riesgo que
// con la propina: los dos clientes duplican la ventana para no ofrecer un
// horario que el confirmar va a rechazar, y esa copia es lo que se desincroniza.
// Los numeros se leen del servidor en vez de escribirse aca, para que este
// contrato no pueda quedar viejo junto con el codigo que vigila.
const reglaServidor = await fs.readFile("server/scheduling.js", "utf8");
const minimoServidor = reglaServidor.match(/MINUTOS_MINIMOS_DE_ANTICIPACION = (\d+)/)?.[1];
const horizonteServidor = reglaServidor.match(/DIAS_MAXIMOS_DE_HORIZONTE = (\d+)/)?.[1];
if (!minimoServidor || !horizonteServidor)
  throw new Error("No se pudieron leer los topes de reserva del servidor");
const programador = await fs.readFile("src/customer/SchedulePicker.tsx", "utf8");
assert(
  contains(programador, `MINUTOS_MINIMOS = ${minimoServidor}`) &&
    contains(programador, `DIAS_MAXIMOS = ${horizonteServidor}`),
  "los topes de reserva del checkout web son los mismos que aplica el servidor",
);
assert(
  contains(app, "api.rescheduleJob") && contains(app, "SchedulePicker"),
  "el checkout web reserva horario y la actividad permite moverlo",
);

// ---------------------------------------------------------------------------
// Retiro en el local (GTM-002): el modo tiene que llegar hasta la API.
//
// Es la clase de hueco que este repositorio ya pagó una vez: una capacidad
// construida en el servidor que ninguna pantalla ofrece. El servidor acepta
// `fulfillment`, cotiza sin envío y deja que el comercio complete el pedido;
// si el checkout no manda el modo, todo eso existe y no se puede usar.
assert(
  containsAll(fulfillmentPicker, [
    'aria-label="Modo de entrega"',
    "Retirar en el local",
    'onChange("pickup")',
  ]) && contains(fulfillmentPicker, "pickupAvailable &&"),
  "el checkout ofrece retirar en el local, y sólo donde la sucursal lo habilitó",
);
assert(
  contains(checkout, "fulfillment,") &&
    contains(api, 'fulfillment?: "delivery" | "pickup"') &&
    contains(api, 'payload.fulfillment !== "pickup" && !payload.deliveryAddressId'),
  "el modo viaja a la cotización y a la creación, y la dirección deja de ser obligatoria en retiro",
);
// **La elección sale del token firmado, no del botón.** El servidor compara el
// modo del pedido contra el de la cotización: construirla desde el estado local
// permitiría mandar un modo que el precio no respalda.
assert(
  containsAll(checkout, [
    'checkoutQuote.fulfillment === "pickup"',
    'fulfillment: "pickup"',
    'fulfillment: "delivery"',
  ]),
  "la elección del checkout sale del modo que firmó la cotización",
);
// Sin reparto no hay a quién darle propina, y el servidor devuelve 409 al pedido
// que la lleve: ofrecer el selector sería ofrecer un camino que termina en error.
assert(
  contains(checkout, 'checkoutQuote.fulfillment !== "pickup" && (<TipSelector') &&
    contains(fulfillmentPicker, "onTipReset()"),
  "en retiro no se ofrece propina y la elegida antes se descarta",
);
const sucursalWeb = await fs.readFile("src/types.ts", "utf8");
assert(
  contains(sucursalWeb, "pickupEnabled: boolean") &&
    contains(sucursalWeb, 'fulfillment: "delivery" | "pickup"'),
  "el contrato del cliente publica el modo y qué sucursales lo aceptan",
);

// El retiro se habilita sucursal por sucursal. Si la principal no lo ofrece y
// otra sí, el checkout tiene que ofrecerlo por esa y mandar su id: tomar sólo la
// principal escondía el retiro de un local que lo había encendido.
assert(
  contains(checkout, "restaurant?.branches?.find((branch) => branch.pickupEnabled)") &&
    contains(checkout, "const checkoutBranch = esRetiro ? pickupBranch : primaryBranch;") &&
    contains(checkout, "branchId: checkoutBranch?.id"),
  "el retiro se ofrece por la sucursal que lo habilitó, aunque no sea la principal",
);
// Un retiro no tiene repartidor ni viaje: el seguimiento no puede mostrar
// «Buscando repartidor» ni las etapas de un reparto que no ocurre.
const seguimiento = await fs.readFile("src/customer/OrderTrackingSheet.tsx", "utf8");
assert(
  contains(seguimiento, "const steps = esRetiro ? pickupOrderSteps : orderSteps;") &&
    contains(seguimiento, "Retirás en el local") &&
    contains(seguimiento, "!esRetiro && Boolean(order.pickupLocation"),
  "el seguimiento de un retiro muestra sus propias etapas y no un reparto",
);
