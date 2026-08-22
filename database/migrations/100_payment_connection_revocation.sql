ALTER TABLE merchant_payment_connections ALTER COLUMN access_token_ciphertext DROP NOT NULL;
ALTER TABLE merchant_payment_connections ADD CONSTRAINT merchant_payment_connection_secret_state CHECK(
  (revoked_at IS NULL AND access_token_ciphertext IS NOT NULL) OR
  (revoked_at IS NOT NULL AND access_token_ciphertext IS NULL AND refresh_token_ciphertext IS NULL)
);
COMMENT ON CONSTRAINT merchant_payment_connection_secret_state ON merchant_payment_connections IS 'Revoked connections retain metadata but no provider bearer credentials.';
