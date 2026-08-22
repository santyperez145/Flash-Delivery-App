CREATE TABLE user_dietary_profiles(
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hide_incompatible boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_dietary_preferences(
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dietary_code text NOT NULL REFERENCES dietary_labels(code),
  PRIMARY KEY(user_id,dietary_code)
);
CREATE TABLE user_avoided_allergens(
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  allergen_code text NOT NULL REFERENCES allergens(code),
  PRIMARY KEY(user_id,allergen_code)
);
ALTER TABLE user_dietary_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_dietary_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_avoided_allergens ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_dietary_profiles_owner ON user_dietary_profiles USING(user_id=app.current_user_id() OR app.has_role('admin')) WITH CHECK(user_id=app.current_user_id() OR app.has_role('admin'));
CREATE POLICY user_dietary_preferences_owner ON user_dietary_preferences USING(user_id=app.current_user_id() OR app.has_role('admin')) WITH CHECK(user_id=app.current_user_id() OR app.has_role('admin'));
CREATE POLICY user_avoided_allergens_owner ON user_avoided_allergens USING(user_id=app.current_user_id() OR app.has_role('admin')) WITH CHECK(user_id=app.current_user_id() OR app.has_role('admin'));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON user_dietary_profiles,user_dietary_preferences,user_avoided_allergens TO flash_runtime;
  CREATE POLICY user_dietary_profiles_runtime ON user_dietary_profiles TO flash_runtime USING(true) WITH CHECK(true);
  CREATE POLICY user_dietary_preferences_runtime ON user_dietary_preferences TO flash_runtime USING(true) WITH CHECK(true);
  CREATE POLICY user_avoided_allergens_runtime ON user_avoided_allergens TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN GRANT SELECT ON user_dietary_profiles,user_dietary_preferences,user_avoided_allergens TO flash_rls_audit; END IF;
END $$;
