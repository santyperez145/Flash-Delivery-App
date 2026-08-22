ALTER TABLE merchant_payment_connections
  ADD COLUMN refresh_started_at timestamptz,
  ADD COLUMN refresh_last_at timestamptz,
  ADD COLUMN refresh_failures integer NOT NULL DEFAULT 0 CHECK(refresh_failures BETWEEN 0 AND 20),
  ADD COLUMN refresh_last_error text;
CREATE INDEX merchant_payment_connections_refresh_due_idx ON merchant_payment_connections(token_expires_at) WHERE revoked_at IS NULL AND refresh_token_ciphertext IS NOT NULL;
