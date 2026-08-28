// El rol que sirve el tráfico no puede convertirse en otra cosa (DAT-001).
//
// `FORCE ROW LEVEL SECURITY` sigue en cero sentencias, y la matriz explica por
// qué: sin `FORCE` las políticas no rigen para el dueño de la tabla, el dueño es
// `flash_app` —el rol migrador, que corre backfills sobre filas de todos los
// usuarios—, y aplicarlo rompería ese trabajo. La decisión es no aplicarlo.
//
// Pero esa decisión descansa en una frase: *«`flash_runtime` no es dueño y es
// `NOBYPASSRLS`, así que las políticas se le aplican enteras»*. Eso estaba
// **afirmado y no probado**. `test:rls` se conecta como el rol auditor y como el
// migrador; ninguna puerta miraba la forma del rol que atiende cada petición de
// producción.
//
// Una decisión de no hacer algo se sostiene sobre las propiedades que la
// justifican. Si nadie las verifica, la decisión envejece hasta volverse una
// suposición — que es el hallazgo H-10 aplicado a una decisión de seguridad.
//
// **Las dos mitades.** No alcanza con leer los atributos del rol en el catálogo:
// también se intenta el movimiento que rompería todo —`SET ROLE flash_app`— y se
// exige que la base lo rechace. Un atributo puede leerse bien y la vía seguir
// abierta por otro lado.
import pg from "pg";

const RUNTIME = "flash_runtime";
const DUENIO = "flash_app";

const runtime = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

let fallos = 0;
const ok = (etiqueta) => console.log(`ok - ${etiqueta}`);
const comprobar = (condicion, etiqueta, detalle) => {
  if (condicion) return ok(etiqueta);
  fallos++;
  console.error(`FALLA - ${etiqueta}`);
  if (detalle) console.error(`        ${detalle}`);
  return undefined;
};

try {
  const quien = (await runtime.query("SELECT current_user")).rows[0].current_user;
  comprobar(
    quien === RUNTIME,
    `la conexión de runtime es ${RUNTIME}`,
    `conectó como ${quien}: el resto de esta puerta no significaría nada`,
  );

  // 1. Atributos del rol. `rolbypassrls` es el que importa: con él, ninguna
  //    política se evalúa y toda la matriz RLS es decorativa.
  const rol = (
    await runtime.query(
      `SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
       FROM pg_roles WHERE rolname = $1`,
      [RUNTIME],
    )
  ).rows[0];
  for (const [atributo, etiqueta] of [
    ["rolsuper", "no es superusuario"],
    ["rolbypassrls", "no puede saltear RLS"],
    ["rolcreaterole", "no puede crear roles"],
    ["rolcreatedb", "no puede crear bases"],
    ["rolreplication", "no puede replicar"],
  ]) {
    comprobar(
      rol?.[atributo] === false,
      `${RUNTIME} ${etiqueta}`,
      `${atributo} = ${rol?.[atributo]}`,
    );
  }

  // 2. No es dueño de ninguna tabla. Sin `FORCE`, el dueño de una tabla queda
  //    fuera de sus propias políticas. Que el runtime no sea dueño de nada es
  //    justamente lo que hace que esa excepción no lo alcance.
  const propias = await runtime.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = $1 ORDER BY 1`,
    [RUNTIME],
  );
  comprobar(
    propias.rowCount === 0,
    `${RUNTIME} no es dueño de ninguna tabla`,
    propias.rows
      .slice(0, 10)
      .map((f) => f.tablename)
      .join(", "),
  );

  // 3. No puede volverse el dueño. Ésta es la que un chequeo de atributos no
  //    cubre: si el runtime fuera miembro del rol migrador, un `SET ROLE` le
  //    daría la excepción de dueño sin necesitar `rolbypassrls`.
  const membresia = (
    await runtime.query("SELECT pg_has_role($1, $2, 'USAGE') tiene", [RUNTIME, DUENIO])
  ).rows[0];
  comprobar(
    membresia.tiene === false,
    `${RUNTIME} no es miembro de ${DUENIO}`,
    "con la membresía, un SET ROLE alcanzaría para quedar fuera de las políticas",
  );

  // La mitad empírica: se intenta de verdad.
  const cliente = await runtime.connect();
  let rechazado = null;
  try {
    await cliente.query(`SET ROLE ${DUENIO}`);
  } catch (error) {
    rechazado = error;
  } finally {
    await cliente.query("RESET ROLE").catch(() => {});
    cliente.release();
  }
  comprobar(
    Boolean(rechazado),
    `la base rechaza SET ROLE ${DUENIO} desde ${RUNTIME}`,
    "el intento fue aceptado: el rol de runtime puede convertirse en el dueño",
  );

  // 4. Y la contraparte, para que la puerta no pase por el motivo equivocado: el
  //    runtime **sí** tiene que poder leer. Un rol sin permisos aprobaría todo lo
  //    anterior y rompería el producto entero.
  const lectura = await runtime.query("SELECT count(*)::int n FROM users");
  comprobar(
    typeof lectura.rows[0].n === "number",
    `${RUNTIME} conserva la lectura que el producto necesita`,
  );
} finally {
  await runtime.end();
}

if (fallos) {
  console.error(`\n${fallos} propiedad(es) del rol de runtime no se cumplen`);
  console.error("La decisión de no aplicar FORCE ROW LEVEL SECURITY descansa en éstas.");
  process.exit(1);
}
console.log(`\nok - ${RUNTIME} está acotado, no es dueño y no puede volverse el dueño`);
