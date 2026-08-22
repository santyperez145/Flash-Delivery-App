CREATE TABLE merchant_payment_oauth_states(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash text NOT NULL UNIQUE,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(expires_at > created_at)
);
CREATE INDEX merchant_payment_oauth_active_idx ON merchant_payment_oauth_states(user_id,expires_at) WHERE consumed_at IS NULL;

CREATE TABLE merchant_payment_connections(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK(provider IN ('mercadopago')),
  external_account_id text NOT NULL,
  access_token_ciphertext text NOT NULL,
  refresh_token_ciphertext text,
  token_expires_at timestamptz,
  scope text,
  live_mode boolean NOT NULL DEFAULT false,
  connected_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(merchant_id,provider),
  UNIQUE(provider,external_account_id)
);

ALTER TABLE merchant_payment_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_payment_connections ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON merchant_payment_oauth_states,merchant_payment_connections TO flash_runtime;
  CREATE POLICY merchant_payment_oauth_runtime ON merchant_payment_oauth_states TO flash_runtime USING(true) WITH CHECK(true);
  CREATE POLICY merchant_payment_connections_runtime ON merchant_payment_connections TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT(id,merchant_id,provider,external_account_id,token_expires_at,scope,live_mode,connected_at,revoked_at,updated_at) ON merchant_payment_connections TO flash_rls_audit;
 END IF;
END $$;
COMMENT ON COLUMN merchant_payment_connections.access_token_ciphertext IS 'AES-256-GCM envelope; runtime-only privilege.';
COMMENT ON COLUMN merchant_payment_connections.refresh_token_ciphertext IS 'AES-256-GCM envelope; runtime-only privilege.';
