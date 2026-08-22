CREATE TABLE ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('sandbox_topup','driver_earning','payment','refund','adjustment')),
  actor_id uuid REFERENCES users(id),
  description text NOT NULL,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('pending','posted','reversed','failed')),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_transaction_fk FOREIGN KEY (transaction_id) REFERENCES ledger_transactions(id);

CREATE UNIQUE INDEX ledger_system_accounts_unique
  ON ledger_accounts(owner_type, currency, account_type) WHERE owner_id IS NULL;
CREATE INDEX ledger_entries_account_created_idx ON ledger_entries(account_id, created_at DESC);

