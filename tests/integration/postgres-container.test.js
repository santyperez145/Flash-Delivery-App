import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const { Pool } = pg;
const POSTGIS_IMAGE = "postgis/postgis:17-3.5";
const APP_PASSWORD = "isolated-migration-password";
const RUNTIME_PASSWORD = "isolated-runtime-password";
const AUDIT_PASSWORD = "isolated-audit-password";

let container;
let adminPool;
let runtimePool;
let migrationOutput = "";

function connectionUrlFor(role, password) {
  const connectionUrl = new URL(container.getConnectionUri());
  connectionUrl.username = role;
  connectionUrl.password = password;
  return connectionUrl.toString();
}

function runMigration(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/db-migrate.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_SSL: "false",
        MIGRATION_DATABASE_URL: connectionString,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve(stdout);
      reject(new Error(`db:migrate exited ${code}\n${stdout}\n${stderr}`));
    });
  });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(POSTGIS_IMAGE)
    .withDatabase("flash")
    .withUsername("postgres")
    .withPassword("isolated-admin-password")
    .start();
  adminPool = new Pool({ connectionString: container.getConnectionUri() });
  await adminPool.query(`
    CREATE ROLE flash_app
      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS
      PASSWORD '${APP_PASSWORD}';
    CREATE ROLE flash_runtime
      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS
      PASSWORD '${RUNTIME_PASSWORD}';
    CREATE ROLE flash_rls_audit
      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS
      PASSWORD '${AUDIT_PASSWORD}';
    ALTER DATABASE flash OWNER TO flash_app;
  `);

  migrationOutput = await runMigration(connectionUrlFor("flash_app", APP_PASSWORD));
  runtimePool = new Pool({ connectionString: connectionUrlFor("flash_runtime", RUNTIME_PASSWORD) });
});

afterAll(async () => {
  await runtimePool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("isolated PostgreSQL/PostGIS runtime", () => {
  test("applies every migration from scratch", async () => {
    const migrationFiles = (await fs.readdir("database/migrations")).filter((file) =>
      file.endsWith(".sql"),
    );
    const result = await adminPool.query("SELECT count(*)::int AS count FROM schema_migrations");

    expect(migrationOutput).toContain("database is up to date");
    expect(result.rows[0].count).toBe(migrationFiles.length);
  });

  test("enables PostGIS in the same major version used by production", async () => {
    const result = await runtimePool.query(
      "SELECT extversion FROM pg_extension WHERE extname = 'postgis'",
    );
    expect(result.rows[0]?.extversion).toMatch(/^3\.5\./);
  });

  test("keeps runtime and audit roles outside ownership and bypass privileges", async () => {
    const result = await adminPool.query(`
      SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolinherit, rolbypassrls
      FROM pg_roles
      WHERE rolname IN ('flash_runtime', 'flash_rls_audit')
      ORDER BY rolname
    `);

    expect(result.rows).toHaveLength(2);
    for (const role of result.rows) {
      expect(role).toMatchObject({
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolinherit: false,
        rolbypassrls: false,
      });
    }
    const ownership = await adminPool.query(`
      SELECT
        pg_get_userbyid(database.datdba) AS database_owner,
        pg_get_userbyid(namespace.nspowner) AS schema_owner
      FROM pg_database database
      CROSS JOIN pg_namespace namespace
      WHERE database.datname = current_database()
        AND namespace.nspname = 'public'
    `);
    expect(ownership.rows[0].database_owner).toBe("flash_app");
    expect(["flash_runtime", "flash_rls_audit"]).not.toContain(ownership.rows[0].schema_owner);
    expect(
      await adminPool.query(
        "SELECT has_schema_privilege('flash_runtime', 'public', 'CREATE') AS can_create",
      ),
    ).toMatchObject({ rows: [{ can_create: false }] });
  });
});
