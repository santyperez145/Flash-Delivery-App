CREATE TABLE service_message_attachments(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  message_id uuid NOT NULL REFERENCES service_messages(id) ON DELETE CASCADE,
  file_name text NOT NULL CHECK(length(file_name) BETWEEN 1 AND 160),
  mime_type text NOT NULL CHECK(mime_type IN('image/jpeg','image/png','application/pdf')),
  content_ciphertext text NOT NULL,
  content_sha256 char(64) NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 768000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX service_message_attachments_message_idx ON service_message_attachments(message_id);
ALTER TABLE service_message_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_message_attachments_participant ON service_message_attachments
 USING(EXISTS(SELECT 1 FROM service_messages sm JOIN jobs j ON j.id=sm.job_id LEFT JOIN drivers d ON d.id=j.driver_id LEFT JOIN merchants m ON m.id=j.merchant_id WHERE sm.id=message_id AND (j.customer_id=app.current_user_id() OR d.user_id=app.current_user_id() OR m.owner_id=app.current_user_id())))
 WITH CHECK(EXISTS(SELECT 1 FROM service_messages sm JOIN jobs j ON j.id=sm.job_id LEFT JOIN drivers d ON d.id=j.driver_id LEFT JOIN merchants m ON m.id=j.merchant_id WHERE sm.id=message_id AND sm.sender_id=app.current_user_id() AND (j.customer_id=app.current_user_id() OR d.user_id=app.current_user_id() OR m.owner_id=app.current_user_id())));

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT ON service_message_attachments TO flash_runtime;
  CREATE POLICY service_message_attachments_runtime_service ON service_message_attachments TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT(id,public_id,message_id,file_name,mime_type,size_bytes,created_at) ON service_message_attachments TO flash_rls_audit;
 END IF;
END $$;

COMMENT ON COLUMN service_message_attachments.content_ciphertext IS 'AES-256-GCM attachment bytes; excluded from auditor privileges and operational events.';
