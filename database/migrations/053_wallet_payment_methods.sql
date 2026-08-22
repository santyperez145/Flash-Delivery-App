INSERT INTO payment_methods(user_id,provider,provider_payment_method_id,kind,is_default)
SELECT u.id,'flash_wallet','wallet:'||u.public_id,'wallet',NOT EXISTS(SELECT 1 FROM payment_methods pm WHERE pm.user_id=u.id AND pm.revoked_at IS NULL AND pm.is_default)
FROM users u
WHERE NOT EXISTS(SELECT 1 FROM payment_methods pm WHERE pm.user_id=u.id AND pm.kind='wallet' AND pm.revoked_at IS NULL);

COMMENT ON COLUMN payment_methods.provider_payment_method_id IS 'Provider token only; Flash Wallet uses non-secret wallet:<public_user_id> identity.';
