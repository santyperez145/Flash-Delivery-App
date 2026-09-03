// Estado SQLite de respaldo: open, seed, read y API pública (ARC-001).
//
// Preferencias → `store-local-preferences.js`. Sesiones → `store-auth-sessions.js`.
// Lectores → `store-entity-readers.js`. Replace → `store-replace-transaction.js`.
// Schema/seed → `store-schema.js` / `store-seed.js`.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { execSchema, ensureSchemaColumns } from "./store-schema.js";
import {
  createSeed,
  ensureBootstrapSupportUser,
  ensureLocalNotificationData,
} from "./store-seed.js";
import {
  readUsers,
  readRestaurants,
  readDrivers,
  readOrders,
  readRides,
  readShipments,
} from "./store-entity-readers.js";
import { createReplaceTransaction } from "./store-replace-transaction.js";

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

export function getStoreDatabase() {
  return openDatabase();
}

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

const replaceTransaction = createReplaceTransaction({
  openDatabase,
  database,
  clearAll,
  setMeta,
  boolToInt,
  now,
});

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
    users: readUsers(database),
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
    restaurants: readRestaurants(database),
    drivers: readDrivers(database),
    orders: readOrders(database),
    rides: readRides(database),
    shipments: readShipments(database),
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
