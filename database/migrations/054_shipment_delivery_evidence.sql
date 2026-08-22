CREATE TABLE shipment_delivery_evidence(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id),
  evidence_type text NOT NULL CHECK(evidence_type IN('photo','signature')),
  mime_type text NOT NULL CHECK(mime_type IN('image/jpeg','image/png','image/webp')),
  content_ciphertext text NOT NULL,
  content_sha256 char(64) NOT NULL,
  size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 1500000),
  captured_location geography(Point,4326),
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shipment_delivery_evidence_job_idx ON shipment_delivery_evidence(job_id,created_at);
CREATE UNIQUE INDEX shipment_delivery_evidence_type_once_idx ON shipment_delivery_evidence(job_id,evidence_type);

ALTER TABLE shipment_delivery_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY shipment_delivery_evidence_participants ON shipment_delivery_evidence USING(
  EXISTS(SELECT 1 FROM jobs j LEFT JOIN drivers d ON d.id=j.driver_id WHERE j.id=job_id AND (j.customer_id=app.current_user_id() OR d.user_id=app.current_user_id() OR app.has_role('admin') OR app.has_role('support')))
);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON shipment_delivery_evidence TO flash_runtime;
  CREATE POLICY shipment_delivery_evidence_runtime_service ON shipment_delivery_evidence TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT(id,public_id,job_id,created_by,evidence_type,mime_type,content_sha256,size_bytes,captured_location,captured_at,created_at) ON shipment_delivery_evidence TO flash_rls_audit;
 END IF;
END $$;
COMMENT ON COLUMN shipment_delivery_evidence.content_ciphertext IS 'AES-256-GCM encrypted evidence; runtime-only column privilege.';
