CREATE TABLE user_mfa(
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  method text NOT NULL DEFAULT 'totp' CHECK(method='totp'),
  secret_ciphertext text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  recovery_code_hashes text[] NOT NULL DEFAULT '{}',
  failed_attempts integer NOT NULL DEFAULT 0 CHECK(failed_attempts>=0),
  locked_until timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_mfa ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_mfa_owner ON user_mfa USING(user_id=app.current_user_id());
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
    CREATE POLICY user_mfa_runtime_service ON user_mfa TO flash_runtime USING(true) WITH CHECK(true);
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
    GRANT SELECT(user_id,method,enabled,failed_attempts,locked_until,confirmed_at,created_at,updated_at) ON user_mfa TO flash_rls_audit;
  END IF;
END $$;
