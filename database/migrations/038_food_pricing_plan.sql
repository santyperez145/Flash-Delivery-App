ALTER TABLE pricing_plans DROP CONSTRAINT pricing_plans_service_check;
ALTER TABLE pricing_plans ADD CONSTRAINT pricing_plans_service_check CHECK(service IN('food','ride','shipment'));

INSERT INTO pricing_plans(service,version,config) VALUES('food','AR-BA-FOOD-2026.08',jsonb_build_object(
  'baseDeliveryFee',320,'distancePerKm',115,'minimumDeliveryFee',520,'maximumDeliveryFee',3200,
  'serviceFee',520,'roadFactor',1.18,'maximumDistanceKm',18
));
