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
const [
  despacho,
  viajes,
  billetera,
  webViaje,
  webApp,
  movilViaje,
  movilConductor,
  webOps,
  movilPanel,
] = await Promise.all(
  [
    "server/dispatch-repository.js",
    "server/http/ride-router.js",
    "server/wallet-repository.js",
    "src/RideHome.tsx",
    "src/App.tsx",
    "apps/mobile/src/screens/CustomerRideScreen.tsx",
    "apps/mobile/src/screens/DriverJobCards.tsx",
    "src/operations/OperationsSurface.tsx",
    "apps/mobile/src/screens/DriverHomePanel.tsx",
  ].map(leer),
);

assert.ok(
  // Antes de puntuar: filtrar después del corte dejaba el viaje sin ofertas si los
  // mejores puntuados debían de más.
  contains(
    despacho,
    "const habilitados = job.cash ? await elegiblesParaEfectivo(client, driverIds) : driverIds;",
  ) &&
    contains(
      despacho,
      "await scoreCandidates(client, { jobId, driverIds: habilitados, mode, limit })",
    ) &&
    contains(despacho, "if (offer.cash && !(await puedeTomarEfectivo(client, offer.driver_id)))") &&
    // Deber exactamente el tope todavía se permite.
    contains(
      despacho,
      "(await driverWalletBalanceCents(client, driverId)) >= -config.cashDriverDebtLimitCents",
    ) &&
    contains(despacho, "[driverIds, -config.cashDriverDebtLimitCents],"),
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
    contains(movilConductor, 'ride.paymentMethod === "Efectivo" && (') &&
    // También en la consola web del conductor, y en la oferta antes de aceptar.
    contains(webOps, 'ride.paymentMethod === "Efectivo" && (') &&
    contains(webOps, 'const cobro = oferta.cash ? " · en efectivo" : "";') &&
    contains(movilPanel, "{offer.cash && ("),
  "las apps no dejan elegir efectivo, o el conductor no sabe que cobra en mano",
);
console.log("ok - web y móvil dejan elegir efectivo, y el conductor ve cuánto cobrar");
