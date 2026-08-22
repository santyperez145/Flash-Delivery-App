CREATE INDEX dispatch_offers_driver_history_idx
  ON dispatch_offers(driver_id,created_at DESC)
  INCLUDE(status,responded_at,job_id)
  WHERE status IN('accepted','rejected','expired');
