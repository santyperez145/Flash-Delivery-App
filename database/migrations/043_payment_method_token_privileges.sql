DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  REVOKE SELECT ON payment_methods FROM flash_rls_audit;
  GRANT SELECT(id,user_id,provider,kind,brand,last4,expiry_month,expiry_year,is_default,revoked_at,created_at) ON payment_methods TO flash_rls_audit;
 END IF;
END $$;

COMMENT ON COLUMN payment_methods.provider_payment_method_id IS
  'PSP token/identifier. Runtime-only; never expose through API state or audit-role column privileges.';
