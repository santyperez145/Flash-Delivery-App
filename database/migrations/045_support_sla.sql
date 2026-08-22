CREATE TABLE support_sla_policies(
  priority text PRIMARY KEY CHECK(priority IN('low','normal','high','urgent')),
  first_response_minutes integer NOT NULL CHECK(first_response_minutes BETWEEN 5 AND 10080),
  resolution_minutes integer NOT NULL CHECK(resolution_minutes BETWEEN 15 AND 43200),
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(resolution_minutes>=first_response_minutes)
);
INSERT INTO support_sla_policies(priority,first_response_minutes,resolution_minutes) VALUES
 ('urgent',15,240),('high',60,720),('normal',240,2880),('low',720,7200);

ALTER TABLE support_tickets
  ADD COLUMN first_response_due_at timestamptz,
  ADD COLUMN resolution_due_at timestamptz,
  ADD COLUMN first_responded_at timestamptz;
UPDATE support_tickets t SET
 first_response_due_at=t.created_at+(p.first_response_minutes*interval '1 minute'),
 resolution_due_at=t.created_at+(p.resolution_minutes*interval '1 minute')
FROM support_sla_policies p WHERE p.priority=t.priority;
ALTER TABLE support_tickets ALTER COLUMN first_response_due_at SET NOT NULL;
ALTER TABLE support_tickets ALTER COLUMN resolution_due_at SET NOT NULL;
CREATE INDEX support_tickets_sla_queue_idx ON support_tickets(first_response_due_at,resolution_due_at) WHERE status NOT IN('resolved','closed');

ALTER TABLE support_sla_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY support_sla_visible ON support_sla_policies USING(active OR app.has_role('admin') OR app.has_role('support'));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON support_sla_policies TO flash_runtime;
  CREATE POLICY support_sla_runtime_service ON support_sla_policies TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT ON support_sla_policies TO flash_rls_audit;
 END IF;
END $$;
