ALTER TABLE users
  ADD COLUMN public_id text,
  ADD COLUMN profile jsonb NOT NULL DEFAULT '{}';

UPDATE users SET public_id = id::text WHERE public_id IS NULL;

ALTER TABLE users
  ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX users_public_id_unique ON users(public_id);
CREATE INDEX refresh_sessions_active_idx
  ON refresh_sessions(token_hash, expires_at)
  WHERE revoked_at IS NULL;

