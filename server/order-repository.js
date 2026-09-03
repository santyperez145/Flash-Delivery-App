// Lectura de pedidos de comida (ARC-001).
//
// Cotización → `order-quote-repository.js`. Alta → `order-create-repository.js`.
// Cobro MP → `order-marketplace-payment-repository.js`. Avance →
// `order-lifecycle-repository.js`. Carrito → `cart-repository.js`.
//
// `apiStatus` traduce estados de base (`driver_assigned`, `completed`) a API
// (`courier_assigned`, `delivered`).
import { postgresPool } from "./postgres.js";
import { pesos } from "./money.js";

const apiStatus = (status) =>
  ({ driver_assigned: "courier_assigned", completed: "delivered" })[status] || status;

function rowsToOrders(rows) {
  const orders = new Map();
  for (const row of rows) {
    if (!orders.has(row.public_id)) {
      const metadata = row.job_metadata || {};
      orders.set(row.public_id, {
        id: row.public_id,
        customerId: row.customer_public_id,
        restaurantId: row.merchant_public_id,
        branchId: row.branch_public_id || null,
        courierId: row.driver_public_id || null,
        status: apiStatus(row.status),
        deliveryAddress: row.dropoff_address,
        pickupLocation: { lat: Number(row.pickup_lat), lng: Number(row.pickup_lng) },
        deliveryLocation: { lat: Number(row.dropoff_lat), lng: Number(row.dropoff_lng) },
        paymentMethod: row.payment_method_label || "",
        items: [],
        subtotal: Number(metadata.subtotal || 0),
        deliveryFee: Number(metadata.deliveryFee || 0),
        serviceFee: Number(metadata.serviceFee || 0),
        discount: Number(metadata.discount || 0),
        subscriptionDiscount: Number(metadata.subscriptionDiscount || 0),
        tip: Number(metadata.tip || 0),
        promotionCode: metadata.promotionCode || null,
        // Se lee de la columna y no del metadata: reprogramar actualiza las dos,
        // pero la columna es la que manda para el despacho, y una pantalla que
        // mostrara el metadata podria prometer un horario que el despacho ignora.
        scheduledFor: row.scheduled_for ? new Date(row.scheduled_for).toISOString() : null,
        total: pesos(row.final_amount_cents ?? row.quoted_amount_cents),
        etaMin: Number(metadata.etaMin ?? Math.round(row.estimated_duration_s / 60)),
        createdAt: new Date(row.created_at).toISOString(),
        version: row.version,
        timeline: row.timeline || [],
        cancellation: row.cancellation || null,
      });
    }
    if (row.item_id) {
      const metadata = row.item_metadata || {};
      orders.get(row.public_id).items.push({
        menuItemId: metadata.publicId || row.catalog_public_id || row.item_id,
        name: row.item_name,
        quantity: row.quantity,
        unitPrice: pesos(row.unit_price_cents),
        extras: metadata.extras || [],
        note: row.customer_note || "",
      });
    }
  }
  return [...orders.values()];
}

export async function getPostgresOrders({ publicIds = null } = {}) {
  const result = await postgresPool.query(
    `
    SELECT j.*, j.metadata AS job_metadata, customer.public_id AS customer_public_id,
      ST_Y(j.pickup_location::geometry) pickup_lat,ST_X(j.pickup_location::geometry) pickup_lng,
      ST_Y(j.dropoff_location::geometry) dropoff_lat,ST_X(j.dropoff_location::geometry) dropoff_lng,
      merchant.public_id AS merchant_public_id, branch.public_id AS branch_public_id,
      driver.public_id AS driver_public_id,
      ji.id AS item_id, ji.name AS item_name, ji.quantity, ji.unit_price_cents,
      ji.customer_note, ji.metadata AS item_metadata, catalog.public_id AS catalog_public_id,
      (SELECT jsonb_build_object(
        'id', c.public_id, 'reason', c.reason_code,
        'refundAmount', c.refund_amount_cents / 100.0, 'fee', c.cancellation_fee_cents / 100.0,
        'createdAt', c.created_at
      ) FROM job_cancellations c WHERE c.job_id = j.id) cancellation,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('status',
        CASE WHEN je.status = 'driver_assigned' THEN 'courier_assigned'
             WHEN je.status = 'completed' THEN 'delivered' ELSE je.status::text END,
        'at', je.occurred_at) ORDER BY je.occurred_at) FROM job_events je WHERE je.job_id = j.id), '[]') AS timeline
    FROM jobs j
    JOIN users customer ON customer.id = j.customer_id
    JOIN merchants merchant ON merchant.id = j.merchant_id
    LEFT JOIN merchant_branches branch ON branch.id = j.branch_id
    LEFT JOIN drivers driver ON driver.id = j.driver_id
    LEFT JOIN job_items ji ON ji.job_id = j.id
    LEFT JOIN catalog_items catalog ON catalog.id = ji.catalog_item_id
    WHERE j.kind = 'delivery' AND j.metadata->>'subtype' = 'food_order'
      AND ($1::text[] IS NULL OR j.public_id=ANY($1::text[]))
    ORDER BY j.created_at DESC, ji.id
  `,
    [publicIds],
  );
  return rowsToOrders(result.rows);
}

export async function getPostgresMerchantActiveOrderPage({
  actorPublicId,
  merchantPublicId,
  admin = false,
  limit = 100,
}) {
  const selected = (
    await postgresPool.query(
      `SELECT m.id FROM merchants m JOIN users owner ON owner.id=m.owner_id WHERE m.status='active' AND m.public_id=$2 AND ($3::boolean OR owner.public_id=$1)`,
      [actorPublicId, merchantPublicId, admin],
    )
  ).rows[0];
  if (!selected)
    throw Object.assign(new Error("Comercio no encontrado o no autorizado"), { status: 404 });
  const page = await postgresPool.query(
    `SELECT j.public_id
     FROM jobs j
     WHERE j.merchant_id = $1 AND j.kind = 'delivery'
       AND j.metadata->>'subtype' = 'food_order'
       AND j.status = ANY($2::job_status[])
     ORDER BY CASE j.status
       WHEN 'accepted' THEN 0 WHEN 'preparing' THEN 1 WHEN 'ready_for_pickup' THEN 2
       WHEN 'driver_assigned' THEN 3 WHEN 'picked_up' THEN 4 WHEN 'delivering' THEN 5
       ELSE 6 END,
       j.merchant_ready_due_at NULLS LAST, j.created_at
     LIMIT $3`,
    [
      selected.id,
      ["accepted", "preparing", "ready_for_pickup", "driver_assigned", "picked_up", "delivering"],
      limit + 1,
    ],
  );
  const hasMore = page.rows.length > limit,
    publicIds = page.rows.slice(0, limit).map((row) => row.public_id),
    orders = await getPostgresOrders({ publicIds }),
    byId = new Map(orders.map((order) => [order.id, order]));
  return {
    generatedAt: new Date().toISOString(),
    source: "postgres-live-operations",
    orders: publicIds.map((id) => byId.get(id)).filter(Boolean),
    hasMore,
  };
}
