// Viajes en efectivo (PAG-01): el cableado, sin base de datos.
//
// La prueba con PostgreSQL (`test:cash-rides`) liquida un viaje y prueba el tope de
// deuda al aceptar. Esto vigila lo que esa prueba no recorre: que el despacho no le
// ofrezca un viaje en efectivo a quien debe de más, que la API sólo acepte los dos
// medios, y que las dos apps dejen elegir efectivo y le avisen al conductor.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { contains, squeeze } from "./source-contract.mjs";

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

// --- PAG-02: dividir la tarifa ------------------------------------------------
// La prueba con PostgreSQL (`test:fare-splits`) recorre el dinero. Esto vigila el
// cableado: la ruta montada y limitada, la cancelación que devuelve las partes y las
// dos apps.
{
  const [
    division,
    rutas,
    webSeguimiento,
    webInicio,
    movilSeguimiento,
    movilInicio,
    migracion,
    webDivision,
    movilDivision,
  ] = await Promise.all(
    [
      "server/ride-fare-split-repository.js",
      "server/http/ride-fare-split-router.js",
      "src/customer/RideTrackingSheet.tsx",
      "src/customer/RidesLanding.tsx",
      "apps/mobile/src/screens/CustomerTrackingSheets.tsx",
      "apps/mobile/src/screens/CustomerHomeScreen.tsx",
      "database/migrations/144_ride_fare_splits.sql",
      "src/customer/FareSplit.tsx",
      "apps/mobile/src/FareSplit.tsx",
    ].map(leer),
  );
  // La cancelación de viajes y envíos, sola: el archivo tiene otras que también
  // bloquean la cuenta de compensación.
  const cancelacion = billetera.slice(
    billetera.indexOf("export async function cancelMobilityJobAndRefundWallet"),
  );
  assert.ok(
    contains(viajes, "router.use(rideFareSplitRouter);") &&
      contains(rutas, "fareSplitLimiter,") &&
      contains(cancelacion, "await refundFareSplitsOnCancel(client, {") &&
      // Antes de bloquear la cuenta de compensación: después, se trababa con un pago
      // simultáneo del invitado.
      squeeze(cancelacion).indexOf(squeeze("await refundFareSplitsOnCancel(client, {")) <
        squeeze(cancelacion).indexOf(squeeze("account_type='cash_clearing' FOR UPDATE")) &&
      contains(cancelacion, "AND account_type='wallet' FOR NO KEY UPDATE") &&
      contains(migracion, "SET invitee_email = 'eliminado:' || public_id") &&
      contains(division, "const parte = Math.floor(total / (aceptados.length + 2));") &&
      contains(division, "SELECT id FROM ledger_accounts WHERE id=$1 FOR NO KEY UPDATE") &&
      !contains(division, "ORDER BY id FOR UPDATE") &&
      contains(
        division,
        'if (suma !== 0) throw new Error("La división de la tarifa no cuadra");',
      ) &&
      // Invitar no dice quién tiene cuenta: un email sin cliente activo se guarda
      // igual, y hasta aceptar se muestra el email y no el nombre.
      contains(division, "[publicId(), ride.id, user.id, invitado?.id ?? null, correo],") &&
      contains(
        division,
        'name: row.status === "accepted" ? primerNombre(row.invitee_name) : row.invitee_email,',
      ) &&
      // Quien aceptó dividir un viaje en curso no puede borrar su cuenta.
      contains(migracion, "CREATE TRIGGER users_reject_deletion_with_open_fare_split"),
    "dividir la tarifa no está montado, limitado, cuadrado o devuelto al cancelar",
  );
  assert.ok(
    contains(webSeguimiento, "<FareSplitPanel ride={ride} />") &&
      contains(webInicio, "<FareSplitInvitations onPagado={onWalletChanged} />") &&
      contains(movilSeguimiento, "<FareSplitPanel ride={ride} />") &&
      contains(movilInicio, "<FareSplitInvitations onPagado={onWalletChanged} />") &&
      // Una invitación que llega con el inicio abierto aparece sola, y un error se dice.
      [webDivision, movilDivision].every(
        (fuente) =>
          contains(fuente, "const timer = setInterval(() => void cargar(), 30000);") &&
          contains(fuente, "if (accept) onPagado?.();") &&
          // En el panel y en las invitaciones: los dos lugares que leen.
          squeeze(fuente).split(squeeze(".catch(() => setFallo(true)),")).length - 1 === 2,
      ),
    "dividir la tarifa no se ofrece en web y móvil",
  );
  console.log(
    "ok - dividir la tarifa está montado, cuadrado, devuelto al cancelar y en las dos apps",
  );
}
