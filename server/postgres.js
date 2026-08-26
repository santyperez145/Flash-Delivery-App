import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const postgresPool = config.databaseUrl
  ? new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: true } : false,
      max: config.isProduction ? 30 : 10,
      min: config.isProduction ? 2 : 0,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
      application_name: "flash-api",
    })
  : null;

// Si el pool existe, el comercio corre sobre PostgreSQL; si no, sobre el
// respaldo SQLite. Vivía en `commerce-repository.js` y se mudó acá al partirlo,
// porque gobierna a los tres pedazos por igual.
//
// Es literalmente el mismo chequeo que `usesPostgresAuth` en
// `auth-repository.js`. Los dos nombres se conservan porque documentan qué
// subsistema está gateando el llamador; si algún día auth y comercio dejan de
// compartir pool, cada uno ya tiene su predicado.
export function usesPostgresCommerce() {
  return Boolean(postgresPool);
}

export async function postgresReadiness() {
  if (!postgresPool) return { configured: false, ready: false, reason: "DATABASE_URL missing" };
  try {
    const result =
      await postgresPool.query(`SELECT current_database() AS database, now() AS server_time,
      postgis_version() AS postgis_version, current_user AS database_role,
      (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypass_rls,
      (SELECT tableowner FROM pg_tables WHERE schemaname='public' AND tablename='users') AS schema_owner`);
    const row = result.rows[0];
    return {
      configured: true,
      ready: true,
      ...row,
      least_privilege: !row.bypass_rls && row.database_role !== row.schema_owner,
    };
  } catch (error) {
    return {
      configured: true,
      ready: false,
      reason: error instanceof Error ? error.message : "database unavailable",
    };
  }
}

export async function withDatabaseContext({ userId, roles = [] }, operation) {
  if (!postgresPool) throw new Error("PostgreSQL is not configured");
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.roles', $2, true)",
      [userId || "", roles.join(",")],
    );
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closePostgres() {
  await postgresPool?.end();
}
