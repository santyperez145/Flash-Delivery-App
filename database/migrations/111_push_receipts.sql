-- Recibos de push (ticket NOT-001).
--
-- `notification_deliveries.status` sólo admitía 'delivered' y 'failed', lo que
-- obligaba a tratar un envío aceptado como una entrega. Con un proveedor real
-- eso es falso: Expo devuelve un ticket que sólo dice que tomó el mensaje, y la
-- entrega se confirma después consultando el recibo.
--
-- Sin el estado intermedio no habría forma de distinguir «entregado» de
-- «aceptado y todavía sin confirmar», que es justamente lo que hay que
-- monitorear cuando el proveedor no ofrece SLA.

ALTER TABLE notification_deliveries DROP CONSTRAINT IF EXISTS notification_deliveries_status_check;
ALTER TABLE notification_deliveries
  ADD CONSTRAINT notification_deliveries_status_check
  CHECK(status IN('accepted','delivered','failed'));

ALTER TABLE notification_deliveries
  ADD COLUMN receipt_checked_at timestamptz,
  ADD COLUMN receipt_error_code text;

-- Cola de recibos pendientes: sólo las filas aceptadas y sin consultar.
CREATE INDEX notification_deliveries_pending_receipt_idx
  ON notification_deliveries(created_at)
  WHERE status='accepted' AND receipt_checked_at IS NULL;

-- El auditor puede observar la postura de entrega sin ver contenido ni tokens.
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
    GRANT SELECT(id,notification_id,attempt,provider,status,error_code,receipt_checked_at,receipt_error_code,created_at)
      ON notification_deliveries TO flash_rls_audit;
  END IF;
END $$;
