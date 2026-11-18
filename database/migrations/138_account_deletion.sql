-- Borrado de cuenta desde la app (ticket LAN-001).
--
-- Apple y Google exigen que una app que permite crear cuentas permita borrarlas
-- desde la app. Sin esto Flash no se publica. Es además la parte técnica del
-- derecho de supresión de datos personales.
--
-- **Se anonimiza, no se borran filas del usuario.** Los pedidos, el ledger, los
-- pagos, las propinas, las calificaciones y la auditoría apuntan a `users`, y
-- varios son registros que se conservan por obligación: borrar la fila
-- arrastraría en cascada la historia financiera, o rompería las referencias. La
-- persona deja de ser identificable —nombre, correo, teléfono, direcciones,
-- dispositivos, preferencias— y las transacciones quedan atadas a una cuenta
-- anónima. El plazo de conservación de cada registro lo define la asesoría
-- legal (ver docs/lanzamiento.md); esto no lo decide.
--
-- **Una sola función, no permisos de borrado para el runtime.** La migración 135
-- dejó a `flash_runtime` con las operaciones que el producto ejecuta de verdad.
-- Darle DELETE sobre veinte tablas para esta única ruta sería ampliar su
-- autoridad en todas ellas; la función hace el trabajo con los permisos de su
-- dueño, dentro de una transacción, y el runtime sólo puede ejecutarla.

ALTER TABLE users DROP CONSTRAINT users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check
  CHECK (status IN ('active', 'suspended', 'pending', 'deleted'));
-- `users.deleted_at` ya existe desde la migración 003 y nada la usaba: el borrado
-- la escribe por primera vez, en lugar de agregar una segunda columna igual.

CREATE FUNCTION app.delete_customer_account(p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
-- `search_path` fijo y con `pg_temp` **al final**: si no se lo nombra, PostgreSQL
-- busca las tablas en el esquema temporal *antes* que en cualquier otro, y
-- cualquier rol con permiso TEMP podría tapar `users` con una tabla suya. El final
-- de esta migración corrige lo mismo en las funciones que ya existían.
SET search_path = public, pg_catalog, pg_temp AS $$
DECLARE
  v_saldo bigint;
BEGIN
  PERFORM 1 FROM users WHERE id = p_user AND status <> 'deleted' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FLASH_DELETE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- Comercios, repartidores y staff no se borran al instante: tienen pagos,
  -- liquidaciones u obligaciones pendientes. Su borrado lo gestiona soporte.
  IF EXISTS (SELECT 1 FROM user_roles WHERE user_id = p_user AND role <> 'customer') THEN
    RAISE EXCEPTION 'FLASH_DELETE_ROLE' USING ERRCODE = 'P0001';
  END IF;

  -- Un pedido en curso necesita a alguien a quien entregárselo y cobrarle.
  IF EXISTS (
    SELECT 1 FROM jobs WHERE customer_id = p_user AND status NOT IN ('completed', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'FLASH_DELETE_ACTIVE_JOB' USING ERRCODE = 'P0001';
  END IF;

  -- Un reclamo abierto es plata que todavía se le puede deber: se resuelve antes.
  IF EXISTS (SELECT 1 FROM order_issues WHERE reporter_id = p_user AND status = 'open')
     OR EXISTS (
       SELECT 1 FROM shipment_protection_claims
        WHERE customer_id = p_user
          AND status IN ('submitted', 'under_review', 'approved', 'settlement_pending'))
     OR EXISTS (
       SELECT 1 FROM shipment_return_requests
        WHERE requested_by = p_user AND status IN ('requested', 'approved', 'in_transit'))
  THEN
    RAISE EXCEPTION 'FLASH_DELETE_OPEN_CLAIM' USING ERRCODE = 'P0001';
  END IF;

  -- Saldo en la wallet es plata de la persona: no se borra con la cuenta.
  SELECT COALESCE(sum(CASE WHEN e.direction = 'credit' THEN e.amount_cents ELSE -e.amount_cents END), 0)
    INTO v_saldo
    FROM ledger_accounts a
    JOIN ledger_entries e ON e.account_id = a.id
    JOIN ledger_transactions t ON t.id = e.transaction_id
   WHERE a.owner_type = 'user' AND a.owner_id = p_user AND a.account_type = 'wallet'
     AND t.status = 'posted';
  IF v_saldo <> 0 THEN
    RAISE EXCEPTION 'FLASH_DELETE_WALLET_BALANCE' USING ERRCODE = 'P0001';
  END IF;

  -- Datos personales sin valor de registro: se borran.
  DELETE FROM addresses WHERE user_id = p_user;
  DELETE FROM carts WHERE customer_id = p_user;
  DELETE FROM favorites WHERE user_id = p_user;
  DELETE FROM user_devices WHERE user_id = p_user;
  DELETE FROM email_verification_challenges WHERE user_id = p_user;
  DELETE FROM phone_verification_challenges WHERE user_id = p_user;
  DELETE FROM password_recovery_tokens WHERE user_id = p_user;
  DELETE FROM user_dietary_preferences WHERE user_id = p_user;
  DELETE FROM user_dietary_profiles WHERE user_id = p_user;
  DELETE FROM user_avoided_allergens WHERE user_id = p_user;
  DELETE FROM user_notification_preferences WHERE user_id = p_user;
  DELETE FROM user_mfa WHERE user_id = p_user;
  DELETE FROM ride_destination_history WHERE user_id = p_user;
  DELETE FROM ride_trusted_contacts WHERE user_id = p_user;
  DELETE FROM notifications WHERE user_id = p_user;
  DELETE FROM product_events WHERE user_id = p_user;
  -- Las respuestas guardadas para reintentos repiten el pedido entero, dirección incluida.
  DELETE FROM idempotency_keys WHERE user_id = p_user;

  -- Lo que tiene historia se cierra, no se borra.
  UPDATE refresh_sessions SET revoked_at = now() WHERE user_id = p_user AND revoked_at IS NULL;
  UPDATE payment_methods SET revoked_at = now(), is_default = false
   WHERE user_id = p_user AND revoked_at IS NULL;
  UPDATE user_subscriptions SET status = 'expired', cancelled_at = COALESCE(cancelled_at, now()),
         updated_at = now()
   WHERE user_id = p_user AND status = 'active';
  UPDATE group_orders SET status = 'cancelled' WHERE host_id = p_user AND status IN ('open', 'locked');
  -- El código de referido deja de aceptarse, y una recompensa pendiente no se paga
  -- a una cuenta que ya no existe.
  UPDATE referral_codes SET disabled_at = COALESCE(disabled_at, now()) WHERE user_id = p_user;
  UPDATE referral_attributions SET status = 'rejected', rejection_reason = 'account_deleted'
   WHERE status = 'pending' AND (advocate_user_id = p_user OR referred_user_id = p_user);

  -- Los pedidos se conservan como comprobantes, pero sin dónde vive la persona.
  -- El destino es suyo siempre; el origen sólo cuando no es un comercio (viajes y
  -- envíos salen de su casa). La ubicación queda a una grilla de ~1 km, que
  -- alcanza para las métricas de zona y no señala una puerta.
  UPDATE jobs
     SET dropoff_address = 'Dirección eliminada',
         dropoff_location = ST_SnapToGrid(dropoff_location::geometry, 0.01)::geography,
         pickup_address = CASE WHEN merchant_id IS NULL THEN 'Dirección eliminada' ELSE pickup_address END,
         pickup_location = CASE WHEN merchant_id IS NULL
                                THEN ST_SnapToGrid(pickup_location::geometry, 0.01)::geography
                                ELSE pickup_location END,
         metadata = metadata #- '{deliveryPreferences,instructions}',
         updated_at = now()
   WHERE customer_id = p_user;
  -- Quien recibió un envío es un tercero que la persona cargó: tampoco se conserva.
  UPDATE shipment_details d
     SET recipient_name = 'Destinatario eliminado',
         recipient_phone = '',
         delivery_notes = NULL
    FROM jobs j
   WHERE j.id = d.job_id AND j.customer_id = p_user;
  UPDATE shipment_delivery_evidence e
     SET signer_name = 'Firmante eliminado'
    FROM jobs j
   WHERE j.id = e.job_id AND j.customer_id = p_user AND e.signer_name IS NOT NULL;

  -- La identidad: deja de ser alguien. El correo queda único y no entregable
  -- (`.invalid` está reservado para eso); la contraseña, imposible de igualar.
  UPDATE users
     SET email = 'eliminada+' || public_id || '@flash.invalid',
         name = 'Cuenta eliminada',
         phone = NULL,
         password_hash = '!cuenta-eliminada',
         profile = '{}'::jsonb,
         email_verified_at = NULL,
         phone_verified_at = NULL,
         status = 'deleted',
         deleted_at = now(),
         updated_at = now()
   WHERE id = p_user;
END;
$$;

REVOKE EXECUTE ON FUNCTION app.delete_customer_account(uuid) FROM PUBLIC;

-- **Un pedido no se crea para una cuenta eliminada.** El chequeo de pedidos en
-- curso de arriba no alcanza solo: un checkout que leyó la cuenta antes del
-- borrado puede insertar su pedido después. Este disparador toma la fila del
-- cliente con FOR SHARE, que espera al FOR UPDATE del borrado: o el pedido entra
-- primero y el borrado lo ve y se niega, o el borrado termina primero y el pedido
-- encuentra la cuenta eliminada.
CREATE FUNCTION app.reject_job_for_deleted_customer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp AS $$
BEGIN
  PERFORM 1 FROM users WHERE id = NEW.customer_id AND status <> 'deleted' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FLASH_CUSTOMER_DELETED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION app.reject_job_for_deleted_customer() FROM PUBLIC;
CREATE TRIGGER jobs_reject_deleted_customer
BEFORE INSERT ON jobs FOR EACH ROW
EXECUTE FUNCTION app.reject_job_for_deleted_customer();

-- Las funciones con permisos de dueño que ya existían tenían el mismo hueco:
-- `pg_temp` sin nombrar se busca primero.
ALTER FUNCTION app.is_group_order_member(uuid) SET search_path = public, pg_catalog, pg_temp;
ALTER FUNCTION app.can_read_group_order_item(uuid) SET search_path = public, pg_catalog, pg_temp;
ALTER FUNCTION app.chain_audit_event() SET search_path = pg_catalog, public, app, pg_temp;
ALTER FUNCTION app.audit_chain_invalid_count() SET search_path = pg_catalog, public, app, pg_temp;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_runtime') THEN
    GRANT EXECUTE ON FUNCTION app.delete_customer_account(uuid) TO flash_runtime;
  END IF;
END $$;
