// Sucursales: estado, stock y horarios (ARC-001).
//
// Separado del menú y del listado de comercios: es el “dónde y cuándo” de la
// operación física. Tras mutar, relee el restaurante vía catalog-repository.
import { postgresPool } from "./postgres.js";
import { getPostgresRestaurants } from "./catalog-repository.js";

export async function updatePostgresBranch({
  merchantPublicId,
  branchPublicId,
  actorPublicId,
  admin = false,
  changes,
}) {
  const fields = [],
    values = [];
  for (const [key, column] of [
    ["open", "open"],
    ["etaMin", "eta_min"],
    ["status", "status"],
  ])
    if (changes[key] !== undefined) {
      values.push(changes[key]);
      fields.push(`${column}=$${values.length}`);
    }
  if (!fields.length) throw Object.assign(new Error("No hay cambios"), { status: 400 });
  values.push(merchantPublicId, branchPublicId, actorPublicId, admin);
  const result = await postgresPool.query(
    `UPDATE merchant_branches b
     SET ${fields.join(",")}, updated_at = now()
     FROM merchants m
     JOIN users u ON u.id = m.owner_id
     WHERE b.merchant_id = m.id
       AND m.public_id = $${values.length - 3}
       AND b.public_id = $${values.length - 2}
       AND ($${values.length}::boolean OR u.public_id = $${values.length - 1})
     RETURNING b.public_id`,
    values,
  );
  if (!result.rowCount)
    throw Object.assign(new Error("Sucursal no encontrada o no autorizada"), { status: 404 });
  return (await getPostgresRestaurants()).find((r) => r.id === merchantPublicId);
}
export async function updatePostgresBranchInventory({
  merchantPublicId,
  branchPublicId,
  itemPublicId,
  actorPublicId,
  admin = false,
  available,
  stockQuantity,
}) {
  const result = await postgresPool.query(
    `UPDATE catalog_branch_inventory i
     SET available = $6, stock_quantity = $7, version = version + 1, updated_at = now()
     FROM merchant_branches b
     JOIN merchants m ON m.id = b.merchant_id
     JOIN users u ON u.id = m.owner_id
     JOIN catalog_items c ON c.merchant_id = m.id
     WHERE i.branch_id = b.id AND i.catalog_item_id = c.id
       AND m.public_id = $1 AND b.public_id = $2 AND c.public_id = $3
       AND ($5::boolean OR u.public_id = $4)
     RETURNING i.version`,
    [
      merchantPublicId,
      branchPublicId,
      itemPublicId,
      actorPublicId,
      admin,
      available,
      stockQuantity ?? null,
    ],
  );
  if (!result.rowCount)
    throw Object.assign(new Error("Inventario de sucursal no encontrado o no autorizado"), {
      status: 404,
    });
  return (await getPostgresRestaurants()).find((r) => r.id === merchantPublicId);
}

async function lockOwnedBranch(client, { merchantPublicId, branchPublicId, actorPublicId, admin }) {
  const branch = (
    await client.query(
      `SELECT b.id
       FROM merchant_branches b
       JOIN merchants m ON m.id = b.merchant_id
       JOIN users u ON u.id = m.owner_id
       WHERE m.public_id = $1 AND b.public_id = $2
         AND ($4::boolean OR u.public_id = $3)
       FOR UPDATE OF b`,
      [merchantPublicId, branchPublicId, actorPublicId, admin],
    )
  ).rows[0];
  if (!branch)
    throw Object.assign(new Error("Sucursal no encontrada o no autorizada"), { status: 404 });
  return branch;
}

export async function replacePostgresBranchSchedule({
  merchantPublicId,
  branchPublicId,
  actorPublicId,
  admin = false,
  timezone,
  hours,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const branch = await lockOwnedBranch(client, {
      merchantPublicId,
      branchPublicId,
      actorPublicId,
      admin,
    });
    const validZone = (
      await client.query("SELECT 1 FROM pg_timezone_names WHERE name=$1", [timezone])
    ).rows[0];
    if (!validZone) throw Object.assign(new Error("Zona horaria inválida"), { status: 400 });
    await client.query("UPDATE merchant_branches SET timezone=$2,updated_at=now() WHERE id=$1", [
      branch.id,
      timezone,
    ]);
    await client.query("DELETE FROM branch_operating_hours WHERE branch_id=$1", [branch.id]);
    for (const hour of hours)
      await client.query(
        "INSERT INTO branch_operating_hours(branch_id,weekday,opens_at,closes_at,enabled) VALUES($1,$2,$3,$4,$5)",
        [branch.id, hour.weekday, hour.opensAt, hour.closesAt, hour.enabled],
      );
    await client.query("COMMIT");
    return (await getPostgresRestaurants()).find((r) => r.id === merchantPublicId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function upsertPostgresBranchScheduleException({
  merchantPublicId,
  branchPublicId,
  actorPublicId,
  admin = false,
  date,
  isOpen,
  opensAt,
  closesAt,
  reason,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const branch = await lockOwnedBranch(client, {
      merchantPublicId,
      branchPublicId,
      actorPublicId,
      admin,
    });
    await client.query(
      `INSERT INTO branch_schedule_exceptions(
         branch_id, local_date, is_open, opens_at, closes_at, reason
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (branch_id, local_date) DO UPDATE SET
         is_open = excluded.is_open,
         opens_at = excluded.opens_at,
         closes_at = excluded.closes_at,
         reason = excluded.reason,
         updated_at = now()`,
      [branch.id, date, isOpen, isOpen ? opensAt : null, isOpen ? closesAt : null, reason || null],
    );
    await client.query("COMMIT");
    return (await getPostgresRestaurants()).find((r) => r.id === merchantPublicId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
