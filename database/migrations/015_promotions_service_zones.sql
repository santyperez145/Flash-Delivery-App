ALTER TABLE promotions ADD COLUMN public_id text;
ALTER TABLE promotions ADD COLUMN description text NOT NULL DEFAULT '';
UPDATE promotions SET public_id='PROMO-'||upper(substr(replace(id::text,'-',''),1,8)) WHERE public_id IS NULL;
ALTER TABLE promotions ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE promotions ADD CONSTRAINT promotions_public_id_unique UNIQUE(public_id);

CREATE TABLE service_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  name text NOT NULL,
  boundary geography(Polygon,4326) NOT NULL,
  demand_level text NOT NULL DEFAULT 'medium' CHECK(demand_level IN('low','medium','high')),
  delivery_multiplier numeric(4,2) NOT NULL DEFAULT 1 CHECK(delivery_multiplier BETWEEN 0.5 AND 3),
  ride_multiplier numeric(4,2) NOT NULL DEFAULT 1 CHECK(ride_multiplier BETWEEN 0.5 AND 3),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_zones_boundary_gix ON service_zones USING gist(boundary);

INSERT INTO promotions(public_id,code,name,description,kind,value,max_discount_cents,min_subtotal_cents,usage_limit,per_user_limit,starts_at,ends_at,rules,active)
VALUES
 ('promo_food_40','FLASH40','40% off en seleccionados','Tope de reintegro $4.000 con Flash Wallet.','percentage',40,400000,500000,10000,1,'2026-01-01','2027-01-01','{"service":"food","paymentMethod":"flash_wallet"}',true),
 ('promo_ride_airport','AERO15','Viajes al aeropuerto','15% en viajes elegibles hacia o desde aeropuertos.','percentage',15,500000,0,5000,2,'2026-01-01','2027-01-01','{"service":"ride","airport":true}',true)
ON CONFLICT(public_id) DO NOTHING;

INSERT INTO service_zones(public_id,name,boundary,demand_level,delivery_multiplier,ride_multiplier) VALUES
 ('zone_palermo','Palermo',ST_GeogFromText('SRID=4326;POLYGON((-58.459 -34.603,-58.392 -34.603,-58.392 -34.548,-58.459 -34.548,-58.459 -34.603))'),'high',1.20,1.15),
 ('zone_centro','Centro',ST_GeogFromText('SRID=4326;POLYGON((-58.405 -34.626,-58.360 -34.626,-58.360 -34.586,-58.405 -34.586,-58.405 -34.626))'),'medium',1.05,1.12),
 ('zone_santelmo','San Telmo',ST_GeogFromText('SRID=4326;POLYGON((-58.391 -34.640,-58.354 -34.640,-58.354 -34.612,-58.391 -34.612,-58.391 -34.640))'),'medium',1.08,1.04)
ON CONFLICT(public_id) DO NOTHING;
