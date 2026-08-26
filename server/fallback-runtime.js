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
