UPDATE audit_events
SET before_data=COALESCE(before_data,'{}'::jsonb)-'lat'-'lng',
    after_data=COALESCE(after_data,'{}'::jsonb)-'lat'-'lng'
WHERE action='driver.location_updated'
  AND (COALESCE(before_data,'{}'::jsonb)?|ARRAY['lat','lng'] OR COALESCE(after_data,'{}'::jsonb)?|ARRAY['lat','lng']);

SELECT app.rebuild_audit_chain();

COMMENT ON COLUMN drivers.current_location IS 'Latest operational point only; precise GPS fixes are excluded from append-only audit payloads.';
