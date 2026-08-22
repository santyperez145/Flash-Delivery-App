ALTER TABLE notifications DROP CONSTRAINT notifications_status_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_status_check CHECK(status IN('queued','sent','delivered','failed','read','dead_lettered'));
ALTER TABLE notifications
  ADD COLUMN dead_lettered_at timestamptz,
  ADD COLUMN replay_count integer NOT NULL DEFAULT 0 CHECK(replay_count>=0),
  ADD COLUMN last_replayed_at timestamptz,
  ADD COLUMN last_replayed_by uuid REFERENCES users(id);
ALTER TABLE notifications ADD CONSTRAINT notifications_dead_letter_state_check CHECK(
  (status='dead_lettered' AND dead_lettered_at IS NOT NULL)
  OR (status<>'dead_lettered')
);
CREATE INDEX notifications_dead_letter_queue_idx ON notifications(dead_lettered_at DESC) WHERE status='dead_lettered';

ALTER TABLE user_devices
  ADD COLUMN invalidated_at timestamptz,
  ADD COLUMN invalid_reason text;
ALTER TABLE user_devices ADD CONSTRAINT user_devices_invalid_state_check CHECK(
  (invalidated_at IS NULL AND invalid_reason IS NULL)
  OR (invalidated_at IS NOT NULL AND revoked_at IS NOT NULL AND length(invalid_reason)>0)
);

CREATE TABLE notification_dead_letters(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL UNIQUE REFERENCES notifications(id) ON DELETE CASCADE,
  reason text NOT NULL,
  attempts integer NOT NULL CHECK(attempts>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  replayed_by uuid REFERENCES users(id)
);
CREATE INDEX notification_dead_letters_open_idx ON notification_dead_letters(created_at DESC) WHERE resolved_at IS NULL;

ALTER TABLE notification_dead_letters ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_dead_letters_staff ON notification_dead_letters USING(app.has_role('admin')) WITH CHECK(app.has_role('admin'));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE ON notification_dead_letters TO flash_runtime;
  CREATE POLICY notification_dead_letters_runtime_service ON notification_dead_letters TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT ON notification_dead_letters TO flash_rls_audit;
 END IF;
END $$;

COMMENT ON TABLE notification_dead_letters IS 'Terminal notification delivery failures retained for attributed operational replay.';
COMMENT ON COLUMN user_devices.invalid_reason IS 'Provider-normalized permanent token failure; raw provider responses are never stored.';
