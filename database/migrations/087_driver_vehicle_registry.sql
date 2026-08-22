ALTER TABLE vehicles
  ADD COLUMN public_id text,
  ADD COLUMN service_modes job_kind[] NOT NULL DEFAULT ARRAY['delivery']::job_kind[],
  ADD COLUMN status text NOT NULL DEFAULT 'pending',
  ADD COLUMN rejection_reason text,
  ADD COLUMN reviewed_by uuid REFERENCES users(id),
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN retired_at timestamptz,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE vehicles
SET public_id = 'VEH-' || upper(substr(replace(id::text, '-', ''), 1, 12)),
    status = 'approved',
    reviewed_at = now(),
    service_modes = CASE
      WHEN lower(kind) IN ('car', 'auto', 'sedan', 'suv', 'van') THEN ARRAY['delivery','ride']::job_kind[]
      ELSE ARRAY['delivery']::job_kind[]
    END;

INSERT INTO vehicles(driver_id, kind, model, plate, color, seats, active, public_id,
  service_modes, status, reviewed_at)
SELECT d.id,
  CASE WHEN 'ride'::job_kind = ANY(d.service_modes) THEN 'car' ELSE 'motorcycle' END,
  COALESCE(NULLIF(d.metadata->>'vehicle',''), 'Vehículo por verificar'),
  upper(COALESCE(NULLIF(d.metadata->>'plate',''), 'LEGACY-' || substr(replace(d.id::text,'-',''),1,8))),
  NULL,
  CASE WHEN 'ride'::job_kind = ANY(d.service_modes) THEN 4 ELSE 1 END,
  true,
  'VEH-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  d.service_modes,
  'approved',
  now()
FROM drivers d
WHERE NOT EXISTS(SELECT 1 FROM vehicles v WHERE v.driver_id=d.id);

ALTER TABLE vehicles ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_public_id_unique UNIQUE(public_id),
  ADD CONSTRAINT vehicles_kind_check CHECK(kind IN('bicycle','motorcycle','car','van')),
  ADD CONSTRAINT vehicles_status_check CHECK(status IN('pending','approved','rejected')),
  ADD CONSTRAINT vehicles_plate_normalized_check CHECK(plate=upper(btrim(plate))),
  ADD CONSTRAINT vehicles_service_modes_check CHECK(cardinality(service_modes)>0),
  ADD CONSTRAINT vehicles_retired_check CHECK(retired_at IS NULL OR NOT active),
  ADD CONSTRAINT vehicles_ride_capacity_check CHECK(NOT ('ride'::job_kind=ANY(service_modes)) OR (kind IN('car','van') AND seats BETWEEN 1 AND 8)),
  ADD CONSTRAINT vehicles_review_state_check CHECK(
    (status='pending' AND reviewed_at IS NULL AND reviewed_by IS NULL AND rejection_reason IS NULL)
    OR (status='approved' AND reviewed_at IS NOT NULL AND rejection_reason IS NULL)
    OR (status='rejected' AND reviewed_at IS NOT NULL AND rejection_reason IS NOT NULL)
  );

CREATE UNIQUE INDEX vehicles_one_active_per_driver_idx ON vehicles(driver_id) WHERE active;
CREATE INDEX vehicles_review_queue_idx ON vehicles(status,created_at) WHERE status='pending';
CREATE INDEX vehicles_driver_registry_idx ON vehicles(driver_id,created_at DESC);

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_participant ON vehicles
  USING(driver_id IN(SELECT id FROM drivers WHERE user_id=app.current_user_id()) OR app.has_role('admin') OR app.has_role('support'))
  WITH CHECK(driver_id IN(SELECT id FROM drivers WHERE user_id=app.current_user_id()) OR app.has_role('admin'));

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON vehicles TO flash_runtime;
    CREATE POLICY vehicles_runtime_service ON vehicles TO flash_runtime USING(true) WITH CHECK(true);
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
    GRANT SELECT(id,public_id,driver_id,kind,model,plate,color,seats,active,service_modes,status,rejection_reason,reviewed_by,reviewed_at,retired_at,created_at,updated_at) ON vehicles TO flash_rls_audit;
  END IF;
END $$;

COMMENT ON TABLE vehicles IS 'Driver-owned vehicle registry with independent operations approval and one active vehicle.';
