// Una auditoría que no se escribe tiene que hacer ruido (ticket PAY-001).
//
// `recordPostgresAudit` inserta con `INSERT ... SELECT ... FROM users WHERE
// public_id = $1`. Si el actor no existe, eso inserta **cero filas y no falla**:
// la acción privilegiada ocurre y su rastro desaparece sin que nadie se entere.
//
// Hoy no es alcanzable desde una ruta —`requireAuth` verifica que el usuario
// exista antes de dejar pasar la petición—, así que esto no es un agujero
// abierto sino una trampa puesta para el próximo que llame desde fuera de una
// sesión. Apareció al escribir la conciliación programada, que no tiene persona
// detrás.
//
// El contrato fija las tres formas, que son distintas y conviene no mezclar:
//
// | Actor | Qué pasa |
// | --- | --- |
// | existe | evento normal, con su `actor_id` |
// | no se pasa ninguno | evento anónimo, `actor_id` nulo — «alguien hizo esto» |
// | se pasa y no existe | **error**, porque eso es un defecto de quien llama |
//
// La tercera es la que importa. Las otras dos están para que la puerta no pase
// por el motivo equivocado: una implementación que lance siempre aprobaría la
// comprobación del error y rompería las ochenta y siete llamadas que hoy andan.
//
// Los eventos que esta prueba escribe **no se borran**. `audit_events` es
// append-only por diseño, con su trigger y su cadena de hashes, y abrir el
// portillo de mantenimiento para limpiar una prueba sería usar la llave
// equivocada por comodidad. En CI la base es descartable.
import crypto from "node:crypto";
import pg from "pg";
import { recordPostgresAudit, recordSystemAudit } from "../server/operations-repository.js";

const pool = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  ssl: false,
});

const marca = crypto.randomBytes(5).toString("hex");
const accion = `contract.audit_actor_${marca}`;

let fallos = 0;
const ok = (etiqueta) => console.log(`ok - ${etiqueta}`);
const fallo = (etiqueta, detalle) => {
  fallos++;
  console.error(`FALLA - ${etiqueta}`);
  if (detalle) console.error(`        ${detalle}`);
};

const eventos = async (entityId) =>
  (
    await pool.query(
      "SELECT actor_id, after_data FROM audit_events WHERE action = $1 AND entity_id = $2",
      [accion, entityId],
    )
  ).rows;

try {
  const usuario = (await pool.query("SELECT public_id FROM users LIMIT 1")).rows[0];
  if (!usuario) throw new Error("No hay usuarios para usar de actor");

  // 1. Actor que existe: evento normal.
  await recordPostgresAudit({
    actorPublicId: usuario.public_id,
    roles: [],
    action: accion,
    entityType: "contract",
    entityId: "actor-real",
    afterData: { marca },
  });
  const conActor = await eventos("actor-real");
  if (conActor.length === 1 && conActor[0].actor_id) {
    ok("un actor que existe deja su evento con atribucion");
  } else {
    fallo(
      "un actor que existe no dejo un evento atribuido",
      `${conActor.length} evento(s), actor_id ${conActor[0]?.actor_id ?? "nulo"}`,
    );
  }

  // 2. Sin actor: evento anónimo, no error.
  await recordPostgresAudit({
    action: accion,
    entityType: "contract",
    entityId: "sin-actor",
    afterData: { marca },
  });
  const anonimo = await eventos("sin-actor");
  if (anonimo.length === 1 && anonimo[0].actor_id === null) {
    ok("sin actor identificado el evento se anota igual, anonimo");
  } else {
    fallo(
      "una accion sin actor identificado no dejo evento anonimo",
      `${anonimo.length} evento(s), actor_id ${anonimo[0]?.actor_id ?? "nulo"}`,
    );
  }

  // 3. Actor que no existe: error, no silencio. Ésta es la que importa.
  let rechazo = null;
  await recordPostgresAudit({
    actorPublicId: `USR-NO-EXISTE-${marca}`,
    action: accion,
    entityType: "contract",
    entityId: "actor-fantasma",
    afterData: { marca },
  }).catch((error) => (rechazo = error));
  const fantasma = await eventos("actor-fantasma");
  if (!rechazo) {
    fallo(
      "un actor inexistente no produjo error",
      "la accion ocurre y su rastro desaparece en silencio, que es el defecto que esto vigila",
    );
  } else if (fantasma.length) {
    fallo("un actor inexistente produjo error pero dejo evento igual");
  } else {
    ok("un actor que no existe hace fallar la auditoria en vez de perderla");
  }

  // 4. Evento de sistema: sin persona, pero con origen declarado.
  await recordSystemAudit({
    action: accion,
    entityType: "contract",
    entityId: "sistema",
    origin: "contract-de-prueba",
    afterData: { marca },
  });
  const sistema = await eventos("sistema");
  if (sistema.length === 1 && sistema[0].actor_id === null) {
    if (sistema[0].after_data?.origin === "contract-de-prueba") {
      ok("un evento de sistema declara su origen y no finge una persona");
    } else {
      fallo("el evento de sistema no dejo su origen en after_data");
    }
  } else {
    fallo("recordSystemAudit no dejo un evento sin actor", `${sistema.length} evento(s)`);
  }

  // 5. Un evento de sistema sin origen no se acepta: `actor_id` nulo por sí solo
  //    no distingue «lo hizo el sistema» de «no sabemos quién fue».
  let sinOrigen = null;
  await recordSystemAudit({
    action: accion,
    entityType: "contract",
    entityId: "sistema-sin-origen",
  }).catch((error) => (sinOrigen = error));
  if (sinOrigen) {
    ok("un evento de sistema sin origen declarado se rechaza");
  } else {
    fallo("un evento de sistema sin origen se acepto", "queda indistinguible de uno anonimo");
  }
} finally {
  await pool.end();
}

if (fallos) {
  console.error(`\n${fallos} comprobacion(es) de atribucion de auditoria fallaron`);
  process.exit(1);
}
console.log("\nok - una auditoria que no se escribe hace ruido");
