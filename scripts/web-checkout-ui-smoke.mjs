import fs from "node:fs/promises";
import { contains, containsAll, containsNone, readWebSource, section } from "./source-contract.mjs";

// La fuente se lee por audiencia y no por archivo (ARC-001 paso 8): la mitad del
// trabajo que queda del ticket es partir `App.tsx`, y un contrato con la ruta
// fija se rompe —o se vacía— en cuanto un componente cambia de archivo.
const { source: app } = await readWebSource();
const api = await fs.readFile("src/api.ts", "utf8");
const coordinator = await fs.readFile("src/customer/CustomerSurface.tsx", "utf8");
const foodCart = await fs.readFile("src/customer/FoodCartScreen.tsx", "utf8");
const quantityCounter = await fs.readFile("src/customer/QuantityCounter.tsx", "utf8");
const emptyState = await fs.readFile("src/customer/EmptyState.tsx", "utf8");
const foodCatalog = await fs.readFile("src/customer/FoodCatalogComponents.tsx", "utf8");
const foodRestaurant = await fs.readFile("src/customer/FoodRestaurantScreen.tsx", "utf8");
const foodItemSheet = await fs.readFile("src/customer/FoodItemSheet.tsx", "utf8");
const checkout = section(app, "function CartScreen(", "type ProviderPaymentInput");
if (!checkout) throw new Error("No se encontró el checkout web");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`ok - ${message}`);
};

assert(
  coordinator.trimEnd().split(/\r?\n/).length <= 610 &&
    foodCart.trimEnd().split(/\r?\n/).length <= 690 &&
    quantityCounter.trimEnd().split(/\r?\n/).length <= 35 &&
    emptyState.trimEnd().split(/\r?\n/).length <= 25 &&
    contains(coordinator, "<CartScreen") &&
    !contains(coordinator, "function CartScreen") &&
    contains(foodCart, "<MercadoPagoCardCheckout"),
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
  containsNone(checkout, ["Defensa 982", "Dirección pendiente"]),
  "checkout web no representa una dirección hardcodeada",
);
assert(
  containsAll(checkout, ['aria-label="Dirección de entrega"', "geocodedAddresses.map"]),
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
