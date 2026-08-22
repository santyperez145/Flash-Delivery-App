import fs from "node:fs";
import { parse } from "yaml";

const compose = parse(fs.readFileSync("docker-compose.yml", "utf8"));
const postgres = compose.services?.postgres;
const api = compose.services?.flash;
const runtimeUrl = String(api?.environment?.DATABASE_URL || "");
const migrationUrl = String(api?.environment?.MIGRATION_DATABASE_URL || "");
const initMounts = postgres?.volumes || [];

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`ok - ${message}`);
};

assert(postgres?.environment?.POSTGRES_USER === "postgres", "el superusuario queda limitado al bootstrap del contenedor");
assert(runtimeUrl.startsWith("postgresql://flash_runtime:"), "la API usa flash_runtime y no el owner del esquema");
assert(migrationUrl.startsWith("postgresql://flash_app:"), "el migrador recibe una conexion separada");
assert(runtimeUrl !== migrationUrl, "runtime y migraciones no comparten credenciales");
assert(initMounts.some((entry) => String(entry).includes("/docker-entrypoint-initdb.d")), "PostgreSQL carga el bootstrap de roles");

const init = fs.readFileSync("database/docker-init/001-runtime-roles.sh", "utf8");
for (const role of ["flash_app", "flash_runtime", "flash_rls_audit"])
  assert(init.includes(`${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`), `${role} queda sin privilegios administrativos ni BYPASSRLS`);
