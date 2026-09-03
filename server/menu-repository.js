// Ítems de menú, modificadores y dieta del comercio (ARC-001).
//
// Separado del listado de restaurantes y de sucursales: es lo que el comercio
// edita en la carta. Tras mutar, relee el restaurante vía catalog-repository.
import { postgresPool } from "./postgres.js";
import { getPostgresRestaurants } from "./catalog-repository.js";

export async function createPostgresMenuItem(merchantPublicId, item) {
  const merchant = await postgresPool.query(
    "SELECT id, eta_min, metadata FROM merchants WHERE public_id = $1",
    [merchantPublicId],
  );
  if (!merchant.rows[0]) return null;
  await postgresPool.query(
    `INSERT INTO catalog_items(public_id, merchant_id, sku, name, description, category, unit_price_cents, available, metadata)
     VALUES ($1, $2, $1, $3, $4, $5, $6, true, $7)`,
    [
      item.id,
      merchant.rows[0].id,
      item.name,
      item.description,
      item.category,
      Math.round(item.price * 100),
      {
        rating: item.rating,
        timeMin: item.timeMin,
        kcal: item.kcal,
        image: item.image,
        tags: item.tags,
      },
    ],
  );
  await postgresPool.query(
    `INSERT INTO catalog_branch_inventory(branch_id, catalog_item_id, available)
     SELECT b.id, c.id, true
     FROM merchant_branches b
     JOIN catalog_items c ON c.merchant_id = b.merchant_id
     WHERE b.merchant_id = $1 AND c.public_id = $2
     ON CONFLICT DO NOTHING`,
    [merchant.rows[0].id, item.id],
  );
  return (
    (await getPostgresRestaurants()).find((restaurant) => restaurant.id === merchantPublicId) ||
    null
  );
}

export async function updatePostgresMenuItem(merchantPublicId, itemPublicId, changes) {
  const fields = [];
  const values = [];
  if (typeof changes.stock === "boolean") {
    values.push(changes.stock);
    fields.push(`available = $${values.length}`);
  }
  if (typeof changes.price === "number") {
    values.push(Math.round(Math.max(100, changes.price) * 100));
    fields.push(`unit_price_cents = $${values.length}`);
  }
  if (!fields.length)
    return (
      (await getPostgresRestaurants()).find((restaurant) => restaurant.id === merchantPublicId) ||
      null
    );
  values.push(itemPublicId, merchantPublicId);
  await postgresPool.query(
    `UPDATE catalog_items ci SET ${fields.join(", ")}
     FROM merchants m WHERE ci.merchant_id = m.id AND ci.public_id = $${values.length - 1} AND m.public_id = $${values.length}`,
    values,
  );
  if (typeof changes.stock === "boolean")
    await postgresPool.query(
      `UPDATE catalog_branch_inventory i
       SET available = $3, version = version + 1, updated_at = now()
       FROM merchant_branches b
       JOIN merchants m ON m.id = b.merchant_id
       JOIN catalog_items c ON c.merchant_id = m.id
       WHERE i.branch_id = b.id AND i.catalog_item_id = c.id
         AND m.public_id = $1 AND c.public_id = $2`,
      [merchantPublicId, itemPublicId, changes.stock],
    );
  return (
    (await getPostgresRestaurants()).find((restaurant) => restaurant.id === merchantPublicId) ||
    null
  );
}

export async function replacePostgresItemModifiers({
  merchantPublicId,
  itemPublicId,
  actorPublicId,
  admin = false,
  groups,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const item = (
      await client.query(
        `SELECT c.id
         FROM catalog_items c
         JOIN merchants m ON m.id = c.merchant_id
         JOIN users u ON u.id = m.owner_id
         WHERE m.public_id = $1 AND c.public_id = $2
           AND ($4::boolean OR u.public_id = $3)
         FOR UPDATE OF c`,
        [merchantPublicId, itemPublicId, actorPublicId, admin],
      )
    ).rows[0];
    if (!item)
      throw Object.assign(new Error("Producto no encontrado o no autorizado"), { status: 404 });
    await client.query("DELETE FROM catalog_modifier_groups WHERE catalog_item_id=$1", [item.id]);
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const group = groups[groupIndex],
        inserted = (
          await client.query(
            `INSERT INTO catalog_modifier_groups(public_id,catalog_item_id,name,minimum_selections,maximum_selections,sort_order,active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [group.id, item.id, group.name, group.min, group.max, groupIndex, group.active],
          )
        ).rows[0];
      for (let modifierIndex = 0; modifierIndex < group.modifiers.length; modifierIndex++) {
        const modifier = group.modifiers[modifierIndex];
        await client.query(
          `INSERT INTO catalog_modifiers(public_id,group_id,name,price_cents,available,sort_order) VALUES($1,$2,$3,$4,$5,$6)`,
          [
            modifier.id,
            inserted.id,
            modifier.name,
            Math.round(modifier.price * 100),
            modifier.available,
            modifierIndex,
          ],
        );
      }
    }
    await client.query("COMMIT");
    return (await getPostgresRestaurants()).find(
      (restaurant) => restaurant.id === merchantPublicId,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505")
      throw Object.assign(
        new Error("Los identificadores de grupos y agregados no pueden repetirse"),
        { status: 409 },
      );
    throw error;
  } finally {
    client.release();
  }
}

export async function replacePostgresItemDietary({
  merchantPublicId,
  itemPublicId,
  actorPublicId,
  admin = false,
  dietaryLabels,
  allergens,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const item = (
      await client.query(
        `SELECT c.id
         FROM catalog_items c
         JOIN merchants m ON m.id = c.merchant_id
         JOIN users u ON u.id = m.owner_id
         WHERE m.public_id = $1 AND c.public_id = $2
           AND ($4::boolean OR u.public_id = $3)
         FOR UPDATE OF c`,
        [merchantPublicId, itemPublicId, actorPublicId, admin],
      )
    ).rows[0];
    if (!item)
      throw Object.assign(new Error("Producto no encontrado o no autorizado"), { status: 404 });
    const validDietary = (
        await client.query(
          "SELECT code FROM dietary_labels WHERE active AND code=ANY($1::text[])",
          [dietaryLabels],
        )
      ).rows.map((row) => row.code),
      validAllergens = (
        await client.query("SELECT code FROM allergens WHERE active AND code=ANY($1::text[])", [
          allergens.map((entry) => entry.code),
        ])
      ).rows.map((row) => row.code);
    if (validDietary.length !== dietaryLabels.length || validAllergens.length !== allergens.length)
      throw Object.assign(new Error("Existe una dieta o alérgeno no reconocido"), { status: 400 });
    await client.query("DELETE FROM catalog_item_dietary_labels WHERE catalog_item_id=$1", [
      item.id,
    ]);
    await client.query("DELETE FROM catalog_item_allergens WHERE catalog_item_id=$1", [item.id]);
    for (const code of dietaryLabels)
      await client.query(
        "INSERT INTO catalog_item_dietary_labels(catalog_item_id,dietary_code) VALUES($1,$2)",
        [item.id, code],
      );
    for (const allergen of allergens)
      await client.query(
        "INSERT INTO catalog_item_allergens(catalog_item_id,allergen_code,presence) VALUES($1,$2,$3)",
        [item.id, allergen.code, allergen.presence],
      );
    await client.query("COMMIT");
    return (await getPostgresRestaurants()).find(
      (restaurant) => restaurant.id === merchantPublicId,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
