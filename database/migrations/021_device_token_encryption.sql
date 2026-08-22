ALTER TABLE user_devices
  ADD COLUMN push_token_ciphertext text,
  ADD COLUMN push_token_hash char(64);

DROP INDEX IF EXISTS user_devices_active_push_token_unique;
ALTER TABLE user_devices DROP CONSTRAINT IF EXISTS user_devices_user_id_push_token_key;

CREATE UNIQUE INDEX user_devices_active_push_token_hash_unique
  ON user_devices(push_token_hash)
  WHERE push_token_hash IS NOT NULL AND revoked_at IS NULL;

CREATE INDEX user_devices_user_token_hash_idx
  ON user_devices(user_id, push_token_hash);

COMMENT ON COLUMN user_devices.push_token IS
  'Legacy plaintext column. Must remain NULL after scripts/encrypt-device-tokens.mjs.';
COMMENT ON COLUMN user_devices.push_token_ciphertext IS
  'AES-256-GCM envelope (version.iv.tag.ciphertext), never returned by public APIs.';
COMMENT ON COLUMN user_devices.push_token_hash IS
  'Keyed HMAC-SHA256 used only for equality and deduplication.';
