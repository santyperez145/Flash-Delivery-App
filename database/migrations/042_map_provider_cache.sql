CREATE TABLE map_provider_cache(
  cache_key text PRIMARY KEY CHECK(length(cache_key)=64),
  kind text NOT NULL CHECK(kind IN('geocode','route')),
  provider text NOT NULL,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  hit_count bigint NOT NULL DEFAULT 0 CHECK(hit_count>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX map_provider_cache_expiry_idx ON map_provider_cache(expires_at);
ALTER TABLE map_provider_cache ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON map_provider_cache TO flash_runtime;
  CREATE POLICY map_provider_cache_runtime_service ON map_provider_cache TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT ON map_provider_cache TO flash_rls_audit;
 END IF;
END $$;
