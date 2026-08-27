// La negativa de arranque por rol con bypass de RLS (ticket DAT-001).
//
// Recorre la tabla de casos de `bypassRefusalReason`. Es una función pura sobre
// el resultado de `postgresReadiness()`, así que esto corre sin base de datos y
// sin levantar el proceso.
//
// Lo que se prueba no es que el mensaje sea lindo sino **cuándo se dice que no**,
// que es donde una decisión así se rompe: negarse de más deja la plataforma sin
// arrancar por una caída transitoria, y negarse de menos deja servir datos con
// las políticas apagadas.
import { bypassRefusalReason } from "../server/rls-guard.js";

const problemas = [];
const check = (condicion, etiqueta) => {
  if (condicion) console.log(`ok - ${etiqueta}`);
  else problemas.push(etiqueta);
};

const runtime = {
  configured: true,
  ready: true,
  database_role: "flash_runtime",
  schema_owner: "flash_app",
  bypass_rls: false,
  least_privilege: true,
};
const duenio = {
  ...runtime,
  database_role: "flash_app",
  least_privilege: false,
};
const conBypass = {
  ...runtime,
  database_role: "flash_super",
  bypass_rls: true,
  least_privilege: false,
};

check(
  bypassRefusalReason(runtime, { isProduction: true }) === null,
  "el rol de runtime arranca en producción",
);

const porDuenio = bypassRefusalReason(duenio, { isProduction: true });
check(typeof porDuenio === "string", "el rol dueño del esquema no arranca en producción");
check(
  porDuenio?.includes("flash_app") && porDuenio?.includes("dueño del esquema"),
  "la negativa nombra el rol y por qué es peligroso",
);
check(
  porDuenio?.includes("flash_runtime"),
  "la negativa dice a qué rol apuntar, no sólo que está mal",
);

const porBypass = bypassRefusalReason(conBypass, { isProduction: true });
check(porBypass?.includes("BYPASSRLS"), "un rol con BYPASSRLS no arranca en producción");

// Las tres excepciones. Cada una existe por un motivo distinto y una puerta que
// no las distinga vuelve inusable algo: el entorno local, el respaldo SQLite o
// la tolerancia a una caída de base.
check(
  bypassRefusalReason(duenio, { isProduction: false }) === null,
  "fuera de producción el rol dueño es normal y no bloquea",
);
check(
  bypassRefusalReason({ configured: false, ready: false }, { isProduction: true }) === null,
  "sin base configurada no hay RLS que saltear",
);
check(
  bypassRefusalReason(
    { configured: true, ready: false, reason: "database unavailable" },
    { isProduction: true },
  ) === null,
  "una base caída no impide arrancar: no se puede afirmar nada del rol",
);

// Un readiness con `least_privilege` falso y campos vacíos: la decisión sigue
// siendo negarse, y el mensaje no inventa una causa que no se comprobó.
const incompleto = bypassRefusalReason(
  { configured: true, ready: true, least_privilege: false },
  { isProduction: true },
);
check(typeof incompleto === "string", "sin menor privilegio se niega aunque falten los detalles");
check(
  incompleto?.includes("no se pudo confirmar"),
  "cuando no se sabe la causa, el mensaje lo dice en vez de inventarla",
);

if (problemas.length) {
  console.error(`\n${problemas.length} comprobación(es) fallaron:\n`);
  for (const problema of problemas) console.error(`  - ${problema}`);
  process.exit(1);
}
console.log("\nok - la negativa de arranque distingue el rol peligroso de las tres excepciones");
