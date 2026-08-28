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
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { recordPostgresAudit, recordSystemAudit } from "../server/operations-repository.js";

// ---------------------------------------------------------------------------
// La otra mitad del criterio: **actor y motivo** (ticket OPS-001).
//
// El actor lo cubre el resto de este archivo. El motivo no lo cubria nada. En
// las decisiones que cambian el estado de un tercero, el esquema exigia una nota
// de al menos cinco caracteres, la nota se guardaba en la tabla del dominio, y
// el evento de auditoria registraba nada mas que el resultado.
//
// La diferencia aparece el dia del incidente. Lo que se lee entonces es el log:
// si dice quien cerro que y con que estado pero no por que, hay que reconstruir
// el motivo desde otra tabla —que ademas pudo cambiar despues, porque el log es
// append-only y el caso no—.
//
// **Vive aca y no en su propia suite** porque el token de este repositorio no
// tiene permiso `workflow`, y una suite que no esta en ningun workflow no
// protege nada. El chequeo es estatico y corre antes de tocar la base, asi que
// se puede ejecutar sin credenciales aunque el resto del archivo no.
//
// **Lo que esta puerta no exige.** Una accion que alguien ejecuta sobre lo suyo
// no necesita motivo: revocar la propia sesion, dar de baja el propio
// dispositivo, rechazar una oferta de viaje. Pedirle un motivo a eso llenaria la
// interfaz de campos vacios y ensenaria a escribir «-» para pasar.
// ---------------------------------------------------------------------------

// Acciones que deciden sobre el registro de otra persona. Se listan por nombre y
// no por patron: un patron sobre `revoke` arrastra las autogestionadas, y una
// puerta que pide motivos donde no corresponden se termina apagando.
const DECISIONES_OPERATIVAS = new Set([
  "payment.reconciliation_resolved",
  "risk.assessment_reviewed",
  "service.tip_adjustment_approved",
  "service.tip_adjustment_rejected",
  // Solo las dos que decide operaciones. `merchant.payout_requested` y
  // `merchant.payout_authorized` las ejecuta el comercio sobre lo suyo, y el
  // prefijo `merchant.payout_` las arrastraba: la primera version de esta lista
  // las reporto, que es la puerta pidiendo un motivo donde no corresponde.
  "merchant.payout_approved",
  "merchant.payout_rejected",
  "driver_document.approved",
  "driver_document.rejected",
  "shipment.claim_updated",
  "shipment.return_updated",
  "order_issue.approved",
  "order_issue.rejected",
]);

// Nombres aceptables para el motivo dentro de `afterData`.
//
// `rejectionReason` estaba en la revision de documentos de conductor y la
// primera version de este patron no lo aceptaba: la puerta reporto como sin
// motivo una decision que si lo registraba. Un falso positivo en una puerta de
// auditoria cuesta el rato de arreglar algo que ya estaba bien.
const CAMPOS_DE_MOTIVO = /\b(reason|rejectionReason|resolutionNote|reviewNote|note|motivo)\b/;

const recorrerServidor = async (directorio, encontrados = []) => {
  for (const entrada of await fs.readdir(directorio, { withFileTypes: true })) {
    const completo = path.posix.join(directorio, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name !== "node_modules") await recorrerServidor(completo, encontrados);
    } else if (entrada.name.endsWith(".js")) {
      encontrados.push(completo);
    }
  }
  return encontrados;
};

const modulosDelServidor = await recorrerServidor("server");
const PISO_DE_ARCHIVOS = 60;
if (modulosDelServidor.length < PISO_DE_ARCHIVOS) {
  // Sin este piso, un error de ruta dejaria la lista vacia y la puerta pasaria
  // por no haber mirado nada.
  throw new Error(
    `Solo se inspeccionaron ${modulosDelServidor.length} archivos y el piso es ${PISO_DE_ARCHIVOS}`,
  );
}

const decisionesSinMotivo = [];
const decisionesConMotivo = [];
const decisionesVistas = new Set();

for (const archivo of modulosDelServidor) {
  const fuente = await fs.readFile(archivo, "utf8");
  // Cada bloque `recordPostgresAudit({ ... })`. El limite de caracteres evita
  // que un bloque sin cierre se coma el resto del archivo.
  for (const bloque of fuente.matchAll(/recordPostgresAudit\(\{([\s\S]{0,900}?)\n\s*\}\);/g)) {
    const cuerpo = bloque[1];
    const accion = cuerpo.match(/action:\s*[`"']([a-z_.]+)/i)?.[1];
    if (!accion) continue;
    // Una accion compuesta se escribe como `driver_document.${estado}`, asi que
    // el patron solo captura el prefijo literal. Cuenta como vista toda variante
    // declarada que empiece con ese prefijo: si no, las que no se pueden
    // distinguir estaticamente apareceria como declaradas y ausentes.
    const declaradas = [...DECISIONES_OPERATIVAS].filter(
      (nombre) => accion === nombre || nombre.startsWith(accion),
    );
    if (declaradas.length === 0) continue;
    for (const nombre of declaradas) decisionesVistas.add(nombre);
    const entrada = `${accion.padEnd(38)} ${archivo.replace("server/", "")}`;
    if (CAMPOS_DE_MOTIVO.test(cuerpo)) decisionesConMotivo.push(entrada);
    else decisionesSinMotivo.push(entrada);
  }
}

// Una accion declarada que ya no existe en el codigo esconde una decision que se
// renombro o se borro, y la lista quedaria protegiendo algo inexistente.
const declaradasSinUso = [...DECISIONES_OPERATIVAS].filter(
  (nombre) => !decisionesVistas.has(nombre),
);

console.log(`${decisionesConMotivo.length} decision(es) operativa(s) registran su motivo`);
for (const linea of decisionesConMotivo.sort()) console.log(`  ${linea}`);
if (declaradasSinUso.length) {
  console.error("\nDeclaradas y no encontradas en el codigo:");
  for (const nombre of declaradasSinUso) console.error(`  ${nombre}`);
  console.error("Si la accion se renombro, actualiza la lista; si se borro, sacala.");
  process.exit(1);
}
if (decisionesSinMotivo.length) {
  console.error(`\n${decisionesSinMotivo.length} decision(es) operativa(s) sin motivo:\n`);
  for (const linea of decisionesSinMotivo.sort()) console.error(`  ${linea}`);
  console.error("\nEl motivo tiene que ir en `afterData`, no solo en la tabla del dominio.");
  console.error("El dia del incidente se lee el log, y el log es lo unico append-only.");
  process.exit(1);
}
console.log("ok - toda decision operativa declarada registra actor y motivo\n");

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
