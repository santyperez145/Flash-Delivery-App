// Acceso y confianza (FE-03): el cableado, sin base.
//
// Probado a mano en el navegador contra PostgreSQL: alta de cuenta en la web, código de
// verificación, ingreso directo, cierre de sesión desde Cuenta, recuperación de la
// contraseña e ingreso con la nueva; y la portada sin comercios en web y móvil. Esto
// vigila que no se pierda:
//
// - la web deja crear la cuenta, verificar el email y recuperar la contraseña, con los
//   mismos endpoints que la app, y un ingreso sin verificar sigue con el código;
// - la cuenta de cliente en la web tiene «Cerrar sesión»;
// - sin comercios, la portada y Explorar dicen qué pasa en lugar de quedar vacías, y una
//   promoción de comida no se muestra sin un comercio donde usarla;
// - las promociones de demostración salen de las migraciones: la 150 las apaga si nadie
//   las usó y las semillas de desarrollo las vuelven a crear.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { contains, squeeze } from "./source-contract.mjs";

const leer = (ruta) => fs.readFile(ruta, "utf8");
const [
  login,
  flujos,
  apiWeb,
  app,
  portada,
  perfil,
  superficie,
  libreta,
  portadaMovil,
  comida,
  carrito,
  clienteMovil,
  migracion,
  semilla,
] = await Promise.all(
  [
    "src/auth/WebLogin.tsx",
    "src/auth/WebAccountFlows.tsx",
    "src/api.ts",
    "src/App.tsx",
    "src/customer/CustomerHome.tsx",
    "src/customer/CustomerProfileScreen.tsx",
    "src/customer/CustomerSurface.tsx",
    "src/customer/CustomerAddressBook.tsx",
    "apps/mobile/src/screens/CustomerHomeScreen.tsx",
    "src/customer/FoodDiscoveryHome.tsx",
    "src/customer/FoodCartScreen.tsx",
    "apps/mobile/src/screens/CustomerScreen.tsx",
    "database/migrations/150_demo_promotions_off.sql",
    "scripts/db-seed-commerce.mjs",
  ].map(leer),
);

// --- Alta, verificación y recuperación en la web -------------------------------------
for (const [metodo, ruta] of [
  ["async register(", '"/auth/register"'],
  ["async resendEmailVerification(", '"/auth/email-verification/resend"'],
  ["async confirmEmailVerification(", '"/auth/email-verification/confirm"'],
  ["async requestPasswordRecovery(", '"/auth/password-recovery/request"'],
  ["async confirmPasswordRecovery(", '"/auth/password-recovery/confirm"'],
])
  assert.ok(contains(apiWeb, metodo) && contains(apiWeb, ruta), `el cliente web llama a ${ruta}`);
assert.ok(
  contains(apiWeb, "status: response.status,") && contains(apiWeb, "body: payload as unknown,"),
  "el error del cliente web conserva el estado y el cuerpo de la respuesta",
);
assert.ok(
  contains(app, "?.verificationRequired) return { verificationRequired: true as const };"),
  "un ingreso con el email sin verificar sigue con el código, no muestra un error",
);
assert.ok(
  contains(login, 'setModo("crear")') &&
    contains(login, "Creá tu cuenta") &&
    contains(login, 'setModo("recuperar")') &&
    contains(login, "¿Olvidaste tu contraseña?"),
  "el ingreso web ofrece crear la cuenta y recuperar la contraseña",
);
assert.ok(
  contains(login, "if (resultado?.verificationRequired) {") &&
    contains(login, 'setModo("verificar");'),
  "el ingreso web pasa a la verificación cuando el servidor la pide",
);
assert.ok(
  contains(flujos, "await api.register({") &&
    contains(flujos, "await api.confirmEmailVerification(email, codigo.trim());") &&
    contains(flujos, "await api.confirmPasswordRecovery(codigo.trim(), password);"),
  "los formularios usan los endpoints reales",
);
// El alta y la recuperación validan cada una: las dos reglas aparecen dos veces.
const veces = (fuente, texto) => squeeze(fuente).split(squeeze(texto)).length - 1;
assert.ok(
  veces(
    flujos,
    'if (password.length < 8) return setError("La contraseña necesita al menos 8 caracteres.");',
  ) === 2 &&
    veces(
      flujos,
      'if (password !== repetida) return setError("Las contraseñas no coinciden.");',
    ) === 2 &&
    contains(flujos, String.raw`const TELEFONO = /^\+[1-9][0-9]{7,14}$/;`),
  "el alta y la recuperación validan antes de enviar lo mismo que valida el servidor",
);
assert.ok(
  contains(flujos, "onListo(") &&
    contains(login, "onListo={(texto, correo) => { setEmail(correo);"),
  "después de recuperar la contraseña, el ingreso queda con el email cargado",
);
assert.ok(
  !contains(login, "Accedé con la cuenta asignada a tu operación Flash."),
  "el ingreso web ya no se presenta sólo para cuentas asignadas",
);

// --- Cerrar sesión y textos de Cuenta --------------------------------------------------
assert.ok(
  contains(perfil, "onClick={onLogout}") &&
    contains(perfil, "Cerrar sesión") &&
    contains(superficie, "onLogout={props.onLogout}") &&
    contains(app, "onLogout={logoutWeb}"),
  "la cuenta de cliente en la web tiene «Cerrar sesión»",
);
for (const [fuente, texto] of [
  [perfil, "Teléfono"],
  [perfil, "Dirección principal"],
  [libreta, "Todavía no guardaste destinos."],
  [libreta, "Guardar dirección"],
])
  assert.ok(contains(fuente, texto), `Cuenta dice «${texto}»`);
for (const [fuente, texto] of [
  [perfil, "<strong>Telefono</strong>"],
  [libreta, "Aun no tienes destinos guardados."],
  [libreta, "Checkout mas rapido"],
])
  assert.ok(!contains(fuente, texto), `Cuenta ya no dice «${texto}»`);

// --- Sin comercios, nada vacío ni prometido -------------------------------------------
assert.ok(
  contains(
    portada,
    "{!cargando && !fallo && !hayComercios && !state.restaurants.length && <SinComercios />}",
  ) && contains(portada, "{(hayComercios || state.restaurants.length > 0) && ( <Promociones"),
  "la portada web sin comercios lo dice y no muestra promociones de comida",
);
assert.ok(
  contains(
    portada,
    '{!cargando && !fallo && !servicios.length && ambito === "pedidos" && <SinComercios />}',
  ),
  "Explorar sin comercios lo dice",
);
assert.ok(
  contains(
    portadaMovil,
    "{pedidos && !cargando && !fallo && !hayComercios && !restaurants.length && (",
  ) &&
    contains(portadaMovil, "Todavía no hay comercios en tu zona") &&
    contains(portadaMovil, 'onPress={() => onChangeAmbito("viajes")}'),
  "la portada de la app sin comercios lo dice y ofrece ir a Viajes",
);
assert.ok(
  contains(clienteMovil, "(state.restaurants.some((restaurant) => restaurant.open) &&"),
  "la app no muestra una promoción de comida sin un comercio abierto",
);

// --- Las promociones de demostración, fuera de las migraciones -------------------------
assert.ok(
  contains(migracion, "UPDATE promotions p SET active = false") &&
    contains(migracion, "WHERE p.public_id IN ('promo_food_40', 'promo_ride_airport')") &&
    contains(
      migracion,
      "AND NOT EXISTS (SELECT 1 FROM promotion_redemptions r WHERE r.promotion_id = p.id);",
    ),
  "la migración 150 apaga las promociones de demostración sólo si nadie las usó",
);
assert.ok(
  contains(semilla, "('promo_food_40','FLASH40'") &&
    contains(semilla, "ON CONFLICT(public_id) DO UPDATE SET active = true"),
  "las semillas de desarrollo vuelven a crear las promociones para las pruebas",
);

assert.ok(
  contains(perfil, "¿Cerrar sesión en este navegador?") &&
    contains(perfil, "onClick={() => setConfirmarSalida(false)}") &&
    contains(perfil, "onClick={() => setConfirmarSalida(true)}"),
  "cerrar sesión pide confirmación, con «Volver»",
);
assert.ok(
  contains(comida, "const promociones = hayAbiertos") &&
    contains(comida, "{hayAbiertos && <FlashPassTeaser") &&
    contains(comida, "{platosAbiertos.length > 0 && ("),
  "en Comida, sin comercios abiertos no hay promociones, Flash Más ni un título vacío",
);
assert.ok(
  contains(carrito, 'placeholder="Ingresá tu código"') && !contains(carrito, "FLASH40"),
  "el carrito no sugiere un código de promoción de demostración",
);

console.log("web access and trust contract ok");
