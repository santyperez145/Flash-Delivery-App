// Viajes en efectivo (PAG-01): el cableado, sin base de datos.
//
// La prueba con PostgreSQL (`test:cash-rides`) liquida un viaje y prueba el tope de
// deuda al aceptar. Esto vigila lo que esa prueba no recorre: que el despacho no le
// ofrezca un viaje en efectivo a quien debe de más, que la API sólo acepte los dos
// medios, y que las dos apps dejen elegir efectivo y le avisen al conductor.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { contains } from "./source-contract.mjs";

const leer = (ruta) => fs.readFile(ruta, "utf8");
const [despacho, viajes, billetera, webViaje, webApp, movilViaje, movilConductor] =
  await Promise.all(
    [
      "server/dispatch-repository.js",
      "server/http/ride-router.js",
      "server/wallet-repository.js",
      "src/RideHome.tsx",
      "src/App.tsx",
      "apps/mobile/src/screens/CustomerRideScreen.tsx",
      "apps/mobile/src/screens/DriverJobCards.tsx",
    ].map(leer),
  );

assert.ok(
  contains(despacho, "if (job.cash) candidates.rows = (") &&
    contains(despacho, "(await puedeTomarEfectivo(client, candidate.id)) ? candidate : null") &&
    contains(despacho, "if (offer.cash && !(await puedeTomarEfectivo(client, offer.driver_id)))") &&
    contains(
      despacho,
      "(await driverWalletBalanceCents(client, driverId)) > -config.cashDriverDebtLimitCents",
    ),
  "el despacho ofrece o deja aceptar un viaje en efectivo a quien debe más del tope",
);
console.log("ok - quien debe más del tope no recibe ni acepta viajes en efectivo");

assert.ok(
  contains(viajes, 'paymentMethod: z.enum(["Flash Wallet", "Efectivo"], {') &&
    contains(
      billetera,
      'const efectivo = !payment && job.kind === "ride" && job.payment_method_label === CASH_LABEL;',
    ) &&
    contains(billetera, "`cash-collection-${reference}`"),
  "la API acepta otro medio, o el efectivo no se liquida con su cobro en mano",
);
console.log("ok - un viaje se paga con Wallet o en efectivo, y el efectivo se liquida");

assert.ok(
  contains(webApp, 'paymentMethod: rideForm.paymentMethod ?? "Flash Wallet",') &&
    contains(webViaje, '(["Flash Wallet", "Efectivo"] as const).map((metodo) => (') &&
    contains(movilViaje, "paymentMethod: pago,") &&
    contains(movilViaje, "<RidePaymentPicker value={pago}") &&
    contains(movilConductor, 'ride.paymentMethod === "Efectivo" && ('),
  "las apps no dejan elegir efectivo, o el conductor no sabe que cobra en mano",
);
console.log("ok - web y móvil dejan elegir efectivo, y el conductor ve cuánto cobrar");
