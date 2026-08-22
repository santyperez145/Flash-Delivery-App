DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
    REVOKE SELECT ON vehicles FROM flash_rls_audit;
    GRANT SELECT(id,public_id,driver_id,kind,seats,active,service_modes,status,rejection_reason,reviewed_by,reviewed_at,retired_at,created_at,updated_at) ON vehicles TO flash_rls_audit;
  END IF;
END $$;

COMMENT ON COLUMN vehicles.plate IS 'Vehicle identifier visible to participants and operations; excluded from audit-role column grants.';
