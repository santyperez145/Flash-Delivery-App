CREATE TYPE payment_status AS ENUM ('requires_payment_method', 'requires_confirmation', 'authorized', 'captured', 'failed', 'cancelled', 'refunded', 'partially_refunded');
CREATE TYPE payout_status AS ENUM ('pending', 'processing', 'paid', 'failed', 'cancelled');
CREATE TYPE ticket_status AS ENUM ('open', 'waiting_customer', 'waiting_operations', 'resolved', 'closed');

ALTER TABLE users
  ADD COLUMN locale text NOT NULL DEFAULT 'es-AR',
  ADD COLUMN timezone text NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  ADD COLUMN email_verified_at timestamptz,
  ADD COLUMN phone_verified_at timestamptz,
  ADD COLUMN deleted_at timestamptz;

CREATE TABLE user_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  push_token text,
  device_fingerprint_hash text,
  app_version text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, push_token)
);

CREATE TABLE user_security_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('totp', 'webauthn', 'recovery_code')),
  secret_ciphertext bytea,
  credential_id text,
  public_key text,
  enabled_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE favorites (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, merchant_id)
);

CREATE TABLE carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'converted', 'abandoned')),
  currency char(3) NOT NULL DEFAULT 'ARS',
  version integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX carts_one_active_per_merchant_idx ON carts(customer_id, merchant_id) WHERE status = 'active';

CREATE TABLE cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  catalog_item_id uuid NOT NULL REFERENCES catalog_items(id),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  unit_price_snapshot_cents bigint NOT NULL CHECK (unit_price_snapshot_cents >= 0),
  options jsonb NOT NULL DEFAULT '[]',
  note text,
  UNIQUE (cart_id, catalog_item_id, options)
);

CREATE TABLE promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext UNIQUE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('percentage', 'fixed', 'free_delivery', 'wallet_credit')),
  value integer NOT NULL CHECK (value > 0),
  max_discount_cents bigint,
  min_subtotal_cents bigint NOT NULL DEFAULT 0,
  usage_limit integer,
  per_user_limit integer NOT NULL DEFAULT 1,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  rules jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE promotion_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES promotions(id),
  user_id uuid NOT NULL REFERENCES users(id),
  job_id uuid REFERENCES jobs(id),
  discount_cents bigint NOT NULL CHECK (discount_cents >= 0),
  redeemed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX promotion_redemptions_user_idx ON promotion_redemptions(user_id, promotion_id, redeemed_at DESC);

CREATE TABLE payment_customers (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_customer_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_customer_id)
);

CREATE TABLE payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_payment_method_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('card', 'bank_account', 'wallet', 'cash')),
  brand text,
  last4 char(4),
  expiry_month smallint CHECK (expiry_month BETWEEN 1 AND 12),
  expiry_year smallint,
  is_default boolean NOT NULL DEFAULT false,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_method_id)
);
CREATE UNIQUE INDEX payment_methods_one_default_idx ON payment_methods(user_id) WHERE is_default AND revoked_at IS NULL;

CREATE TABLE payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES jobs(id),
  customer_id uuid NOT NULL REFERENCES users(id),
  payment_method_id uuid REFERENCES payment_methods(id),
  provider text NOT NULL,
  provider_intent_id text,
  status payment_status NOT NULL DEFAULT 'requires_payment_method',
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  captured_amount_cents bigint NOT NULL DEFAULT 0 CHECK (captured_amount_cents >= 0),
  currency char(3) NOT NULL DEFAULT 'ARS',
  idempotency_key text NOT NULL UNIQUE,
  provider_payload jsonb NOT NULL DEFAULT '{}',
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_intent_id)
);
CREATE INDEX payment_intents_customer_idx ON payment_intents(customer_id, created_at DESC);

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_intent_id uuid NOT NULL REFERENCES payment_intents(id),
  requested_by uuid REFERENCES users(id),
  provider_refund_id text,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payee_type text NOT NULL CHECK (payee_type IN ('driver', 'merchant')),
  payee_id uuid NOT NULL,
  provider text NOT NULL,
  provider_payout_id text,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL DEFAULT 'ARS',
  status payout_status NOT NULL DEFAULT 'pending',
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  CHECK (period_end > period_start)
);
CREATE INDEX payouts_payee_idx ON payouts(payee_type, payee_id, created_at DESC);

CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  signature_valid boolean NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_error text,
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id),
  subject_type text NOT NULL CHECK (subject_type IN ('driver', 'merchant', 'customer')),
  subject_id uuid NOT NULL,
  score smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  tags text[] NOT NULL DEFAULT '{}',
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, author_id, subject_type)
);

CREATE TABLE support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  job_id uuid REFERENCES jobs(id),
  category text NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status ticket_status NOT NULL DEFAULT 'open',
  assigned_to uuid REFERENCES users(id),
  subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX support_tickets_queue_idx ON support_tickets(status, priority, created_at);

CREATE TABLE support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES users(id),
  body text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]',
  internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('push', 'email', 'sms', 'in_app')),
  template text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  deduplication_key text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'read')),
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, channel, deduplication_key)
);
CREATE INDEX notifications_delivery_idx ON notifications(status, scheduled_at) WHERE status = 'queued';

CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  actor_id uuid REFERENCES users(id),
  actor_roles user_role[],
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  request_id text,
  ip_hash text,
  user_agent text,
  before_data jsonb,
  after_data jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_entity_idx ON audit_events(entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_events_actor_idx ON audit_events(actor_id, occurred_at DESC);

CREATE VIEW ledger_transaction_balances AS
SELECT transaction_id,
       sum(CASE WHEN direction = 'debit' THEN amount_cents ELSE -amount_cents END) AS imbalance_cents,
       count(*) AS entry_count
FROM ledger_entries
GROUP BY transaction_id;

CREATE FUNCTION enforce_balanced_ledger_transaction() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_transaction uuid := COALESCE(NEW.transaction_id, OLD.transaction_id);
  balance record;
BEGIN
  SELECT imbalance_cents, entry_count INTO balance
  FROM ledger_transaction_balances
  WHERE transaction_id = target_transaction;
  IF balance.entry_count IS NOT NULL AND (balance.entry_count < 2 OR balance.imbalance_cents <> 0) THEN
    RAISE EXCEPTION 'ledger transaction % is not balanced', target_transaction;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_entries_must_balance
AFTER INSERT OR UPDATE OR DELETE ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_balanced_ledger_transaction();
