DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  REVOKE SELECT(signer_name) ON shipment_delivery_evidence FROM flash_rls_audit;
 END IF;
END $$;

COMMENT ON COLUMN shipment_delivery_evidence.signer_name IS 'Recipient-declared identity; runtime participant access only, excluded from restricted audit role.';
