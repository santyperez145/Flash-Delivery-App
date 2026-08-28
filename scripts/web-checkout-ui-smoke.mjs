import fs from "node:fs/promises";
import { contains, containsAll, containsNone, readWebSource, section } from "./source-contract.mjs";

// La fuente se lee por audiencia y no por archivo (ARC-001 paso 8): la mitad del
// trabajo que queda del ticket es partir `App.tsx`, y un contrato con la ruta
// fija se rompe —o se vacía— en cuanto un componente cambia de archivo.
const { source: app } = await readWebSource();
const api = await fs.readFile("src/api.ts", "utf8");
const checkout = section(app, "function CartScreen(", "type ProviderPaymentInput");
if (!checkout) throw new Error("No se encontró el checkout web");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`ok - ${message}`);
};

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
