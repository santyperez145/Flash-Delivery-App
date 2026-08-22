ALTER TABLE payment_intents
  ADD CONSTRAINT payment_intents_capture_not_above_amount
  CHECK (captured_amount_cents <= amount_cents);

CREATE INDEX payment_intents_job_status_idx ON payment_intents(job_id, status);

