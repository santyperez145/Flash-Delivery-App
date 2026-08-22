ALTER FUNCTION app.chain_audit_event() SECURITY DEFINER;
ALTER FUNCTION app.chain_audit_event() SET search_path=pg_catalog,public,app;

ALTER FUNCTION app.audit_chain_invalid_count() SECURITY DEFINER;
ALTER FUNCTION app.audit_chain_invalid_count() SET search_path=pg_catalog,public,app;
