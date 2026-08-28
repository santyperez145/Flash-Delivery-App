// Las dos intervenciones que exigían entrar a la base (ticket OPS-001).
//
// El criterio dice «ningún incidente requiere ejecutar SQL manual». Al
// inventariar qué puede hacer un operador quedaron dos huecos, y los dos son la
// llamada de las dos de la mañana:
//
// - **Suspender un comercio.** `merchants.status` existía, cuarenta y un
//   consultas lo respetaban, y ninguna ruta lo escribía.
// - **Soltar un pedido de un conductor.** Un teléfono que se apaga, una moto que
//   se rompe, alguien que aceptó y desapareció. El trabajo quedaba con
//   `driver_id` puesto y sin forma de devolverlo al despacho.
//
// Los dos se resolvían con un UPDATE a mano, sin actor, sin motivo y sin rastro.
import { postgresPool } from "./postgres.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";

/**
 * Suspende o reactiva un comercio.
 *
 * **Suspender frena lo nuevo y no toca lo que ya está en curso.** Un pedido que
 * se está cocinando se termina de cocinar: cancelarlos en masa castiga a
 * clientes que no hicieron nada y deja comida hecha sin destino. Lo que la
 * suspensión corta es que entre uno más, y eso ya lo hacen las consultas que
 * filtran por `status='active'`.
 *
 * Devuelve cuántos pedidos quedaron en curso, porque es el dato que decide qué
 * hace el operador después: suspender un comercio con doce pedidos abiertos
 * necesita un aviso a soporte; con cero, no necesita nada.
 */
export async function setMerchantStatus({ merchantPublicId, status, reason }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const comercio = (
      await client.query(
        "SELECT id, public_id, name, status, owner_id FROM merchants WHERE public_id=$1 FOR UPDATE",
        [merchantPublicId],
      )
    ).rows[0];
    if (!comercio) throw Object.assign(new Error("Comercio no encontrado"), { status: 404 });
    if (comercio.status === status)
      throw Object.assign(new Error(`El comercio ya está ${status}`), { status: 409 });

    // Sin `updated_at`: **la tabla `merchants` no la tiene.** Lo descubrio CI con
    // un 500, y no lo atrapa `test:module-references`, que verifica que las
    // tablas existan y no que las columnas existan. Cuando cambio el estado
    // queda en el evento de auditoria, que es donde se lo busca.
    await client.query("UPDATE merchants SET status=$2 WHERE id=$1", [comercio.id, status]);
    const enCurso = Number(
      (
        await client.query(
          `SELECT count(*)::int total FROM jobs
           WHERE merchant_id=$1 AND status NOT IN('completed','cancelled')`,
          [comercio.id],
        )
      ).rows[0].total,
    );
    // El comercio se entera por la app, no por descubrir que dejaron de entrar
    // pedidos. La notificación lleva el motivo: una suspensión sin explicación
    // se convierte en un llamado a soporte de todos modos.
    await enqueueNotificationForInternalUser(client, {
      userId: comercio.owner_id,
      template: "merchant_status",
      payload: { kind: "merchant", merchantId: comercio.public_id, status, reason },
      deduplicationKey: `merchant_status:${comercio.public_id}:${status}:${Date.now()}`,
    });
    await client.query("COMMIT");
    return {
      id: comercio.public_id,
      name: comercio.name,
      previousStatus: comercio.status,
      status,
      openJobs: enCurso,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Devuelve un trabajo asignado al despacho.
 *
 * **Sólo antes de retirar.** Después de `picked_up` el conductor tiene la comida
 * encima o el pasajero adentro, y «soltar» ahí no significa reasignar: significa
 * que algo salió mal y hay que cancelar con su política, o abrir una incidencia.
 * Aceptar la operación en ese estado dejaría un pedido en la calle sin dueño.
 *
 * El estado al que vuelve no es fijo. Un pedido de comida se asigna sólo desde
 * `ready_for_pickup` —el despacho lo exige— así que ahí vuelve; un viaje o un
 * envío vuelven a `requested`. Devolverlos todos al mismo estado dejaría al
 * pedido fuera del alcance del despacho, que es justo lo contrario de lo que
 * esta operación busca.
 */
export async function releaseJobFromDriver({ jobPublicId, reason }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const trabajo = (
      await client.query(
        `SELECT j.id, j.public_id, j.kind, j.status, j.customer_id, j.metadata,
                d.public_id driver_public_id, d.user_id driver_user_id
         FROM jobs j JOIN drivers d ON d.id=j.driver_id
         WHERE j.public_id=$1 FOR UPDATE OF j`,
        [jobPublicId],
      )
    ).rows[0];
    if (!trabajo)
      throw Object.assign(new Error("El servicio no tiene conductor asignado"), { status: 409 });
    if (!["driver_assigned", "arriving"].includes(trabajo.status))
      throw Object.assign(
        new Error("Sólo se puede soltar un servicio que el conductor todavía no retiró"),
        { status: 409 },
      );

    const esComida = trabajo.metadata?.subtype === "food_order";
    const estadoDeVuelta = esComida ? "ready_for_pickup" : "requested";
    await client.query(
      // `dispatchNextAttemptAt` se saca del metadata: es el freno que el despacho
      // se pone a sí mismo entre rondas. Dejarlo puesto haría que el trabajo
      // liberado esperara a que venciera, que es lo contrario de lo que un
      // operador quiere cuando suelta un pedido a mano.
      `UPDATE jobs SET driver_id=NULL, status=$2::job_status,
         metadata=(metadata - 'dispatchNextAttemptAt' - 'dispatchRound'),
         version=version+1, updated_at=now()
       WHERE id=$1`,
      [trabajo.id, estadoDeVuelta],
    );
    await client.query(
      "UPDATE dispatch_offers SET status='withdrawn',responded_at=now() WHERE job_id=$1 AND status='pending'",
      [trabajo.id],
    );
    await client.query(
      "INSERT INTO job_events(job_id, actor_id, status, payload) VALUES($1,NULL,$2::job_status,$3)",
      [trabajo.id, estadoDeVuelta, { releasedFrom: trabajo.driver_public_id, reason }],
    );
    // Los dos lados se enteran. El conductor porque perdió un trabajo que tenía
    // aceptado —descubrirlo al llegar al local es peor—, y el cliente porque su
    // pedido vuelve a buscar repartidor y el tiempo estimado deja de valer.
    await enqueueNotificationForInternalUser(client, {
      userId: trabajo.driver_user_id,
      template: "job_released",
      payload: { kind: trabajo.kind, jobId: trabajo.public_id, reason },
      deduplicationKey: `job_released:${trabajo.public_id}:${trabajo.driver_public_id}`,
    });
    await enqueueNotificationForInternalUser(client, {
      userId: trabajo.customer_id,
      template: "order_status",
      payload: { kind: trabajo.kind, jobId: trabajo.public_id, status: "searching_driver" },
      deduplicationKey: `job_released_customer:${trabajo.public_id}:${trabajo.driver_public_id}`,
    });
    await client.query("COMMIT");
    return {
      id: trabajo.public_id,
      kind: trabajo.kind,
      releasedFrom: trabajo.driver_public_id,
      status: estadoDeVuelta,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
