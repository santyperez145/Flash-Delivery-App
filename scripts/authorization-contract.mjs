// Contrato de autorización HTTP (ticket ARC-001, paso 3).
//
// Estas nueve reglas decidían quién puede hacer qué desde adentro de un archivo
// de 9.500 líneas, y ninguna tenía una prueba directa: la única forma de
// ejercitarlas era levantar la API entera y pegarle a un endpoint. Eso alcanza
// para los caminos que alguien se acordó de cubrir, no para la regla en sí.
//
// Al quedar puras —sin base de datos, sin Express, sin token— se pueden afirmar
// una por una. Este contrato cubre en particular los casos que un smoke de
// extremo a extremo no llega a montar: el administrador sin segundo factor, el
// pedido cuyo comercio ya no existe, y el conductor que no es el asignado.
//
// Corre sin red, sin base y sin credenciales.
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";

const {
  canActAsCustomer,
  canActAsDriver,
  canAdvanceOrder,
  canAdvanceRide,
  canManageRestaurant,
  canMutateOrderStatus,
  canMutateRideStatus,
  hasRole,
  isAdmin,
  requireAnyRole,
} = await import("../server/http/authorization.js");
const { config } = await import("../server/config.js");

const ok = (label) => console.log(`ok - ${label}`);

/** Un `req` mínimo: sólo lo que la autorización mira. */
const asUser = ({
  userId = "USR-1",
  roles = [],
  driverId = null,
  mfa = null,
  mfaVerified = false,
}) => ({
  auth: {
    userId,
    roles,
    user: { id: userId, driverId },
    mfa: mfa ?? { enabled: false },
    mfaVerified,
  },
});

const anonimo = {};
const cliente = asUser({ userId: "USR-CLI", roles: ["customer"] });
const otroCliente = asUser({ userId: "USR-CLI-2", roles: ["customer"] });
const conductor = asUser({ userId: "USR-DRV", roles: ["driver"], driverId: "DRV-1" });
const otroConductor = asUser({ userId: "USR-DRV-2", roles: ["driver"], driverId: "DRV-2" });
const comercio = asUser({ userId: "USR-MER", roles: ["merchant"] });
const otroComercio = asUser({ userId: "USR-MER-2", roles: ["merchant"] });
const adminSinMfa = asUser({ userId: "USR-ADM", roles: ["admin"], mfa: { enabled: true } });
const adminConMfa = asUser({
  userId: "USR-ADM",
  roles: ["admin"],
  mfa: { enabled: true },
  mfaVerified: true,
});
const adminSinMfaHabilitado = asUser({ userId: "USR-ADM-3", roles: ["admin"] });

const restaurante = { id: "RES-1", ownerId: "USR-MER" };

// --- Roles -------------------------------------------------------------------

assert.equal(hasRole(anonimo, "customer"), false);
assert.equal(hasRole(cliente, "customer"), true);
assert.equal(hasRole(cliente, "admin"), false);
ok("un request sin autenticar no tiene ningún rol");

// --- Administrador y segundo factor -----------------------------------------

assert.equal(isAdmin(adminConMfa), true);
assert.equal(isAdmin(adminSinMfa), false);
ok("un administrador con MFA habilitado y sin verificar no es administrador");

// Esta es la regla que un smoke no ejercita salvo que alguien configure la
// plataforma entera en modo `requireAdminMfa`.
const mfaPorConfiguracion = config.requireAdminMfa;
config.requireAdminMfa = true;
assert.equal(
  isAdmin(adminSinMfaHabilitado),
  false,
  "con requireAdminMfa la plataforma exige segundo factor incluso a una cuenta que no lo activó",
);
config.requireAdminMfa = mfaPorConfiguracion;
assert.equal(isAdmin(adminSinMfaHabilitado), true);
ok("`requireAdminMfa` alcanza también a la cuenta que no habilitó MFA por su cuenta");

// --- Middleware de rol -------------------------------------------------------

const capturar = () => {
  const res = { locals: { requestId: "REQ-1" }, statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
};

const correr = (middleware, req) => {
  const res = capturar();
  let siguiente = false;
  middleware(req, res, () => {
    siguiente = true;
  });
  return { res, siguiente };
};

const sinToken = correr(requireAnyRole("customer"), anonimo);
assert.equal(sinToken.siguiente, false);
assert.equal(sinToken.res.statusCode, 401);
ok("sin token el middleware responde 401, no 403");

const sinRol = correr(requireAnyRole("merchant"), cliente);
assert.equal(sinRol.siguiente, false);
assert.equal(sinRol.res.statusCode, 403);
ok("con token y sin el rol el middleware responde 403");

const conRol = correr(requireAnyRole("customer", "merchant"), cliente);
assert.equal(conRol.siguiente, true);
ok("alcanza con uno de los roles admitidos");

const adminIncompleto = correr(requireAnyRole("admin"), adminSinMfa);
assert.equal(adminIncompleto.siguiente, false);
assert.equal(adminIncompleto.res.statusCode, 403);
assert.match(adminIncompleto.res.body.message, /segundo factor/);
ok("el administrador sin segundo factor recibe un 403 que dice por qué");

// El mensaje del 403 no puede filtrar qué rol falta ni sobre qué recurso.
assert.equal(sinRol.res.body.message, "No tienes permisos para esta accion");
assert.equal(sinRol.res.body.ok, false);
assert.equal(sinRol.res.body.requestId, "REQ-1");
ok("el error no revela qué rol se exigía y conserva el requestId");

// --- Identidad ---------------------------------------------------------------

assert.equal(canActAsCustomer(cliente, "USR-CLI"), true);
assert.equal(canActAsCustomer(otroCliente, "USR-CLI"), false);
assert.equal(canActAsCustomer(adminConMfa, "USR-CLI"), true);
assert.equal(canActAsCustomer(adminSinMfa, "USR-CLI"), false);
ok("un cliente sólo actúa sobre sí mismo, y el administrador sin MFA tampoco");

// El vínculo del conductor es `user.driverId`, no el id de usuario. Confundirlos
// es el error que esta aserción fija.
assert.equal(canActAsDriver(conductor, "DRV-1"), true);
assert.equal(canActAsDriver(conductor, "USR-DRV"), false);
assert.equal(canActAsDriver(otroConductor, "DRV-1"), false);
ok("el conductor se identifica por driverId, no por su id de usuario");

assert.equal(canManageRestaurant(comercio, restaurante), true);
assert.equal(canManageRestaurant(otroComercio, restaurante), false);
assert.equal(canManageRestaurant(cliente, restaurante), false);
ok("un comercio no opera sobre el comercio de otro");

// --- Avance de pedido: cada tramo tiene su dueño -----------------------------

const pedido = { id: "ORD-1", customerId: "USR-CLI", restaurantId: "RES-1", courierId: "DRV-1" };
const avanzar = (req, nextStatus, restaurant = restaurante) =>
  canAdvanceOrder(req, { order: pedido, restaurant, nextStatus });

assert.equal(avanzar(comercio, "preparing"), true);
assert.equal(avanzar(comercio, "ready_for_pickup"), true);
assert.equal(avanzar(comercio, "picked_up"), false);
assert.equal(avanzar(comercio, "delivered"), false);
ok("el comercio manda en la preparación y no puede dar un pedido por entregado");

assert.equal(avanzar(conductor, "picked_up"), true);
assert.equal(avanzar(conductor, "delivering"), true);
assert.equal(avanzar(conductor, "delivered"), true);
assert.equal(avanzar(conductor, "preparing"), false);
ok("el conductor manda en el traslado y no puede declarar un pedido listo");

assert.equal(avanzar(otroConductor, "picked_up"), false);
assert.equal(avanzar(cliente, "delivered"), false);
ok("ni un conductor ajeno ni el cliente avanzan el pedido");

// Un pedido puede apuntar a un comercio que ya no existe. Antes de la
// extracción esto dependía de qué devolviera una búsqueda contra el `db`; ahora
// el caso es explícito y la respuesta es denegar, no romper.
assert.equal(avanzar(comercio, "preparing", null), false);
assert.equal(avanzar(adminConMfa, "preparing", null), true);
ok("si el comercio del pedido ya no existe se deniega en lugar de fallar");

// Un pedido sin conductor asignado no habilita a ningún conductor.
assert.equal(
  canAdvanceOrder(conductor, {
    order: { ...pedido, courierId: null },
    restaurant: restaurante,
    nextStatus: "picked_up",
  }),
  false,
);
ok("un pedido sin conductor asignado no lo puede avanzar nadie por el tramo de traslado");

// Un estado que no pertenece a ninguno de los dos tramos se deniega por defecto.
assert.equal(avanzar(comercio, "cancelled"), false);
assert.equal(avanzar(conductor, "inventado"), false);
ok("un estado fuera de los dos tramos se deniega por defecto, no por omisión");

// --- Cancelación de pedido ---------------------------------------------------

const cancelar = (req, status, restaurant = restaurante) =>
  canMutateOrderStatus(req, { order: pedido, restaurant, status });

assert.equal(cancelar(cliente, "cancelled"), true);
assert.equal(cancelar(comercio, "cancelled"), true);
assert.equal(cancelar(conductor, "cancelled"), true);
assert.equal(cancelar(otroCliente, "cancelled"), false);
ok("las tres partes del pedido pueden cancelarlo, un tercero no");

assert.equal(cancelar(cliente, "delivered"), false);
assert.equal(cancelar(comercio, "preparing"), false);
assert.equal(cancelar(adminConMfa, "delivered"), true);
ok("fuera del avance normal sólo se cancela; cualquier otro estado exige administrador");

// --- Viajes ------------------------------------------------------------------

const viaje = { id: "RID-1", customerId: "USR-CLI", driverId: "DRV-1" };

assert.equal(canAdvanceRide(conductor, viaje), true);
assert.equal(canAdvanceRide(otroConductor, viaje), false);
assert.equal(canAdvanceRide(cliente, viaje), false);
assert.equal(canAdvanceRide(adminConMfa, viaje), true);
ok("avanzar un viaje es del conductor asignado");

assert.equal(canAdvanceRide(conductor, { ...viaje, driverId: null }), false);
ok("un viaje sin conductor asignado no lo avanza ningún conductor");

assert.equal(canMutateRideStatus(cliente, viaje, "cancelled"), true);
assert.equal(canMutateRideStatus(conductor, viaje, "cancelled"), true);
assert.equal(canMutateRideStatus(otroCliente, viaje, "cancelled"), false);
assert.equal(canMutateRideStatus(cliente, viaje, "completed"), false);
ok("en un viaje también sólo se cancela fuera del avance normal");

// --- La autorización no toca la base ----------------------------------------

// Si un predicado volviera a recibir el `db`, esta afirmación deja de valer y la
// regla vuelve a ser inverificable sin levantar un runtime. Es la propiedad que
// hace posible todo lo de arriba, así que se afirma explícitamente.
const fuente = await import("node:fs/promises").then((fs) =>
  fs.readFile("server/http/authorization.js", "utf8"),
);
for (const prohibido of ["readDb", "postgresPool", "db.orders", "db.restaurants", "await "]) {
  assert.ok(
    !fuente.includes(prohibido),
    `la autorización no debe depender de la base ni ser asíncrona: apareció \`${prohibido}\``,
  );
}
ok("ningún predicado de autorización consulta la base ni es asíncrono");

console.log("\nok - contrato de autorización verificado");
