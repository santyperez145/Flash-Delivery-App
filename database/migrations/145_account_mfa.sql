-- Verificación en dos pasos para toda cuenta (SEG-08), como Uber y Mercado Pago.
--
-- `user_mfa` ya era por usuario (migración 031) pero sólo los administradores
-- podían usarla. Ahora cualquier cliente, conductor o comercio puede activarla.
--
-- **Una sesión recuerda si pasó el segundo factor.** Un administrador vuelve a
-- verificar en cada renovación; a un cliente eso le pediría el código cada quince
-- minutos. Por eso la sesión creada después de verificar guarda cuándo lo hizo, la
-- renovación conserva la marca y, con la verificación activa, una sesión sin marca
-- (o con una anterior a la activación) no se renueva: pide el código.
ALTER TABLE refresh_sessions ADD COLUMN mfa_verified_at timestamptz;
COMMENT ON COLUMN refresh_sessions.mfa_verified_at IS
  'Cuándo esta sesión pasó el segundo factor. Se copia al rotar; una sesión sin marca no se renueva si la cuenta tiene la verificación activa.';

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
    GRANT SELECT(mfa_verified_at) ON refresh_sessions TO flash_rls_audit;
  END IF;
END $$;

-- Un código TOTP sirve una sola vez (RFC 6238, 5.2): se guarda el último paso de
-- 30 segundos usado y no se acepta ese ni uno anterior.
ALTER TABLE user_mfa ADD COLUMN last_totp_step bigint;

-- Desactivar no borra la fila (el runtime no tiene DELETE desde la migración 131):
-- la marca `disabled_at` deja constancia de cuándo se apagó.
ALTER TABLE user_mfa ADD COLUMN disabled_at timestamptz;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
    GRANT SELECT(disabled_at) ON user_mfa TO flash_rls_audit;
  END IF;
END $$;
