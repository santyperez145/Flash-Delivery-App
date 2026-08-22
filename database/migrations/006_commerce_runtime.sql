ALTER TABLE merchants
  ADD COLUMN public_id text,
  ADD COLUMN open boolean NOT NULL DEFAULT true,
  ADD COLUMN eta_min integer NOT NULL DEFAULT 25 CHECK (eta_min BETWEEN 5 AND 240),
  ADD COLUMN delivery_fee_cents bigint NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';

UPDATE merchants SET public_id = id::text WHERE public_id IS NULL;
ALTER TABLE merchants ALTER COLUMN public_id SET NOT NULL;
CREATE UNIQUE INDEX merchants_public_id_unique ON merchants(public_id);

ALTER TABLE catalog_items
  ADD COLUMN public_id text,
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';

UPDATE catalog_items SET public_id = id::text WHERE public_id IS NULL;
ALTER TABLE catalog_items ALTER COLUMN public_id SET NOT NULL;
CREATE UNIQUE INDEX catalog_items_public_id_unique ON catalog_items(public_id);

ALTER TABLE jobs
  ADD COLUMN public_id text,
  ADD COLUMN payment_method_label text,
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';

UPDATE jobs SET public_id = id::text WHERE public_id IS NULL;
ALTER TABLE jobs ALTER COLUMN public_id SET NOT NULL;
CREATE UNIQUE INDEX jobs_public_id_unique ON jobs(public_id);

ALTER TABLE job_items
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';

