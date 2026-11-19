-- Alta real de comercio (FE-05, OPS-W01), como la de Uber Eats y PedidosYa.
--
-- Hasta ahora no existía ningún camino de producto para crear un comercio: el único
-- `INSERT INTO merchants` vivía en `scripts/db-seed-commerce.mjs`, y la migración 134
-- le había quitado al runtime el permiso de crear comercios porque «el producto sólo
-- actualiza su estado». Con «todo real, nada falso» eso dejaba el catálogo vacío para
-- siempre. Esta migración abre el alta, y la abre por un solo lugar: una persona con
-- cuenta se postula, operaciones revisa y, recién al aprobar, nacen el comercio, su
-- sucursal principal y el rol `merchant`, todo en una transacción.
--
-- **Estados.** `pending` espera revisión; `needs_changes` es la observada (operaciones
-- pidió cambios con un motivo); `approved` y `rejected` son finales. Una persona tiene
-- a lo sumo una solicitud abierta (`pending` o `needs_changes`): dos en paralelo
-- obligarían a operaciones a adivinar cuál vale.
--
-- **Lo que se guarda es lo que la persona declaró.** Razón social, CUIT y teléfono son
-- datos personales o fiscales: por eso la auditoría de RLS no los ve, y por eso una
-- cuenta que se elimina se lleva sus solicitudes no aprobadas (ver el trigger al
-- final). La aprobada queda: es el origen de un comercio que sigue existiendo, y quien
-- tiene un comercio no puede borrar su cuenta sola (`FLASH_DELETE_ROLE`).
CREATE TABLE merchant_applications(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  applicant_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'needs_changes', 'approved', 'rejected')),
  business_name text NOT NULL CHECK (char_length(business_name) BETWEEN 2 AND 120),
  legal_name text NOT NULL CHECK (char_length(legal_name) BETWEEN 2 AND 160),
  -- El CUIT va sin guiones. El dígito verificador lo controla la API: acá sólo la forma.
  tax_id text NOT NULL CHECK (tax_id ~ '^[0-9]{11}$'),
  -- Los mismos rubros que acepta `merchants.vertical` (migración 001): una solicitud
  -- aprobada no puede chocar con el CHECK del comercio que crea.
  vertical text NOT NULL CHECK (vertical IN ('restaurant', 'kiosk', 'grocery', 'pharmacy', 'retail')),
  contact_phone text NOT NULL CHECK (contact_phone ~ '^\+54[0-9]{10,11}$'),
  address text NOT NULL CHECK (char_length(address) BETWEEN 5 AND 240),
  location geography(Point, 4326) NOT NULL,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 500),
  -- El motivo de la última decisión: lo que la persona lee si le piden cambios o la
  -- rechazan. Una aprobación puede no llevarlo.
  decision_reason text CHECK (decision_reason IS NULL OR char_length(decision_reason) BETWEEN 5 AND 500),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  -- El comercio que nació de esta solicitud. `UNIQUE`: una aprobación repetida no
  -- puede colgar un segundo comercio de la misma solicitud.
  merchant_id uuid UNIQUE REFERENCES merchants(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Sólo la pendiente no tiene decisión; toda decisión tiene fecha y autor.
  CHECK ((status = 'pending') = (decided_at IS NULL)),
  CHECK ((decided_at IS NULL) = (decided_by IS NULL)),
  -- Pedir cambios o rechazar sin decir por qué deja a la persona sin saber qué hacer.
  CHECK (status NOT IN ('needs_changes', 'rejected') OR decision_reason IS NOT NULL),
  -- Aprobada si y sólo si hay comercio: no hay aprobación a medias.
  CHECK ((status = 'approved') = (merchant_id IS NOT NULL))
);
-- Una solicitud abierta por persona. La API lo controla antes; el índice cierra la
-- carrera de dos envíos simultáneos, que si no pasaban los dos.
CREATE UNIQUE INDEX merchant_applications_one_open ON merchant_applications(applicant_id)
  WHERE status IN ('pending', 'needs_changes');
-- La cola de operaciones: por estado y por antigüedad, con el id para el cursor.
CREATE INDEX merchant_applications_queue_idx ON merchant_applications(status, created_at, id);
CREATE INDEX merchant_applications_applicant_idx ON merchant_applications(applicant_id, created_at DESC);

-- La ve quien se postuló, y operaciones (admin decide, soporte mira para responder
-- consultas). Nadie más: un comercio no ve la solicitud de otro.
ALTER TABLE merchant_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY merchant_applications_participant ON merchant_applications
  USING (applicant_id = app.current_user_id() OR app.has_role('admin') OR app.has_role('support'))
  WITH CHECK (applicant_id = app.current_user_id() OR app.has_role('admin'));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_runtime') THEN
    -- `UPDATE`: decidir bloquea la solicitud (`FOR UPDATE`) y la actualiza. Sin
    -- `DELETE`: una solicitud no se borra desde la API; la que se va con una cuenta
    -- eliminada la borra el trigger de abajo, con los permisos de su dueño.
    GRANT SELECT, INSERT, UPDATE ON merchant_applications TO flash_runtime;
    CREATE POLICY merchant_applications_runtime_service ON merchant_applications TO flash_runtime
      USING (true) WITH CHECK (true);
    -- La migración 134 (comercios) y la 135 (sucursales) le quitaron al runtime el
    -- `INSERT` porque ninguna ruta creaba comercios, y dejaron escrito que un alta
    -- real tenía que volver «con autorización, auditoría y prueba propias». Es ésta:
    -- sólo la aprobación de una solicitud, por un admin, auditada y probada por
    -- `test:merchant-applications`. `DELETE` sigue revocado en las dos.
    GRANT INSERT ON merchants TO flash_runtime;
    GRANT INSERT ON merchant_branches TO flash_runtime;
  END IF;
  -- La auditoría ve el estado de la cola, no los datos de la persona: ni razón
  -- social, ni CUIT, ni teléfono, ni dirección, ni las notas o el motivo escritos.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_rls_audit') THEN
    GRANT SELECT (id, public_id, applicant_id, status, vertical, created_at, decided_at,
      merchant_id) ON merchant_applications TO flash_rls_audit;
  END IF;
END $$;

-- Al eliminarse una cuenta, sus solicitudes no aprobadas se borran: no hay comercio
-- que las justifique y guardan su CUIT, su teléfono y su dirección. La aprobada no
-- llega acá, porque quien tiene el rol `merchant` no puede eliminar su cuenta sola.
CREATE OR REPLACE FUNCTION app.drop_merchant_applications_on_deletion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.status = 'deleted' AND OLD.status <> 'deleted' THEN
    DELETE FROM merchant_applications WHERE applicant_id = NEW.id AND status <> 'approved';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION app.drop_merchant_applications_on_deletion() FROM PUBLIC;
CREATE TRIGGER users_drop_merchant_applications_on_deletion
  BEFORE UPDATE OF status ON users
  FOR EACH ROW EXECUTE FUNCTION app.drop_merchant_applications_on_deletion();
