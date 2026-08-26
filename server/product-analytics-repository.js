import { postgresPool } from "./postgres.js";

export async function ingestProductEvents({ userPublicId, events }) {
  const client = await postgresPool.connect();
  let accepted = 0;
  try {
    await client.query("BEGIN");
    const user = (
      await client.query("SELECT id,city_id FROM users WHERE public_id=$1", [userPublicId])
    ).rows[0];
    if (!user) throw Object.assign(new Error("Usuario no encontrado"), { status: 404 });
    for (const event of events) {
      const result = await client.query(
        `INSERT INTO product_events(public_id,user_id,city_id,name,surface,session_id,properties,occurred_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(public_id) DO NOTHING`,
        [
          event.id,
          user.id,
          user.city_id,
          event.name,
          event.surface,
          event.sessionId,
          event.properties,
          event.occurredAt,
        ],
      );
      accepted += result.rowCount;
    }
    await client.query("COMMIT");
    return { accepted, duplicates: events.length - accepted };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getProductMetrics({ days = 7 }) {
  const result = await postgresPool.query(
    `SELECT name,count(*)::int events,count(DISTINCT user_id)::int users FROM product_events
    WHERE occurred_at>=now()-$1*interval '1 day' GROUP BY name ORDER BY name`,
    [days],
  );
  const byName = Object.fromEntries(
    result.rows.map((row) => [row.name, { events: row.events, users: row.users }]),
  );
  const step = (name) => byName[name]?.users || 0,
    home = step("home_viewed"),
    checkout = step("checkout_started"),
    created = step("job_created");
  return {
    windowDays: days,
    events: byName,
    funnel: {
      homeUsers: home,
      checkoutUsers: checkout,
      createdUsers: created,
      homeToCheckoutPercent: home ? Math.round((checkout / home) * 1000) / 10 : 0,
      checkoutToCreatedPercent: checkout ? Math.round((created / checkout) * 1000) / 10 : 0,
    },
  };
}

export async function pruneProductEvents({ retentionDays = 90 }) {
  const result = await postgresPool.query(
    "DELETE FROM product_events WHERE received_at<now()-$1*interval '1 day'",
    [retentionDays],
  );
  return { deleted: result.rowCount, retentionDays };
}
