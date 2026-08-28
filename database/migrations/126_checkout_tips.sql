-- Propina en el checkout (ticket GTM-001, segundo hueco comercial).
--
-- Hasta ahora la propina solo existia despues de entregar: `tip-repository.js`
-- la rechazaba si el servicio no estaba `completed`. La competencia la pide en
-- el checkout, antes de asignar conductor, y eso sube la tasa de propina — que
-- es la ganancia por viaje del repartidor, la variable con la que se compite por
-- oferta de reparto.
--
-- **El problema real no es la pantalla, es que en el checkout todavia no hay a
-- quien pagarle.** El pedido no tiene conductor asignado. Entonces la propina no
-- se transfiere: se cobra junto con el pedido —un solo cargo, no dos— y queda
-- retenida hasta que hay un conductor y el servicio se completa.
--
-- Eso obliga a que una propina pueda existir sin destinatario, que es lo que
-- esta migracion habilita. Antes `driver_id` y `ledger_transaction_id` eran
-- obligatorios, y con razon: toda propina que existia ya estaba pagada.
ALTER TABLE service_tips ALTER COLUMN driver_id DROP NOT NULL;
ALTER TABLE service_tips ALTER COLUMN ledger_transaction_id DROP NOT NULL;

-- `released` por omision: todas las filas que existen hoy son propinas dadas
-- despues de completar, o sea ya liberadas. Un default 'held' las convertiria
-- retroactivamente en dinero pendiente de pagar que en realidad ya se pago.
ALTER TABLE service_tips
  ADD COLUMN status text NOT NULL DEFAULT 'released'
    CHECK(status IN('held','released','refunded')),
  ADD COLUMN settled_at timestamptz;

-- Una propina liberada tiene destinatario y asiento contable. Sin esta
-- restriccion, un error de liberacion dejaria una fila que dice «pagada» sin
-- rastro de a quien ni con que asiento, y no habria forma de distinguirla de una
-- pagada de verdad.
ALTER TABLE service_tips ADD CONSTRAINT service_tips_released_has_destination
  CHECK(status <> 'released' OR (driver_id IS NOT NULL AND ledger_transaction_id IS NOT NULL));

-- Buscar lo retenido de un pedido es la consulta caliente: la liquidacion la
-- hace en cada cierre.
CREATE INDEX service_tips_held_idx ON service_tips(job_id) WHERE status = 'held';

COMMENT ON COLUMN service_tips.status IS
  'held: cobrada con el pedido y sin conductor todavia. released: pagada al conductor. refunded: devuelta al cliente porque el pedido no llego a completarse.';
