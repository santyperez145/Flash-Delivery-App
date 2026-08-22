ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_kind_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_kind_check CHECK(kind IN('sandbox_topup','driver_earning','payment','refund','adjustment','merchant_settlement','payout_reserve','payout_release','tip','tip_adjustment'));

CREATE TABLE service_tip_adjustments(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  tip_id uuid NOT NULL REFERENCES service_tips(id),
  amount_cents bigint NOT NULL CHECK(amount_cents>0),
  reason text NOT NULL CHECK(length(reason) BETWEEN 5 AND 1000),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),
  requested_by uuid NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES users(id),
  review_note text,
  reviewed_at timestamptz,
  ledger_transaction_id uuid UNIQUE REFERENCES ledger_transactions(id),
  idempotency_key text NOT NULL UNIQUE,
  CHECK(requested_by IS DISTINCT FROM reviewed_by),
  CHECK(
    (status='pending' AND reviewed_by IS NULL AND review_note IS NULL AND reviewed_at IS NULL AND ledger_transaction_id IS NULL)
    OR (status='rejected' AND reviewed_by IS NOT NULL AND length(review_note)>=5 AND reviewed_at IS NOT NULL AND ledger_transaction_id IS NULL)
    OR (status='approved' AND reviewed_by IS NOT NULL AND length(review_note)>=5 AND reviewed_at IS NOT NULL AND ledger_transaction_id IS NOT NULL)
  )
);
CREATE INDEX service_tip_adjustments_queue_idx ON service_tip_adjustments(status,requested_at DESC);
CREATE INDEX service_tip_adjustments_tip_idx ON service_tip_adjustments(tip_id,requested_at DESC);

ALTER TABLE service_tip_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_tip_adjustments_staff ON service_tip_adjustments USING(app.has_role('admin')) WITH CHECK(app.has_role('admin'));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE ON service_tip_adjustments TO flash_runtime;
  CREATE POLICY service_tip_adjustments_runtime_service ON service_tip_adjustments TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT(id,public_id,tip_id,amount_cents,reason,status,requested_by,requested_at,reviewed_by,review_note,reviewed_at,ledger_transaction_id) ON service_tip_adjustments TO flash_rls_audit;
 END IF;
END $$;

COMMENT ON TABLE service_tip_adjustments IS 'Four-eyes operational correction of a captured service tip; approval posts a balanced driver-to-customer ledger transfer.';
