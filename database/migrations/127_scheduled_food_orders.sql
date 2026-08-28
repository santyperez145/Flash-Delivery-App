-- Pedidos de comida programados y reprogramables (GTM-001, tercer hueco).
--
-- `jobs.scheduled_for` existe desde la migracion 001 y **solo lo escribia el
-- router de viajes**. Un pedido de comida no se podia programar en absoluto,
-- aunque la portada del cliente prometia «Programar - Food o taxi» desde antes
-- de que existiera la mitad de comida de esa promesa.
--
-- Y nada, ni viaje ni pedido, se podia mover de hora: la unica salida era
-- cancelar y volver a pedir, que ademas le cuenta la cancelacion al cliente.
--
-- La migracion 022 creo el indice equivalente para viajes. Este es su gemelo
-- para comida, y por el mismo motivo: el despacho barre por horario cada pocos
-- segundos, y sin indice ese barrido recorre la tabla entera de trabajos.
CREATE INDEX jobs_scheduled_food_idx
  ON jobs(scheduled_for, created_at)
  WHERE kind='delivery' AND driver_id IS NULL AND scheduled_for IS NOT NULL;

-- Un horario de reserva en el pasado no se rechaza acá: `now()` no es inmutable
-- y no puede vivir en un CHECK. Lo que si se puede exigir es que un trabajo
-- programado no arranque ya asignado, que es la unica forma de que un pedido
-- entre a despacho antes de su ventana.
COMMENT ON COLUMN jobs.scheduled_for IS
  'Horario reservado. NULL significa «lo antes posible». El despacho solo considera un trabajo cuando falta menos de 15 minutos, y reprogramar solo se admite en estado requested o accepted: despues, mover la hora tira comida o le hace perder el viaje a un conductor.';
