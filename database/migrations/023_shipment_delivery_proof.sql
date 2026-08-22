ALTER TABLE shipment_details
  ADD COLUMN delivery_pin_failed_attempts smallint NOT NULL DEFAULT 0 CHECK(delivery_pin_failed_attempts BETWEEN 0 AND 5),
  ADD COLUMN delivery_pin_locked_until timestamptz,
  ADD COLUMN delivery_verified_at timestamptz,
  ADD COLUMN delivery_verified_by uuid REFERENCES users(id);

CREATE INDEX shipment_details_pending_verification_idx
  ON shipment_details(job_id)
  WHERE delivery_verified_at IS NULL;
