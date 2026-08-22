DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
    REVOKE SELECT ON users FROM flash_rls_audit;
    GRANT SELECT(
      id,public_id,name,email,status,created_at,updated_at,
      failed_login_attempts,login_locked_until,last_login_at
    ) ON users TO flash_rls_audit;
  END IF;
END $$;
