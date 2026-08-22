ALTER TABLE dispatch_offers ADD COLUMN public_id text;
UPDATE dispatch_offers SET public_id='OFR-'||upper(substr(replace(id::text,'-',''),1,8)) WHERE public_id IS NULL;
ALTER TABLE dispatch_offers ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE dispatch_offers ADD CONSTRAINT dispatch_offers_public_id_unique UNIQUE(public_id);

CREATE UNIQUE INDEX dispatch_offers_one_accepted_per_job
  ON dispatch_offers(job_id) WHERE status='accepted';
CREATE INDEX dispatch_offers_job_status_idx ON dispatch_offers(job_id,status,expires_at);

ALTER TABLE dispatch_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY dispatch_offers_driver ON dispatch_offers
  USING(driver_id IN(SELECT id FROM drivers WHERE user_id=app.current_user_id()) OR app.has_role('admin'));

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  CREATE POLICY dispatch_offers_runtime_service ON dispatch_offers TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT ON dispatch_offers,drivers TO flash_rls_audit;
 END IF;
END $$;
