import { createPool } from "./db-client.mjs";
import { readDb } from "../server/store.js";

const pool = createPool();
const state = readDb();
const client = await pool.connect();
const cents = (amount) => Math.round(Number(amount || 0) * 100);

try {
  await client.query("BEGIN");
  // El rubro se lee del comercio y no se fuerza a restaurante (P-01): un
  // comercio dado de alta como farmacia tiene que sembrarse como farmacia.
  const merchants = state.restaurants;
  for (const restaurant of merchants) {
    const owner = await client.query("SELECT id FROM users WHERE public_id = $1", [
      restaurant.ownerId,
    ]);
    if (!owner.rows[0]) throw new Error(`Missing owner ${restaurant.ownerId}`);
    const merchant = await client.query(
      `INSERT INTO merchants(public_id, owner_id, name, vertical, status, address, location, open, eta_min, delivery_fee_cents, metadata)
       VALUES ($1, $2, $3, $11, 'active', $4,
         ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7, $8, $9, $10)
       ON CONFLICT (public_id) DO UPDATE SET
         owner_id=EXCLUDED.owner_id, name=EXCLUDED.name, vertical=EXCLUDED.vertical, address=EXCLUDED.address,
         location=EXCLUDED.location, open=EXCLUDED.open, eta_min=EXCLUDED.eta_min,
         delivery_fee_cents=EXCLUDED.delivery_fee_cents, metadata=EXCLUDED.metadata
       RETURNING id`,
      [
        restaurant.id,
        owner.rows[0].id,
        restaurant.name,
        restaurant.address,
        restaurant.lng,
        restaurant.lat,
        restaurant.open,
        restaurant.etaMin,
        cents(restaurant.deliveryFee),
        {
          cuisine: restaurant.cuisine,
          rating: restaurant.rating,
          distanceKm: restaurant.distanceKm,
          image: restaurant.image,
          cover: restaurant.cover,
          badge: restaurant.badge,
          extras: restaurant.extras || [],
        },
        restaurant.vertical || "restaurant",
      ],
    );
    for (const item of restaurant.menu) {
      await client.query(
        `INSERT INTO catalog_items(public_id, merchant_id, sku, name, description, category, unit_price_cents, available, metadata)
         VALUES ($1, $2, $1, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (public_id) DO UPDATE SET merchant_id=EXCLUDED.merchant_id, name=EXCLUDED.name,
           description=EXCLUDED.description, category=EXCLUDED.category,
           unit_price_cents=EXCLUDED.unit_price_cents, available=EXCLUDED.available, metadata=EXCLUDED.metadata`,
        [
          item.id,
          merchant.rows[0].id,
          item.name,
          item.description,
          item.category,
          cents(item.price),
          item.stock,
          {
            rating: item.rating,
            timeMin: item.timeMin,
            kcal: item.kcal,
            image: item.image,
            tags: item.tags || [],
          },
        ],
      );
    }
  }
  await client.query("COMMIT");
  console.log(
    `seeded ${merchants.length} merchants and ${merchants.reduce((sum, restaurant) => sum + restaurant.menu.length, 0)} catalog items`,
  );
  // Modificadores, alérgenos y etiquetas dietarias se derivan de estos datos:
  // los aplica `npm run db:seed:derived`, que debe correr después de los seeds.
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
