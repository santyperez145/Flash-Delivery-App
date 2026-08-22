CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE user_role AS ENUM ('customer', 'merchant', 'driver', 'admin', 'support');
CREATE TYPE job_kind AS ENUM ('delivery', 'ride', 'shopping');
CREATE TYPE job_status AS ENUM ('requested', 'accepted', 'preparing', 'ready_for_pickup', 'driver_assigned', 'arriving', 'picked_up', 'in_progress', 'delivering', 'completed', 'cancelled');
CREATE TYPE ledger_direction AS ENUM ('debit', 'credit');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name text NOT NULL,
  phone text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role user_role NOT NULL,
  PRIMARY KEY (user_id, role)
);
CREATE TABLE refresh_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  device_name text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text NOT NULL,
  formatted_address text NOT NULL,
  location geography(Point, 4326) NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX addresses_location_gix ON addresses USING gist(location);

CREATE TABLE merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  vertical text NOT NULL CHECK (vertical IN ('restaurant', 'kiosk', 'grocery', 'pharmacy', 'retail')),
  status text NOT NULL DEFAULT 'active',
  address text NOT NULL,
  location geography(Point, 4326) NOT NULL,
  service_radius_m integer NOT NULL DEFAULT 6000,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX merchants_location_gix ON merchants USING gist(location);
CREATE TABLE catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  sku text,
  name text NOT NULL,
  description text,
  category text NOT NULL,
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  available boolean NOT NULL DEFAULT true,
  inventory_quantity integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, sku)
);
CREATE INDEX catalog_items_available_idx ON catalog_items(merchant_id, available, category);

CREATE TABLE drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  online boolean NOT NULL DEFAULT false,
  active_mode job_kind NOT NULL DEFAULT 'delivery',
  service_modes job_kind[] NOT NULL DEFAULT ARRAY['delivery']::job_kind[],
  rating numeric(3,2) NOT NULL DEFAULT 5,
  current_location geography(Point, 4326),
  location_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drivers_available_location_gix ON drivers USING gist(current_location) WHERE online;
CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  kind text NOT NULL,
  model text NOT NULL,
  plate text NOT NULL UNIQUE,
  color text,
  seats smallint,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind job_kind NOT NULL,
  customer_id uuid NOT NULL REFERENCES users(id),
  merchant_id uuid REFERENCES merchants(id),
  driver_id uuid REFERENCES drivers(id),
  status job_status NOT NULL DEFAULT 'requested',
  pickup_address text NOT NULL,
  pickup_location geography(Point, 4326) NOT NULL,
  dropoff_address text NOT NULL,
  dropoff_location geography(Point, 4326) NOT NULL,
  service_level text NOT NULL,
  quoted_amount_cents bigint NOT NULL CHECK (quoted_amount_cents >= 0),
  final_amount_cents bigint CHECK (final_amount_cents >= 0),
  currency char(3) NOT NULL DEFAULT 'ARS',
  distance_m integer NOT NULL CHECK (distance_m >= 0),
  estimated_duration_s integer NOT NULL CHECK (estimated_duration_s >= 0),
  scheduled_for timestamptz,
  cancellation_reason text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_active_driver_idx ON jobs(driver_id, status) WHERE status NOT IN ('completed', 'cancelled');
CREATE INDEX jobs_customer_created_idx ON jobs(customer_id, created_at DESC);
CREATE INDEX jobs_pickup_gix ON jobs USING gist(pickup_location);
CREATE TABLE job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  catalog_item_id uuid REFERENCES catalog_items(id),
  name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  customer_note text,
  substitution_policy text
);
CREATE TABLE job_events (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id),
  status job_status NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_events_job_idx ON job_events(job_id, occurred_at);

CREATE TABLE dispatch_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  score numeric(10,4) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired', 'withdrawn')),
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, driver_id)
);
CREATE INDEX dispatch_offers_pending_idx ON dispatch_offers(driver_id, expires_at) WHERE status = 'pending';

CREATE TABLE ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL,
  owner_id uuid,
  currency char(3) NOT NULL,
  account_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_type, owner_id, currency, account_type)
);
CREATE TABLE ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES ledger_accounts(id),
  direction ledger_direction NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  reference_type text NOT NULL,
  reference_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_transaction_idx ON ledger_entries(transaction_id);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX outbox_unpublished_idx ON outbox_events(occurred_at) WHERE published_at IS NULL;
CREATE TABLE idempotency_keys (
  key text PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  request_hash text NOT NULL,
  response_status integer,
  response_body jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
