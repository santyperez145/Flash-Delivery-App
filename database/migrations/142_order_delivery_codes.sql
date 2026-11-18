-- Código de entrega en pedidos (SEG-03), como el PIN de Uber Eats.
--
-- Un pedido con envío de valor alto, o de un cliente que tuvo un reclamo aprobado en
-- los últimos 90 días, se entrega con un código de 4 dígitos: el cliente lo ve en el
-- seguimiento y quien reparte lo ingresa antes de marcarlo entregado. Es lo que
-- contesta «no me llegó» cuando hay más plata en juego o ya hubo un reclamo.
--
-- Mismo esquema que el PIN de subida de los viajes (migración 073): el código se
-- deriva con HMAC del id del pedido y acá sólo se guarda su hash bcrypt.
CREATE TABLE order_delivery_codes(
  job_id uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  pin_hash text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('high_value', 'prior_claim')),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
  locked_until timestamptz,
  verified_at timestamptz,
  verified_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE order_delivery_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_delivery_codes_participant ON order_delivery_codes
  USING (EXISTS (
    SELECT 1 FROM jobs j LEFT JOIN drivers d ON d.id = j.driver_id
    WHERE j.id = job_id
      AND (j.customer_id = app.current_user_id() OR d.user_id = app.current_user_id()
        OR app.has_role('admin') OR app.has_role('support'))
  ))
  WITH CHECK (app.has_role('admin'));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON order_delivery_codes TO flash_runtime;
    CREATE POLICY order_delivery_codes_runtime_service ON order_delivery_codes TO flash_runtime
      USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_rls_audit') THEN
    GRANT SELECT (job_id, reason, failed_attempts, locked_until, verified_at, verified_by, created_at, updated_at)
      ON order_delivery_codes TO flash_rls_audit;
  END IF;
END $$;

COMMENT ON COLUMN order_delivery_codes.pin_hash IS
  'bcrypt digest only; the plaintext code is derived for the owning customer and never persisted.';
