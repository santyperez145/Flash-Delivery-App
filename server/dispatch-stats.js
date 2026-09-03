// Stats precomputadas de dispatch por conductor y vertical (DSP-001).
//
// El scoring lee driver_dispatch_stats en lugar de agregar dispatch_offers por
// oleada. Se refrescan tras accept/reject y periódicamente en el batch worker.

/**
 * Upsert de stats para un par conductor+servicio.
 *
 * cancellation_rate_30d: fracción de compromisos fallidos en 30 días.
 * Numerador: ofertas rechazadas por el conductor más trabajos cancelados tras
 * aceptación. Denominador: ofertas resueltas (accepted/rejected/expired) más
 * cancelaciones post-aceptación. Las retiradas por el sistema no penalizan.
 */
const REFRESH_DRIVER_DISPATCH_STATS_SQL = `
  INSERT INTO driver_dispatch_stats(
    driver_id, service, acceptance_rate_7d, acceptance_rate_30d, cancellation_rate_30d,
    median_response_seconds, completed_jobs_30d, incident_score, current_capacity, updated_at)
  SELECT
    $1::uuid,
    $2::job_kind,
    offers.acceptance_rate_7d,
    offers.acceptance_rate_30d,
    CASE WHEN offers.resolved_30d + jobs.cancelled_30d > 0
      THEN (offers.rejected_30d + jobs.cancelled_30d) / (offers.resolved_30d + jobs.cancelled_30d)
      ELSE NULL END,
    offers.median_response_seconds,
    jobs.completed_30d,
    LEAST(40, COALESCE(incidents.incident_count, 0) * 10)::numeric,
    jobs.active_count,
    now()
  FROM (
    SELECT
      count(*) FILTER(WHERE prior.status='accepted' AND prior.created_at>=now()-interval '7 days')::numeric
        / NULLIF(count(*) FILTER(WHERE prior.status IN('accepted','rejected','expired')
          AND prior.created_at>=now()-interval '7 days'),0) acceptance_rate_7d,
      count(*) FILTER(WHERE prior.status='accepted')::numeric
        / NULLIF(count(*) FILTER(WHERE prior.status IN('accepted','rejected','expired')),0)
        acceptance_rate_30d,
      count(*) FILTER(WHERE prior.status='rejected')::numeric rejected_30d,
      count(*) FILTER(WHERE prior.status IN('accepted','rejected','expired'))::numeric resolved_30d,
      (
        SELECT percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(epoch FROM (resp.responded_at-resp.created_at)))
        FROM dispatch_offers resp
        JOIN jobs resp_job ON resp_job.id=resp.job_id
        WHERE resp.driver_id=$1::uuid AND resp_job.kind=$2::job_kind
          AND resp.responded_at IS NOT NULL AND resp.status IN('accepted','rejected')
          AND resp.created_at>=now()-interval '30 days'
      ) median_response_seconds
    FROM dispatch_offers prior
    JOIN jobs prior_job ON prior_job.id=prior.job_id
    WHERE prior.driver_id=$1::uuid AND prior_job.kind=$2::job_kind
      AND prior.created_at>=now()-interval '30 days'
  ) offers
  RIGHT JOIN (SELECT 1) seed ON true
  CROSS JOIN (
    SELECT
      count(*) FILTER(WHERE j.status='completed' AND j.updated_at>=now()-interval '30 days')::int
        completed_30d,
      count(*) FILTER(WHERE j.status NOT IN('completed','cancelled'))::int active_count,
      count(*) FILTER(WHERE j.status='cancelled' AND j.updated_at>=now()-interval '30 days'
        AND EXISTS(SELECT 1 FROM dispatch_offers o
          WHERE o.job_id=j.id AND o.driver_id=$1::uuid AND o.status='accepted'))::numeric
        cancelled_30d
    FROM jobs j
    WHERE j.driver_id=$1::uuid AND j.kind=$2::job_kind
  ) jobs
  CROSS JOIN (
    -- Penalización acotada: 10 puntos por incidente real (no false_alarm) en 30 días
    -- sobre trabajos de esta vertical. Tope 40 para no anular el resto del score.
    SELECT count(*)::numeric incident_count
    FROM ride_safety_incidents i
    JOIN jobs ij ON ij.id = i.job_id
    WHERE ij.driver_id = $1::uuid
      AND ij.kind = $2::job_kind
      AND i.created_at >= now() - interval '30 days'
      AND i.status <> 'false_alarm'
  ) incidents
  ON CONFLICT (driver_id, service) DO UPDATE SET
    acceptance_rate_7d=EXCLUDED.acceptance_rate_7d,
    acceptance_rate_30d=EXCLUDED.acceptance_rate_30d,
    cancellation_rate_30d=EXCLUDED.cancellation_rate_30d,
    median_response_seconds=EXCLUDED.median_response_seconds,
    completed_jobs_30d=EXCLUDED.completed_jobs_30d,
    incident_score=EXCLUDED.incident_score,
    current_capacity=EXCLUDED.current_capacity,
    updated_at=now()`;

const REFRESH_STALE_DISPATCH_STATS_SQL = `
  WITH targets AS (
    SELECT d.id driver_id, mode.service
    FROM drivers d
    CROSS JOIN LATERAL unnest(d.service_modes) mode(service)
    LEFT JOIN driver_dispatch_stats s ON s.driver_id=d.id AND s.service=mode.service
    WHERE d.online
      AND (s.driver_id IS NULL OR s.updated_at<now()-($2::int*interval '1 minute'))
    LIMIT $1
  )
  INSERT INTO driver_dispatch_stats(
    driver_id, service, acceptance_rate_7d, acceptance_rate_30d, cancellation_rate_30d,
    median_response_seconds, completed_jobs_30d, incident_score, current_capacity, updated_at)
  SELECT
    t.driver_id,
    t.service,
    offers.acceptance_rate_7d,
    offers.acceptance_rate_30d,
    CASE WHEN offers.resolved_30d + jobs.cancelled_30d > 0
      THEN (offers.rejected_30d + jobs.cancelled_30d) / (offers.resolved_30d + jobs.cancelled_30d)
      ELSE NULL END,
    offers.median_response_seconds,
    jobs.completed_30d,
    LEAST(40, COALESCE(incidents.incident_count, 0) * 10)::numeric,
    jobs.active_count,
    now()
  FROM targets t
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER(WHERE prior.status='accepted' AND prior.created_at>=now()-interval '7 days')::numeric
        / NULLIF(count(*) FILTER(WHERE prior.status IN('accepted','rejected','expired')
          AND prior.created_at>=now()-interval '7 days'),0) acceptance_rate_7d,
      count(*) FILTER(WHERE prior.status='accepted')::numeric
        / NULLIF(count(*) FILTER(WHERE prior.status IN('accepted','rejected','expired')),0)
        acceptance_rate_30d,
      count(*) FILTER(WHERE prior.status='rejected')::numeric rejected_30d,
      count(*) FILTER(WHERE prior.status IN('accepted','rejected','expired'))::numeric resolved_30d,
      (
        SELECT percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(epoch FROM (resp.responded_at-resp.created_at)))
        FROM dispatch_offers resp
        JOIN jobs resp_job ON resp_job.id=resp.job_id
        WHERE resp.driver_id=t.driver_id AND resp_job.kind=t.service
          AND resp.responded_at IS NOT NULL AND resp.status IN('accepted','rejected')
          AND resp.created_at>=now()-interval '30 days'
      ) median_response_seconds
    FROM dispatch_offers prior
    JOIN jobs prior_job ON prior_job.id=prior.job_id
    WHERE prior.driver_id=t.driver_id AND prior_job.kind=t.service
      AND prior.created_at>=now()-interval '30 days'
  ) offers ON true
  CROSS JOIN LATERAL (
    SELECT
      count(*) FILTER(WHERE j.status='completed' AND j.updated_at>=now()-interval '30 days')::int
        completed_30d,
      count(*) FILTER(WHERE j.status NOT IN('completed','cancelled'))::int active_count,
      count(*) FILTER(WHERE j.status='cancelled' AND j.updated_at>=now()-interval '30 days'
        AND EXISTS(SELECT 1 FROM dispatch_offers o
          WHERE o.job_id=j.id AND o.driver_id=t.driver_id AND o.status='accepted'))::numeric
        cancelled_30d
    FROM jobs j
    WHERE j.driver_id=t.driver_id AND j.kind=t.service
  ) jobs
  CROSS JOIN LATERAL (
    SELECT count(*)::numeric incident_count
    FROM ride_safety_incidents i
    JOIN jobs ij ON ij.id = i.job_id
    WHERE ij.driver_id = t.driver_id
      AND ij.kind = t.service
      AND i.created_at >= now() - interval '30 days'
      AND i.status <> 'false_alarm'
  ) incidents
  ON CONFLICT (driver_id, service) DO UPDATE SET
    acceptance_rate_7d=EXCLUDED.acceptance_rate_7d,
    acceptance_rate_30d=EXCLUDED.acceptance_rate_30d,
    cancellation_rate_30d=EXCLUDED.cancellation_rate_30d,
    median_response_seconds=EXCLUDED.median_response_seconds,
    completed_jobs_30d=EXCLUDED.completed_jobs_30d,
    incident_score=EXCLUDED.incident_score,
    current_capacity=EXCLUDED.current_capacity,
    updated_at=now()`;

function queryClient(clientOrPool) {
  if (clientOrPool.query) return clientOrPool;
  throw Object.assign(new Error("Se requiere un cliente o pool de PostgreSQL"), { status: 500 });
}

export async function refreshDriverDispatchStats(clientOrPool, { driverId, service } = {}) {
  if (!driverId || !service) return { refreshed: 0 };
  const client = queryClient(clientOrPool);
  const result = await client.query(REFRESH_DRIVER_DISPATCH_STATS_SQL, [driverId, service]);
  return { refreshed: result.rowCount ?? 0 };
}

export async function refreshStaleDispatchStats(
  clientOrPool,
  { olderThanMinutes = 15, limit = 200 } = {},
) {
  const client = queryClient(clientOrPool);
  const result = await client.query(REFRESH_STALE_DISPATCH_STATS_SQL, [limit, olderThanMinutes]);
  return { refreshed: result.rowCount ?? 0 };
}

export { REFRESH_DRIVER_DISPATCH_STATS_SQL, REFRESH_STALE_DISPATCH_STATS_SQL };
