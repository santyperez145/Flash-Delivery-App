DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  REVOKE SELECT ON user_devices FROM flash_rls_audit;
  GRANT SELECT(id,public_id,user_id,platform,app_version,last_seen_at,revoked_at,created_at,invalidated_at,invalid_reason) ON user_devices TO flash_rls_audit;
 END IF;
END $$;

COMMENT ON COLUMN user_devices.invalidated_at IS 'Permanent provider invalidation timestamp exposed to restricted audit without token material.';
