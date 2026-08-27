// Un backup que nunca se restauró no es un backup (ticket CI-001).
//
// `scripts/restore-drill.ps1` hace el ensayo completo sobre la máquina que
// guarda los backups: levanta un cluster nuevo, restaura el dump más reciente y
// verifica invariantes. Es el ensayo que importa, y no puede correr en CI: es
// PowerShell y depende de archivos que sólo existen ahí.
//
// Esto es **otro** ensayo, no un reemplazo. Vuelca la base de CI, la restaura en
// una segunda base y corre los invariantes contra la copia. No prueba que los
// backups del dueño sean restaurables —eso sólo se puede probar donde están—,
// pero sí prueba lo que el ensayo local no puede probar en cada PR: que el
// esquema, las extensiones, las políticas y los permisos **sobreviven al viaje
// por `pg_dump`**, en la versión de hoy del esquema.
//
// La diferencia importa porque lo que se rompe en un restore no suele ser el
// dump: es algo que el dump no lleva. Una extensión que no estaba, una política
// que dependía de un rol ausente, un GRANT que nadie volvió a aplicar.
//
// **Limitación declarada:** restaura en el mismo cluster, así que los roles ya
// existen. Un `pg_dump` de una base no lleva las definiciones de rol, que son de
// cluster y salen de `pg_dumpall --roles-only`. Que los roles sean recuperables
// es una pregunta legítima y ésta no la responde. Lo que sí verifica es que los
// **permisos otorgados a esos roles** viajen en el dump, que es la mitad que se
// rompe cuando alguien agrega una tabla y olvida su GRANT.
import fs from "node:fs/promises";
import pg from "pg";

const origen = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  ssl: false,
});
const copia = new pg.Pool({
  connectionString: process.env.RESTORE_DATABASE_URL,
  ssl: false,
});

if (!process.env.RESTORE_DATABASE_URL) {
  console.error("Falta RESTORE_DATABASE_URL: apunta a la base restaurada desde el dump.");
  process.exit(1);
}

let fallos = 0;
const ok = (etiqueta) => console.log(`ok - ${etiqueta}`);
const comparar = (obtenido, esperado, etiqueta, nota) => {
  if (JSON.stringify(obtenido) === JSON.stringify(esperado)) return ok(etiqueta);
  fallos++;
  console.error(`FALLA - ${etiqueta}`);
  console.error(`        esperaba ${JSON.stringify(esperado)}`);
  console.error(`        obtuvo   ${JSON.stringify(obtenido)}`);
  if (nota) console.error(`        ${nota}`);
  return undefined;
};
const valor = async (pool, sql, params = []) => (await pool.query(sql, params)).rows[0];

try {
  // 1. El esquema llegó entero: las migraciones aplicadas en la copia son las
  //    mismas que hay en el repositorio.
  const archivos = (await fs.readdir("database/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort();
  const migraciones = await copia.query("SELECT version FROM schema_migrations ORDER BY version");
  comparar(
    migraciones.rowCount,
    archivos.length,
    `la copia tiene las ${archivos.length} migraciones del repositorio`,
  );
  comparar(
    migraciones.rows.at(-1)?.version,
    archivos.at(-1)?.replace(/\.sql$/, ""),
    "la última migración de la copia es la última del repositorio",
    "un restore que se queda corto pasa desapercibido hasta que falta una columna",
  );

  // 2. Las extensiones viajan. PostGIS no se restaura solo si no estaba
  //    instalada en la base destino, y sin ella la mitad geoespacial no arranca.
  const postgis = await valor(copia, "SELECT postgis_lib_version() v").catch(() => null);
  comparar(
    Boolean(postgis?.v),
    true,
    "PostGIS está disponible en la copia",
    "sin ella no hay dispatch",
  );

  // 3. Ninguna restricción quedó sin validar. `pg_restore` puede dejar
  //    constraints NOT VALID si algo salió a medias, y una restricción no
  //    validada no protege nada.
  const invalidas = await valor(
    copia,
    "SELECT count(*)::int n FROM pg_constraint WHERE NOT convalidated",
  );
  comparar(invalidas.n, 0, "ninguna restricción quedó sin validar");

  // 4. Los datos llegaron. Un restore vacío cumple todo lo anterior.
  for (const tabla of ["users", "jobs", "ledger_entries"]) {
    const fuente = await valor(origen, `SELECT count(*)::int n FROM ${tabla}`);
    const destino = await valor(copia, `SELECT count(*)::int n FROM ${tabla}`);
    comparar(destino.n, fuente.n, `${tabla}: ${fuente.n} filas en origen y en la copia`);
  }

  // 5. La partida doble sigue cuadrando después del viaje. El trigger de la
  //    migración 118 no revalida lo que ya estaba escrito, así que esto es una
  //    comprobación sobre los datos y no sobre el trigger.
  const desbalance = await valor(
    copia,
    `SELECT count(*)::int n FROM (
       SELECT transaction_id FROM ledger_entries GROUP BY transaction_id
       HAVING COALESCE(sum(amount_cents) FILTER (WHERE direction = 'debit'), 0)
            <> COALESCE(sum(amount_cents) FILTER (WHERE direction = 'credit'), 0)
     ) t`,
  );
  comparar(desbalance.n, 0, "el ledger de la copia cuadra");

  // 6. Row-Level Security viaja con el dump. Es lo que más silenciosamente se
  //    pierde: una tabla restaurada sin `ENABLE ROW LEVEL SECURITY` responde a
  //    todo el mundo y no falla nunca.
  const rlsOrigen = await origen.query(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity ORDER BY 1`,
  );
  const rlsCopia = await copia.query(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity ORDER BY 1`,
  );
  comparar(
    rlsCopia.rows.map((f) => f.relname),
    rlsOrigen.rows.map((f) => f.relname),
    `las ${rlsOrigen.rowCount} tablas con RLS conservan RLS en la copia`,
    "una tabla restaurada sin RLS responde a todo el mundo y no falla nunca",
  );

  const politicasOrigen = await valor(
    origen,
    "SELECT count(*)::int n FROM pg_policies WHERE schemaname='public'",
  );
  const politicasCopia = await valor(
    copia,
    "SELECT count(*)::int n FROM pg_policies WHERE schemaname='public'",
  );
  comparar(politicasCopia.n, politicasOrigen.n, `las ${politicasOrigen.n} políticas RLS viajaron`);

  // 7. Los permisos otorgados a los roles viajan. Ésta es la mitad que se rompe
  //    cuando alguien agrega una tabla y olvida su GRANT: en la base viva nadie
  //    lo nota porque el rol ya tenía permiso sobre las demás.
  const permisos = async (pool) =>
    (
      await pool.query(
        `SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
         WHERE table_schema = 'public' AND grantee IN ('flash_runtime','flash_rls_audit')
         ORDER BY grantee, table_name, privilege_type`,
      )
    ).rows.map((f) => `${f.grantee}:${f.table_name}:${f.privilege_type}`);
  const permisosOrigen = await permisos(origen);
  const permisosCopia = await permisos(copia);
  comparar(
    permisosCopia.length,
    permisosOrigen.length,
    `los ${permisosOrigen.length} permisos de runtime y auditoría viajaron`,
  );
  const perdidos = permisosOrigen.filter((p) => !permisosCopia.includes(p));
  if (perdidos.length) {
    fallos++;
    console.error("FALLA - permisos que no llegaron a la copia");
    for (const p of perdidos.slice(0, 15)) console.error(`        ${p}`);
  } else {
    ok("ningún permiso se perdió en el viaje");
  }

  // 8. La cadena de auditoría sigue siendo válida sobre los datos restaurados.
  //    Si el dump alterara el orden o perdiera una fila, la cadena lo dice.
  const cadena = await valor(copia, "SELECT app.audit_chain_invalid_count()::int n").catch(
    () => null,
  );
  if (cadena === null) {
    fallos++;
    console.error("FALLA - la función app.audit_chain_invalid_count no existe en la copia");
    console.error("        las funciones del esquema `app` no viajaron en el dump");
  } else {
    comparar(cadena.n, 0, "la cadena de auditoría de la copia es válida");
  }
} finally {
  await origen.end();
  await copia.end();
}

if (fallos) {
  console.error(`\n${fallos} invariante(s) del restore no se cumplen`);
  process.exit(1);
}
console.log("\nok - el esquema, las políticas y los permisos sobreviven al viaje por pg_dump");
