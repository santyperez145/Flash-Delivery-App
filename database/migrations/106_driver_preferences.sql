CREATE TABLE driver_preferences(
  driver_id uuid PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,
  navigation_provider text NOT NULL DEFAULT 'system' CHECK(navigation_provider IN('system','google_maps','apple_maps')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE driver_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_preferences_owner ON driver_preferences
  USING(EXISTS(SELECT 1 FROM drivers d WHERE d.id=driver_id AND d.user_id=app.current_user_id()))
  WITH CHECK(EXISTS(SELECT 1 FROM drivers d WHERE d.id=driver_id AND d.user_id=app.current_user_id()));

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
    GRANT SELECT,INSERT,UPDATE ON driver_preferences TO flash_runtime;
    CREATE POLICY driver_preferences_runtime_service ON driver_preferences TO flash_runtime USING(true) WITH CHECK(true);
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
    GRANT SELECT(driver_id,navigation_provider,updated_at) ON driver_preferences TO flash_rls_audit;
  END IF;
END $$;

COMMENT ON TABLE driver_preferences IS 'Driver-owned operational preferences; a navigation provider only controls external handoff and never route authority.';
