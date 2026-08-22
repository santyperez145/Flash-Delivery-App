CREATE TABLE shipment_item_categories(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK(code ~ '^[a-z][a-z0-9_]{1,31}$'),
  name text NOT NULL,
  handling_instructions text NOT NULL,
  surcharge_cents bigint NOT NULL DEFAULT 0 CHECK(surcharge_cents>=0),
  maximum_weight_grams integer NOT NULL CHECK(maximum_weight_grams BETWEEN 1 AND 20000),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shipment_service_levels(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK(code ~ '^[a-z][a-z0-9_]{1,31}$'),
  name text NOT NULL,
  transport_multiplier numeric(6,3) NOT NULL CHECK(transport_multiplier BETWEEN .5 AND 5),
  eta_multiplier numeric(6,3) NOT NULL CHECK(eta_multiplier BETWEEN .25 AND 3),
  maximum_distance_m integer CHECK(maximum_distance_m>0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO shipment_item_categories(code,name,handling_instructions,surcharge_cents,maximum_weight_grams) VALUES
 ('documents','Documentos','Mantener seco y entregar en mano.',0,5000),
 ('standard','Paquete estándar','Transportar cerrado y sin apilar cargas pesadas.',0,20000),
 ('fragile','Frágil','No apilar, evitar golpes y mantener en posición estable.',35000,12000),
 ('electronics','Electrónica','Mantener seco, no exponer al calor y entregar en mano.',50000,10000);

INSERT INTO shipment_service_levels(code,name,transport_multiplier,eta_multiplier,maximum_distance_m) VALUES
 ('economy','Economy',.900,1.350,NULL),
 ('standard','Standard',1.000,1.000,NULL),
 ('priority','Priority',1.350,.750,30000),
 ('express','Express',1.650,.550,15000);

ALTER TABLE shipment_details
  ADD COLUMN item_category_id uuid REFERENCES shipment_item_categories(id),
  ADD COLUMN service_level_id uuid REFERENCES shipment_service_levels(id);

UPDATE shipment_details
SET item_category_id=(SELECT id FROM shipment_item_categories WHERE code='standard'),
    service_level_id=(SELECT id FROM shipment_service_levels WHERE code='standard');

ALTER TABLE shipment_details
  ALTER COLUMN item_category_id SET NOT NULL,
  ALTER COLUMN service_level_id SET NOT NULL;

ALTER TABLE shipment_item_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_service_levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY shipment_item_categories_public_read ON shipment_item_categories FOR SELECT USING(active);
CREATE POLICY shipment_service_levels_public_read ON shipment_service_levels FOR SELECT USING(active);
CREATE POLICY shipment_item_categories_admin ON shipment_item_categories USING(app.has_role('admin')) WITH CHECK(app.has_role('admin'));
CREATE POLICY shipment_service_levels_admin ON shipment_service_levels USING(app.has_role('admin')) WITH CHECK(app.has_role('admin'));

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON shipment_item_categories,shipment_service_levels TO flash_runtime;
  CREATE POLICY shipment_item_categories_runtime ON shipment_item_categories TO flash_runtime USING(true) WITH CHECK(true);
  CREATE POLICY shipment_service_levels_runtime ON shipment_service_levels TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT ON shipment_item_categories,shipment_service_levels TO flash_rls_audit;
 END IF;
END $$;

CREATE INDEX shipment_item_categories_active_idx ON shipment_item_categories(code) WHERE active;
CREATE INDEX shipment_service_levels_active_idx ON shipment_service_levels(code) WHERE active;
