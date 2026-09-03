// Preferencias e inbox locales del fallback SQLite (ARC-001).
//
// Notificaciones, dieta y analítica de producto en el respaldo sin Postgres.
// Separadas del núcleo readDb/writeDb y de las sesiones de auth locales.
import { createId, getStoreDatabase, notificationPreferenceCategories } from "./store.js";

const boolToInt = (value) => (value ? 1 : 0);
const rowBool = (value) => Boolean(value);

function ensureLocalNotificationPreferences(userId) {
  const insert = getStoreDatabase().prepare(`
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
  return getStoreDatabase()
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
  const result = getStoreDatabase()
    .prepare(
      `
    UPDATE notifications
    SET status = 'read', read_at = COALESCE(read_at, ?)
    WHERE id = ? AND user_id = ?
  `,
    )
    .run(new Date().toISOString(), notificationId, userId);
  if (result.changes === 0) {
    throw Object.assign(new Error("Notificación no encontrada"), { status: 404 });
  }
  return getLocalNotifications(userId);
}

export function getLocalNotificationPreferences(userId) {
  ensureLocalNotificationPreferences(userId);
  return getStoreDatabase()
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
  getStoreDatabase()
    .prepare(
      `
    UPDATE notification_preferences
    SET push_enabled = ?, email_enabled = ?, updated_at = ?
    WHERE user_id = ? AND category = ?
  `,
    )
    .run(
      boolToInt(pushEnabled),
      boolToInt(emailEnabled),
      new Date().toISOString(),
      userId,
      category,
    );
  return getLocalNotificationPreferences(userId);
}

export function getLocalDietaryPreferences(userId) {
  const row = getStoreDatabase()
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
  getStoreDatabase()
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
      new Date().toISOString(),
    );
  return getLocalDietaryPreferences(userId);
}

export function createLocalProductEvents({ userId, events }) {
  const insert = getStoreDatabase().prepare(`
    INSERT OR IGNORE INTO product_events (
      public_id, user_id, name, surface, session_id, properties_json, occurred_at, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = getStoreDatabase().transaction((batch) => {
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
        new Date().toISOString(),
      ).changes;
    }
    return accepted;
  });
  const accepted = insertMany(events);
  return { accepted, duplicates: events.length - accepted };
}

export function getLocalProductMetrics({ days = 7 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = getStoreDatabase()
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
  return getStoreDatabase()
    .prepare(`DELETE FROM product_events WHERE public_id IN (${placeholders})`)
    .run(...ids).changes;
}

export function pruneLocalProductEvents({ retentionDays = 90 } = {}) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const result = getStoreDatabase()
    .prepare("DELETE FROM product_events WHERE received_at < ?")
    .run(cutoff);
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
    const existing = getStoreDatabase()
      .prepare(
        "SELECT id FROM notifications WHERE user_id = ? AND template = ? AND payload_json = ? LIMIT 1",
      )
      .get(userId, template, JSON.stringify(payload));
    if (existing) return existing.id;
  }
  const id = createId("NTF");
  getStoreDatabase()
    .prepare(
      `
    INSERT INTO notifications (id, user_id, channel, template, payload_json, status, read_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
  `,
    )
    .run(id, userId, channel, template, JSON.stringify(payload), status, new Date().toISOString());
  return id;
}
