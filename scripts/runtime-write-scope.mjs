// Qué tablas puede escribir el runtime y cuáles escribe de verdad (DAT-001).
//
// La migración 116 le quitó a `flash_runtime` la escritura sobre las ocho tablas
// de referencia donde nunca escribe, y retiró la herencia automática que hacía
// nacer con DML a toda tabla nueva. Quedan noventa y seis tablas con permiso de
// escritura, y acotarlas exige decidir **tabla por tabla**.
//
// Esto no decide: reúne la evidencia para decidir, y evita que la lista crezca.
//
// **Por qué no revoca solo.** Un inventario mecánico ya se equivocó una vez, y
// por poco introduce un fallo en producción: decía que `driver_availability_
// sessions` y `driver_job_sessions` eran de sólo lectura porque ningún `INSERT`
// del servidor las nombra. Las escriben **triggers** sobre `drivers`, que no son
// `SECURITY DEFINER`, así que corren con los permisos de quien dispara —el
// runtime— y revocarles la escritura habría roto a un conductor poniéndose en
// línea. Por eso acá el análisis de triggers no es un extra: es la mitad que
// evita el error.
//
// Las tres fuentes que se cruzan:
//
// 1. **La base**, que dice quién tiene qué permiso hoy.
// 2. **El código**, que dice qué tablas nombra un `INSERT`, `UPDATE` o `DELETE`
//    en `server/`.
// 3. **Los triggers**, que dicen qué tablas se escriben de rebote, sin que
//    ninguna consulta del servidor las nombre.
//
// Lo que sale es la lista de tablas donde el runtime puede escribir y nadie
// escribe. Son candidatas a acotar, no tablas condenadas: la lista se revisa a
// mano y se acota por lotes, con la suite entera corriendo detrás.
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  ssl: false,
});

const BASE = "scripts/runtime-write-scope-baseline.json";
const ROL = "flash_runtime";
const ESCRITURA = ["INSERT", "UPDATE", "DELETE"];

async function fuentes(entrada) {
  const stat = await fs.stat(entrada).catch(() => null);
  if (!stat) return [];
  if (stat.isFile()) return /\.(js|mjs)$/.test(entrada) ? [entrada] : [];
  const hijos = await fs.readdir(entrada);
  const anidados = await Promise.all(
    hijos
      .filter((hijo) => hijo !== "node_modules" && hijo !== "data")
      .map((hijo) => fuentes(path.posix.join(entrada, hijo))),
  );
  return anidados.flat();
}

// Un nombre de tabla puede venir con comillas o con esquema. Se normaliza al
// nombre pelado, que es como lo devuelve el catálogo.
const normalizar = (nombre) => nombre.replace(/"/g, "").split(".").pop().toLowerCase();

const ESCRITORAS = [
  /INSERT\s+INTO\s+([a-zA-Z0-9_."]+)/gi,
  /UPDATE\s+(?:ONLY\s+)?([a-zA-Z0-9_."]+)/gi,
  /DELETE\s+FROM\s+(?:ONLY\s+)?([a-zA-Z0-9_."]+)/gi,
];

function tablasEscritasEn(texto) {
  const encontradas = new Set();
  for (const patron of ESCRITORAS) {
    for (const coincidencia of texto.matchAll(patron)) {
      encontradas.add(normalizar(coincidencia[1]));
    }
  }
  return encontradas;
}

try {
  // --- 1. Lo que la base permite hoy ----------------------------------------
  const permisos = await pool.query(
    `SELECT table_name, array_agg(DISTINCT privilege_type ORDER BY privilege_type) privilegios
     FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND grantee = $1 AND privilege_type = ANY($2)
     GROUP BY table_name ORDER BY table_name`,
    [ROL, ESCRITURA],
  );
  const conEscritura = new Map(permisos.rows.map((f) => [f.table_name, f.privilegios]));

  // --- 2. Lo que el código escribe ------------------------------------------
  const archivos = await fuentes("server");
  if (archivos.length < 60) {
    throw new Error(`Sólo se inspeccionaron ${archivos.length} archivos de server/`);
  }
  const codigo = (await Promise.all(archivos.map((a) => fs.readFile(a, "utf8")))).join("\n");

  // Los nombres detectados se filtran contra el catálogo. Sin esto, `FOR UPDATE
  // OF p` aporta «of» y `ON CONFLICT DO UPDATE SET` aporta «set»: no rompen el
  // cruce —sólo aparecen tablas que no existen— pero inflan la cuenta, y un
  // número que no se puede verificar contra la base no sirve para decidir nada.
  //
  // La detección se queda del lado seguro a propósito. Un falso «esta tabla se
  // escribe» conserva un permiso de más; un falso «nadie la escribe» propone
  // quitar uno que hace falta. El primero cuesta una revisión, el segundo un
  // incidente.
  const reales = new Set(
    (await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)).rows.map(
      (f) => f.tablename,
    ),
  );
  const escritasPorCodigo = new Set(
    [...tablasEscritasEn(codigo)].filter((tabla) => reales.has(tabla)),
  );

  // --- 3. Lo que los triggers escriben de rebote -----------------------------
  //
  // Se mira el cuerpo de cada función de trigger. Una función `SECURITY DEFINER`
  // corre con los permisos de quien la definió, así que no exige nada del
  // runtime; el resto corre con los de quien dispara y sí.
  const triggers = await pool.query(
    `SELECT DISTINCT p.proname, p.prosrc, p.prosecdef
     FROM pg_trigger t
     JOIN pg_proc p ON p.oid = t.tgfoid
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT t.tgisinternal AND n.nspname = 'public'`,
  );
  const escritasPorTrigger = new Map();
  for (const fila of triggers.rows) {
    if (fila.prosecdef) continue;
    for (const tabla of tablasEscritasEn(fila.prosrc || "")) {
      if (!reales.has(tabla)) continue;
      if (!escritasPorTrigger.has(tabla)) escritasPorTrigger.set(tabla, new Set());
      escritasPorTrigger.get(tabla).add(fila.proname);
    }
  }

  // --- Cruce -----------------------------------------------------------------
  const candidatas = [];
  for (const [tabla, privilegios] of conEscritura) {
    if (escritasPorCodigo.has(tabla)) continue;
    if (escritasPorTrigger.has(tabla)) continue;
    candidatas.push({ tabla, privilegios });
  }
  candidatas.sort((a, b) => a.tabla.localeCompare(b.tabla));

  console.log(`${conEscritura.size} tablas con escritura para ${ROL}`);
  console.log(`${escritasPorCodigo.size} tablas nombradas por un write en server/`);
  console.log(
    `${escritasPorTrigger.size} tablas escritas de rebote por un trigger sin SECURITY DEFINER`,
  );
  console.log("");

  if (escritasPorTrigger.size) {
    console.log("Escrituras indirectas (las que un inventario mecánico se pierde):");
    for (const [tabla, funciones] of [...escritasPorTrigger].sort()) {
      console.log(`  ${tabla} <- ${[...funciones].join(", ")}`);
    }
    console.log("");
  }

  console.log(`${candidatas.length} candidata(s) a acotar:`);
  for (const { tabla, privilegios } of candidatas) {
    console.log(`  ${tabla} (${privilegios.join(",")})`);
  }

  // --- Trinquete -------------------------------------------------------------
  //
  // La línea base sólo puede bajar. Una tabla nueva con escritura que nadie usa
  // hace subir la cuenta y la puerta corta: es el momento barato de decidir, no
  // tres meses después.
  const previa = JSON.parse(await fs.readFile(BASE, "utf8").catch(() => "null"));
  if (!previa) {
    console.log(`\nSin línea base. Escribí ${BASE} con { "candidatas": ${candidatas.length} }.`);
    process.exit(1);
  }
  if (candidatas.length > previa.candidatas) {
    console.error(`\nLa línea base es ${previa.candidatas} y ahora hay ${candidatas.length}.`);
    console.error("Una tabla nueva nació con escritura que nadie usa, o un write dejó de existir.");
    console.error(
      "Decidir ahora cuesta una línea de migración; dentro de tres meses, una auditoría.",
    );
    process.exit(1);
  }
  if (candidatas.length < previa.candidatas) {
    console.log(
      `\nok - bajó de ${previa.candidatas} a ${candidatas.length}: actualizá ${BASE} en este mismo PR`,
    );
    process.exit(1);
  }
  console.log(`\nok - ${candidatas.length} candidatas, igual que la línea base`);
} finally {
  await pool.end();
}
