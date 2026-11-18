// Contrato del borrado de cuenta (LAN-001).
//
// Apple y Google no publican una app que permite crear cuentas si no deja
// borrarlas desde la app, y Google pide además un camino web. Si alguien
// desmonta el botón de una de las superficies, la app deja de ser publicable y
// ninguna prueba de comportamiento lo nota: la ruta sigue andando, sólo que nadie
// la puede tocar. Este contrato vigila que el borrado esté **ofrecido** en cada
// lugar donde una persona administra su cuenta, y que la base lo resuelva con una
// sola función acotada.
//
// El comportamiento —anonimizar, borrar los datos personales, revocar sesiones,
// auditar, convertir en solicitud lo de comercios y repartidores— lo prueba
// `test:postgres` contra PostgreSQL.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { contains } from "./source-contract.mjs";

const ok = (mensaje) => console.log(`ok - ${mensaje}`);
const leer = (ruta) => fs.readFile(ruta, "utf8");

// --- La base: una función, no permisos de borrado para el runtime ------------
// Sin comentarios: una sentencia comentada sigue conteniendo su texto, y el
// contrato la daría por presente. Así lo encontró la falsificación.
const sinComentarios = (sql) => sql.replace(/--[^\n]*/g, "");
const migracion = sinComentarios(await leer("database/migrations/138_account_deletion.sql"));
assert.ok(
  contains(migracion, "CREATE FUNCTION app.delete_customer_account(p_user uuid) RETURNS void") &&
    contains(migracion, "SECURITY DEFINER") &&
    contains(migracion, "SET search_path = public, pg_catalog, pg_temp AS $$") &&
    contains(
      migracion,
      "REVOKE EXECUTE ON FUNCTION app.delete_customer_account(uuid) FROM PUBLIC;",
    ),
  "el borrado no es una función acotada, o cualquiera puede ejecutarla",
);
for (const guarda of [
  "FLASH_DELETE_ROLE",
  "FLASH_DELETE_ACTIVE_JOB",
  "FLASH_DELETE_OPEN_CLAIM",
  "FLASH_DELETE_WALLET_BALANCE",
])
  assert.ok(contains(migracion, `RAISE EXCEPTION '${guarda}'`), `la función no protege ${guarda}`);
ok("la base borra con una función acotada, que protege roles, pedidos, reclamos y saldo");

// Un checkout que leyó la cuenta antes del borrado no inserta su pedido después.
assert.ok(
  contains(
    migracion,
    "PERFORM 1 FROM users WHERE id = NEW.customer_id AND status <> 'deleted' FOR SHARE;",
  ) &&
    contains(
      migracion,
      "CREATE TRIGGER jobs_reject_deleted_customer BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION app.reject_job_for_deleted_customer();",
    ),
  "un pedido puede crearse para una cuenta que se está eliminando",
);
ok("ningún pedido se crea para una cuenta eliminada, ni en plena carrera con el borrado");

// **Toda** función con permisos de dueño nombra `pg_temp` al final: sin nombrarlo,
// PostgreSQL busca primero las tablas en el esquema temporal de quien la llama.
// Se mira el último `search_path` que cada migración le fija a cada función.
const todasLasMigraciones = (await fs.readdir("database/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();
const rutaVigente = new Map();
const definer = new Set();
for (const archivo of todasLasMigraciones) {
  const sql = sinComentarios(await leer(`database/migrations/${archivo}`));
  for (const m of sql.matchAll(
    /CREATE (?:OR REPLACE )?FUNCTION (app\.[a-z_]+)\([^)]*\)[\s\S]*?(?:AS \$\$|\$\$;)/g,
  )) {
    if (/SECURITY DEFINER/.test(m[0])) definer.add(m[1]);
    const ruta = m[0].match(/SET search_path\s*=\s*([^\n]+?)\s+AS \$\$/);
    if (ruta) rutaVigente.set(m[1], ruta[1]);
  }
  for (const m of sql.matchAll(/ALTER FUNCTION (app\.[a-z_]+)\([^)]*\) SECURITY DEFINER;/g))
    definer.add(m[1]);
  for (const m of sql.matchAll(
    /ALTER FUNCTION (app\.[a-z_]+)\([^)]*\) SET search_path\s*=\s*([^;]+);/g,
  ))
    rutaVigente.set(m[1], m[2]);
}
assert.ok(definer.size >= 6, `se encontraron sólo ${definer.size} funciones con permisos de dueño`);
for (const funcion of definer)
  assert.match(
    rutaVigente.get(funcion) || "",
    /,\s*pg_temp\s*$/,
    `${funcion} corre con permisos de dueño sin pg_temp al final del search_path`,
  );
ok(`las ${definer.size} funciones con permisos de dueño buscan en pg_temp al final`);

// Cada tabla que toca la función existe en el esquema migrado. PL/pgSQL no valida
// los nombres al crear la función: una tabla borrada por una migración posterior
// recién falla al borrar una cuenta de verdad. Así pasó con `user_security_factors`,
// que la 112 eliminó.
const migraciones = (await fs.readdir("database/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();
const esquema = (await Promise.all(migraciones.map((f) => leer(`database/migrations/${f}`)))).join(
  "\n",
);
const cuerpo = migracion.slice(
  migracion.indexOf("CREATE FUNCTION app.delete_customer_account"),
  migracion.indexOf("REVOKE EXECUTE ON FUNCTION app.delete_customer_account"),
);
const tablas = [
  ...new Set(
    [...cuerpo.matchAll(/\b(?:DELETE FROM|UPDATE|FROM|JOIN)\s+([a-z_]+)\b/g)].map((m) => m[1]),
  ),
];
assert.ok(tablas.length >= 20, `se leyeron sólo ${tablas.length} tablas de la función`);
for (const tabla of tablas) {
  assert.ok(
    new RegExp(`CREATE TABLE (IF NOT EXISTS )?${tabla}[\\s(]`).test(esquema),
    `la función usa ${tabla}, que ninguna migración crea`,
  );
  assert.ok(
    !new RegExp(`DROP TABLE (IF EXISTS )?${tabla}[\\s;,]`).test(esquema),
    `la función usa ${tabla}, que una migración elimina`,
  );
}
ok(`las ${tablas.length} tablas que toca el borrado existen en el esquema migrado`);

// --- El servidor: pide la contraseña otra vez y audita -----------------------
const repositorio = await leer("server/account-deletion-repository.js");
const ruta = await leer("server/http/auth-router.js");
assert.ok(
  // La guarda entera, no sólo la llamada: `bcrypt.compare` presente pero sin
  // cortar el flujo no protege nada. Así lo encontró la falsificación.
  contains(
    repositorio,
    'if (!(await bcrypt.compare(String(password || ""), usuario.password_hash))) {' +
      " await recordPostgresLoginFailure(usuario.email);" +
      ' throw Object.assign(new Error("La contraseña no coincide"), { status: 403 }); }',
  ) &&
    // El mismo contador que el login: sin él, un token robado prueba contraseñas
    // acá sin límite.
    contains(
      repositorio,
      "if (usuario.login_locked_until && new Date(usuario.login_locked_until) > new Date()) throw",
    ) &&
    contains(ruta, 'router.post("/api/me/delete", requireAuth,') &&
    contains(ruta, 'action: "account.deleted",') &&
    contains(ruta, 'action: "account.deletion_requested",'),
  "el borrado no pide la contraseña, no tiene ruta o no queda auditado",
);
ok("el servidor pide la contraseña con el bloqueo del login, y audita borrados y solicitudes");

// Documentada, con sus dos respuestas de éxito: quien integre tiene que saber que
// un comercio no se borra al instante.
const openapi = await leer("server/openapi-account.js");
assert.ok(
  contains(openapi, '"/api/me/delete": {') &&
    contains(openapi, "202: success(") &&
    contains(await leer("server/openapi.js"), "accountPaths({ success, json, errorResponses }),"),
  "el borrado no está documentado en OpenAPI",
);
ok("OpenAPI documenta el borrado con su 200 y su 202");

// --- Ofrecido en cada lugar donde alguien administra su cuenta ---------------
const superficies = [
  ["perfil web del cliente", "src/customer/CustomerProfileScreen.tsx", "<AccountDeletion />"],
  ["camino web de Google (escritorio)", "src/ui/SystemStateScreen.tsx", "<AccountDeletion />"],
  [
    "cuenta móvil del cliente",
    "apps/mobile/src/screens/CustomerAccountScreen.tsx",
    "<AccountDeletion onDeleted={onLogout} />",
  ],
  [
    "cuenta móvil del repartidor",
    "apps/mobile/src/screens/DriverScreen.tsx",
    "<AccountDeletion onDeleted={onLogout} />",
  ],
  [
    "app móvil del comercio",
    "apps/mobile/src/variant-screen.merchant.tsx",
    "<AccountDeletion onDeleted={logout} />",
  ],
];
for (const [nombre, archivo, montaje] of superficies)
  assert.ok(contains(await leer(archivo), montaje), `el borrado no se ofrece en ${nombre}`);
ok("el borrado se ofrece en web y en las tres apps móviles");

// Antes de pedir la contraseña se dice qué se borra y qué se conserva, en las
// dos plataformas: la persona decide sabiendo que sus comprobantes quedan.
for (const archivo of ["src/ui/AccountDeletion.tsx", "apps/mobile/src/AccountDeletion.tsx"])
  assert.ok(
    contains(await leer(archivo), "se conservan sin tus datos") &&
      contains(await leer(archivo), "No se puede deshacer."),
    `${archivo} no explica qué se borra y qué se conserva`,
  );
ok("web y móvil explican qué se borra y qué se conserva antes de confirmar");
