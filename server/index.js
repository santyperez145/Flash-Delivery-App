import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import bcrypt from "bcryptjs";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "./config.js";
import {
  createId,
  getPublicState,
  getDatabasePath,
  getTimestamp,
  orderStatuses,
  readDb,
  resetDb,
  rideStatuses,
  writeDb
} from "./store.js";

const app = express();
const serviceFee = 520;
const jwtSecret = config.jwtSecret;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, "..", "dist");
const realtimeClients = new Set();

app.disable("x-powered-by");
app.set("trust proxy", config.isProduction ? 1 : false);

const ok = (res, payload = {}) => res.json({ ok: true, requestId: res.locals.requestId, ...payload });
const fail = (res, status, message) => res.status(status).json({ ok: false, requestId: res.locals.requestId, message });
const parseOrFail = (schema, payload) => {
  const result = schema.safeParse(payload);
  if (!result.success) {
    return {
      ok: false,
      message: result.error.issues.map((issue) => issue.message).join(", ")
    };
  }
  return { ok: true, data: result.data };
};

function requestContext(req, res, next) {
  const headerId = Array.isArray(req.headers["x-request-id"])
    ? req.headers["x-request-id"][0]
    : req.headers["x-request-id"];
  const requestId =
    typeof headerId === "string" && /^[a-zA-Z0-9._:-]{8,128}$/.test(headerId)
      ? headerId
      : createId("REQ");
  req.requestId = requestId;
  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}

function requestLogger(req, res, next) {
  if (config.logLevel === "silent") return next();
  const start = Date.now();
  res.on("finish", () => {
    console.log(
      JSON.stringify({
        level: res.statusCode >= 500 ? "error" : "info",
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - start
      })
    );
  });
  return next();
}

function writeSseEvent(client, event, data) {
  if (client.destroyed || client.writableEnded) return false;
  client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  return true;
}

function publishRealtimeEvent({ req, type, entityType = null, entityId = null, action = null }) {
  const payload = {
    id: createId("EVT"),
    type,
    entityType,
    entityId,
    action,
    requestId: req?.requestId || null,
    at: getTimestamp()
  };
  for (const client of realtimeClients) {
    if (!writeSseEvent(client, "state.updated", payload)) realtimeClients.delete(client);
  }
}

function corsOrigin(origin, callback) {
  if (!origin || config.corsOrigins.includes("*") || config.corsOrigins.includes(origin)) {
    return callback(null, true);
  }
  const error = new Error("Origen no permitido por CORS");
  error.status = 403;
  return callback(error);
}

function createLimiter({ max, message }) {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: max,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) => ["/health", "/ready"].includes(req.path),
    handler: (_req, res) => fail(res, 429, message)
  });
}

app.use(requestContext);
app.use(requestLogger);
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: config.isProduction ? undefined : false
  })
);
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(
  "/api",
  createLimiter({
    max: config.rateLimit.max,
    message: "Demasiadas solicitudes. Intenta nuevamente en unos segundos."
  })
);
app.use(
  "/api/auth",
  createLimiter({
    max: config.rateLimit.authMax,
    message: "Demasiados intentos de autenticacion. Intenta mas tarde."
  })
);
app.use(express.json({ limit: "1mb" }));

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}

function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return fail(res, 401, "Token requerido");
  try {
    const payload = jwt.verify(token, jwtSecret);
    const db = readDb();
    const user = db.users.find((entry) => entry.id === payload.sub);
    if (!user) return fail(res, 401, "Usuario no existe");
    req.auth = {
      userId: user.id,
      roles: Array.isArray(user.roles) ? user.roles : [],
      user
    };
    return next();
  } catch (_error) {
    return fail(res, 401, "Token invalido o expirado");
  }
}

function hasRole(req, role) {
  return Boolean(req.auth?.roles?.includes(role));
}

function isAdmin(req) {
  return hasRole(req, "admin");
}

const requireAnyRole = (...roles) => (req, res, next) => {
  if (!req.auth) return fail(res, 401, "Token requerido");
  if (!roles.some((role) => hasRole(req, role))) {
    return fail(res, 403, "No tienes permisos para esta accion");
  }
  return next();
};

function canActAsCustomer(req, customerId) {
  return isAdmin(req) || (hasRole(req, "customer") && req.auth.userId === customerId);
}

function canActAsDriver(req, driverId) {
  return isAdmin(req) || (hasRole(req, "driver") && req.auth.user.driverId === driverId);
}

function canManageRestaurant(req, restaurant) {
  return isAdmin(req) || (hasRole(req, "merchant") && restaurant.ownerId === req.auth.userId);
}

function canAdvanceOrder(req, db, order) {
  const restaurant = findRestaurant(db, order.restaurantId);
  return (
    isAdmin(req) ||
    (restaurant && canManageRestaurant(req, restaurant)) ||
    (order.courierId && canActAsDriver(req, order.courierId))
  );
}

function canMutateOrderStatus(req, db, order, status) {
  if (isAdmin(req)) return true;
  if (status !== "cancelled") return false;
  const restaurant = findRestaurant(db, order.restaurantId);
  return (
    canActAsCustomer(req, order.customerId) ||
    (restaurant && canManageRestaurant(req, restaurant)) ||
    (order.courierId && canActAsDriver(req, order.courierId))
  );
}

function canAdvanceRide(req, ride) {
  return isAdmin(req) || (ride.driverId && canActAsDriver(req, ride.driverId));
}

function canMutateRideStatus(req, ride, status) {
  if (isAdmin(req)) return true;
  if (status !== "cancelled") return false;
  return canActAsCustomer(req, ride.customerId) || (ride.driverId && canActAsDriver(req, ride.driverId));
}

function audit(db, req, entityType, entityId, action, payload = {}) {
  const event = {
    id: createId("AUD"),
    actorId: req.auth?.userId || "system",
    entityType,
    entityId,
    action,
    payload,
    createdAt: getTimestamp()
  };
  db.auditEvents = [event, ...(db.auditEvents || [])].slice(0, 500);
}

const loginSchema = z.object({
  email: z.string().email("Email invalido"),
  password: z.string().min(4, "Password demasiado corto")
});

const registerSchema = z.object({
  name: z.string().min(2, "Nombre obligatorio"),
  email: z.string().email("Email invalido"),
  password: z.string().min(6, "Password minimo 6 caracteres"),
  phone: z.string().optional()
});

const coordinateSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180)
});

const orderSchema = z.object({
  customerId: z.string().min(1),
  restaurantId: z.string().min(1),
  deliveryAddress: z.string().min(3),
  paymentMethod: z.string().min(2),
  items: z.array(
    z.object({
      menuItemId: z.string().min(1),
      quantity: z.coerce.number().int().min(1).max(30),
      extras: z.array(z.string()).default([]),
      note: z.string().default("")
    })
  ).min(1)
});

const rideQuoteSchema = z.object({
  pickup: z.string().min(3, "Origen obligatorio"),
  destination: z.string().min(3, "Destino obligatorio"),
  service: z.enum(["economy", "comfort", "moto", "xl"]).default("economy"),
  pickupCoords: coordinateSchema.nullable().optional(),
  destinationCoords: coordinateSchema.nullable().optional()
});

const rideCreateSchema = rideQuoteSchema.extend({
  customerId: z.string().min(1),
  paymentMethod: z.string().min(2)
});

const driverLocationSchema = coordinateSchema.extend({
  label: z.string().trim().min(2).max(120).optional()
});

const orderLabels = {
  accepted: "Aceptado",
  preparing: "Preparando",
  ready_for_pickup: "Listo para retirar",
  courier_assigned: "Repartidor asignado",
  picked_up: "Retirado",
  delivering: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado"
};

const rideLabels = {
  requested: "Buscando conductor",
  driver_assigned: "Conductor asignado",
  arriving: "Llegando al punto",
  in_progress: "Viaje iniciado",
  completed: "Completado",
  cancelled: "Cancelado"
};

function publicUser(db, userId) {
  const user = db.users.find((entry) => entry.id === userId);
  if (!user) return null;
  const { password, ...safeUser } = user;
  return safeUser;
}

function findRestaurant(db, restaurantId) {
  return db.restaurants.find((restaurant) => restaurant.id === restaurantId);
}

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
        (item) => item.id === extraIdOrName || item.name === extraIdOrName
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
          (item) => item.id === extraIdOrName || item.name === extraIdOrName
        );
        return extra?.name || extraIdOrName;
      }),
      note: String(entry.note || "")
    };
  });

  return {
    items: expandedItems,
    subtotal,
    deliveryFee: restaurant.deliveryFee,
    serviceFee,
    total: subtotal + restaurant.deliveryFee + serviceFee
  };
}

function distanceBetween(first, second) {
  if (!first || !second) return null;
  const earthRadiusKm = 6371;
  const latDelta = ((second.lat - first.lat) * Math.PI) / 180;
  const lngDelta = ((second.lng - first.lng) * Math.PI) / 180;
  const firstLat = (first.lat * Math.PI) / 180;
  const secondLat = (second.lat * Math.PI) / 180;
  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.sin(lngDelta / 2) ** 2 * Math.cos(firstLat) * Math.cos(secondLat);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function calculateRideQuote({ pickup, destination, service = "economy", pickupCoords, destinationCoords }) {
  const normalizedService = ["economy", "comfort", "moto", "xl"].includes(service)
    ? service
    : "economy";
  const serviceMultiplier = {
    moto: 0.78,
    economy: 1,
    comfort: 1.28,
    xl: 1.65
  }[normalizedService];
  const textWeight = `${pickup || ""}${destination || ""}`.length;
  const coordinateDistance = distanceBetween(pickupCoords, destinationCoords);
  const distanceKm = coordinateDistance !== null
    ? Math.max(1.2, Math.min(50, coordinateDistance * 1.22))
    : Math.max(2.4, Math.min(28, 2.2 + (textWeight % 19) * 0.72));
  const demandMultiplier = distanceKm > 12 ? 1.18 : 1.04;
  const fare = Math.round((1450 + distanceKm * 620) * serviceMultiplier * demandMultiplier);
  return {
    service: normalizedService,
    distanceKm: Number(distanceKm.toFixed(1)),
    etaMin: Math.max(3, Math.round(4 + distanceKm * 0.55)),
    durationMin: Math.round(8 + distanceKm * 2.1),
    fare,
    estimated: coordinateDistance === null,
    routingMode: coordinateDistance === null ? "text-estimate" : "coordinates"
  };
}

function assignRideDriver(db, ride) {
  const candidates = db.drivers
    .filter(
      (entry) =>
        entry.online &&
        entry.serviceModes.includes("ride") &&
        !db.rides.some(
          (candidate) =>
            candidate.driverId === entry.id &&
            !["completed", "cancelled"].includes(candidate.status)
        )
    )
    .map((driver) => ({
      driver,
      distance: distanceBetween(driver.location, ride.pickupLocation) ?? Number.MAX_SAFE_INTEGER
    }))
    .sort((left, right) => left.distance - right.distance);
  const driver = candidates[0]?.driver;
  if (!driver) return ride;
  return {
    ...ride,
    driverId: driver.id,
    status: "driver_assigned",
    timeline: [
      ...ride.timeline,
      { status: "driver_assigned", at: getTimestamp() }
    ]
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

function nextRideStatus(ride) {
  if (ride.status === "driver_assigned") return "arriving";
  if (ride.status === "arriving") return "in_progress";
  if (ride.status === "in_progress") return "completed";
  return null;
}

function addTimeline(entity, status) {
  return {
    ...entity,
    status,
    timeline: [
      ...(entity.timeline || []),
      {
        status,
        at: getTimestamp()
      }
    ]
  };
}

function metrics(db) {
  const activeOrderStatuses = [
    "accepted",
    "preparing",
    "ready_for_pickup",
    "courier_assigned",
    "picked_up",
    "delivering"
  ];
  const activeRideStatuses = ["requested", "driver_assigned", "arriving", "in_progress"];
  const activeOrders = db.orders.filter((order) => activeOrderStatuses.includes(order.status));
  const activeRides = db.rides.filter((ride) => activeRideStatuses.includes(ride.status));
  const completedRevenue = [
    ...db.orders.filter((order) => order.status === "delivered").map((order) => order.total),
    ...db.rides.filter((ride) => ride.status === "completed").map((ride) => ride.fare)
  ].reduce((sum, value) => sum + value, 0);
  const openTickets = db.supportTickets.filter((ticket) => ticket.status === "open").length;
  return {
    activeOrders: activeOrders.length,
    activeRides: activeRides.length,
    onlineDrivers: db.drivers.filter((driver) => driver.online).length,
    openRestaurants: db.restaurants.filter((restaurant) => restaurant.open).length,
    completedRevenue,
    openTickets,
    avgOrderEta: activeOrders.length
      ? Math.round(activeOrders.reduce((sum, order) => sum + order.etaMin, 0) / activeOrders.length)
      : 0,
    avgRideEta: activeRides.length
      ? Math.round(activeRides.reduce((sum, ride) => sum + ride.etaMin, 0) / activeRides.length)
      : 0
  };
}

function ratio(part, total) {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(1));
}

function average(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function adminSnapshot(db) {
  const activeOrders = db.orders.filter((order) => !["delivered", "cancelled"].includes(order.status));
  const activeRides = db.rides.filter((ride) => !["completed", "cancelled"].includes(ride.status));
  const grossVolume = [
    ...db.orders.map((order) => order.total),
    ...db.rides.map((ride) => ride.fare)
  ].reduce((sum, value) => sum + value, 0);
  const completedJobs =
    db.orders.filter((order) => order.status === "delivered").length +
    db.rides.filter((ride) => ride.status === "completed").length;
  const cancelledJobs =
    db.orders.filter((order) => order.status === "cancelled").length +
    db.rides.filter((ride) => ride.status === "cancelled").length;
  const totalJobs = db.orders.length + db.rides.length;
  const unassignedOrders = activeOrders.filter((order) => !order.courierId).length;
  const unassignedRides = activeRides.filter((ride) => !ride.driverId).length;
  const estimatedPlatformRevenue = Math.round(grossVolume * 0.18);
  const incentiveBudget = Math.round(grossVolume * 0.055);
  const supportCost = db.supportTickets.filter((ticket) => ticket.status === "open").length * 450;
  const dispatchCost = activeOrders.length * 260 + activeRides.length * 320;
  const contributionMargin = Math.max(0, estimatedPlatformRevenue - incentiveBudget - supportCost - dispatchCost);
  const monthlyBurn = 12500000;
  const seedTarget = 240000000;
  const netRevenueRunRate = estimatedPlatformRevenue * 30;
  return {
    generatedAt: getTimestamp(),
    metrics: metrics(db),
    marketplace: {
      grossVolume,
      estimatedPlatformRevenue,
      takeRatePercent: 18,
      averageOrderValue: average(db.orders.map((order) => order.total)),
      averageRideFare: average(db.rides.map((ride) => ride.fare)),
      fillRateDelivery: ratio(db.orders.filter((order) => order.courierId).length, db.orders.length),
      fillRateRide: ratio(db.rides.filter((ride) => ride.driverId).length, db.rides.length),
      cancellationRate: ratio(cancelledJobs, totalJobs),
      supplyDemandRatio: Number((db.drivers.filter((driver) => driver.online).length / Math.max(1, activeOrders.length + activeRides.length)).toFixed(2)),
      unassignedOrders,
      unassignedRides,
      openRestaurants: db.restaurants.filter((restaurant) => restaurant.open).length,
      onlineDrivers: db.drivers.filter((driver) => driver.online).length
    },
    investor: {
      seedTarget,
      monthlyBurn,
      runwayMonths: Math.round(seedTarget / monthlyBurn),
      netRevenueRunRate,
      contributionMargin,
      contributionMarginPercent: ratio(contributionMargin, estimatedPlatformRevenue || 1),
      readinessScore: Math.min(
        100,
        Math.round(
          42 +
            ratio(completedJobs, totalJobs) * 0.18 +
            ratio(db.orders.filter((order) => order.courierId).length, db.orders.length) * 0.16 +
            ratio(db.rides.filter((ride) => ride.driverId).length, db.rides.length) * 0.16
        )
      ),
      milestones: [
        { label: "Producto fullstack", status: "done", value: "Cliente, comercio, driver y admin" },
        { label: "Seguridad API", status: "done", value: "JWT, RBAC, ownership, rate limits" },
        { label: "Mobile nativo", status: "in_progress", value: "Expo base para 3 apps" },
        { label: "Realtime dispatch", status: "next", value: "SSE/WebSocket + Redis GEO" },
        { label: "Pagos reales", status: "next", value: "PSP + ledger financiero" }
      ],
      unitEconomics: [
        { label: "AOV comida", value: `$${average(db.orders.map((order) => order.total))}`, detail: "Ticket promedio" },
        { label: "Fare taxi", value: `$${average(db.rides.map((ride) => ride.fare))}`, detail: "Tarifa promedio" },
        { label: "Take rate", value: "18%", detail: "Comision demo" },
        { label: "Incentivos", value: `${ratio(incentiveBudget, grossVolume || 1)}%`, detail: "Promo/supply budget" },
        { label: "Margen contrib.", value: `${ratio(contributionMargin, estimatedPlatformRevenue || 1)}%`, detail: "Despues de soporte/dispatch" },
        { label: "Jobs cumplidos", value: String(completedJobs), detail: "Pedidos + viajes finalizados" }
      ]
    },
    riskSignals: [
      {
        id: "dispatch_backlog",
        level: unassignedOrders + unassignedRides > 2 ? "medium" : "low",
        label: "Backlog de asignacion",
        value: unassignedOrders + unassignedRides
      },
      {
        id: "support_queue",
        level: db.supportTickets.filter((ticket) => ticket.status === "open").length > 5 ? "high" : "low",
        label: "Tickets abiertos",
        value: db.supportTickets.filter((ticket) => ticket.status === "open").length
      },
      {
        id: "supply",
        level: db.drivers.filter((driver) => driver.online).length < 2 ? "medium" : "low",
        label: "Supply online",
        value: db.drivers.filter((driver) => driver.online).length
      }
    ],
    zones: db.zones || [],
    recentAuditEvents: (db.auditEvents || []).slice(0, 10)
  };
}

app.get("/api/health", (_req, res) => {
  ok(res, {
    service: "flash-fullstack-api",
    environment: config.env,
    database: getDatabasePath(),
    timestamp: getTimestamp()
  });
});

app.get("/api/ready", (_req, res) => {
  try {
    const db = readDb();
    return ok(res, {
      service: "flash-fullstack-api",
      database: "ready",
      users: db.users.length,
      restaurants: db.restaurants.length,
      drivers: db.drivers.length,
      timestamp: getTimestamp()
    });
  } catch (_error) {
    return fail(res, 503, "Base de datos no disponible");
  }
});

app.get("/api/state", requireAuth, (_req, res) => {
  const state = getPublicState();
  ok(res, {
    state: {
      ...state,
      metrics: metrics(state)
    }
  });
});

app.get("/api/events", requireAuth, (req, res) => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  realtimeClients.add(res);
  writeSseEvent(res, "connected", {
    id: createId("EVT"),
    type: "connected",
    at: getTimestamp()
  });
  const heartbeat = setInterval(() => {
    if (!writeSseEvent(res, "heartbeat", { at: getTimestamp() })) {
      clearInterval(heartbeat);
      realtimeClients.delete(res);
    }
  }, 25000);
  req.on("close", () => {
    clearInterval(heartbeat);
    realtimeClients.delete(res);
  });
});

app.get("/api/metrics", requireAuth, requireAnyRole("admin"), (_req, res) => {
  ok(res, { metrics: metrics(readDb()) });
});

app.get("/api/admin/dashboard", requireAuth, requireAnyRole("admin"), (_req, res) => {
  const db = readDb();
  ok(res, { dashboard: adminSnapshot(db) });
});

app.post("/api/auth/login", (req, res) => {
  const parsed = parseOrFail(loginSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const { email, password } = parsed.data;
  const db = readDb();
  const user = db.users.find(
    (entry) => entry.email.toLowerCase() === String(email || "").trim().toLowerCase()
  );
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return fail(res, 401, "Credenciales invalidas");
  }
  return ok(res, {
    user: publicUser(db, user.id),
    token: jwt.sign({ sub: user.id, roles: user.roles }, jwtSecret, { expiresIn: "8h" })
  });
});

app.post("/api/auth/register", (req, res) => {
  const parsed = parseOrFail(registerSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const { name, email, password, phone } = parsed.data;
  const db = readDb();
  const exists = db.users.some(
    (entry) => entry.email.toLowerCase() === String(email).trim().toLowerCase()
  );
  if (exists) return fail(res, 409, "Ese email ya existe");
  const user = {
    id: createId("USR"),
    name: String(name),
    email: String(email).trim().toLowerCase(),
    password: bcrypt.hashSync(String(password), 10),
    roles: ["customer"],
    phone: String(phone || ""),
    wallet: 0,
    defaultAddress: ""
  };
  db.users.push(user);
  audit(db, { auth: { userId: user.id } }, "user", user.id, "user.registered", {
    email: user.email
  });
  writeDb(db);
  return ok(res, {
    user: publicUser(db, user.id),
    token: jwt.sign({ sub: user.id, roles: user.roles }, jwtSecret, { expiresIn: "8h" })
  });
});

app.get("/api/restaurants", (_req, res) => {
  ok(res, { restaurants: readDb().restaurants });
});

app.patch("/api/restaurants/:restaurantId", requireAuth, requireAnyRole("merchant", "admin"), (req, res) => {
  const db = readDb();
  const restaurant = findRestaurant(db, req.params.restaurantId);
  if (!restaurant) return fail(res, 404, "Restaurante no encontrado");
  if (!canManageRestaurant(req, restaurant)) return fail(res, 403, "No puedes gestionar este restaurante");
  const body = req.body || {};
  if (typeof body.open === "boolean") restaurant.open = body.open;
  if (typeof body.etaMin === "number") restaurant.etaMin = Math.max(5, body.etaMin);
  audit(db, req, "restaurant", restaurant.id, "restaurant.updated", {
    open: restaurant.open,
    etaMin: restaurant.etaMin
  });
  writeDb(db);
  publishRealtimeEvent({ req, type: "restaurant.updated", entityType: "restaurant", entityId: restaurant.id, action: "restaurant.updated" });
  return ok(res, { restaurant });
});

app.post("/api/restaurants/:restaurantId/menu", requireAuth, requireAnyRole("merchant", "admin"), (req, res) => {
  const db = readDb();
  const restaurant = findRestaurant(db, req.params.restaurantId);
  if (!restaurant) return fail(res, 404, "Restaurante no encontrado");
  if (!canManageRestaurant(req, restaurant)) return fail(res, 403, "No puedes gestionar este restaurante");
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
    tags: ["Nuevo"]
  };
  restaurant.menu.unshift(item);
  audit(db, req, "menu_item", item.id, "menu_item.created", {
    restaurantId: restaurant.id,
    price: item.price
  });
  writeDb(db);
  publishRealtimeEvent({ req, type: "restaurant.updated", entityType: "restaurant", entityId: restaurant.id, action: "menu_item.created" });
  return ok(res, { item, restaurant });
});

app.patch("/api/restaurants/:restaurantId/menu/:itemId", requireAuth, requireAnyRole("merchant", "admin"), (req, res) => {
  const db = readDb();
  const restaurant = findRestaurant(db, req.params.restaurantId);
  if (!restaurant) return fail(res, 404, "Restaurante no encontrado");
  if (!canManageRestaurant(req, restaurant)) return fail(res, 403, "No puedes gestionar este restaurante");
  const item = restaurant.menu.find((entry) => entry.id === req.params.itemId);
  if (!item) return fail(res, 404, "Producto no encontrado");
  const body = req.body || {};
  if (typeof body.stock === "boolean") item.stock = body.stock;
  if (typeof body.price === "number") item.price = Math.max(100, body.price);
  audit(db, req, "menu_item", item.id, "menu_item.updated", {
    restaurantId: restaurant.id,
    stock: item.stock,
    price: item.price
  });
  writeDb(db);
  publishRealtimeEvent({ req, type: "restaurant.updated", entityType: "restaurant", entityId: restaurant.id, action: "menu_item.updated" });
  return ok(res, { item, restaurant });
});

app.post("/api/orders", requireAuth, requireAnyRole("customer", "admin"), (req, res) => {
  const parsed = parseOrFail(orderSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const { customerId, restaurantId, items, deliveryAddress, paymentMethod } = parsed.data;
  const db = readDb();
  const customer = db.users.find((user) => user.id === customerId);
  if (!customer) return fail(res, 404, "Cliente no encontrado");
  if (!canActAsCustomer(req, customerId)) return fail(res, 403, "No puedes crear pedidos para otro cliente");
  const restaurant = findRestaurant(db, restaurantId);
  if (!restaurant || !restaurant.open) return fail(res, 404, "Restaurante no disponible");
  if (!Array.isArray(items) || items.length === 0) return fail(res, 400, "Agrega productos al pedido");

  let totals;
  try {
    totals = calculateOrderTotals(restaurant, items);
  } catch (error) {
    return fail(res, 400, error.message);
  }

  const status = "accepted";
  const createdAt = getTimestamp();
  const order = {
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
    timeline: [{ status, at: createdAt }]
  };
  db.orders.unshift(order);
  audit(db, req, "order", order.id, "order.created", {
    restaurantId,
    total: order.total,
    itemCount: order.items.length
  });
  writeDb(db);
  publishRealtimeEvent({ req, type: "order.created", entityType: "order", entityId: order.id, action: "order.created" });
  return ok(res, { order, label: orderLabels[status] });
});

app.post("/api/orders/:orderId/accept-delivery", requireAuth, requireAnyRole("driver", "admin"), (req, res) => {
  const { driverId } = req.body || {};
  const db = readDb();
  const order = db.orders.find((entry) => entry.id === req.params.orderId);
  const driver = db.drivers.find((entry) => entry.id === driverId);
  if (!order) return fail(res, 404, "Pedido no encontrado");
  if (!canActAsDriver(req, driverId)) return fail(res, 403, "No puedes aceptar pedidos con otro conductor");
  if (!driver || !driver.online || !driver.serviceModes.includes("delivery")) {
    return fail(res, 409, "Repartidor no disponible");
  }
  if (order.courierId) return fail(res, 409, "El pedido ya tiene repartidor");
  if (["delivered", "cancelled"].includes(order.status)) {
    return fail(res, 409, "El pedido ya no esta disponible");
  }
  order.courierId = driverId;
  Object.assign(order, addTimeline(order, "courier_assigned"));
  audit(db, req, "order", order.id, "order.delivery_accepted", { driverId });
  writeDb(db);
  publishRealtimeEvent({ req, type: "order.updated", entityType: "order", entityId: order.id, action: "order.delivery_accepted" });
  return ok(res, { order, label: orderLabels[order.status] });
});

app.post("/api/orders/:orderId/advance", requireAuth, requireAnyRole("merchant", "driver", "admin"), (req, res) => {
  const db = readDb();
  const index = db.orders.findIndex((entry) => entry.id === req.params.orderId);
  if (index < 0) return fail(res, 404, "Pedido no encontrado");
  if (!canAdvanceOrder(req, db, db.orders[index])) return fail(res, 403, "No puedes avanzar este pedido");
  const next = nextOrderStatus(db.orders[index]);
  if (!next) return fail(res, 409, "El pedido no puede avanzar desde este estado");
  db.orders[index] = addTimeline(db.orders[index], next);
  if (next === "delivered") db.orders[index].etaMin = 0;
  audit(db, req, "order", db.orders[index].id, "order.status_advanced", { status: next });
  writeDb(db);
  publishRealtimeEvent({ req, type: "order.updated", entityType: "order", entityId: db.orders[index].id, action: "order.status_advanced" });
  return ok(res, { order: db.orders[index], label: orderLabels[next] });
});

app.patch("/api/orders/:orderId/status", requireAuth, (req, res) => {
  const { status } = req.body || {};
  if (!orderStatuses.includes(status)) return fail(res, 400, "Estado de pedido invalido");
  const db = readDb();
  const index = db.orders.findIndex((entry) => entry.id === req.params.orderId);
  if (index < 0) return fail(res, 404, "Pedido no encontrado");
  if (!canMutateOrderStatus(req, db, db.orders[index], status)) {
    return fail(res, 403, "No puedes cambiar este estado de pedido");
  }
  db.orders[index] = addTimeline(db.orders[index], status);
  audit(db, req, "order", db.orders[index].id, "order.status_set", { status });
  writeDb(db);
  publishRealtimeEvent({ req, type: "order.updated", entityType: "order", entityId: db.orders[index].id, action: "order.status_set" });
  return ok(res, { order: db.orders[index], label: orderLabels[status] });
});

app.post("/api/rides/quote", (req, res) => {
  const parsed = parseOrFail(rideQuoteSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const { pickup, destination, service, pickupCoords, destinationCoords } = parsed.data;
  return ok(res, {
    quote: calculateRideQuote({ pickup, destination, service, pickupCoords, destinationCoords })
  });
});

app.post("/api/rides", requireAuth, requireAnyRole("customer", "admin"), (req, res) => {
  const parsed = parseOrFail(rideCreateSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const { customerId, pickup, destination, service, paymentMethod, pickupCoords, destinationCoords } = parsed.data;
  const db = readDb();
  const customer = db.users.find((user) => user.id === customerId);
  if (!customer) return fail(res, 404, "Cliente no encontrado");
  if (!canActAsCustomer(req, customerId)) return fail(res, 403, "No puedes crear viajes para otro cliente");
  const quote = calculateRideQuote({ pickup, destination, service, pickupCoords, destinationCoords });
  const createdAt = getTimestamp();
  let ride = {
    id: createId("RIDE"),
    customerId,
    driverId: null,
    status: "requested",
    service: quote.service,
    pickup: String(pickup),
    destination: String(destination),
    pickupLocation: pickupCoords || null,
    destinationLocation: destinationCoords || null,
    distanceKm: quote.distanceKm,
    etaMin: quote.etaMin,
    durationMin: quote.durationMin,
    fare: quote.fare,
    paymentMethod: String(paymentMethod || "Flash Wallet"),
    createdAt,
    timeline: [{ status: "requested", at: createdAt }]
  };
  ride = assignRideDriver(db, ride);
  db.rides.unshift(ride);
  audit(db, req, "ride", ride.id, "ride.created", {
    service: ride.service,
    fare: ride.fare,
    driverId: ride.driverId
  });
  writeDb(db);
  publishRealtimeEvent({ req, type: "ride.created", entityType: "ride", entityId: ride.id, action: "ride.created" });
  return ok(res, { ride, label: rideLabels[ride.status] });
});

app.post("/api/rides/:rideId/accept", requireAuth, requireAnyRole("driver", "admin"), (req, res) => {
  const { driverId } = req.body || {};
  const db = readDb();
  const index = db.rides.findIndex((entry) => entry.id === req.params.rideId);
  const driver = db.drivers.find((entry) => entry.id === driverId);
  if (index < 0) return fail(res, 404, "Viaje no encontrado");
  if (!canActAsDriver(req, driverId)) return fail(res, 403, "No puedes aceptar viajes con otro conductor");
  if (!driver || !driver.online || !driver.serviceModes.includes("ride")) {
    return fail(res, 409, "Conductor no disponible");
  }
  if (db.rides[index].driverId) return fail(res, 409, "El viaje ya tiene conductor");
  db.rides[index] = addTimeline(
    {
      ...db.rides[index],
      driverId
    },
    "driver_assigned"
  );
  audit(db, req, "ride", db.rides[index].id, "ride.accepted", { driverId });
  writeDb(db);
  publishRealtimeEvent({ req, type: "ride.updated", entityType: "ride", entityId: db.rides[index].id, action: "ride.accepted" });
  return ok(res, { ride: db.rides[index], label: rideLabels[db.rides[index].status] });
});

app.post("/api/rides/:rideId/advance", requireAuth, requireAnyRole("driver", "admin"), (req, res) => {
  const db = readDb();
  const index = db.rides.findIndex((entry) => entry.id === req.params.rideId);
  if (index < 0) return fail(res, 404, "Viaje no encontrado");
  if (!canAdvanceRide(req, db.rides[index])) return fail(res, 403, "No puedes avanzar este viaje");
  const next = nextRideStatus(db.rides[index]);
  if (!next) return fail(res, 409, "El viaje no puede avanzar desde este estado");
  db.rides[index] = addTimeline(db.rides[index], next);
  if (next === "completed") db.rides[index].etaMin = 0;
  audit(db, req, "ride", db.rides[index].id, "ride.status_advanced", { status: next });
  writeDb(db);
  publishRealtimeEvent({ req, type: "ride.updated", entityType: "ride", entityId: db.rides[index].id, action: "ride.status_advanced" });
  return ok(res, { ride: db.rides[index], label: rideLabels[next] });
});

app.patch("/api/rides/:rideId/status", requireAuth, (req, res) => {
  const { status } = req.body || {};
  if (!rideStatuses.includes(status)) return fail(res, 400, "Estado de viaje invalido");
  const db = readDb();
  const index = db.rides.findIndex((entry) => entry.id === req.params.rideId);
  if (index < 0) return fail(res, 404, "Viaje no encontrado");
  if (!canMutateRideStatus(req, db.rides[index], status)) {
    return fail(res, 403, "No puedes cambiar este estado de viaje");
  }
  db.rides[index] = addTimeline(db.rides[index], status);
  audit(db, req, "ride", db.rides[index].id, "ride.status_set", { status });
  writeDb(db);
  publishRealtimeEvent({ req, type: "ride.updated", entityType: "ride", entityId: db.rides[index].id, action: "ride.status_set" });
  return ok(res, { ride: db.rides[index], label: rideLabels[status] });
});

app.patch("/api/drivers/:driverId/availability", requireAuth, requireAnyRole("driver", "admin"), (req, res) => {
  const db = readDb();
  const driver = db.drivers.find((entry) => entry.id === req.params.driverId);
  if (!driver) return fail(res, 404, "Conductor no encontrado");
  if (!canActAsDriver(req, driver.id)) return fail(res, 403, "No puedes gestionar otro conductor");
  const body = req.body || {};
  if (typeof body.online === "boolean") driver.online = body.online;
  if (driver.serviceModes.includes(body.activeService)) driver.activeService = body.activeService;
  audit(db, req, "driver", driver.id, "driver.availability_updated", {
    online: driver.online,
    activeService: driver.activeService
  });
  writeDb(db);
  publishRealtimeEvent({ req, type: "driver.updated", entityType: "driver", entityId: driver.id, action: "driver.availability_updated" });
  return ok(res, { driver });
});

app.patch("/api/drivers/:driverId/location", requireAuth, requireAnyRole("driver", "admin"), (req, res) => {
  const parsed = parseOrFail(driverLocationSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const db = readDb();
  const driver = db.drivers.find((entry) => entry.id === req.params.driverId);
  if (!driver) return fail(res, 404, "Conductor no encontrado");
  if (!canActAsDriver(req, driver.id)) return fail(res, 403, "No puedes actualizar otro conductor");
  const { lat, lng, label } = parsed.data;
  driver.location = {
    lat,
    lng,
    label: label || driver.location.label || "Ubicacion GPS",
    updatedAt: getTimestamp()
  };
  audit(db, req, "driver", driver.id, "driver.location_updated", {
    lat,
    lng,
    label: driver.location.label
  });
  writeDb(db);
  publishRealtimeEvent({ req, type: "driver.location.updated", entityType: "driver", entityId: driver.id, action: "driver.location_updated" });
  return ok(res, { driver });
});

app.post("/api/reset", requireAuth, requireAnyRole("admin"), (req, res) => {
  ok(res, { state: resetDb() });
  publishRealtimeEvent({ req, type: "platform.reset", action: "platform.reset" });
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.use((req, res) => {
  fail(res, 404, `Ruta no encontrada: ${req.method} ${req.path}`);
});

app.use((error, req, res, _next) => {
  const status = Number(error.status || error.statusCode || 500);
  if (status >= 500 && config.logLevel !== "silent") {
    console.error(
      JSON.stringify({
        level: "error",
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        status,
        message: error.message
      })
    );
  }
  return fail(
    res,
    status >= 400 && status < 600 ? status : 500,
    status >= 500 ? "Error interno del servidor" : error.message
  );
});

const server = app.listen(config.port, config.host, () => {
  console.log(`Flash API running on http://${config.host}:${config.port}`);
});

server.on("error", (error) => {
  console.error("Flash API failed to start", error);
  process.exitCode = 1;
});

function shutdown(signal) {
  console.log(`Received ${signal}. Closing Flash API.`);
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
