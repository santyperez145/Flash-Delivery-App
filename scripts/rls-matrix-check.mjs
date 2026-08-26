// Matriz de cobertura RLS (ticket DAT-001, hallazgo H-04).
//
// El hallazgo fue que 20 de 106 tablas no tenían política y que nada lo hacía
// evidente. Esta puerta convierte la clasificación en un contrato: una tabla
// nueva no puede entrar sin decir a qué clase pertenece, y una tabla clasificada
// `por-usuario` no puede quedarse sin política salvo que esté en la lista de
// deuda declarada — que sólo puede achicarse.
//
// No sustituye a `test:rls`, que prueba denegación real contra PostgreSQL. Esto
// es análisis estático de las migraciones y corre sin base de datos.
import fs from "node:fs/promises";
import path from "node:path";

const MIGRATIONS_DIR = "database/migrations";
const CLASSIFICATION_PATH = "database/rls-classification.json";

// Tablas `por-usuario` que todavía no tienen política. La lista sólo puede
// achicarse: agregar una entrada exige explicar por qué no se puede aplicar la
// política todavía.
//
// `user_roles` es el caso difícil y conviene leerlo antes de tocarlo: se
// consulta ANTES de autenticar, así que una política por usuario rompería el
// login de toda la plataforma.
const DEUDA = new Map([
  ["user_roles", "se lee antes de autenticar; necesita SECURITY DEFINER para el login primero"],
  ["drivers", "39 archivos lo consultan, varios sin contexto de usuario"],
  ["merchants", "23 archivos lo consultan, varios sin contexto de usuario"],
  ["shipment_details", "candidata más limpia; falta la prueba negativa por rol"],
  ["promotion_redemptions", "falta la prueba negativa por rol"],
]);

const files = (await fs.readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith(".sql")).sort();
const sql = (
  await Promise.all(files.map((file) => fs.readFile(path.join(MIGRATIONS_DIR, file), "utf8")))
).join("\n");

const declared = new Set(
  [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-zA-Z_]+)/gi)].map((m) =>
    m[1].toLowerCase(),
  ),
);
const withRls = new Set(
  [...sql.matchAll(/ALTER TABLE ([a-zA-Z_]+) ENABLE ROW LEVEL SECURITY/gi)].map((m) =>
    m[1].toLowerCase(),
  ),
);

const { tablas: classification, _clases: classes } = JSON.parse(
  await fs.readFile(CLASSIFICATION_PATH, "utf8"),
);

const problems = [];

// 1. Toda tabla de una migración tiene que estar clasificada.
for (const table of [...declared].sort()) {
  if (!classification[table]) {
    problems.push(
      `${table}: creada en una migración pero sin clasificar en ${CLASSIFICATION_PATH}`,
    );
  }
}

// 2. Ninguna clasificación puede sobrevivir a su tabla.
for (const table of Object.keys(classification)) {
  if (!declared.has(table)) {
    problems.push(`${table}: clasificada pero ninguna migración la crea`);
  }
}

// 3. La clase declarada tiene que existir.
for (const [table, entry] of Object.entries(classification)) {
  if (!classes[entry.clase]) problems.push(`${table}: clase desconocida "${entry.clase}"`);
}

// 4. El campo `rls` tiene que coincidir con las migraciones. Si no, la matriz
//    está describiendo un esquema que ya no existe.
for (const [table, entry] of Object.entries(classification)) {
  if (!declared.has(table)) continue;
  const real = withRls.has(table);
  if (entry.rls !== real) {
    problems.push(
      `${table}: la matriz dice rls=${entry.rls} y las migraciones dicen ${real}`,
    );
  }
}

// 5. Una tabla `por-usuario` sin política tiene que estar en la deuda declarada.
const undeclaredDebt = [];
for (const [table, entry] of Object.entries(classification)) {
  if (entry.clase !== "por-usuario" || entry.rls || !declared.has(table)) continue;
  if (!DEUDA.has(table)) undeclaredDebt.push(table);
}
for (const table of undeclaredDebt) {
  problems.push(
    `${table}: clasificada por-usuario y sin política RLS. Aplicá la política, o agregala a DEUDA en este archivo con el motivo`,
  );
}

// 6. La deuda sólo puede achicarse.
for (const [table, reason] of DEUDA) {
  if (!declared.has(table)) {
    problems.push(`${table}: en la lista de deuda pero la tabla ya no existe`);
    continue;
  }
  if (withRls.has(table)) {
    problems.push(
      `${table}: ya tiene política RLS. Quitala de DEUDA (motivo registrado: ${reason})`,
    );
  }
}

if (problems.length) {
  console.error(`${problems.length} problema(s) en la matriz RLS:\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const counts = {};
for (const entry of Object.values(classification)) {
  counts[entry.clase] = (counts[entry.clase] || 0) + 1;
}

const perUser = Object.entries(classification).filter(([, e]) => e.clase === "por-usuario");
const covered = perUser.filter(([, e]) => e.rls).length;

console.log(`ok - ${declared.size} tablas clasificadas`);
for (const [clase, count] of Object.entries(counts).sort()) console.log(`     ${clase}: ${count}`);
console.log(`     por-usuario con política: ${covered} de ${perUser.length}`);
if (DEUDA.size) {
  console.log(`\n     deuda declarada (${DEUDA.size} tablas, sólo puede achicarse):`);
  for (const [table, reason] of DEUDA) console.log(`       ${table} — ${reason}`);
}
