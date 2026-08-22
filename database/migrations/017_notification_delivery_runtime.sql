ALTER TABLE user_devices ADD COLUMN public_id text;
UPDATE user_devices SET public_id='DEV-'||upper(substr(replace(id::text,'-',''),1,8)) WHERE public_id IS NULL;
ALTER TABLE user_devices ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE user_devices ADD CONSTRAINT user_devices_public_id_unique UNIQUE(public_id);
CREATE UNIQUE INDEX user_devices_active_push_token_unique ON user_devices(push_token) WHERE push_token IS NOT NULL AND revoked_at IS NULL;

ALTER TABLE notifications
  ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  ADD COLUMN locked_at timestamptz,
  ADD COLUMN locked_by text,
  ADD COLUMN last_error text,
  ADD COLUMN provider_message_id text;
CREATE INDEX notifications_worker_claim_idx ON notifications(scheduled_at,created_at) WHERE status='queued';

CREATE TABLE notification_deliveries(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  device_id uuid REFERENCES user_devices(id) ON DELETE SET NULL,
  attempt integer NOT NULL CHECK(attempt>0),
  provider text NOT NULL,
  provider_message_id text,
  status text NOT NULL CHECK(status IN('delivered','failed')),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(notification_id,device_id,attempt)
);
CREATE INDEX notification_deliveries_notification_idx ON notification_deliveries(notification_id,created_at DESC);

ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_devices_owner ON user_devices USING(user_id=app.current_user_id() OR app.has_role('admin')) WITH CHECK(user_id=app.current_user_id() OR app.has_role('admin'));
GRANT SELECT ON user_devices TO flash_rls_audit;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  CREATE POLICY user_devices_runtime_service ON user_devices TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
END $$;
