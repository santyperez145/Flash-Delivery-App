CREATE INDEX jobs_rides_created_idx ON jobs(customer_id, created_at DESC) WHERE kind = 'ride';
CREATE INDEX jobs_shipments_created_idx ON jobs(customer_id, created_at DESC)
  WHERE kind = 'delivery' AND metadata->>'subtype' = 'shipment';

