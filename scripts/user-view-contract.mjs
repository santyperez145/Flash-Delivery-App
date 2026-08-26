// La redacción del usuario, verificada (ticket ARC-001, paso 2).
//
// `sanitizeUser` decide qué campos de un usuario salen por HTTP. Estuvo suelta
// en `server/index.js` hasta que el listado operativo la necesitó desde un
// router: ahí se volvió un módulo, y un módulo que decide qué se expone merece
// una puerta que falle si alguien le saca un campo.
//
// `test:sensitive-data` no cubre esto. Ese contrato mira la base —que no haya
// columnas con PAN, que los tokens no estén en claro— y no lo que la API
// devuelve. Son dos límites distintos y ninguno implica al otro.
import fs from "node:fs/promises";
import path from "node:path";
import { contains } from "./source-contract.mjs";
import { sanitizeUser } from "../server/user-view.js";

const problemas = [];
const check = (condicion, etiqueta) => {
  if (condicion) console.log(`ok - ${etiqueta}`);
  else problemas.push(etiqueta);
};

// Un usuario con todo lo que la base guarda, incluido lo que no debe salir.
const salida = sanitizeUser({
  id: "usr_1",
  name: "Ana",
  email: "ana@example.com",
  roles: ["customer"],
  password: "$2b$12$hash",
  internalId: 4821,
  loginLockedUntil: "2026-08-26T10:00:00.000Z",
});

check(!("password" in salida), "el hash de contraseña no sale por HTTP");
check(!("internalId" in salida), "la clave primaria interna no sale por HTTP");
check(!("loginLockedUntil" in salida), "el bloqueo de login no revela si el usuario existe");
check(salida.id === "usr_1" && salida.email === "ana@example.com", "lo que sí es público pasa");
check(sanitizeUser(null) === null, "un usuario ausente no se convierte en objeto vacío");

// La semántica es lista de exclusión: una columna nueva sale salvo que se la
// agregue. Se afirma a propósito para que el día que alguien la invierta —a
// lista de inclusión— tenga que venir acá y decidirlo, en lugar de que el
// cambio pase inadvertido y empiece a faltar información en la API.
check("apellido" in sanitizeUser({ apellido: "Pérez" }), "un campo nuevo sale por omisión");

// La razón de existir del módulo es que la redacción viva en un solo lugar.
// Una segunda copia es la que en algún momento deja de coincidir: esta puerta
// encontró una en `auth-repository.js`, con los tres campos escritos de nuevo a
// mano dentro del listado operativo de usuarios.
//
// Se busca la redacción de los tres campos y no cualquier `{ password, ... }`.
// El runtime de respaldo SQLite tiene su propia proyección —`publicUser` en
// `index.js` y `sanitize` en `store.js`— que saca sólo `password`, y es
// correcta: ahí los usuarios no tienen `internalId` ni `loginLockedUntil`,
// porque son columnas de PostgreSQL. Tratarlas como copias obligaría a
// unificarlas y el resultado leería campos que en ese runtime no existen.
//
// La comparación pasa por `source-contract.mjs`, que ignora el espaciado: un
// contrato acoplado al formato bloquea el refactor que debería proteger.
const REDACCION = "{ password, internalId, loginLockedUntil,";
async function recorrer(entrada) {
  const stat = await fs.stat(entrada).catch(() => null);
  if (!stat) return [];
  if (stat.isFile()) return entrada.endsWith(".js") ? [entrada] : [];
  const hijos = await fs.readdir(entrada);
  const anidados = await Promise.all(
    hijos
      .filter((hijo) => hijo !== "node_modules" && hijo !== "data")
      .map((hijo) => recorrer(path.posix.join(entrada, hijo))),
  );
  return anidados.flat();
}
const archivos = await recorrer("server");
if (archivos.length < 50) throw new Error(`Sólo se inspeccionaron ${archivos.length} módulos`);
const copias = [];
for (const archivo of archivos) {
  if (archivo === "server/user-view.js") continue;
  if (contains(await fs.readFile(archivo, "utf8"), REDACCION)) copias.push(archivo);
}
check(
  copias.length === 0,
  `la redacción no está duplicada (${copias.join(", ") || "ninguna copia"})`,
);

if (problemas.length) {
  console.error(`\n${problemas.length} comprobación(es) fallaron:\n`);
  for (const problema of problemas) console.error(`  - ${problema}`);
  process.exit(1);
}
console.log(`\nok - ${archivos.length} módulos del servidor con una sola redacción de usuario`);
