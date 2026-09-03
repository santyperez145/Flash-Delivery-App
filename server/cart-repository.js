// Carrito de comida persistido (ARC-001).
//
// Separado del ciclo create/pay/advance del pedido: el carrito es borrador
// mutable; el pedido es compromiso. Comparten `resolveModifierSelection`.
import { mapCatalogItem } from "./catalog-repository.js";
import { pesos } from "./money.js";
import { resolveModifierSelection } from "./order-selection.js";
import { postgresPool } from "./postgres.js";

export async function getPostgresCart(customerPublicId) {
  const result = await postgresPool.query(
    `
    SELECT merchant.public_id AS restaurant_id, catalog.public_id AS item_public_id,
      catalog.name, catalog.description, catalog.category, catalog.unit_price_cents,
      catalog.available, catalog.metadata, item.quantity,item.unit_price_snapshot_cents selected_unit_price_cents, item.options, item.note
    FROM carts cart
    JOIN users customer ON customer.id = cart.customer_id
    JOIN merchants merchant ON merchant.id = cart.merchant_id
    JOIN cart_items item ON item.cart_id = cart.id
    JOIN catalog_items catalog ON catalog.id = item.catalog_item_id
    WHERE customer.public_id = $1 AND cart.status = 'active' AND cart.expires_at > now()
    ORDER BY item.id`,
    [customerPublicId],
  );
  return result.rows.map((row) => ({
    restaurantId: row.restaurant_id,
    item: { ...mapCatalogItem(row), price: pesos(row.selected_unit_price_cents) },
    quantity: row.quantity,
    extras: Array.isArray(row.options) ? row.options : [],
    note: row.note || "",
  }));
}

export async function replacePostgresCart(customerPublicId, merchantPublicId, lines) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const customer = await client.query("SELECT id FROM users WHERE public_id = $1", [
      customerPublicId,
    ]);
    if (!customer.rows[0]) throw Object.assign(new Error("Cliente no encontrado"), { status: 404 });
    if (!lines.length) {
      await client.query(
        "UPDATE carts SET status = 'abandoned', updated_at = now() WHERE customer_id = $1 AND status = 'active'",
        [customer.rows[0].id],
      );
      await client.query("COMMIT");
      return [];
    }
    const merchant = await client.query(
      "SELECT id FROM merchants WHERE public_id = $1 AND status = 'active'",
      [merchantPublicId],
    );
    if (!merchant.rows[0])
      throw Object.assign(new Error("Comercio no encontrado"), { status: 404 });
    await client.query(
      "UPDATE carts SET status = 'abandoned', updated_at = now() WHERE customer_id = $1 AND status = 'active' AND merchant_id <> $2",
      [customer.rows[0].id, merchant.rows[0].id],
    );
    const cart = await client.query(
      `INSERT INTO carts(customer_id, merchant_id) VALUES ($1, $2)
       ON CONFLICT (customer_id, merchant_id) WHERE status = 'active'
       DO UPDATE SET version = carts.version + 1, expires_at = now() + interval '7 days', updated_at = now()
       RETURNING id`,
      [customer.rows[0].id, merchant.rows[0].id],
    );
    await client.query("DELETE FROM cart_items WHERE cart_id = $1", [cart.rows[0].id]);
    for (const line of lines) {
      const item = await client.query(
        `SELECT c.id, c.unit_price_cents
         FROM catalog_items c
         WHERE c.public_id = $1 AND c.merchant_id = $2 AND c.available
           AND EXISTS (
             SELECT 1 FROM merchant_branches b
             JOIN catalog_branch_inventory i ON i.branch_id = b.id
               AND i.catalog_item_id = c.id
             WHERE b.merchant_id = c.merchant_id AND b.is_primary
               AND b.status = 'active' AND b.open
               AND app.branch_is_scheduled_open(b.id, now())
               AND i.available AND COALESCE(i.stock_quantity, 1) > 0
           )`,
        [line.menuItemId, merchant.rows[0].id],
      );
      if (!item.rows[0])
        throw Object.assign(new Error("Uno de los productos ya no está disponible"), {
          status: 409,
        });
      const selection = await resolveModifierSelection(client, {
        catalogItemId: item.rows[0].id,
        selectedIds: line.extras || [],
      });
      await client.query(
        `INSERT INTO cart_items(cart_id, catalog_item_id, quantity, unit_price_snapshot_cents, options, note)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          cart.rows[0].id,
          item.rows[0].id,
          line.quantity,
          Number(item.rows[0].unit_price_cents) + selection.priceCents,
          JSON.stringify(line.extras || []),
          line.note || null,
        ],
      );
    }
    await client.query("COMMIT");
    return getPostgresCart(customerPublicId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function reorderPostgresOrder({ customerPublicId, orderPublicId }) {
  const result = await postgresPool.query(
    `SELECT m.public_id restaurant_id, ji.quantity, ji.customer_note,
      COALESCE(ji.metadata->>'publicId', c.public_id) menu_item_id,
      COALESCE(ji.metadata->'modifiers', '[]') modifiers
     FROM jobs j
     JOIN users u ON u.id = j.customer_id
     JOIN merchants m ON m.id = j.merchant_id
     JOIN job_items ji ON ji.job_id = j.id
     LEFT JOIN catalog_items c ON c.id = ji.catalog_item_id
     WHERE j.public_id = $1 AND u.public_id = $2
       AND j.kind = 'delivery' AND j.metadata->>'subtype' = 'food_order'
     ORDER BY ji.id`,
    [orderPublicId, customerPublicId],
  );
  if (!result.rowCount) throw Object.assign(new Error("Pedido no encontrado"), { status: 404 });
  const restaurantId = result.rows[0].restaurant_id,
    lines = result.rows.map((row) => ({
      menuItemId: row.menu_item_id,
      quantity: Number(row.quantity),
      extras: (Array.isArray(row.modifiers) ? row.modifiers : [])
        .map((modifier) => modifier.id)
        .filter(Boolean),
      note: row.customer_note || "",
    }));
  const cart = await replacePostgresCart(customerPublicId, restaurantId, lines);
  return { sourceOrderId: orderPublicId, restaurantId, cart };
}
