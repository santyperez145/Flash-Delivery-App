CREATE TABLE job_cancellations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  job_id uuid NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason_code text NOT NULL CHECK(reason_code IN('changed_mind','wrong_address','long_wait','price','driver_issue','merchant_issue','recipient_unavailable','other')),
  reason_detail text,
  refund_amount_cents bigint NOT NULL DEFAULT 0 CHECK(refund_amount_cents>=0),
  cancellation_fee_cents bigint NOT NULL DEFAULT 0 CHECK(cancellation_fee_cents>=0),
  currency char(3) NOT NULL DEFAULT 'ARS',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(reason_code='other' OR reason_detail IS NULL OR length(reason_detail)<=500)
);
CREATE INDEX job_cancellations_actor_created_idx ON job_cancellations(actor_id,created_at DESC);

ALTER TABLE job_cancellations ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_cancellations_via_job ON job_cancellations USING(
  EXISTS(SELECT 1 FROM jobs WHERE jobs.id=job_cancellations.job_id)
);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  CREATE POLICY job_cancellations_runtime_service ON job_cancellations TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT ON job_cancellations TO flash_rls_audit;
 END IF;
END $$;
