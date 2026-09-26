// El recorte espacial usa el índice, y se mide sobre mil conductores (DSP-001).
//
// El hallazgo H-06 era que el dispatch evaluaba a todos los conductores para
// cada oferta. La solución fue el recorte espacial con `ST_DWithin` y orden KNN
// sobre el índice GiST, y `test:dispatch-candidates` cubre que la consulta
// exista y devuelva lo correcto.
//
// Lo que no cubría nadie es lo único que hace que valga la pena: **que el
// planificador use el índice**. Una consulta con `ST_DWithin` que termina en un
// `Seq Scan` devuelve exactamente las mismas filas y no arregla nada; la
// diferencia sólo se ve en el plan, y sólo con datos suficientes.
//
// **Por qué mil conductores.** Con los tres del sembrado, PostgreSQL elige un
// `Seq Scan` y hace bien: recorrer tres filas es más barato que abrir un índice.
// Una puerta que explicara esa consulta sobre esos datos mediría el caso que no
// importa. Los mil son, además, el padrón sintético que pide el ticket.
//
// **Se explica la consulta real.** `SHORTLIST_SQL` se importa del módulo que la
// ejecuta en producción. Explicar una copia probaría que la copia usa el índice.
//
// Todo corre dentro de una transacción que termina en ROLLBACK: los mil
// conductores y las sesiones que sus triggers abren desaparecen solas.
import crypto from "node:crypto";
import pg from "pg";
import { SHORTLIST_SQL } from "../server/dispatch-candidates.js";
import {
  LISTA_CORTA,
  PADRON,
  PICKUP,
  RADIO_M,
  pickupGeography,
  seedSyntheticPadron,
} from "./dispatch-synthetic-padron.mjs";

const pool = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  ssl: false,
});

const INDICE = "drivers_available_location_gix";

let fallos = 0;
const ok = (etiqueta) => console.log(`ok - ${etiqueta}`);
const comprobar = (condicion, etiqueta, detalle) => {
  if (condicion) return ok(etiqueta);
  fallos++;
  console.error(`FALLA - ${etiqueta}`);
  if (detalle) console.error(`        ${detalle}`);
  return undefined;
};

/** Recorre el árbol del plan juntando los índices que efectivamente se usan. */
function indicesUsados(nodo, encontrados = new Set()) {
  if (!nodo || typeof nodo !== "object") return encontrados;
  if (nodo["Index Name"]) encontrados.add(nodo["Index Name"]);
  for (const hijo of nodo.Plans ?? []) indicesUsados(hijo, encontrados);
  return encontrados;
}

const cliente = await pool.connect();
try {
  await cliente.query("BEGIN");

  const marca = `dispatch-plan-${crypto.randomBytes(4).toString("hex")}`;
  const { count: padronCount } = await seedSyntheticPadron(cliente, marca);
  comprobar(padronCount >= PADRON, `el padrón sintético tiene ${padronCount} conductores en línea`);

  await cliente.query("ANALYZE drivers");

  const parametros = [pickupGeography(), "delivery", RADIO_M, LISTA_CORTA];

  const explicado = await cliente.query(
    `EXPLAIN (ANALYZE, FORMAT JSON) ${SHORTLIST_SQL}`,
    parametros,
  );
  const plan = explicado.rows[0]["QUERY PLAN"][0];
  const usados = indicesUsados(plan.Plan);
  comprobar(
    usados.has(INDICE),
    `el recorte espacial usa ${INDICE}`,
    `índices en el plan: ${[...usados].join(", ") || "ninguno"} · nodo raíz ${plan.Plan["Node Type"]}`,
  );
  console.log(`     plan: ${plan.Plan["Node Type"]} · ${plan["Execution Time"].toFixed(1)} ms`);
  console.log(`     el tiempo se informa y no se afirma: el runner comparte CPU y`);
  console.log(`     medir latencia acá daría una puerta intermitente. Eso es test:dispatch-load.`);

  await cliente.query("SET LOCAL enable_indexscan = off");
  await cliente.query("SET LOCAL enable_bitmapscan = off");
  const sinIndice = await cliente.query(
    `EXPLAIN (ANALYZE, FORMAT JSON) ${SHORTLIST_SQL}`,
    parametros,
  );
  const usadosSinIndice = indicesUsados(sinIndice.rows[0]["QUERY PLAN"][0].Plan);
  comprobar(
    !usadosSinIndice.has(INDICE),
    "con los caminos por índice apagados, el plan deja de usarlo",
    "el detector encuentra el índice incluso cuando no se usa: no distingue nada",
  );
  await cliente.query("SET LOCAL enable_indexscan = on");
  await cliente.query("SET LOCAL enable_bitmapscan = on");

  const filas = await cliente.query(SHORTLIST_SQL, parametros);
  comprobar(
    filas.rowCount > 0 && filas.rowCount <= LISTA_CORTA,
    `la lista corta trae ${filas.rowCount} conductores, acotada a ${LISTA_CORTA}`,
    "un recorte que devuelve cero o que devuelve todo no es un recorte",
  );
} finally {
  await cliente.query("ROLLBACK").catch(() => {});
  cliente.release();
  await pool.end();
}

if (fallos) {
  console.error(`\n${fallos} comprobación(es) del plan de dispatch fallaron`);
  process.exit(1);
}
console.log("\nok - el recorte espacial usa el índice GiST sobre un padrón de mil conductores");
