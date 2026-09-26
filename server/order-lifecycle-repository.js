// Asignación de repartidor y máquina de estados del pedido (ARC-001).
//
// Separado del alta: despacho + liquidación al completar no deben crecer el
// mismo archivo que valida cotización e idempotencia.
import { postgresPool } from "./postgres.js";
import { acceptDispatchOffer, createDispatchOffers } from "./dispatch-repository.js";
import { settleCapturedFoodOrder } from "./merchant-finance-repository.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";
import { getPostgresOrders } from "./order-repository.js";

const databaseStatus = (status) =>
  ({ courier_assigned: "driver_assigned", delivered: "completed" })[status] || status;

export async function assignPostgresOrderDriver(orderPublicId, driverPublicId, actorPublicId) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const actor = await client.query("SELECT id FROM users WHERE public_id = $1", [actorPublicId]);
    const job = await acceptDispatchOffer(client, {
      jobPublicId: orderPublicId,
      driverPublicId,
      actorUserId: actor.rows[0]?.id || null,
    });
    const customer = { customer_id: job.customer_id };
    await enqueueNotificationForInternalUser(client, {
      userId: customer.customer_id,
      template: "order_status",
      payload: { kind: "food_order", jobId: orderPublicId, status: "driver_assigned" },
      deduplicationKey: `food_order:${orderPublicId}:driver_assigned`,
    });
    await client.query("COMMIT");
    return (await getPostgresOrders()).find((order) => order.id === orderPublicId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function setPostgresOrderStatus(orderPublicId, status, actorPublicId) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const actor = await client.query("SELECT id FROM users WHERE public_id = $1", [actorPublicId]);
    const databaseTarget = databaseStatus(status),
      expectedStatus = {
        preparing: "accepted",
        ready_for_pickup: "preparing",
        picked_up: "driver_assigned",
        delivering: "picked_up",
        completed: "delivering",
      }[databaseTarget];
    if (!expectedStatus)
      throw Object.assign(new Error("Transición de pedido no permitida"), { status: 409 });
    const result = await client.query(
      `WITH changed AS (
      UPDATE jobs SET status = $1, version = version + 1, updated_at = now(),
        metadata = CASE WHEN $1::job_status = 'completed' THEN jsonb_set(metadata, '{etaMin}', '0') ELSE metadata END
      WHERE public_id = $2 AND kind = 'delivery' AND status = $4::job_status
        AND NOT (metadata ? 'refundPending')
        AND NOT EXISTS(SELECT 1 FROM order_item_substitutions s WHERE s.job_id=jobs.id AND s.status='pending') RETURNING id,customer_id
    ) INSERT INTO job_events(job_id, actor_id, status) SELECT id, $3, $1 FROM changed RETURNING job_id`,
      [databaseTarget, orderPublicId, actor.rows[0]?.id || null, expectedStatus],
    );
    if (!result.rows[0])
      throw Object.assign(new Error("El pedido no puede cambiar de estado"), { status: 409 });
    const customer = (
      await client.query("SELECT customer_id FROM jobs WHERE public_id=$1", [orderPublicId])
    ).rows[0];
    if (databaseTarget === "ready_for_pickup")
      await createDispatchOffers(client, { jobId: result.rows[0].job_id, mode: "delivery" });
    if (databaseTarget === "completed")
      await settleCapturedFoodOrder(client, {
        jobId: result.rows[0].job_id,
        actorId: actor.rows[0]?.id || null,
      });
    await enqueueNotificationForInternalUser(client, {
      userId: customer.customer_id,
      template: "order_status",
      payload: { kind: "food_order", jobId: orderPublicId, status },
      deduplicationKey: `food_order:${orderPublicId}:${status}`,
    });
    await client.query("COMMIT");
    return (await getPostgresOrders()).find((order) => order.id === orderPublicId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
