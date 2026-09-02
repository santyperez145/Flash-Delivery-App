// Autorización HTTP (ticket ARC-001, paso 3).
//
// Segundo módulo compartido extraído de `server/index.js`, elegido con el mismo
// criterio que `responses.js`: máximo alcance y mínimo riesgo. Sus predicados se
// usan en 81 puntos del archivo grande, así que si la extracción rompiera algo
// falla el contrato de seguridad entero de inmediato, no en un caso raro.
//
// Lo que este archivo agrega sobre mover código de lugar es que **la
// autorización deja de tocar la base de datos**. Antes `canAdvanceOrder` y
// `canMutateOrderStatus` recibían el `db` completo y buscaban el comercio
// adentro; ahora reciben el comercio ya resuelto. Esa dependencia era la que
// hacía imposible verificar una regla de permisos sin levantar un runtime.
//
// El hallazgo H-08 dice exactamente eso: con la autorización dispersa en un
// archivo de 9.500 líneas, "una revisión de seguridad es impracticable". Tener
// las nueve reglas juntas, puras y con su propio contrato es la respuesta.
import { config } from "../config.js";
import { fail } from "./responses.js";

/** Rol declarado en el token. Un `req` sin autenticar nunca tiene roles. */
export function hasRole(req, role) {
  return Boolean(req.auth?.roles?.includes(role));
}

/**
 * Administrador **con segundo factor resuelto**.
 *
 * Tener el rol no alcanza: si la cuenta tiene MFA habilitado, o la plataforma lo
 * exige por configuración, un token sin `mfa` verificado no ejerce privilegios
 * administrativos. La regla vive acá y no en cada handler justamente para que no
 * pueda olvidarse en uno.
 */
export function isAdmin(req) {
  return (
    hasRole(req, "admin") &&
    !((req.auth?.mfa?.enabled || config.requireAdminMfa) && !req.auth?.mfaVerified)
  );
}

/**
 * Middleware de rol. Distingue los tres casos que un handler no debería tener
 * que distinguir: sin token (401), con token y sin el rol (403), y con el rol
 * de administrador pero sin haber completado el segundo factor (403 propio).
 */
export const requireAnyRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.auth) return fail(res, 401, "Token requerido");
    if (!roles.some((role) => hasRole(req, role))) {
      return fail(res, 403, "No tienes permisos para esta accion");
    }
    if (
      roles.includes("admin") &&
      hasRole(req, "admin") &&
      (req.auth.mfa?.enabled || config.requireAdminMfa) &&
      !req.auth.mfaVerified
    ) {
      return fail(res, 403, "Completa el segundo factor para usar privilegios administrativos");
    }
    return next();
  };

/** El propio cliente, o un administrador actuando en su nombre. */
export function canActAsCustomer(req, customerId) {
  return isAdmin(req) || (hasRole(req, "customer") && req.auth.userId === customerId);
}

/** El propio conductor. El vínculo es `user.driverId`, no el id de usuario. */
export function canActAsDriver(req, driverId) {
  return isAdmin(req) || (hasRole(req, "driver") && req.auth.user.driverId === driverId);
}

/** El dueño del comercio. Un `merchant` no puede operar sobre otro. */
export function canManageRestaurant(req, restaurant) {
  return isAdmin(req) || (hasRole(req, "merchant") && restaurant.ownerId === req.auth.userId);
}

/** Admin gestiona el equipo; soporte sólo puede editar su propio perfil. */
export function canManageSupportAgent(req, userId) {
  return isAdmin(req) || (hasRole(req, "support") && req.auth.userId === userId);
}

/**
 * Quién puede llevar un pedido al siguiente estado.
 *
 * La regla de negocio es que **el comercio y el conductor mandan en tramos
 * distintos**: la preparación es del comercio, el traslado del conductor. Un
 * conductor no puede declarar un pedido listo, y un comercio no puede darlo por
 * entregado.
 *
 * Recibe `restaurant` ya resuelto en lugar de buscarlo: la autorización no
 * consulta la base. `restaurant` puede venir en `null` si el pedido apunta a un
 * comercio que ya no existe, y en ese caso la respuesta es denegar.
 */
export function canAdvanceOrder(req, { order, restaurant, nextStatus }) {
  if (isAdmin(req)) return true;
  if (["preparing", "ready_for_pickup"].includes(nextStatus))
    return Boolean(restaurant && canManageRestaurant(req, restaurant));
  if (["picked_up", "delivering", "delivered"].includes(nextStatus))
    return Boolean(order.courierId && canActAsDriver(req, order.courierId));
  return false;
}

/**
 * Quién puede cambiar el estado de un pedido fuera del avance normal.
 *
 * Sólo existe un caso: cancelar. Cualquiera de las tres partes involucradas
 * puede hacerlo; ningún otro estado se alcanza por esta vía.
 */
export function canMutateOrderStatus(req, { order, restaurant, status }) {
  if (isAdmin(req)) return true;
  if (status !== "cancelled") return false;
  return (
    canActAsCustomer(req, order.customerId) ||
    Boolean(restaurant && canManageRestaurant(req, restaurant)) ||
    Boolean(order.courierId && canActAsDriver(req, order.courierId))
  );
}

/** Avanzar un viaje es del conductor asignado, no de cualquier conductor. */
export function canAdvanceRide(req, ride) {
  return isAdmin(req) || Boolean(ride.driverId && canActAsDriver(req, ride.driverId));
}

/** Mismo criterio que en pedidos: fuera del avance, sólo se cancela. */
export function canMutateRideStatus(req, ride, status) {
  if (isAdmin(req)) return true;
  if (status !== "cancelled") return false;
  return (
    canActAsCustomer(req, ride.customerId) ||
    Boolean(ride.driverId && canActAsDriver(req, ride.driverId))
  );
}
