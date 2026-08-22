CREATE TABLE shipment_claim_evidence(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_id text NOT NULL UNIQUE,
 claim_id uuid NOT NULL REFERENCES shipment_protection_claims(id) ON DELETE CASCADE,
 uploaded_by uuid NOT NULL REFERENCES users(id), file_name text NOT NULL CHECK(length(file_name) BETWEEN 1 AND 160),
 mime_type text NOT NULL CHECK(mime_type IN('image/jpeg','image/png','application/pdf')),
 content_ciphertext text NOT NULL, content_sha256 char(64) NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
 size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 768000), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shipment_claim_evidence_claim_created_idx ON shipment_claim_evidence(claim_id,created_at);
ALTER TABLE shipment_claim_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY shipment_claim_evidence_participant ON shipment_claim_evidence USING(EXISTS(SELECT 1 FROM shipment_protection_claims c WHERE c.id=claim_id AND (c.customer_id=app.current_user_id() OR app.has_role('support') OR app.has_role('admin')))) WITH CHECK(uploaded_by=app.current_user_id() AND EXISTS(SELECT 1 FROM shipment_protection_claims c WHERE c.id=claim_id AND (c.customer_id=app.current_user_id() OR app.has_role('support') OR app.has_role('admin'))));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN GRANT SELECT,INSERT ON shipment_claim_evidence TO flash_runtime; CREATE POLICY shipment_claim_evidence_runtime_service ON shipment_claim_evidence TO flash_runtime USING(true) WITH CHECK(true); END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN GRANT SELECT(id,public_id,claim_id,uploaded_by,file_name,mime_type,size_bytes,created_at) ON shipment_claim_evidence TO flash_rls_audit; END IF;
END $$;
COMMENT ON COLUMN shipment_claim_evidence.content_ciphertext IS 'AES-256-GCM claim evidence; unavailable to restricted audit role.';
