CREATE TABLE driver_compliance(
  driver_id uuid PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','in_review','approved','rejected','suspended')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users(id),
  rejection_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE driver_documents(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK(document_type IN('identity','driver_license','vehicle_registration','insurance','background_check')),
  mime_type text NOT NULL CHECK(mime_type IN('image/jpeg','image/png','application/pdf')),
  content_ciphertext text NOT NULL,
  content_sha256 char(64) NOT NULL,
  size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 750000),
  expires_at date,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected','expired','superseded')),
  rejection_reason text,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_documents_review_idx ON driver_documents(status,created_at) WHERE status='pending';
CREATE INDEX driver_documents_expiry_idx ON driver_documents(expires_at) WHERE status='approved';
CREATE UNIQUE INDEX driver_documents_current_type_idx ON driver_documents(driver_id,document_type) WHERE status IN('pending','approved');

INSERT INTO driver_compliance(driver_id,status,submitted_at,reviewed_at,rejection_reason)
SELECT id,'approved',created_at,now(),'Migración legacy: requiere recertificación en próximo vencimiento' FROM drivers;

ALTER TABLE driver_compliance ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_compliance_participant ON driver_compliance USING(EXISTS(SELECT 1 FROM drivers d WHERE d.id=driver_id AND d.user_id=app.current_user_id()) OR app.has_role('admin') OR app.has_role('support'));
CREATE POLICY driver_documents_participant ON driver_documents USING(EXISTS(SELECT 1 FROM drivers d WHERE d.id=driver_id AND d.user_id=app.current_user_id()) OR app.has_role('admin') OR app.has_role('support')) WITH CHECK(EXISTS(SELECT 1 FROM drivers d WHERE d.id=driver_id AND d.user_id=app.current_user_id()) OR app.has_role('admin'));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON driver_compliance,driver_documents TO flash_runtime;
  CREATE POLICY driver_compliance_runtime_service ON driver_compliance TO flash_runtime USING(true) WITH CHECK(true);
  CREATE POLICY driver_documents_runtime_service ON driver_documents TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT ON driver_compliance TO flash_rls_audit;
  GRANT SELECT(id,public_id,driver_id,document_type,mime_type,content_sha256,size_bytes,expires_at,status,rejection_reason,reviewed_by,reviewed_at,created_at) ON driver_documents TO flash_rls_audit;
 END IF;
END $$;
COMMENT ON COLUMN driver_documents.content_ciphertext IS 'AES-256-GCM encrypted document; runtime-only column privilege.';
