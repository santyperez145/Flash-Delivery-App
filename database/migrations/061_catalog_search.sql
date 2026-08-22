CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX merchants_name_trgm_idx ON merchants USING gin(lower(name) gin_trgm_ops) WHERE status='active';
CREATE INDEX catalog_items_search_trgm_idx ON catalog_items USING gin((lower(name||' '||description||' '||category)) gin_trgm_ops) WHERE available;
CREATE INDEX catalog_item_dietary_code_item_idx ON catalog_item_dietary_labels(dietary_code,catalog_item_id);
CREATE INDEX catalog_item_allergens_code_item_idx ON catalog_item_allergens(allergen_code,catalog_item_id);
