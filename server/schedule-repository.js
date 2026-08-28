// Mover el horario de un servicio reservado (ticket GTM-001, tercer hueco).
//
// `jobs.scheduled_for` existía desde la migración 001 y **nada podía moverlo**.
// La única salida era cancelar y volver a pedir, que le cuenta la cancelación al
// cliente, le suelta el precio cotizado y —si ya había pagado— dispara un
// reintegro para volver a cobrar lo mismo cinco minutos después.
//
// Vale para pedidos y para viajes: los dos son filas de `jobs` con un horario, y
// separarlos en dos implementaciones sería tener dos versiones de la misma
// política de cuándo se puede mover algo.
import { postgresPool } from "./postgres.js";
import { ESTADOS_REPROGRAMABLES } from "./scheduling.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";

/**
 * Reprograma un trabajo reservado.
 *
 * Cuatro condiciones, y ninguna es arbitraria:
 *
 * 1. **Tiene que ser tuyo.** Salvo admin, que reprograma por soporte.
 * 2. **Tiene que estar reservado.** Un trabajo sin horario es «lo antes
 *    posible»; moverlo no significa nada, y aceptar la operación daría la
 *    impresión de que sí.
 * 3. **Todavía nadie empezó.** `requested` o `accepted`. Después el comercio ya
 *    está cocinando o hay un conductor en camino, y mover la hora tira comida o
 *    le hace perder el viaje a alguien que se comprometió.
 * 4. **Sin conductor asignado.** Se comprueba aparte del estado porque son dos
 *    cosas distintas: un trabajo puede tener conductor sin haber cambiado de
 *    estado todavía, y esa carrera es exactamente la que hay que perder del lado
 *    seguro.
 */
export async function reschedulePostgresJob({
  jobPublicId,
  actorPublicId,
  admin = false,
  scheduledFor,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const job = (
      await client.query(
        `SELECT j.id, j.public_id, j.kind, j.status, j.scheduled_for, j.driver_id,
                j.customer_id, j.merchant_prep_minutes, u.public_id customer_public_id
         FROM jobs j JOIN users u ON u.id=j.customer_id
         WHERE j.public_id=$1 AND ($3::boolean OR u.public_id=$2)
         FOR UPDATE OF j`,
        [jobPublicId, actorPublicId, admin],
      )
    ).rows[0];
    if (!job) throw Object.assign(new Error("Servicio no encontrado"), { status: 404 });
    if (!job.scheduled_for)
      throw Object.assign(new Error("Este servicio no está reservado para un horario"), {
        status: 409,
      });
    if (!ESTADOS_REPROGRAMABLES.includes(job.status) || job.driver_id)
      throw Object.assign(
        new Error("El servicio ya está en curso; cancelalo si necesitás otro horario"),
        { status: 409 },
      );

    const anterior = new Date(job.scheduled_for).toISOString();
    const actualizado = (
      await client.query(
        // `merchant_ready_due_at` se recalcula junto con el horario. Sin esto el
        // vencimiento de cocina quedaría apuntando a la hora vieja, y el comercio
        // vería el pedido como atrasado por una reserva que se movió para más
        // tarde.
        `UPDATE jobs SET scheduled_for=$2::timestamptz,
           merchant_ready_due_at=CASE WHEN merchant_prep_minutes IS NULL THEN NULL
             ELSE $2::timestamptz + make_interval(mins=>merchant_prep_minutes::integer) END,
           metadata=jsonb_set(metadata,'{scheduledFor}',to_jsonb($2::text)),
           version=version+1, updated_at=now()
         WHERE id=$1
         RETURNING public_id, scheduled_for, version`,
        [job.id, scheduledFor],
      )
    ).rows[0];

    // Queda en la línea de tiempo del trabajo, no sólo en la auditoría: quien
    // mire el pedido tiene que poder ver que la hora se movió y desde cuándo,
    // sin permiso de auditoría.
    await client.query(
      "INSERT INTO job_events(job_id, actor_id, status, payload) VALUES($1,$2,$3,$4)",
      [
        job.id,
        job.customer_id,
        job.status,
        { rescheduledFrom: anterior, rescheduledTo: scheduledFor },
      ],
    );
    await enqueueNotificationForInternalUser(client, {
      userId: job.customer_id,
      template: "order_status",
      payload: { kind: job.kind, jobId: job.public_id, status: "rescheduled", scheduledFor },
      // La clave incluye el horario nuevo: dos reprogramaciones distintas son
      // dos avisos, y una repetida del mismo cambio es una sola.
      deduplicationKey: `reschedule:${job.public_id}:${scheduledFor}`,
    });
    await client.query("COMMIT");
    return {
      id: actualizado.public_id,
      kind: job.kind,
      status: job.status,
      previousScheduledFor: anterior,
      scheduledFor: new Date(actualizado.scheduled_for).toISOString(),
      version: Number(actualizado.version),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
