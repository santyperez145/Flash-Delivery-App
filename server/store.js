import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { execSchema, ensureSchemaColumns } from "./store-schema.js";
import { createSeed, ensureBootstrapSupportUser, ensureLocalNotificationData } from "./store-seed.js";

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
  "cancelled",
];

export const rideStatuses = [
  "requested",
  "driver_assigned",
  "arriving",
  "in_progress",
  "completed",
  "cancelled",
];

export const shipmentStatuses = [
  "requested",
  "driver_assigned",
  "arriving",
  "picked_up",
  "delivering",
  "delivered",
  "cancelled",
];

const now = () => new Date().toISOString();

export const notificationPreferenceCategories = [
  "service_updates",
  "promotions",
  "support",
  "wallet",
  "account",
];

export const createId = (prefix) =>
  `${prefix}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

const asset = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=80`;

let databaseInstance = null;

function openDatabase() {
  if (databaseInstance) {
    return databaseInstance;
  }
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  databaseInstance = new Database(sqlitePath);
  databaseInstance.pragma("journal_mode = WAL");
  databaseInstance.pragma("foreign_keys = ON");
  seedIfNeeded();
  return databaseInstance;
}

const database = new Proxy(
  {},
  {
    get(_target, prop) {
      const db = openDatabase();
      const value = db[prop];
      return typeof value === "function" ? value.bind(db) : value;
    },
  },
);


function boolToInt(value) {
  return value ? 1 : 0;
}

function rowBool(value) {
  return Boolean(value);
}

function getMeta() {
  return Object.fromEntries(
    database
      .prepare("SELECT key, value FROM meta")
      .all()
      .map((row) => [row.key, JSON.parse(row.value)]),
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
    DELETE FROM product_events;
    DELETE FROM audit_events;
    DELETE FROM notifications;
    DELETE FROM notification_preferences;
    DELETE FROM dietary_preferences;
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

let replaceTransactionFn;

function replaceTransaction(state) {
  if (!replaceTransactionFn) {
    replaceTransactionFn = openDatabase().transaction((state) => {
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
          createdAt: user.createdAt || state.meta.createdAt || now(),
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
      const insertTag = database.prepare(
        "INSERT INTO menu_item_tags (menu_item_id, tag) VALUES (?, ?)",
      );

      for (const restaurant of state.restaurants) {
        insertRestaurant.run({
          ...restaurant,
          open: boolToInt(restaurant.open),
          lat: restaurant.lat || null,
          lng: restaurant.lng || null,
          createdAt: restaurant.createdAt || state.meta.createdAt || now(),
        });
        for (let weekday = 0; weekday < 7; weekday += 1) {
          insertHour.run({
            id: `${restaurant.id}_hour_${weekday}`,
            restaurantId: restaurant.id,
            weekday,
            opensAt: "10:00",
            closesAt: "23:30",
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
            createdAt: item.createdAt || state.meta.createdAt || now(),
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
          locationUpdatedAt:
            driver.location?.updatedAt || driver.createdAt || state.meta.createdAt || now(),
          earningsToday: driver.earningsToday || 0,
          createdAt: driver.createdAt || state.meta.createdAt || now(),
        });
        insertVehicle.run({
          id: `${driver.id}_vehicle`,
          driverId: driver.id,
          kind: driver.activeService === "ride" ? "car" : "delivery",
          model: driver.vehicle,
          plate: driver.plate,
          color: "Negro",
          active: 1,
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
            ...item,
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
            at: entry.at,
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
          destinationLng: ride.destinationLocation?.lng ?? null,
        });
        for (const [index, entry] of (ride.timeline || []).entries()) {
          insertRideTimeline.run({
            id: `${ride.id}_timeline_${index}`,
            rideId: ride.id,
            status: entry.status,
            at: entry.at,
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
          deliveryNotes: shipment.deliveryNotes || "",
        });
        for (const [index, entry] of (shipment.timeline || []).entries()) {
          insertShipmentTimeline.run({
            id: `${shipment.id}_timeline_${index}`,
            shipmentId: shipment.id,
            status: entry.status,
            at: entry.at,
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
          payloadJson: JSON.stringify(event.payload || {}),
        });
      }

      const insertNotification = database.prepare(`
    INSERT INTO notifications (id, user_id, channel, template, payload_json, status, read_at, created_at)
    VALUES (@id, @userId, @channel, @template, @payloadJson, @status, @readAt, @createdAt)
  `);
      for (const notification of state.notifications || []) {
        insertNotification.run({
          ...notification,
          payloadJson: JSON.stringify(notification.payload || {}),
          readAt: notification.readAt || null,
        });
      }

      const insertNotificationPreference = database.prepare(`
    INSERT INTO notification_preferences (user_id, category, push_enabled, email_enabled, updated_at)
    VALUES (@userId, @category, @pushEnabled, @emailEnabled, @updatedAt)
  `);
      for (const preference of state.notificationPreferences || []) {
        insertNotificationPreference.run({
          ...preference,
          pushEnabled: boolToInt(preference.pushEnabled),
          emailEnabled: boolToInt(preference.emailEnabled),
          updatedAt: preference.updatedAt || null,
        });
      }

      const insertDietaryPreference = database.prepare(`
    INSERT INTO dietary_preferences (
      user_id, dietary_labels_json, avoided_allergens_json, hide_incompatible, updated_at
    ) VALUES (@userId, @dietaryLabelsJson, @avoidedAllergensJson, @hideIncompatible, @updatedAt)
  `);
      for (const preference of state.dietaryPreferences || []) {
        insertDietaryPreference.run({
          userId: preference.userId,
          dietaryLabelsJson: JSON.stringify(preference.dietaryLabels || []),
          avoidedAllergensJson: JSON.stringify(preference.avoidedAllergens || []),
          hideIncompatible: boolToInt(preference.hideIncompatible),
          updatedAt: preference.updatedAt || null,
        });
      }
    });
  }
  return replaceTransactionFn(state);
}


function seedIfNeeded() {
  execSchema(database);
  ensureSchemaColumns(database);
  const count = database.prepare("SELECT COUNT(*) AS total FROM users").get().total;
  if (count === 0) {
    replaceTransaction(createSeed(now));
  }
  ensureBootstrapSupportUser(database, now);
  ensureLocalNotificationData(database, now);
}

function readUsers() {
  const roles = database.prepare("SELECT user_id, role FROM user_roles").all();
  return database
    .prepare("SELECT * FROM users ORDER BY created_at")
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      password: row.password_hash,
      roles: roles.filter((role) => role.user_id === row.id).map((role) => role.role),
      phone: row.phone || "",
      wallet: row.wallet,
      defaultAddress: row.default_address || "",
      restaurantId: row.restaurant_id || undefined,
      driverId: row.driver_id || undefined,
    }));
}

function readRestaurants() {
  const extras = database.prepare("SELECT * FROM restaurant_extras ORDER BY rowid").all();
  const menuRows = database.prepare("SELECT * FROM menu_items ORDER BY created_at, rowid").all();
  const tags = database.prepare("SELECT * FROM menu_item_tags").all();
  return database
    .prepare("SELECT * FROM restaurants ORDER BY rowid")
    .all()
    .map((row) => ({
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
          tags: tags.filter((tag) => tag.menu_item_id === item.id).map((tag) => tag.tag),
        })),
      extras: extras
        .filter((extra) => extra.restaurant_id === row.id)
        .map((extra) => ({
          id: extra.id,
          name: extra.name,
          price: extra.price,
        })),
    }));
}

function readDrivers() {
  const vehicles = database.prepare("SELECT * FROM vehicles WHERE active = 1").all();
  return database
    .prepare("SELECT * FROM drivers ORDER BY rowid")
    .all()
    .map((row) => {
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
          updatedAt: row.location_updated_at || null,
        },
        earningsToday: row.earnings_today,
      };
    });
}

function readOrders() {
  const items = database.prepare("SELECT * FROM order_items ORDER BY rowid").all();
  const extras = database.prepare("SELECT * FROM order_item_extras").all();
  const timelines = database.prepare("SELECT * FROM order_timeline ORDER BY at, rowid").all();
  return database
    .prepare("SELECT * FROM orders ORDER BY created_at DESC, rowid DESC")
    .all()
    .map((row) => ({
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
          note: item.note || "",
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
          at: entry.at,
        })),
    }));
}

function readRides() {
  const timelines = database.prepare("SELECT * FROM ride_timeline ORDER BY at, rowid").all();
  return database
    .prepare("SELECT * FROM rides ORDER BY created_at DESC, rowid DESC")
    .all()
    .map((row) => ({
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
          at: entry.at,
        })),
    }));
}

function readShipments() {
  const timelines = database.prepare("SELECT * FROM shipment_timeline ORDER BY at, rowid").all();
  return database
    .prepare("SELECT * FROM shipments ORDER BY created_at DESC, rowid DESC")
    .all()
    .map((row) => ({
      id: row.id,
      customerId: row.customer_id,
      driverId: row.driver_id,
      status: row.status,
      pickup: row.pickup,
      destination: row.destination,
      pickupLocation: row.pickup_lat == null ? null : { lat: row.pickup_lat, lng: row.pickup_lng },
      destinationLocation:
        row.destination_lat == null ? null : { lat: row.destination_lat, lng: row.destination_lng },
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
      timeline: timelines
        .filter((entry) => entry.shipment_id === row.id)
        .map((entry) => ({ status: entry.status, at: entry.at })),
    }));
}

function sanitize(dbState) {
  return {
    ...dbState,
    users: dbState.users.map(({ password, ...user }) => user),
  };
}

export function readDb() {
  seedIfNeeded();
  return {
    meta: getMeta(),
    users: readUsers(),
    addresses: database
      .prepare("SELECT * FROM user_addresses ORDER BY rowid")
      .all()
      .map((row) => ({
        id: row.id,
        userId: row.user_id,
        label: row.label,
        address: row.address,
        lat: row.lat,
        lng: row.lng,
        isDefault: rowBool(row.is_default),
      })),
    paymentMethods: database
      .prepare("SELECT * FROM payment_methods ORDER BY rowid")
      .all()
      .map((row) => ({
        id: row.id,
        userId: row.user_id,
        type: row.type,
        label: row.label,
        last4: row.last4,
        balance: row.balance,
        isDefault: rowBool(row.is_default),
      })),
    walletTransactions: database
      .prepare("SELECT * FROM wallet_transactions ORDER BY created_at DESC")
      .all()
      .map((row) => ({
        id: row.id,
        userId: row.user_id,
        kind: row.kind,
        amount: row.amount,
        description: row.description,
        createdAt: row.created_at,
      })),
    restaurants: readRestaurants(),
    drivers: readDrivers(),
    orders: readOrders(),
    rides: readRides(),
    shipments: readShipments(),
    promotions: database
      .prepare("SELECT * FROM promotions ORDER BY rowid")
      .all()
      .map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        service: row.service,
        discountPercent: row.discount_percent,
        active: rowBool(row.active),
      })),
    supportTickets: database
      .prepare("SELECT * FROM support_tickets ORDER BY rowid")
      .all()
      .map((row) => ({
        id: row.id,
        service: row.service,
        status: row.status,
        title: row.title,
        priority: row.priority,
      })),
    notifications: database
      .prepare("SELECT * FROM notifications ORDER BY created_at DESC, rowid DESC")
      .all()
      .map((row) => ({
        id: row.id,
        userId: row.user_id,
        channel: row.channel,
        template: row.template,
        payload: JSON.parse(row.payload_json || "{}"),
        status: row.status,
        readAt: row.read_at,
        createdAt: row.created_at,
      })),
    notificationPreferences: database
      .prepare("SELECT * FROM notification_preferences ORDER BY user_id, category")
      .all()
      .map((row) => ({
        userId: row.user_id,
        category: row.category,
        pushEnabled: rowBool(row.push_enabled),
        emailEnabled: rowBool(row.email_enabled),
        updatedAt: row.updated_at,
      })),
    dietaryPreferences: database
      .prepare("SELECT * FROM dietary_preferences ORDER BY user_id")
      .all()
      .map((row) => ({
        userId: row.user_id,
        dietaryLabels: JSON.parse(row.dietary_labels_json || "[]"),
        avoidedAllergens: JSON.parse(row.avoided_allergens_json || "[]"),
        hideIncompatible: rowBool(row.hide_incompatible),
        updatedAt: row.updated_at,
      })),
    ratings: database
      .prepare("SELECT * FROM ratings ORDER BY created_at DESC")
      .all()
      .map((row) => ({
        id: row.id,
        targetType: row.target_type,
        targetId: row.target_id,
        userId: row.user_id,
        score: row.score,
        comment: row.comment,
        createdAt: row.created_at,
      })),
    zones: database
      .prepare("SELECT * FROM zones ORDER BY rowid")
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        demandLevel: row.demand_level,
        deliveryMultiplier: row.delivery_multiplier,
        rideMultiplier: row.ride_multiplier,
        activeOrders: row.active_orders,
        activeRides: row.active_rides,
      })),
    auditEvents: database
      .prepare("SELECT * FROM audit_events ORDER BY created_at DESC")
      .all()
      .map((row) => ({
        id: row.id,
        actorId: row.actor_id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        action: row.action,
        payload: JSON.parse(row.payload_json || "{}"),
        createdAt: row.created_at,
      })),
  };
}

export function writeDb(dbState) {
  const next = {
    ...dbState,
    meta: {
      ...dbState.meta,
      version: Math.max(Number(dbState.meta?.version || 0), 5),
      updatedAt: now(),
      database: "sqlite",
    },
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

function ensureLocalNotificationPreferences(userId) {
  const insert = database.prepare(`
    INSERT OR IGNORE INTO notification_preferences (user_id, category, push_enabled, email_enabled, updated_at)
    VALUES (?, ?, ?, 0, NULL)
  `);
  for (const category of notificationPreferenceCategories) {
    insert.run(userId, category, category === "promotions" ? 0 : 1);
  }
}

function mapLocalNotification(row) {
  return {
    id: row.id,
    channel: row.channel,
    template: row.template,
    payload: JSON.parse(row.payload_json || "{}"),
    status: row.status,
    createdAt: row.created_at,
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
  };
}

export function getLocalNotifications(userId) {
  return database
    .prepare(
      `
    SELECT id, channel, template, payload_json, status, created_at, read_at
    FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC, rowid DESC
    LIMIT 100
  `,
    )
    .all(userId)
    .map(mapLocalNotification);
}

export function markLocalNotificationRead({ userId, notificationId }) {
  const result = database
    .prepare(
      `
    UPDATE notifications
    SET status = 'read', read_at = COALESCE(read_at, ?)
    WHERE id = ? AND user_id = ?
  `,
    )
    .run(now(), notificationId, userId);
  if (result.changes === 0) {
    throw Object.assign(new Error("Notificación no encontrada"), { status: 404 });
  }
  return getLocalNotifications(userId);
}

export function getLocalNotificationPreferences(userId) {
  ensureLocalNotificationPreferences(userId);
  return database
    .prepare(
      `
    SELECT category, push_enabled, email_enabled, updated_at
    FROM notification_preferences
    WHERE user_id = ?
    ORDER BY category
  `,
    )
    .all(userId)
    .map((row) => ({
      category: row.category,
      pushEnabled: rowBool(row.push_enabled),
      emailEnabled: rowBool(row.email_enabled),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    }));
}

export function updateLocalNotificationPreference({ userId, category, pushEnabled, emailEnabled }) {
  ensureLocalNotificationPreferences(userId);
  database
    .prepare(
      `
    UPDATE notification_preferences
    SET push_enabled = ?, email_enabled = ?, updated_at = ?
    WHERE user_id = ? AND category = ?
  `,
    )
    .run(boolToInt(pushEnabled), boolToInt(emailEnabled), now(), userId, category);
  return getLocalNotificationPreferences(userId);
}

export function getLocalDietaryPreferences(userId) {
  const row = database
    .prepare(
      `
    SELECT dietary_labels_json, avoided_allergens_json, hide_incompatible
    FROM dietary_preferences
    WHERE user_id = ?
  `,
    )
    .get(userId);
  if (!row) return { dietaryLabels: [], avoidedAllergens: [], hideIncompatible: false };
  return {
    dietaryLabels: JSON.parse(row.dietary_labels_json || "[]"),
    avoidedAllergens: JSON.parse(row.avoided_allergens_json || "[]"),
    hideIncompatible: rowBool(row.hide_incompatible),
  };
}

export function replaceLocalDietaryPreferences({
  userId,
  dietaryLabels,
  avoidedAllergens,
  hideIncompatible,
}) {
  database
    .prepare(
      `
    INSERT INTO dietary_preferences (
      user_id, dietary_labels_json, avoided_allergens_json, hide_incompatible, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      dietary_labels_json = excluded.dietary_labels_json,
      avoided_allergens_json = excluded.avoided_allergens_json,
      hide_incompatible = excluded.hide_incompatible,
      updated_at = excluded.updated_at
  `,
    )
    .run(
      userId,
      JSON.stringify(dietaryLabels),
      JSON.stringify(avoidedAllergens),
      boolToInt(hideIncompatible),
      now(),
    );
  return getLocalDietaryPreferences(userId);
}

export function createLocalProductEvents({ userId, events }) {
  const insert = database.prepare(`
    INSERT OR IGNORE INTO product_events (
      public_id, user_id, name, surface, session_id, properties_json, occurred_at, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = database.transaction((batch) => {
    let accepted = 0;
    for (const event of batch) {
      accepted += insert.run(
        event.id,
        userId,
        event.name,
        event.surface,
        event.sessionId,
        JSON.stringify(event.properties || {}),
        event.occurredAt,
        now(),
      ).changes;
    }
    return accepted;
  });
  const accepted = insertMany(events);
  return { accepted, duplicates: events.length - accepted };
}

export function getLocalProductMetrics({ days = 7 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = database
    .prepare(
      `
    SELECT name, user_id
    FROM product_events
    WHERE occurred_at >= ?
  `,
    )
    .all(since);
  const byName = {};
  for (const row of rows) {
    const metric = byName[row.name] || { events: 0, users: new Set() };
    metric.events += 1;
    metric.users.add(row.user_id);
    byName[row.name] = metric;
  }
  const events = Object.fromEntries(
    Object.entries(byName).map(([name, metric]) => [
      name,
      { events: metric.events, users: metric.users.size },
    ]),
  );
  const usersFor = (name) => events[name]?.users || 0;
  const homeUsers = usersFor("home_viewed");
  const checkoutUsers = usersFor("checkout_started");
  const createdUsers = usersFor("job_created");
  return {
    windowDays: days,
    events,
    funnel: {
      homeUsers,
      checkoutUsers,
      createdUsers,
      homeToCheckoutPercent: homeUsers ? Math.round((checkoutUsers / homeUsers) * 1000) / 10 : 0,
      checkoutToCreatedPercent: checkoutUsers
        ? Math.round((createdUsers / checkoutUsers) * 1000) / 10
        : 0,
    },
  };
}

export function deleteLocalProductEvents(ids) {
  if (!ids.length) return 0;
  const placeholders = ids.map(() => "?").join(",");
  return database
    .prepare(`DELETE FROM product_events WHERE public_id IN (${placeholders})`)
    .run(...ids).changes;
}

export function pruneLocalProductEvents({ retentionDays = 90 } = {}) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const result = database.prepare("DELETE FROM product_events WHERE received_at < ?").run(cutoff);
  return { deleted: result.changes, retentionDays };
}

export function createLocalNotification({
  userId,
  channel = "in_app",
  template,
  payload = {},
  status = "sent",
  deduplicationKey,
}) {
  if (deduplicationKey) {
    const existing = database
      .prepare(
        "SELECT id FROM notifications WHERE user_id = ? AND template = ? AND payload_json = ? LIMIT 1",
      )
      .get(userId, template, JSON.stringify(payload));
    if (existing) return existing.id;
  }
  const id = createId("NTF");
  database
    .prepare(
      `
    INSERT INTO notifications (id, user_id, channel, template, payload_json, status, read_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
  `,
    )
    .run(id, userId, channel, template, JSON.stringify(payload), status, now());
  return id;
}

const hashRefreshToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

export function createAuthSession(userId, deviceName = "unknown") {
  const id = createId("SES");
  const refreshToken = crypto.randomBytes(48).toString("base64url");
  const createdAt = now();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  database
    .prepare(
      `
    INSERT INTO auth_sessions (id, user_id, refresh_token_hash, device_name, expires_at, revoked_at, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?)
  `,
    )
    .run(
      id,
      userId,
      hashRefreshToken(refreshToken),
      String(deviceName).slice(0, 160),
      expiresAt,
      createdAt,
    );
  return { id, refreshToken, expiresAt };
}

export function consumeAuthSession(refreshToken, deviceName = "unknown") {
  const tokenHash = hashRefreshToken(String(refreshToken || ""));
  const session = database
    .prepare(
      `
    SELECT * FROM auth_sessions
    WHERE refresh_token_hash = ? AND revoked_at IS NULL AND expires_at > ?
  `,
    )
    .get(tokenHash, now());
  if (!session) return null;
  const replacement = database.transaction(() => {
    database.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ?").run(now(), session.id);
    return createAuthSession(session.user_id, deviceName || session.device_name);
  })();
  return { userId: session.user_id, ...replacement };
}

export function revokeAuthSession(refreshToken) {
  const result = database
    .prepare(
      `
    UPDATE auth_sessions SET revoked_at = ?
    WHERE refresh_token_hash = ? AND revoked_at IS NULL
  `,
    )
    .run(now(), hashRefreshToken(String(refreshToken || "")));
  return result.changes > 0;
}
