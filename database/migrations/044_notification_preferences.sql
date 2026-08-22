CREATE TABLE user_notification_preferences(
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK(category IN('service_updates','promotions','support','wallet','account')),
  push_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,category)
);

ALTER TABLE user_notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_preferences_owner ON user_notification_preferences
  USING(user_id=app.current_user_id() OR app.has_role('admin') OR app.has_role('support'))
  WITH CHECK(user_id=app.current_user_id() OR app.has_role('admin'));

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON user_notification_preferences TO flash_runtime;
  CREATE POLICY notification_preferences_runtime_service ON user_notification_preferences TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT ON user_notification_preferences TO flash_rls_audit;
 END IF;
END $$;
