// Validación de agregados de catálogo al armar carrito o pedido (ARC-001).
//
// Vive aparte de `order-repository` y `cart-repository` porque las dos mitades
// del ciclo la necesitan y ninguna debe importar a la otra sólo por esto.
import { pesos } from "./money.js";

export async function resolveModifierSelection(client, { catalogItemId, selectedIds = [] }) {
  const unique = [...new Set(selectedIds)];
  if (unique.length !== selectedIds.length)
    throw Object.assign(new Error("No puedes repetir un agregado"), { status: 409 });
  const groups = (
    await client.query(
      `SELECT g.id, g.public_id, g.name, g.minimum_selections, g.maximum_selections,
        COALESCE(jsonb_agg(jsonb_build_object(
          'id', m.public_id, 'name', m.name, 'priceCents', m.price_cents, 'available', m.available
        ) ORDER BY m.sort_order, m.created_at) FILTER (WHERE m.id IS NOT NULL), '[]') modifiers
       FROM catalog_modifier_groups g
       LEFT JOIN catalog_modifiers m ON m.group_id = g.id
       WHERE g.catalog_item_id = $1 AND g.active
       GROUP BY g.id
       ORDER BY g.sort_order, g.created_at`,
      [catalogItemId],
    )
  ).rows;
  const known = new Map();
  for (const group of groups)
    for (const modifier of group.modifiers)
      known.set(modifier.id, { ...modifier, groupId: group.public_id, groupName: group.name });
  for (const id of unique) {
    const modifier = known.get(id);
    if (!modifier || !modifier.available)
      throw Object.assign(new Error("Un agregado no está disponible para este producto"), {
        status: 409,
      });
  }
  for (const group of groups) {
    const count = unique.filter((id) => known.get(id)?.groupId === group.public_id).length;
    if (count < group.minimum_selections || count > group.maximum_selections)
      throw Object.assign(
        new Error(
          `${group.name}: elegí entre ${group.minimum_selections} y ${group.maximum_selections}`,
        ),
        { status: 409 },
      );
  }
  const modifiers = unique.map((id) => known.get(id));
  return {
    priceCents: modifiers.reduce((sum, modifier) => sum + Number(modifier.priceCents), 0),
    modifiers: modifiers.map((modifier) => ({
      id: modifier.id,
      name: modifier.name,
      price: pesos(modifier.priceCents),
      groupId: modifier.groupId,
      groupName: modifier.groupName,
    })),
  };
}
