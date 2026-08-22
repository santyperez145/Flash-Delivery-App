CREATE TABLE dietary_labels(
  code text PRIMARY KEY CHECK(code ~ '^[a-z0-9_]{2,40}$'),
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE allergens(
  code text PRIMARY KEY CHECK(code ~ '^[a-z0-9_]{2,40}$'),
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE catalog_item_dietary_labels(
  catalog_item_id uuid NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  dietary_code text NOT NULL REFERENCES dietary_labels(code),
  PRIMARY KEY(catalog_item_id,dietary_code)
);
CREATE TABLE catalog_item_allergens(
  catalog_item_id uuid NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  allergen_code text NOT NULL REFERENCES allergens(code),
  presence text NOT NULL CHECK(presence IN ('contains','may_contain')),
  PRIMARY KEY(catalog_item_id,allergen_code)
);
INSERT INTO dietary_labels(code,name) VALUES ('vegetarian','Vegetariano'),('vegan','Vegano'),('gluten_free','Sin gluten'),('halal','Halal'),('kosher','Kosher');
INSERT INTO allergens(code,name) VALUES ('gluten','Gluten'),('milk','Leche'),('eggs','Huevo'),('peanuts','Maní'),('tree_nuts','Frutos secos'),('soy','Soja'),('fish','Pescado'),('shellfish','Crustáceos'),('sesame','Sésamo');
INSERT INTO catalog_item_allergens(catalog_item_id,allergen_code,presence)
SELECT id,'gluten','contains' FROM catalog_items WHERE public_id IN ('item_burger_brava','item_pizza_muzzarella','item_pizza_fugazzeta') ON CONFLICT DO NOTHING;
INSERT INTO catalog_item_allergens(catalog_item_id,allergen_code,presence)
SELECT id,'milk','contains' FROM catalog_items WHERE public_id IN ('item_burger_brava','item_pizza_muzzarella','item_pizza_fugazzeta') ON CONFLICT DO NOTHING;
INSERT INTO catalog_item_dietary_labels(catalog_item_id,dietary_code)
SELECT id,'vegetarian' FROM catalog_items WHERE public_id IN ('item_papas_trufa','item_pizza_muzzarella','item_pizza_fugazzeta') ON CONFLICT DO NOTHING;
ALTER TABLE dietary_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE allergens ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_item_dietary_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_item_allergens ENABLE ROW LEVEL SECURITY;
CREATE POLICY dietary_labels_visible ON dietary_labels USING(active OR app.has_role('admin'));
CREATE POLICY allergens_visible ON allergens USING(active OR app.has_role('admin'));
CREATE POLICY catalog_item_dietary_visible ON catalog_item_dietary_labels USING(true);
CREATE POLICY catalog_item_allergens_visible ON catalog_item_allergens USING(true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON dietary_labels,allergens,catalog_item_dietary_labels,catalog_item_allergens TO flash_runtime;
  CREATE POLICY dietary_labels_runtime ON dietary_labels TO flash_runtime USING(true) WITH CHECK(true);
  CREATE POLICY allergens_runtime ON allergens TO flash_runtime USING(true) WITH CHECK(true);
  CREATE POLICY catalog_item_dietary_runtime ON catalog_item_dietary_labels TO flash_runtime USING(true) WITH CHECK(true);
  CREATE POLICY catalog_item_allergens_runtime ON catalog_item_allergens TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN GRANT SELECT ON dietary_labels,allergens,catalog_item_dietary_labels,catalog_item_allergens TO flash_rls_audit; END IF;
END $$;
