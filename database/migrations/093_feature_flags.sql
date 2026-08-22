CREATE TABLE feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  key text NOT NULL UNIQUE CHECK(key ~ '^[a-z][a-z0-9_]{2,63}$'),
  description text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  rollout_percentage smallint NOT NULL DEFAULT 0 CHECK(rollout_percentage BETWEEN 0 AND 100),
  allowed_roles user_role[] NOT NULL DEFAULT '{}',
  city_id uuid REFERENCES cities(id),
  starts_at timestamptz,
  ends_at timestamptz,
  variant jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at>starts_at)
);
CREATE INDEX feature_flags_evaluation_idx ON feature_flags(enabled,city_id,starts_at,ends_at);
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
    GRANT SELECT,INSERT,UPDATE ON feature_flags TO flash_runtime;
    CREATE POLICY feature_flags_runtime_service ON feature_flags TO flash_runtime USING(true) WITH CHECK(true);
  END IF;
END $$;
GRANT SELECT ON feature_flags TO flash_rls_audit;

INSERT INTO feature_flags(public_id,key,description,enabled,rollout_percentage,allowed_roles,city_id,variant) VALUES
('FLAG-DELIVERY-BETA','delivery_beta','Flujos de comida y compras para la beta cerrada de Buenos Aires',true,100,ARRAY['customer','merchant','driver']::user_role[],'00000000-0000-4000-8000-000000000001','{"phase":"closed_beta"}'),
('FLAG-SHIPMENT-BETA','shipment_beta','Envíos urbanos dentro de la zona piloto',true,100,ARRAY['customer','driver']::user_role[],'00000000-0000-4000-8000-000000000001','{"phase":"closed_beta"}'),
('FLAG-PUBLIC-RIDES','public_rides','Movilidad pública sujeta a habilitación y safety',false,0,ARRAY['customer','driver']::user_role[],'00000000-0000-4000-8000-000000000001','{"blockedBy":"regulation_and_insurance"}')
ON CONFLICT(key) DO NOTHING;

COMMENT ON TABLE feature_flags IS 'Auditable release controls; false remains the safe default when evaluation fails.';
