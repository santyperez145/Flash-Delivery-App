ALTER TABLE ratings ADD COLUMN public_id text;
UPDATE ratings SET public_id='RATE-'||upper(substr(replace(id::text,'-',''),1,8)) WHERE public_id IS NULL;
ALTER TABLE ratings ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE ratings ADD CONSTRAINT ratings_public_id_unique UNIQUE(public_id);

ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ratings_participants ON ratings
  USING (author_id=app.current_user_id() OR app.has_role('admin') OR app.has_role('support'))
  WITH CHECK (author_id=app.current_user_id() OR app.has_role('admin'));

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
    CREATE POLICY ratings_runtime_service ON ratings TO flash_runtime USING(true) WITH CHECK(true);
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
    GRANT SELECT ON ratings TO flash_rls_audit;
  END IF;
END $$;

CREATE INDEX ratings_author_created_idx ON ratings(author_id,created_at DESC);
