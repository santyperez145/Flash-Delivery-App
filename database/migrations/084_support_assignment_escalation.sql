ALTER TABLE support_tickets
  ADD COLUMN escalation_level smallint NOT NULL DEFAULT 0 CHECK(escalation_level BETWEEN 0 AND 2),
  ADD COLUMN last_escalated_at timestamptz;

CREATE TABLE support_agent_profiles(
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  availability text NOT NULL DEFAULT 'available' CHECK(availability IN('available','busy','offline')),
  max_active_tickets integer NOT NULL DEFAULT 10 CHECK(max_active_tickets BETWEEN 1 AND 100),
  skills text[] NOT NULL DEFAULT ARRAY['all']::text[] CHECK(cardinality(skills)>0),
  last_assigned_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_agent_profiles_routing_idx ON support_agent_profiles(availability,last_assigned_at) WHERE availability<>'offline';

CREATE TABLE support_ticket_assignments(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  assigned_to uuid NOT NULL REFERENCES users(id),
  assigned_by uuid REFERENCES users(id),
  reason text NOT NULL CHECK(reason IN('auto_create','auto_queue','manual','escalation')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_ticket_assignments_ticket_idx ON support_ticket_assignments(ticket_id,created_at DESC);

CREATE TABLE support_escalation_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  level smallint NOT NULL CHECK(level BETWEEN 1 AND 2),
  breach_kind text NOT NULL CHECK(breach_kind IN('first_response','resolution')),
  assigned_to uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ticket_id,level)
);
CREATE INDEX support_escalation_events_created_idx ON support_escalation_events(created_at DESC);

INSERT INTO support_agent_profiles(user_id,availability,max_active_tickets,skills)
SELECT DISTINCT u.id,'available',20,ARRAY['all']::text[] FROM users u JOIN user_roles ur ON ur.user_id=u.id WHERE ur.role IN('admin','support') ON CONFLICT(user_id) DO NOTHING;

ALTER TABLE support_agent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_escalation_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY support_agent_profiles_staff ON support_agent_profiles USING(app.has_role('admin') OR app.has_role('support')) WITH CHECK(app.has_role('admin') OR app.has_role('support'));
CREATE POLICY support_ticket_assignments_staff ON support_ticket_assignments USING(app.has_role('admin') OR app.has_role('support')) WITH CHECK(app.has_role('admin') OR app.has_role('support'));
CREATE POLICY support_escalation_events_staff ON support_escalation_events USING(app.has_role('admin') OR app.has_role('support')) WITH CHECK(app.has_role('admin') OR app.has_role('support'));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE ON support_agent_profiles,support_ticket_assignments,support_escalation_events TO flash_runtime;
  CREATE POLICY support_agent_profiles_runtime_service ON support_agent_profiles TO flash_runtime USING(true) WITH CHECK(true);
  CREATE POLICY support_ticket_assignments_runtime_service ON support_ticket_assignments TO flash_runtime USING(true) WITH CHECK(true);
  CREATE POLICY support_escalation_events_runtime_service ON support_escalation_events TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT ON support_agent_profiles,support_ticket_assignments,support_escalation_events TO flash_rls_audit;
 END IF;
END $$;

COMMENT ON TABLE support_agent_profiles IS 'Operational routing capacity and skills for active support/admin users.';
COMMENT ON TABLE support_ticket_assignments IS 'Append-only ownership history for automatic and manual support routing.';
COMMENT ON TABLE support_escalation_events IS 'Idempotent SLA breach escalation facts, one event per ticket and level.';
