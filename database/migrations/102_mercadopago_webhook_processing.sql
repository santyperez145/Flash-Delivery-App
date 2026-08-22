ALTER TABLE mercadopago_webhook_inbox ADD COLUMN resource_snapshot jsonb;
ALTER TABLE mercadopago_webhook_inbox ADD COLUMN processing_started_at timestamptz;
CREATE INDEX mercadopago_webhook_stuck_idx ON mercadopago_webhook_inbox(processing_started_at) WHERE status='processing';
COMMENT ON COLUMN mercadopago_webhook_inbox.resource_snapshot IS 'Allowlisted reconciliation fields only; payer and card payloads are never stored.';
