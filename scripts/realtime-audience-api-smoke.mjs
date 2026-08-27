// La ruta que alimenta el panel de audiencias (ticket SEC-001).
//
// `test:realtime-audience-runtime` prueba `getRealtimeAudienceHealth` llamándola
// directamente, que cubre la consulta y la agregación. Lo que no cubre es la
// ruta: quién puede pedirla, qué devuelve por HTTP y qué pasa con un parámetro
// hostil. Una consulta correcta detrás de una ruta abierta no sirve de nada, y
// esto es un panel de operaciones que enumera eventos mal clasificados —justo el
// material que no debe quedar a la vista de un cliente—.
import pg from "pg";

const base = process.env.API_URL || "http://127.0.0.1:4000/api";
const pool = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  ssl: false,
});

let fallos = 0;
const ok = (etiqueta) => console.log(`ok - ${etiqueta}`);
const comprobar = (condicion, etiqueta, detalle) => {
  if (condicion) return ok(etiqueta);
  fallos++;
  console.error(`FALLA - ${etiqueta}`);
  if (detalle) console.error(`        ${detalle}`);
  return undefined;
};

const llamar = async (ruta, token) => {
  const respuesta = await fetch(`${base}${ruta}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  let cuerpo = {};
  try {
    cuerpo = await respuesta.json();
  } catch {
    cuerpo = {};
  }
  return { status: respuesta.status, cuerpo };
};

const entrar = async (email) => {
  const respuesta = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo123", deviceName: "realtime-audience-api" }),
  });
  const cuerpo = await respuesta.json();
  if (!cuerpo.token) throw new Error(`No se pudo entrar como ${email}: ${respuesta.status}`);
  return cuerpo.token;
};

try {
  // 1. Sin sesión no se contesta.
  const anonimo = await llamar("/admin/realtime-audience");
  comprobar(anonimo.status === 401, "sin sesion la ruta responde 401", `dio ${anonimo.status}`);

  // 2. Un cliente autenticado tampoco. Ésta es la comprobación que importa: la
  //    respuesta enumera eventos con su tipo y su entidad, y eso no es material
  //    para alguien que sólo tiene rol de cliente.
  const cliente = await entrar("cliente@flash.app");
  const conCliente = await llamar("/admin/realtime-audience", cliente);
  comprobar(
    conCliente.status === 403,
    "un cliente autenticado recibe 403",
    `dio ${conCliente.status}`,
  );

  // 3. Operaciones sí, y con la forma que el panel espera.
  const ops = await entrar("ops@flash.app");
  const conOps = await llamar("/admin/realtime-audience", ops);
  comprobar(conOps.status === 200, "operaciones recibe 200", `dio ${conOps.status}`);
  const salud = conOps.cuerpo;
  comprobar(
    typeof salud.windowHours === "number" &&
      typeof salud.total === "number" &&
      Array.isArray(salud.byOutcome) &&
      Array.isArray(salud.unclassified?.byEntityType) &&
      Array.isArray(salud.unclassified?.recent),
    "la respuesta trae la forma que el panel consume",
    JSON.stringify(salud).slice(0, 160),
  );

  // 4. La ventana se acota. Un `hours` gigante no puede convertirse en un barrido
  //    de la tabla entera desde una ruta autenticada: el log retiene siete días,
  //    así que más allá de eso el número sólo sirve para hacer trabajar a la base.
  const exagerado = await llamar("/admin/realtime-audience?hours=100000", ops);
  comprobar(
    exagerado.status === 200 && exagerado.cuerpo.windowHours <= 24 * 7,
    "una ventana exagerada se acota a la retencion del log",
    `windowHours = ${exagerado.cuerpo?.windowHours}`,
  );

  const basura = await llamar("/admin/realtime-audience?hours=no-es-un-numero", ops);
  comprobar(
    basura.status === 200 && basura.cuerpo.windowHours === 24,
    "una ventana no numerica cae en el valor por omision",
    `windowHours = ${basura.cuerpo?.windowHours}`,
  );

  // 5. La agregación coincide con la base. Sin esto, una ruta que devolviera una
  //    forma correcta con ceros pasaría todas las comprobaciones anteriores.
  const enBase = Number(
    (
      await pool.query(
        `SELECT count(*)::int n FROM realtime_events
         WHERE audience_outcome = 'unclassified' AND occurred_at > now() - interval '24 hours'`,
      )
    ).rows[0].n,
  );
  comprobar(
    salud.unclassified.total === enBase,
    "el total sin clasificar coincide con lo que hay en la base",
    `la ruta dijo ${salud.unclassified.total}, la base tiene ${enBase}`,
  );
} finally {
  await pool.end();
}

if (fallos) {
  console.error(`\n${fallos} comprobacion(es) de la ruta de audiencias fallaron`);
  process.exit(1);
}
console.log("\nok - la ruta del panel de audiencias contesta a operaciones y a nadie mas");
