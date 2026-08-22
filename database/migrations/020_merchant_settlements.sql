ALTER TABLE merchants ADD COLUMN commission_bps integer NOT NULL DEFAULT 1800 CHECK(commission_bps BETWEEN 0 AND 5000);

ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_kind_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_kind_check CHECK(kind IN('sandbox_topup','driver_earning','payment','refund','adjustment','merchant_settlement','payout_reserve','payout_release'));

ALTER TABLE payouts ADD COLUMN public_id text;
UPDATE payouts SET public_id='PAY-'||upper(substr(replace(id::text,'-',''),1,8)) WHERE public_id IS NULL;
ALTER TABLE payouts ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE payouts ADD CONSTRAINT payouts_public_id_unique UNIQUE(public_id);
ALTER TABLE payouts ADD COLUMN idempotency_key text;
ALTER TABLE payouts ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX payouts_idempotency_unique ON payouts(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY payouts_payee_owner ON payouts USING(
  app.has_role('admin') OR (payee_type='merchant' AND payee_id IN(SELECT id FROM merchants WHERE owner_id=app.current_user_id()))
);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  CREATE POLICY payouts_runtime_service ON payouts TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT ON payouts,merchants TO flash_rls_audit;
 END IF;
END $$;
