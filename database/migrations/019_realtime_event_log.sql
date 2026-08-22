CREATE TABLE realtime_events(
  sequence_id bigserial PRIMARY KEY,
  public_id text NOT NULL UNIQUE,
  type text NOT NULL,
  entity_type text,
  entity_id text,
  action text,
  request_id text,
  actor_public_id text,
  audience_user_ids text[] NOT NULL DEFAULT '{}',
  audience_roles text[] NOT NULL DEFAULT '{}',
  payload jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX realtime_events_occurred_idx ON realtime_events(occurred_at);
CREATE INDEX realtime_events_audience_users_gin ON realtime_events USING gin(audience_user_ids);
CREATE INDEX realtime_events_audience_roles_gin ON realtime_events USING gin(audience_roles);

CREATE OR REPLACE FUNCTION app.notify_realtime_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('flash_realtime',NEW.sequence_id::text);
  RETURN NEW;
END $$;
CREATE TRIGGER realtime_events_notify AFTER INSERT ON realtime_events FOR EACH ROW EXECUTE FUNCTION app.notify_realtime_event();

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,DELETE ON realtime_events TO flash_runtime;
  GRANT USAGE,SELECT ON SEQUENCE realtime_events_sequence_id_seq TO flash_runtime;
 END IF;
END $$;
