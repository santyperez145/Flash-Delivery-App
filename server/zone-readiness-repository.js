import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";

async function calculate(client, zonePublicId) {
  const row = (
    await client.query(
      `SELECT z.id, z.public_id, z.name, c.slug city,
        p.min_fresh_drivers, p.min_active_branches, p.min_completed_jobs_7d,
        p.max_cancellation_percent, p.max_urgent_tickets,
        (SELECT count(*)::int FROM drivers d
          WHERE d.city_id = z.city_id AND d.online AND d.current_location IS NOT NULL
            AND d.location_updated_at > now() - interval '5 minutes'
            AND COALESCE(d.location_accuracy_m, 999) <= 100
            AND ST_Covers(z.boundary::geometry, d.current_location::geometry)) fresh_drivers,
        (SELECT count(*)::int FROM merchant_branches b
          JOIN merchants m ON m.id = b.merchant_id
          WHERE m.city_id = z.city_id AND m.status = 'active' AND b.status = 'active' AND b.open
            AND ST_Covers(z.boundary::geometry, b.location::geometry)) active_branches,
        (SELECT count(*) FILTER (WHERE j.status = 'completed')::int FROM jobs j
          WHERE j.city_id = z.city_id AND j.created_at > now() - interval '7 days'
            AND ST_Covers(z.boundary::geometry, j.pickup_location::geometry)) completed_jobs,
        (SELECT count(*) FILTER (WHERE j.status = 'cancelled')::int FROM jobs j
          WHERE j.city_id = z.city_id AND j.created_at > now() - interval '7 days'
            AND ST_Covers(z.boundary::geometry, j.pickup_location::geometry)) cancelled_jobs,
        (SELECT count(*)::int FROM support_tickets t
          JOIN users u ON u.id = t.user_id
          WHERE u.city_id = z.city_id AND t.priority = 'urgent'
            AND t.status NOT IN ('resolved', 'closed')) urgent_tickets
       FROM service_zones z
       JOIN cities c ON c.id = z.city_id
       JOIN zone_readiness_policies p ON p.zone_id = z.id
       WHERE z.public_id = $1`,
      [zonePublicId],
    )
  ).rows[0];
  if (!row) throw Object.assign(new Error("Zona no encontrada"), { status: 404 });
  const terminal = row.completed_jobs + row.cancelled_jobs,
    cancellationPercent = terminal ? Math.round((row.cancelled_jobs / terminal) * 10000) / 100 : 0;
  const facts = {
    freshDrivers: row.fresh_drivers,
    activeBranches: row.active_branches,
    completedJobs7d: row.completed_jobs,
    cancelledJobs7d: row.cancelled_jobs,
    cancellationPercent,
    urgentTickets: row.urgent_tickets,
  };
  const criteria = {
    minFreshDrivers: row.min_fresh_drivers,
    minActiveBranches: row.min_active_branches,
    minCompletedJobs7d: row.min_completed_jobs_7d,
    maxCancellationPercent: Number(row.max_cancellation_percent),
    maxUrgentTickets: row.max_urgent_tickets,
  };
  const checks = {
    freshDrivers: facts.freshDrivers >= criteria.minFreshDrivers,
    activeBranches: facts.activeBranches >= criteria.minActiveBranches,
    completedJobs: facts.completedJobs7d >= criteria.minCompletedJobs7d,
    cancellations: facts.cancellationPercent <= criteria.maxCancellationPercent,
    urgentSupport: facts.urgentTickets <= criteria.maxUrgentTickets,
  };
  return {
    zone: { id: row.public_id, name: row.name, city: row.city },
    decision: Object.values(checks).every(Boolean) ? "go" : "no_go",
    checks,
    criteria,
    facts,
  };
}
export async function getZoneReadiness(zonePublicId) {
  return calculate(postgresPool, zonePublicId);
}
export async function assessZoneReadiness({ zonePublicId, actorPublicId }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const assessment = await calculate(client, zonePublicId),
      actor = (await client.query("SELECT id FROM users WHERE public_id=$1", [actorPublicId]))
        .rows[0];
    if (!actor) throw Object.assign(new Error("Operador no encontrado"), { status: 404 });
    const publicId = `ZONE-ASSESS-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
    await client.query(
      `INSERT INTO zone_readiness_assessments(public_id,zone_id,assessed_by,decision,criteria,facts) SELECT $1,z.id,$2,$3,$4,$5 FROM service_zones z WHERE z.public_id=$6`,
      [
        publicId,
        actor.id,
        assessment.decision,
        assessment.criteria,
        assessment.facts,
        zonePublicId,
      ],
    );
    await client.query("COMMIT");
    return { id: publicId, ...assessment, assessedAt: new Date().toISOString() };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
