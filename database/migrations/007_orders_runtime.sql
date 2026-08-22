ALTER TABLE drivers
  ADD COLUMN public_id text,
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';

UPDATE drivers SET public_id = id::text WHERE public_id IS NULL;
ALTER TABLE drivers ALTER COLUMN public_id SET NOT NULL;
CREATE UNIQUE INDEX drivers_public_id_unique ON drivers(public_id);

CREATE INDEX jobs_food_orders_idx
  ON jobs(created_at DESC)
  WHERE kind = 'delivery' AND metadata->>'subtype' = 'food_order';

