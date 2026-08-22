CREATE TABLE ride_tracking_links(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id),
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer NOT NULL DEFAULT 0 CHECK(view_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(expires_at > created_at)
);
CREATE UNIQUE INDEX ride_tracking_links_active_job_idx ON ride_tracking_links(job_id,created_by) WHERE revoked_at IS NULL;
CREATE INDEX ride_tracking_links_lookup_idx ON ride_tracking_links(token_hash,expires_at) WHERE revoked_at IS NULL;

CREATE TABLE ride_safety_incidents(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES users(id),
  incident_type text NOT NULL CHECK(incident_type IN('sos','unsafe_driving','medical','harassment','crash','other')),
  details text,
  location geography(Point,4326),
  status text NOT NULL DEFAULT 'open' CHECK(status IN('open','acknowledged','resolved','false_alarm')),
  acknowledged_by uuid REFERENCES users(id),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ride_safety_incidents_queue_idx ON ride_safety_incidents(status,created_at) WHERE status IN('open','acknowledged');
CREATE INDEX ride_safety_incidents_location_gix ON ride_safety_incidents USING gist(location);

ALTER TABLE ride_tracking_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE ride_safety_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY ride_tracking_links_owner ON ride_tracking_links
  USING(created_by=app.current_user_id() OR app.has_role('admin') OR app.has_role('support'))
  WITH CHECK(created_by=app.current_user_id() OR app.has_role('admin'));
CREATE POLICY ride_safety_incidents_participant ON ride_safety_incidents
  USING(reporter_id=app.current_user_id() OR app.has_role('admin') OR app.has_role('support'))
  WITH CHECK(reporter_id=app.current_user_id() OR app.has_role('admin') OR app.has_role('support'));

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON ride_tracking_links,ride_safety_incidents TO flash_runtime;
  CREATE POLICY ride_tracking_links_runtime_service ON ride_tracking_links TO flash_runtime USING(true) WITH CHECK(true);
  CREATE POLICY ride_safety_incidents_runtime_service ON ride_safety_incidents TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT ON ride_tracking_links,ride_safety_incidents TO flash_rls_audit;
 END IF;
END $$;

COMMENT ON COLUMN ride_tracking_links.token_hash IS 'SHA-256 bearer-token digest; plaintext is never persisted.';
