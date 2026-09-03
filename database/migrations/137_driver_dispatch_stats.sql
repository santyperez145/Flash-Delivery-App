-- Stats precomputadas de dispatch por conductor y vertical (DSP-001).
--
-- El scoring lee esta tabla en lugar de agregar dispatch_offers en cada oleada.
-- Se refresca out-of-band tras accept/reject y periódicamente en el batch worker.

CREATE TABLE driver_dispatch_stats(
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  service job_kind NOT NULL,
  acceptance_rate_7d numeric,
  acceptance_rate_30d numeric,
  cancellation_rate_30d numeric,
  median_response_seconds numeric,
  completed_jobs_30d integer NOT NULL DEFAULT 0,
  incident_score numeric NOT NULL DEFAULT 0,
  current_capacity integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, service)
);

CREATE INDEX driver_dispatch_stats_updated_at_idx ON driver_dispatch_stats(updated_at);

ALTER TABLE driver_dispatch_stats ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON driver_dispatch_stats FROM PUBLIC;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON driver_dispatch_stats TO flash_runtime;
  CREATE POLICY driver_dispatch_stats_runtime_service ON driver_dispatch_stats
    TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT ON driver_dispatch_stats TO flash_rls_audit;
 END IF;
END $$;
