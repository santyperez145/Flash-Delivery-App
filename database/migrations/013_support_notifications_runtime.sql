ALTER TABLE support_tickets ADD COLUMN public_id text;
UPDATE support_tickets SET public_id = 'TCK-' || upper(substr(replace(id::text, '-', ''), 1, 8)) WHERE public_id IS NULL;
ALTER TABLE support_tickets ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_public_id_unique UNIQUE (public_id);

ALTER TABLE notifications ADD COLUMN public_id text;
UPDATE notifications SET public_id = 'NTF-' || upper(substr(replace(id::text, '-', ''), 1, 8)) WHERE public_id IS NULL;
ALTER TABLE notifications ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE notifications ADD CONSTRAINT notifications_public_id_unique UNIQUE (public_id);

CREATE INDEX support_tickets_user_updated_idx ON support_tickets(user_id, updated_at DESC);
CREATE INDEX support_messages_ticket_created_idx ON support_messages(ticket_id, created_at);
CREATE INDEX notifications_user_created_idx ON notifications(user_id, created_at DESC);
