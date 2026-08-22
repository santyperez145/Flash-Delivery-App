import { createPool } from "./db-client.mjs";

const pool = createPool();
try {
  const result = await pool.query(`
    SELECT current_database() AS database,
           current_setting('server_version') AS version,
           PostGIS_Version() AS postgis_version
  `);
  console.log(JSON.stringify({ ok: true, ...result.rows[0] }, null, 2));
} finally {
  await pool.end();
}
