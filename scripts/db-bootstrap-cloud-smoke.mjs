// La preparación de la base en la nube, contra PostgreSQL real (INF-003).
//
// Hace lo mismo que el primer despliegue en Google Cloud, en una base nueva y descartable:
// corre `scripts/db-bootstrap-cloud.mjs` (dos veces: tiene que ser idempotente), migra
// todo con `flash_app` y verifica el resultado: la base es de `flash_app`, PostGIS está,
// ningún rol es superusuario ni salta RLS, y están todas las migraciones. Borra la base al
// final.
//
// Necesita POSTGRES_ADMIN_URL (el administrador del servidor) y las URLs de los tres roles
// (MIGRATION_DATABASE_URL, DATABASE_URL, RLS_AUDIT_DATABASE_URL), de donde toma sus claves:
// así correrlo no cambia la clave de ningún rol.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import pg from "pg";

const assert = (condicion, etiqueta) => {
  if (!condicion) throw new Error(`failed: ${etiqueta}`);
  console.log(`ok - ${etiqueta}`);
};
const requerida = (nombre) => {
  if (!process.env[nombre]) throw new Error(`Falta ${nombre}`);
  return process.env[nombre];
};
const claveDe = (url) => decodeURIComponent(new URL(url).password);
const conBase = (url, base) => {
  const nueva = new URL(url);
  nueva.pathname = `/${base}`;
  return nueva.toString();
};

const admin = requerida("POSTGRES_ADMIN_URL");
const migracion = requerida("MIGRATION_DATABASE_URL");
const runtime = requerida("DATABASE_URL");
const auditoria = requerida("RLS_AUDIT_DATABASE_URL");
const base = `flash_boot_${crypto.randomBytes(4).toString("hex")}`;

const correr = (script, entorno) => {
  const salida = spawnSync(process.execPath, [script], {
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      DATABASE_SSL: "false",
      ...entorno,
    },
    encoding: "utf8",
  });
  if (salida.status !== 0) throw new Error(`${script} falló: ${salida.stderr || salida.stdout}`);
  return salida.stdout;
};

const servidor = new pg.Client({ connectionString: admin });
await servidor.connect();
await servidor.query(`CREATE DATABASE ${servidor.escapeIdentifier(base)}`);
try {
  const entornoBootstrap = {
    POSTGRES_ADMIN_URL: conBase(admin, base),
    DB_PASSWORD_MIGRATION: claveDe(migracion),
    DB_PASSWORD_RUNTIME: claveDe(runtime),
    DB_PASSWORD_AUDIT: claveDe(auditoria),
  };
  const primera = correr("scripts/db-bootstrap-cloud.mjs", entornoBootstrap);
  assert(/lista: dueño flash_app, PostGIS/.test(primera), "la preparación deja la base lista");
  correr("scripts/db-bootstrap-cloud.mjs", entornoBootstrap);
  assert(true, "correrla otra vez no rompe nada");
  correr("scripts/db-migrate.mjs", { MIGRATION_DATABASE_URL: conBase(migracion, base) });

  const nueva = new pg.Client({ connectionString: conBase(admin, base) });
  await nueva.connect();
  try {
    const duenio = (
      await nueva.query(
        "SELECT pg_get_userbyid(datdba) AS duenio FROM pg_database WHERE datname = current_database()",
      )
    ).rows[0].duenio;
    assert(duenio === "flash_app", "la base es de flash_app, el rol que migra");
    const extensiones = (await nueva.query("SELECT extname FROM pg_extension")).rows.map(
      (r) => r.extname,
    );
    assert(
      ["postgis", "pg_trgm", "pgcrypto", "citext"].every((e) => extensiones.includes(e)),
      "PostGIS y las demás extensiones están",
    );
    const privilegiados = (
      await nueva.query(
        "SELECT rolname FROM pg_roles WHERE rolname IN ('flash_app','flash_runtime','flash_rls_audit') AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)",
      )
    ).rows;
    assert(privilegiados.length === 0, "ningún rol de Flash es superusuario ni salta RLS");
    const archivos = fs.readdirSync("database/migrations").filter((f) => f.endsWith(".sql")).length;
    const aplicadas = Number(
      (await nueva.query("SELECT count(*) FROM schema_migrations")).rows[0].count,
    );
    assert(aplicadas === archivos, `las ${archivos} migraciones quedan aplicadas desde cero`);
  } finally {
    await nueva.end();
  }
} finally {
  await servidor.query(`DROP DATABASE IF EXISTS ${servidor.escapeIdentifier(base)} WITH (FORCE)`);
  await servidor.end();
}
