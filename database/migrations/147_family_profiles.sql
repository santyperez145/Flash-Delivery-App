-- Perfil familiar (PAG-05), como el de Uber.
--
-- Quien organiza invita por email a otras cuentas Flash. Cada miembro que acepta
-- puede pagar sus viajes, envíos y pedidos con «Perfil familiar»: el cobro sale de la
-- Flash Wallet de quien organiza, que nunca queda a la vista del miembro. Quien
-- organiza puede ponerle a cada miembro un tope de gasto por mes, o dejarlo sin tope.
--
-- **Quién pagó queda en el cobro.** `payment_intents.customer_id` ya es quien paga y
-- puede ser distinto de `jobs.customer_id`, que es quien pidió. Acá se suma
-- `family_member_id`: qué membresía lo usó. Todos los reintegros (cancelación,
-- incidencia, sustitución, propina sin repartidor) vuelven a quien pagó, no a quien
-- pidió: si no, cada cancelación le pasaba plata de quien organiza al miembro.
--
-- **Invitar no dice quién tiene cuenta.** Un email que no es de un cliente activo se
-- guarda como una invitación más, que nunca se acepta, y la respuesta es la misma.
CREATE TABLE family_profiles(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  organizer_id uuid NOT NULL UNIQUE REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE family_members(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  profile_id uuid NOT NULL REFERENCES family_profiles(id),
  -- `NULL` si el email no es de un cliente activo: la invitación se guarda igual y
  -- nunca se acepta. Así invitar no dice qué emails tienen cuenta.
  member_id uuid REFERENCES users(id),
  -- Lo que escribió quien organiza, en minúsculas. `NULL` una vez borrada la cuenta.
  invitee_email text,
  status text NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'active', 'declined', 'removed', 'left')),
  -- Tope por mes calendario (hora de Argentina). `NULL`: sin tope, como en Uber.
  monthly_limit_cents bigint CHECK (monthly_limit_cents IS NULL OR monthly_limit_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  ended_at timestamptz,
  CHECK (member_id IS NOT NULL OR status IN ('invited', 'removed')),
  CHECK ((status IN ('removed', 'left')) = (ended_at IS NOT NULL))
);
-- Una persona paga con un solo perfil a la vez: el cobro no tiene que adivinar cuál.
CREATE UNIQUE INDEX family_members_one_active ON family_members(member_id) WHERE status = 'active';
-- Una invitación abierta por email y perfil.
CREATE UNIQUE INDEX family_members_open_invite ON family_members(profile_id, invitee_email)
  WHERE status IN ('invited', 'active');
CREATE INDEX family_members_profile_idx ON family_members(profile_id, status);
CREATE INDEX family_members_member_idx ON family_members(member_id, status) WHERE member_id IS NOT NULL;

-- Qué membresía usó cada cobro: con esto se suma lo gastado en el mes contra el tope.
ALTER TABLE payment_intents ADD COLUMN family_member_id uuid REFERENCES family_members(id);
CREATE INDEX payment_intents_family_member_idx ON payment_intents(family_member_id, created_at)
  WHERE family_member_id IS NOT NULL;

-- La política del perfil no mira a los miembros: la de los miembros mira al perfil, y
-- dos políticas que se consultan entre sí son una recursión infinita para PostgreSQL.
ALTER TABLE family_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY family_profiles_organizer ON family_profiles
  USING (organizer_id = app.current_user_id() OR app.has_role('admin') OR app.has_role('support'))
  WITH CHECK (app.has_role('admin'));
ALTER TABLE family_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY family_members_participant ON family_members
  USING (member_id = app.current_user_id()
    OR EXISTS (SELECT 1 FROM family_profiles p WHERE p.id = family_members.profile_id
                 AND p.organizer_id = app.current_user_id())
    OR app.has_role('admin') OR app.has_role('support'))
  WITH CHECK (app.has_role('admin'));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_runtime') THEN
    -- `UPDATE`: invitar bloquea el perfil (`FOR UPDATE`), y PostgreSQL pide ese permiso
    -- para bloquear filas.
    GRANT SELECT, INSERT, UPDATE ON family_profiles TO flash_runtime;
    GRANT SELECT, INSERT, UPDATE ON family_members TO flash_runtime;
    CREATE POLICY family_profiles_runtime_service ON family_profiles TO flash_runtime
      USING (true) WITH CHECK (true);
    CREATE POLICY family_members_runtime_service ON family_members TO flash_runtime
      USING (true) WITH CHECK (true);
  END IF;
  -- La auditoría no ve el email escrito.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_rls_audit') THEN
    GRANT SELECT (id, public_id, organizer_id, created_at) ON family_profiles TO flash_rls_audit;
    GRANT SELECT (id, public_id, profile_id, member_id, status, monthly_limit_cents, created_at,
      responded_at, ended_at) ON family_members TO flash_rls_audit;
  END IF;
END $$;

-- Al borrarse una cuenta:
-- - si organiza un perfil con un servicio en curso pagado por ella, no se borra: una
--   cancelación le va a devolver plata (mismo error que `app.delete_customer_account`);
-- - tampoco con una incidencia abierta o un ajuste de propina pendiente sobre algo que
--   pagó: su reintegro también vuelve a quien pagó (el borrado sólo mira las propias);
-- - si organiza, el perfil se disuelve: los miembros dejan de poder pagar con él;
-- - si es miembro, deja el perfil;
-- - los emails escritos en invitaciones, de ella o a su email, se borran.
CREATE OR REPLACE FUNCTION app.close_family_profile_on_deletion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.status = 'deleted' AND OLD.status <> 'deleted' THEN
    IF EXISTS (
      SELECT 1 FROM payment_intents p JOIN jobs j ON j.id = p.job_id
       WHERE p.customer_id = NEW.id AND j.customer_id <> NEW.id
         AND p.status IN ('captured', 'partially_refunded')
         AND j.status NOT IN ('completed', 'cancelled')
    ) THEN
      RAISE EXCEPTION 'FLASH_DELETE_ACTIVE_JOB' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
      SELECT 1 FROM order_issues i JOIN payment_intents p ON p.job_id = i.job_id
       WHERE p.customer_id = NEW.id AND i.status = 'open'
         AND p.status IN ('captured', 'partially_refunded')
    ) OR EXISTS (
      SELECT 1 FROM service_tip_adjustments a JOIN service_tips t ON t.id = a.tip_id
       WHERE t.customer_id = NEW.id AND a.status = 'pending'
    ) THEN
      RAISE EXCEPTION 'FLASH_DELETE_OPEN_CLAIM' USING ERRCODE = 'P0001';
    END IF;
    UPDATE family_members m
       SET status = 'removed', ended_at = now()
      FROM family_profiles p
     WHERE p.id = m.profile_id AND p.organizer_id = NEW.id AND m.status IN ('invited', 'active');
    UPDATE family_members
       SET status = 'left', ended_at = now()
     WHERE member_id = NEW.id AND status = 'active';
    UPDATE family_members
       SET status = 'removed', ended_at = now()
     WHERE member_id = NEW.id AND status = 'invited';
    UPDATE family_members m
       SET invitee_email = NULL
      FROM family_profiles p
     WHERE p.id = m.profile_id
       AND (p.organizer_id = NEW.id OR m.member_id = NEW.id
            OR m.invitee_email = lower(OLD.email::text));
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION app.close_family_profile_on_deletion() FROM PUBLIC;
CREATE TRIGGER users_close_family_profile_on_deletion
  BEFORE UPDATE OF status ON users
  FOR EACH ROW EXECUTE FUNCTION app.close_family_profile_on_deletion();
