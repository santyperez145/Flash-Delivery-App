-- Pedidos agrupados (P-03), como los lotes de Uber Eats y los pedidos apilados de
-- DoorDash.
--
-- Cuando un repartidor va a buscar un pedido a un local y otro pedido del **mismo
-- local** está listo, con la entrega en el camino, se le ofrece sumarlo: retira los
-- dos juntos y entrega primero el que ya llevaba. El segundo pedido apunta al primero
-- (`batch_anchor_id`): el primero es la entrega 1 y el segundo la 2. Se agrupan como
-- mucho dos pedidos.
--
-- **El primer cliente no espera de más**: su pedido se entrega primero y el desvío
-- sólo lo absorbe el segundo, que recibe un horario estimado que ya lo cuenta.
--
-- Si uno de los dos se cancela, el otro sigue solo: las vistas sólo muestran el lote
-- mientras los dos están en curso.
ALTER TABLE jobs ADD COLUMN batch_anchor_id uuid REFERENCES jobs(id) ON DELETE SET NULL;
COMMENT ON COLUMN jobs.batch_anchor_id IS
  'P-03: en un pedido agrupado, el pedido que el repartidor ya llevaba y que se entrega primero.';
-- Un pedido sostiene a lo sumo un segundo pedido en curso.
CREATE UNIQUE INDEX jobs_one_batch_follower ON jobs(batch_anchor_id)
  WHERE batch_anchor_id IS NOT NULL AND status NOT IN ('completed', 'cancelled');
-- Las sucursales con pedidos asignados y todavía sin retirar: la búsqueda de lotes.
CREATE INDEX jobs_branch_assigned_food_idx ON jobs(branch_id, status)
  WHERE kind = 'delivery' AND driver_id IS NOT NULL AND status IN ('driver_assigned', 'arriving');

-- El lote se deshace solo cuando deja de existir: si se cancela uno de los dos, o la
-- operación le saca el pedido al repartidor (vuelve a la cola), el que queda sigue solo.
-- Se hace acá y no en cada camino de cancelación o liberación, que son varios: un
-- vínculo viejo mostraría «Entrega 2 de 2» a un repartidor que lleva uno solo, le diría
-- a un cliente que su pedido va segundo, impediría volver a agrupar el pedido y le
-- sumaría el desvío dos veces. Al deshacerse, el horario estimado del segundo pierde
-- los minutos de desvío que se le habían sumado.
CREATE OR REPLACE FUNCTION app.undo_food_order_batch() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_catalog, pg_temp AS $$
DECLARE
  liberado boolean := OLD.driver_id IS NOT NULL AND NEW.driver_id IS NULL;
  cancelado boolean := NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled';
BEGIN
  IF NOT (liberado OR cancelado) THEN
    RETURN NEW;
  END IF;
  -- El pedido que se libera deja de ser el segundo de su lote.
  IF liberado AND NEW.batch_anchor_id IS NOT NULL THEN
    NEW.batch_anchor_id := NULL;
    NEW.metadata := jsonb_set(NEW.metadata - 'batch', '{etaMin}', to_jsonb(GREATEST(0,
      COALESCE((NEW.metadata->>'etaMin')::int, 0)
        - COALESCE((NEW.metadata->'batch'->>'extraMinutes')::int, 0))));
  END IF;
  -- El segundo de un pedido que se cancela o se libera queda solo, y se entrega sin
  -- desvío.
  UPDATE jobs SET batch_anchor_id = NULL,
    metadata = jsonb_set(metadata - 'batch', '{etaMin}', to_jsonb(GREATEST(0,
      COALESCE((metadata->>'etaMin')::int, 0)
        - COALESCE((metadata->'batch'->>'extraMinutes')::int, 0))))
  WHERE batch_anchor_id = NEW.id AND status NOT IN ('completed', 'cancelled');
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION app.undo_food_order_batch() FROM PUBLIC;
CREATE TRIGGER jobs_undo_food_order_batch
  BEFORE UPDATE OF status, driver_id ON jobs
  FOR EACH ROW EXECUTE FUNCTION app.undo_food_order_batch();
