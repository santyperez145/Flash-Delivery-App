CREATE TABLE order_item_substitutions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  job_item_id uuid NOT NULL REFERENCES job_items(id) ON DELETE RESTRICT,
  original_catalog_item_id uuid NOT NULL REFERENCES catalog_items(id),
  replacement_catalog_item_id uuid NOT NULL REFERENCES catalog_items(id),
  proposed_by uuid NOT NULL REFERENCES users(id),
  decided_by uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','accepted','rejected','cancelled')),
  quantity integer NOT NULL CHECK(quantity>0),
  original_unit_price_cents bigint NOT NULL CHECK(original_unit_price_cents>=0),
  replacement_unit_price_cents bigint NOT NULL CHECK(replacement_unit_price_cents>=0),
  refund_amount_cents bigint NOT NULL DEFAULT 0 CHECK(refund_amount_cents>=0),
  reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
  original_snapshot jsonb NOT NULL,
  replacement_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CHECK(replacement_unit_price_cents<=original_unit_price_cents),
  CHECK((status='pending' AND decided_by IS NULL AND decided_at IS NULL) OR status='cancelled' OR (status IN('accepted','rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX order_item_substitutions_pending_idx ON order_item_substitutions(job_item_id) WHERE status='pending';
CREATE INDEX order_item_substitutions_job_idx ON order_item_substitutions(job_id,created_at DESC);

ALTER TABLE order_item_substitutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_item_substitutions_participants ON order_item_substitutions USING(
  app.has_role('admin') OR EXISTS(SELECT 1 FROM jobs j WHERE j.id=job_id AND j.customer_id=app.current_user_id()) OR
  EXISTS(SELECT 1 FROM jobs j JOIN merchants m ON m.id=j.merchant_id WHERE j.id=job_id AND m.owner_id=app.current_user_id())
);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  CREATE POLICY order_item_substitutions_runtime_service ON order_item_substitutions TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT ON order_item_substitutions TO flash_rls_audit;
 END IF;
END $$;
