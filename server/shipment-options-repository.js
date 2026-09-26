// Catálogo operativo de envíos: protección, categorías y niveles (ARC-001).
//
// Separado del ciclo create/status/POD/claims: esto es configuración de mercado
// (qué se puede enviar y a qué precio relativo), no un envío en curso.
import { postgresPool } from "./postgres.js";
import { pesos } from "./money.js";

export async function getShipmentProtectionPlan(code = "standard") {
  const row = (
    await postgresPool.query(
      "SELECT id,code,name,premium_basis_points,minimum_premium_cents,maximum_declared_value_cents,deductible_cents FROM shipment_protection_plans WHERE code=$1 AND active",
      [code],
    )
  ).rows[0];
  if (!row) throw Object.assign(new Error("Protección no disponible"), { status: 409 });
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    premiumRate: Number(row.premium_basis_points) / 10000,
    minimumPremium: pesos(row.minimum_premium_cents),
    maximumDeclaredValue: pesos(row.maximum_declared_value_cents),
    deductible: pesos(row.deductible_cents),
  };
}
export async function getShipmentServiceConfiguration({
  itemCategory = "standard",
  serviceLevel = "standard",
} = {}) {
  const [categoryResult, levelResult] = await Promise.all([
      postgresPool.query(
        "SELECT id,code,name,handling_instructions,surcharge_cents,maximum_weight_grams FROM shipment_item_categories WHERE code=$1 AND active",
        [itemCategory],
      ),
      postgresPool.query(
        "SELECT id,code,name,transport_multiplier,eta_multiplier,maximum_distance_m FROM shipment_service_levels WHERE code=$1 AND active",
        [serviceLevel],
      ),
    ]),
    category = categoryResult.rows[0],
    level = levelResult.rows[0];
  if (!category)
    throw Object.assign(new Error("La categoría del paquete no está disponible"), { status: 409 });
  if (!level)
    throw Object.assign(new Error("El nivel de servicio no está disponible"), { status: 409 });
  return {
    category: {
      id: category.id,
      code: category.code,
      name: category.name,
      handlingInstructions: category.handling_instructions,
      surcharge: pesos(category.surcharge_cents),
      maximumWeightKg: Number(category.maximum_weight_grams) / 1000,
    },
    level: {
      id: level.id,
      code: level.code,
      name: level.name,
      transportMultiplier: Number(level.transport_multiplier),
      etaMultiplier: Number(level.eta_multiplier),
      maximumDistanceKm:
        level.maximum_distance_m === null ? null : Number(level.maximum_distance_m) / 1000,
    },
  };
}
export async function getShipmentOptions({ includeInactive = false } = {}) {
  const activeFilter = includeInactive ? "" : "WHERE active",
    [categories, levels] = await Promise.all([
      postgresPool.query(
        `SELECT code,name,handling_instructions,surcharge_cents,maximum_weight_grams,active FROM shipment_item_categories ${activeFilter} ORDER BY created_at`,
      ),
      postgresPool.query(
        `SELECT code,name,transport_multiplier,eta_multiplier,maximum_distance_m,active FROM shipment_service_levels ${activeFilter} ORDER BY transport_multiplier`,
      ),
    ]);
  return {
    categories: categories.rows.map((row) => ({
      code: row.code,
      name: row.name,
      handlingInstructions: row.handling_instructions,
      surcharge: pesos(row.surcharge_cents),
      maximumWeightKg: Number(row.maximum_weight_grams) / 1000,
      active: row.active,
    })),
    serviceLevels: levels.rows.map((row) => ({
      code: row.code,
      name: row.name,
      transportMultiplier: Number(row.transport_multiplier),
      etaMultiplier: Number(row.eta_multiplier),
      maximumDistanceKm:
        row.maximum_distance_m === null ? null : Number(row.maximum_distance_m) / 1000,
      active: row.active,
    })),
  };
}
export async function updateShipmentItemCategory(code, patch) {
  const row = (
    await postgresPool.query(
      `UPDATE shipment_item_categories SET
        name = COALESCE($2, name),
        handling_instructions = COALESCE($3, handling_instructions),
        surcharge_cents = COALESCE($4, surcharge_cents),
        maximum_weight_grams = COALESCE($5, maximum_weight_grams),
        active = COALESCE($6, active),
        updated_at = now()
      WHERE code = $1
      RETURNING code, name, handling_instructions, surcharge_cents, maximum_weight_grams, active`,
      [
        code,
        patch.name ?? null,
        patch.handlingInstructions ?? null,
        patch.surcharge === undefined ? null : Math.round(patch.surcharge * 100),
        patch.maximumWeightKg === undefined ? null : Math.round(patch.maximumWeightKg * 1000),
        patch.active ?? null,
      ],
    )
  ).rows[0];
  if (!row) throw Object.assign(new Error("Categoría de envío no encontrada"), { status: 404 });
  return {
    code: row.code,
    name: row.name,
    handlingInstructions: row.handling_instructions,
    surcharge: pesos(row.surcharge_cents),
    maximumWeightKg: Number(row.maximum_weight_grams) / 1000,
    active: row.active,
  };
}
export async function updateShipmentServiceLevel(code, patch) {
  const hasMaximumDistance = Object.prototype.hasOwnProperty.call(patch, "maximumDistanceKm"),
    row = (
      await postgresPool.query(
        `UPDATE shipment_service_levels SET
          name = COALESCE($2, name),
          transport_multiplier = COALESCE($3, transport_multiplier),
          eta_multiplier = COALESCE($4, eta_multiplier),
          maximum_distance_m = CASE WHEN $5 THEN $6 ELSE maximum_distance_m END,
          active = COALESCE($7, active),
          updated_at = now()
        WHERE code = $1
        RETURNING code, name, transport_multiplier, eta_multiplier, maximum_distance_m, active`,
        [
          code,
          patch.name ?? null,
          patch.transportMultiplier ?? null,
          patch.etaMultiplier ?? null,
          hasMaximumDistance,
          patch.maximumDistanceKm === null || patch.maximumDistanceKm === undefined
            ? null
            : Math.round(patch.maximumDistanceKm * 1000),
          patch.active ?? null,
        ],
      )
    ).rows[0];
  if (!row) throw Object.assign(new Error("Nivel de servicio no encontrado"), { status: 404 });
  return {
    code: row.code,
    name: row.name,
    transportMultiplier: Number(row.transport_multiplier),
    etaMultiplier: Number(row.eta_multiplier),
    maximumDistanceKm:
      row.maximum_distance_m === null ? null : Number(row.maximum_distance_m) / 1000,
    active: row.active,
  };
}
