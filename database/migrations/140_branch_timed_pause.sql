-- Pausa temporal del comercio, con motivo (RES-07).
--
-- Uber Eats Orders deja pausar los pedidos por un tiempo elegido y con un motivo,
-- y reanudar solo al vencer (merchants.ubereats.com, «How to use Uber Eats
-- Orders»). Flash tenía un único interruptor de abrir o cerrar: una pausa por un
-- pico de demanda quedaba abierta hasta que alguien se acordara de volver.
--
-- **La pausa vive en `app.branch_is_scheduled_open`.** Catálogo, búsqueda, panel
-- del comercio, alta del pedido y retiro ya preguntan ahí si una sucursal atiende:
-- con la pausa adentro, todos la respetan sin tocar cada consulta, y al pasar
-- `paused_until` la sucursal vuelve a atender sin que ningún proceso la reabra.
-- El interruptor `open` sigue siendo el cierre sin fecha.
ALTER TABLE merchant_branches
  ADD COLUMN paused_until timestamptz,
  ADD COLUMN pause_reason text
    CHECK (pause_reason IS NULL OR pause_reason IN ('high_demand', 'staff', 'kitchen', 'other'));
ALTER TABLE merchant_branches ADD CONSTRAINT merchant_branches_pause_with_reason
  CHECK ((paused_until IS NULL) = (pause_reason IS NULL));

CREATE OR REPLACE FUNCTION app.branch_is_scheduled_open(target_branch uuid,at_time timestamptz DEFAULT now()) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE branch_tz text; local_now timestamp; today_exception branch_schedule_exceptions%ROWTYPE; previous_exception branch_schedule_exceptions%ROWTYPE; today_hours branch_operating_hours%ROWTYPE; previous_hours branch_operating_hours%ROWTYPE;
BEGIN
 -- RES-07: una pausa temporal vigente cierra la sucursal, y al vencer reabre sola.
 IF EXISTS(SELECT 1 FROM merchant_branches WHERE id=target_branch AND paused_until>at_time) THEN RETURN false; END IF;
 SELECT timezone INTO branch_tz FROM merchant_branches WHERE id=target_branch;
 IF branch_tz IS NULL THEN RETURN false; END IF;
 BEGIN local_now:=at_time AT TIME ZONE branch_tz; EXCEPTION WHEN invalid_parameter_value THEN RETURN false; END;
 SELECT * INTO today_exception FROM branch_schedule_exceptions WHERE branch_id=target_branch AND local_date=local_now::date;
 IF FOUND THEN
  IF NOT today_exception.is_open THEN RETURN false; END IF;
  IF today_exception.opens_at=today_exception.closes_at THEN RETURN true; END IF;
  IF today_exception.closes_at>today_exception.opens_at THEN RETURN local_now::time>=today_exception.opens_at AND local_now::time<today_exception.closes_at; END IF;
  RETURN local_now::time>=today_exception.opens_at OR local_now::time<today_exception.closes_at;
 END IF;
 SELECT * INTO previous_exception FROM branch_schedule_exceptions WHERE branch_id=target_branch AND local_date=(local_now::date-1);
 IF FOUND THEN RETURN previous_exception.is_open AND previous_exception.closes_at<previous_exception.opens_at AND local_now::time<previous_exception.closes_at; END IF;
 SELECT * INTO today_hours FROM branch_operating_hours WHERE branch_id=target_branch AND weekday=extract(dow FROM local_now)::smallint AND enabled;
 IF FOUND THEN
  IF today_hours.opens_at=today_hours.closes_at THEN RETURN true; END IF;
  IF today_hours.closes_at>today_hours.opens_at AND local_now::time>=today_hours.opens_at AND local_now::time<today_hours.closes_at THEN RETURN true; END IF;
  IF today_hours.closes_at<today_hours.opens_at AND local_now::time>=today_hours.opens_at THEN RETURN true; END IF;
 END IF;
 SELECT * INTO previous_hours FROM branch_operating_hours WHERE branch_id=target_branch AND weekday=((extract(dow FROM local_now)::int+6)%7)::smallint AND enabled;
 RETURN FOUND AND previous_hours.closes_at<previous_hours.opens_at AND local_now::time<previous_hours.closes_at;
END $$;
