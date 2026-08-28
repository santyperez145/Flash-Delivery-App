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

const pool = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  ssl: false,
});

const INDICE = "drivers_available_location_gix";
const PADRON = 1000;
const RADIO_M = 8000;
const LISTA_CORTA = 30;
// Obelisco, y los conductores repartidos alrededor hasta unos 40 km: más lejos
// que el radio de búsqueda, para que el filtro espacial tenga algo que filtrar.
const PICKUP = { lng: -58.3816, lat: -34.6037 };

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

  // --- Padrón sintético ------------------------------------------------------
  const marca = `dispatch-plan-${crypto.randomBytes(4).toString("hex")}`;
  await cliente.query(
    `INSERT INTO users(public_id, email, password_hash, name, email_verified_at)
     SELECT $1 || '-' || i, $1 || '-' || i || '@flash.test', 'x', 'Conductor sintetico ' || i, now()
     FROM generate_series(1, $2) i`,
    [marca, PADRON],
  );
  await cliente.query(
    `INSERT INTO drivers(user_id, online, active_mode, service_modes, rating,
                         current_location, location_updated_at, location_accuracy_m)
     SELECT u.id, true, 'delivery', ARRAY['delivery']::job_kind[], 4.5,
            ST_SetSRID(ST_MakePoint($2 + (random() - 0.5) * 0.8, $3 + (random() - 0.5) * 0.8), 4326)::geography,
            now(), 20
     FROM users u WHERE u.public_id LIKE $1 || '-%'`,
    [marca, PICKUP.lng, PICKUP.lat],
  );
  const padron = await cliente.query(
    "SELECT count(*)::int n FROM drivers d JOIN users u ON u.id = d.user_id WHERE u.public_id LIKE $1 || '-%'",
    [marca],
  );
  comprobar(
    padron.rows[0].n >= PADRON,
    `el padrón sintético tiene ${padron.rows[0].n} conductores en línea`,
  );

  // Sin esto el planificador decide con las estadísticas de antes de la carga, y
  // el plan que se mide no es el que correría con estos datos.
  await cliente.query("ANALYZE drivers");

  const parametros = [
    `SRID=4326;POINT(${PICKUP.lng} ${PICKUP.lat})`,
    "delivery",
    RADIO_M,
    LISTA_CORTA,
  ];

  // --- El plan usa el índice -------------------------------------------------
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
  console.log(`     medir latencia acá daría una puerta intermitente. Eso es test:performance.`);

  // --- La otra mitad: la comprobación sabe distinguir ------------------------
  //
  // Sin esto, un detector que buscara cualquier índice en cualquier parte del
  // plan aprobaría siempre. Se le apagan los caminos por índice y se exige que
  // el mismo plan deje de usarlo.
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

  // --- Y devuelve lo que tiene que devolver ---------------------------------
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
