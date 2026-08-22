CREATE TABLE mercadopago_webhook_inbox(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id text NOT NULL UNIQUE,
  resource_id text NOT NULL,
  request_id text NOT NULL,
  topic text NOT NULL CHECK(topic IN ('order','orders','payment','mp-connect','topic_claims_integration_wh','topic_chargebacks_wh','stop_delivery_op_wh')),
  action text,
  live_mode boolean NOT NULL DEFAULT false,
  occurred_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','processed','failed','dead_letter')),
  attempts smallint NOT NULL DEFAULT 0,
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX mercadopago_webhook_queue_idx ON mercadopago_webhook_inbox(received_at) WHERE status IN ('queued','failed');
ALTER TABLE mercadopago_webhook_inbox ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
 GRANT SELECT,INSERT,UPDATE ON mercadopago_webhook_inbox TO flash_runtime;
 CREATE POLICY mercadopago_webhook_runtime ON mercadopago_webhook_inbox TO flash_runtime USING(true) WITH CHECK(true);
END IF; IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
 GRANT SELECT(id,notification_id,resource_id,request_id,topic,action,live_mode,occurred_at,status,attempts,last_error,received_at,processed_at) ON mercadopago_webhook_inbox TO flash_rls_audit;
END IF; END $$;
COMMENT ON TABLE mercadopago_webhook_inbox IS 'Signed, deduplicated ingress; provider resources are fetched asynchronously before domain mutation.';
