import fs from "node:fs/promises";
import { contains, containsAll, containsNone, section } from "./source-contract.mjs";

const app = await fs.readFile("src/App.tsx", "utf8");
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
