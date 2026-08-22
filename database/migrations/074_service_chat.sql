CREATE TABLE service_messages(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id),
  body_ciphertext text NOT NULL,
  body_sha256 char(64) NOT NULL CHECK(body_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX service_messages_job_created_idx ON service_messages(job_id,created_at,id);

ALTER TABLE service_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_messages_participant ON service_messages
  USING(EXISTS(
    SELECT 1 FROM jobs j
    LEFT JOIN drivers d ON d.id=j.driver_id
    LEFT JOIN merchants m ON m.id=j.merchant_id
    WHERE j.id=job_id AND (j.customer_id=app.current_user_id() OR d.user_id=app.current_user_id() OR m.owner_id=app.current_user_id())
  ))
  WITH CHECK(sender_id=app.current_user_id() AND EXISTS(
    SELECT 1 FROM jobs j
    LEFT JOIN drivers d ON d.id=j.driver_id
    LEFT JOIN merchants m ON m.id=j.merchant_id
    WHERE j.id=job_id AND (j.customer_id=app.current_user_id() OR d.user_id=app.current_user_id() OR m.owner_id=app.current_user_id())
  ));

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT ON service_messages TO flash_runtime;
  CREATE POLICY service_messages_runtime_service ON service_messages TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT(id,public_id,job_id,sender_id,created_at) ON service_messages TO flash_rls_audit;
 END IF;
END $$;

COMMENT ON COLUMN service_messages.body_ciphertext IS 'AES-256-GCM private service message. Excluded from audit-role privileges, audit payloads and realtime events.';
COMMENT ON COLUMN service_messages.body_sha256 IS 'Integrity digest. Excluded from audit-role privileges.';
