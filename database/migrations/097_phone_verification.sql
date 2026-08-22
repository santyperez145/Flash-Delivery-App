ALTER TABLE users ADD COLUMN phone_verified_at timestamptz;

CREATE UNIQUE INDEX users_verified_phone_unique ON users(phone) WHERE phone_verified_at IS NOT NULL AND phone IS NOT NULL;

CREATE TABLE phone_verification_challenges(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone text NOT NULL CHECK(phone ~ '^\+[1-9][0-9]{7,14}$'),
  provider text NOT NULL CHECK(provider IN ('sandbox','twilio')),
  provider_reference text NOT NULL,
  code_hash text,
  expires_at timestamptz NOT NULL,
  failed_attempts smallint NOT NULL DEFAULT 0 CHECK(failed_attempts BETWEEN 0 AND 5),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(expires_at > created_at),
  CHECK((provider='sandbox' AND code_hash IS NOT NULL) OR (provider='twilio' AND code_hash IS NULL))
);
CREATE UNIQUE INDEX phone_verification_active_user_idx ON phone_verification_challenges(user_id) WHERE consumed_at IS NULL;
CREATE INDEX phone_verification_lookup_idx ON phone_verification_challenges(user_id,expires_at) WHERE consumed_at IS NULL;
ALTER TABLE phone_verification_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY phone_verification_owner ON phone_verification_challenges USING(user_id=app.current_user_id());
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON phone_verification_challenges TO flash_runtime;
  GRANT UPDATE(phone_verified_at) ON users TO flash_runtime;
  CREATE POLICY phone_verification_runtime_service ON phone_verification_challenges TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT(id,user_id,phone,provider,provider_reference,expires_at,failed_attempts,consumed_at,created_at) ON phone_verification_challenges TO flash_rls_audit;
 END IF;
END $$;
COMMENT ON COLUMN phone_verification_challenges.code_hash IS 'Sandbox-only bcrypt OTP hash; production delegates secrets to Twilio Verify.';
