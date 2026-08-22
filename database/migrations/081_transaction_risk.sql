CREATE TABLE transaction_risk_assessments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_id text NOT NULL UNIQUE,
 customer_id uuid NOT NULL REFERENCES users(id), service text NOT NULL CHECK(service IN('food','ride','shipment')),
 amount_cents bigint NOT NULL CHECK(amount_cents>0), score smallint NOT NULL CHECK(score BETWEEN 0 AND 100),
 decision text NOT NULL CHECK(decision IN('allow','review','block')), rules jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(rules)='array'),
 request_id text, idempotency_key text NOT NULL, entity_public_id text, created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid REFERENCES users(id), review_status text CHECK(review_status IN('confirmed_fraud','false_positive','cleared')), review_note text, reviewed_at timestamptz,
 CHECK((review_status IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL) OR (review_status IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND length(review_note)>=5))
);
CREATE UNIQUE INDEX transaction_risk_idempotency_idx ON transaction_risk_assessments(customer_id,service,idempotency_key);
CREATE INDEX transaction_risk_customer_created_idx ON transaction_risk_assessments(customer_id,created_at DESC);
CREATE INDEX transaction_risk_decision_created_idx ON transaction_risk_assessments(decision,review_status,created_at DESC);
ALTER TABLE transaction_risk_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY transaction_risk_staff ON transaction_risk_assessments USING(app.has_role('support') OR app.has_role('admin')) WITH CHECK(app.has_role('support') OR app.has_role('admin'));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN GRANT SELECT,INSERT,UPDATE ON transaction_risk_assessments TO flash_runtime; CREATE POLICY transaction_risk_runtime_service ON transaction_risk_assessments TO flash_runtime USING(true) WITH CHECK(true); END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN GRANT SELECT(id,public_id,customer_id,service,amount_cents,score,decision,request_id,entity_public_id,created_at,reviewed_by,review_status,review_note,reviewed_at) ON transaction_risk_assessments TO flash_rls_audit; END IF;
END $$;
COMMENT ON COLUMN transaction_risk_assessments.rules IS 'Explainable internal risk signals; restricted from the audit-reader role to reduce rule-gaming.';
