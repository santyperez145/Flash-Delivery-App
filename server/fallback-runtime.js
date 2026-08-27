// Runtime del fallback SQLite (ticket ARC-001, paso 5).
//
// `store.js` sabe leer y escribir la base local. Lo que vivía en
// `server/index.js` era la capa de encima: **una lectura instrumentada y el
// registro de auditoría**, las dos cosas que todo grupo de rutas necesita para
// operar sobre el fallback.
//
// Se extraen juntas porque comparten propósito, no archivo: son lo que hace que
// el fallback sea observable. Sin el contador, un despliegue que cree estar
// sobre PostgreSQL y esté leyendo SQLite no se distingue de uno correcto; sin la
// auditoría, una mutación sobre el fallback no deja rastro.
//
// No es un módulo HTTP —no conoce `req` más que para leer el actor— así que vive
// junto a `store.js` y no en `http/`.
import { createId, getTimestamp, readDb as readStoredDb } from "./store.js";
import { hasRole, isAdmin } from "./http/authorization.js";

// El registro de auditoría del fallback es una ventana, no un historial: la base
// local es de desarrollo y prueba, y dejar crecer el arreglo sin techo convierte
// cualquier sesión larga en un problema de memoria. El historial real vive en
// PostgreSQL, donde `recordPostgresAudit` lo persiste sin recortar.
const MAX_EVENTOS_AUDITORIA = 500;

let sqliteReads = 0;

/**
 * Lectura contabilizada del fallback.
 *
 * El contador se publica en `/api/ready` como `fallbackDiagnostics.sqliteReads`.
 * Existe porque **una instancia que cree estar sobre PostgreSQL y esté leyendo
 * SQLite responde igual de bien** hasta que alguien mira los datos: el contador
 * es lo que hace visible esa confusión desde afuera.
 */
export function readDb() {
  sqliteReads += 1;
  return readStoredDb();
}

/** Lecturas al fallback desde que arrancó el proceso. */
export function sqliteReadCount() {
  return sqliteReads;
}

/**
 * Anota un evento de auditoría en la base local.
 *
 * Muta el `db` recibido sin escribirlo: quien llama ya tenía que hacer
 * `writeDb`, y persistir acá duplicaría la escritura de cada mutación.
 */
export function audit(db, req, entityType, entityId, action, payload = {}) {
  const event = {
    id: createId("AUD"),
    actorId: req.auth?.userId || "system",
    entityType,
    entityId,
    action,
    payload,
    createdAt: getTimestamp(),
  };
  db.auditEvents = [event, ...(db.auditEvents || [])].slice(0, MAX_EVENTOS_AUDITORIA);
}

/**
 * Recorta el estado del fallback a lo que la sesión puede ver.
 *
 * Vive acá y no en un router porque es la **única** defensa de aislamiento del
 * fallback SQLite: ahí no hay RLS, así que si esta función deja pasar una fila
 * de más, la deja pasar para toda la superficie que use el fallback.
 *
 * Operaciones y soporte ven el estado completo a propósito; el resto ve sólo lo
 * propio, y la auditoría no la ve nadie.
 */
export function scopeStateForRequest(state, req) {
  if (isAdmin(req) || hasRole(req, "support")) return state;
  const userId = req.auth.userId;
  const scoped = { ...state };
  scoped.users = state.users.filter((user) => user.id === userId);
  scoped.addresses = (state.addresses || []).filter((entry) => entry.userId === userId);
  scoped.paymentMethods = (state.paymentMethods || []).filter((entry) => entry.userId === userId);
  scoped.walletTransactions = (state.walletTransactions || []).filter(
    (entry) => entry.userId === userId,
  );
  scoped.supportTickets = (state.supportTickets || []).filter(
    (entry) => !entry.userId || entry.userId === userId,
  );
  scoped.ratings = (state.ratings || []).filter((entry) => entry.userId === userId);
  scoped.auditEvents = [];

  if (hasRole(req, "customer")) {
    scoped.orders = state.orders.filter((entry) => entry.customerId === userId);
    scoped.rides = state.rides.filter((entry) => entry.customerId === userId);
    scoped.shipments = (state.shipments || []).filter((entry) => entry.customerId === userId);
    const assignedDriverIds = new Set(
      [
        ...scoped.orders.map((entry) => entry.courierId),
        ...scoped.rides.map((entry) => entry.driverId),
        ...scoped.shipments.map((entry) => entry.driverId),
      ].filter(Boolean),
    );
    scoped.drivers = state.drivers.filter((entry) => assignedDriverIds.has(entry.id));
  } else if (hasRole(req, "merchant")) {
    scoped.restaurants = state.restaurants.filter((entry) => entry.ownerId === userId);
    const merchantIds = new Set(scoped.restaurants.map((entry) => entry.id));
    scoped.orders = state.orders.filter((entry) => merchantIds.has(entry.restaurantId));
    scoped.rides = [];
    scoped.shipments = [];
    const courierIds = new Set(scoped.orders.map((entry) => entry.courierId).filter(Boolean));
    scoped.drivers = state.drivers.filter((entry) => courierIds.has(entry.id));
  } else if (hasRole(req, "driver")) {
    const driverId = req.auth.user.driverId;
    scoped.orders = state.orders
      .filter((entry) => !entry.courierId || entry.courierId === driverId)
      .map((entry) =>
        entry.courierId === driverId
          ? entry
          : {
              ...entry,
              customerId: "private",
              deliveryAddress: "Disponible después de aceptar",
              items: entry.items.map((item) => ({ ...item, note: "" })),
            },
      );
    scoped.rides = state.rides
      .filter((entry) => !entry.driverId || entry.driverId === driverId)
      .map((entry) => (entry.driverId === driverId ? entry : { ...entry, customerId: "private" }));
    scoped.shipments = (state.shipments || [])
      .filter((entry) => !entry.driverId || entry.driverId === driverId)
      .map((entry) =>
        entry.driverId === driverId
          ? entry
          : {
              ...entry,
              customerId: "private",
              recipientName: "Oculto hasta aceptar",
              recipientPhone: "Oculto",
              deliveryNotes: "",
            },
      );
    scoped.drivers = state.drivers.filter((entry) => entry.id === driverId);
  } else {
    scoped.orders = [];
    scoped.rides = [];
    scoped.shipments = [];
    scoped.drivers = [];
  }
  return scoped;
}

/**
 * Tarifas del fallback SQLite.
 *
 * Llevan `version: "sqlite-test-fallback"` a propósito: cualquier cotización
 * emitida con ellas queda marcada como no productiva. El fallback no lee
 * `pricing_plans`, así que sin estos valores no podría cotizar — pero tampoco
 * debe poder hacerse pasar por una tarifa real.
 */
export const fallbackRidePricing = {
  version: "sqlite-test-fallback",
  config: {
    baseFare: 850,
    distancePerKm: 420,
    timePerMin: 48,
    serviceFee: 390,
    tollThresholdKm: 18,
    tollAmount: 850,
    roadFactor: 1.22,
    minDistanceKm: 1.2,
    maxDistanceKm: 50,
    durationBaseMin: 8,
    durationPerKm: 2.1,
    etaBaseMin: 4,
    etaPerKm: 0.55,
    serviceMultipliers: { moto: 0.78, economy: 1, comfort: 1.28, xl: 1.65 },
  },
};
export const fallbackShipmentPricing = {
  version: "sqlite-test-fallback",
  config: {
    baseFare: 1200,
    distancePerKm: 540,
    weightPerKg: 85,
    roadFactor: 1.22,
    minDistanceKm: 1,
    maxDistanceKm: 45,
    etaBaseMin: 12,
    etaPerKm: 2.2,
    minimumEtaMin: 15,
    sizeMultipliers: { small: 1, medium: 1.18, large: 1.42 },
  },
};

/**
 * Busca un restaurante en el estado del respaldo SQLite.
 *
 * Vivía en `server/index.js`; lo comparten el router de catálogo y el flujo de
 * pedidos del fallback, así que su lugar es el runtime compartido.
 */
export function findRestaurant(db, restaurantId) {
  return db.restaurants.find((restaurant) => restaurant.id === restaurantId);
}

/**
 * Devuelve la entidad con el estado nuevo y su línea de tiempo extendida.
 *
 * Es la transición de estado del respaldo SQLite: pedidos, viajes y envíos
 * avanzan con ella. En PostgreSQL la línea de tiempo la escribe la base.
 */
export function addTimeline(entity, status) {
  return {
    ...entity,
    status,
    timeline: [...(entity.timeline || []), { status, at: getTimestamp() }],
  };
}
