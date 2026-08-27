// El runtime no recupera permisos que no pidió (ticket DAT-001).
//
// La migración 010 le dio a `flash_runtime` DML sobre todas las tablas y una
// regla de privilegios por omisión que repetía ese permiso sobre toda tabla
// futura. La 116 revocó la escritura donde el código nunca escribe y retiró la
// herencia.
//
// Esta puerta impide que vuelva. No es paranoia: la forma `ON ALL TABLES` es la
// que uno escribe sin pensar cuando una migración falla con «permission denied»,
// y resuelve el síntoma deshaciendo la decisión. El costo de equivocarse en esa
// dirección es silencioso —una tabla nueva nace escribible y nadie se entera—,
// que es exactamente cómo un almacén de credenciales muerto quedó alcanzable.
//
// Lo que se permite es lo contrario: un `GRANT` explícito, tabla por tabla, en
// la misma migración que crea la tabla. Eso es lo que se busca.
//
// **La 010 queda exceptuada a propósito.** Es el registro histórico de cómo
// quedaron los permisos y no se reescribe: las migraciones son de sólo agregar,
// y borrar su contenido dejaría un esquema que no se puede reconstruir desde
// cero. La 116 la corrige hacia adelante, que es la única forma honesta.
import fs from "node:fs/promises";
import path from "node:path";

const MIGRACIONES = "database/migrations";

// La que introdujo el permiso general. Su texto es historia, no una decisión
// vigente: la 116 lo revoca.
const HISTORICA = "010_runtime_role_security.sql";

// Escritura sobre todas las tablas de una sola vez.
const GRANT_GENERAL = /GRANT[^;]*\b(INSERT|UPDATE|DELETE)\b[^;]*ON ALL TABLES/is;

// Herencia automática: la regla que hace nacer con permiso a toda tabla futura.
// Sólo se persigue la variante que otorga; la que revoca es justamente el
// arreglo.
const HERENCIA = /ALTER DEFAULT PRIVILEGES[^;]*\bGRANT\b[^;]*ON TABLES/is;

const archivos = (await fs.readdir(MIGRACIONES)).filter((a) => a.endsWith(".sql")).sort();

const PISO = 100;
if (archivos.length < PISO) {
  throw new Error(`Sólo se leyeron ${archivos.length} migraciones y el piso es ${PISO}`);
}

const problemas = [];
for (const archivo of archivos) {
  if (archivo === HISTORICA) continue;
  const sql = await fs.readFile(path.posix.join(MIGRACIONES, archivo), "utf8");
  if (GRANT_GENERAL.test(sql)) {
    problemas.push(`${archivo}: otorga escritura con \`ON ALL TABLES\``);
  }
  if (HERENCIA.test(sql)) {
    problemas.push(`${archivo}: reinstala privilegios por omisión sobre tablas futuras`);
  }
}

if (problemas.length) {
  console.error(`${problemas.length} migración(es) devuelven el permiso general:\n`);
  for (const problema of problemas) console.error(`  - ${problema}`);
  console.error("\nOtorgá tabla por tabla, en la misma migración que crea la tabla.");
  console.error("Si una migración falla con «permission denied», falta ese GRANT: agregalo.");
  process.exit(1);
}

// La revocación de la 116 tiene que seguir presente. Sin esto, borrarla pasaría
// desapercibido y la puerta de arriba seguiría en verde sobre un esquema que
// volvió a ser permisivo.
const narrowing = await fs.readFile(
  path.posix.join(MIGRACIONES, "116_runtime_grant_narrowing.sql"),
  "utf8",
);
const REVOCADAS = [
  "allergens",
  "cities",
  "dietary_labels",
  "payment_customers",
  "referral_campaigns",
  "shipment_protection_plans",
  "support_sla_policies",
  "zone_readiness_policies",
];
const faltantes = REVOCADAS.filter((tabla) => !narrowing.includes(tabla));
if (faltantes.length || !/REVOKE INSERT, UPDATE, DELETE/i.test(narrowing)) {
  console.error("La revocación de escritura de la migración 116 ya no está completa.\n");
  for (const tabla of faltantes) console.error(`  - falta ${tabla}`);
  console.error("\nSi el runtime empezó a escribir una de esas tablas, sacala de la lista acá");
  console.error("y de la migración, y decilo en `docs/matriz-rls.md`.");
  process.exit(1);
}

console.log(`ok - ${archivos.length} migraciones sin permiso general para el runtime`);
console.log(`     ${REVOCADAS.length} tablas de referencia siguen sin escritura`);
