// Política de audiencias realtime (SEC-001).
//
// Módulo sin dependencias: define QUIÉN puede recibir un evento, sin saber cómo
// se consulta la base ni cómo se entrega. `realtime-repository.js` lo usa para
// resolver participantes concretos, y el contrato de CI lo verifica sin levantar
// PostgreSQL.
//
// La regla es default-deny: una entidad que este módulo no reconoce llega
// solamente a operaciones. La difusión a todos los roles exige estar declarada
// en una de las dos allowlists de abajo.

export const allRoles = ["admin", "customer", "merchant", "driver"];
export const adminOnly = ["admin"];

// Entidades de configuración de plataforma cuya difusión a todos los roles es
// deliberada. Agregar una entrada acá es una decisión de privacidad explícita:
// sólo corresponde si el evento no revela nada sobre un usuario, un comercio o
// un trabajo concreto.
export const globalEntityTypes = new Set(["service_zone", "pricing_change_request"]);

// Tipos de evento sin entidad cuya difusión global es deliberada.
export const globalEventTypes = new Set(["platform.reset"]);

// Entidades que viven en la tabla `jobs` y comparten sus participantes.
export const jobEntityTypes = new Set(["order", "ride", "shipment", "job"]);

// Entidades cuya propiedad se resuelve con una consulta dedicada.
export const ownedEntityTypes = new Set([
  "user",
  "address",
  "driver",
  "restaurant",
  "support_ticket",
]);

/**
 * Clasifica un evento sin tocar la base de datos.
 *
 * - `scoped`       la audiencia se limita a participantes concretos más operaciones.
 * - `global`       difusión a todos los roles, declarada explícitamente.
 * - `unclassified` nadie salvo operaciones. Es un defecto de clasificación,
 *                  no un estado normal, y debe alertar.
 */
export function classifyRealtimeAudience({ type, entityType }) {
  if (!entityType) return globalEventTypes.has(type) ? "global" : "unclassified";
  if (globalEntityTypes.has(entityType)) return "global";
  if (ownedEntityTypes.has(entityType) || jobEntityTypes.has(entityType)) return "scoped";
  return "unclassified";
}
