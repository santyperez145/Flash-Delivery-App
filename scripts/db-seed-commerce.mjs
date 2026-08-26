import { createPool } from "./db-client.mjs";
import { readDb } from "../server/store.js";

const pool = createPool();
const state = readDb();
const client = await pool.connect();
const cents = (amount) => Math.round(Number(amount || 0) * 100);

try {
  await client.query("BEGIN");
  for (const restaurant of state.restaurants) {
    const owner = await client.query("SELECT id FROM users WHERE public_id = $1", [restaurant.ownerId]);
    if (!owner.rows[0]) throw new Error(`Missing owner ${restaurant.ownerId}`);
    const merchant = await client.query(
      `INSERT INTO merchants(public_id, owner_id, name, vertical, status, address, location, open, eta_min, delivery_fee_cents, metadata)
       VALUES ($1, $2, $3, 'restaurant', 'active', $4,
         ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7, $8, $9, $10)
       ON CONFLICT (public_id) DO UPDATE SET
         owner_id=EXCLUDED.owner_id, name=EXCLUDED.name, address=EXCLUDED.address,
         location=EXCLUDED.location, open=EXCLUDED.open, eta_min=EXCLUDED.eta_min,
         delivery_fee_cents=EXCLUDED.delivery_fee_cents, metadata=EXCLUDED.metadata
       RETURNING id`,
      [restaurant.id, owner.rows[0].id, restaurant.name, restaurant.address, restaurant.lng, restaurant.lat,
        restaurant.open, restaurant.etaMin, cents(restaurant.deliveryFee), {
          cuisine: restaurant.cuisine, rating: restaurant.rating, distanceKm: restaurant.distanceKm,
          image: restaurant.image, cover: restaurant.cover, badge: restaurant.badge,
          extras: restaurant.extras || []
        }]
    );
    for (const item of restaurant.menu) {
      await client.query(
        `INSERT INTO catalog_items(public_id, merchant_id, sku, name, description, category, unit_price_cents, available, metadata)
         VALUES ($1, $2, $1, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (public_id) DO UPDATE SET merchant_id=EXCLUDED.merchant_id, name=EXCLUDED.name,
           description=EXCLUDED.description, category=EXCLUDED.category,
           unit_price_cents=EXCLUDED.unit_price_cents, available=EXCLUDED.available, metadata=EXCLUDED.metadata`,
        [item.id, merchant.rows[0].id, item.name, item.description, item.category, cents(item.price), item.stock, {
          rating: item.rating, timeMin: item.timeMin, kcal: item.kcal,
          image: item.image, tags: item.tags || []
        }]
      );
    }
  }
  // La migración 057 derivó los modificadores desde `merchants.metadata->extras`,
  // pero sólo alcanzó a los comercios que ya existían cuando se aplicó. En una
  // base creada desde cero el seed corre después, así que los modificadores
  // quedarían vacíos y el catálogo no sería reproducible.
  //
  // Este backfill repite la misma derivación y es idempotente, por lo que un
  // ambiente nuevo termina con el mismo catálogo que uno migrado en su momento.
  await client.query(
    `INSERT INTO catalog_modifier_groups(public_id,catalog_item_id,name,minimum_selections,maximum_selections)
     SELECT 'extras',c.id,'Agregados',0,LEAST(6,jsonb_array_length(m.metadata->'extras'))
     FROM catalog_items c JOIN merchants m ON m.id=c.merchant_id
     WHERE jsonb_typeof(m.metadata->'extras')='array' AND jsonb_array_length(m.metadata->'extras')>0
     ON CONFLICT (catalog_item_id,public_id) DO NOTHING`,
  );
  const modifiers = await client.query(
    `INSERT INTO catalog_modifiers(public_id,group_id,name,price_cents,sort_order)
     SELECT extra->>'id',g.id,extra->>'name',round((extra->>'price')::numeric*100)::bigint,ordinality-1
     FROM catalog_modifier_groups g JOIN catalog_items c ON c.id=g.catalog_item_id JOIN merchants m ON m.id=c.merchant_id
     CROSS JOIN LATERAL jsonb_array_elements(m.metadata->'extras') WITH ORDINALITY AS value(extra,ordinality)
     WHERE g.public_id='extras'
     ON CONFLICT (group_id,public_id) DO NOTHING`,
  );

  await client.query("COMMIT");
  console.log(`seeded ${state.restaurants.length} merchants and ${state.restaurants.reduce((sum, restaurant) => sum + restaurant.menu.length, 0)} catalog items`);
  console.log(`seeded ${modifiers.rowCount} catalog modifiers`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}

