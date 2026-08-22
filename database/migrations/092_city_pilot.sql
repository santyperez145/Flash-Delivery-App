CREATE TABLE cities (
  id uuid PRIMARY KEY,
  public_id text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
  name text NOT NULL,
  country_code char(2) NOT NULL,
  currency char(3) NOT NULL,
  timezone text NOT NULL,
  center geography(Point,4326) NOT NULL,
  boundary geography(Polygon,4326) NOT NULL,
  status text NOT NULL DEFAULT 'planning' CHECK(status IN('planning','internal','beta','active','paused')),
  enabled_services job_kind[] NOT NULL DEFAULT ARRAY['delivery']::job_kind[],
  launched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cities_boundary_gix ON cities USING gist(boundary);

INSERT INTO cities(id,public_id,slug,name,country_code,currency,timezone,center,boundary,status,enabled_services,launched_at)
VALUES(
  '00000000-0000-4000-8000-000000000001',
  'CITY-BA',
  'buenos-aires',
  'Buenos Aires',
  'AR',
  'ARS',
  'America/Argentina/Buenos_Aires',
  ST_SetSRID(ST_MakePoint(-58.3816,-34.6037),4326)::geography,
  ST_GeogFromText('SRID=4326;POLYGON((-58.531 -34.705,-58.335 -34.705,-58.335 -34.526,-58.531 -34.526,-58.531 -34.705))'),
  'beta',
  ARRAY['delivery','shopping']::job_kind[],
  now()
);

ALTER TABLE users ADD COLUMN city_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES cities(id);
ALTER TABLE merchants ADD COLUMN city_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES cities(id);
ALTER TABLE drivers ADD COLUMN city_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES cities(id);
ALTER TABLE jobs ADD COLUMN city_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES cities(id);
ALTER TABLE service_zones ADD COLUMN city_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES cities(id);

CREATE INDEX users_city_idx ON users(city_id,status);
CREATE INDEX merchants_city_idx ON merchants(city_id,status);
CREATE INDEX drivers_city_supply_idx ON drivers(city_id,active_mode,online);
CREATE INDEX jobs_city_active_idx ON jobs(city_id,kind,status,created_at DESC) WHERE status NOT IN('completed','cancelled');
CREATE INDEX service_zones_city_idx ON service_zones(city_id,active);

ALTER TABLE cities ENABLE ROW LEVEL SECURITY;
CREATE POLICY cities_runtime_read ON cities FOR SELECT USING(status IN('beta','active') OR app.has_role('admin') OR app.has_role('support'));

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
    GRANT SELECT ON cities TO flash_runtime;
  END IF;
END $$;
GRANT SELECT ON cities TO flash_rls_audit;

COMMENT ON TABLE cities IS 'Operational expansion boundary. A second city stays disabled until tenant isolation and launch gates pass.';
