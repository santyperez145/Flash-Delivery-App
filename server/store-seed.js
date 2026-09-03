import bcrypt from "bcryptjs";
import { buildSeedRestaurants } from "./store-seed-catalog.js";
import { buildSeedDrivers, buildSeedOrders, buildSeedRides } from "./store-seed-mobility.js";

// Misma lista que `notificationPreferenceCategories` en store.js — no se importa
// desde allí para evitar el ciclo store → store-seed → store.
const notificationPreferenceCategories = [
  "service_updates",
  "promotions",
  "support",
  "wallet",
  "account",
];

export function createSeed(now = () => new Date().toISOString()) {
  const createdAt = now();
  const password = bcrypt.hashSync("demo123", 10);
  return {
    meta: {
      name: "Flash Delivery Mobility",
      version: 4,
      createdAt,
      updatedAt: createdAt,
      database: "sqlite",
    },
    users: [
      {
        id: "usr_customer",
        name: "Alex Rivero",
        email: "cliente@flash.app",
        password,
        roles: ["customer"],
        phone: "+54 11 5555 0101",
        wallet: 18600,
        defaultAddress: "Defensa 982, San Telmo",
      },
      {
        id: "usr_merchant",
        name: "Sofia Campos",
        email: "comercio@flash.app",
        password,
        roles: ["merchant"],
        phone: "+54 11 5555 0202",
        wallet: 842000,
        restaurantId: "rest_roja",
      },
      {
        id: "usr_driver",
        name: "Lautaro Mendez",
        email: "conductor@flash.app",
        password,
        roles: ["driver"],
        phone: "+54 11 5555 0303",
        wallet: 38200,
        driverId: "drv_lautaro",
      },
      {
        id: "usr_admin",
        name: "Mila Torres",
        email: "ops@flash.app",
        password,
        roles: ["admin"],
        phone: "+54 11 5555 0404",
        wallet: 0,
      },
      {
        id: "usr_support",
        name: "Valentina Ruiz",
        email: "soporte@flash.app",
        password,
        roles: ["support"],
        phone: "+54 11 5555 0505",
        wallet: 0,
      },
    ],
    addresses: [
      {
        id: "addr_customer_home",
        userId: "usr_customer",
        label: "Casa",
        address: "Defensa 982, San Telmo",
        lat: -34.6177,
        lng: -58.3621,
        isDefault: true,
      },
      {
        id: "addr_customer_work",
        userId: "usr_customer",
        label: "Trabajo",
        address: "Av. Corrientes 900, Microcentro",
        lat: -34.6037,
        lng: -58.3816,
        isDefault: false,
      },
    ],
    paymentMethods: [
      {
        id: "pay_wallet",
        userId: "usr_customer",
        type: "wallet",
        label: "Flash Wallet",
        last4: "",
        balance: 18600,
        isDefault: true,
      },
      {
        id: "pay_card_7234",
        userId: "usr_customer",
        type: "card",
        label: "Mastercard",
        last4: "7234",
        balance: 0,
        isDefault: false,
      },
    ],
    walletTransactions: [
      {
        id: "wtx_seed_1",
        userId: "usr_customer",
        kind: "credit",
        amount: 18600,
        description: "Saldo demo inicial",
        createdAt,
      },
    ],
    restaurants: buildSeedRestaurants(),
    drivers: buildSeedDrivers(),
    orders: buildSeedOrders(createdAt),
    rides: buildSeedRides(createdAt),
    promotions: [
      {
        id: "promo_food_40",
        title: "40% off en seleccionados",
        description: "Tope de reintegro $4.000 con Flash Wallet.",
        service: "food",
        discountPercent: 40,
        active: true,
      },
      {
        id: "promo_ride_airport",
        title: "Viajes al aeropuerto",
        description: "Precio dinamico protegido hasta las 20:00.",
        service: "ride",
        discountPercent: 15,
        active: true,
      },
    ],
    supportTickets: [
      {
        id: "TCK-4401",
        service: "food",
        status: "open",
        title: "Pedido demorado",
        priority: "medium",
      },
      {
        id: "TCK-4402",
        service: "ride",
        status: "open",
        title: "Objeto olvidado",
        priority: "high",
      },
    ],
    notifications: [
      {
        id: "NTF-DEMO-ORDER",
        userId: "usr_customer",
        channel: "in_app",
        template: "order_status",
        payload: { orderId: "ORD-7301", status: "delivering", etaMin: 18 },
        status: "sent",
        readAt: null,
        createdAt,
      },
      {
        id: "NTF-DEMO-RIDE",
        userId: "usr_customer",
        channel: "in_app",
        template: "ride_status",
        payload: { rideId: "RIDE-2201", status: "arriving", etaMin: 6 },
        status: "sent",
        readAt: createdAt,
        createdAt,
      },
    ],
    notificationPreferences: notificationPreferenceCategories.map((category) => ({
      userId: "usr_customer",
      category,
      pushEnabled: category !== "promotions",
      emailEnabled: false,
      updatedAt: null,
    })),
    ratings: [
      {
        id: "rate_roja",
        targetType: "restaurant",
        targetId: "rest_roja",
        userId: "usr_customer",
        score: 5,
        comment: "Muy rapido",
        createdAt,
      },
    ],
    zones: [
      {
        id: "zone_palermo",
        name: "Palermo",
        demandLevel: "high",
        deliveryMultiplier: 1.2,
        rideMultiplier: 1.15,
        activeOrders: 18,
        activeRides: 9,
      },
      {
        id: "zone_centro",
        name: "Centro",
        demandLevel: "medium",
        deliveryMultiplier: 1.05,
        rideMultiplier: 1.12,
        activeOrders: 12,
        activeRides: 14,
      },
      {
        id: "zone_santelmo",
        name: "San Telmo",
        demandLevel: "medium",
        deliveryMultiplier: 1.08,
        rideMultiplier: 1.04,
        activeOrders: 8,
        activeRides: 5,
      },
    ],
    auditEvents: [
      {
        id: "audit_seed",
        actorId: "usr_admin",
        entityType: "platform",
        entityId: "seed",
        action: "seed_database",
        payload: { version: 3 },
        createdAt,
      },
    ],
  };
}

export function ensureBootstrapSupportUser(database, now, seedFactory = createSeed) {
  const support = seedFactory(now).users.find((user) => user.roles?.includes("support"));
  if (!support) return;
  const byEmail = database.prepare("SELECT id FROM users WHERE email = ?").get(support.email);
  if (!byEmail && !database.prepare("SELECT id FROM users WHERE id = ?").get(support.id)) {
    database
      .prepare(
        `INSERT INTO users (
          id, name, email, password_hash, phone, wallet, default_address, restaurant_id, driver_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        support.id,
        support.name,
        support.email,
        support.password,
        support.phone || null,
        support.wallet || 0,
        support.defaultAddress || null,
        support.restaurantId || null,
        support.driverId || null,
        support.createdAt || now(),
      );
  }
  const user = database.prepare("SELECT id FROM users WHERE email = ?").get(support.email);
  if (user) {
    database
      .prepare("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)")
      .run(user.id, "support");
  }
}

export function ensureLocalNotificationData(database, now, seedFactory = createSeed) {
  const customer = database.prepare("SELECT id FROM users WHERE id = ?").get("usr_customer");
  if (
    customer &&
    database.prepare("SELECT COUNT(*) AS total FROM notifications").get().total === 0
  ) {
    const seed = seedFactory(now);
    const insert = database.prepare(`
      INSERT OR IGNORE INTO notifications (id, user_id, channel, template, payload_json, status, read_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const notification of seed.notifications || []) {
      insert.run(
        notification.id,
        notification.userId,
        notification.channel,
        notification.template,
        JSON.stringify(notification.payload || {}),
        notification.status,
        notification.readAt || null,
        notification.createdAt,
      );
    }
  }
}
