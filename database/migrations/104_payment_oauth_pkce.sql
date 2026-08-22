ALTER TABLE merchant_payment_oauth_states ADD COLUMN code_verifier_ciphertext text;
COMMENT ON COLUMN merchant_payment_oauth_states.code_verifier_ciphertext IS 'Short-lived AES-256-GCM PKCE verifier; cleared when OAuth state is consumed.';
