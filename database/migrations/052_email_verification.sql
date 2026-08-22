UPDATE users SET email_verified_at=COALESCE(email_verified_at,created_at);

CREATE TABLE email_verification_challenges(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  failed_attempts smallint NOT NULL DEFAULT 0 CHECK(failed_attempts BETWEEN 0 AND 5),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(expires_at > created_at)
);
CREATE UNIQUE INDEX email_verification_active_user_idx ON email_verification_challenges(user_id) WHERE consumed_at IS NULL;
CREATE INDEX email_verification_lookup_idx ON email_verification_challenges(user_id,expires_at) WHERE consumed_at IS NULL;

ALTER TABLE email_verification_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_verification_owner ON email_verification_challenges USING(user_id=app.current_user_id());
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON email_verification_challenges TO flash_runtime;
  CREATE POLICY email_verification_runtime_service ON email_verification_challenges TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT(id,user_id,expires_at,failed_attempts,consumed_at,created_at) ON email_verification_challenges TO flash_rls_audit;
 END IF;
END $$;

COMMENT ON COLUMN email_verification_challenges.code_hash IS 'Bcrypt OTP hash; runtime-only column privilege.';
