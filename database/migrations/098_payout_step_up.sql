CREATE TABLE payout_step_up_authorizations(
  jti uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  amount_cents bigint NOT NULL CHECK(amount_cents > 0),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(expires_at > created_at)
);
CREATE INDEX payout_step_up_active_idx ON payout_step_up_authorizations(user_id,expires_at) WHERE consumed_at IS NULL;
ALTER TABLE payout_step_up_authorizations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE ON payout_step_up_authorizations TO flash_runtime;
  CREATE POLICY payout_step_up_runtime_service ON payout_step_up_authorizations TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT(jti,user_id,merchant_id,amount_cents,expires_at,consumed_at,created_at) ON payout_step_up_authorizations TO flash_rls_audit;
 END IF;
END $$;
COMMENT ON TABLE payout_step_up_authorizations IS 'One-time server-side authorization bound to payout actor, merchant and amount.';
