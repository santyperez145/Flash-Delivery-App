-- Dividir la tarifa de un viaje (PAG-02), como Uber.
--
-- Quien pidió un viaje pagado con Flash Wallet invita a otras cuentas Flash; cada
-- una que acepta paga su parte. La tarifa se divide en partes iguales entre quien
-- pidió y quienes aceptaron, y se reequilibra con cada aceptación.
--
-- **La división es entre pasajeros.** El viaje ya está cobrado entero a quien lo
-- pidió; cada parte es un reintegro de un pasajero a otro (`fare_split`). Así la
-- liquidación del conductor, la comisión y los reintegros de una cancelación no
-- cambian: si el viaje se cancela, quien pidió recibe el total como siempre y a
-- cada invitado se le devuelve lo que pagó.
CREATE TABLE ride_fare_splits(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  inviter_id uuid NOT NULL REFERENCES users(id),
  invitee_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'accepted', 'declined', 'cancelled')),
  paid_cents bigint NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  UNIQUE (job_id, invitee_id),
  CHECK (inviter_id <> invitee_id),
  CHECK (status = 'accepted' OR paid_cents = 0)
);
CREATE INDEX ride_fare_splits_invitee_idx ON ride_fare_splits(invitee_id, status);

ALTER TABLE ride_fare_splits ENABLE ROW LEVEL SECURITY;
CREATE POLICY ride_fare_splits_participant ON ride_fare_splits
  USING (inviter_id = app.current_user_id() OR invitee_id = app.current_user_id()
    OR app.has_role('admin') OR app.has_role('support'))
  WITH CHECK (app.has_role('admin'));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON ride_fare_splits TO flash_runtime;
    CREATE POLICY ride_fare_splits_runtime_service ON ride_fare_splits TO flash_runtime
      USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_rls_audit') THEN
    GRANT SELECT (id, public_id, job_id, inviter_id, invitee_id, status, paid_cents, created_at, responded_at)
      ON ride_fare_splits TO flash_rls_audit;
  END IF;
END $$;

ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_kind_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_kind_check
  CHECK (kind IN ('sandbox_topup','driver_earning','payment','refund','adjustment','merchant_settlement',
    'payout_reserve','payout_release','tip','tip_adjustment','referral_reward','cash_collection','fare_split'));
