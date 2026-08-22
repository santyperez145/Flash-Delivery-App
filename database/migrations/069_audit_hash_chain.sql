ALTER TABLE audit_events
  ADD COLUMN previous_hash text,
  ADD COLUMN event_hash text;

CREATE OR REPLACE FUNCTION app.audit_event_hash(
  p_previous_hash text,p_actor_id uuid,p_actor_roles user_role[],p_action text,
  p_entity_type text,p_entity_id text,p_request_id text,p_ip_hash text,
  p_user_agent text,p_before_data jsonb,p_after_data jsonb,p_occurred_at timestamptz
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT encode(digest(convert_to(concat_ws(chr(31),
   COALESCE(p_previous_hash,''),COALESCE(p_actor_id::text,''),COALESCE(p_actor_roles::text,''),
   p_action,p_entity_type,COALESCE(p_entity_id,''),COALESCE(p_request_id,''),COALESCE(p_ip_hash,''),
   COALESCE(p_user_agent,''),COALESCE(p_before_data::text,''),COALESCE(p_after_data::text,''),
   to_char(p_occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
 ),'UTF8'),'sha256'),'hex')
$$;

CREATE OR REPLACE FUNCTION app.enforce_audit_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user='flash_app' AND current_setting('app.audit_maintenance',true)='on' THEN
    PERFORM pg_advisory_xact_lock(hashtext('flash.audit_events.hash_chain'));
    IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE='42501';
END;
$$;

CREATE OR REPLACE FUNCTION app.chain_audit_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('flash.audit_events.hash_chain'));
  SELECT event_hash INTO NEW.previous_hash FROM audit_events ORDER BY id DESC LIMIT 1;
  NEW.event_hash:=app.audit_event_hash(NEW.previous_hash,NEW.actor_id,NEW.actor_roles,NEW.action,
    NEW.entity_type,NEW.entity_id,NEW.request_id,NEW.ip_hash,NEW.user_agent,
    NEW.before_data,NEW.after_data,NEW.occurred_at);
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_events_hash_chain
BEFORE INSERT ON audit_events
FOR EACH ROW EXECUTE FUNCTION app.chain_audit_event();

DO $$
DECLARE event record;prior text:=NULL;calculated text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('flash.audit_events.hash_chain'));
  FOR event IN SELECT * FROM audit_events ORDER BY id LOOP
    calculated:=app.audit_event_hash(prior,event.actor_id,event.actor_roles,event.action,event.entity_type,
      event.entity_id,event.request_id,event.ip_hash,event.user_agent,event.before_data,event.after_data,event.occurred_at);
    UPDATE audit_events SET previous_hash=prior,event_hash=calculated WHERE id=event.id;
    prior:=calculated;
  END LOOP;
END $$;

ALTER TABLE audit_events
  ALTER COLUMN event_hash SET NOT NULL,
  ADD CONSTRAINT audit_events_previous_hash_format CHECK(previous_hash IS NULL OR previous_hash~'^[0-9a-f]{64}$'),
  ADD CONSTRAINT audit_events_event_hash_format CHECK(event_hash~'^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION app.rebuild_audit_chain() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE event record;prior text:=NULL;calculated text;
BEGIN
  IF current_user<>'flash_app' OR current_setting('app.audit_maintenance',true)<>'on' THEN
    RAISE EXCEPTION 'audit maintenance context required' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('flash.audit_events.hash_chain'));
  FOR event IN SELECT * FROM audit_events ORDER BY id LOOP
    calculated:=app.audit_event_hash(prior,event.actor_id,event.actor_roles,event.action,event.entity_type,
      event.entity_id,event.request_id,event.ip_hash,event.user_agent,event.before_data,event.after_data,event.occurred_at);
    UPDATE audit_events SET previous_hash=prior,event_hash=calculated WHERE id=event.id;
    prior:=calculated;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION app.rebuild_audit_chain_after_delete() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN PERFORM app.rebuild_audit_chain(); RETURN NULL; END $$;
CREATE TRIGGER audit_events_rechain_after_maintenance_delete
AFTER DELETE ON audit_events
FOR EACH STATEMENT EXECUTE FUNCTION app.rebuild_audit_chain_after_delete();

CREATE OR REPLACE FUNCTION app.audit_chain_invalid_count() RETURNS bigint
LANGUAGE sql STABLE AS $$
 WITH ordered AS(
  SELECT a.*,lag(event_hash) OVER(ORDER BY id) expected_previous FROM audit_events a
 )
 SELECT count(*) FROM ordered
 WHERE previous_hash IS DISTINCT FROM expected_previous
    OR event_hash IS DISTINCT FROM app.audit_event_hash(expected_previous,actor_id,actor_roles,action,
      entity_type,entity_id,request_id,ip_hash,user_agent,before_data,after_data,occurred_at)
$$;

REVOKE ALL ON FUNCTION app.audit_event_hash(text,uuid,user_role[],text,text,text,text,text,text,jsonb,jsonb,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.chain_audit_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.rebuild_audit_chain() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.rebuild_audit_chain_after_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.audit_chain_invalid_count() FROM PUBLIC;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT EXECUTE ON FUNCTION app.audit_chain_invalid_count() TO flash_rls_audit;
 END IF;
END $$;
