ALTER TABLE drivers
  ADD COLUMN location_source text,
  ADD COLUMN location_accuracy_m numeric(8,2);

UPDATE drivers SET location_source='legacy' WHERE current_location IS NOT NULL AND location_source IS NULL;

ALTER TABLE drivers
  ADD CONSTRAINT drivers_location_source_check CHECK(location_source IS NULL OR location_source IN('foreground','background','legacy')),
  ADD CONSTRAINT drivers_location_accuracy_check CHECK(location_accuracy_m IS NULL OR location_accuracy_m BETWEEN 0 AND 1000);

CREATE INDEX drivers_fresh_supply_idx ON drivers(active_mode,location_updated_at DESC)
WHERE online AND current_location IS NOT NULL;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
    GRANT SELECT(location_source,location_accuracy_m,location_updated_at) ON drivers TO flash_rls_audit;
  END IF;
END $$;

COMMENT ON COLUMN drivers.location_source IS 'Origin of the latest accepted GPS fix; never derived from a simulated movement.';
