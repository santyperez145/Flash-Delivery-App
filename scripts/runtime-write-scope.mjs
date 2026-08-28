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
// Lo que sale es la lista de **permisos de más**: pares (tabla, operación) que
// el rol tiene y nadie usa. Se cuenta por operación y no por tabla porque el
// criterio es acotar por operación: la mayoría de las tablas que sobran
// permisos escriben algo, sólo que menos de lo que pueden. Una tabla que sólo
// recibe INSERT y UPDATE no necesita DELETE, y ese permiso de más es superficie
// gratis.
//
// Son candidatos a acotar, no permisos condenados: la lista se revisa a mano y
// se acota por lotes, con la suite entera corriendo detrás.
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

// Cada forma se asocia a la operación que otorga. El criterio de DAT-001 no es
// «esta tabla se escribe» sino «se acota **por operación**»: una tabla que sólo
// recibe INSERT y UPDATE no necesita DELETE, y ese permiso de más es superficie
// gratis. Sin distinguir la operación, la herramienta no puede responder la
// pregunta que se le hace.
const ESCRITORAS = [
  ["INSERT", /INSERT\s+INTO\s+([a-zA-Z0-9_."]+)/gi],
  ["UPDATE", /UPDATE\s+(?:ONLY\s+)?([a-zA-Z0-9_."]+)/gi],
  ["DELETE", /DELETE\s+FROM\s+(?:ONLY\s+)?([a-zA-Z0-9_."]+)/gi],
];

/**
 * Devuelve Map<tabla, Set<operación>> con lo que el texto escribe.
 *
 * `INSERT ... ON CONFLICT ... DO UPDATE` cuenta **también** como UPDATE, porque
 * PostgreSQL exige los dos permisos para ejecutarlo. Sin esta regla la
 * herramienta decía que a `ledger_accounts` le sobraba UPDATE, y hacerle caso
 * habría roto `systemAccount`, que es un upsert. Hay 27 en `server/`, sobre al
 * menos doce tablas.
 *
 * Es el mismo error que estuvo por meterse en produccion con los triggers, en
 * otra forma: el permiso que hace falta no siempre esta escrito donde uno lo
 * busca. Por eso la herramienta se verifica contra casos conocidos antes de
 * creerle, y no al reves.
 */
function escriturasEn(texto) {
  const encontradas = new Map();
  const anotar = (tabla, operacion) => {
    if (!encontradas.has(tabla)) encontradas.set(tabla, new Set());
    encontradas.get(tabla).add(operacion);
  };
  for (const [operacion, patron] of ESCRITORAS) {
    for (const coincidencia of texto.matchAll(patron)) {
      const tabla = normalizar(coincidencia[1]);
      anotar(tabla, operacion);
      if (operacion !== "INSERT") continue;
      // La ventana llega hasta el proximo INSERT o hasta el final: en este
      // codigo cada sentencia vive en su propio literal, asi que un
      // `DO UPDATE` que aparezca antes del siguiente INSERT es de esta.
      const desde = coincidencia.index + coincidencia[0].length;
      const siguiente = texto.slice(desde).search(/INSERT\s+INTO/i);
      const ventana = texto.slice(desde, siguiente === -1 ? undefined : desde + siguiente);
      if (/ON\s+CONFLICT[\s\S]*?DO\s+UPDATE/i.test(ventana)) anotar(tabla, "UPDATE");
    }
  }
  return encontradas;
}
try {
  // --- 1. Lo que la base permite hoy ----------------------------------------
  // `privilege_type` es un dominio de `information_schema`, y agregarlo sin
  // castear devuelve algo que node-postgres entrega como cadena y no como
  // arreglo. El `::text` lo vuelve un `text[]` de verdad.
  const permisos = await pool.query(
    `SELECT table_name, array_agg(DISTINCT privilege_type::text ORDER BY privilege_type::text) privilegios
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
  const escritasPorCodigo = new Map(
    [...escriturasEn(codigo)].filter(([tabla]) => reales.has(tabla)),
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
    for (const [tabla, operaciones] of escriturasEn(fila.prosrc || "")) {
      if (!reales.has(tabla)) continue;
      if (!escritasPorTrigger.has(tabla)) {
        escritasPorTrigger.set(tabla, { operaciones: new Set(), funciones: new Set() });
      }
      const entrada = escritasPorTrigger.get(tabla);
      for (const operacion of operaciones) entrada.operaciones.add(operacion);
      entrada.funciones.add(fila.proname);
    }
  }

  // --- Cruce -----------------------------------------------------------------
  //
  // Un permiso sobra cuando la operación no aparece ni en el código ni en un
  // trigger. Se cuenta por par (tabla, operación) y no por tabla: la mayoría de
  // las tablas que sobran permisos escriben algo, sólo que menos de lo que
  // pueden.
  const sobrantes = [];
  for (const [tabla, privilegios] of conEscritura) {
    const usadas = new Set([
      ...(escritasPorCodigo.get(tabla) ?? []),
      ...(escritasPorTrigger.get(tabla)?.operaciones ?? []),
    ]);
    const demas = privilegios.filter((operacion) => !usadas.has(operacion));
    if (demas.length) sobrantes.push({ tabla, demas, usadas: [...usadas].sort() });
  }
  sobrantes.sort((a, b) => a.tabla.localeCompare(b.tabla));
  const paresSobrantes = sobrantes.reduce((suma, f) => suma + f.demas.length, 0);

  console.log(`${conEscritura.size} tablas con escritura para ${ROL}`);
  console.log(`${escritasPorCodigo.size} tablas escritas desde server/`);
  console.log(
    `${escritasPorTrigger.size} tablas escritas de rebote por un trigger sin SECURITY DEFINER`,
  );
  console.log("");

  if (escritasPorTrigger.size) {
    console.log("Escrituras indirectas (las que un inventario mecánico se pierde):");
    for (const [tabla, { operaciones, funciones }] of [...escritasPorTrigger].sort()) {
      console.log(
        `  ${tabla} ${[...operaciones].sort().join(",")} <- ${[...funciones].sort().join(", ")}`,
      );
    }
    console.log("");
  }

  console.log(`${paresSobrantes} permiso(s) de mas en ${sobrantes.length} tabla(s):`);
  for (const { tabla, demas, usadas } of sobrantes) {
    const uso = usadas.length ? usadas.join(",") : "ninguna";
    console.log(`  ${tabla}: sobra ${demas.join(",")} (usa ${uso})`);
  }
  // --- Trinquete -------------------------------------------------------------
  //
  // La línea base sólo puede bajar. Una tabla nueva con escritura que nadie usa
  // hace subir la cuenta y la puerta corta: es el momento barato de decidir, no
  // tres meses después.
  const previa = JSON.parse(await fs.readFile(BASE, "utf8").catch(() => "null"));
  if (!previa) {
    console.log(`\nSin línea base. Escribí ${BASE} con { "sobrantes": ${paresSobrantes} }.`);
    process.exit(1);
  }
  if (paresSobrantes > previa.sobrantes) {
    console.error(`\nLa línea base es ${previa.sobrantes} y ahora hay ${paresSobrantes}.`);
    console.error("Una tabla nueva nació con permisos que nadie usa, o un write dejó de existir.");
    console.error(
      "Decidir ahora cuesta una línea de migración; dentro de tres meses, una auditoría.",
    );
    process.exit(1);
  }
  if (paresSobrantes < previa.sobrantes) {
    console.log(
      `\nok - bajó de ${previa.sobrantes} a ${paresSobrantes}: actualizá ${BASE} en este mismo PR`,
    );
    process.exit(1);
  }
  console.log(`\nok - ${paresSobrantes} permisos de mas, igual que la línea base`);
} finally {
  await pool.end();
}
