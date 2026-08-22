DROP POLICY IF EXISTS support_messages_via_ticket ON support_messages;
CREATE POLICY support_messages_via_ticket ON support_messages
  USING (
    EXISTS (SELECT 1 FROM support_tickets WHERE support_tickets.id = support_messages.ticket_id)
    AND (NOT internal OR app.has_role('admin') OR app.has_role('support'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM support_tickets WHERE support_tickets.id = support_messages.ticket_id)
    AND (NOT internal OR app.has_role('admin') OR app.has_role('support'))
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
    GRANT SELECT ON notifications, support_tickets, support_messages TO flash_rls_audit;
  END IF;
END $$;
