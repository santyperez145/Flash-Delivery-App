-- Las dos promociones que la migración 015 sembró en toda base («40% off en
-- seleccionados» y «Viajes al aeropuerto») eran datos de demostración: aparecían en una
-- base recién creada, sin comercios ni campaña real detrás, como una oferta vigente.
-- Una promoción la crea la operación desde la consola, con su presupuesto.
--
-- Se apagan sólo si nadie las usó: una que ya tiene canjes es una campaña real de esa
-- base y se respeta. Las semillas de desarrollo (`db:seed:commerce`) las vuelven a
-- crear activas para las pruebas.
UPDATE promotions p SET active = false
WHERE p.public_id IN ('promo_food_40', 'promo_ride_airport')
  AND NOT EXISTS (SELECT 1 FROM promotion_redemptions r WHERE r.promotion_id = p.id);
