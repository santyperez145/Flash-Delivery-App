CREATE TABLE password_recovery_tokens(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  requester_fingerprint_hash char(64),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(expires_at > created_at)
);
CREATE UNIQUE INDEX password_recovery_active_user_idx ON password_recovery_tokens(user_id) WHERE consumed_at IS NULL;
CREATE INDEX password_recovery_lookup_idx ON password_recovery_tokens(token_hash,expires_at) WHERE consumed_at IS NULL;

ALTER TABLE password_recovery_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY password_recovery_owner ON password_recovery_tokens
  USING(user_id=app.current_user_id() OR app.has_role('admin'));

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON password_recovery_tokens TO flash_runtime;
  CREATE POLICY password_recovery_runtime_service ON password_recovery_tokens TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT(id,user_id,requester_fingerprint_hash,expires_at,consumed_at,created_at) ON password_recovery_tokens TO flash_rls_audit;
 END IF;
END $$;

COMMENT ON COLUMN password_recovery_tokens.token_hash IS 'Runtime-only SHA-256 digest; plaintext token is delivered once and never persisted.';
