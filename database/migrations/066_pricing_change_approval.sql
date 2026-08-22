CREATE TABLE pricing_change_requests(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  service text NOT NULL CHECK(service IN('food','ride','shipment')),
  version text NOT NULL,
  currency char(3) NOT NULL DEFAULT 'ARS',
  config jsonb NOT NULL CHECK(jsonb_typeof(config)='object'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected','activated','cancelled')),
  requested_by uuid NOT NULL REFERENCES users(id),
  reviewed_by uuid REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  effective_at timestamptz NOT NULL,
  activated_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(service,version),
  CHECK(reviewed_by IS NULL OR reviewed_by<>requested_by),
  CHECK((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR status<>'pending')
);

CREATE INDEX pricing_change_requests_queue_idx ON pricing_change_requests(status,effective_at);
CREATE UNIQUE INDEX pricing_change_requests_one_open_version_idx ON pricing_change_requests(service,version) WHERE status IN('pending','approved');

ALTER TABLE pricing_change_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY pricing_change_requests_admin ON pricing_change_requests
  USING(app.has_role('admin')) WITH CHECK(app.has_role('admin'));

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE ON pricing_change_requests TO flash_runtime;
  CREATE POLICY pricing_change_requests_runtime ON pricing_change_requests TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT ON pricing_change_requests TO flash_rls_audit;
 END IF;
END $$;
