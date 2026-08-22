CREATE TABLE catalog_modifier_groups(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL,
  catalog_item_id uuid NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  name text NOT NULL,
  minimum_selections smallint NOT NULL DEFAULT 0 CHECK(minimum_selections BETWEEN 0 AND 20),
  maximum_selections smallint NOT NULL DEFAULT 1 CHECK(maximum_selections BETWEEN 1 AND 20),
  sort_order smallint NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(catalog_item_id,public_id),
  CHECK(minimum_selections<=maximum_selections)
);

CREATE TABLE catalog_modifiers(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL,
  group_id uuid NOT NULL REFERENCES catalog_modifier_groups(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_cents bigint NOT NULL DEFAULT 0 CHECK(price_cents>=0),
  available boolean NOT NULL DEFAULT true,
  sort_order smallint NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(group_id,public_id)
);
CREATE INDEX catalog_modifier_groups_item_idx ON catalog_modifier_groups(catalog_item_id,active,sort_order);
CREATE INDEX catalog_modifiers_group_idx ON catalog_modifiers(group_id,available,sort_order);

INSERT INTO catalog_modifier_groups(public_id,catalog_item_id,name,minimum_selections,maximum_selections)
SELECT 'extras',c.id,'Agregados',0,LEAST(6,jsonb_array_length(m.metadata->'extras'))
FROM catalog_items c JOIN merchants m ON m.id=c.merchant_id
WHERE jsonb_typeof(m.metadata->'extras')='array' AND jsonb_array_length(m.metadata->'extras')>0;

INSERT INTO catalog_modifiers(public_id,group_id,name,price_cents,sort_order)
SELECT extra->>'id',g.id,extra->>'name',round((extra->>'price')::numeric*100)::bigint,ordinality-1
FROM catalog_modifier_groups g JOIN catalog_items c ON c.id=g.catalog_item_id JOIN merchants m ON m.id=c.merchant_id
CROSS JOIN LATERAL jsonb_array_elements(m.metadata->'extras') WITH ORDINALITY AS value(extra,ordinality);

ALTER TABLE catalog_modifier_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_modifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY catalog_modifier_groups_visible ON catalog_modifier_groups USING(active OR app.has_role('admin') OR EXISTS(SELECT 1 FROM catalog_items c JOIN merchants m ON m.id=c.merchant_id WHERE c.id=catalog_item_id AND m.owner_id=app.current_user_id()));
CREATE POLICY catalog_modifiers_visible ON catalog_modifiers USING(EXISTS(SELECT 1 FROM catalog_modifier_groups g WHERE g.id=group_id));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON catalog_modifier_groups,catalog_modifiers TO flash_runtime;
  CREATE POLICY catalog_modifier_groups_runtime_service ON catalog_modifier_groups TO flash_runtime USING(true) WITH CHECK(true);
  CREATE POLICY catalog_modifiers_runtime_service ON catalog_modifiers TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN GRANT SELECT ON catalog_modifier_groups,catalog_modifiers TO flash_rls_audit; END IF;
END $$;
