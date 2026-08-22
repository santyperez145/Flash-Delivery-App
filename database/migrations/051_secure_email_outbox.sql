ALTER TABLE notifications ADD COLUMN sensitive_payload_ciphertext text;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  REVOKE SELECT ON notifications FROM flash_rls_audit;
  GRANT SELECT(id,public_id,user_id,channel,template,payload,deduplication_key,status,scheduled_at,sent_at,read_at,created_at,attempts,locked_at,locked_by,last_error,provider_message_id) ON notifications TO flash_rls_audit;
 END IF;
END $$;

COMMENT ON COLUMN notifications.sensitive_payload_ciphertext IS 'AES-256-GCM worker-only payload; never returned by inbox APIs or audit-role grants.';
