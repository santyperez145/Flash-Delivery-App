import { postgresPool } from "./postgres.js";

const money = (cents) => Number(cents || 0) / 100;

export async function getPostgresMerchantDashboard({
  actorPublicId,
  merchantPublicId = null,
  admin = false,
}) {
  const result = await postgresPool.query(
    `WITH selected AS (
       SELECT m.id AS merchant_id, m.public_id AS merchant_public_id,
         b.id AS branch_id, b.public_id AS branch_public_id, b.name AS branch_name,
         b.timezone, b.open AS manual_open, b.status AS branch_status, b.eta_min,
         b.open AND b.status='active' AND app.branch_is_scheduled_open(b.id, now()) AS effective_open
       FROM merchants m
       JOIN users owner ON owner.id=m.owner_id
       JOIN LATERAL (
         SELECT branch.* FROM merchant_branches branch
         WHERE branch.merchant_id=m.id AND branch.is_primary
         LIMIT 1
       ) b ON true
       WHERE m.status='active'
         AND (($3::boolean AND m.public_id=$2) OR (NOT $3::boolean AND owner.public_id=$1))
       LIMIT 1
     ), terminal_events AS (
       SELECT DISTINCT ON (events.job_id, events.status)
         events.job_id, events.status, events.occurred_at
       FROM job_events events
       JOIN jobs job ON job.id=events.job_id
       JOIN selected selection ON selection.merchant_id=job.merchant_id
       WHERE events.status IN ('completed','cancelled')
       ORDER BY events.job_id, events.status, events.occurred_at DESC
     ), food_jobs AS (
       SELECT job.*, completed.occurred_at AS completed_at, cancelled.occurred_at AS cancelled_at
       FROM jobs job
       JOIN selected selection ON selection.merchant_id=job.merchant_id
       LEFT JOIN terminal_events completed ON completed.job_id=job.id AND completed.status='completed'
       LEFT JOIN terminal_events cancelled ON cancelled.job_id=job.id AND cancelled.status='cancelled'
       WHERE job.kind='delivery' AND job.metadata->>'subtype'='food_order'
     )
     SELECT selection.*,
       count(food.id) FILTER (WHERE food.status IN ('accepted','preparing','ready_for_pickup','driver_assigned','picked_up','delivering'))::int AS active_orders,
       count(food.id) FILTER (WHERE food.status='accepted')::int AS needs_action,
       count(food.id) FILTER (WHERE food.status='preparing')::int AS preparing,
       count(food.id) FILTER (WHERE food.status='ready_for_pickup')::int AS ready_for_pickup,
       count(food.id) FILTER (WHERE food.status IN ('driver_assigned','picked_up','delivering'))::int AS courier_flow,
       count(food.id) FILTER (WHERE food.status IN ('accepted','preparing') AND food.merchant_ready_due_at < now())::int AS late_orders,
       count(food.id) FILTER (WHERE food.status IN ('accepted','preparing') AND food.merchant_ready_due_at IS NULL)::int AS untracked_prep_orders,
       COALESCE(floor(max(extract(epoch FROM (now()-food.created_at))) FILTER (WHERE food.status IN ('accepted','preparing','ready_for_pickup','driver_assigned','picked_up','delivering')) / 60),0)::int AS oldest_active_minutes,
       count(food.id) FILTER (WHERE food.status='completed' AND food.completed_at >= ((now() AT TIME ZONE selection.timezone)::date AT TIME ZONE selection.timezone))::int AS completed_today,
       count(food.id) FILTER (WHERE food.status='cancelled' AND food.cancelled_at >= ((now() AT TIME ZONE selection.timezone)::date AT TIME ZONE selection.timezone))::int AS cancelled_today,
       COALESCE(sum(COALESCE(food.final_amount_cents,food.quoted_amount_cents)) FILTER (WHERE food.status='completed' AND food.completed_at >= ((now() AT TIME ZONE selection.timezone)::date AT TIME ZONE selection.timezone)),0)::bigint AS gross_sales_today_cents,
       (SELECT count(*)::int
        FROM catalog_items item
        LEFT JOIN catalog_branch_inventory inventory
          ON inventory.catalog_item_id=item.id AND inventory.branch_id=selection.branch_id
        WHERE item.merchant_id=selection.merchant_id
          AND (NOT item.available OR inventory.catalog_item_id IS NULL OR NOT inventory.available OR COALESCE(inventory.stock_quantity,1)=0)
       ) AS unavailable_items
     FROM selected selection
     LEFT JOIN food_jobs food ON true
     GROUP BY selection.merchant_id, selection.merchant_public_id, selection.branch_id,
       selection.branch_public_id, selection.branch_name, selection.timezone,
       selection.manual_open, selection.branch_status, selection.eta_min, selection.effective_open`,
    [actorPublicId, merchantPublicId, admin],
  );
  const row = result.rows[0];
  if (!row) throw Object.assign(new Error("Comercio no encontrado o no autorizado"), { status: 404 });
  const completedToday = Number(row.completed_today);
  const grossSalesToday = money(row.gross_sales_today_cents);
  return {
    generatedAt: new Date().toISOString(),
    source: "postgres-live-operations",
    timezone: row.timezone,
    restaurantId: row.merchant_public_id,
    branch: {
      id: row.branch_public_id,
      name: row.branch_name,
      timezone: row.timezone,
      open: row.effective_open,
      manualOpen: row.manual_open,
      status: row.branch_status,
      etaMin: Number(row.eta_min),
    },
    metrics: {
      activeOrders: Number(row.active_orders),
      needsAction: Number(row.needs_action),
      preparing: Number(row.preparing),
      readyForPickup: Number(row.ready_for_pickup),
      courierFlow: Number(row.courier_flow),
      lateOrders: Number(row.late_orders),
      untrackedPrepOrders: Number(row.untracked_prep_orders),
      oldestActiveMinutes: Number(row.oldest_active_minutes),
      completedToday,
      cancelledToday: Number(row.cancelled_today),
      grossSalesToday,
      averageTicketToday: completedToday ? Math.round(grossSalesToday / completedToday) : 0,
      unavailableItems: Number(row.unavailable_items),
    },
  };
}
