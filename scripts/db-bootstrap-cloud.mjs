// Prepara la base en la nube (INF-003): lo que la CI y `database/docker-init` hacen a
// mano, como trabajo de Cloud Run (`flash-db-bootstrap`).
//
// Con el usuario administrador de Cloud SQL (`postgres`):
// - crea los tres roles separados, sin superusuario ni BYPASSRLS: `flash_app` (dueño de
//   la base, el que migra), `flash_runtime` (la API) y `flash_rls_audit` (auditoría);
//   si ya existen, sólo les actualiza la clave a la del secreto, y frena si alguno ganó
//   privilegios que no debe tener;
// - le da la base a `flash_app`;
// - habilita las extensiones que las migraciones necesitan y que un rol sin privilegios
//   no puede crear (PostGIS, entre otras).
//
// Es idempotente: correrlo de nuevo deja todo igual. Las claves llegan por variables de
// entorno desde Secret Manager y nunca se imprimen.
import pg from "pg";

const requerida = (nombre) => {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta ${nombre}`);
  return valor;
};

const adminUrl = requerida("POSTGRES_ADMIN_URL");
const roles = [
  ["flash_app", requerida("DB_PASSWORD_MIGRATION")],
  ["flash_runtime", requerida("DB_PASSWORD_RUNTIME")],
  ["flash_rls_audit", requerida("DB_PASSWORD_AUDIT")],
];
for (const [rol, clave] of roles)
  if (clave.length < 24)
    throw new Error(`La clave de ${rol} tiene que tener al menos 24 caracteres`);

const client = new pg.Client({
  connectionString: adminUrl,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : false,
});
await client.connect();
try {
  const base = (await client.query("SELECT current_database() AS nombre")).rows[0].nombre;
  for (const [rol, clave] of roles) {
    const existe = (await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [rol]))
      .rowCount;
    // Si ya existe, sólo la clave: en Cloud SQL el administrador no es superusuario, y
    // PostgreSQL le rechaza nombrar SUPERUSER o BYPASSRLS en un ALTER ROLE aunque el valor
    // no cambie. Los atributos se verifican abajo en lugar de reescribirlos.
    const sentencia = existe
      ? `ALTER ROLE ${client.escapeIdentifier(rol)} PASSWORD ${client.escapeLiteral(clave)}`
      : `CREATE ROLE ${client.escapeIdentifier(rol)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD ${client.escapeLiteral(clave)}`;
    await client.query(sentencia);
    console.log(`${existe ? "actualizado" : "creado"} ${rol}`);
  }
  // Un rol que alguien tocó a mano y ganó privilegios no se usa: se frena acá, antes de
  // que la API arranque con un rol que salta RLS.
  const desviados = (
    await client.query(
      `SELECT rolname FROM pg_roles WHERE rolname = ANY($1)
         AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolinherit OR NOT rolcanlogin)`,
      [roles.map(([rol]) => rol)],
    )
  ).rows.map((fila) => fila.rolname);
  if (desviados.length)
    throw new Error(
      `Estos roles tienen privilegios que no deben tener: ${desviados.join(", ")}. Quitáselos a mano antes de seguir.`,
    );
  // En Cloud SQL el administrador no es superusuario: para pasarle la base a `flash_app`
  // tiene que ser miembro de ese rol.
  await client.query("GRANT flash_app TO CURRENT_USER");
  await client.query(`ALTER DATABASE ${client.escapeIdentifier(base)} OWNER TO flash_app`);
  for (const extension of ["pg_trgm", "postgis", "pgcrypto", "citext"])
    await client.query(`CREATE EXTENSION IF NOT EXISTS ${client.escapeIdentifier(extension)}`);
  const postgis = (await client.query("SELECT postgis_version() AS version")).rows[0].version;
  console.log(`base ${base} lista: dueño flash_app, PostGIS ${postgis}`);
} finally {
  await client.end();
}
