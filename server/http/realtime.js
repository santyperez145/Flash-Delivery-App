// Transporte realtime y su ruta SSE (ticket ARC-001, paso 4).
//
// Tercer módulo compartido extraído de `server/index.js`. La política de
// audiencias ya vivía aparte en `realtime-audience.js` desde SEC-001; lo que
// seguía adentro del archivo grande era el **transporte**: el registro de
// clientes conectados, la escritura del frame SSE, el fanout y la publicación.
//
// Esa separación importaba porque el registro de clientes es **estado de
// módulo**. Era la única dependencia de los grupos de rutas que no se podía
// pasar por parámetro sin arrastrar un `Map` vivo entre archivos. Con el hub
// acá, los grupos importan `publishRealtimeEvent` como cualquier otra función.
//
// La ruta `/api/events` viaja con el hub y no en un router aparte: es la única
// que escribe en el registro, y separarla del `Map` que administra sólo movería
// el acoplamiento de lugar.
import { Router } from "express";

import { postgresPool } from "../postgres.js";
import {
  canReceiveRealtimeEvent,
  getPostgresRealtimeCursor,
  getRealtimeAudienceHealth,
  getPostgresRealtimeReplay,
  persistPostgresRealtimeEvent,
  startPostgresRealtimeListener,
} from "../realtime-repository.js";
import { createId, getTimestamp } from "../store.js";
import { requireAuth } from "./authentication.js";
import { requireAnyRole } from "./authorization.js";
import { failFrom, ok } from "./responses.js";

/**
 * Clientes SSE conectados: `res` → `{ userPublicId, roles }`.
 *
 * El contexto se guarda junto al cliente porque el fanout necesita saber a quién
 * le está por escribir **antes** de escribir. Resolver la audiencia después
 * sería tarde.
 */
export const realtimeClients = new Map();

/** Cada 25 s. Sin esto, un proxy corta una conexión inactiva sin avisar. */
const HEARTBEAT_MS = 25000;

/**
 * Escribe un frame SSE. Devuelve `false` si el cliente ya se fue, que es la
 * señal que usan el fanout y el heartbeat para sacarlo del registro.
 */
export function writeSseEvent(client, event, data, cursor = null) {
  if (client.destroyed || client.writableEnded) return false;
  client.write(
    `${cursor ? `id: ${cursor}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
  );
  return true;
}

/**
 * Entrega un evento ya persistido a los clientes que pueden recibirlo.
 *
 * El filtro por audiencia es lo que separa esto de un broadcast: un evento sin
 * clasificación explícita no llega a todos, llega sólo a operaciones. Ver
 * `realtime-audience.js`.
 */
export function fanoutRealtimeEvent(payload) {
  for (const [client, context] of realtimeClients) {
    if (!canReceiveRealtimeEvent(payload, context)) continue;
    if (!writeSseEvent(client, "state.updated", payload, payload.cursor))
      realtimeClients.delete(client);
  }
}

/**
 * Publica un evento de dominio.
 *
 * Con PostgreSQL **persiste y vuelve**: la entrega la hace el listener, que es
 * lo que permite que varias instancias vean el mismo evento y que un cliente
 * pueda pedir replay desde un cursor. Sobre el fallback SQLite no hay dónde
 * persistir, así que escribe directo a los clientes de este proceso.
 */
export async function publishRealtimeEvent({
  req,
  type,
  entityType = null,
  entityId = null,
  action = null,
}) {
  if (postgresPool) {
    await persistPostgresRealtimeEvent({
      type,
      entityType,
      entityId,
      action,
      requestId: req?.requestId || null,
      actorPublicId: req?.auth?.userId || null,
    });
    return;
  }
  const payload = {
    id: createId("EVT"),
    type,
    entityType,
    entityId,
    action,
    requestId: req?.requestId || null,
    at: getTimestamp(),
  };
  for (const [client] of realtimeClients)
    if (!writeSseEvent(client, "state.updated", payload)) realtimeClients.delete(client);
}

/**
 * Arranca el listener de PostgreSQL, o devuelve `null` sobre el fallback.
 *
 * Se llama desde `index.js` y no acá arriba a propósito: es un efecto de
 * arranque, e importar este módulo no debería abrir una conexión.
 */
export function startRealtimeListener() {
  return postgresPool ? startPostgresRealtimeListener(fanoutRealtimeEvent) : null;
}

export const realtimeRouter = Router();

// Salud de la clasificacion de audiencias, para el panel de operaciones.
//
// Vive con el hub y no en un router de backoffice porque es una pregunta sobre
// realtime, no sobre negocio: quien la responde es el mismo modulo que decide
// la audiencia. `postgresOnly` porque el respaldo SQLite no lleva log de
// eventos, y devolver ceros ahi seria peor que decir que no se puede.
realtimeRouter.get(
  "/api/admin/realtime-audience",
  requireAuth,
  requireAnyRole("support", "admin"),
  async (req, res) => {
    if (!postgresPool) {
      return failFrom(
        res,
        Object.assign(new Error("El log de eventos realtime requiere PostgreSQL"), {
          status: 503,
        }),
        "No se pudo leer la salud de audiencias",
      );
    }
    try {
      return ok(res, await getRealtimeAudienceHealth({ hours: req.query.hours }));
    } catch (error) {
      return failFrom(res, error, "No se pudo leer la salud de audiencias");
    }
  },
);

realtimeRouter.get("/api/events", requireAuth, async (req, res) => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Nginx bufferea por omisión, lo que convierte un stream en una respuesta
  // que llega entera al final.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  const context = { userPublicId: req.auth.userId, roles: req.auth.roles };
  realtimeClients.set(res, context);
  const requestedCursor = Math.max(
    0,
    Number(req.get("last-event-id") || req.query.cursor || 0) || 0,
  );
  const cursor = postgresPool ? await getPostgresRealtimeCursor() : null;
  writeSseEvent(
    res,
    "connected",
    {
      id: createId("EVT"),
      type: "connected",
      at: getTimestamp(),
      cursor,
    },
    cursor,
  );
  // El replay se resuelve con el mismo contexto de audiencia que el fanout: un
  // cliente no puede recuperar por cursor lo que no podría haber recibido en
  // vivo.
  if (postgresPool && requestedCursor) {
    for (const event of await getPostgresRealtimeReplay({
      after: requestedCursor,
      ...context,
    }))
      writeSseEvent(res, "state.updated", event, event.cursor);
  }
  const heartbeat = setInterval(() => {
    if (!writeSseEvent(res, "heartbeat", { at: getTimestamp() })) {
      clearInterval(heartbeat);
      realtimeClients.delete(res);
    }
  }, HEARTBEAT_MS);
  req.on("close", () => {
    clearInterval(heartbeat);
    realtimeClients.delete(res);
  });
});
