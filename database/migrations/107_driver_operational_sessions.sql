CREATE TABLE driver_availability_sessions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE DEFAULT ('DAV-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,16))),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  service_mode job_kind NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  start_reason text NOT NULL CHECK(start_reason IN('migration_baseline','driver_online','mode_switch')),
  end_reason text CHECK(end_reason IN('offline','mode_switch','system_recovery')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(ended_at IS NULL OR ended_at>=started_at),
  CHECK((ended_at IS NULL AND end_reason IS NULL) OR (ended_at IS NOT NULL AND end_reason IS NOT NULL))
);

CREATE UNIQUE INDEX driver_availability_one_open_idx
  ON driver_availability_sessions(driver_id) WHERE ended_at IS NULL;
CREATE INDEX driver_availability_history_idx
  ON driver_availability_sessions(driver_id,started_at DESC);

CREATE TABLE driver_job_sessions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE DEFAULT ('DJS-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,16))),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  service_mode job_kind NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  start_reason text NOT NULL CHECK(start_reason IN('migration_baseline','offer_accepted','reassigned','system_recovery')),
  end_reason text CHECK(end_reason IN('completed','cancelled','reassigned','system_recovery')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(ended_at IS NULL OR ended_at>=started_at),
  CHECK((ended_at IS NULL AND end_reason IS NULL) OR (ended_at IS NOT NULL AND end_reason IS NOT NULL))
);

CREATE UNIQUE INDEX driver_job_one_open_idx
  ON driver_job_sessions(job_id) WHERE ended_at IS NULL;
CREATE INDEX driver_job_driver_history_idx
  ON driver_job_sessions(driver_id,started_at DESC);

INSERT INTO driver_availability_sessions(driver_id,service_mode,started_at,start_reason)
SELECT id,active_mode,now(),'migration_baseline'
FROM drivers
WHERE online;

INSERT INTO driver_job_sessions(driver_id,job_id,service_mode,started_at,start_reason)
SELECT driver_id,id,kind,now(),'migration_baseline'
FROM jobs
WHERE driver_id IS NOT NULL AND status NOT IN('completed','cancelled');

CREATE OR REPLACE FUNCTION app.track_driver_availability_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.online THEN
    UPDATE driver_availability_sessions
      SET ended_at=now(),end_reason='system_recovery'
      WHERE driver_id=NEW.id AND ended_at IS NULL;
    INSERT INTO driver_availability_sessions(driver_id,service_mode,start_reason)
      VALUES(NEW.id,NEW.active_mode,'driver_online');
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.track_driver_availability_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.online AND NOT NEW.online THEN
    UPDATE driver_availability_sessions
      SET ended_at=now(),end_reason='offline'
      WHERE driver_id=NEW.id AND ended_at IS NULL;
  ELSIF NOT OLD.online AND NEW.online THEN
    UPDATE driver_availability_sessions
      SET ended_at=now(),end_reason='system_recovery'
      WHERE driver_id=NEW.id AND ended_at IS NULL;
    INSERT INTO driver_availability_sessions(driver_id,service_mode,start_reason)
      VALUES(NEW.id,NEW.active_mode,'driver_online');
  ELSIF OLD.online AND NEW.online AND OLD.active_mode IS DISTINCT FROM NEW.active_mode THEN
    UPDATE driver_availability_sessions
      SET ended_at=now(),end_reason='mode_switch'
      WHERE driver_id=NEW.id AND ended_at IS NULL;
    INSERT INTO driver_availability_sessions(driver_id,service_mode,start_reason)
      VALUES(NEW.id,NEW.active_mode,'mode_switch');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER drivers_track_availability_insert
AFTER INSERT ON drivers FOR EACH ROW
EXECUTE FUNCTION app.track_driver_availability_insert();

CREATE TRIGGER drivers_track_availability_update
AFTER UPDATE OF online,active_mode ON drivers FOR EACH ROW
EXECUTE FUNCTION app.track_driver_availability_update();

CREATE OR REPLACE FUNCTION app.track_driver_job_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.driver_id IS NOT NULL AND NEW.status NOT IN('completed','cancelled') THEN
    UPDATE driver_job_sessions
      SET ended_at=now(),end_reason='system_recovery'
      WHERE job_id=NEW.id AND ended_at IS NULL;
    INSERT INTO driver_job_sessions(driver_id,job_id,service_mode,start_reason)
      VALUES(NEW.driver_id,NEW.id,NEW.kind,'offer_accepted');
  END IF;
  RETURN NEW;
END $$;

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
          WHEN OLD.driver_id IS DISTINCT FROM NEW.driver_id AND OLD.driver_id IS NOT NULL THEN 'reassigned'
          ELSE 'system_recovery'
        END
      );
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER jobs_track_driver_session_insert
AFTER INSERT ON jobs FOR EACH ROW
EXECUTE FUNCTION app.track_driver_job_insert();

CREATE TRIGGER jobs_track_driver_session_update
AFTER UPDATE OF driver_id,status ON jobs FOR EACH ROW
EXECUTE FUNCTION app.track_driver_job_update();

ALTER TABLE driver_availability_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_job_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY driver_availability_sessions_participant ON driver_availability_sessions
  USING(
    EXISTS(SELECT 1 FROM drivers d WHERE d.id=driver_id AND d.user_id=app.current_user_id())
    OR app.has_role('admin') OR app.has_role('support')
  );
CREATE POLICY driver_job_sessions_participant ON driver_job_sessions
  USING(
    EXISTS(SELECT 1 FROM drivers d WHERE d.id=driver_id AND d.user_id=app.current_user_id())
    OR app.has_role('admin') OR app.has_role('support')
  );

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
    GRANT SELECT,INSERT,UPDATE ON driver_availability_sessions,driver_job_sessions TO flash_runtime;
    CREATE POLICY driver_availability_sessions_runtime_service ON driver_availability_sessions TO flash_runtime USING(true) WITH CHECK(true);
    CREATE POLICY driver_job_sessions_runtime_service ON driver_job_sessions TO flash_runtime USING(true) WITH CHECK(true);
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
    GRANT SELECT(id,public_id,driver_id,service_mode,started_at,ended_at,start_reason,end_reason,created_at)
      ON driver_availability_sessions TO flash_rls_audit;
    GRANT SELECT(id,public_id,driver_id,job_id,service_mode,started_at,ended_at,start_reason,end_reason,created_at)
      ON driver_job_sessions TO flash_rls_audit;
  END IF;
END $$;

COMMENT ON TABLE driver_availability_sessions IS 'Auditable driver online intervals. Migration baselines begin at deployment and never infer historical time.';
COMMENT ON TABLE driver_job_sessions IS 'Auditable assignment-to-terminal driver work intervals; duration consumers must union overlaps to avoid double counting.';
