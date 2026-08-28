import assert from "node:assert/strict";
import { calculateFoodSettlement } from "../server/merchant-finance-repository.js";
import { splitOrderDiscounts } from "../server/subscription-repository.js";
import { checkoutTipMaxCents, CHECKOUT_TIP_MIN_CENTS } from "../server/tip-repository.js";

const marketplace = calculateFoodSettlement({
  provider: "mercadopago",
  total: 120000,
  subtotal: 100000,
  discount: 0,
  commissionBps: 1800,
  deliveryFee: 10000,
  applicationFee: 30000,
  hasDriver: true,
});
assert.deepEqual(marketplace, {
  merchantNet: 90000,
  driverNet: 10000,
  platformNet: 20000,
  commission: 18000,
});
assert.equal(marketplace.merchantNet + marketplace.driverNet + marketplace.platformNet, 120000);

const wallet = calculateFoodSettlement({
  provider: "flash_wallet",
  total: 120000,
  subtotal: 100000,
  discount: 0,
  commissionBps: 1800,
  deliveryFee: 10000,
  hasDriver: true,
});
assert.deepEqual(wallet, {
  merchantNet: 82000,
  driverNet: 10000,
  platformNet: 28000,
  commission: 18000,
});
assert.throws(
  () =>
    calculateFoodSettlement({
      provider: "mercadopago",
      total: 10000,
      subtotal: 10000,
      discount: 0,
      commissionBps: 1800,
      deliveryFee: 0,
      applicationFee: 11000,
      hasDriver: false,
    }),
  /no balancea/,
);

// ---------------------------------------------------------------------------
// Suscripcion de Flash (GTM-001): quien paga el envio que la suscripcion regala.
//
// El riesgo real no es que el descuento no se aplique —eso se ve enseguida— sino
// que se lo termine pagando el comercio o el conductor sin que nadie lo note. Se
// afirma quien queda igual y quien absorbe la diferencia, no solo que el total
// baje.
// ---------------------------------------------------------------------------
const PLAN = { freeDeliveryMinSubtotalCents: 1500000 };

// Umbral: por debajo no hay beneficio, por encima si. Las dos mitades, porque un
// umbral que solo se prueba del lado que aplica pasaria igual estando en cero.
assert.equal(
  splitOrderDiscounts({
    subscription: PLAN,
    subtotalCents: 1499999,
    deliveryFeeCents: 90000,
  }).subscriptionDiscountCents,
  0,
  "por debajo del umbral la suscripcion no cubre el envio",
);
assert.equal(
  splitOrderDiscounts({ subscription: PLAN, subtotalCents: 1500000, deliveryFeeCents: 90000 })
    .subscriptionDiscountCents,
  90000,
  "desde el umbral la suscripcion cubre el envio completo",
);
assert.equal(
  splitOrderDiscounts({ subscription: null, subtotalCents: 9000000, deliveryFeeCents: 90000 })
    .subscriptionDiscountCents,
  0,
  "sin suscripcion no hay beneficio por mas alto que sea el subtotal",
);
// Un plan sin envio sin cargo no lo da. Distinto de un umbral en cero, que lo
// daria siempre.
assert.equal(
  splitOrderDiscounts({
    subscription: { freeDeliveryMinSubtotalCents: null },
    subtotalCents: 9000000,
    deliveryFeeCents: 90000,
  }).subscriptionDiscountCents,
  0,
  "un plan sin ese beneficio no lo otorga",
);
assert.equal(
  splitOrderDiscounts({
    subscription: { freeDeliveryMinSubtotalCents: 0 },
    subtotalCents: 1,
    deliveryFeeCents: 90000,
  }).subscriptionDiscountCents,
  90000,
  "un umbral en cero si lo otorga siempre",
);

// No se acumula con un cupon que ya regala el envio: sin este corte el envio se
// descontaria dos veces y el pedido devolveria plata que nadie cobro.
assert.equal(
  splitOrderDiscounts({
    subscription: PLAN,
    subtotalCents: 2000000,
    deliveryFeeCents: 90000,
    promotionKind: "free_delivery",
    promotionDiscountCents: 90000,
  }).subscriptionDiscountCents,
  0,
  "no se acumula con una promocion de envio sin cargo",
);
// El alivio combinado nunca supera lo que se cobra: la promocion cede primero
// porque el beneficio de la suscripcion ya esta pago.
const combinado = splitOrderDiscounts({
  subscription: PLAN,
  subtotalCents: 1500000,
  deliveryFeeCents: 90000,
  promotionKind: "fixed",
  promotionDiscountCents: 1590000,
});
assert.equal(combinado.subscriptionDiscountCents + combinado.discountCents, 1590000);
assert.equal(combinado.discountCents, 1500000, "la promocion cede lo que cubre la suscripcion");

// El reparto con subsidio. Subtotal 15.000, envio 900, servicio 100, comision
// 18%: el cliente paga 15.100 en vez de 16.000 porque la suscripcion cubre el
// envio.
const subsidiado = calculateFoodSettlement({
  provider: "flash_wallet",
  total: 1510000,
  subtotal: 1500000,
  discount: 0,
  commissionBps: 1800,
  deliveryFee: 90000,
  hasDriver: true,
  subscriptionDiscount: 90000,
});
// El comercio cobra lo mismo que sin suscripcion: no financio el beneficio.
const sinSuscripcion = calculateFoodSettlement({
  provider: "flash_wallet",
  total: 1600000,
  subtotal: 1500000,
  discount: 0,
  commissionBps: 1800,
  deliveryFee: 90000,
  hasDriver: true,
});
assert.equal(
  subsidiado.merchantNet,
  sinSuscripcion.merchantNet,
  "el comercio cobra igual con y sin suscripcion",
);
assert.equal(
  subsidiado.driverNet,
  90000,
  "el conductor cobra el envio completo aunque el cliente no lo pago",
);
// La diferencia sale del margen de Flash, y sale exactamente entera.
assert.equal(
  sinSuscripcion.platformNet - subsidiado.platformNet,
  90000,
  "la plataforma absorbe el envio regalado, ni mas ni menos",
);
assert.equal(
  subsidiado.merchantNet + subsidiado.driverNet + subsidiado.platformNet,
  1510000,
  "el reparto sigue cerrando contra lo cobrado",
);

// Cuando el subsidio supera el margen, `platformNet` queda negativo y eso es
// correcto: Flash pone plata. Antes esto reventaba en la liquidacion y el pedido
// moria despues de cobrado.
const aPerdida = calculateFoodSettlement({
  provider: "flash_wallet",
  total: 1500000,
  subtotal: 1500000,
  discount: 0,
  commissionBps: 100,
  deliveryFee: 90000,
  hasDriver: true,
  subscriptionDiscount: 90000,
});
// El conductor primero, y no por prolijidad: con margen fino es el unico caso
// donde se le paga de menos, y si la plataforma se afirmara antes el fallo
// nombraria el sintoma —el margen— en vez de la causa.
assert.equal(
  aPerdida.driverNet,
  90000,
  "con margen fino el conductor sigue cobrando el envio completo",
);
assert.ok(aPerdida.platformNet < 0, "la plataforma puede quedar en rojo por lo que regalo");
assert.equal(
  aPerdida.merchantNet + aPerdida.driverNet + aPerdida.platformNet,
  1500000,
  "el reparto cierra incluso en rojo",
);

// El limite sigue siendo estricto. Sin subsidio declarado, un margen negativo es
// un error de tarifa y tiene que seguir explotando: si esto pasara, la cota
// nueva estaria tapando lo que la vieja atajaba.
assert.throws(
  () =>
    calculateFoodSettlement({
      provider: "mercadopago",
      total: 10000,
      subtotal: 10000,
      discount: 0,
      commissionBps: 1800,
      deliveryFee: 0,
      applicationFee: 11000,
      hasDriver: false,
      subscriptionDiscount: 0,
    }),
  /no balancea/,
  "sin subsidio declarado un margen negativo sigue siendo un error",
);

// ---------------------------------------------------------------------------
// Propina tomada en el checkout (GTM-001): no se reparte, se paga aparte.
//
// La liquidacion divide `capturado - propina` y acredita la propina al
// repartidor en el mismo asiento. Se afirma la aritmetica que sostiene eso,
// porque el error que importa —que el comercio o la plataforma se queden con
// parte de la propina— es silencioso: nadie reclama una propina que llego a la
// cuenta equivocada porque nadie la ve.
// ---------------------------------------------------------------------------
const PROPINA = 150000;
const CAPTURADO = 1600000 + PROPINA;
const conPropina = calculateFoodSettlement({
  provider: "flash_wallet",
  total: CAPTURADO - PROPINA,
  subtotal: 1500000,
  discount: 0,
  commissionBps: 1800,
  deliveryFee: 90000,
  hasDriver: true,
});
const sinPropina = calculateFoodSettlement({
  provider: "flash_wallet",
  total: 1600000,
  subtotal: 1500000,
  discount: 0,
  commissionBps: 1800,
  deliveryFee: 90000,
  hasDriver: true,
});
assert.deepEqual(
  conPropina,
  sinPropina,
  "la propina no cambia el reparto: se saca del total antes de dividir",
);
// El asiento cierra contra lo cobrado una vez acreditada la propina.
assert.equal(
  conPropina.merchantNet + conPropina.driverNet + conPropina.platformNet + PROPINA,
  CAPTURADO,
  "lo repartido mas la propina es exactamente lo cobrado",
);

// Con split de marketplace la comision de aplicacion tambien lleva la propina,
// para que el proveedor no se la deposite al comercio, y por eso se descuenta de
// las dos puntas. Si solo se descontara de una, el comercio cobraria de mas o de
// menos exactamente la propina.
const APP_FEE = 400000;
// Lo que la creacion del pedido guarda en `provider_payload`, y lo que la
// liquidacion le vuelve a restar. Escrito en dos pasos porque son dos lugares
// distintos del codigo: si alguno dejara de restar, el comercio cobraria de mas
// o de menos exactamente la propina.
const feeGuardadaEnElIntento = APP_FEE + PROPINA;
const marketplaceConPropina = calculateFoodSettlement({
  provider: "mercadopago",
  total: CAPTURADO - PROPINA,
  subtotal: 1500000,
  discount: 0,
  commissionBps: 1800,
  deliveryFee: 90000,
  hasDriver: true,
  applicationFee: feeGuardadaEnElIntento - PROPINA,
});
assert.equal(
  marketplaceConPropina.merchantNet,
  CAPTURADO - PROPINA - APP_FEE,
  "el comercio recibe lo cobrado sin la propina menos su comision, ni un centavo distinto",
);

// Topes de la propina de checkout. El piso lo impone la tabla desde la migracion
// 025; el techo atrapa un error de tipeo de tres ceros de mas.
assert.equal(
  checkoutTipMaxCents(1000000),
  500000,
  "el techo es la mitad del pedido cuando el pedido es grande",
);
assert.equal(
  checkoutTipMaxCents(1000),
  CHECKOUT_TIP_MIN_CENTS,
  "en un pedido chico el techo no baja del piso, o no se podria dejar propina",
);
assert.equal(checkoutTipMaxCents(100000000), 10000000, "el techo absoluto sigue vigente");

console.log("marketplace ledger smoke passed");
