REVOKE ALL ON FUNCTION app.branch_is_scheduled_open(uuid,timestamptz) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT EXECUTE ON FUNCTION app.branch_is_scheduled_open(uuid,timestamptz) TO flash_runtime;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT EXECUTE ON FUNCTION app.branch_is_scheduled_open(uuid,timestamptz) TO flash_rls_audit;
 END IF;
END $$;
