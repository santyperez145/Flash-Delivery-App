// Los listados con los que operaciones mira la plataforma entera
// (ticket ARC-001, paso 2).
//
// `/api/operations` es el segundo prefijo que resulta ser una audiencia y no un
// dominio: bajo él convivían estos listados, los feature flags, la ingesta de
// analítica y la evaluación de zonas. Este router se queda con lo primero.
//
// Lo que agrupa a las cinco rutas es que **ninguna muta nada y todas cruzan
// inquilinos**: son la vista de la plataforma entera, que sólo tiene sentido
// para quien la opera. Por eso las seis responden `Cache-Control: no-store,
// private`. Un listado operativo que un proxy cachee es una filtración de datos
// de todos los usuarios a quien pase después por el mismo proxy.
//
// La paginación es por cursor y no por offset. Con offset, una fila insertada
// entre dos páginas corre a todas las demás y el operador ve un registro dos
// veces o ninguno; sobre auditoría o tickets eso no es una molestia, es un
// resultado equivocado. El cursor viaja en base64url y **se valida al
// desarmarlo**: uno con forma inesperada es 400 y no una consulta con valores
// arbitrarios.
import { Router } from "express";

import { getPostgresOperationsUserPage, usesPostgresAuth } from "../auth-repository.js";
import { getPostgresOperationsRestaurantPage } from "../catalog-repository.js";
import { getPostgresOperationsDriverPage } from "../driver-roster-repository.js";
import { usesPostgresCommerce } from "../postgres.js";
import { readDb } from "../fallback-runtime.js";
import {
  getPostgresAuditEventPage,
  getPostgresOperationsSupportTicketPage,
} from "../operations-repository.js";
import { sanitizeUser } from "../user-view.js";
import { getWalletBalances } from "../wallet-repository.js";
import { requireAuth } from "./authentication.js";
import { requireAnyRole } from "./authorization.js";
import { fail, failFrom, ok } from "./responses.js";

function parseOperationsCursor(value) {
  if (!value) return null;
  try {
    const cursor = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (typeof cursor.id !== "string" || !/^[0-9]{4}-/.test(cursor.createdAt)) return false;
    return cursor;
  } catch {
    return false;
  }
}
function parseOperationsTimestampCursor(value, field, numericId = false) {
  if (!value) return null;
  try {
    const cursor = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    const validId = numericId
      ? /^\d+$/.test(cursor.id)
      : typeof cursor.id === "string" && /^[a-zA-Z0-9._:-]+$/.test(cursor.id);
    if (!validId || typeof cursor[field] !== "string" || !/^[0-9]{4}-/.test(cursor[field]))
      throw new Error();
    return cursor;
  } catch {
    return false;
  }
}
const fallbackOperationsCursorDate = "1970-01-01T00:00:00.000Z";
function paginateFallbackOperations(
  items,
  {
    limit,
    cursor,
    query,
    search,
    cursorField = "createdAt",
    cursorKey = cursorField,
    map = (item) => item,
  },
) {
  const normalized = query.trim().toLowerCase(),
    filtered = items.filter(
      (item) => !normalized || search(item).toLowerCase().includes(normalized),
    ),
    cursorIndex = cursor ? filtered.findIndex((item) => String(item.id) === String(cursor.id)) : -1,
    offset = cursor ? Math.max(0, cursorIndex + 1) : 0,
    page = filtered.slice(offset, offset + limit),
    last = page.at(-1);
  return {
    items: page.map(map),
    nextCursor:
      offset + limit < filtered.length && last
        ? Buffer.from(
            JSON.stringify({
              [cursorKey]: last[cursorField] || fallbackOperationsCursorDate,
              id: String(last.id),
            }),
          ).toString("base64url")
        : null,
  };
}
const fallbackOperationsSupportTicket = (ticket) => ({
  ...ticket,
  title: ticket.title || ticket.subject || "",
  userId: ticket.userId || null,
  jobId: ticket.jobId || null,
  assignedTo: ticket.assignedTo || null,
  firstResponseDueAt: ticket.firstResponseDueAt || null,
  resolutionDueAt: ticket.resolutionDueAt || null,
  firstRespondedAt: ticket.firstRespondedAt || null,
  lastEscalatedAt: ticket.lastEscalatedAt || null,
  escalationLevel: Number(ticket.escalationLevel || 0),
  messages: ticket.messages || [],
  assignmentHistory: ticket.assignmentHistory || [],
  escalations: ticket.escalations || [],
  slaStatus: ticket.slaStatus || "on_track",
});
const fallbackOperationsAuditEvent = (event) => ({
  ...event,
  id: String(event.id),
  actorId: event.actorId || null,
  payload: event.payload || {},
  createdAt: event.createdAt || fallbackOperationsCursorDate,
});

export const backofficeReportsRouter = Router();
const router = backofficeReportsRouter;

router.get(
  "/api/operations/restaurants",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50)),
      cursor = parseOperationsCursor(req.query.cursor),
      query = String(req.query.q || "").slice(0, 100);
    if (cursor === false) return fail(res, 400, "Cursor operativo inválido");
    try {
      res.set("Cache-Control", "no-store, private");
      if (!usesPostgresCommerce()) {
        const page = paginateFallbackOperations(readDb().restaurants, {
          limit,
          cursor,
          query,
          search: (item) => [item.id, item.name, item.cuisine, item.address].join(" "),
        });
        return ok(res, { restaurants: page.items, nextCursor: page.nextCursor });
      }
      return ok(res, await getPostgresOperationsRestaurantPage({ limit, cursor, query }));
    } catch (error) {
      return failFrom(res, error, "No se pudieron cargar los comercios operativos");
    }
  },
);
router.get("/api/operations/drivers", requireAuth, requireAnyRole("admin"), async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50)),
    cursor = parseOperationsCursor(req.query.cursor),
    query = String(req.query.q || "").slice(0, 100);
  if (cursor === false) return fail(res, 400, "Cursor operativo inválido");
  try {
    res.set("Cache-Control", "no-store, private");
    if (!usesPostgresCommerce()) {
      const page = paginateFallbackOperations(readDb().drivers, {
        limit,
        cursor,
        query,
        search: (item) => [item.id, item.name, item.vehicle, item.plate].join(" "),
        map: (item) => ({ ...item, vehicleStatus: item.vehicleStatus || null }),
      });
      return ok(res, { drivers: page.items, nextCursor: page.nextCursor });
    }
    return ok(res, await getPostgresOperationsDriverPage({ limit, cursor, query }));
  } catch (error) {
    return failFrom(res, error, "No se pudo cargar la flota operativa");
  }
});
router.get("/api/operations/users", requireAuth, requireAnyRole("admin"), async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50)),
    cursor = parseOperationsCursor(req.query.cursor),
    query = String(req.query.q || "").slice(0, 100);
  if (cursor === false) return fail(res, 400, "Cursor operativo inválido");
  try {
    res.set("Cache-Control", "no-store, private");
    if (!usesPostgresCommerce()) {
      const page = paginateFallbackOperations(readDb().users.map(sanitizeUser), {
        limit,
        cursor,
        query,
        search: (item) => [item.id, item.name, item.email].join(" "),
      });
      return ok(res, { users: page.items, nextCursor: page.nextCursor });
    }
    const page = await getPostgresOperationsUserPage({ limit, cursor, query }),
      balances = await getWalletBalances();
    page.users = page.users.map((user) => ({ ...user, wallet: balances.get(user.id) || 0 }));
    return ok(res, page);
  } catch (error) {
    return failFrom(res, error, "No se pudieron cargar los usuarios operativos");
  }
});
router.get(
  "/api/operations/support-tickets",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50)),
      query = String(req.query.q || "").slice(0, 100),
      cursor = parseOperationsTimestampCursor(req.query.cursor, "updatedAt");
    if (cursor === false) return fail(res, 400, "Cursor operativo inválido");
    try {
      res.set("Cache-Control", "no-store, private");
      if (!usesPostgresCommerce()) {
        const page = paginateFallbackOperations(
          readDb().supportTickets.map(fallbackOperationsSupportTicket),
          {
            limit,
            cursor,
            query,
            cursorField: "updatedAt",
            search: (item) => [item.id, item.title, item.service, item.priority].join(" "),
          },
        );
        return ok(res, { tickets: page.items, nextCursor: page.nextCursor });
      }
      return ok(res, await getPostgresOperationsSupportTicketPage({ limit, cursor, query }));
    } catch (error) {
      return failFrom(res, error, "No se pudo cargar la mesa de ayuda");
    }
  },
);
router.get(
  "/api/operations/audit-events",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50)),
      query = String(req.query.q || "").slice(0, 100),
      cursor = parseOperationsTimestampCursor(
        req.query.cursor,
        "occurredAt",
        usesPostgresCommerce(),
      );
    if (cursor === false) return fail(res, 400, "Cursor operativo inválido");
    try {
      res.set("Cache-Control", "no-store, private");
      if (!usesPostgresCommerce()) {
        const page = paginateFallbackOperations(
          readDb().auditEvents.map(fallbackOperationsAuditEvent),
          {
            limit,
            cursor,
            query,
            cursorField: "createdAt",
            cursorKey: "occurredAt",
            search: (item) =>
              [item.id, item.actorId, item.entityType, item.entityId, item.action].join(" "),
          },
        );
        return ok(res, { events: page.items, nextCursor: page.nextCursor });
      }
      return ok(res, await getPostgresAuditEventPage({ limit, cursor, query }));
    } catch (error) {
      return failFrom(res, error, "No se pudo cargar la auditoría");
    }
  },
);
