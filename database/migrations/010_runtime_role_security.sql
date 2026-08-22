DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_runtime') THEN
    GRANT USAGE ON SCHEMA public, app TO flash_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO flash_runtime;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO flash_runtime;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO flash_runtime;
    ALTER DEFAULT PRIVILEGES FOR ROLE flash_app IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO flash_runtime;
    ALTER DEFAULT PRIVILEGES FOR ROLE flash_app IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO flash_runtime;
    CREATE POLICY users_runtime_service ON users TO flash_runtime USING (true) WITH CHECK (true);
    CREATE POLICY addresses_runtime_service ON addresses TO flash_runtime USING (true) WITH CHECK (true);
    CREATE POLICY favorites_runtime_service ON favorites TO flash_runtime USING (true) WITH CHECK (true);
    CREATE POLICY carts_runtime_service ON carts TO flash_runtime USING (true) WITH CHECK (true);
    CREATE POLICY cart_items_runtime_service ON cart_items TO flash_runtime USING (true) WITH CHECK (true);
    CREATE POLICY jobs_runtime_service ON jobs TO flash_runtime USING (true) WITH CHECK (true);
    CREATE POLICY job_items_runtime_service ON job_items TO flash_runtime USING (true) WITH CHECK (true);
    CREATE POLICY job_events_runtime_service ON job_events TO flash_runtime USING (true) WITH CHECK (true);
    CREATE POLICY payment_customers_runtime_service ON payment_customers TO flash_runtime USING (true) WITH CHECK (true);
    CREATE POLICY payment_methods_runtime_service ON payment_methods TO flash_runtime USING (true) WITH CHECK (true);
    CREATE POLICY payment_intents_runtime_service ON payment_intents TO flash_runtime USING (true) WITH CHECK (true);
    CREATE POLICY refunds_runtime_service ON refunds TO flash_runtime USING (true) WITH CHECK (true);
    CREATE POLICY notifications_runtime_service ON notifications TO flash_runtime USING (true) WITH CHECK (true);
    CREATE POLICY support_tickets_runtime_service ON support_tickets TO flash_runtime USING (true) WITH CHECK (true);
    CREATE POLICY support_messages_runtime_service ON support_messages TO flash_runtime USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_rls_audit') THEN
    GRANT USAGE ON SCHEMA public, app TO flash_rls_audit;
    GRANT SELECT ON users, addresses, favorites, carts, cart_items, jobs, job_items, job_events TO flash_rls_audit;
    GRANT EXECUTE ON FUNCTION app.current_user_id(), app.has_role(user_role) TO flash_rls_audit;
  END IF;
END $$;
