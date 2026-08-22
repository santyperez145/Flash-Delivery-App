CREATE TABLE ride_destination_history(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address_key text NOT NULL,
  label text NOT NULL,
  formatted_address text NOT NULL,
  location geography(Point,4326) NOT NULL,
  use_count integer NOT NULL DEFAULT 1 CHECK(use_count>0),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,address_key)
);

CREATE INDEX ride_destination_history_user_recent_idx ON ride_destination_history(user_id,last_used_at DESC);
CREATE INDEX ride_destination_history_location_gix ON ride_destination_history USING gist(location);

ALTER TABLE ride_destination_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY ride_destination_history_owner ON ride_destination_history
  USING(user_id=app.current_user_id()) WITH CHECK(user_id=app.current_user_id());

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON ride_destination_history TO flash_runtime;
  CREATE POLICY ride_destination_history_runtime ON ride_destination_history TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT ON ride_destination_history TO flash_rls_audit;
 END IF;
END $$;
