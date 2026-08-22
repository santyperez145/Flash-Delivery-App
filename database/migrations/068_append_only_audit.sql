CREATE OR REPLACE FUNCTION app.enforce_audit_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user='flash_app' AND current_setting('app.audit_maintenance',true)='on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE='42501';
END;
$$;

CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION app.enforce_audit_events_append_only();

REVOKE UPDATE,DELETE,TRUNCATE ON audit_events FROM PUBLIC;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  REVOKE UPDATE,DELETE,TRUNCATE ON audit_events FROM flash_runtime;
  GRANT SELECT,INSERT ON audit_events TO flash_runtime;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON audit_events FROM flash_rls_audit;
  GRANT SELECT ON audit_events TO flash_rls_audit;
 END IF;
END $$;

REVOKE ALL ON FUNCTION app.enforce_audit_events_append_only() FROM PUBLIC;
