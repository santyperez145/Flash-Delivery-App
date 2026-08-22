CREATE TABLE ride_pickup_verifications(
  job_id uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  pin_hash text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK(failed_attempts BETWEEN 0 AND 5),
  locked_until timestamptz,
  verified_at timestamptz,
  verified_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ride_pickup_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY ride_pickup_verifications_participant ON ride_pickup_verifications
  USING(EXISTS(SELECT 1 FROM jobs j LEFT JOIN drivers d ON d.id=j.driver_id WHERE j.id=job_id AND (j.customer_id=app.current_user_id() OR d.user_id=app.current_user_id() OR app.has_role('admin'))))
  WITH CHECK(EXISTS(SELECT 1 FROM jobs j LEFT JOIN drivers d ON d.id=j.driver_id WHERE j.id=job_id AND (j.customer_id=app.current_user_id() OR d.user_id=app.current_user_id() OR app.has_role('admin'))));

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON ride_pickup_verifications TO flash_runtime;
  CREATE POLICY ride_pickup_verifications_runtime_service ON ride_pickup_verifications TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT(job_id,failed_attempts,locked_until,verified_at,verified_by,created_at,updated_at) ON ride_pickup_verifications TO flash_rls_audit;
 END IF;
END $$;

COMMENT ON COLUMN ride_pickup_verifications.pin_hash IS 'bcrypt digest only; plaintext PIN is deterministically derived for the owning passenger and never persisted.';
