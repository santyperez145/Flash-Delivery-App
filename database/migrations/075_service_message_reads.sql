CREATE TABLE service_message_reads(
  message_id uuid NOT NULL REFERENCES service_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(message_id,user_id)
);

CREATE INDEX service_message_reads_user_time_idx ON service_message_reads(user_id,read_at DESC);

ALTER TABLE service_message_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_message_reads_participant ON service_message_reads
  USING(EXISTS(
    SELECT 1 FROM service_messages sm JOIN jobs j ON j.id=sm.job_id
    LEFT JOIN drivers d ON d.id=j.driver_id LEFT JOIN merchants m ON m.id=j.merchant_id
    WHERE sm.id=message_id AND (j.customer_id=app.current_user_id() OR d.user_id=app.current_user_id() OR m.owner_id=app.current_user_id())
  ))
  WITH CHECK(user_id=app.current_user_id() AND EXISTS(
    SELECT 1 FROM service_messages sm JOIN jobs j ON j.id=sm.job_id
    LEFT JOIN drivers d ON d.id=j.driver_id LEFT JOIN merchants m ON m.id=j.merchant_id
    WHERE sm.id=message_id AND (j.customer_id=app.current_user_id() OR d.user_id=app.current_user_id() OR m.owner_id=app.current_user_id())
  ));

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE ON service_message_reads TO flash_runtime;
  CREATE POLICY service_message_reads_runtime_service ON service_message_reads TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT(message_id,user_id,read_at) ON service_message_reads TO flash_rls_audit;
 END IF;
END $$;

COMMENT ON TABLE service_message_reads IS 'Per-participant durable service chat read receipts; no message content is duplicated.';
