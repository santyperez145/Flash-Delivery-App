CREATE TABLE merchant_branches(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text NOT NULL,
  location geography(Point,4326) NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN('active','paused','closed')),
  open boolean NOT NULL DEFAULT true,
  eta_min integer NOT NULL DEFAULT 25 CHECK(eta_min BETWEEN 5 AND 240),
  service_radius_m integer NOT NULL DEFAULT 6000 CHECK(service_radius_m BETWEEN 500 AND 100000),
  is_primary boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX merchant_branches_primary_idx ON merchant_branches(merchant_id) WHERE is_primary;
CREATE INDEX merchant_branches_location_gix ON merchant_branches USING gist(location);
CREATE INDEX merchant_branches_available_idx ON merchant_branches(merchant_id,open,status);

CREATE TABLE catalog_branch_inventory(
  branch_id uuid NOT NULL REFERENCES merchant_branches(id) ON DELETE CASCADE,
  catalog_item_id uuid NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  available boolean NOT NULL DEFAULT true,
  stock_quantity integer CHECK(stock_quantity IS NULL OR stock_quantity>=0),
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(branch_id,catalog_item_id)
);
CREATE INDEX catalog_branch_inventory_available_idx ON catalog_branch_inventory(branch_id,available,catalog_item_id);

ALTER TABLE jobs ADD COLUMN branch_id uuid REFERENCES merchant_branches(id) ON DELETE RESTRICT;
INSERT INTO merchant_branches(public_id,merchant_id,name,address,location,status,open,eta_min,service_radius_m,is_primary)
SELECT 'branch_'||m.public_id,m.id,m.name||' · Principal',m.address,m.location,CASE WHEN m.status='active' THEN 'active' ELSE 'paused' END,m.open,m.eta_min,m.service_radius_m,true FROM merchants m;
INSERT INTO catalog_branch_inventory(branch_id,catalog_item_id,available,stock_quantity)
SELECT b.id,c.id,c.available,c.inventory_quantity FROM merchant_branches b JOIN catalog_items c ON c.merchant_id=b.merchant_id;
UPDATE jobs j SET branch_id=b.id FROM merchant_branches b WHERE b.merchant_id=j.merchant_id AND b.is_primary AND j.branch_id IS NULL;
CREATE INDEX jobs_branch_created_idx ON jobs(branch_id,created_at DESC);

ALTER TABLE merchant_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_branch_inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY merchant_branches_visible ON merchant_branches USING(status<>'closed' OR app.has_role('admin') OR merchant_id IN(SELECT id FROM merchants WHERE owner_id=app.current_user_id()));
CREATE POLICY catalog_branch_inventory_visible ON catalog_branch_inventory USING(EXISTS(SELECT 1 FROM merchant_branches b WHERE b.id=branch_id));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  CREATE POLICY merchant_branches_runtime_service ON merchant_branches TO flash_runtime USING(true) WITH CHECK(true);
  CREATE POLICY catalog_branch_inventory_runtime_service ON catalog_branch_inventory TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT ON merchant_branches,catalog_branch_inventory TO flash_rls_audit;
 END IF;
END $$;
