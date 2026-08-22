CREATE TABLE shipment_details (
  job_id uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  recipient_name text NOT NULL,
  recipient_phone text NOT NULL,
  package_size text NOT NULL CHECK (package_size IN ('small', 'medium', 'large')),
  description text NOT NULL,
  weight_grams integer NOT NULL CHECK (weight_grams > 0 AND weight_grams <= 20000),
  delivery_notes text,
  delivery_pin_hash text NOT NULL,
  terms_accepted_at timestamptz NOT NULL,
  returned_at timestamptz
);

CREATE INDEX jobs_active_shipments_idx
  ON jobs(customer_id, created_at DESC)
  WHERE kind = 'delivery' AND status NOT IN ('completed', 'cancelled');
