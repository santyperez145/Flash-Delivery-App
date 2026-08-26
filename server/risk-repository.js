import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
const mapRisk = (row) => ({
  id: row.public_id,
  customerId: row.customer_public_id,
  service: row.service,
  amount: Number(row.amount_cents) / 100,
  score: Number(row.score),
  decision: row.decision,
  rules: row.rules || [],
  requestId: row.request_id || null,
  entityId: row.entity_public_id || null,
  createdAt: new Date(row.created_at).toISOString(),
  reviewedBy: row.reviewer_public_id || null,
  reviewStatus: row.review_status || null,
  reviewNote: row.review_note || null,
  reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
});
export async function assessTransactionRisk({
  customerPublicId,
  service,
  amount,
  requestId,
  idempotencyKey,
  entityPublicId = null,
}) {
  const amountCents = Math.round(Number(amount) * 100),
    existing = (
      await postgresPool.query(
        `SELECT r.*,u.public_id customer_public_id FROM transaction_risk_assessments r JOIN users u ON u.id=r.customer_id WHERE u.public_id=$1 AND r.service=$2 AND r.idempotency_key=$3`,
        [customerPublicId, service, idempotencyKey],
      )
    ).rows[0];
  if (existing) return mapRisk(existing);
  const facts = (
    await postgresPool.query(
      `SELECT u.id,u.created_at,(SELECT count(*)::int FROM jobs j WHERE j.customer_id=u.id AND j.created_at>now()-interval '10 minutes') jobs_10m,(SELECT COALESCE(sum(COALESCE(j.final_amount_cents,j.quoted_amount_cents)),0)::bigint FROM jobs j WHERE j.customer_id=u.id AND j.created_at>now()-interval '1 hour') spend_1h,(SELECT count(*)::int FROM payment_intents p WHERE p.customer_id=u.id AND p.status='failed' AND p.updated_at>now()-interval '24 hours') failures_24h FROM users u WHERE u.public_id=$1`,
      [customerPublicId],
    )
  ).rows[0];
  if (!facts) throw Object.assign(new Error("Cliente no encontrado"), { status: 404 });
  let score = 0;
  const rules = [];
  const add = (code, points, fact) => {
    score += points;
    rules.push({ code, points, fact });
  };
  if (amountCents >= 500000) add("high_amount", 45, { amountCents });
  else if (amountCents >= 250000) add("elevated_amount", 25, { amountCents });
  if (Date.now() - new Date(facts.created_at).getTime() < 86400000)
    add("new_account", 20, {
      ageHours: Math.floor((Date.now() - new Date(facts.created_at).getTime()) / 3600000),
    });
  if (facts.jobs_10m >= 12) add("velocity_critical", 35, { jobs10m: facts.jobs_10m });
  else if (facts.jobs_10m >= 6) add("velocity_elevated", 15, { jobs10m: facts.jobs_10m });
  if (Number(facts.spend_1h) >= 1500000)
    add("hourly_spend", 30, { spendCents: Number(facts.spend_1h) });
  if (facts.failures_24h >= 3) add("payment_failures", 35, { failures24h: facts.failures_24h });
  score = Math.min(100, score);
  const decision = score >= 80 ? "block" : score >= 50 ? "review" : "allow",
    row = (
      await postgresPool.query(
        `INSERT INTO transaction_risk_assessments(public_id,customer_id,service,amount_cents,score,decision,rules,request_id,idempotency_key,entity_public_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          `RSK-${crypto.randomUUID()}`,
          facts.id,
          service,
          amountCents,
          score,
          decision,
          JSON.stringify(rules),
          requestId,
          idempotencyKey,
          entityPublicId,
        ],
      )
    ).rows[0];
  return mapRisk({ ...row, customer_public_id: customerPublicId });
}
export async function setRiskEntity({ assessmentPublicId, entityPublicId }) {
  await postgresPool.query(
    "UPDATE transaction_risk_assessments SET entity_public_id=$2 WHERE public_id=$1",
    [assessmentPublicId, entityPublicId],
  );
}
export async function getTransactionRisks({ limit = 100 } = {}) {
  const rows = (
    await postgresPool.query(
      `SELECT r.*,u.public_id customer_public_id,reviewer.public_id reviewer_public_id FROM transaction_risk_assessments r JOIN users u ON u.id=r.customer_id LEFT JOIN users reviewer ON reviewer.id=r.reviewed_by ORDER BY r.created_at DESC LIMIT $1`,
      [limit],
    )
  ).rows;
  return rows.map(mapRisk);
}
export async function reviewTransactionRisk({
  assessmentPublicId,
  actorPublicId,
  reviewStatus,
  reviewNote,
}) {
  const row = (
    await postgresPool.query(
      `UPDATE transaction_risk_assessments r SET review_status=$3,review_note=$4,reviewed_at=now(),reviewed_by=reviewer.id FROM users reviewer,users customer WHERE r.public_id=$1 AND reviewer.public_id=$2 AND customer.id=r.customer_id AND r.review_status IS NULL AND r.decision IN('review','block') RETURNING r.*,customer.public_id customer_public_id,reviewer.public_id reviewer_public_id`,
      [assessmentPublicId, actorPublicId, reviewStatus, reviewNote],
    )
  ).rows[0];
  if (!row) throw Object.assign(new Error("Evaluación pendiente no encontrada"), { status: 404 });
  return mapRisk(row);
}
