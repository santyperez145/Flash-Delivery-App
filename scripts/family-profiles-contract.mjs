// Perfil familiar (PAG-05): el cableado, sin base.
//
// `test:family-profiles` recorre el flujo contra PostgreSQL y la API. Esto vigila lo
// que esa prueba no ve en cada camino: que **todo** reintegro vuelva a quien pagó
// (`payment_intents.customer_id`) y no a quien pidió, que los tres servicios cobren de
// quien organiza con la membresía bloqueada, que ningún cobro se elija por subcadena,
// que las políticas no se llamen entre sí, y que las dos apps ofrezcan el medio.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { contains, squeeze } from "./source-contract.mjs";

const leer = (ruta) => fs.readFile(ruta, "utf8");
const [
  migracion,
  familia,
  rutasFamilia,
  billetera,
  pedidos,
  rutasPedidos,
  movilidad,
  rutasViajes,
  rutasEnvios,
  incidencias,
  sustituciones,
  liquidacion,
  dividir,
  comprobante,
  servidor,
  openapi,
  clasificacion,
  webWallet,
  webMedio,
  webComida,
  webViaje,
  webEnvio,
  movilCuenta,
  movilMedio,
  movilCliente,
  movilViaje,
  movilEnvio,
  webPanel,
  movilPanel,
] = await Promise.all(
  [
    "database/migrations/147_family_profiles.sql",
    "server/family-profile-repository.js",
    "server/http/family-profile-router.js",
    "server/wallet-repository.js",
    "server/order-repository.js",
    "server/http/order-router.js",
    "server/mobility-repository.js",
    "server/http/ride-router.js",
    "server/http/shipment-router.js",
    "server/order-issue-repository.js",
    "server/substitution-repository.js",
    "server/merchant-finance-repository.js",
    "server/ride-fare-split-repository.js",
    "server/receipt-repository.js",
    "server/index.js",
    "server/openapi-paths.js",
    "database/rls-classification.json",
    "src/customer/WalletScreen.tsx",
    "src/customer/family-payment.tsx",
    "src/customer/FoodCartScreen.tsx",
    "src/RideHome.tsx",
    "src/customer/ShipmentHome.tsx",
    "apps/mobile/src/screens/CustomerAccountScreen.tsx",
    "apps/mobile/src/family-payment.tsx",
    "apps/mobile/src/screens/CustomerScreen.tsx",
    "apps/mobile/src/RidePaymentPicker.tsx",
    "apps/mobile/src/screens/CustomerShipmentScreen.tsx",
    "src/customer/FamilyProfile.tsx",
    "apps/mobile/src/FamilyProfile.tsx",
  ].map(leer),
);
const ok = (mensaje) => console.log(`ok - ${mensaje}`);
const antes = (fuente, primero, despues) => {
  const s = squeeze(fuente);
  const a = s.indexOf(squeeze(primero));
  return a >= 0 && a < s.indexOf(squeeze(despues));
};

// --- Esquema -----------------------------------------------------------------------
assert.ok(
  contains(
    migracion,
    "ALTER TABLE payment_intents ADD COLUMN family_member_id uuid REFERENCES family_members(id);",
  ) &&
    contains(
      migracion,
      "CREATE UNIQUE INDEX family_members_one_active ON family_members(member_id) WHERE status = 'active';",
    ),
  "el cobro registra la membresía, y una persona paga con un solo perfil a la vez",
);
const politicaPerfil = squeeze(migracion).match(
  /CREATEPOLICYfamily_profiles_organizerONfamily_profilesUSING\((.*?)\)WITHCHECK/,
);
assert.ok(
  politicaPerfil &&
    !politicaPerfil[1].includes("family_members") &&
    contains(migracion, "ALTER TABLE family_members ENABLE ROW LEVEL SECURITY;") &&
    JSON.parse(clasificacion).tablas.family_profiles?.clase === "por-usuario" &&
    JSON.parse(clasificacion).tablas.family_members?.clase === "por-usuario",
  "RLS en las dos tablas, y la del perfil no consulta a los miembros (sería recursiva)",
);
const auditoria = squeeze(migracion).match(
  /GRANTSELECT\(([^)]*)\)ONfamily_membersTOflash_rls_audit/,
);
assert.ok(
  auditoria && !auditoria[1].includes("invitee_email"),
  "la auditoría no ve el email escrito",
);
assert.ok(
  contains(migracion, "WHERE p.customer_id = NEW.id AND j.customer_id <> NEW.id") &&
    contains(migracion, "RAISE EXCEPTION 'FLASH_DELETE_ACTIVE_JOB' USING ERRCODE = 'P0001';") &&
    contains(migracion, "SET invitee_email = NULL"),
  "quien organiza no se borra con un servicio pagado en curso, y los emails se van con la cuenta",
);
ok("esquema: membresía en el cobro, RLS sin recursión, auditoría sin emails y borrado seguro");

// --- Todo reintegro vuelve a quien pagó ---------------------------------------------
assert.ok(
  (squeeze(billetera).match(/awaitpayerWalletForRefund\(client,payment\.customer_id/g) || [])
    .length === 2 &&
    !contains(billetera, "[job.customer_id],") &&
    (
      squeeze(billetera).match(
        /statusIN\('captured','partially_refunded'\)ANDcaptured_amount_cents>0FORUPDATE/g,
      ) || []
    ).length === 2,
  "cancelar un pedido, un viaje o un envío devuelve a quien pagó, también lo que quedó de un reintegro parcial",
);
assert.ok(
  contains(
    incidencias,
    "const wallet = await payerWalletForRefund(client, payment.customer_id);",
  ) &&
    contains(
      sustituciones,
      "const wallet = await payerWalletForRefund(client, payment.customer_id),",
    ) &&
    contains(liquidacion, "ownerId: payment.customer_id,") &&
    !contains(liquidacion, "ownerId: job.customer_id,") &&
    contains(pedidos, "customerId: payerId,"),
  "incidencias, sustituciones, la propina sin repartidor y su ajuste vuelven a quien pagó",
);
assert.ok(
  contains(billetera, "await notifyPayerRefund(client, {") &&
    (squeeze(billetera).match(/awaitnotifyPayerRefund\(client,\{/g) || []).length === 2,
  "quien pagó se entera de cada reintegro de una cancelación",
);
ok("reintegros: cancelación, incidencia, sustitución y propina, siempre a quien pagó");

// --- Cobros: de quien organiza, con la membresía bloqueada --------------------------
assert.ok(
  contains(
    familia,
    "SELECT fm.id,fm.public_id,fm.monthly_limit_cents,p.organizer_id " +
      "FROM family_members fm JOIN family_profiles p ON p.id=fm.profile_id " +
      "WHERE fm.member_id=$1 AND fm.status='active' FOR UPDATE OF fm`,",
  ) &&
    contains(familia, `"SELECT id,name FROM users WHERE id=$1 AND status='active' FOR SHARE",`) &&
    contains(familia, "if (amountCents > quedan)"),
  "el cobro bloquea la membresía y la cuenta de quien organiza, y controla el tope",
);
assert.ok(
  antes(pedidos, "await resolveFamilyPayer(client, {", "if (walletPayment) {") &&
    contains(pedidos, "const payerId = familia?.organizerId ?? customer.rows[0].id;") &&
    contains(pedidos, "account_type='wallet' FOR UPDATE`, [payerId],") &&
    contains(pedidos, "payerId, chargedCents, `payment-${idempotencyKey}`,") &&
    contains(pedidos, "familia?.familyMemberId ?? null,"),
  "pedidos: se cobra de quien paga, con la membresía en el cobro",
);
assert.ok(
  contains(movilidad, "customerId: familia.organizerId,") &&
    contains(movilidad, "familyMemberId: familia.familyMemberId,") &&
    (squeeze(movilidad).match(/awaitcapturarServicio\(client,\{/g) || []).length === 2 &&
    !/includes\("wallet"\)\)awaitcaptureWalletPayment/.test(squeeze(movilidad)),
  "viajes y envíos cobran por un solo camino que conoce el perfil familiar",
);
// Ningún cobro se elige por subcadena fuera de las funciones que lo encapsulan.
assert.ok(
  (squeeze(pedidos).match(/toLowerCase\(\)\.includes\("wallet"\)/g) || []).length === 1 &&
    contains(
      pedidos,
      'label === FAMILY_LABEL || String(label).toLowerCase().includes("wallet");',
    ) &&
    contains(rutasPedidos, "order.paymentMethod !== FAMILY_LABEL &&"),
  "pedidos: el rail del perfil familiar es explícito (por subcadena caía en Mercado Pago)",
);
assert.ok(
  contains(rutasViajes, 'z.enum(["Flash Wallet", "Efectivo", "Perfil familiar"]') &&
    contains(rutasEnvios, 'z.enum(["Flash Wallet", "Perfil familiar"]') &&
    !contains(rutasEnvios, "paymentMethod: z.string()"),
  "viajes y envíos aceptan el perfil; los envíos ya no aceptan texto libre sin cobrar",
);
assert.ok(
  contains(dividir, "if (String(ride.payer_id) !== String(ride.customer_id))") &&
    contains(
      comprobante,
      "OR EXISTS (SELECT 1 FROM payment_intents p JOIN users pu ON pu.id=p.customer_id",
    ),
  "un viaje pagado con el perfil no se divide, y quien pagó tiene el comprobante",
);
ok("cobros: los tres servicios desde quien organiza, con tope, sin subcadenas");

// --- Rutas -----------------------------------------------------------------------------
for (const [ruta, metodo] of [
  ['"/api/family/members",', "post"],
  ['"/api/family/members/:memberId",', "patch"],
  ['"/api/family/members/:memberId",', "delete"],
  ['"/api/family/leave",', "post"],
])
  assert.ok(
    contains(
      rutasFamilia,
      `familyProfileRouter.${metodo}( ${ruta} familyProfileLimiter, requireAuth, requireAnyRole("customer"),`,
    ),
    `${metodo.toUpperCase()} ${ruta} con límite, sesión y rol de cliente`,
  );
assert.ok(
  antes(
    rutasFamilia,
    "await stepUpMfa(req, parsed.data.mfaCode); const member = await inviteFamilyMember({",
    "familyProfileRouter.patch(",
  ) &&
    antes(
      rutasFamilia,
      "await stepUpMfa(req, parsed.data.mfaCode); const member = await setFamilyMemberLimit({",
      "familyProfileRouter.delete(",
    ) &&
    contains(rutasFamilia, 'res.set("Cache-Control", "no-store, private");') &&
    contains(servidor, "app.use(familyProfileRouter);") &&
    contains(openapi, "...familyProfilePaths(helpers),"),
  "invitar y cambiar el tope piden el segundo factor; rutas montadas, documentadas y sin caché",
);
ok("rutas: límite, segundo factor, sin caché, montadas y documentadas");

// --- Las dos apps -----------------------------------------------------------------
for (const [medio, donde] of [
  [webMedio, "web"],
  [movilMedio, "teléfono"],
])
  assert.ok(
    contains(medio, 'export const FAMILY_PAYMENT: FamilyPaymentLabel = "Perfil familiar";') &&
      // Si la lectura falla no se ofrece: un medio que el servidor rechaza traba el pago.
      contains(medio, "getFamilyProfile()") &&
      !/saldo|balance|wallet\b/i.test(medio.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "")),
    `${donde}: la opción sale de la membresía y nunca muestra el saldo de quien organiza`,
  );
assert.ok(
  contains(webWallet, "<FamilyProfile onWalletChanged={onWalletChanged} />") &&
    contains(movilCuenta, "<FamilyProfile onChanged={onWalletChanged} />"),
  "el panel está al lado del saldo en web y en el teléfono",
);
assert.ok(
  contains(webComida, ': paymentMode === "family" ? FAMILY_PAYMENT') &&
    contains(
      webComida,
      'paymentMethodId: paymentMode === "wallet" ? walletMethod?.id : undefined,',
    ) &&
    contains(movilCliente, "? { paymentMethod: FAMILY_PAYMENT, paymentMethodId: undefined }"),
  "comida: el perfil viaja sin un método guardado, que el servidor rechaza",
);
assert.ok(
  contains(
    webViaje,
    "onClick={() => setRideForm((form) => ({ ...form, paymentMethod: FAMILY_PAYMENT }))}",
  ) &&
    contains(
      webViaje,
      'form.paymentMethod === FAMILY_PAYMENT ? { ...form, paymentMethod: "Flash Wallet" } : form,',
    ) &&
    contains(movilViaje, "...(family ? [FAMILY_PAYMENT] : []),"),
  "viajes: el perfil se ofrece sólo con membresía y vuelve a Wallet si se pierde",
);
assert.ok(
  contains(webEnvio, "paymentMethod: pago,") &&
    contains(webEnvio, "onClick={() => setPago(FAMILY_PAYMENT)}") &&
    contains(
      movilEnvio,
      'const pago = pagoElegido === FAMILY_PAYMENT && familia ? FAMILY_PAYMENT : "Flash Wallet";',
    ) &&
    contains(movilEnvio, "paymentMethod: pago,") &&
    !contains(webEnvio, 'paymentMethod: "Flash Wallet",') &&
    !contains(movilEnvio, 'paymentMethod: "Flash Wallet",'),
  "envíos: se elige el medio, ya no va fijo",
);
ok("web y teléfono: panel al lado del saldo y el medio en comida, viajes y envíos");

// --- Lo que encontró la revisión ---------------------------------------------------
assert.ok(
  contains(migracion, "GRANT SELECT, INSERT, UPDATE ON family_profiles TO flash_runtime;"),
  "el runtime puede bloquear el perfil al invitar (PostgreSQL pide UPDATE para bloquear)",
);
// El cobro y la aceptación bloquean la cuenta de quien organiza antes que la membresía:
// el orden del borrado de esa cuenta. En el inverso, se esperaban mutuamente.
const cobro = familia.slice(familia.indexOf("export async function resolveFamilyPayer"));
assert.ok(
  antes(
    cobro,
    `"SELECT id,name FROM users WHERE id=$1 AND status='active' FOR SHARE",`,
    "WHERE fm.member_id=$1 AND fm.status='active' FOR UPDATE OF fm`,",
  ) && contains(cobro, "if (!fila || fila.organizer_id !== organizador.id) throw sinPerfil();"),
  "el cobro bloquea a quien organiza antes que la membresía, y vuelve a controlarla",
);
const aceptar = familia.slice(familia.indexOf("export const respondFamilyInvitation"));
assert.ok(
  antes(
    aceptar,
    `"SELECT name FROM users WHERE id=$1 AND status='active' FOR SHARE",`,
    "WHERE fm.public_id=$1 FOR UPDATE OF fm`,",
  ),
  "aceptar bloquea a quien organiza antes que la membresía",
);
assert.ok(
  (squeeze(familia).match(/awaitunaPorPersona\(client,/g) || []).length === 2 &&
    contains(
      familia,
      'failure?.code === "23505" && String(failure.constraint) === "family_members_one_active"',
    ),
  "invitar y aceptar se ordenan por persona, y un choque con el índice único es 409",
);
assert.ok(
  contains(migracion, "RAISE EXCEPTION 'FLASH_DELETE_OPEN_CLAIM' USING ERRCODE = 'P0001';") &&
    contains(migracion, "WHERE p.customer_id = NEW.id AND i.status = 'open'") &&
    contains(migracion, "WHERE t.customer_id = NEW.id AND a.status = 'pending'"),
  "quien organiza no se borra con una incidencia o un ajuste de propina pendiente sobre lo que pagó",
);
assert.ok(
  contains(
    familia,
    "WHERE t.job_id=p.job_id AND t.customer_id=p.customer_id AND t.status='refunded'),0)",
  ) &&
    contains(
      familia,
      "WHERE t.job_id=p.job_id AND t.customer_id=p.customer_id AND a.status='approved'),0)",
    ) &&
    contains(
      familia,
      "JOIN users o ON o.id=p.organizer_id AND o.status='active' WHERE fm.member_id=$1 AND fm.status='active'`,",
    ) &&
    contains(pedidos, "opcionFamiliar?.remaining != null &&"),
  "lo gastado descuenta las propinas devueltas; la membresía sólo con quien organiza activa; la cotización avisa el tope",
);
for (const [panel, medio, donde] of [
  [webPanel, webMedio, "web"],
  [movilPanel, movilMedio, "teléfono"],
])
  assert.ok(
    /if \(!codigo(Mfa)? && conMfa !== true && \(await releerMfa\(\)\) === true\)/.test(panel) &&
      contains(panel, "const TOPE_MINIMO = 1000;") &&
      contains(
        medio,
        "family.membership && family.membership.remaining !== 0 ? family.membership : null",
      ),
    `${donde}: un código escrito se manda, el tope mínimo es el del servidor y sin resto no se ofrece`,
  );
assert.ok(
  contains(movilCliente, "paymentMethod: foodCheckoutQuote.paymentMethod,") &&
    contains(
      movilCliente,
      'sharedView === "service" && customerWindow === "food" && foodScreen === "cart";',
    ),
  "teléfono: el pedido usa el medio de la cotización y el perfil se relee al volver al carrito",
);
ok("revisión: permisos, orden de bloqueos, carreras, borrado, gasto neto y las dos apps");
