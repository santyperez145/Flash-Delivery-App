ALTER TABLE refunds ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX refunds_idempotency_unique ON refunds(idempotency_key) WHERE idempotency_key IS NOT NULL;
