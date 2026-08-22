CREATE TABLE pricing_plans(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL CHECK(service IN('ride','shipment')),
  version text NOT NULL,
  currency char(3) NOT NULL DEFAULT 'ARS',
  config jsonb NOT NULL CHECK(jsonb_typeof(config)='object'),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(service,version),
  CHECK(effective_until IS NULL OR effective_until>effective_from)
);
CREATE UNIQUE INDEX pricing_plans_one_active_idx ON pricing_plans(service) WHERE active;

INSERT INTO pricing_plans(service,version,config) VALUES
('ride','AR-BA-RIDE-2026.08',jsonb_build_object(
  'baseFare',850,'distancePerKm',420,'timePerMin',48,'serviceFee',390,
  'tollThresholdKm',18,'tollAmount',850,'roadFactor',1.22,'minDistanceKm',1.2,'maxDistanceKm',50,
  'durationBaseMin',8,'durationPerKm',2.1,'etaBaseMin',4,'etaPerKm',0.55,
  'serviceMultipliers',jsonb_build_object('moto',0.78,'economy',1,'comfort',1.28,'xl',1.65))),
('shipment','AR-BA-SHIPMENT-2026.08',jsonb_build_object(
  'baseFare',1200,'distancePerKm',540,'weightPerKg',85,'roadFactor',1.22,
  'minDistanceKm',1,'maxDistanceKm',45,'etaBaseMin',12,'etaPerKm',2.2,'minimumEtaMin',15,
  'sizeMultipliers',jsonb_build_object('small',1,'medium',1.18,'large',1.42)));

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN GRANT SELECT ON pricing_plans TO flash_rls_audit; END IF;
END $$;
