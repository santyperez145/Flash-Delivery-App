// Efectivo en pedidos de comida (PAG-01): el cableado, sin base.
//
// `test:cash-food-orders` recorre el pedido, la liquidación, la incidencia y la
// rendición contra PostgreSQL. Esto vigila lo que esa prueba no ve: que el alta elija
// el efectivo por un camino explícito y sin intención de pago, que rechace propina y
// entrega sin contacto, que el pedido nazca aceptado, que no se complete sin su
// liquidación, que el despacho proyecte la deuda, que la rendición no supere lo que se
// debe, y que las tres pantallas (quien pide, quien reparte y el comercio) lo muestren.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { contains, squeeze } from "./source-contract.mjs";

const leer = (ruta) => fs.readFile(ruta, "utf8");
const [
  migracion,
  pedidos,
  rutaPedidos,
  liquidacion,
  despacho,
  incidencias,
  sustituciones,
  billetera,
  rutaFlota,
  catalogo,
  rutaCatalogo,
  comprobante,
  webMedio,
  webCheckout,
  webOperaciones,
  webComercio,
  webRendicion,
  movilMedio,
  movilCliente,
  movilGanancias,
  webFormRendicion,
] = await Promise.all(
  [
    "database/migrations/148_cash_food_orders.sql",
    "server/order-repository.js",
    "server/http/order-router.js",
    "server/merchant-finance-repository.js",
    "server/dispatch-repository.js",
    "server/order-issue-repository.js",
    "server/substitution-repository.js",
    "server/wallet-repository.js",
    "server/http/driver-fleet-router.js",
    "server/catalog-repository.js",
    "server/http/catalog-router.js",
    "server/receipt-repository.js",
    "src/cash-payment.ts",
    "src/customer/FoodCartScreen.tsx",
    "src/operations/OperationsSurface.tsx",
    "src/merchant/MerchantConsole.tsx",
    "src/cash-api.ts",
    "apps/mobile/src/cash-payment.ts",
    "apps/mobile/src/screens/CustomerScreen.tsx",
    "apps/mobile/src/screens/DriverEarningsPanel.tsx",
    "src/backoffice/AdminCashDeposit.tsx",
  ].map(leer),
);
const ok = (mensaje) => console.log(`ok - ${mensaje}`);
const antes = (fuente, primero, despues) => {
  const s = squeeze(fuente);
  const a = s.indexOf(squeeze(primero));
  return a >= 0 && a < s.indexOf(squeeze(despues));
};

// --- La sucursal decide, y el alta elige el efectivo por un camino explícito -----------
assert.ok(
  contains(migracion, "ADD COLUMN cash_enabled boolean NOT NULL DEFAULT false;") &&
    contains(migracion, "'gift_card','cash_deposit'));") &&
    contains(catalogo, '["cashEnabled", "cash_enabled"],') &&
    contains(rutaCatalogo, "cashEnabled: z.boolean().optional(),"),
  "la sucursal opta por el efectivo, apagado por omisión, y el comercio lo cambia",
);
assert.ok(
  contains(pedidos, "const cashPayment = paymentMethod === CASH_LABEL;") &&
    contains(pedidos, "if (!walletPayment && !cashPayment && !providerPayment)") &&
    contains(
      pedidos,
      'throw Object.assign(new Error("Este comercio no acepta efectivo"), { status: 409 });',
    ) &&
    (squeeze(pedidos).match(/awaitcontrolarEfectivo\(client,\{/g) || []).length === 2,
  "el efectivo tiene su propio camino y se controla en la cotización y en el alta",
);
assert.ok(
  contains(pedidos, "if (!phoneVerifiedAt)") &&
    contains(pedidos, "if (Number(historial.rechazos) >= 2)"),
  "antifraude: teléfono verificado y sin dos pedidos en efectivo cancelados",
);
assert.ok(
  contains(pedidos, 'new Error("En efectivo, la propina se la das en mano al repartidor"),') &&
    contains(pedidos, 'if (deliveryPreferences.dropoff === "leave_at_door")') &&
    contains(pedidos, "if (cashTenderedCents !== null && cashTenderedCents < totalCents)") &&
    contains(pedidos, "cashTenderedCents, }),"),
  "sin propina de checkout ni entrega sin contacto; con cuánto paga alcanza y entra al hash",
);
assert.ok(
  contains(
    pedidos,
    'const initialStatus = walletPayment || cashPayment ? "accepted" : "requested";',
  ) &&
    contains(pedidos, "} else if (cashPayment) { // Sin `payment_intents`") &&
    contains(pedidos, 'paymentStatus = "cash_on_delivery";') &&
    contains(rutaPedidos, "order.paymentMethod !== CASH_LABEL &&") &&
    contains(rutaPedidos, "if (paymentMethod === CASH_LABEL && !usesPostgresCommerce())"),
  "nace aceptado, sin intención de pago, nunca pasa por Mercado Pago ni por el modo sin base",
);
ok("alta: sucursal, antifraude, propina, puerta, vuelto y estado inicial");

// --- Liquidación: obligatoria, con el cobro en mano ------------------------------------
assert.ok(
  contains(liquidacion, "const efectivo = !payment && job.payment_method_label === CASH_LABEL;") &&
    contains(liquidacion, "`cash-collection-${job.public_id}`,") &&
    contains(liquidacion, 'collector = job.driver_user_id ? "courier" : "merchant";') &&
    antes(
      liquidacion,
      "VALUES($1,$2,'debit',$4,'cash_collection',$5,$6)",
      "return { settled: true, cashRequired: efectivo,",
    ),
  "la liquidación asienta quién cobró el efectivo: repartidor o comercio",
);
assert.ok(
  contains(pedidos, "if (liquidacion?.cashRequired && !liquidacion.settled)"),
  "un pedido en efectivo no se completa sin su liquidación",
);
assert.ok(
  contains(
    incidencias,
    "const efectivo = !payment && issue.payment_method_label === CASH_LABEL;",
  ) &&
    contains(incidencias, 'if (issue.job_status !== "completed")') &&
    contains(incidencias, "? await payerWalletForRefund(client, issue.customer_id)") &&
    contains(sustituciones, "if (refundCents && row.payment_method_label === CASH_LABEL)") &&
    contains(comprobante, 'provider: "cash", status: "collected",'),
  "incidencias como saldo en la Wallet una vez cobrado, sustituciones sin reintegro, comprobante cobrado",
);
ok("liquidación obligatoria, incidencias, sustituciones y comprobante");

// --- Despacho y rendición -------------------------------------------------------------------
assert.ok(
  // Las tres consultas (oferta, ofertas del repartidor y aceptación) lo reconocen.
  (squeeze(despacho).match(/\(j\.payment_method_label=\$[23]\)cash,/g) || []).length === 3 &&
    !contains(despacho, "j.kind='ride' AND j.payment_method_label") &&
    contains(despacho, "THEN GREATEST(0, COALESCE(j.final_amount_cents,j.quoted_amount_cents)") &&
    contains(
      despacho,
      "(await driverWalletBalanceCents(client, driverId)) - enCurso - deudaNueva >= -config.cashDriverDebtLimitCents",
    ) &&
    contains(
      despacho,
      "cashToCollect: row.cash ? pesos(row.final_amount_cents ?? row.quoted_amount_cents) : null,",
    ),
  "el despacho ofrece efectivo en comida y proyecta la deuda contra el tope",
);
assert.ok(
  contains(billetera, "if (amountCents > deuda)") &&
    contains(
      billetera,
      "VALUES($1,'cash_deposit',$2,$3,$4) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,",
    ) &&
    contains(
      rutaFlota,
      '"/api/admin/drivers/:driverId/cash-deposits", requireAuth, requireAnyRole("admin"),',
    ) &&
    contains(rutaFlota, 'return fail(res, 400, "Idempotency-Key válido es obligatorio");'),
  "la rendición la registra administración, no supera la deuda y no se duplica",
);
ok("despacho con deuda proyectada y rendición acotada");

// --- Las pantallas -------------------------------------------------------------------------
assert.ok(
  contains(webMedio, 'export const CASH_PAYMENT = "Efectivo";') &&
    contains(movilMedio, 'export const CASH_PAYMENT = "Efectivo";') &&
    contains(webCheckout, "const efectivoDisponible = checkoutBranch?.cashEnabled === true;") &&
    contains(webCheckout, "? { cashTenderedCents: conCuantoPesos * 100 }") &&
    contains(movilCliente, "const foodCashAvailable = Boolean(foodQuoteBranch?.cashEnabled);") &&
    contains(
      movilCliente,
      "...(conCuanto !== null ? { cashTenderedCents: conCuanto * 100 } : {}),",
    ),
  "web y teléfono ofrecen efectivo sólo donde la sucursal lo acepta y mandan con cuánto paga",
);
assert.ok(
  contains(webOperaciones, "{cobroParaRepartidor(order.cashPayment)}") &&
    contains(webComercio, "{cobroParaComercio(order.cashPayment)}") &&
    contains(webRendicion, '"Idempotency-Key": idempotencyKey') &&
    contains(movilGanancias, "Efectivo por rendir {money.format(cashDebt)}"),
  "quien reparte ve cuánto cobrar, el comercio si cobra él, y la deuda y su rendición están a la vista",
);
ok("pantallas: checkout, repartidor, comercio y rendición");

// --- Lo que encontró la revisión -------------------------------------------------------------
assert.ok(
  contains(
    pedidos,
    "AND e.status IN ('preparing','ready_for_pickup','driver_assigned','picked_up','delivering')))::int rechazos,",
  ) &&
    !contains(pedidos, "AND c.reason_code='recipient_unavailable'") &&
    contains(pedidos, "if (Number(historial.en_curso) >= 1)") &&
    contains(pedidos, "if (deudaComercio < -config.cashMerchantDebtLimitCents)"),
  "antifraude: cualquier cancelación tras prepararse, uno en curso a la vez y el comercio con tope",
);
assert.ok(
  (
    squeeze(pedidos).match(
      /controlarMontoEfectivo\(\{totalCents,deliveryFeeCents,esRetiro\}\);/g,
    ) || []
  ).length === 2 &&
    contains(
      pedidos,
      "if (!esRetiro && totalCents - deliveryFeeCents > config.cashDriverDebtLimitCents)",
    ) &&
    contains(liquidacion, "if (efectivo && capturado > 0) {"),
  "un pedido en efectivo que ningún repartidor puede tomar, o sin nada que cobrar, no se crea",
);
assert.ok(
  contains(billetera, "AND status IN ('picked_up','delivering')`,") &&
    contains(
      billetera,
      "\"SELECT 1 FROM user_roles WHERE user_id=$1 AND role IN ('admin','support')\",",
    ) &&
    contains(billetera, 'new Error("Esa clave ya se usó para otra rendición")'),
  "un pedido en efectivo en camino lo cancela la operación; una clave repetida con otros datos es 409",
);
assert.ok(
  (squeeze(despacho).match(/-\$\{DEUDA_EN_CURSO\}-\$3>=\$2/g) || []).length === 1 &&
    contains(
      despacho,
      "(await driverWalletBalanceCents(client, driverId)) - enCurso - deudaNueva >=",
    ),
  "el tope suma lo que debe por los pedidos en efectivo que todavía lleva",
);
assert.ok(
  contains(webFormRendicion, "clave.current ??= crypto.randomUUID();") &&
    (squeeze(webFormRendicion).match(/clave\.current=null;/g) || []).length === 3,
  "el formulario reusa la clave al reintentar la misma rendición",
);
ok(
  "revisión: antifraude, montos, cancelación en camino, deuda en curso y rendición sin doble registro",
);
