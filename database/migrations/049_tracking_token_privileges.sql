DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  REVOKE SELECT ON ride_tracking_links FROM flash_rls_audit;
  GRANT SELECT(id,public_id,job_id,created_by,expires_at,revoked_at,last_viewed_at,view_count,created_at) ON ride_tracking_links TO flash_rls_audit;
 END IF;
END $$;

COMMENT ON COLUMN ride_tracking_links.token_hash IS 'Runtime-only SHA-256 bearer digest; excluded from audit-role column privileges.';
