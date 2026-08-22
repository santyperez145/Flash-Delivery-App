CREATE SEQUENCE service_receipt_number_seq;

CREATE TABLE service_receipts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  receipt_number text NOT NULL UNIQUE,
  job_id uuid NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  service_kind job_kind NOT NULL,
  service_subtype text,
  subtotal_cents bigint NOT NULL CHECK(subtotal_cents>=0),
  discount_cents bigint NOT NULL DEFAULT 0 CHECK(discount_cents>=0),
  delivery_fee_cents bigint NOT NULL DEFAULT 0 CHECK(delivery_fee_cents>=0),
  service_fee_cents bigint NOT NULL DEFAULT 0 CHECK(service_fee_cents>=0),
  total_cents bigint NOT NULL CHECK(total_cents>=0),
  currency char(3) NOT NULL DEFAULT 'ARS',
  line_items jsonb NOT NULL DEFAULT '[]',
  payment_summary jsonb NOT NULL DEFAULT '{}',
  issued_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}',
  CHECK(jsonb_typeof(line_items)='array'),
  CHECK(jsonb_typeof(payment_summary)='object'),
  CHECK(jsonb_typeof(metadata)='object')
);
CREATE INDEX service_receipts_customer_issued_idx ON service_receipts(customer_id,issued_at DESC);

ALTER TABLE service_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_receipts_owner ON service_receipts USING(
  customer_id=app.current_user_id() OR app.has_role('admin')
);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  CREATE POLICY service_receipts_runtime_service ON service_receipts TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT ON service_receipts TO flash_rls_audit;
 END IF;
END $$;
