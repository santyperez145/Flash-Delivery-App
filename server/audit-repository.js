// Auditoría de acciones (ARC-001).
//
// Escritura y lectura de `audit_events`, separada del soporte y del money
// overview: casi todos los routers mutan aquí; no deben arrastrar tickets.
import { postgresPool } from "./postgres.js";

export async function recordPostgresAudit({
  actorPublicId,
  roles = [],
  action,
  entityType,
  entityId,
  requestId,
  beforeData = null,
  afterData = {},
}) {
  // Sin actor identificado el evento se anota igual, con `actor_id` nulo. Pasa
  // en las rutas que no exigen sesión: «alguien hizo esto y no sabemos quién» es
  // peor que un nombre, pero es muchísimo mejor que nada.
  if (!actorPublicId) {
    await postgresPool.query(
      `INSERT INTO audit_events(actor_id,actor_roles,action,entity_type,entity_id,request_id,before_data,after_data)
      VALUES(NULL,$1::user_role[],$2,$3,$4,$5,$6,$7)`,
      [roles, action, entityType, entityId, requestId || null, beforeData, afterData],
    );
    return;
  }
  const escrito = await postgresPool.query(
    `INSERT INTO audit_events(actor_id,actor_roles,action,entity_type,entity_id,request_id,before_data,after_data)
    SELECT u.id,$2::user_role[],$3,$4,$5,$6,$7,$8 FROM users u WHERE u.public_id=$1`,
    [actorPublicId, roles, action, entityType, entityId, requestId || null, beforeData, afterData],
  );
  // `INSERT ... SELECT` con un actor que no existe inserta cero filas y no falla.
  // Es decir: la acción privilegiada ocurre y su rastro desaparece sin que nadie
  // se entere. Hoy no es alcanzable —`requireAuth` verifica que el usuario exista
  // antes de dejar pasar la petición— pero es una trampa puesta para el próximo
  // que llame desde fuera de una sesión, que fue exactamente lo que pasó al
  // escribir la conciliación programada.
  if (!escrito.rowCount) {
    throw new Error(
      `No se registró la auditoría de "${action}": el actor ${actorPublicId} no existe`,
    );
  }
}

/**
 * Anota un evento originado por el sistema, sin persona detrás.
 *
 * Existe separado y no como un `actorPublicId` nulo a propósito: un evento de
 * sistema y uno cuyo actor no se pudo identificar son cosas distintas, y quien
 * lee la auditoría necesita poder distinguirlas. El origen queda en
 * `after_data.origin`, porque `actor_id` nulo por sí solo no dice cuál de las
 * dos es.
 */
export async function recordSystemAudit({
  action,
  entityType,
  entityId,
  origin,
  beforeData = null,
  afterData = {},
}) {
  if (!origin) throw new Error("Un evento de sistema tiene que declarar su origen");
  await postgresPool.query(
    `INSERT INTO audit_events(actor_id,actor_roles,action,entity_type,entity_id,request_id,before_data,after_data)
    VALUES(NULL,NULL,$1,$2,$3,NULL,$4,$5)`,
    [action, entityType, entityId, beforeData, { ...afterData, origin }],
  );
}

export async function getPostgresAuditEvents(limit = 100) {
  const result = await postgresPool.query(
    `SELECT ae.id::text, u.public_id actor_id, ae.entity_type, ae.entity_id, ae.action,
      COALESCE(ae.after_data, '{}') payload, ae.occurred_at
     FROM audit_events ae
     LEFT JOIN users u ON u.id = ae.actor_id
     ORDER BY ae.occurred_at DESC
     LIMIT $1`,
    [Math.min(500, Math.max(1, limit))],
  );
  return result.rows.map((row) => ({
    id: row.id,
    actorId: row.actor_id || null,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    payload: row.payload,
    createdAt: new Date(row.occurred_at).toISOString(),
  }));
}

export async function getPostgresAuditEventPage({ limit = 100, cursor = null, query = "" } = {}) {
  const result = await postgresPool.query(
    `SELECT ae.id::text, u.public_id actor_id, ae.entity_type, ae.entity_id, ae.action,
      COALESCE(ae.after_data, '{}') payload, ae.occurred_at,
      to_char(ae.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_occurred_at
     FROM audit_events ae
     LEFT JOIN users u ON u.id = ae.actor_id
     WHERE ($1 = '' OR ae.action ILIKE '%' || $1 || '%'
       OR ae.entity_type ILIKE '%' || $1 || '%'
       OR ae.entity_id ILIKE '%' || $1 || '%'
       OR u.public_id ILIKE '%' || $1 || '%')
       AND ($2::timestamptz IS NULL OR (ae.occurred_at, ae.id) < ($2::timestamptz, $3::bigint))
     ORDER BY ae.occurred_at DESC, ae.id DESC
     LIMIT $4`,
    [query.trim(), cursor?.occurredAt || null, cursor?.id || null, limit + 1],
  );
  const hasMore = result.rows.length > limit,
    rows = result.rows.slice(0, limit),
    last = rows.at(-1);
  return {
    events: rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id || null,
      entityType: row.entity_type,
      entityId: row.entity_id,
      action: row.action,
      payload: row.payload,
      createdAt: new Date(row.occurred_at).toISOString(),
    })),
    nextCursor:
      hasMore && last
        ? Buffer.from(
            JSON.stringify({ occurredAt: last.cursor_occurred_at, id: last.id }),
          ).toString("base64url")
        : null,
  };
}
