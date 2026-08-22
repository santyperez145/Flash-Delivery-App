CREATE INDEX jobs_scheduled_rides_dispatch_idx
  ON jobs(scheduled_for, created_at)
  WHERE kind='ride' AND driver_id IS NULL AND status='requested' AND scheduled_for IS NOT NULL;
