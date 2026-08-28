// El catálogo por HTTP: la vidriera pública y la pluma del comercio
// (ticket ARC-001, paso 2).
//
// Primer grupo grande extraído después de partir `commerce-repository.js`: este
// router es la cara HTTP de `catalog-repository.js`, y el corte es el mismo
// —el dato lo escribe el comercio y lo lee todo el mundo—.
//
// Las lecturas públicas y las escrituras del dueño viajan juntas a propósito,
// igual que en `configuration-router.js`: son la misma vidriera vista desde los
// dos lados, y separarlas dejaría dos archivos que sólo se entienden abiertos a
// la vez. La línea que sí importa es la de pedidos: acá no se cotiza ni se
// compra nada.
//
// `GET /api/catalog/restaurants` es de las pocas respuestas con caché público
// (`max-age=30`): es la portada, idéntica para todos, y golpearla es lo primero
// que hace cada apertura de la app. Todo lo demás del catálogo responde sin
// caché porque lleva estado del dueño.
//
// `publicRestaurantFallback` es la proyección del respaldo SQLite: recorta
// `ownerId`, apertura manual, horarios e inventario antes de responder. En
// PostgreSQL ese recorte lo hace la consulta; en el respaldo hay que hacerlo a
// mano, y olvidarlo filtraría a qué hora abre cada sucursal con su stock.
import { Router } from "express";
import { z } from "zod";

import { auditRuntime } from "../audit-trail.js";
import { usesPostgresAuth } from "../auth-repository.js";
import {
  createPostgresMenuItem,
  getPostgresRestaurantPage,
  getPostgresRestaurants,
  replacePostgresBranchSchedule,
  replacePostgresItemDietary,
  replacePostgresItemModifiers,
  updatePostgresBranch,
  updatePostgresBranchInventory,
  updatePostgresMenuItem,
  updatePostgresRestaurant,
  upsertPostgresBranchScheduleException,
} from "../catalog-repository.js";
import { searchPostgresCatalog } from "../catalog-search-repository.js";
import { findRestaurant, readDb } from "../fallback-runtime.js";
import { recordPostgresAudit } from "../operations-repository.js";
import { usesPostgresCommerce } from "../postgres.js";
import { createId, getPublicState } from "../store.js";
import { requireAuth } from "./authentication.js";
import { canManageRestaurant, isAdmin, requireAnyRole } from "./authorization.js";
import { publishRealtimeEvent } from "./realtime.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

const branchUpdateSchema = z
  .object({
    open: z.boolean().optional(),
    etaMin: z.coerce.number().int().min(5).max(240).optional(),
    status: z.enum(["active", "paused", "closed"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Debes indicar un cambio");
const branchInventorySchema = z.object({
  available: z.boolean(),
  stockQuantity: z.coerce.number().int().nonnegative().nullable().optional(),
});
const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida");
const branchScheduleSchema = z
  .object({
    timezone: z.string().trim().min(3).max(100),
    hours: z
      .array(
        z.object({
          weekday: z.coerce.number().int().min(0).max(6),
          opensAt: localTimeSchema,
          closesAt: localTimeSchema,
          enabled: z.boolean(),
        }),
      )
      .length(7),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.hours.map((hour) => hour.weekday)).size !== 7)
      ctx.addIssue({
        code: "custom",
        path: ["hours"],
        message: "Debes enviar exactamente un horario por día",
      });
  });
const branchScheduleExceptionSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
    isOpen: z.boolean(),
    opensAt: localTimeSchema.optional(),
    closesAt: localTimeSchema.optional(),
    reason: z.string().trim().max(160).optional(),
  })
  .superRefine((value, ctx) => {
    const date = new Date(`${value.date}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value.date)
      ctx.addIssue({
        code: "custom",
        path: ["date"],
        message: "Fecha calendario inválida",
      });
    if (value.isOpen && (!value.opensAt || !value.closesAt))
      ctx.addIssue({
        code: "custom",
        path: ["opensAt"],
        message: "Una excepción abierta requiere horario",
      });
  });
const itemModifierGroupsSchema = z
  .object({
    groups: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z0-9_-]{2,80}$/),
            name: z.string().trim().min(2).max(100),
            min: z.coerce.number().int().min(0).max(20),
            max: z.coerce.number().int().min(1).max(20),
            active: z.boolean().default(true),
            modifiers: z
              .array(
                z.object({
                  id: z.string().regex(/^[a-zA-Z0-9_-]{2,80}$/),
                  name: z.string().trim().min(1).max(100),
                  price: z.coerce.number().min(0).max(1000000),
                  available: z.boolean().default(true),
                }),
              )
              .max(40),
          })
          .refine((group) => group.min <= group.max && group.max <= group.modifiers.length, {
            message: "Los límites del grupo no coinciden con sus opciones",
          }),
      )
      .max(12),
  })
  .superRefine((value, ctx) => {
    const groupIds = value.groups.map((group) => group.id),
      modifierIds = value.groups.flatMap((group) => group.modifiers.map((modifier) => modifier.id));
    if (new Set(groupIds).size !== groupIds.length)
      ctx.addIssue({
        code: "custom",
        path: ["groups"],
        message: "Los identificadores de grupo no pueden repetirse",
      });
    if (new Set(modifierIds).size !== modifierIds.length)
      ctx.addIssue({
        code: "custom",
        path: ["groups"],
        message: "Los identificadores de agregados deben ser únicos dentro del producto",
      });
  });
const itemDietarySchema = z.object({
  dietaryLabels: z
    .array(z.enum(["vegetarian", "vegan", "gluten_free", "halal", "kosher"]))
    .max(5)
    .refine((values) => new Set(values).size === values.length, "No repitas restricciones"),
  allergens: z
    .array(
      z.object({
        code: z.enum([
          "gluten",
          "milk",
          "eggs",
          "peanuts",
          "tree_nuts",
          "soy",
          "fish",
          "shellfish",
          "sesame",
        ]),
        presence: z.enum(["contains", "may_contain"]),
      }),
    )
    .max(9)
    .refine(
      (values) => new Set(values.map((value) => value.code)).size === values.length,
      "No repitas alérgenos",
    ),
});
const catalogSearchSchema = z.object({
  q: z.string().trim().max(120).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

const publicRestaurantFallback = (restaurant) => {
  const { ownerId: _ownerId, manualOpen: _manualOpen, ...safe } = restaurant;
  return {
    ...safe,
    branches: (restaurant.branches || []).map(
      ({
        manualOpen: _branchManual,
        weeklyHours: _hours,
        scheduleExceptions: _exceptions,
        inventory: _inventory,
        ...branch
      }) => branch,
    ),
  };
};

export const catalogRouter = Router();
const router = catalogRouter;

router.get("/api/catalog/restaurants", async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20)),
    query = String(req.query.q || "").slice(0, 100);
  let cursor = null;
  if (req.query.cursor) {
    try {
      cursor = JSON.parse(Buffer.from(String(req.query.cursor), "base64url").toString("utf8"));
      if (typeof cursor.id !== "string" || !cursor.createdAt) throw new Error();
    } catch {
      return fail(res, 400, "Cursor de catálogo inválido");
    }
  }
  try {
    res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
    if (!usesPostgresCommerce()) {
      const normalized = query.trim().toLowerCase(),
        all = getPublicState()
          .restaurants.filter(
            (item) =>
              !normalized || `${item.name} ${item.cuisine}`.toLowerCase().includes(normalized),
          )
          .map(publicRestaurantFallback),
        offset = cursor ? Math.max(0, all.findIndex((item) => item.id === cursor.id) + 1) : 0,
        restaurants = all.slice(offset, offset + limit),
        last = restaurants.at(-1),
        nextCursor =
          offset + limit < all.length && last
            ? Buffer.from(
                JSON.stringify({ createdAt: new Date(0).toISOString(), id: last.id }),
              ).toString("base64url")
            : null;
      return ok(res, { restaurants, nextCursor });
    }
    return ok(res, await getPostgresRestaurantPage({ limit, cursor, query }));
  } catch (error) {
    return failFrom(res, error, "No se pudo cargar el catálogo");
  }
});

router.get(
  "/api/catalog/search",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "La búsqueda de catálogo requiere PostgreSQL");
    const parsed = parseOrFail(catalogSearchSchema, req.query);
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      return ok(
        res,
        await searchPostgresCatalog({
          userPublicId: req.auth.userId,
          query: parsed.data.q,
          limit: parsed.data.limit,
          offset: parsed.data.offset,
        }),
      );
    } catch (_error) {
      return fail(res, 500, "No se pudo buscar el catálogo");
    }
  },
);

// `GET /api/restaurants` se retiró el 28 de agosto. Devolvía la tabla entera de
// comercios **sin autenticación y sin paginar**, duplicando a
// `/api/catalog/restaurants`, que es la que el producto usa: acotada a 50 por
// página, con cursor y con búsqueda. Ningún cliente la nombraba y no estaba en
// el contrato OpenAPI, así que no hace falta lápida.
//
// No era sólo duplicación: era la salida de emergencia alrededor de la
// paginación. `test:catalog-pagination` verifica el límite de página sobre la
// ruta buena, y esta otra lo dejaba sin efecto para quien la conociera.

router.patch(
  "/api/restaurants/:restaurantId",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const db = usesPostgresAuth() ? null : readDb();
    let restaurant = usesPostgresCommerce()
      ? (await getPostgresRestaurants()).find((entry) => entry.id === req.params.restaurantId)
      : findRestaurant(db, req.params.restaurantId);
    if (!restaurant) return fail(res, 404, "Restaurante no encontrado");
    if (!canManageRestaurant(req, restaurant))
      return fail(res, 403, "No puedes gestionar este restaurante");
    const body = req.body || {};
    if (usesPostgresCommerce()) {
      restaurant = await updatePostgresRestaurant(restaurant.id, body);
    } else {
      if (typeof body.open === "boolean") restaurant.open = body.open;
      if (typeof body.etaMin === "number") restaurant.etaMin = Math.max(5, body.etaMin);
    }
    await auditRuntime(db, req, "restaurant", restaurant.id, "restaurant.updated", {
      open: restaurant.open,
      etaMin: restaurant.etaMin,
    });
    await publishRealtimeEvent({
      req,
      type: "restaurant.updated",
      entityType: "restaurant",
      entityId: restaurant.id,
      action: "restaurant.updated",
    });
    return ok(res, { restaurant });
  },
);

router.post(
  "/api/restaurants/:restaurantId/menu",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const db = usesPostgresAuth() ? null : readDb();
    let restaurant = usesPostgresCommerce()
      ? (await getPostgresRestaurants()).find((entry) => entry.id === req.params.restaurantId)
      : findRestaurant(db, req.params.restaurantId);
    if (!restaurant) return fail(res, 404, "Restaurante no encontrado");
    if (!canManageRestaurant(req, restaurant))
      return fail(res, 403, "No puedes gestionar este restaurante");
    const { name, description, category, price } = req.body || {};
    if (!name || !price) return fail(res, 400, "Nombre y precio son obligatorios");
    const item = {
      id: createId("ITEM"),
      name: String(name),
      description: String(description || ""),
      category: String(category || "Especiales"),
      price: Math.max(100, Number(price)),
      rating: 4.5,
      timeMin: restaurant.etaMin,
      kcal: 500,
      stock: true,
      image: restaurant.image,
      tags: ["Nuevo"],
    };
    if (usesPostgresCommerce()) restaurant = await createPostgresMenuItem(restaurant.id, item);
    else restaurant.menu.unshift(item);
    await auditRuntime(db, req, "menu_item", item.id, "menu_item.created", {
      restaurantId: restaurant.id,
      price: item.price,
    });
    await publishRealtimeEvent({
      req,
      type: "restaurant.updated",
      entityType: "restaurant",
      entityId: restaurant.id,
      action: "menu_item.created",
    });
    return ok(res, { item, restaurant });
  },
);

router.patch(
  "/api/restaurants/:restaurantId/menu/:itemId",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const db = usesPostgresCommerce() ? {} : readDb();
    let restaurant = usesPostgresCommerce()
      ? (await getPostgresRestaurants()).find((entry) => entry.id === req.params.restaurantId)
      : findRestaurant(db, req.params.restaurantId);
    if (!restaurant) return fail(res, 404, "Restaurante no encontrado");
    if (!canManageRestaurant(req, restaurant))
      return fail(res, 403, "No puedes gestionar este restaurante");
    const item = restaurant.menu.find((entry) => entry.id === req.params.itemId);
    if (!item) return fail(res, 404, "Producto no encontrado");
    const body = req.body || {};
    if (usesPostgresCommerce()) {
      restaurant = await updatePostgresMenuItem(restaurant.id, item.id, body);
      Object.assign(
        item,
        restaurant.menu.find((entry) => entry.id === item.id),
      );
    } else {
      if (typeof body.stock === "boolean") item.stock = body.stock;
      if (typeof body.price === "number") item.price = Math.max(100, body.price);
    }
    await auditRuntime(db, req, "menu_item", item.id, "menu_item.updated", {
      restaurantId: restaurant.id,
      stock: item.stock,
      price: item.price,
    });
    await publishRealtimeEvent({
      req,
      type: "restaurant.updated",
      entityType: "restaurant",
      entityId: restaurant.id,
      action: "menu_item.updated",
    });
    return ok(res, { item, restaurant });
  },
);

router.put(
  "/api/restaurants/:restaurantId/menu/:itemId/modifiers",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "La gestión de agregados requiere PostgreSQL");
    const parsed = parseOrFail(itemModifierGroupsSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const restaurant = await replacePostgresItemModifiers({
        merchantPublicId: req.params.restaurantId,
        itemPublicId: req.params.itemId,
        actorPublicId: req.auth.user.id,
        admin: req.auth.user.role === "admin",
        groups: parsed.data.groups,
      });
      await auditRuntime(
        {},
        req,
        "menu_item",
        req.params.itemId,
        "catalog_item.modifiers_replaced",
        {
          restaurantId: req.params.restaurantId,
          groupCount: parsed.data.groups.length,
        },
      );
      await publishRealtimeEvent({
        req,
        type: "restaurant.updated",
        entityType: "restaurant",
        entityId: req.params.restaurantId,
        action: "catalog_item.modifiers_replaced",
      });
      return ok(res, { restaurant });
    } catch (error) {
      return failFrom(res, error, "No se pudieron guardar los agregados");
    }
  },
);

router.put(
  "/api/restaurants/:restaurantId/menu/:itemId/dietary",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "La información alimentaria requiere PostgreSQL");
    const parsed = parseOrFail(itemDietarySchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const restaurant = await replacePostgresItemDietary({
        merchantPublicId: req.params.restaurantId,
        itemPublicId: req.params.itemId,
        actorPublicId: req.auth.user.id,
        admin: req.auth.user.role === "admin",
        ...parsed.data,
      });
      await auditRuntime({}, req, "menu_item", req.params.itemId, "catalog_item.dietary_replaced", {
        restaurantId: req.params.restaurantId,
        dietaryCount: parsed.data.dietaryLabels.length,
        allergenCount: parsed.data.allergens.length,
      });
      await publishRealtimeEvent({
        req,
        type: "restaurant.updated",
        entityType: "restaurant",
        entityId: req.params.restaurantId,
        action: "catalog_item.dietary_replaced",
      });
      return ok(res, { restaurant });
    } catch (error) {
      return failFrom(res, error, "No se pudo guardar la información alimentaria");
    }
  },
);

router.patch(
  "/api/restaurants/:restaurantId/branches/:branchId",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(branchUpdateSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const restaurant = await updatePostgresBranch({
        merchantPublicId: req.params.restaurantId,
        branchPublicId: req.params.branchId,
        actorPublicId: req.auth.userId,
        admin: isAdmin(req),
        changes: parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "merchant_branch.updated",
        entityType: "merchant_branch",
        entityId: req.params.branchId,
        requestId: req.requestId,
        afterData: parsed.data,
      });
      return ok(res, { restaurant });
    } catch (error) {
      return failFrom(res, error, "No se pudo actualizar la sucursal");
    }
  },
);
router.patch(
  "/api/restaurants/:restaurantId/branches/:branchId/inventory/:itemId",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(branchInventorySchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const restaurant = await updatePostgresBranchInventory({
        merchantPublicId: req.params.restaurantId,
        branchPublicId: req.params.branchId,
        itemPublicId: req.params.itemId,
        actorPublicId: req.auth.userId,
        admin: isAdmin(req),
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "branch_inventory.updated",
        entityType: "merchant_branch",
        entityId: req.params.branchId,
        requestId: req.requestId,
        afterData: {
          itemId: req.params.itemId,
          available: parsed.data.available,
          stockQuantity: parsed.data.stockQuantity,
        },
      });
      return ok(res, { restaurant });
    } catch (error) {
      return failFrom(res, error, "No se pudo actualizar el inventario de la sucursal");
    }
  },
);
router.put(
  "/api/restaurants/:restaurantId/branches/:branchId/schedule",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(branchScheduleSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const restaurant = await replacePostgresBranchSchedule({
        merchantPublicId: req.params.restaurantId,
        branchPublicId: req.params.branchId,
        actorPublicId: req.auth.userId,
        admin: isAdmin(req),
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "merchant_branch.schedule_replaced",
        entityType: "merchant_branch",
        entityId: req.params.branchId,
        requestId: req.requestId,
        afterData: { timezone: parsed.data.timezone, hours: parsed.data.hours },
      });
      return ok(res, { restaurant });
    } catch (error) {
      return failFrom(res, error, "No se pudo guardar el horario");
    }
  },
);
router.put(
  "/api/restaurants/:restaurantId/branches/:branchId/schedule-exceptions",
  requireAuth,
  requireAnyRole("merchant", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(branchScheduleExceptionSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const restaurant = await upsertPostgresBranchScheduleException({
        merchantPublicId: req.params.restaurantId,
        branchPublicId: req.params.branchId,
        actorPublicId: req.auth.userId,
        admin: isAdmin(req),
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "merchant_branch.schedule_exception_upserted",
        entityType: "merchant_branch",
        entityId: req.params.branchId,
        requestId: req.requestId,
        afterData: parsed.data,
      });
      return ok(res, { restaurant });
    } catch (error) {
      return failFrom(res, error, "No se pudo guardar la excepción");
    }
  },
);
