// El ciclo del pedido de comida por HTTP: carrito, cotización, compra y
// entrega (ticket ARC-001, paso 2).
//
// Es la cara HTTP de `order-repository.js`, extraída con el mismo corte que
// partió al repositorio: acá el dueño del dato es el cliente y su transacción.
// Las ocho rutas son una sola historia en orden —armar el carrito, cotizar,
// comprar, y el pedido avanzando de mano en mano hasta la entrega—.
//
// Conviven a propósito las dos mitades del tablero: `accept-delivery` y
// `advance` son el pedido visto por quien lo entrega; el resto, por quien lo
// pidió. Separarlos dejaría la máquina de estados repartida en dos archivos.
//
// Lo que este router NO contiene también es diseño: la cancelación valida con
// `cancellationSchema` compartido —los motivos se comparan entre servicios— y
// las ganancias del conductor se acreditan vía `driver-earnings.js`, que
// comparten pedidos, viajes y envíos.
import jwt from "jsonwebtoken";
import { Router } from "express";
import { z } from "zod";

import { auditRuntime } from "../audit-trail.js";
import { findAuthUserByPublicId, usesPostgresAuth } from "../auth-repository.js";
import { cancellationSchema } from "./cancellation.js";
import { requireAuth } from "./authentication.js";
import {
  canActAsCustomer,
  canActAsDriver,
  canAdvanceOrder,
  canMutateOrderStatus,
  requireAnyRole,
} from "./authorization.js";
import { getPostgresRestaurants } from "../catalog-repository.js";
import { getPostgresDrivers } from "../driver-roster-repository.js";
import { addTimeline, findRestaurant, readDb } from "../fallback-runtime.js";
import { creditDriverEarningsRuntime } from "../driver-earnings.js";
import { config } from "../config.js";
import { cancelMarketplaceOrderAndRefund } from "../marketplace-refund-repository.js";
import { recordPostgresAudit } from "../operations-repository.js";
import {
  assignPostgresOrderDriver,
  createPostgresOrder,
  getPostgresCart,
  getPostgresFoodCheckoutQuote,
  getPostgresFoodDeliveryQuote,
  getPostgresOrders,
  processPostgresOrderMarketplacePayment,
  reorderPostgresOrder,
  replacePostgresCart,
  setPostgresOrderStatus,
} from "../order-repository.js";
import { usesPostgresCommerce } from "../postgres.js";
import { validarHorarioProgramado } from "../scheduling.js";
import { publishRealtimeEvent } from "./realtime.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";
import { assessTransactionRisk, setRiskEntity } from "../risk-repository.js";
import { createId, createLocalNotification, getTimestamp, orderStatuses } from "../store.js";
import { cancelOrderAndRefundWallet } from "../wallet-repository.js";

const orderSchema = z.object({
  customerId: z.string().min(1),
  restaurantId: z.string().min(1),
  deliveryAddressId: z.string().uuid().optional(),
  branchId: z.string().min(3).max(100).optional(),
  deliveryAddress: z.string().min(3),
  paymentMethod: z.string().min(2),
  paymentMethodId: z.string().uuid().optional(),
  promotionCode: z.string().trim().min(3).max(40).optional(),
  quoteToken: z.string().min(20).optional(),
  // Propina tomada en el checkout (GTM-001). En centavos y entera: un `number`
  // en pesos con decimales llega redondeado distinto según el cliente, y esto es
  // dinero. Los topes reales los aplica el repositorio contra el total del
  // pedido, que acá todavía no se conoce.
  tipCents: z.coerce.number().int().min(0).max(10000000).default(0),
  // Reserva de horario (GTM-001). La portada prometía «Programar - Food o taxi»
  // desde antes de que existiera la mitad de comida de esa promesa: sólo los
  // viajes sabían reservar. La ventana la valida `scheduling.js`, que es la
  // misma que usa el alta de viajes.
  scheduledFor: z.string().datetime().optional(),
  providerPayment: z
    .object({
      cardToken: z
        .string()
        .regex(/^[A-Za-z0-9._-]{8,256}$/)
        .refine(
          (value) => !/^\d{13,19}$/.test(value),
          "Debes enviar un token del proveedor, no el número de tarjeta",
        ),
      paymentMethodId: z.string().regex(/^[A-Za-z0-9_-]{2,64}$/),
      installments: z.coerce.number().int().min(1).max(48).default(1),
    })
    .optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        quantity: z.coerce.number().int().min(1).max(30),
        extras: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
        note: z.string().trim().max(500).default(""),
      }),
    )
    .min(1),
});
const foodOrderQuoteSchema = z.object({
  customerId: z.string().min(1),
  restaurantId: z.string().min(1),
  deliveryAddressId: z.string().uuid(),
  branchId: z.string().min(3).max(100).optional(),
  paymentMethod: z.string().min(2).optional(),
  paymentMethodId: z.string().uuid().optional(),
  promotionCode: z.string().trim().min(3).max(40).optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        quantity: z.coerce.number().int().min(1).max(30),
        extras: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
        note: z.string().trim().max(500).default(""),
      }),
    )
    .min(1)
    .max(50)
    .optional(),
});
const cartSchema = z.object({
  restaurantId: z.string().min(1).optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        quantity: z.coerce.number().int().min(1).max(99),
        extras: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
        note: z.string().trim().max(500).default(""),
      }),
    )
    .max(99),
});
const orderLabels = {
  accepted: "Aceptado",
  preparing: "Preparando",
  ready_for_pickup: "Listo para retirar",
  courier_assigned: "Repartidor asignado",
  picked_up: "Retirado",
  delivering: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado",
};
function calculateOrderTotals(restaurant, items) {
  let subtotal = 0;
  const expandedItems = items.map((entry) => {
    const menuItem = restaurant.menu.find((item) => item.id === entry.menuItemId);
    if (!menuItem || !menuItem.stock) {
      throw new Error(`Producto no disponible: ${entry.menuItemId}`);
    }
    const quantity = Math.max(1, Number(entry.quantity || 1));
    const extras = Array.isArray(entry.extras) ? entry.extras : [];
    const extrasTotal = extras.reduce((sum, extraIdOrName) => {
      const extra = restaurant.extras.find(
        (item) => item.id === extraIdOrName || item.name === extraIdOrName,
      );
      return sum + (extra?.price || 0);
    }, 0);
    subtotal += (menuItem.price + extrasTotal) * quantity;
    return {
      menuItemId: menuItem.id,
      name: menuItem.name,
      quantity,
      unitPrice: menuItem.price,
      extras: extras.map((extraIdOrName) => {
        const extra = restaurant.extras.find(
          (item) => item.id === extraIdOrName || item.name === extraIdOrName,
        );
        return extra?.name || extraIdOrName;
      }),
      note: String(entry.note || ""),
    };
  });

  return {
    items: expandedItems,
    subtotal,
    deliveryFee: restaurant.deliveryFee,
    serviceFee,
    total: subtotal + restaurant.deliveryFee + serviceFee,
  };
}
function nextOrderStatus(order) {
  if (order.status === "accepted") return "preparing";
  if (order.status === "preparing") return "ready_for_pickup";
  if (order.status === "courier_assigned") return "picked_up";
  if (order.status === "picked_up") return "delivering";
  if (order.status === "delivering") return "delivered";
  return null;
}

// La tarifa de servicio del respaldo SQLite es fija: el runtime local no
// versiona planes tarifarios, y 520 centavos es el valor sembrado.
const serviceFee = 520;
const jwtSecret = config.jwtSecret;

export const orderRouter = Router();
const router = orderRouter;

router.get("/api/cart", requireAuth, requireAnyRole("customer", "admin"), async (req, res) => {
  if (!usesPostgresCommerce()) return ok(res, { cart: [] });
  return ok(res, { cart: await getPostgresCart(req.auth.userId) });
});

router.put("/api/cart", requireAuth, requireAnyRole("customer", "admin"), async (req, res) => {
  // El GET de al lado devuelve un carrito vacío sobre el fallback; este PUT no
  // tenía la guarda equivalente e iba directo a PostgreSQL. Sobre SQLite eso
  // reventaba con un TypeError, así que se podía leer un carrito vacío pero no
  // agregarle nada: el flujo de pedir comida quedaba muerto en el runtime que
  // corre el job local-fallback de CI y la máquina de cualquier desarrollador.
  //
  // Degradar explícito es lo que hacen las otras 136 rutas que dependen de
  // PostgreSQL. Un 503 que dice por qué es honesto; un 500 con un TypeError no.
  if (!usesPostgresCommerce()) return fail(res, 503, "El carrito persistente requiere PostgreSQL");
  const parsed = parseOrFail(cartSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    const cart = await replacePostgresCart(
      req.auth.userId,
      parsed.data.restaurantId,
      parsed.data.items,
    );
    return ok(res, { cart });
  } catch (error) {
    return failFrom(res, error, "No se pudo guardar el carrito");
  }
});

router.post(
  "/api/orders/:orderId/reorder",
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return fail(res, 503, "La recompra requiere PostgreSQL");
    try {
      const result = await reorderPostgresOrder({
        customerPublicId: req.auth.userId,
        orderPublicId: req.params.orderId,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "order.reordered_to_cart",
        entityType: "order",
        entityId: req.params.orderId,
        requestId: req.requestId,
        afterData: {
          restaurantId: result.restaurantId,
          lineCount: result.cart.length,
        },
      });
      return ok(res, result);
    } catch (error) {
      return failFrom(res, error, "No se pudo reconstruir el carrito");
    }
  },
);

router.post(
  "/api/orders/quote",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    if (!usesPostgresCommerce())
      return fail(res, 503, "La cotización geográfica requiere PostgreSQL");
    const parsed = parseOrFail(foodOrderQuoteSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    if (!canActAsCustomer(req, parsed.data.customerId))
      return fail(res, 403, "No puedes cotizar para otro cliente");
    try {
      const calculated = parsed.data.items
        ? await getPostgresFoodCheckoutQuote({
            customerPublicId: parsed.data.customerId,
            merchantPublicId: parsed.data.restaurantId,
            deliveryAddressId: parsed.data.deliveryAddressId,
            branchPublicId: parsed.data.branchId,
            items: parsed.data.items,
            paymentMethod: parsed.data.paymentMethod || "Flash Wallet",
            paymentMethodId: parsed.data.paymentMethodId,
            promotionCode: parsed.data.promotionCode,
          })
        : await getPostgresFoodDeliveryQuote({
            customerPublicId: parsed.data.customerId,
            merchantPublicId: parsed.data.restaurantId,
            deliveryAddressId: parsed.data.deliveryAddressId,
            branchPublicId: parsed.data.branchId,
          });
      const quoteId = createId("QUOTE"),
        expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const quoteToken = jwt.sign({ kind: "food_quote", quoteId, ...calculated }, jwtSecret, {
        expiresIn: "5m",
      });
      return ok(res, {
        quote: { ...calculated, quoteId, quoteToken, expiresAt },
      });
    } catch (error) {
      return failFrom(res, error, "No se pudo cotizar la entrega");
    }
  },
);

router.post("/api/orders", requireAuth, requireAnyRole("customer", "admin"), async (req, res) => {
  const parsed = parseOrFail(orderSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const {
    customerId,
    restaurantId,
    items,
    deliveryAddressId,
    deliveryAddress,
    paymentMethod,
    paymentMethodId,
    providerPayment,
    promotionCode,
    quoteToken,
    tipCents,
    scheduledFor,
  } = parsed.data;
  if (scheduledFor) {
    const invalido = validarHorarioProgramado(scheduledFor);
    if (invalido) return fail(res, 400, invalido);
  }
  const idempotencyKey = req.get("idempotency-key");
  if (
    usesPostgresCommerce() &&
    (!idempotencyKey || !/^[a-zA-Z0-9._:-]{16,128}$/.test(idempotencyKey))
  ) {
    return fail(res, 400, "Idempotency-Key válido es obligatorio para crear pedidos");
  }
  const db = usesPostgresCommerce() ? {} : readDb();
  const customer = usesPostgresAuth()
    ? await findAuthUserByPublicId(customerId)
    : db.users.find((user) => user.id === customerId);
  if (!customer) return fail(res, 404, "Cliente no encontrado");
  if (!canActAsCustomer(req, customerId))
    return fail(res, 403, "No puedes crear pedidos para otro cliente");
  let lockedQuote = null;
  if (usesPostgresCommerce()) {
    if (!quoteToken) return fail(res, 400, "Debes cotizar la entrega antes de confirmar el pedido");
    try {
      lockedQuote = jwt.verify(quoteToken, jwtSecret);
      if (
        lockedQuote.kind !== "food_quote" ||
        lockedQuote.customerId !== customerId ||
        lockedQuote.restaurantId !== restaurantId ||
        lockedQuote.deliveryAddressId !== deliveryAddressId
      )
        return fail(res, 409, "La cotización no corresponde a este pedido");
    } catch (_error) {
      return fail(res, 409, "La cotización venció; actualiza el precio antes de confirmar");
    }
  }
  const restaurant = usesPostgresCommerce()
    ? (await getPostgresRestaurants()).find((entry) => entry.id === restaurantId)
    : findRestaurant(db, restaurantId);
  if (!restaurant || !restaurant.open) return fail(res, 404, "Restaurante no disponible");
  if (!Array.isArray(items) || items.length === 0)
    return fail(res, 400, "Agrega productos al pedido");

  let totals;
  try {
    totals = calculateOrderTotals(restaurant, items);
  } catch (error) {
    return fail(res, 400, error.message);
  }
  let riskAssessment = null;
  if (usesPostgresCommerce()) {
    try {
      riskAssessment = await assessTransactionRisk({
        customerPublicId: customerId,
        service: "food",
        amount: lockedQuote?.total ?? totals.total,
        requestId: req.requestId,
        idempotencyKey,
      });
      if (riskAssessment.decision === "block") {
        await recordPostgresAudit({
          actorPublicId: req.auth.userId,
          roles: req.auth.roles,
          action: "risk.transaction_blocked",
          entityType: "risk_assessment",
          entityId: riskAssessment.id,
          requestId: req.requestId,
          afterData: { service: "food", score: riskAssessment.score },
        });
        return fail(
          res,
          403,
          "La operación requiere verificación de seguridad. Contactá a soporte.",
        );
      }
    } catch (error) {
      return failFrom(res, error, "No se pudo verificar el riesgo de la operación");
    }
  }

  const status = "accepted";
  const createdAt = getTimestamp();
  let order = {
    id: createId("ORD"),
    customerId,
    restaurantId,
    courierId: null,
    status,
    deliveryAddress: String(deliveryAddress || customer.defaultAddress || ""),
    paymentMethod: String(paymentMethod || "Flash Wallet"),
    ...totals,
    etaMin: restaurant.etaMin + 8,
    createdAt,
    timeline: [{ status, at: createdAt }],
  };
  if (usesPostgresCommerce()) {
    try {
      order = await createPostgresOrder({
        publicId: order.id,
        customerPublicId: customerId,
        merchantPublicId: restaurantId,
        deliveryAddressId,
        deliveryAddress: order.deliveryAddress,
        paymentMethod: order.paymentMethod,
        paymentMethodId,
        providerPayment,
        promotionCode,
        items,
        serviceFee: lockedQuote?.serviceFee ?? serviceFee,
        lockedQuote,
        tipCents,
        scheduledFor: scheduledFor || null,
        idempotencyKey,
      });
      if (providerPayment && !String(order.paymentMethod).toLowerCase().includes("wallet"))
        order = await processPostgresOrderMarketplacePayment({
          orderPublicId: order.id,
          customerPublicId: customerId,
          idempotencyKey,
          cardToken: providerPayment.cardToken,
          paymentMethodId: providerPayment.paymentMethodId,
          installments: providerPayment.installments,
        });
      if (riskAssessment)
        await setRiskEntity({
          assessmentPublicId: riskAssessment.id,
          entityPublicId: order.id,
        });
    } catch (error) {
      return failFrom(res, error, "No se pudo crear el pedido");
    }
  } else {
    db.orders.unshift(order);
  }
  await auditRuntime(db, req, "order", order.id, "order.created", {
    restaurantId,
    total: order.total,
    itemCount: order.items.length,
  });
  if (!usesPostgresCommerce())
    createLocalNotification({
      userId: order.customerId,
      template: "order_status",
      payload: { orderId: order.id, status: order.status, etaMin: order.etaMin },
    });
  await publishRealtimeEvent({
    req,
    type: "order.created",
    entityType: "order",
    entityId: order.id,
    action: "order.created",
  });
  return ok(res, { order, label: orderLabels[status] });
});

router.post(
  "/api/orders/:orderId/accept-delivery",
  requireAuth,
  requireAnyRole("driver", "admin"),
  async (req, res) => {
    const { driverId } = req.body || {};
    const db = usesPostgresCommerce() ? {} : readDb();
    let order = usesPostgresCommerce()
      ? (await getPostgresOrders()).find((entry) => entry.id === req.params.orderId)
      : db.orders.find((entry) => entry.id === req.params.orderId);
    const driver = usesPostgresCommerce()
      ? (await getPostgresDrivers()).find((entry) => entry.id === driverId)
      : db.drivers.find((entry) => entry.id === driverId);
    if (!order) return fail(res, 404, "Pedido no encontrado");
    if (!canActAsDriver(req, driverId))
      return fail(res, 403, "No puedes aceptar pedidos con otro conductor");
    if (!driver || !driver.online || !driver.serviceModes.includes("delivery")) {
      return fail(res, 409, "Repartidor no disponible");
    }
    if (order.courierId) return fail(res, 409, "El pedido ya tiene repartidor");
    if (order.status !== "ready_for_pickup")
      return fail(res, 409, "El comercio todavía no marcó el pedido como listo");
    if (["delivered", "cancelled"].includes(order.status)) {
      return fail(res, 409, "El pedido ya no esta disponible");
    }
    if (usesPostgresCommerce()) {
      try {
        order = await assignPostgresOrderDriver(order.id, driverId, req.auth.userId);
      } catch (error) {
        return failFrom(res, error, "No se pudo asignar el repartidor");
      }
    } else {
      order.courierId = driverId;
      Object.assign(order, addTimeline(order, "courier_assigned"));
    }
    await auditRuntime(db, req, "order", order.id, "order.delivery_accepted", {
      driverId,
    });
    await publishRealtimeEvent({
      req,
      type: "order.updated",
      entityType: "order",
      entityId: order.id,
      action: "order.delivery_accepted",
    });
    return ok(res, { order, label: orderLabels[order.status] });
  },
);

router.post(
  "/api/orders/:orderId/advance",
  requireAuth,
  requireAnyRole("merchant", "driver", "admin"),
  async (req, res) => {
    const db = usesPostgresCommerce() ? {} : readDb();
    if (usesPostgresCommerce())
      [db.orders, db.drivers, db.restaurants] = await Promise.all([
        getPostgresOrders(),
        getPostgresDrivers(),
        getPostgresRestaurants(),
      ]);
    const index = db.orders.findIndex((entry) => entry.id === req.params.orderId);
    if (index < 0) return fail(res, 404, "Pedido no encontrado");
    const next = nextOrderStatus(db.orders[index]);
    if (!next) return fail(res, 409, "El pedido no puede avanzar desde este estado");
    if (
      !canAdvanceOrder(req, {
        order: db.orders[index],
        restaurant: findRestaurant(db, db.orders[index].restaurantId),
        nextStatus: next,
      })
    )
      return fail(res, 403, "Esta etapa corresponde a otro participante del pedido");
    db.orders[index] = usesPostgresCommerce()
      ? await setPostgresOrderStatus(db.orders[index].id, next, req.auth.userId)
      : addTimeline(db.orders[index], next);
    if (next === "delivered") {
      db.orders[index].etaMin = 0;
      if (!usesPostgresCommerce())
        await creditDriverEarningsRuntime(
          db,
          db.orders[index].courierId,
          db.orders[index].deliveryFee,
          `delivery-${db.orders[index].id}`,
        );
    }
    await auditRuntime(db, req, "order", db.orders[index].id, "order.status_advanced", {
      status: next,
    });
    if (!usesPostgresCommerce())
      createLocalNotification({
        userId: db.orders[index].customerId,
        template: "order_status",
        payload: { orderId: db.orders[index].id, status: next, etaMin: db.orders[index].etaMin },
      });
    await publishRealtimeEvent({
      req,
      type: "order.updated",
      entityType: "order",
      entityId: db.orders[index].id,
      action: "order.status_advanced",
    });
    return ok(res, { order: db.orders[index], label: orderLabels[next] });
  },
);

router.patch("/api/orders/:orderId/status", requireAuth, async (req, res) => {
  const { status } = req.body || {};
  if (!orderStatuses.includes(status)) return fail(res, 400, "Estado de pedido invalido");
  const cancellation =
    status === "cancelled" ? parseOrFail(cancellationSchema, req.body || {}) : null;
  if (cancellation && !cancellation.ok) return fail(res, 400, cancellation.message);
  const db = usesPostgresCommerce() ? {} : readDb();
  if (usesPostgresCommerce())
    [db.orders, db.restaurants] = await Promise.all([
      getPostgresOrders(),
      getPostgresRestaurants(),
    ]);
  const index = db.orders.findIndex((entry) => entry.id === req.params.orderId);
  if (index < 0) return fail(res, 404, "Pedido no encontrado");
  if (
    !canMutateOrderStatus(req, {
      order: db.orders[index],
      restaurant: findRestaurant(db, db.orders[index].restaurantId),
      status,
    })
  ) {
    return fail(res, 403, "No puedes cambiar este estado de pedido");
  }
  if (usesPostgresCommerce() && status === "cancelled") {
    const cancellationResult =
      (await cancelMarketplaceOrderAndRefund({
        orderPublicId: db.orders[index].id,
        actorPublicId: req.auth.userId,
        reason: cancellation.data.reason,
        reasonDetail: cancellation.data.reasonDetail,
      })) ||
      (await cancelOrderAndRefundWallet({
        orderPublicId: db.orders[index].id,
        actorPublicId: req.auth.userId,
        reason: cancellation.data.reason,
        reasonDetail: cancellation.data.reasonDetail,
      }));
    db.orders[index] = (await getPostgresOrders()).find(
      (entry) => entry.id === db.orders[index].id,
    );
    db.orders[index].cancellation = cancellationResult;
  } else
    db.orders[index] = usesPostgresCommerce()
      ? await setPostgresOrderStatus(db.orders[index].id, status, req.auth.userId)
      : addTimeline(db.orders[index], status);
  await auditRuntime(db, req, "order", db.orders[index].id, "order.status_set", { status });
  await publishRealtimeEvent({
    req,
    type: "order.updated",
    entityType: "order",
    entityId: db.orders[index].id,
    action: "order.status_set",
  });
  return ok(res, { order: db.orders[index], label: orderLabels[status] });
});
