CREATE SCHEMA IF NOT EXISTS app;

CREATE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE FUNCTION app.has_role(expected user_role) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT expected = ANY(string_to_array(nullif(current_setting('app.roles', true), ''), ',')::user_role[])
$$;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_self_or_staff ON users
  USING (id = app.current_user_id() OR app.has_role('admin') OR app.has_role('support'))
  WITH CHECK (id = app.current_user_id() OR app.has_role('admin'));

CREATE POLICY addresses_owner ON addresses
  USING (user_id = app.current_user_id() OR app.has_role('admin'))
  WITH CHECK (user_id = app.current_user_id() OR app.has_role('admin'));

CREATE POLICY favorites_owner ON favorites
  USING (user_id = app.current_user_id() OR app.has_role('admin'))
  WITH CHECK (user_id = app.current_user_id() OR app.has_role('admin'));

CREATE POLICY carts_owner ON carts
  USING (customer_id = app.current_user_id() OR app.has_role('admin') OR app.has_role('support'))
  WITH CHECK (customer_id = app.current_user_id() OR app.has_role('admin'));

CREATE POLICY cart_items_via_cart ON cart_items
  USING (EXISTS (SELECT 1 FROM carts WHERE carts.id = cart_items.cart_id))
  WITH CHECK (EXISTS (SELECT 1 FROM carts WHERE carts.id = cart_items.cart_id));

CREATE POLICY jobs_participants ON jobs
  USING (
    customer_id = app.current_user_id()
    OR EXISTS (SELECT 1 FROM drivers d WHERE d.id = jobs.driver_id AND d.user_id = app.current_user_id())
    OR EXISTS (SELECT 1 FROM merchants m WHERE m.id = jobs.merchant_id AND m.owner_id = app.current_user_id())
    OR app.has_role('admin') OR app.has_role('support')
  );

CREATE POLICY job_items_via_job ON job_items
  USING (EXISTS (SELECT 1 FROM jobs WHERE jobs.id = job_items.job_id));

CREATE POLICY job_events_via_job ON job_events
  USING (EXISTS (SELECT 1 FROM jobs WHERE jobs.id = job_events.job_id));

CREATE POLICY payment_customers_owner ON payment_customers
  USING (user_id = app.current_user_id() OR app.has_role('admin'))
  WITH CHECK (user_id = app.current_user_id() OR app.has_role('admin'));

CREATE POLICY payment_methods_owner ON payment_methods
  USING (user_id = app.current_user_id() OR app.has_role('admin'))
  WITH CHECK (user_id = app.current_user_id() OR app.has_role('admin'));

CREATE POLICY payment_intents_owner_or_staff ON payment_intents
  USING (customer_id = app.current_user_id() OR app.has_role('admin') OR app.has_role('support'));

CREATE POLICY refunds_via_payment ON refunds
  USING (EXISTS (SELECT 1 FROM payment_intents p WHERE p.id = refunds.payment_intent_id));

CREATE POLICY notifications_owner ON notifications
  USING (user_id = app.current_user_id() OR app.has_role('admin'))
  WITH CHECK (user_id = app.current_user_id() OR app.has_role('admin'));

CREATE POLICY support_tickets_participant ON support_tickets
  USING (user_id = app.current_user_id() OR assigned_to = app.current_user_id() OR app.has_role('admin') OR app.has_role('support'))
  WITH CHECK (user_id = app.current_user_id() OR app.has_role('admin') OR app.has_role('support'));

CREATE POLICY support_messages_via_ticket ON support_messages
  USING (EXISTS (SELECT 1 FROM support_tickets WHERE support_tickets.id = support_messages.ticket_id))
  WITH CHECK (EXISTS (SELECT 1 FROM support_tickets WHERE support_tickets.id = support_messages.ticket_id));

REVOKE ALL ON payment_customers, payment_methods, payment_intents, refunds, payouts, ledger_accounts, ledger_entries FROM PUBLIC;
