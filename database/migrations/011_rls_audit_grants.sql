DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
    GRANT SELECT ON merchants, drivers TO flash_rls_audit;
  END IF;
END $$;

