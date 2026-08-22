import { postgresPool } from "./postgres.js";

export function classifyDriverDemand(openJobs, eligibleDrivers) {
  if (openJobs >= 3 && openJobs > eligibleDrivers) return "high";
  if (openJobs > 0) return "medium";
  return "low";
}

export async function getDriverDemandZones(actorPublicId) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const profile = (await client.query(`
      SELECT d.id,d.public_id,d.city_id,d.active_mode,d.online,d.current_location,c.public_id city_public_id,c.slug city_slug,c.name city_name,c.timezone
      FROM users u
      JOIN drivers d ON d.user_id=u.id
      JOIN cities c ON c.id=d.city_id AND c.status IN('beta','active')
      WHERE u.public_id=$1
    `, [actorPublicId])).rows[0];
    if (!profile) {
      await client.query("ROLLBACK");
      return null;
    }

    const result = await client.query(`
      SELECT z.public_id,z.name,ST_AsGeoJSON(z.boundary::geometry)::jsonb boundary,
        CASE WHEN $3::geography IS NULL THEN false ELSE ST_Covers(z.boundary::geometry,$3::geometry) END contains_driver,
        (SELECT count(*)::int
          FROM jobs j
          WHERE j.city_id=$1 AND j.kind=$2::job_kind AND j.driver_id IS NULL
            AND j.status NOT IN('completed','cancelled')
            AND (COALESCE(j.metadata->>'subtype','')<>'food_order' OR j.status='ready_for_pickup')
            AND (j.scheduled_for IS NULL OR j.scheduled_for<=now()+interval '15 minutes')
            AND ST_Covers(z.boundary::geometry,j.pickup_location::geometry)
        ) open_jobs,
        (SELECT count(*)::int
          FROM drivers candidate
          JOIN driver_compliance compliance ON compliance.driver_id=candidate.id AND compliance.status='approved'
          WHERE candidate.city_id=$1 AND candidate.online AND candidate.active_mode=$2::job_kind
            AND $2::job_kind=ANY(candidate.service_modes)
            AND candidate.current_location IS NOT NULL
            AND candidate.location_updated_at>=now()-interval '5 minutes'
            AND COALESCE(candidate.location_accuracy_m,999)<=100
            AND ST_Covers(z.boundary::geometry,candidate.current_location::geometry)
            AND EXISTS(
              SELECT 1 FROM vehicles vehicle
              WHERE vehicle.driver_id=candidate.id AND vehicle.active AND vehicle.retired_at IS NULL
                AND vehicle.status='approved' AND $2::job_kind=ANY(vehicle.service_modes)
            )
            AND (($2::job_kind='ride' AND NOT EXISTS(
              SELECT 1 FROM jobs active
              WHERE active.driver_id=candidate.id AND active.kind='ride' AND active.status NOT IN('completed','cancelled')
            )) OR ($2::job_kind<>'ride' AND (
              SELECT count(*) FROM jobs active
              WHERE active.driver_id=candidate.id AND active.kind=$2::job_kind AND active.status NOT IN('completed','cancelled')
            )<2))
        ) eligible_drivers,
        now() observed_at
      FROM service_zones z
      WHERE z.city_id=$1 AND z.active
      ORDER BY contains_driver DESC,z.name
    `, [profile.city_id, profile.active_mode, profile.current_location]);
    await client.query("COMMIT");

    const zones = result.rows.map((row) => {
      const openJobs = Number(row.open_jobs);
      const eligibleDrivers = Number(row.eligible_drivers);
      return {
        id: row.public_id,
        name: row.name,
        level: classifyDriverDemand(openJobs, eligibleDrivers),
        openJobs,
        eligibleDrivers,
        containsDriver: row.contains_driver,
        boundary: row.boundary.coordinates[0].map(([lng, lat]) => ({ lat, lng })),
      };
    }).sort((left, right) => {
      const priority = { high: 2, medium: 1, low: 0 };
      return Number(right.containsDriver) - Number(left.containsDriver)
        || priority[right.level] - priority[left.level]
        || right.openJobs - left.openJobs
        || left.name.localeCompare(right.name, "es");
    });

    return {
      driverId: profile.public_id,
      service: profile.active_mode,
      online: profile.online,
      city: { id: profile.city_public_id, slug: profile.city_slug, name: profile.city_name, timezone: profile.timezone },
      observedAt: result.rows[0]?.observed_at?.toISOString() || new Date().toISOString(),
      source: "postgres-live-window",
      methodology: {
        openJobs: "dispatchable_unassigned",
        scheduledHorizonMinutes: 15,
        supplyFreshnessMinutes: 5,
        maximumLocationAccuracyM: 100,
        forecast: false,
        pricingImpact: false,
      },
      zones,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
