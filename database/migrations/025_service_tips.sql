ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_kind_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_kind_check CHECK(kind IN('sandbox_topup','driver_earning','payment','refund','adjustment','merchant_settlement','payout_reserve','payout_release','tip'));

CREATE TABLE service_tips(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  job_id uuid NOT NULL UNIQUE REFERENCES jobs(id),
  customer_id uuid NOT NULL REFERENCES users(id),
  driver_id uuid NOT NULL REFERENCES drivers(id),
  amount_cents bigint NOT NULL CHECK(amount_cents>=10000 AND amount_cents<=10000000),
  currency char(3) NOT NULL DEFAULT 'ARS',
  idempotency_key text NOT NULL UNIQUE,
  ledger_transaction_id uuid NOT NULL UNIQUE REFERENCES ledger_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_tips_customer_created_idx ON service_tips(customer_id,created_at DESC);
CREATE INDEX service_tips_driver_created_idx ON service_tips(driver_id,created_at DESC);

ALTER TABLE service_tips ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_tips_participant ON service_tips USING(
  app.has_role('admin') OR customer_id=app.current_user_id() OR driver_id IN(SELECT id FROM drivers WHERE user_id=app.current_user_id())
);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  CREATE POLICY service_tips_runtime_service ON service_tips TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT ON service_tips TO flash_rls_audit;
 END IF;
END $$;
