ALTER TABLE refresh_sessions ADD COLUMN public_id uuid DEFAULT gen_random_uuid();
UPDATE refresh_sessions SET public_id=gen_random_uuid() WHERE public_id IS NULL;
ALTER TABLE refresh_sessions ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE refresh_sessions ADD CONSTRAINT refresh_sessions_public_id_unique UNIQUE(public_id);
CREATE INDEX refresh_sessions_user_active_devices_idx ON refresh_sessions(user_id,created_at DESC) WHERE revoked_at IS NULL;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN GRANT SELECT(public_id,user_id,device_name,expires_at,revoked_at,created_at),UPDATE(revoked_at) ON refresh_sessions TO flash_runtime; END IF; END $$;
COMMENT ON COLUMN refresh_sessions.public_id IS 'Opaque identifier safe for the account session inventory; token hashes never leave the repository.';
