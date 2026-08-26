import { createPool } from "./db-client.mjs";
import { readDb } from "../server/store.js";

const pool = createPool();
const users = readDb().users;
const client = await pool.connect();

try {
  await client.query("BEGIN");
  for (const user of users) {
    const inserted = await client.query(
      `INSERT INTO users(public_id, email, password_hash, name, phone, profile)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO UPDATE SET
         public_id = EXCLUDED.public_id,
         password_hash = EXCLUDED.password_hash,
         name = EXCLUDED.name,
         phone = EXCLUDED.phone,
         profile = EXCLUDED.profile
       RETURNING id`,
      [
        user.id,
        user.email,
        user.password,
        user.name,
        user.phone || null,
        {
          wallet: user.wallet || 0,
          defaultAddress: user.defaultAddress || "",
          restaurantId: user.restaurantId || null,
          driverId: user.driverId || null,
        },
      ],
    );
    await client.query("DELETE FROM user_roles WHERE user_id = $1", [inserted.rows[0].id]);
    for (const role of user.roles || []) {
      await client.query("INSERT INTO user_roles(user_id, role) VALUES ($1, $2)", [
        inserted.rows[0].id,
        role,
      ]);
    }
  }
  await client.query("COMMIT");
  console.log(`seeded ${users.length} auth users into PostgreSQL`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
