// Los tres lotes operativos como trabajo programable (ticket OPS-001).
//
// `processPostgresDispatchBatch`, `processPostgresNotificationBatch` y
// `processSupportQueue` sólo se disparaban desde `POST /api/admin/*/process`,
// es decir cuando alguien se acordaba de apretar el botón. Los tres estaban
// además **importados en `server/index.js` y no llamados desde ahí**, y un
// comentario del router decía que corrían solos: no corrían.
//
// Lo que eso significa sin planificador, en orden de gravedad:
//
// | Lote | Qué pasa si nadie lo empuja |
// | --- | --- |
// | despacho | un pedido pagado no recibe ninguna oferta de conductor |
// | notificaciones | nada de lo que la cola encoló se entrega |
// | SLA de soporte | ningún ticket escala al vencer su plazo |
//
// El primero es el que rompe el producto: el pedido se cobra y se queda quieto.
//
// **No trae su propio planificador, igual que la conciliación de pagos.** Un
// `setInterval` dentro del servidor corre una vez por réplica —con dos réplicas
// se despacha dos veces— y no sobrevive a un reinicio en el momento equivocado.
// El planificador es del entorno que despliega: `cron`, un `CronJob` de
// Kubernetes, lo que haya.
//
// **Los tres van en un archivo y no en tres.** Se programan con la misma
// frecuencia, comparten la conexión, y separarlos multiplicaría por tres las
// entradas de cron que alguien tiene que acordarse de configurar — que es
// exactamente el modo de falla que este trabajo viene a cerrar. `--only` deja
// correr uno solo cuando hace falta.
//
// **Sale con cero aunque un lote no encuentre nada que hacer.** Una cola vacía
// es el estado sano. Lo que sale distinto de cero es que un lote no haya podido
// correr, y ahí sí conviene despertar a alguien.
import { processPostgresDispatchBatch } from "../server/dispatch-repository.js";
import { processPostgresNotificationBatch } from "../server/notification-repository.js";
import { processSupportQueue, recordSystemAudit } from "../server/operations-repository.js";
import { postgresPool, usesPostgresCommerce } from "../server/postgres.js";

const ORIGEN = "scheduled-operational-queues";

// El orden importa: despachar primero encola notificaciones para las ofertas
// recién creadas, y procesarlas después las entrega en la misma corrida en vez
// de esperar al tick siguiente.
const LOTES = [
  {
    clave: "dispatch",
    etiqueta: "despacho",
    accion: "dispatch.batch_processed",
    ejecutar: () => processPostgresDispatchBatch({ limit: 50 }),
    // Cada lote resume distinto, así que cada uno dice cómo. Un resumen genérico
    // obligaría a leer el código para saber si «12» son ofertas o pedidos.
    resumir: (resultado) =>
      `${resultado?.offered ?? 0} oferta(s) sobre ${resultado?.claimed ?? 0} trabajo(s), ` +
      `${resultado?.expired ?? 0} vencida(s), ${resultado?.exhausted ?? 0} sin candidatos`,
  },
  {
    clave: "notifications",
    etiqueta: "notificaciones",
    accion: "notification.batch_processed",
    ejecutar: () => processPostgresNotificationBatch({ limit: 100 }),
    resumir: (resultado) => {
      const salidas = resultado?.outcomes ?? [];
      const muertas = salidas.filter((salida) => salida.status === "dead_lettered").length;
      return `${resultado?.claimed ?? 0} tomada(s), ${salidas.length - muertas} entregada(s), ${muertas} a descarte`;
    },
  },
  {
    clave: "support-sla",
    etiqueta: "SLA de soporte",
    accion: "support.sla_processed",
    ejecutar: () => processSupportQueue({ limit: 50 }),
    resumir: (resultado) =>
      `${resultado?.escalated?.length ?? 0} escalado(s) por vencimiento, ` +
      `${resultado?.assigned?.length ?? 0} asignado(s)`,
  },
];

const soloPedido = process.argv.find((argumento) => argumento.startsWith("--only="))?.slice(7);
const seleccionados = soloPedido ? LOTES.filter((lote) => lote.clave === soloPedido) : LOTES;

if (soloPedido && seleccionados.length === 0) {
  console.error(`Lote desconocido: ${soloPedido}`);
  console.error(`Disponibles: ${LOTES.map((lote) => lote.clave).join(", ")}`);
  process.exit(1);
}

if (!usesPostgresCommerce()) {
  console.error("Las colas operativas requieren PostgreSQL. Nada que hacer.");
  process.exit(1);
}

let fallaron = 0;
for (const lote of seleccionados) {
  try {
    const resultado = await lote.ejecutar();
    // El rastro queda en `audit_events` con su origen. Sin esto, un lote que
    // corrió y otro que nunca se programó se ven idénticos desde afuera: los dos
    // no dejan nada.
    await recordSystemAudit({
      action: lote.accion,
      entityType: "operational_queue",
      entityId: lote.clave,
      origin: ORIGEN,
      afterData: { summary: lote.resumir(resultado) },
    });
    console.log(`ok - ${lote.etiqueta}: ${lote.resumir(resultado)}`);
  } catch (error) {
    // Un lote que falla no cancela los otros dos. Que el despacho se caiga no es
    // motivo para dejar de escalar tickets vencidos.
    fallaron += 1;
    console.error(`FALLA - ${lote.etiqueta} no pudo ejecutarse: ${error.message}`);
  }
}

await postgresPool.end().catch(() => {});
if (fallaron > 0) {
  console.error(`\n${fallaron} de ${seleccionados.length} lote(s) no pudieron ejecutarse.`);
  process.exitCode = 1;
}
