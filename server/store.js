import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, "data");
const sqlitePath = path.join(dataDir, "flash.sqlite");

export const orderStatuses = [
  "accepted",
  "preparing",
  "ready_for_pickup",
  "courier_assigned",
  "picked_up",
  "delivering",
  "delivered",
  "cancelled"
];

export const rideStatuses = [
  "requested",
  "driver_assigned",
  "arriving",
  "in_progress",
  "completed",
  "cancelled"
];

export const shipmentStatuses = [
  "requested",
  "driver_assigned",
  "arriving",
  "picked_up",
  "delivering",
  "delivered",
  "cancelled"
];

const now = () => new Date().toISOString();

export const createId = (prefix) =>
  `${prefix}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

const asset = (id) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=80`;

function db() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const database = new Database(sqlitePath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  return database;
}

const database = db();

function execSchema() {
  database.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      phone TEXT,
      wallet INTEGER NOT NULL DEFAULT 0,
      default_address TEXT,
      restaurant_id TEXT,
      driver_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (user_id, role),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_addresses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      label TEXT NOT NULL,
      address TEXT NOT NULL,
      lat REAL,
      lng REAL,
      is_default INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payment_methods (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      last4 TEXT,
      balance INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      amount INTEGER NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS restaurants (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      cuisine TEXT NOT NULL,
      rating REAL NOT NULL,
      distance_km REAL NOT NULL,
      eta_min INTEGER NOT NULL,
      delivery_fee INTEGER NOT NULL,
      open INTEGER NOT NULL,
      image TEXT NOT NULL,
      cover TEXT NOT NULL,
      badge TEXT NOT NULL,
      address TEXT NOT NULL,
      lat REAL,
      lng REAL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS restaurant_hours (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL,
      weekday INTEGER NOT NULL,
      opens_at TEXT NOT NULL,
      closes_at TEXT NOT NULL,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS restaurant_extras (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      price INTEGER NOT NULL,
      rating REAL NOT NULL,
      time_min INTEGER NOT NULL,
      kcal INTEGER NOT NULL,
      stock INTEGER NOT NULL,
      image TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS menu_item_tags (
      menu_item_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (menu_item_id, tag),
      FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS drivers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      online INTEGER NOT NULL,
      service_modes TEXT NOT NULL,
      active_service TEXT NOT NULL,
      rating REAL NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      location_label TEXT NOT NULL,
      location_updated_at TEXT,
      earnings_today INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      driver_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      model TEXT NOT NULL,
      plate TEXT NOT NULL,
      color TEXT,
      active INTEGER NOT NULL,
      FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      restaurant_id TEXT NOT NULL,
      courier_id TEXT,
      status TEXT NOT NULL,
      delivery_address TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      subtotal INTEGER NOT NULL,
      delivery_fee INTEGER NOT NULL,
      service_fee INTEGER NOT NULL,
      total INTEGER NOT NULL,
      eta_min INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES users(id),
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id),
      FOREIGN KEY (courier_id) REFERENCES drivers(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      menu_item_id TEXT NOT NULL,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price INTEGER NOT NULL,
      note TEXT,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS order_item_extras (
      order_item_id TEXT NOT NULL,
      extra_name TEXT NOT NULL,
      PRIMARY KEY (order_item_id, extra_name),
      FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS order_timeline (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      status TEXT NOT NULL,
      at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rides (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      driver_id TEXT,
      status TEXT NOT NULL,
      service TEXT NOT NULL,
      pickup TEXT NOT NULL,
      destination TEXT NOT NULL,
      pickup_lat REAL,
      pickup_lng REAL,
      destination_lat REAL,
      destination_lng REAL,
      distance_km REAL NOT NULL,
      eta_min INTEGER NOT NULL,
      duration_min INTEGER NOT NULL,
      fare INTEGER NOT NULL,
      payment_method TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES users(id),
      FOREIGN KEY (driver_id) REFERENCES drivers(id)
    );

    CREATE TABLE IF NOT EXISTS ride_timeline (
      id TEXT PRIMARY KEY,
      ride_id TEXT NOT NULL,
      status TEXT NOT NULL,
      at TEXT NOT NULL,
      FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      refresh_token_hash TEXT NOT NULL UNIQUE,
      device_name TEXT,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id, expires_at);

    CREATE TABLE IF NOT EXISTS shipments (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      driver_id TEXT,
      status TEXT NOT NULL,
      pickup TEXT NOT NULL,
      destination TEXT NOT NULL,
      pickup_lat REAL,
      pickup_lng REAL,
      destination_lat REAL,
      destination_lng REAL,
      recipient_name TEXT NOT NULL,
      recipient_phone TEXT NOT NULL,
      package_size TEXT NOT NULL,
      description TEXT NOT NULL,
      weight_kg REAL NOT NULL,
      delivery_notes TEXT,
      distance_km REAL NOT NULL,
      eta_min INTEGER NOT NULL,
      fare INTEGER NOT NULL,
      payment_method TEXT NOT NULL,
      delivery_pin TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES users(id),
      FOREIGN KEY (driver_id) REFERENCES drivers(id)
    );

    CREATE TABLE IF NOT EXISTS shipment_timeline (
      id TEXT PRIMARY KEY,
      shipment_id TEXT NOT NULL,
      status TEXT NOT NULL,
      at TEXT NOT NULL,
      FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS promotions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      service TEXT NOT NULL,
      discount_percent INTEGER NOT NULL,
      active INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      service TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      priority TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ratings (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      score INTEGER NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS zones (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      demand_level TEXT NOT NULL,
      delivery_multiplier REAL NOT NULL,
      ride_multiplier REAL NOT NULL,
      active_orders INTEGER NOT NULL,
      active_rides INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

function ensureSchemaColumns() {
  const migrations = [
    ["drivers", "location_updated_at", "TEXT"],
    ["rides", "pickup_lat", "REAL"],
    ["rides", "pickup_lng", "REAL"],
    ["rides", "destination_lat", "REAL"],
    ["rides", "destination_lng", "REAL"]
  ];
  for (const [table, column, type] of migrations) {
    const exists = database
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .some((entry) => entry.name === column);
    if (!exists) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

function createSeed() {
  const createdAt = now();
  const password = bcrypt.hashSync("demo123", 10);
  return {
    meta: {
      name: "Flash Delivery Mobility",
      version: 4,
      createdAt,
      updatedAt: createdAt,
      database: "sqlite"
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
        defaultAddress: "Defensa 982, San Telmo"
      },
      {
        id: "usr_merchant",
        name: "Sofia Campos",
        email: "comercio@flash.app",
        password,
        roles: ["merchant"],
        phone: "+54 11 5555 0202",
        wallet: 842000,
        restaurantId: "rest_roja"
      },
      {
        id: "usr_driver",
        name: "Lautaro Mendez",
        email: "conductor@flash.app",
        password,
        roles: ["driver"],
        phone: "+54 11 5555 0303",
        wallet: 38200,
        driverId: "drv_lautaro"
      },
      {
        id: "usr_admin",
        name: "Mila Torres",
        email: "ops@flash.app",
        password,
        roles: ["admin"],
        phone: "+54 11 5555 0404",
        wallet: 0
      }
    ],
    addresses: [
      {
        id: "addr_customer_home",
        userId: "usr_customer",
        label: "Casa",
        address: "Defensa 982, San Telmo",
        lat: -34.6177,
        lng: -58.3621,
        isDefault: true
      },
      {
        id: "addr_customer_work",
        userId: "usr_customer",
        label: "Trabajo",
        address: "Av. Corrientes 900, Microcentro",
        lat: -34.6037,
        lng: -58.3816,
        isDefault: false
      }
    ],
    paymentMethods: [
      {
        id: "pay_wallet",
        userId: "usr_customer",
        type: "wallet",
        label: "Flash Wallet",
        last4: "",
        balance: 18600,
        isDefault: true
      },
      {
        id: "pay_card_7234",
        userId: "usr_customer",
        type: "card",
        label: "Mastercard",
        last4: "7234",
        balance: 0,
        isDefault: false
      }
    ],
    walletTransactions: [
      {
        id: "wtx_seed_1",
        userId: "usr_customer",
        kind: "credit",
        amount: 18600,
        description: "Saldo demo inicial",
        createdAt
      }
    ],
    restaurants: [
      {
        id: "rest_roja",
        ownerId: "usr_merchant",
        name: "Roja Beef House",
        cuisine: "Parrilla urbana",
        rating: 4.8,
        distanceKm: 1.2,
        etaMin: 22,
        deliveryFee: 790,
        open: true,
        image: asset("photo-1550547660-d9450f859349"),
        cover: asset("photo-1529692236671-f1f6cf9683ba"),
        badge: "2x1 en burgers",
        address: "Honduras 4120, Palermo",
        lat: -34.5886,
        lng: -58.4301,
        menu: [
          {
            id: "item_burger_brava",
            name: "Burger Brava",
            description: "Doble carne, cheddar, cebolla crispy y salsa ahumada.",
            category: "Burger",
            price: 6500,
            rating: 4.9,
            timeMin: 18,
            kcal: 780,
            stock: true,
            image: asset("photo-1568901346375-23c9450c58cd"),
            tags: ["Picante", "Mas vendido"]
          },
          {
            id: "item_papas_trufa",
            name: "Papas con trufa",
            description: "Papas rusticas, parmesano y alioli suave.",
            category: "Burger",
            price: 3200,
            rating: 4.7,
            timeMin: 12,
            kcal: 520,
            stock: true,
            image: asset("photo-1576107232684-1279f390859f"),
            tags: ["Combo"]
          },
          {
            id: "item_limonada_roja",
            name: "Limonada roja",
            description: "Frutilla, lima, menta y soda.",
            category: "Bebidas",
            price: 2100,
            rating: 4.6,
            timeMin: 5,
            kcal: 160,
            stock: true,
            image: asset("photo-1497534446932-c925b458314e"),
            tags: ["Fresco"]
          }
        ],
        extras: [
          { id: "extra_cheddar", name: "Cheddar extra", price: 550 },
          { id: "extra_palta", name: "Palta", price: 700 },
          { id: "extra_picante", name: "Salsa picante", price: 350 },
          { id: "extra_crispy", name: "Cebolla crispy", price: 320 }
        ]
      },
      {
        id: "rest_nori",
        ownerId: "usr_merchant",
        name: "Nori Club",
        cuisine: "Sushi & bowls",
        rating: 4.7,
        distanceKm: 2.1,
        etaMin: 29,
        deliveryFee: 890,
        open: true,
        image: asset("photo-1579584425555-c3ce17fd4351"),
        cover: asset("photo-1611143669185-af224c5e3252"),
        badge: "15% con wallet",
        address: "Armenia 1470, Palermo",
        lat: -34.5891,
        lng: -58.4251,
        menu: [
          {
            id: "item_salmon_furai",
            name: "Roll salmon furai",
            description: "Salmon, palta, queso crema y crocante panko.",
            category: "Sushi",
            price: 8200,
            rating: 4.8,
            timeMin: 22,
            kcal: 610,
            stock: true,
            image: asset("photo-1579871494447-9811cf80d66c"),
            tags: ["12 piezas", "Fresco"]
          },
          {
            id: "item_poke_verde",
            name: "Poke verde",
            description: "Arroz, edamame, mango, palta y salsa ponzu.",
            category: "Veggie",
            price: 7200,
            rating: 4.6,
            timeMin: 17,
            kcal: 560,
            stock: true,
            image: asset("photo-1547496502-affa22d38842"),
            tags: ["Veggie"]
          }
        ],
        extras: [
          { id: "extra_jengibre", name: "Jengibre extra", price: 280 },
          { id: "extra_wasabi", name: "Wasabi", price: 250 },
          { id: "extra_soja", name: "Salsa soja", price: 180 }
        ]
      },
      {
        id: "rest_forno",
        ownerId: "usr_merchant",
        name: "Forno Palermo",
        cuisine: "Pizza italiana",
        rating: 4.6,
        distanceKm: 1.8,
        etaMin: 24,
        deliveryFee: 690,
        open: true,
        image: asset("photo-1513104890138-7c749659a591"),
        cover: asset("photo-1565299624946-b28f40a0ae38"),
        badge: "Envio bajo",
        address: "Costa Rica 5032, Palermo",
        lat: -34.5845,
        lng: -58.4304,
        menu: [
          {
            id: "item_pizza_burrata",
            name: "Pizza burrata",
            description: "Tomates asados, pesto, burrata y masa madre.",
            category: "Pizza",
            price: 7600,
            rating: 4.9,
            timeMin: 19,
            kcal: 840,
            stock: true,
            image: asset("photo-1574071318508-1cdbab80d002"),
            tags: ["Nueva", "Cremosa"]
          },
          {
            id: "item_tiramisu",
            name: "Tiramisu express",
            description: "Mascarpone, cafe, cacao amargo y vainillas.",
            category: "Postres",
            price: 4100,
            rating: 4.8,
            timeMin: 8,
            kcal: 430,
            stock: true,
            image: asset("photo-1571877227200-a0d98ea607e9"),
            tags: ["Postre"]
          }
        ],
        extras: [
          { id: "extra_muzza", name: "Mozzarella extra", price: 680 },
          { id: "extra_albahaca", name: "Albahaca fresca", price: 220 }
        ]
      },
      {
        id: "rest_huerta",
        ownerId: "usr_merchant",
        name: "Huerta 9",
        cuisine: "Plant based",
        rating: 4.9,
        distanceKm: 0.9,
        etaMin: 17,
        deliveryFee: 590,
        open: true,
        image: asset("photo-1512621776951-a57141f2eefd"),
        cover: asset("photo-1543353071-10c8ba85a904"),
        badge: "Top saludable",
        address: "Chile 940, San Telmo",
        lat: -34.6164,
        lng: -58.3719,
        menu: [
          {
            id: "item_caesar_veggie",
            name: "Caesar veggie",
            description: "Kale, parmesano vegano, croutons y dressing citrico.",
            category: "Veggie",
            price: 5900,
            rating: 4.8,
            timeMin: 14,
            kcal: 420,
            stock: true,
            image: asset("photo-1540420773420-3366772f4999"),
            tags: ["Ligero", "Sin carne"]
          },
          {
            id: "item_smoothie_rojo",
            name: "Smoothie rojo",
            description: "Frutilla, banana, hibiscus y granola crocante.",
            category: "Bebidas",
            price: 3600,
            rating: 4.7,
            timeMin: 7,
            kcal: 310,
            stock: true,
            image: asset("photo-1505252585461-04db1eb84625"),
            tags: ["Bebida"]
          }
        ],
        extras: [
          { id: "extra_granola", name: "Granola", price: 420 },
          { id: "extra_proteina", name: "Proteina vegetal", price: 900 }
        ]
      }
    ],
    drivers: [
      {
        id: "drv_lautaro",
        userId: "usr_driver",
        name: "Lautaro Mendez",
        online: true,
        serviceModes: ["delivery", "ride"],
        activeService: "delivery",
        vehicle: "Moto Honda Wave",
        plate: "A123BCD",
        rating: 4.96,
        location: { lat: -34.5886, lng: -58.4301, label: "Palermo" },
        earningsToday: 38200
      },
      {
        id: "drv_mica",
        userId: "usr_driver",
        name: "Mica Alvarez",
        online: true,
        serviceModes: ["ride"],
        activeService: "ride",
        vehicle: "Toyota Etios",
        plate: "AD456EF",
        rating: 4.91,
        location: { lat: -34.6037, lng: -58.3816, label: "Centro" },
        earningsToday: 51700
      },
      {
        id: "drv_nico",
        userId: "usr_driver",
        name: "Nico Pereyra",
        online: false,
        serviceModes: ["delivery"],
        activeService: "delivery",
        vehicle: "Bicicleta electrica",
        plate: "BIKE-19",
        rating: 4.82,
        location: { lat: -34.6177, lng: -58.3621, label: "San Telmo" },
        earningsToday: 18400
      }
    ],
    orders: [
      {
        id: "ORD-7301",
        customerId: "usr_customer",
        restaurantId: "rest_nori",
        courierId: null,
        status: "ready_for_pickup",
        deliveryAddress: "Defensa 982, San Telmo",
        paymentMethod: "Flash Wallet",
        items: [
          {
            menuItemId: "item_salmon_furai",
            name: "Roll salmon furai",
            quantity: 1,
            unitPrice: 8200,
            extras: ["Wasabi"],
            note: "Salsa aparte"
          },
          {
            menuItemId: "item_poke_verde",
            name: "Poke verde",
            quantity: 1,
            unitPrice: 7200,
            extras: [],
            note: ""
          }
        ],
        subtotal: 15400,
        deliveryFee: 890,
        serviceFee: 520,
        total: 16810,
        etaMin: 14,
        createdAt,
        timeline: [
          { status: "accepted", at: createdAt },
          { status: "preparing", at: createdAt },
          { status: "ready_for_pickup", at: createdAt }
        ]
      },
      {
        id: "ORD-7302",
        customerId: "usr_customer",
        restaurantId: "rest_roja",
        courierId: "drv_lautaro",
        status: "delivering",
        deliveryAddress: "Defensa 982, San Telmo",
        paymentMethod: "Mastercard 7234",
        items: [
          {
            menuItemId: "item_burger_brava",
            name: "Burger Brava",
            quantity: 2,
            unitPrice: 6500,
            extras: ["Cheddar extra"],
            note: ""
          }
        ],
        subtotal: 13550,
        deliveryFee: 790,
        serviceFee: 520,
        total: 14860,
        etaMin: 11,
        createdAt,
        timeline: [
          { status: "accepted", at: createdAt },
          { status: "preparing", at: createdAt },
          { status: "ready_for_pickup", at: createdAt },
          { status: "courier_assigned", at: createdAt },
          { status: "picked_up", at: createdAt },
          { status: "delivering", at: createdAt }
        ]
      }
    ],
    rides: [
      {
        id: "RIDE-2201",
        customerId: "usr_customer",
        driverId: "drv_mica",
        status: "arriving",
        service: "comfort",
        pickup: "Defensa 982, San Telmo",
        destination: "Aeroparque Jorge Newbery",
        distanceKm: 9.8,
        etaMin: 7,
        durationMin: 24,
        fare: 8920,
        paymentMethod: "Flash Wallet",
        createdAt,
        timeline: [
          { status: "requested", at: createdAt },
          { status: "driver_assigned", at: createdAt },
          { status: "arriving", at: createdAt }
        ]
      }
    ],
    promotions: [
      {
        id: "promo_food_40",
        title: "40% off en seleccionados",
        description: "Tope de reintegro $4.000 con Flash Wallet.",
        service: "food",
        discountPercent: 40,
        active: true
      },
      {
        id: "promo_ride_airport",
        title: "Viajes al aeropuerto",
        description: "Precio dinamico protegido hasta las 20:00.",
        service: "ride",
        discountPercent: 15,
        active: true
      }
    ],
    supportTickets: [
      {
        id: "TCK-4401",
        service: "food",
        status: "open",
        title: "Pedido demorado",
        priority: "medium"
      },
      {
        id: "TCK-4402",
        service: "ride",
        status: "open",
        title: "Objeto olvidado",
        priority: "high"
      }
    ],
    ratings: [
      {
        id: "rate_roja",
        targetType: "restaurant",
        targetId: "rest_roja",
        userId: "usr_customer",
        score: 5,
        comment: "Muy rapido",
        createdAt
      }
    ],
    zones: [
      {
        id: "zone_palermo",
        name: "Palermo",
        demandLevel: "high",
        deliveryMultiplier: 1.2,
        rideMultiplier: 1.15,
        activeOrders: 18,
        activeRides: 9
      },
      {
        id: "zone_centro",
        name: "Centro",
        demandLevel: "medium",
        deliveryMultiplier: 1.05,
        rideMultiplier: 1.12,
        activeOrders: 12,
        activeRides: 14
      },
      {
        id: "zone_santelmo",
        name: "San Telmo",
        demandLevel: "medium",
        deliveryMultiplier: 1.08,
        rideMultiplier: 1.04,
        activeOrders: 8,
        activeRides: 5
      }
    ],
    auditEvents: [
      {
        id: "audit_seed",
        actorId: "usr_admin",
        entityType: "platform",
        entityId: "seed",
        action: "seed_database",
        payload: { version: 3 },
        createdAt
      }
    ]
  };
}

function boolToInt(value) {
  return value ? 1 : 0;
}

function rowBool(value) {
  return Boolean(value);
}

function getMeta() {
  return Object.fromEntries(
    database.prepare("SELECT key, value FROM meta").all().map((row) => [row.key, JSON.parse(row.value)])
  );
}

function setMeta(meta) {
  const insert = database.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(meta)) {
    insert.run(key, JSON.stringify(value));
  }
}

function clearAll() {
  database.exec(`
    DELETE FROM audit_events;
    DELETE FROM zones;
    DELETE FROM ratings;
    DELETE FROM support_tickets;
    DELETE FROM promotions;
    DELETE FROM ride_timeline;
    DELETE FROM rides;
    DELETE FROM shipment_timeline;
    DELETE FROM shipments;
    DELETE FROM order_timeline;
    DELETE FROM order_item_extras;
    DELETE FROM order_items;
    DELETE FROM orders;
    DELETE FROM vehicles;
    DELETE FROM drivers;
    DELETE FROM menu_item_tags;
    DELETE FROM menu_items;
    DELETE FROM restaurant_extras;
    DELETE FROM restaurant_hours;
    DELETE FROM restaurants;
    DELETE FROM wallet_transactions;
    DELETE FROM payment_methods;
    DELETE FROM user_addresses;
    DELETE FROM user_roles;
    DELETE FROM users;
    DELETE FROM meta;
  `);
}

const replaceTransaction = database.transaction((state) => {
  clearAll();
  setMeta(state.meta);

  const insertUser = database.prepare(`
    INSERT INTO users (
      id, name, email, password_hash, phone, wallet, default_address, restaurant_id, driver_id, created_at
    ) VALUES (@id, @name, @email, @password, @phone, @wallet, @defaultAddress, @restaurantId, @driverId, @createdAt)
  `);
  const insertRole = database.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, ?)");
  const insertAddress = database.prepare(`
    INSERT INTO user_addresses (id, user_id, label, address, lat, lng, is_default)
    VALUES (@id, @userId, @label, @address, @lat, @lng, @isDefault)
  `);
  const insertPayment = database.prepare(`
    INSERT INTO payment_methods (id, user_id, type, label, last4, balance, is_default)
    VALUES (@id, @userId, @type, @label, @last4, @balance, @isDefault)
  `);
  const insertWallet = database.prepare(`
    INSERT INTO wallet_transactions (id, user_id, kind, amount, description, created_at)
    VALUES (@id, @userId, @kind, @amount, @description, @createdAt)
  `);

  for (const user of state.users) {
    insertUser.run({
      ...user,
      password: user.password || user.passwordHash || bcrypt.hashSync("demo123", 10),
      phone: user.phone || null,
      wallet: user.wallet || 0,
      defaultAddress: user.defaultAddress || null,
      restaurantId: user.restaurantId || null,
      driverId: user.driverId || null,
      createdAt: user.createdAt || state.meta.createdAt || now()
    });
    for (const role of user.roles || []) {
      insertRole.run(user.id, role);
    }
  }

  for (const address of state.addresses || []) {
    insertAddress.run({ ...address, isDefault: boolToInt(address.isDefault) });
  }
  for (const method of state.paymentMethods || []) {
    insertPayment.run({ ...method, isDefault: boolToInt(method.isDefault) });
  }
  for (const transaction of state.walletTransactions || []) {
    insertWallet.run(transaction);
  }

  const insertRestaurant = database.prepare(`
    INSERT INTO restaurants (
      id, owner_id, name, cuisine, rating, distance_km, eta_min, delivery_fee, open,
      image, cover, badge, address, lat, lng, created_at
    ) VALUES (
      @id, @ownerId, @name, @cuisine, @rating, @distanceKm, @etaMin, @deliveryFee, @open,
      @image, @cover, @badge, @address, @lat, @lng, @createdAt
    )
  `);
  const insertHour = database.prepare(`
    INSERT INTO restaurant_hours (id, restaurant_id, weekday, opens_at, closes_at)
    VALUES (@id, @restaurantId, @weekday, @opensAt, @closesAt)
  `);
  const insertExtra = database.prepare(`
    INSERT INTO restaurant_extras (id, restaurant_id, name, price)
    VALUES (@id, @restaurantId, @name, @price)
  `);
  const insertMenuItem = database.prepare(`
    INSERT INTO menu_items (
      id, restaurant_id, name, description, category, price, rating, time_min, kcal, stock, image, created_at
    ) VALUES (
      @id, @restaurantId, @name, @description, @category, @price, @rating, @timeMin, @kcal, @stock, @image, @createdAt
    )
  `);
  const insertTag = database.prepare("INSERT INTO menu_item_tags (menu_item_id, tag) VALUES (?, ?)");

  for (const restaurant of state.restaurants) {
    insertRestaurant.run({
      ...restaurant,
      open: boolToInt(restaurant.open),
      lat: restaurant.lat || null,
      lng: restaurant.lng || null,
      createdAt: restaurant.createdAt || state.meta.createdAt || now()
    });
    for (let weekday = 0; weekday < 7; weekday += 1) {
      insertHour.run({
        id: `${restaurant.id}_hour_${weekday}`,
        restaurantId: restaurant.id,
        weekday,
        opensAt: "10:00",
        closesAt: "23:30"
      });
    }
    for (const extra of restaurant.extras || []) {
      insertExtra.run({ ...extra, restaurantId: restaurant.id });
    }
    for (const item of restaurant.menu || []) {
      insertMenuItem.run({
        ...item,
        restaurantId: restaurant.id,
        stock: boolToInt(item.stock),
        createdAt: item.createdAt || state.meta.createdAt || now()
      });
      for (const tag of item.tags || []) {
        insertTag.run(item.id, tag);
      }
    }
  }

  const insertDriver = database.prepare(`
    INSERT INTO drivers (
      id, user_id, name, online, service_modes, active_service, rating, lat, lng, location_label,
      location_updated_at, earnings_today, created_at
    ) VALUES (
      @id, @userId, @name, @online, @serviceModes, @activeService, @rating, @lat, @lng, @locationLabel,
      @locationUpdatedAt, @earningsToday, @createdAt
    )
  `);
  const insertVehicle = database.prepare(`
    INSERT INTO vehicles (id, driver_id, kind, model, plate, color, active)
    VALUES (@id, @driverId, @kind, @model, @plate, @color, @active)
  `);

  for (const driver of state.drivers) {
    insertDriver.run({
      id: driver.id,
      userId: driver.userId,
      name: driver.name,
      online: boolToInt(driver.online),
      serviceModes: JSON.stringify(driver.serviceModes || []),
      activeService: driver.activeService,
      rating: driver.rating,
      lat: driver.location?.lat || 0,
      lng: driver.location?.lng || 0,
      locationLabel: driver.location?.label || "",
      locationUpdatedAt: driver.location?.updatedAt || driver.createdAt || state.meta.createdAt || now(),
      earningsToday: driver.earningsToday || 0,
      createdAt: driver.createdAt || state.meta.createdAt || now()
    });
    insertVehicle.run({
      id: `${driver.id}_vehicle`,
      driverId: driver.id,
      kind: driver.activeService === "ride" ? "car" : "delivery",
      model: driver.vehicle,
      plate: driver.plate,
      color: "Negro",
      active: 1
    });
  }

  const insertOrder = database.prepare(`
    INSERT INTO orders (
      id, customer_id, restaurant_id, courier_id, status, delivery_address, payment_method,
      subtotal, delivery_fee, service_fee, total, eta_min, created_at
    ) VALUES (
      @id, @customerId, @restaurantId, @courierId, @status, @deliveryAddress, @paymentMethod,
      @subtotal, @deliveryFee, @serviceFee, @total, @etaMin, @createdAt
    )
  `);
  const insertOrderItem = database.prepare(`
    INSERT INTO order_items (id, order_id, menu_item_id, name, quantity, unit_price, note)
    VALUES (@id, @orderId, @menuItemId, @name, @quantity, @unitPrice, @note)
  `);
  const insertOrderExtra = database.prepare(`
    INSERT INTO order_item_extras (order_item_id, extra_name) VALUES (?, ?)
  `);
  const insertOrderTimeline = database.prepare(`
    INSERT INTO order_timeline (id, order_id, status, at) VALUES (@id, @orderId, @status, @at)
  `);

  for (const order of state.orders || []) {
    insertOrder.run({ ...order, courierId: order.courierId || null });
    for (const [index, item] of (order.items || []).entries()) {
      const orderItemId = `${order.id}_item_${index}`;
      insertOrderItem.run({
        id: orderItemId,
        orderId: order.id,
        ...item
      });
      for (const extra of item.extras || []) {
        insertOrderExtra.run(orderItemId, extra);
      }
    }
    for (const [index, entry] of (order.timeline || []).entries()) {
      insertOrderTimeline.run({
        id: `${order.id}_timeline_${index}`,
        orderId: order.id,
        status: entry.status,
        at: entry.at
      });
    }
  }

  const insertRide = database.prepare(`
    INSERT INTO rides (
      id, customer_id, driver_id, status, service, pickup, destination, distance_km, eta_min,
      pickup_lat, pickup_lng, destination_lat, destination_lng, duration_min, fare, payment_method, created_at
    ) VALUES (
      @id, @customerId, @driverId, @status, @service, @pickup, @destination, @distanceKm, @etaMin,
      @pickupLat, @pickupLng, @destinationLat, @destinationLng, @durationMin, @fare, @paymentMethod, @createdAt
    )
  `);
  const insertRideTimeline = database.prepare(`
    INSERT INTO ride_timeline (id, ride_id, status, at) VALUES (@id, @rideId, @status, @at)
  `);
  for (const ride of state.rides || []) {
    insertRide.run({
      ...ride,
      driverId: ride.driverId || null,
      pickupLat: ride.pickupLocation?.lat ?? null,
      pickupLng: ride.pickupLocation?.lng ?? null,
      destinationLat: ride.destinationLocation?.lat ?? null,
      destinationLng: ride.destinationLocation?.lng ?? null
    });
    for (const [index, entry] of (ride.timeline || []).entries()) {
      insertRideTimeline.run({
        id: `${ride.id}_timeline_${index}`,
        rideId: ride.id,
        status: entry.status,
        at: entry.at
      });
    }
  }

  const insertShipment = database.prepare(`
    INSERT INTO shipments (
      id, customer_id, driver_id, status, pickup, destination, pickup_lat, pickup_lng,
      destination_lat, destination_lng, recipient_name, recipient_phone, package_size,
      description, weight_kg, delivery_notes, distance_km, eta_min, fare, payment_method,
      delivery_pin, created_at
    ) VALUES (
      @id, @customerId, @driverId, @status, @pickup, @destination, @pickupLat, @pickupLng,
      @destinationLat, @destinationLng, @recipientName, @recipientPhone, @packageSize,
      @description, @weightKg, @deliveryNotes, @distanceKm, @etaMin, @fare, @paymentMethod,
      @deliveryPin, @createdAt
    )
  `);
  const insertShipmentTimeline = database.prepare(`
    INSERT INTO shipment_timeline (id, shipment_id, status, at)
    VALUES (@id, @shipmentId, @status, @at)
  `);
  for (const shipment of state.shipments || []) {
    insertShipment.run({
      ...shipment,
      driverId: shipment.driverId || null,
      pickupLat: shipment.pickupLocation?.lat ?? null,
      pickupLng: shipment.pickupLocation?.lng ?? null,
      destinationLat: shipment.destinationLocation?.lat ?? null,
      destinationLng: shipment.destinationLocation?.lng ?? null,
      deliveryNotes: shipment.deliveryNotes || ""
    });
    for (const [index, entry] of (shipment.timeline || []).entries()) {
      insertShipmentTimeline.run({
        id: `${shipment.id}_timeline_${index}`,
        shipmentId: shipment.id,
        status: entry.status,
        at: entry.at
      });
    }
  }

  const insertPromotion = database.prepare(`
    INSERT INTO promotions (id, title, description, service, discount_percent, active)
    VALUES (@id, @title, @description, @service, @discountPercent, @active)
  `);
  for (const promotion of state.promotions || []) {
    insertPromotion.run({ ...promotion, active: boolToInt(promotion.active) });
  }

  const insertTicket = database.prepare(`
    INSERT INTO support_tickets (id, service, status, title, priority)
    VALUES (@id, @service, @status, @title, @priority)
  `);
  for (const ticket of state.supportTickets || []) {
    insertTicket.run(ticket);
  }

  const insertRating = database.prepare(`
    INSERT INTO ratings (id, target_type, target_id, user_id, score, comment, created_at)
    VALUES (@id, @targetType, @targetId, @userId, @score, @comment, @createdAt)
  `);
  for (const rating of state.ratings || []) {
    insertRating.run(rating);
  }

  const insertZone = database.prepare(`
    INSERT INTO zones (
      id, name, demand_level, delivery_multiplier, ride_multiplier, active_orders, active_rides
    ) VALUES (
      @id, @name, @demandLevel, @deliveryMultiplier, @rideMultiplier, @activeOrders, @activeRides
    )
  `);
  for (const zone of state.zones || []) {
    insertZone.run(zone);
  }

  const insertAudit = database.prepare(`
    INSERT INTO audit_events (id, actor_id, entity_type, entity_id, action, payload_json, created_at)
    VALUES (@id, @actorId, @entityType, @entityId, @action, @payloadJson, @createdAt)
  `);
  for (const event of state.auditEvents || []) {
    insertAudit.run({
      ...event,
      actorId: event.actorId || null,
      payloadJson: JSON.stringify(event.payload || {})
    });
  }
});

function seedIfNeeded() {
  execSchema();
  ensureSchemaColumns();
  const count = database.prepare("SELECT COUNT(*) AS total FROM users").get().total;
  if (count === 0) {
    replaceTransaction(createSeed());
  }
}

seedIfNeeded();

function readUsers() {
  const roles = database.prepare("SELECT user_id, role FROM user_roles").all();
  return database.prepare("SELECT * FROM users ORDER BY created_at").all().map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    password: row.password_hash,
    roles: roles.filter((role) => role.user_id === row.id).map((role) => role.role),
    phone: row.phone || "",
    wallet: row.wallet,
    defaultAddress: row.default_address || "",
    restaurantId: row.restaurant_id || undefined,
    driverId: row.driver_id || undefined
  }));
}

function readRestaurants() {
  const extras = database.prepare("SELECT * FROM restaurant_extras ORDER BY rowid").all();
  const menuRows = database.prepare("SELECT * FROM menu_items ORDER BY created_at, rowid").all();
  const tags = database.prepare("SELECT * FROM menu_item_tags").all();
  return database.prepare("SELECT * FROM restaurants ORDER BY rowid").all().map((row) => ({
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    cuisine: row.cuisine,
    rating: row.rating,
    distanceKm: row.distance_km,
    etaMin: row.eta_min,
    deliveryFee: row.delivery_fee,
    open: rowBool(row.open),
    image: row.image,
    cover: row.cover,
    badge: row.badge,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    menu: menuRows
      .filter((item) => item.restaurant_id === row.id)
      .map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description || "",
        category: item.category,
        price: item.price,
        rating: item.rating,
        timeMin: item.time_min,
        kcal: item.kcal,
        stock: rowBool(item.stock),
        image: item.image,
        tags: tags.filter((tag) => tag.menu_item_id === item.id).map((tag) => tag.tag)
      })),
    extras: extras
      .filter((extra) => extra.restaurant_id === row.id)
      .map((extra) => ({
        id: extra.id,
        name: extra.name,
        price: extra.price
      }))
  }));
}

function readDrivers() {
  const vehicles = database.prepare("SELECT * FROM vehicles WHERE active = 1").all();
  return database.prepare("SELECT * FROM drivers ORDER BY rowid").all().map((row) => {
    const vehicle = vehicles.find((entry) => entry.driver_id === row.id);
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      online: rowBool(row.online),
      serviceModes: JSON.parse(row.service_modes || "[]"),
      activeService: row.active_service,
      vehicle: vehicle?.model || "",
      plate: vehicle?.plate || "",
      rating: row.rating,
      location: {
        lat: row.lat,
        lng: row.lng,
        label: row.location_label,
        updatedAt: row.location_updated_at || null
      },
      earningsToday: row.earnings_today
    };
  });
}

function readOrders() {
  const items = database.prepare("SELECT * FROM order_items ORDER BY rowid").all();
  const extras = database.prepare("SELECT * FROM order_item_extras").all();
  const timelines = database.prepare("SELECT * FROM order_timeline ORDER BY at, rowid").all();
  return database.prepare("SELECT * FROM orders ORDER BY created_at DESC, rowid DESC").all().map((row) => ({
    id: row.id,
    customerId: row.customer_id,
    restaurantId: row.restaurant_id,
    courierId: row.courier_id,
    status: row.status,
    deliveryAddress: row.delivery_address,
    paymentMethod: row.payment_method,
    items: items
      .filter((item) => item.order_id === row.id)
      .map((item) => ({
        menuItemId: item.menu_item_id,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        extras: extras
          .filter((extra) => extra.order_item_id === item.id)
          .map((extra) => extra.extra_name),
        note: item.note || ""
      })),
    subtotal: row.subtotal,
    deliveryFee: row.delivery_fee,
    serviceFee: row.service_fee,
    total: row.total,
    etaMin: row.eta_min,
    createdAt: row.created_at,
    timeline: timelines
      .filter((entry) => entry.order_id === row.id)
      .map((entry) => ({
        status: entry.status,
        at: entry.at
      }))
  }));
}

function readRides() {
  const timelines = database.prepare("SELECT * FROM ride_timeline ORDER BY at, rowid").all();
  return database.prepare("SELECT * FROM rides ORDER BY created_at DESC, rowid DESC").all().map((row) => ({
    id: row.id,
    customerId: row.customer_id,
    driverId: row.driver_id,
    status: row.status,
    service: row.service,
    pickup: row.pickup,
    destination: row.destination,
    pickupLocation:
      row.pickup_lat == null || row.pickup_lng == null
        ? null
        : { lat: row.pickup_lat, lng: row.pickup_lng },
    destinationLocation:
      row.destination_lat == null || row.destination_lng == null
        ? null
        : { lat: row.destination_lat, lng: row.destination_lng },
    distanceKm: row.distance_km,
    etaMin: row.eta_min,
    durationMin: row.duration_min,
    fare: row.fare,
    paymentMethod: row.payment_method,
    createdAt: row.created_at,
    timeline: timelines
      .filter((entry) => entry.ride_id === row.id)
      .map((entry) => ({
        status: entry.status,
        at: entry.at
      }))
  }));
}

function readShipments() {
  const timelines = database.prepare("SELECT * FROM shipment_timeline ORDER BY at, rowid").all();
  return database.prepare("SELECT * FROM shipments ORDER BY created_at DESC, rowid DESC").all().map((row) => ({
    id: row.id,
    customerId: row.customer_id,
    driverId: row.driver_id,
    status: row.status,
    pickup: row.pickup,
    destination: row.destination,
    pickupLocation: row.pickup_lat == null ? null : { lat: row.pickup_lat, lng: row.pickup_lng },
    destinationLocation: row.destination_lat == null ? null : { lat: row.destination_lat, lng: row.destination_lng },
    recipientName: row.recipient_name,
    recipientPhone: row.recipient_phone,
    packageSize: row.package_size,
    description: row.description,
    weightKg: row.weight_kg,
    deliveryNotes: row.delivery_notes || "",
    distanceKm: row.distance_km,
    etaMin: row.eta_min,
    fare: row.fare,
    paymentMethod: row.payment_method,
    deliveryPin: row.delivery_pin,
    createdAt: row.created_at,
    timeline: timelines.filter((entry) => entry.shipment_id === row.id).map((entry) => ({ status: entry.status, at: entry.at }))
  }));
}

function sanitize(dbState) {
  return {
    ...dbState,
    users: dbState.users.map(({ password, ...user }) => user)
  };
}

export function readDb() {
  seedIfNeeded();
  return {
    meta: getMeta(),
    users: readUsers(),
    addresses: database.prepare("SELECT * FROM user_addresses ORDER BY rowid").all().map((row) => ({
      id: row.id,
      userId: row.user_id,
      label: row.label,
      address: row.address,
      lat: row.lat,
      lng: row.lng,
      isDefault: rowBool(row.is_default)
    })),
    paymentMethods: database.prepare("SELECT * FROM payment_methods ORDER BY rowid").all().map((row) => ({
      id: row.id,
      userId: row.user_id,
      type: row.type,
      label: row.label,
      last4: row.last4,
      balance: row.balance,
      isDefault: rowBool(row.is_default)
    })),
    walletTransactions: database.prepare("SELECT * FROM wallet_transactions ORDER BY created_at DESC").all().map((row) => ({
      id: row.id,
      userId: row.user_id,
      kind: row.kind,
      amount: row.amount,
      description: row.description,
      createdAt: row.created_at
    })),
    restaurants: readRestaurants(),
    drivers: readDrivers(),
    orders: readOrders(),
    rides: readRides(),
    shipments: readShipments(),
    promotions: database.prepare("SELECT * FROM promotions ORDER BY rowid").all().map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      service: row.service,
      discountPercent: row.discount_percent,
      active: rowBool(row.active)
    })),
    supportTickets: database.prepare("SELECT * FROM support_tickets ORDER BY rowid").all().map((row) => ({
      id: row.id,
      service: row.service,
      status: row.status,
      title: row.title,
      priority: row.priority
    })),
    ratings: database.prepare("SELECT * FROM ratings ORDER BY created_at DESC").all().map((row) => ({
      id: row.id,
      targetType: row.target_type,
      targetId: row.target_id,
      userId: row.user_id,
      score: row.score,
      comment: row.comment,
      createdAt: row.created_at
    })),
    zones: database.prepare("SELECT * FROM zones ORDER BY rowid").all().map((row) => ({
      id: row.id,
      name: row.name,
      demandLevel: row.demand_level,
      deliveryMultiplier: row.delivery_multiplier,
      rideMultiplier: row.ride_multiplier,
      activeOrders: row.active_orders,
      activeRides: row.active_rides
    })),
    auditEvents: database.prepare("SELECT * FROM audit_events ORDER BY created_at DESC").all().map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      action: row.action,
      payload: JSON.parse(row.payload_json || "{}"),
      createdAt: row.created_at
    }))
  };
}

export function writeDb(dbState) {
  const next = {
    ...dbState,
    meta: {
      ...dbState.meta,
      version: Math.max(Number(dbState.meta?.version || 0), 5),
      updatedAt: now(),
      database: "sqlite"
    }
  };
  replaceTransaction(next);
  return next;
}

export function resetDb() {
  const seed = createSeed();
  replaceTransaction(seed);
  return sanitize(seed);
}

export function getPublicState() {
  return sanitize(readDb());
}

export function getTimestamp() {
  return now();
}

export function getDatabasePath() {
  return sqlitePath;
}

const hashRefreshToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

export function createAuthSession(userId, deviceName = "unknown") {
  const id = createId("SES");
  const refreshToken = crypto.randomBytes(48).toString("base64url");
  const createdAt = now();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  database.prepare(`
    INSERT INTO auth_sessions (id, user_id, refresh_token_hash, device_name, expires_at, revoked_at, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?)
  `).run(id, userId, hashRefreshToken(refreshToken), String(deviceName).slice(0, 160), expiresAt, createdAt);
  return { id, refreshToken, expiresAt };
}

export function consumeAuthSession(refreshToken, deviceName = "unknown") {
  const tokenHash = hashRefreshToken(String(refreshToken || ""));
  const session = database.prepare(`
    SELECT * FROM auth_sessions
    WHERE refresh_token_hash = ? AND revoked_at IS NULL AND expires_at > ?
  `).get(tokenHash, now());
  if (!session) return null;
  const replacement = database.transaction(() => {
    database.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ?").run(now(), session.id);
    return createAuthSession(session.user_id, deviceName || session.device_name);
  })();
  return { userId: session.user_id, ...replacement };
}

export function revokeAuthSession(refreshToken) {
  const result = database.prepare(`
    UPDATE auth_sessions SET revoked_at = ?
    WHERE refresh_token_hash = ? AND revoked_at IS NULL
  `).run(now(), hashRefreshToken(String(refreshToken || "")));
  return result.changes > 0;
}
