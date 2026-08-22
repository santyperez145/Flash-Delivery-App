import pg from "pg";

const { Pool } = pg;

export function createPool() {
  const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  const migrationMaintenance = Boolean(process.env.MIGRATION_DATABASE_URL);
  if (!connectionString) throw new Error("DATABASE_URL is required");
  return new Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    options: migrationMaintenance ? "-c app.audit_maintenance=on" : undefined
  });
}
