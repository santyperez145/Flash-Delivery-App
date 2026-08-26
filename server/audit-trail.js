// Registro de auditoría sobre los dos runtimes (ticket ARC-001, paso 6).
//
// Una mutación tiene que dejar rastro corra sobre PostgreSQL o sobre el fallback
// SQLite, pero el rastro no se escribe igual en los dos: PostgreSQL lo persiste
// en una cadena inmutable con su propia prueba de regresión
// (`test:audit-immutability`), y el fallback lo anota en una ventana acotada en
// memoria.
//
// Este módulo es la única forma de escribir auditoría sin tener que saber cuál
// de los dos está activo. Vivía en `server/index.js`, donde cada handler que lo
// usaba quedaba a un `if` de distancia de auditar en el runtime equivocado.
import { usesPostgresCommerce } from "./commerce-repository.js";
import { audit } from "./fallback-runtime.js";
import { recordPostgresAudit } from "./operations-repository.js";
import { writeDb } from "./store.js";

/**
 * Anota un evento de auditoría en el runtime activo.
 *
 * `db` sólo lo usa el camino del fallback; sobre PostgreSQL se ignora, porque
 * `recordPostgresAudit` escribe en su propia tabla. Quien llama pasa el `db` que
 * ya tenía en la mano en lugar de leerlo de nuevo.
 */
export async function auditRuntime(db, req, entityType, entityId, action, payload = {}) {
  if (usesPostgresCommerce())
    await recordPostgresAudit({
      actorPublicId: req.auth?.userId,
      roles: req.auth?.roles || [],
      action,
      entityType,
      entityId,
      requestId: req.requestId,
      afterData: payload,
    });
  else {
    audit(db, req, entityType, entityId, action, payload);
    writeDb(db);
  }
}
