ALTER TABLE jobs DROP CONSTRAINT jobs_merchant_prep_snapshot_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_merchant_prep_snapshot_check CHECK (
  merchant_prep_minutes IS NULL
  OR merchant_prep_minutes BETWEEN 5 AND 240
);
ALTER TABLE jobs ADD CONSTRAINT jobs_merchant_ready_due_snapshot_check CHECK (
  merchant_ready_due_at IS NULL OR merchant_prep_minutes IS NOT NULL
);

COMMENT ON COLUMN jobs.merchant_ready_due_at IS
  'Merchant food-readiness deadline started only when a paid order becomes accepted. Null means pending payment or an unobserved legacy order.';
