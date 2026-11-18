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
const migracion = await leer("database/migrations/138_account_deletion.sql");
assert.ok(
  contains(migracion, "CREATE FUNCTION app.delete_customer_account(p_user uuid) RETURNS void") &&
    contains(migracion, "SECURITY DEFINER") &&
    contains(migracion, "SET search_path = public, pg_catalog AS $$") &&
    contains(
      migracion,
      "REVOKE EXECUTE ON FUNCTION app.delete_customer_account(uuid) FROM PUBLIC;",
    ),
  "el borrado no es una función acotada, o cualquiera puede ejecutarla",
);
for (const guarda of [
  "FLASH_DELETE_ROLE",
  "FLASH_DELETE_ACTIVE_JOB",
  "FLASH_DELETE_WALLET_BALANCE",
])
  assert.ok(contains(migracion, guarda), `la función no protege ${guarda}`);
ok("la base borra con una función acotada, que protege roles, pedidos en curso y saldo");

// --- El servidor: pide la contraseña otra vez y audita -----------------------
const repositorio = await leer("server/account-deletion-repository.js");
const ruta = await leer("server/http/auth-router.js");
assert.ok(
  // La guarda entera, no sólo la llamada: `bcrypt.compare` presente pero sin
  // cortar el flujo no protege nada. Así lo encontró la falsificación.
  contains(
    repositorio,
    'if (!(await bcrypt.compare(String(password || ""), usuario.password_hash))) throw Object.assign(new Error("La contraseña no coincide"), { status: 403 });',
  ) &&
    contains(ruta, 'router.post("/api/me/delete", requireAuth,') &&
    contains(ruta, 'action: "account.deleted",') &&
    contains(ruta, 'action: "account.deletion_requested",'),
  "el borrado no pide la contraseña, no tiene ruta o no queda auditado",
);
ok("el servidor pide la contraseña otra vez y audita borrados y solicitudes");

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
