CREATE OR REPLACE FUNCTION apply_support_ticket_sla() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE policy support_sla_policies%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' OR NEW.priority IS DISTINCT FROM OLD.priority THEN
    SELECT * INTO policy FROM support_sla_policies WHERE priority=NEW.priority AND active;
    IF NOT FOUND THEN RAISE EXCEPTION 'No active support SLA for priority %',NEW.priority USING ERRCODE='check_violation'; END IF;
    NEW.first_response_due_at:=COALESCE(NEW.created_at,now())+(policy.first_response_minutes*interval '1 minute');
    NEW.resolution_due_at:=COALESCE(NEW.created_at,now())+(policy.resolution_minutes*interval '1 minute');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER support_ticket_sla_before_write
BEFORE INSERT OR UPDATE OF priority ON support_tickets
FOR EACH ROW EXECUTE FUNCTION apply_support_ticket_sla();
