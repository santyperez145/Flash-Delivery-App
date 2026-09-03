// Tarifas versionadas y change requests (ARC-001).
//
// Separado de promociones y zonas: es dinero de plataforma con dual control
// (activar / rollback / review), no el catálogo comercial de promos.
import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";

const pricingChangeId = () => `PRICE-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

export async function getPostgresPricingPlan(service) {
  await activateDuePostgresPricingChanges();
  const row = (
    await postgresPool.query(
      `SELECT service,version,currency,config,effective_from FROM pricing_plans
      WHERE service=$1 AND active AND effective_from<=now() AND (effective_until IS NULL OR effective_until>now())
      ORDER BY effective_from DESC LIMIT 1`,
      [service],
    )
  ).rows[0];
  if (!row)
    throw Object.assign(new Error(`No existe una tarifa activa para ${service}`), { status: 503 });
  return {
    service: row.service,
    version: row.version,
    currency: row.currency,
    config: row.config,
    effectiveFrom: new Date(row.effective_from).toISOString(),
  };
}

export async function getPostgresPricingPlans() {
  const result = await postgresPool.query(
    `SELECT service,version,currency,config,effective_from,active FROM pricing_plans ORDER BY service,effective_from DESC`,
  );
  return result.rows.map((row) => ({
    service: row.service,
    version: row.version,
    currency: row.currency,
    config: row.config,
    effectiveFrom: new Date(row.effective_from).toISOString(),
    active: row.active,
  }));
}

export async function activatePostgresPricingPlan({ service, version, config }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM pricing_plans WHERE service=$1 AND active FOR UPDATE", [
      service,
    ]);
    await client.query(
      "UPDATE pricing_plans SET active=false,effective_until=now() WHERE service=$1 AND active",
      [service],
    );
    await client.query(
      `INSERT INTO pricing_plans(service,version,config,effective_from,active) VALUES($1,$2,$3,now(),true)`,
      [service, version, config],
    );
    await client.query("COMMIT");
    return getPostgresPricingPlan(service);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const mapPricingChange = (row) => ({
  id: row.public_id,
  service: row.service,
  version: row.version,
  currency: row.currency,
  config: row.config,
  status: row.status,
  changeKind: row.change_kind,
  sourceVersion: row.source_version || null,
  riskLevel: row.risk_level,
  maximumChangePercent: Number(row.maximum_change_percent),
  riskWarnings: row.risk_warnings || [],
  requestedBy: row.requested_by_public_id,
  reviewedBy: row.reviewed_by_public_id || null,
  requestedAt: new Date(row.requested_at).toISOString(),
  reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
  effectiveAt: new Date(row.effective_at).toISOString(),
  activatedAt: row.activated_at ? new Date(row.activated_at).toISOString() : null,
  reviewNote: row.review_note || null,
});
const pricingChangeSelect = `SELECT r.*,requester.public_id requested_by_public_id,reviewer.public_id reviewed_by_public_id,
  source.version source_version FROM pricing_change_requests r
  JOIN users requester ON requester.id=r.requested_by LEFT JOIN users reviewer ON reviewer.id=r.reviewed_by
  LEFT JOIN pricing_plans source ON source.id=r.source_pricing_plan_id`;

export async function getPostgresPricingChangeRequests() {
  const result = await postgresPool.query(
    `${pricingChangeSelect} ORDER BY r.requested_at DESC LIMIT 100`,
  );
  return result.rows.map(mapPricingChange);
}

function flattenNumericConfig(value, prefix = "", result = {}) {
  for (const [key, entry] of Object.entries(value || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof entry === "number" && Number.isFinite(entry)) result[path] = entry;
    else if (entry && typeof entry === "object" && !Array.isArray(entry))
      flattenNumericConfig(entry, path, result);
  }
  return result;
}
function calculatePricingRisk(previousConfig, nextConfig) {
  const previous = flattenNumericConfig(previousConfig),
    next = flattenNumericConfig(nextConfig),
    warnings = [];
  let maximum = 0;
  for (const [path, nextValue] of Object.entries(next)) {
    if (typeof previous[path] !== "number") continue;
    const previousValue = previous[path],
      percent =
        Math.round(
          (Math.abs(nextValue - previousValue) / Math.max(Math.abs(previousValue), 1)) * 10000,
        ) / 100;
    maximum = Math.max(maximum, percent);
    if (percent >= 20)
      warnings.push({
        path,
        previous: previousValue,
        next: nextValue,
        changePercent: percent,
        direction: nextValue > previousValue ? "increase" : "decrease",
      });
  }
  warnings.sort((a, b) => b.changePercent - a.changePercent);
  return {
    riskLevel: maximum >= 50 ? "high" : maximum >= 20 ? "medium" : "low",
    maximumChangePercent: maximum,
    warnings: warnings.slice(0, 12),
  };
}

export async function createPostgresPricingChangeRequest({
  service,
  version,
  config,
  effectiveAt,
  requesterPublicId,
  changeKind = "update",
  sourcePlanId = null,
}) {
  await activateDuePostgresPricingChanges();
  const current = (
    await postgresPool.query(
      "SELECT config FROM pricing_plans WHERE service=$1 AND active ORDER BY effective_from DESC LIMIT 1",
      [service],
    )
  ).rows[0];
  if (!current)
    throw Object.assign(new Error("No existe una tarifa activa para comparar"), { status: 503 });
  const risk = calculatePricingRisk(current.config, config),
    row = (
      await postgresPool.query(
        `INSERT INTO pricing_change_requests(public_id,service,version,config,effective_at,requested_by,change_kind,source_pricing_plan_id,risk_level,maximum_change_percent,risk_warnings)
        SELECT $1,$2,$3,$4,$5,u.id,$7,$8,$9,$10,$11 FROM users u WHERE u.public_id=$6 RETURNING id`,
        [
          pricingChangeId(),
          service,
          version,
          config,
          effectiveAt,
          requesterPublicId,
          changeKind,
          sourcePlanId,
          risk.riskLevel,
          risk.maximumChangePercent,
          JSON.stringify(risk.warnings),
        ],
      )
    ).rows[0];
  if (!row) throw Object.assign(new Error("Usuario solicitante no encontrado"), { status: 404 });
  return (await postgresPool.query(`${pricingChangeSelect} WHERE r.id=$1`, [row.id])).rows.map(
    mapPricingChange,
  )[0];
}

export async function createPostgresPricingRollbackRequest({
  service,
  targetVersion,
  version,
  effectiveAt,
  requesterPublicId,
}) {
  const target = (
    await postgresPool.query(
      "SELECT id,currency,config FROM pricing_plans WHERE service=$1 AND version=$2",
      [service, targetVersion],
    )
  ).rows[0];
  if (!target) throw Object.assign(new Error("Versión histórica no encontrada"), { status: 404 });
  return createPostgresPricingChangeRequest({
    service,
    version,
    config: target.config,
    effectiveAt,
    requesterPublicId,
    changeKind: "rollback",
    sourcePlanId: target.id,
  });
}

async function activatePricingChangeWithClient(client, row) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`pricing:${row.service}`]);
  await client.query(
    "UPDATE pricing_plans SET active=false,effective_until=$2 WHERE service=$1 AND active",
    [row.service, row.effective_at],
  );
  await client.query(
    `INSERT INTO pricing_plans(service,version,currency,config,effective_from,active) VALUES($1,$2,$3,$4,$5,true)`,
    [row.service, row.version, row.currency, row.config, row.effective_at],
  );
  await client.query(
    "UPDATE pricing_change_requests SET status='activated',activated_at=now(),updated_at=now() WHERE id=$1",
    [row.id],
  );
}

export async function reviewPostgresPricingChangeRequest({
  publicId,
  reviewerPublicId,
  decision,
  note,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const row = (
      await client.query(
        `SELECT r.*,requester.public_id requester_public_id,reviewer.id reviewer_id
        FROM pricing_change_requests r JOIN users requester ON requester.id=r.requested_by
        JOIN users reviewer ON reviewer.public_id=$2 WHERE r.public_id=$1 FOR UPDATE OF r`,
        [publicId, reviewerPublicId],
      )
    ).rows[0];
    if (!row) throw Object.assign(new Error("Solicitud tarifaria no encontrada"), { status: 404 });
    if (row.status !== "pending")
      throw Object.assign(new Error("La solicitud ya fue revisada"), { status: 409 });
    if (row.requester_public_id === reviewerPublicId)
      throw Object.assign(new Error("La persona solicitante no puede aprobar su propio cambio"), {
        status: 409,
      });
    if (row.risk_level === "high" && note.trim().length < 20)
      throw Object.assign(
        new Error("Los cambios de riesgo alto requieren un fundamento de al menos 20 caracteres"),
        { status: 400 },
      );
    if (decision === "rejected") {
      await client.query(
        "UPDATE pricing_change_requests SET status='rejected',reviewed_by=$2,reviewed_at=now(),review_note=$3,updated_at=now() WHERE id=$1",
        [row.id, row.reviewer_id, note],
      );
    } else {
      await client.query(
        "UPDATE pricing_change_requests SET status='approved',reviewed_by=$2,reviewed_at=now(),review_note=$3,updated_at=now() WHERE id=$1",
        [row.id, row.reviewer_id, note],
      );
      if (new Date(row.effective_at) <= new Date())
        await activatePricingChangeWithClient(client, row);
    }
    await client.query("COMMIT");
    return (
      await postgresPool.query(`${pricingChangeSelect} WHERE r.public_id=$1`, [publicId])
    ).rows.map(mapPricingChange)[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function activateDuePostgresPricingChanges() {
  const client = await postgresPool.connect();
  let activated = 0;
  try {
    await client.query("BEGIN");
    const rows = (
      await client.query(
        "SELECT * FROM pricing_change_requests WHERE status='approved' AND effective_at<=now() ORDER BY effective_at FOR UPDATE SKIP LOCKED",
      )
    ).rows;
    for (const row of rows) {
      await activatePricingChangeWithClient(client, row);
      activated += 1;
    }
    await client.query("COMMIT");
    return { activated };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
