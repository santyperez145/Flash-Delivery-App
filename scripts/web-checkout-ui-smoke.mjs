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
