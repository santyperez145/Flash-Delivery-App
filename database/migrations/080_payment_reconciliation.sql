CREATE TABLE payment_reconciliation_cases(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_id text NOT NULL UNIQUE,
 fingerprint text NOT NULL UNIQUE, provider text NOT NULL, case_type text NOT NULL CHECK(case_type IN('stale_intent','capture_mismatch','refund_mismatch','orphan_webhook','webhook_failure')),
 severity text NOT NULL CHECK(severity IN('low','medium','high','critical')), entity_type text NOT NULL CHECK(entity_type IN('payment_intent','refund','webhook_event')),
 entity_id uuid, external_reference text, summary text NOT NULL CHECK(length(summary) BETWEEN 5 AND 240), details jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'open' CHECK(status IN('open','resolved','ignored')), first_detected_at timestamptz NOT NULL DEFAULT now(), last_detected_at timestamptz NOT NULL DEFAULT now(),
 resolved_by uuid REFERENCES users(id), resolution_note text, resolved_at timestamptz,
 CHECK((status='open' AND resolved_at IS NULL AND resolved_by IS NULL) OR (status IN('resolved','ignored') AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND length(resolution_note)>=5))
);
CREATE INDEX payment_reconciliation_status_idx ON payment_reconciliation_cases(status,severity,last_detected_at DESC);
ALTER TABLE payment_reconciliation_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_reconciliation_staff ON payment_reconciliation_cases USING(app.has_role('support') OR app.has_role('admin')) WITH CHECK(app.has_role('support') OR app.has_role('admin'));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN GRANT SELECT,INSERT,UPDATE ON payment_reconciliation_cases TO flash_runtime; CREATE POLICY payment_reconciliation_runtime_service ON payment_reconciliation_cases TO flash_runtime USING(true) WITH CHECK(true); END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN GRANT SELECT(id,public_id,fingerprint,provider,case_type,severity,entity_type,entity_id,external_reference,summary,status,first_detected_at,last_detected_at,resolved_by,resolution_note,resolved_at) ON payment_reconciliation_cases TO flash_rls_audit; END IF;
END $$;
COMMENT ON COLUMN payment_reconciliation_cases.details IS 'Non-secret diagnostic facts only; provider payloads and payment tokens are intentionally excluded.';
