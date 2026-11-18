-- Borrado de cuenta (LAN-001): dos huecos que la revisión encontró después del merge.
--
-- **Los comprobantes ya emitidos también guardan dónde vive la persona.**
-- `getOrCreatePostgresReceipt` copia origen y destino en `service_receipts.metadata`
-- al emitir, y devuelve el comprobante existente sin rehacerlo. La 138 redacta
-- `jobs`, pero no esa copia. Se redacta con la misma regla: el destino siempre, y
-- el origen cuando no es un comercio. Los montos y líneas, que son el comprobante,
-- no se tocan.
--
-- Se hace con un disparador sobre el paso a `deleted`, y no editando la función
-- de la 138: corre en la misma transacción del borrado, y cubre cualquier camino
-- que en el futuro marque una cuenta como eliminada.
CREATE FUNCTION app.redact_deleted_customer_receipts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp AS $$
BEGIN
  UPDATE service_receipts r
     SET metadata = r.metadata
                    || jsonb_build_object('dropoff', 'Dirección eliminada')
                    || CASE WHEN j.merchant_id IS NULL
                            THEN jsonb_build_object('pickup', 'Dirección eliminada')
                            ELSE '{}'::jsonb END
    FROM jobs j
   WHERE j.id = r.job_id AND r.customer_id = NEW.id;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION app.redact_deleted_customer_receipts() FROM PUBLIC;
CREATE TRIGGER users_redact_receipts_on_delete
AFTER UPDATE OF status ON users FOR EACH ROW
WHEN (NEW.status = 'deleted' AND OLD.status IS DISTINCT FROM 'deleted')
EXECUTE FUNCTION app.redact_deleted_customer_receipts();

-- Las cuentas que se eliminaron con la 138 y antes de esta ya no van a volver a
-- pasar a `deleted`: sus comprobantes se redactan una vez acá, con la misma regla.
UPDATE service_receipts r
   SET metadata = r.metadata
                  || jsonb_build_object('dropoff', 'Dirección eliminada')
                  || CASE WHEN j.merchant_id IS NULL
                          THEN jsonb_build_object('pickup', 'Dirección eliminada')
                          ELSE '{}'::jsonb END
  FROM jobs j, users u
 WHERE j.id = r.job_id AND u.id = r.customer_id AND u.status = 'deleted';

-- **Una cuenta eliminada no vuelve.** La moderación podía pasarla a `active`, y un
-- JWT de acceso todavía vigente volvía a servir, porque `requireAuth` mira el estado
-- de la cuenta y no las sesiones revocadas. La base lo impide para cualquier
-- llamador, no sólo para la pantalla de moderación.
CREATE FUNCTION app.keep_deleted_account_terminal() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'FLASH_ACCOUNT_DELETED' USING ERRCODE = 'P0001';
END;
$$;
CREATE TRIGGER users_deleted_is_terminal
BEFORE UPDATE OF status ON users FOR EACH ROW
WHEN (OLD.status = 'deleted' AND NEW.status IS DISTINCT FROM 'deleted')
EXECUTE FUNCTION app.keep_deleted_account_terminal();
