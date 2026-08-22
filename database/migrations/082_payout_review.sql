ALTER TABLE payouts ADD COLUMN requested_by uuid REFERENCES users(id),ADD COLUMN reviewed_by uuid REFERENCES users(id),ADD COLUMN review_decision text CHECK(review_decision IN('approved','rejected')),ADD COLUMN review_note text,ADD COLUMN reviewed_at timestamptz;
UPDATE payouts p SET requested_by=m.owner_id FROM merchants m WHERE p.payee_type='merchant' AND p.payee_id=m.id AND p.requested_by IS NULL;
CREATE INDEX payouts_review_queue_idx ON payouts(status,created_at) WHERE status='pending';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN REVOKE SELECT ON payouts FROM flash_rls_audit;GRANT SELECT(id,public_id,payee_type,payee_id,provider,provider_payout_id,amount_cents,currency,status,period_start,period_end,created_at,paid_at,requested_by,reviewed_by,review_decision,review_note,reviewed_at) ON payouts TO flash_rls_audit; END IF;
END $$;
COMMENT ON COLUMN payouts.review_decision IS 'Independent operations review before provider submission; rejected payouts release the reserved ledger balance.';
