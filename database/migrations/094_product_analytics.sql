CREATE TABLE product_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city_id uuid NOT NULL REFERENCES cities(id),
  name text NOT NULL CHECK(name IN('home_viewed','search_started','merchant_viewed','cart_updated','checkout_started','quote_received','job_created','activity_viewed')),
  surface text NOT NULL CHECK(surface IN('web','customer_app','driver_app','merchant_app')),
  session_id uuid NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CHECK(jsonb_typeof(properties)='object'),
  CHECK(pg_column_size(properties)<=2048)
);
CREATE INDEX product_events_city_time_idx ON product_events(city_id,occurred_at DESC);
CREATE INDEX product_events_funnel_idx ON product_events(name,occurred_at DESC,user_id);
ALTER TABLE product_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
    GRANT SELECT,INSERT,DELETE ON product_events TO flash_runtime;
    GRANT USAGE,SELECT ON SEQUENCE product_events_id_seq TO flash_runtime;
    CREATE POLICY product_events_runtime_service ON product_events TO flash_runtime USING(true) WITH CHECK(true);
  END IF;
END $$;
GRANT SELECT ON product_events TO flash_rls_audit;
COMMENT ON TABLE product_events IS 'First-party pseudonymous product analytics. Never stores address, coordinates, free text, token, email or phone.';
