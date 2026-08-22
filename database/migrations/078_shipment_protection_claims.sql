CREATE TABLE shipment_protection_claims(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_id text NOT NULL UNIQUE,
 job_id uuid NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
 customer_id uuid NOT NULL REFERENCES users(id), claim_type text NOT NULL CHECK(claim_type IN('lost','damaged','stolen')),
 description text NOT NULL CHECK(length(description) BETWEEN 10 AND 1000), requested_amount_cents bigint NOT NULL CHECK(requested_amount_cents>0),
 eligible_amount_cents bigint NOT NULL CHECK(eligible_amount_cents>=0), approved_amount_cents bigint CHECK(approved_amount_cents>=0),
 status text NOT NULL DEFAULT 'submitted' CHECK(status IN('submitted','under_review','approved','rejected','settlement_pending','settled')),
 resolution_note text, reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shipment_protection_claims_customer_created_idx ON shipment_protection_claims(customer_id,created_at DESC);
ALTER TABLE shipment_protection_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY shipment_claims_customer ON shipment_protection_claims USING(customer_id=app.current_user_id() OR app.has_role('support') OR app.has_role('admin')) WITH CHECK(customer_id=app.current_user_id() OR app.has_role('support') OR app.has_role('admin'));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN GRANT SELECT,INSERT,UPDATE ON shipment_protection_claims TO flash_runtime; CREATE POLICY shipment_claims_runtime_service ON shipment_protection_claims TO flash_runtime USING(true) WITH CHECK(true); END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN GRANT SELECT(id,public_id,job_id,customer_id,claim_type,requested_amount_cents,eligible_amount_cents,approved_amount_cents,status,reviewed_by,reviewed_at,created_at,updated_at) ON shipment_protection_claims TO flash_rls_audit; END IF;
END $$;
COMMENT ON COLUMN shipment_protection_claims.description IS 'Customer claim narrative; excluded from restricted auditor column privileges.';
