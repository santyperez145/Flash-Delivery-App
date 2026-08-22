CREATE TABLE shipment_protection_plans(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  premium_basis_points integer NOT NULL CHECK(premium_basis_points BETWEEN 1 AND 10000),
  minimum_premium_cents bigint NOT NULL CHECK(minimum_premium_cents>=0),
  maximum_declared_value_cents bigint NOT NULL CHECK(maximum_declared_value_cents>0),
  deductible_cents bigint NOT NULL DEFAULT 0 CHECK(deductible_cents>=0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO shipment_protection_plans(code,name,premium_basis_points,minimum_premium_cents,maximum_declared_value_cents,deductible_cents) VALUES('standard','Protección Flash',150,20000,100000000,500000);
ALTER TABLE shipment_details ADD COLUMN declared_value_cents bigint NOT NULL DEFAULT 0 CHECK(declared_value_cents>=0),ADD COLUMN protection_plan_id uuid REFERENCES shipment_protection_plans(id),ADD COLUMN protection_premium_cents bigint NOT NULL DEFAULT 0 CHECK(protection_premium_cents>=0);
CREATE TABLE shipment_return_requests(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  job_id uuid NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK(length(reason) BETWEEN 5 AND 500),
  status text NOT NULL DEFAULT 'requested' CHECK(status IN('requested','approved','rejected','in_transit','completed')),
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE shipment_protection_plans ENABLE ROW LEVEL SECURITY;ALTER TABLE shipment_return_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY shipment_protection_plans_visible ON shipment_protection_plans USING(active OR app.has_role('admin'));
CREATE POLICY shipment_returns_visible ON shipment_return_requests USING(requested_by=app.current_user_id() OR app.has_role('admin') OR app.has_role('support'));
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON shipment_protection_plans,shipment_return_requests TO flash_runtime;CREATE POLICY shipment_protection_runtime ON shipment_protection_plans TO flash_runtime USING(true) WITH CHECK(true);CREATE POLICY shipment_returns_runtime ON shipment_return_requests TO flash_runtime USING(true) WITH CHECK(true);END IF;IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN GRANT SELECT ON shipment_protection_plans,shipment_return_requests TO flash_rls_audit;END IF;END $$;
