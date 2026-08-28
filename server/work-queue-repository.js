// Profundidad y antigüedad de cada cola de trabajo (ticket OPS-001).
//
// El backoffice ya tenía un panel por dominio: pagos, propinas, siniestros,
// devoluciones, documentos, soporte. Lo que no había era **una sola respuesta a
// «qué se está acumulando y hace cuánto»**, y para saberlo había que entrar a
// ocho secciones y contar a ojo.
//
// **La antigüedad del más viejo es el número que importa, no la cantidad.** Una
// cola con trescientos elementos de este minuto está sana; una con tres de hace
// cuatro días no. Y es la forma de la métrica que revela lo que ninguna cantidad
// revela: que nadie está procesando.
//
// Eso no es hipotético. Hasta el 28 de agosto el despacho, las notificaciones y
// el SLA de soporte **no tenían planificador**: sus lotes existían y nada los
// invocaba, así que un pedido pagado se quedaba sin ninguna oferta de conductor.
// Un tablero que muestre «despacho: 12 pendientes, el más viejo hace 9 horas»
// hace visible en un vistazo lo que costó leer el arranque del servidor línea
// por línea.
import { postgresPool } from "./postgres.js";

/**
 * Las colas, con el predicado exacto que las define.
 *
 * **El de despacho es una copia del que usa el lote**, y eso es deliberado: un
 * tablero que midiera «trabajos sin conductor» a secas contaría también los
 * programados para mañana y los que ya tienen oferta viva, y habría mostrado una
 * cola sana mientras el lote no corría. La cola es lo que el lote tomaría ahora.
 *
 * `owner` dice quién la vacía. Es la diferencia entre una cola que espera un
 * trabajo programado —si crece, falta cron— y una que espera a una persona —si
 * crece, falta gente o falta prioridad—. Sin esa distinción, las doce se leen
 * igual y ninguna acciona nada.
 */
const COLAS = [
  {
    clave: "dispatch",
    etiqueta: "Despacho sin ofertar",
    owner: "job",
    sql: `SELECT count(*)::int total, min(j.created_at) mas_viejo
          FROM jobs j
          WHERE j.driver_id IS NULL AND j.status NOT IN('completed','cancelled')
            AND (COALESCE(j.metadata->>'subtype','')<>'food_order' OR j.status='ready_for_pickup')
            AND (j.scheduled_for IS NULL OR j.scheduled_for<=now()+interval '15 minutes')
            AND NOT EXISTS(SELECT 1 FROM dispatch_offers o
                           WHERE o.job_id=j.id AND o.status='pending' AND o.expires_at>now())`,
  },
  {
    clave: "notifications",
    etiqueta: "Notificaciones encoladas",
    owner: "job",
    sql: `SELECT count(*)::int total, min(created_at) mas_viejo
          FROM notifications WHERE status='queued'`,
  },
  {
    clave: "support_sla",
    etiqueta: "Tickets de soporte abiertos",
    owner: "job",
    sql: `SELECT count(*)::int total, min(created_at) mas_viejo
          FROM support_tickets WHERE status NOT IN('resolved','closed')`,
  },
  {
    clave: "notification_dead_letters",
    etiqueta: "Notificaciones a descarte",
    owner: "human",
    sql: `SELECT count(*)::int total, min(created_at) mas_viejo
          FROM notification_dead_letters WHERE resolved_at IS NULL`,
  },
  {
    clave: "payment_reconciliation",
    etiqueta: "Diferencias de pago",
    owner: "human",
    sql: `SELECT count(*)::int total, min(first_detected_at) mas_viejo
          FROM payment_reconciliation_cases WHERE status='open'`,
  },
  {
    clave: "payouts",
    etiqueta: "Pagos a comercios por aprobar",
    owner: "human",
    sql: `SELECT count(*)::int total, min(created_at) mas_viejo
          FROM payouts WHERE status='pending'`,
  },
  {
    clave: "tip_adjustments",
    etiqueta: "Ajustes de propina por revisar",
    owner: "human",
    sql: `SELECT count(*)::int total, min(requested_at) mas_viejo
          FROM service_tip_adjustments WHERE status='pending'`,
  },
  {
    clave: "risk_reviews",
    etiqueta: "Operaciones marcadas por riesgo",
    owner: "human",
    sql: `SELECT count(*)::int total, min(created_at) mas_viejo
          FROM transaction_risk_assessments WHERE decision='review' AND review_status IS NULL`,
  },
  {
    clave: "order_issues",
    etiqueta: "Incidencias de pedido",
    owner: "human",
    sql: `SELECT count(*)::int total, min(created_at) mas_viejo
          FROM order_issues WHERE status='open'`,
  },
  {
    clave: "shipment_claims",
    etiqueta: "Siniestros de envío",
    owner: "human",
    sql: `SELECT count(*)::int total, min(created_at) mas_viejo
          FROM shipment_protection_claims WHERE status IN('submitted','under_review')`,
  },
  {
    clave: "shipment_returns",
    etiqueta: "Devoluciones de envío",
    owner: "human",
    sql: `SELECT count(*)::int total, min(created_at) mas_viejo
          FROM shipment_return_requests WHERE status IN('requested','approved','in_transit')`,
  },
  {
    clave: "driver_documents",
    etiqueta: "Documentos de conductor",
    owner: "human",
    sql: `SELECT count(*)::int total, min(created_at) mas_viejo
          FROM driver_documents WHERE status='pending'`,
  },
];

/**
 * Umbrales de antigüedad, en minutos.
 *
 * Las colas de trabajo programado se miden en minutos porque las vacía una
 * máquina: si algo lleva media hora esperando, el cron no está corriendo. Las de
 * persona se miden en horas, porque a las tres de la mañana no hay nadie y eso
 * no es una falla.
 */
const UMBRALES = {
  job: { atencion: 15, alarma: 60 },
  human: { atencion: 4 * 60, alarma: 24 * 60 },
};

const severidad = (owner, minutos, total) => {
  // Una cola vacía nunca está en alarma por más viejo que sea su último
  // elemento: `min()` sobre cero filas es nulo, y tratarlo como cero minutos
  // habría pintado de verde exactamente lo mismo que tratarlo como infinito.
  if (total === 0) return "ok";
  const umbral = UMBRALES[owner];
  if (minutos >= umbral.alarma) return "alarma";
  if (minutos >= umbral.atencion) return "atencion";
  return "ok";
};

/**
 * Estado de las doce colas, en una sola ida a la base.
 *
 * Se arma un `UNION ALL` en vez de doce consultas: el tablero se refresca solo y
 * doce viajes por refresco, con doce operadores mirando, son ciento cuarenta y
 * cuatro consultas por ciclo para responder algo que cabe en una.
 */
export async function getWorkQueueDepths() {
  const union = COLAS.map(
    (cola) => `SELECT '${cola.clave}' clave, total, mas_viejo FROM (${cola.sql}) ${cola.clave}`,
  ).join(" UNION ALL ");
  const filas = (await postgresPool.query(union)).rows;
  const porClave = new Map(filas.map((fila) => [fila.clave, fila]));

  const queues = COLAS.map((cola) => {
    const fila = porClave.get(cola.clave) || { total: 0, mas_viejo: null };
    const total = Number(fila.total || 0);
    const masViejo = fila.mas_viejo ? new Date(fila.mas_viejo) : null;
    const minutos = masViejo ? Math.floor((Date.now() - masViejo.getTime()) / 60000) : 0;
    return {
      key: cola.clave,
      label: cola.etiqueta,
      owner: cola.owner,
      pending: total,
      oldestMinutes: minutos,
      oldestAt: masViejo ? masViejo.toISOString() : null,
      severity: severidad(cola.owner, minutos, total),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    queues,
    // El resumen va calculado y no lo arma la pantalla: dos clientes que
    // contaran distinto darían dos respuestas a «¿hay algo urgente?».
    alerting: queues.filter((cola) => cola.severity === "alarma").length,
    // Colas de trabajo programado en alarma. Es la señal específica de «el cron
    // no está corriendo», que se lee distinto de «falta gente en soporte».
    stalledJobs: queues.filter((cola) => cola.owner === "job" && cola.severity === "alarma").length,
  };
}
