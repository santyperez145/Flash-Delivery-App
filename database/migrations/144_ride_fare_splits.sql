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
--
-- **Invitar no dice quién tiene cuenta.** Un email que no es de un cliente activo
-- se guarda como una invitación más, que nunca se acepta, y la respuesta es la
-- misma. Como cada viaje admite cuatro invitaciones, averiguar cuentas así cuesta
-- un viaje pagado cada cuatro emails.
CREATE TABLE ride_fare_splits(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  inviter_id uuid NOT NULL REFERENCES users(id),
  -- `NULL` si el email no es de un cliente activo: la invitación se guarda igual y
  -- nunca se acepta. Así invitar no dice qué emails tienen cuenta (ver abajo).
  invitee_id uuid REFERENCES users(id),
  -- Lo que escribió quien invita, en minúsculas. Él ya lo sabe; es lo que ve en su lista.
  invitee_email text NOT NULL,
  status text NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'accepted', 'declined', 'cancelled')),
  paid_cents bigint NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  UNIQUE (job_id, invitee_email),
  CHECK (invitee_id IS NULL OR inviter_id <> invitee_id),
  CHECK (invitee_id IS NOT NULL OR status IN ('invited', 'cancelled')),
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

-- Quien aceptó dividir un viaje que sigue en curso no puede borrar su cuenta: un
-- reequilibrio o una cancelación le van a devolver plata. Se suma al resguardo de
-- `app.delete_customer_account` (migración 138) como trigger, con su mismo error.
CREATE OR REPLACE FUNCTION app.reject_deletion_with_open_fare_split() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.status = 'deleted' AND OLD.status <> 'deleted' AND EXISTS (
    SELECT 1 FROM ride_fare_splits s JOIN jobs j ON j.id = s.job_id
     WHERE s.invitee_id = NEW.id AND s.status = 'accepted'
       AND j.status NOT IN ('completed', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'FLASH_DELETE_ACTIVE_JOB' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION app.reject_deletion_with_open_fare_split() FROM PUBLIC;
CREATE TRIGGER users_reject_deletion_with_open_fare_split
  BEFORE UPDATE OF status ON users
  FOR EACH ROW EXECUTE FUNCTION app.reject_deletion_with_open_fare_split();
