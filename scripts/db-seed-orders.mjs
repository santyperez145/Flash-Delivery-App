import { createPool } from "./db-client.mjs";
import { readDb } from "../server/store.js";

const pool = createPool();
const state = readDb();
const client = await pool.connect();
const cents = (amount) => Math.round(Number(amount || 0) * 100);
const jobStatus = (status) =>
  ({ courier_assigned: "driver_assigned", delivered: "completed" })[status] || status;

try {
  await client.query("BEGIN");
  const primaryAuth = await client.query(
    "SELECT password_hash FROM users WHERE public_id = 'usr_driver'",
  );
  for (const [index, driver] of state.drivers.entries()) {
    const publicUserId = index === 0 ? "usr_driver" : `usr_driver_${driver.id}`;
    let user = await client.query("SELECT id FROM users WHERE public_id = $1", [publicUserId]);
    if (!user.rows[0] && primaryAuth.rows[0]) {
      user = await client.query(
        `INSERT INTO users(public_id, email, password_hash, name, phone, profile)
         VALUES ($1, $2, $3, $4, '', $5) ON CONFLICT (public_id) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
        [
          publicUserId,
          `${driver.id}@seed.flash.invalid`,
          primaryAuth.rows[0].password_hash,
          driver.name,
          { driverId: driver.id, wallet: 0, defaultAddress: "" },
        ],
      );
      await client.query(
        "INSERT INTO user_roles(user_id, role) VALUES ($1, 'driver') ON CONFLICT DO NOTHING",
        [user.rows[0].id],
      );
    }
    if (user.rows[0]) {
      await client.query(
        `INSERT INTO drivers(public_id, user_id, online, active_mode, service_modes, rating, current_location, location_updated_at, metadata)
         VALUES ($1, $2, $3, $4::job_kind,
           ARRAY(SELECT jsonb_array_elements_text($5::jsonb)::job_kind), $6,
           ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography, now(), $9)
         ON CONFLICT (user_id) DO UPDATE SET public_id=EXCLUDED.public_id, online=EXCLUDED.online, active_mode=EXCLUDED.active_mode,
           service_modes=EXCLUDED.service_modes, rating=EXCLUDED.rating,
           current_location=EXCLUDED.current_location, location_updated_at=now(), metadata=EXCLUDED.metadata`,
        [
          driver.id,
          user.rows[0].id,
          driver.online,
          driver.activeService,
          JSON.stringify(driver.serviceModes),
          driver.rating,
          driver.location.lng,
          driver.location.lat,
          {
            name: driver.name,
            vehicle: driver.vehicle,
            plate: driver.plate,
            locationLabel: driver.location.label,
            earningsToday: driver.earningsToday,
          },
        ],
      );
    }
  }

  for (const order of state.orders) {
    const customer = await client.query("SELECT id FROM users WHERE public_id = $1", [
      order.customerId,
    ]);
    const merchant = await client.query("SELECT id, location FROM merchants WHERE public_id = $1", [
      order.restaurantId,
    ]);
    if (!customer.rows[0] || !merchant.rows[0]) continue;
    let driverId = null;
    if (order.courierId) {
      driverId =
        (await client.query("SELECT id FROM drivers WHERE public_id = $1", [order.courierId]))
          .rows[0]?.id || null;
    }
    const inserted = await client.query(
      `INSERT INTO jobs(public_id, kind, customer_id, merchant_id, driver_id, status,
        pickup_address, pickup_location, dropoff_address, dropoff_location, service_level,
        quoted_amount_cents, final_amount_cents, distance_m, estimated_duration_s,
        payment_method_label, metadata, created_at)
       SELECT $1, 'delivery', $2, $3, $4, $5, m.address, m.location, $6, m.location,
         'food', $7, $7, 0, $8, $9, $10, $11 FROM merchants m WHERE m.id = $3
       ON CONFLICT (public_id) DO UPDATE SET driver_id=EXCLUDED.driver_id, status=EXCLUDED.status,
         final_amount_cents=EXCLUDED.final_amount_cents, payment_method_label=EXCLUDED.payment_method_label,
         metadata=EXCLUDED.metadata
       RETURNING id`,
      [
        order.id,
        customer.rows[0].id,
        merchant.rows[0].id,
        driverId,
        jobStatus(order.status),
        order.deliveryAddress,
        cents(order.total),
        Math.max(0, order.etaMin) * 60,
        order.paymentMethod,
        {
          subtype: "food_order",
          subtotal: order.subtotal,
          deliveryFee: order.deliveryFee,
          serviceFee: order.serviceFee,
          etaMin: order.etaMin,
          locationEstimated: true,
        },
        order.createdAt,
      ],
    );
    await client.query("DELETE FROM job_items WHERE job_id = $1", [inserted.rows[0].id]);
    await client.query("DELETE FROM job_events WHERE job_id = $1", [inserted.rows[0].id]);
    for (const item of order.items) {
      const catalog = await client.query("SELECT id FROM catalog_items WHERE public_id = $1", [
        item.menuItemId,
      ]);
      await client.query(
        `INSERT INTO job_items(job_id, catalog_item_id, name, quantity, unit_price_cents, customer_note, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          inserted.rows[0].id,
          catalog.rows[0]?.id || null,
          item.name,
          item.quantity,
          cents(item.unitPrice),
          item.note || null,
          { publicId: item.menuItemId, extras: item.extras || [] },
        ],
      );
    }
    for (const event of order.timeline || []) {
      await client.query(
        "INSERT INTO job_events(job_id, status, occurred_at) VALUES ($1, $2, $3)",
        [inserted.rows[0].id, jobStatus(event.status), event.at],
      );
    }
  }
  await client.query("COMMIT");
  console.log(`seeded ${state.orders.length} food orders into PostgreSQL`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
