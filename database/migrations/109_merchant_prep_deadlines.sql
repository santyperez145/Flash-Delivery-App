ALTER TABLE jobs
  ADD COLUMN merchant_prep_minutes smallint,
  ADD COLUMN merchant_ready_due_at timestamptz,
  ADD CONSTRAINT jobs_merchant_prep_snapshot_check CHECK (
    (merchant_prep_minutes IS NULL AND merchant_ready_due_at IS NULL)
    OR
    (merchant_prep_minutes BETWEEN 5 AND 240 AND merchant_ready_due_at IS NOT NULL)
  );

CREATE INDEX jobs_merchant_prep_due_idx
  ON jobs(merchant_id, merchant_ready_due_at)
  WHERE merchant_ready_due_at IS NOT NULL
    AND status IN ('accepted', 'preparing');

COMMENT ON COLUMN jobs.merchant_prep_minutes IS
  'Immutable branch preparation-time snapshot captured when a food order is created. Null means the legacy order was not observed.';
COMMENT ON COLUMN jobs.merchant_ready_due_at IS
  'Merchant food-readiness deadline derived from the immutable preparation snapshot. Historical rows are intentionally not guessed.';
