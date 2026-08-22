CREATE TABLE ride_trusted_contacts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK(char_length(name) BETWEEN 2 AND 80),
  relationship text NOT NULL CHECK(relationship IN('family','friend','partner','coworker','other')),
  phone_ciphertext text NOT NULL,
  phone_hash char(64) NOT NULL,
  phone_last4 char(4) NOT NULL CHECK(phone_last4 ~ '^[0-9]{4}$'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,phone_hash)
);

CREATE INDEX ride_trusted_contacts_user_idx ON ride_trusted_contacts(user_id,active,created_at);

ALTER TABLE ride_trusted_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY ride_trusted_contacts_owner ON ride_trusted_contacts
  USING(user_id=app.current_user_id() OR app.has_role('admin'))
  WITH CHECK(user_id=app.current_user_id() OR app.has_role('admin'));

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON ride_trusted_contacts TO flash_runtime;
  CREATE POLICY ride_trusted_contacts_runtime_service ON ride_trusted_contacts TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT(id,user_id,relationship,phone_last4,active,created_at,updated_at) ON ride_trusted_contacts TO flash_rls_audit;
 END IF;
END $$;

COMMENT ON COLUMN ride_trusted_contacts.phone_ciphertext IS 'AES-256-GCM envelope. Never include in audit payloads or read-only audit grants.';
COMMENT ON COLUMN ride_trusted_contacts.phone_hash IS 'Keyed HMAC used only for per-user deduplication; excluded from audit grants.';
