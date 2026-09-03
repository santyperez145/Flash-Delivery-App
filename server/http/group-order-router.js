// Pedidos grupales (ticket GTM-001, cuarto hueco comercial).
//
// Siete rutas: abrir, listar los propios, ver uno, sumarse con el código, poner
// la canasta propia, cerrar/cancelar, y las dos puntas de la confirmación.
// Confirmar **no crea un pedido acá**: la pantalla pide los ítems juntos, los
// manda por `/api/orders` como cualquier pedido, y avisa que quedó creado.
//
// Esa decisión es la que evita que la propina, la suscripción, el horario
// reservado, el despacho y la liquidación tengan que crecer cada una un caso
// especial de grupo — y que el camino de creación de pedidos, con su
// idempotencia, su riesgo transaccional y su cotización firmada, exista dos
// veces.
import { Router } from "express";
import { z } from "zod";

import {
  collectGroupOrderItems,
  createGroupOrder,
  getGroupOrder,
  joinGroupOrder,
  listGroupOrders,
  markGroupOrderPlaced,
  setGroupOrderItems,
  setGroupOrderStatus,
} from "../group-order-repository.js";
import { recordPostgresAudit } from "../audit-repository.js";
import { usesPostgresCommerce } from "../postgres.js";
import { requireAuth } from "./authentication.js";
import { isAdmin, requireAnyRole } from "./authorization.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

const createSchema = z.object({
  restaurantId: z.string().min(1).max(100),
  branchId: z.string().min(3).max(100).optional(),
  // El tope viaja en centavos y entero, como el resto del dinero del producto.
  spendLimitCents: z.coerce.number().int().min(10000).max(100000000).optional(),
  closesAt: z.string().datetime().optional(),
});
const joinSchema = z.object({
  joinCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{6}$/, "El código tiene seis caracteres"),
});
const itemsSchema = z.object({
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1).max(100),
        quantity: z.coerce.number().int().min(1).max(30),
        extras: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
        note: z.string().trim().max(500).default(""),
      }),
    )
    // Se admite la lista vacía: es como alguien se saca de un pedido sin
    // abandonar el grupo, y sin ella la única salida sería irse del todo.
    .max(50),
});
// `cancelled` corta el grupo entero; `open` deshace un cierre prematuro, que es
// lo que pasa cuando el anfitrión cierra y alguien avisa que le faltó pedir.
const statusSchema = z.object({ status: z.enum(["open", "locked", "cancelled"]) });
const placedSchema = z.object({ orderId: z.string().min(3).max(100) });

export const groupOrderRouter = Router();
const router = groupOrderRouter;

const sinPostgres = (res) =>
  usesPostgresCommerce() ? null : fail(res, 503, "Los pedidos grupales requieren PostgreSQL");

router.post(
  "/api/group-orders",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    if (sinPostgres(res)) return;
    const parsed = parseOrFail(createSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const group = await createGroupOrder({
        hostPublicId: req.auth.userId,
        merchantPublicId: parsed.data.restaurantId,
        branchPublicId: parsed.data.branchId,
        spendLimitCents: parsed.data.spendLimitCents ?? null,
        closesAt: parsed.data.closesAt ?? null,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "group_order.created",
        entityType: "group_order",
        entityId: group.id,
        requestId: req.requestId,
        afterData: { restaurantId: group.restaurantId, spendLimit: group.spendLimit },
      });
      return ok(res, { group });
    } catch (error) {
      return failFrom(res, error, "No se pudo abrir el pedido grupal");
    }
  },
);

router.get("/api/group-orders", requireAuth, async (req, res) => {
  if (sinPostgres(res)) return;
  try {
    return ok(res, { groups: await listGroupOrders(req.auth.userId) });
  } catch (error) {
    return failFrom(res, error, "No se pudieron listar los pedidos grupales");
  }
});

// El código es lo único que hace falta para sumarse, así que la ruta no lleva el
// id del grupo: quien comparte un enlace comparte el código, no la dirección
// interna de nada. Va antes de `/:groupId` porque si no, Express leería «join»
// como un identificador.
router.post(
  "/api/group-orders/join",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    if (sinPostgres(res)) return;
    const parsed = parseOrFail(joinSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const group = await joinGroupOrder({
        joinCode: parsed.data.joinCode,
        userPublicId: req.auth.userId,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "group_order.joined",
        entityType: "group_order",
        entityId: group.id,
        requestId: req.requestId,
      });
      return ok(res, { group });
    } catch (error) {
      return failFrom(res, error, "No se pudo sumar al pedido grupal");
    }
  },
);

router.get("/api/group-orders/:groupId", requireAuth, async (req, res) => {
  if (sinPostgres(res)) return;
  try {
    return ok(res, {
      group: await getGroupOrder({
        groupPublicId: req.params.groupId,
        userPublicId: req.auth.userId,
        admin: isAdmin(req),
      }),
    });
  } catch (error) {
    return failFrom(res, error, "No se pudo leer el pedido grupal");
  }
});

router.put(
  "/api/group-orders/:groupId/items",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    if (sinPostgres(res)) return;
    const parsed = parseOrFail(itemsSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      return ok(res, {
        group: await setGroupOrderItems({
          groupPublicId: req.params.groupId,
          userPublicId: req.auth.userId,
          items: parsed.data.items,
        }),
      });
    } catch (error) {
      return failFrom(res, error, "No se pudo guardar tu parte del pedido");
    }
  },
);

router.patch(
  "/api/group-orders/:groupId",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    if (sinPostgres(res)) return;
    const parsed = parseOrFail(statusSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const group = await setGroupOrderStatus({
        groupPublicId: req.params.groupId,
        hostPublicId: req.auth.userId,
        status: parsed.data.status,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "group_order.status_changed",
        entityType: "group_order",
        entityId: group.id,
        requestId: req.requestId,
        afterData: { status: group.status },
      });
      return ok(res, { group });
    } catch (error) {
      return failFrom(res, error, "No se pudo cambiar el estado del pedido grupal");
    }
  },
);

/**
 * Lo que el grupo cerrado pide, junto y en el formato de la cotización.
 *
 * La pantalla lo usa para cotizar y confirmar por `/api/orders`, y después avisa
 * por `/placed`. Confirmar acá adentro habría duplicado el camino de creación de
 * pedidos entero, sólo para el caso grupal.
 */
router.get(
  "/api/group-orders/:groupId/checkout",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    if (sinPostgres(res)) return;
    try {
      return ok(
        res,
        await collectGroupOrderItems({
          groupPublicId: req.params.groupId,
          hostPublicId: req.auth.userId,
        }),
      );
    } catch (error) {
      return failFrom(res, error, "No se pudo preparar el pedido grupal");
    }
  },
);

router.post(
  "/api/group-orders/:groupId/placed",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    if (sinPostgres(res)) return;
    const parsed = parseOrFail(placedSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      // Se relee el grupo con la identidad de quien llama antes de marcarlo: sin
      // eso, cualquiera que conozca el id de un grupo podría cerrarlo
      // apuntándolo a un pedido ajeno.
      const group = await getGroupOrder({
        groupPublicId: req.params.groupId,
        userPublicId: req.auth.userId,
      });
      if (group.hostId !== req.auth.userId)
        return fail(res, 403, "Sólo quien abrió el grupo puede confirmarlo");
      await markGroupOrderPlaced({
        groupPublicId: req.params.groupId,
        orderPublicId: parsed.data.orderId,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "group_order.placed",
        entityType: "group_order",
        entityId: group.id,
        requestId: req.requestId,
        afterData: { orderId: parsed.data.orderId },
      });
      return ok(res, {
        group: await getGroupOrder({
          groupPublicId: req.params.groupId,
          userPublicId: req.auth.userId,
        }),
      });
    } catch (error) {
      return failFrom(res, error, "No se pudo cerrar el pedido grupal");
    }
  },
);
