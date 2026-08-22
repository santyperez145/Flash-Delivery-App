ALTER TABLE refresh_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON refresh_sessions FROM PUBLIC;

CREATE POLICY refresh_sessions_owner ON refresh_sessions
  USING(user_id=app.current_user_id())
  WITH CHECK(user_id=app.current_user_id());

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
    CREATE POLICY refresh_sessions_runtime_service ON refresh_sessions TO flash_runtime USING(true) WITH CHECK(true);
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
    GRANT SELECT(id,user_id,device_name,expires_at,revoked_at,created_at) ON refresh_sessions TO flash_rls_audit;
  END IF;
END $$;
