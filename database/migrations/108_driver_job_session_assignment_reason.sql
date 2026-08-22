CREATE OR REPLACE FUNCTION app.track_driver_job_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_active boolean := OLD.driver_id IS NOT NULL AND OLD.status NOT IN('completed','cancelled');
  new_active boolean := NEW.driver_id IS NOT NULL AND NEW.status NOT IN('completed','cancelled');
  close_reason text;
BEGIN
  IF old_active AND (NOT new_active OR OLD.driver_id IS DISTINCT FROM NEW.driver_id) THEN
    close_reason := CASE
      WHEN NEW.status='completed' THEN 'completed'
      WHEN NEW.status='cancelled' THEN 'cancelled'
      WHEN OLD.driver_id IS DISTINCT FROM NEW.driver_id THEN 'reassigned'
      ELSE 'system_recovery'
    END;
    UPDATE driver_job_sessions
      SET ended_at=now(),end_reason=close_reason
      WHERE job_id=NEW.id AND driver_id=OLD.driver_id AND ended_at IS NULL;
  END IF;

  IF new_active AND (NOT old_active OR OLD.driver_id IS DISTINCT FROM NEW.driver_id) THEN
    UPDATE driver_job_sessions
      SET ended_at=now(),end_reason='system_recovery'
      WHERE job_id=NEW.id AND ended_at IS NULL;
    INSERT INTO driver_job_sessions(driver_id,job_id,service_mode,start_reason)
      VALUES(
        NEW.driver_id,
        NEW.id,
        NEW.kind,
        CASE
          WHEN OLD.driver_id IS NULL THEN 'offer_accepted'
          WHEN OLD.driver_id IS DISTINCT FROM NEW.driver_id THEN 'reassigned'
          ELSE 'system_recovery'
        END
      );
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION app.track_driver_job_update() IS 'Attributes first assignment as offer acceptance, later driver changes as reassignment, and reopened terminal work as recovery.';
