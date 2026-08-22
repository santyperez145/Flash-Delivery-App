import fs from "node:fs/promises";

const app = await fs.readFile("src/App.tsx", "utf8");
const api = await fs.readFile("src/api.ts", "utf8");
const start = app.indexOf("function CartScreen(");
const end = app.indexOf("type ProviderPaymentInput", start);
if (start < 0 || end < 0) throw new Error("No se encontró el checkout web");
const checkout = app.slice(start, end);
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`ok - ${message}`);
};

assert(!checkout.includes("Defensa 982") && !checkout.includes("Dirección pendiente"), "checkout web no representa una dirección hardcodeada");
assert(checkout.includes('aria-label="Dirección de entrega"') && checkout.includes("geocodedAddresses.map"), "checkout elige una dirección geocodificada de la cuenta");
assert(checkout.includes("api.quoteFoodCheckout") && checkout.includes("quoteToken:checkoutQuote.quoteToken"), "checkout muestra y confirma la misma cotización firmada");
assert(checkout.includes("quoteExpired") && checkout.includes("pricingVersion"), "checkout expone vencimiento y versión de precio");
assert(api.includes("payload.quoteToken || (await this.quoteFoodCheckout"), "cliente API reutiliza la cotización aceptada y conserva fallback seguro");
assert(checkout.includes("walletMethod?.id") && checkout.includes('paymentMode==="mercadopago"'), "checkout diferencia Wallet propia de tokenización externa");
