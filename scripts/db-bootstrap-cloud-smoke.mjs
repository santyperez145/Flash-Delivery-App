// La preparación de la base en la nube, contra PostgreSQL real (INF-003).
//
// Hace lo mismo que el primer despliegue en Google Cloud, en una base nueva y descartable:
// corre `scripts/db-bootstrap-cloud.mjs` (dos veces: tiene que ser idempotente), migra
// todo con `flash_app` y verifica el resultado: la base es de `flash_app`, PostGIS está,
// ningún rol es superusuario ni salta RLS, y están todas las migraciones. Borra la base al
// final.
//
// Necesita POSTGRES_ADMIN_URL (el administrador del servidor) y las URLs de los tres roles
// (MIGRATION_DATABASE_URL, DATABASE_URL, RLS_AUDIT_DATABASE_URL). Los roles son del
// servidor entero, no de la base: la prueba les pone claves largas y aleatorias, como en la
// nube (la preparación rechaza las de menos de 24 caracteres), y al terminar, pase lo que
// pase, les devuelve las claves de esas URLs para que el resto de las pruebas siga igual.
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
const conBase = (url, base, clave) => {
  const nueva = new URL(url);
  nueva.pathname = `/${base}`;
  if (clave) nueva.password = encodeURIComponent(clave);
  return nueva.toString();
};
const claveNueva = () => crypto.randomBytes(24).toString("base64url");

const admin = requerida("POSTGRES_ADMIN_URL");
const migracion = requerida("MIGRATION_DATABASE_URL");
const runtime = requerida("DATABASE_URL");
const auditoria = requerida("RLS_AUDIT_DATABASE_URL");
const base = `flash_boot_${crypto.randomBytes(4).toString("hex")}`;
const adminNube = `${base}_admin`;

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
const claves = { migracion: claveNueva(), runtime: claveNueva(), auditoria: claveNueva() };
try {
  const entornoBootstrap = {
    POSTGRES_ADMIN_URL: conBase(admin, base),
    DB_PASSWORD_MIGRATION: claves.migracion,
    DB_PASSWORD_RUNTIME: claves.runtime,
    DB_PASSWORD_AUDIT: claves.auditoria,
  };
  const primera = correr("scripts/db-bootstrap-cloud.mjs", entornoBootstrap);
  assert(/lista: dueño flash_app, PostGIS/.test(primera), "la preparación deja la base lista");
  // La segunda vez, como en Cloud SQL: con un administrador que no es superusuario, sólo
  // puede crear roles y bases y administra los de Flash (como `postgres`, miembro de
  // `cloudsqlsuperuser`, administra los roles que creó). Ahí un ALTER ROLE que nombre
  // SUPERUSER o BYPASSRLS falla.
  const claveAdminNube = claveNueva();
  await servidor.query(
    `CREATE ROLE ${servidor.escapeIdentifier(adminNube)} LOGIN NOSUPERUSER CREATEDB CREATEROLE NOBYPASSRLS PASSWORD ${servidor.escapeLiteral(claveAdminNube)}`,
  );
  await servidor.query(
    `GRANT flash_app, flash_runtime, flash_rls_audit TO ${servidor.escapeIdentifier(adminNube)} WITH ADMIN OPTION`,
  );
  const urlAdminNube = new URL(conBase(admin, base));
  urlAdminNube.username = adminNube;
  urlAdminNube.password = encodeURIComponent(claveAdminNube);
  const segunda = correr("scripts/db-bootstrap-cloud.mjs", {
    ...entornoBootstrap,
    POSTGRES_ADMIN_URL: urlAdminNube.toString(),
  });
  assert(
    /actualizado flash_app/.test(segunda) && /lista: dueño flash_app/.test(segunda),
    "correrla otra vez, con un administrador sin superusuario como el de Cloud SQL, no rompe nada",
  );
  // Migrar con la clave nueva prueba que la preparación se la puso a flash_app.
  correr("scripts/db-migrate.mjs", {
    MIGRATION_DATABASE_URL: conBase(migracion, base, claves.migracion),
  });

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
  for (const [rol, url] of [
    ["flash_app", migracion],
    ["flash_runtime", runtime],
    ["flash_rls_audit", auditoria],
  ]) {
    await servidor.query(
      `ALTER ROLE ${servidor.escapeIdentifier(rol)} PASSWORD ${servidor.escapeLiteral(claveDe(url))}`,
    );
  }
  await servidor.query(`DROP DATABASE IF EXISTS ${servidor.escapeIdentifier(base)} WITH (FORCE)`);
  await servidor.query(`DROP OWNED BY ${servidor.escapeIdentifier(adminNube)}`).catch(() => {});
  await servidor.query(`DROP ROLE IF EXISTS ${servidor.escapeIdentifier(adminNube)}`);
  await servidor.end();
}
