CREATE TABLE order_issues(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK(category IN('missing_item','wrong_item','damaged_item','quality','late','other')),
  description text NOT NULL CHECK(length(description) BETWEEN 5 AND 1000),
  status text NOT NULL DEFAULT 'open' CHECK(status IN('open','approved','rejected')),
  requested_refund_cents bigint NOT NULL DEFAULT 0 CHECK(requested_refund_cents>=0),
  approved_refund_cents bigint NOT NULL DEFAULT 0 CHECK(approved_refund_cents>=0),
  resolution_note text CHECK(resolution_note IS NULL OR length(resolution_note) BETWEEN 3 AND 1000),
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((status='open' AND resolved_at IS NULL AND resolved_by IS NULL AND approved_refund_cents=0) OR
        (status IN('approved','rejected') AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)),
  CHECK(status='approved' OR approved_refund_cents=0)
);
CREATE INDEX order_issues_job_created_idx ON order_issues(job_id,created_at DESC);
CREATE INDEX order_issues_status_created_idx ON order_issues(status,created_at);

ALTER TABLE order_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_issues_participants ON order_issues USING(
  app.has_role('admin') OR reporter_id=app.current_user_id() OR EXISTS(
    SELECT 1 FROM jobs j JOIN merchants m ON m.id=j.merchant_id
    WHERE j.id=order_issues.job_id AND m.owner_id=app.current_user_id()
  )
);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  CREATE POLICY order_issues_runtime_service ON order_issues TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT ON order_issues TO flash_rls_audit;
 END IF;
END $$;
