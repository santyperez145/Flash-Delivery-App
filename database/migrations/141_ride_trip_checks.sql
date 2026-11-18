-- Control del viaje (SEG-01), como RideCheck de Uber.
--
-- Durante un viaje en curso, Flash detecta cuatro señales y le pregunta al
-- pasajero si está todo bien:
--
--   long_stop        el auto no se mueve hace 5 minutos y el GPS sigue llegando;
--   signal_lost      no llega ubicación del conductor hace 3 minutos;
--   route_deviation  el auto se alejó del corredor entre origen y destino;
--   early_end        el viaje se cerró lejos del destino.
--
-- **El corredor es la recta origen-destino con un margen amplio** (el mayor entre
-- 1,5 km y el 35 % del largo del viaje). No se guarda la geometría de la ruta, y
-- una calle real nunca es la recta: el margen evita avisar por un desvío normal y
-- deja pasar sólo un alejamiento evidente. Se dice así en la pantalla: «se alejó
-- del recorrido», no «tomó otra ruta».
--
-- La detección corre en la base (`app.detect_ride_trip_checks`), la llama el
-- worker de despacho en cada vuelta, y un final lejos del destino lo detecta un
-- trigger al cerrar el viaje, por cualquier camino que se cierre.

-- Cuándo se movió por última vez el conductor: el GPS de un auto quieto llega
-- igual, y sin esto una parada larga no se distingue de un viaje normal.
ALTER TABLE drivers
  ADD COLUMN last_moved_at timestamptz,
  ADD COLUMN last_moved_location geography(Point, 4326);

CREATE OR REPLACE FUNCTION app.track_driver_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_location IS NULL THEN RETURN NEW; END IF;
  -- 50 m: más que el error de un GPS de teléfono quieto, menos que una cuadra.
  IF NEW.last_moved_location IS NULL
     OR ST_Distance(NEW.current_location, NEW.last_moved_location) > 50 THEN
    NEW.last_moved_at := now();
    NEW.last_moved_location := NEW.current_location;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER drivers_track_movement
  BEFORE INSERT OR UPDATE OF current_location ON drivers
  FOR EACH ROW EXECUTE FUNCTION app.track_driver_movement();

CREATE TABLE ride_trip_checks(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('long_stop', 'signal_lost', 'route_deviation', 'early_end')),
  location geography(Point, 4326),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'rider_ok', 'help_requested', 'expired')),
  incident_id uuid REFERENCES ride_safety_incidents(id),
  detected_at timestamptz NOT NULL DEFAULT now(),
  -- Cuándo se avisó al pasajero y a operaciones. El worker avisa lo que tenga
  -- `NULL`, venga del barrido o del cierre del viaje.
  notified_at timestamptz,
  responded_at timestamptz,
  CHECK ((status = 'help_requested') = (incident_id IS NOT NULL)),
  CHECK ((status IN ('rider_ok', 'help_requested')) = (responded_at IS NOT NULL))
);
-- Un aviso abierto por señal y viaje: el barrido no repite la misma pregunta.
CREATE UNIQUE INDEX ride_trip_checks_open_idx ON ride_trip_checks(job_id, kind) WHERE status = 'open';
CREATE INDEX ride_trip_checks_job_idx ON ride_trip_checks(job_id, detected_at DESC);
CREATE INDEX ride_trip_checks_pending_notice_idx ON ride_trip_checks(detected_at) WHERE notified_at IS NULL;

ALTER TABLE ride_trip_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY ride_trip_checks_participant ON ride_trip_checks
  USING (
    EXISTS (SELECT 1 FROM jobs j WHERE j.id = job_id AND j.customer_id = app.current_user_id())
    OR app.has_role('admin') OR app.has_role('support')
  )
  WITH CHECK (app.has_role('admin') OR app.has_role('support'));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_runtime') THEN
    -- Sin INSERT: los avisos los crean el barrido y el trigger de cierre, que son
    -- SECURITY DEFINER. El runtime sólo los lee, marca avisados y anota la respuesta.
    GRANT SELECT, UPDATE ON ride_trip_checks TO flash_runtime;
    CREATE POLICY ride_trip_checks_runtime_service ON ride_trip_checks TO flash_runtime
      USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_rls_audit') THEN
    GRANT SELECT (id, public_id, job_id, kind, status, detected_at, notified_at, responded_at)
      ON ride_trip_checks TO flash_rls_audit;
    GRANT SELECT (last_moved_at) ON drivers TO flash_rls_audit;
  END IF;
END $$;

-- El barrido: inserta los avisos nuevos y devuelve cuántos. Avisarlos es del
-- worker, que toma todo lo que tenga `notified_at` vacío.
--
-- Una señal ya contestada no se repite antes de 10 minutos: quien dijo «estoy
-- bien» en un embotellamiento no tiene que volver a contestarlo al minuto.
CREATE OR REPLACE FUNCTION app.detect_ride_trip_checks(
  stop_after interval DEFAULT interval '5 minutes',
  signal_after interval DEFAULT interval '3 minutes',
  quiet_after_answer interval DEFAULT interval '10 minutes',
  -- Sólo para pruebas: acota el barrido a un viaje y no toca los demás.
  only_job uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
DECLARE created integer;
BEGIN
  WITH rides AS (
    SELECT j.id, j.pickup_location, j.dropoff_location,
      d.current_location, d.location_updated_at, d.last_moved_at
    FROM jobs j JOIN drivers d ON d.id = j.driver_id
    WHERE j.kind = 'ride' AND j.status = 'in_progress' AND (only_job IS NULL OR j.id = only_job)
  ),
  signals AS (
    SELECT r.id, 'signal_lost'::text AS kind, r.current_location
    FROM rides r
    WHERE r.location_updated_at IS NULL OR r.location_updated_at < now() - signal_after
    UNION ALL
    SELECT r.id, 'long_stop', r.current_location
    FROM rides r
    WHERE r.location_updated_at >= now() - signal_after
      AND r.last_moved_at < now() - stop_after
    UNION ALL
    SELECT r.id, 'route_deviation', r.current_location
    FROM rides r
    WHERE r.location_updated_at >= now() - signal_after
      AND r.current_location IS NOT NULL
      AND r.pickup_location IS NOT NULL AND r.dropoff_location IS NOT NULL
      AND ST_Distance(
        r.current_location,
        ST_MakeLine(r.pickup_location::geometry, r.dropoff_location::geometry)::geography
      ) > greatest(1500, 0.35 * ST_Distance(r.pickup_location, r.dropoff_location))
  ),
  fresh AS (
    SELECT s.* FROM signals s
    WHERE NOT EXISTS (
      SELECT 1 FROM ride_trip_checks c
      WHERE c.job_id = s.id AND c.kind = s.kind
        AND (c.status = 'open' OR coalesce(c.responded_at, c.detected_at) > now() - quiet_after_answer)
    )
  ),
  inserted AS (
    INSERT INTO ride_trip_checks(public_id, job_id, kind, location)
    SELECT 'TCK-' || upper(substr(md5(random()::text || f.id::text || f.kind), 1, 10)),
      f.id, f.kind, f.current_location
    FROM fresh f
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer INTO created FROM inserted;
  RETURN created;
END $$;

-- Al cerrar o cancelar: los avisos abiertos vencen, y un cierre lejos del destino
-- (más de 500 m) abre uno propio, que el pasajero contesta después del viaje.
CREATE OR REPLACE FUNCTION app.ride_trip_checks_on_close() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
DECLARE driver_location geography;
BEGIN
  IF NEW.kind <> 'ride' OR NEW.status NOT IN ('completed', 'cancelled')
     OR OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  UPDATE ride_trip_checks SET status = 'expired' WHERE job_id = NEW.id AND status = 'open';
  IF NEW.status = 'completed' AND OLD.status = 'in_progress' AND NEW.dropoff_location IS NOT NULL THEN
    SELECT current_location INTO driver_location FROM drivers WHERE id = NEW.driver_id;
    IF driver_location IS NOT NULL AND ST_Distance(driver_location, NEW.dropoff_location) > 500 THEN
      INSERT INTO ride_trip_checks(public_id, job_id, kind, location)
      VALUES ('TCK-' || upper(substr(md5(random()::text || NEW.id::text), 1, 10)), NEW.id, 'early_end', driver_location);
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER jobs_ride_trip_checks_on_close
  AFTER UPDATE OF status ON jobs
  FOR EACH ROW EXECUTE FUNCTION app.ride_trip_checks_on_close();

-- Las funciones SECURITY DEFINER no quedan abiertas a cualquiera: el barrido lo
-- llama sólo el runtime, y las de trigger no se llaman a mano.
REVOKE EXECUTE ON FUNCTION app.detect_ride_trip_checks(interval, interval, interval, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.ride_trip_checks_on_close() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_runtime') THEN
    GRANT EXECUTE ON FUNCTION app.detect_ride_trip_checks(interval, interval, interval, uuid) TO flash_runtime;
  END IF;
END $$;

COMMENT ON TABLE ride_trip_checks IS
  'SEG-01: señales del viaje (parada larga, señal perdida, desvío, final lejos del destino) y la respuesta del pasajero.';
