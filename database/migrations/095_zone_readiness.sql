CREATE TABLE zone_readiness_policies (
  zone_id uuid PRIMARY KEY REFERENCES service_zones(id) ON DELETE CASCADE,
  min_fresh_drivers integer NOT NULL DEFAULT 3 CHECK(min_fresh_drivers>=0),
  min_active_branches integer NOT NULL DEFAULT 5 CHECK(min_active_branches>=0),
  min_completed_jobs_7d integer NOT NULL DEFAULT 20 CHECK(min_completed_jobs_7d>=0),
  max_cancellation_percent numeric(5,2) NOT NULL DEFAULT 10 CHECK(max_cancellation_percent BETWEEN 0 AND 100),
  max_urgent_tickets integer NOT NULL DEFAULT 2 CHECK(max_urgent_tickets>=0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO zone_readiness_policies(zone_id) SELECT id FROM service_zones ON CONFLICT DO NOTHING;

CREATE TABLE zone_readiness_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  zone_id uuid NOT NULL REFERENCES service_zones(id),
  assessed_by uuid NOT NULL REFERENCES users(id),
  decision text NOT NULL CHECK(decision IN('go','no_go')),
  criteria jsonb NOT NULL,
  facts jsonb NOT NULL,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  CHECK(jsonb_typeof(criteria)='object' AND jsonb_typeof(facts)='object')
);
CREATE INDEX zone_readiness_assessments_zone_idx ON zone_readiness_assessments(zone_id,assessed_at DESC);
ALTER TABLE zone_readiness_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE zone_readiness_assessments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
    GRANT SELECT,INSERT,UPDATE ON zone_readiness_policies,zone_readiness_assessments TO flash_runtime;
    CREATE POLICY zone_readiness_policies_runtime ON zone_readiness_policies TO flash_runtime USING(true) WITH CHECK(true);
    CREATE POLICY zone_readiness_assessments_runtime ON zone_readiness_assessments TO flash_runtime USING(true) WITH CHECK(true);
  END IF;
END $$;
GRANT SELECT ON zone_readiness_policies,zone_readiness_assessments TO flash_rls_audit;
COMMENT ON TABLE zone_readiness_assessments IS 'Immutable operational snapshot. A zone is no_go whenever any required fact misses policy.';
