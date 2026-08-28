-- Los registros de hechos ocurridos dejan de ser editables (ticket DAT-001).
--
-- Segundo lote del acotamiento que midio `test:runtime-write-scope`. El primero
-- (migracion 122) cubrio el libro contable y los registros de eventos. Este
-- cubre la misma idea aplicada a lo que el producto **anota porque paso**: un
-- mensaje enviado, una propina dada, un pedido cancelado, una incidencia
-- reportada, un canje de promocion.
--
-- Ninguna de estas filas se corrige editandola. Si algo estuvo mal, lo que
-- corresponde es otra fila que lo diga —una reversion, un ajuste, un mensaje
-- nuevo—, que ademas es lo unico que deja rastro de que hubo una correccion.
--
-- El caso mas grave del lote va primero.

-- `schema_migrations` es el registro de que migraciones se aplicaron, y el
-- runtime tenia INSERT, UPDATE y DELETE sobre el. Con eso, un handler
-- comprometido puede declarar aplicada una migracion que no corrio, o borrar el
-- rastro de una que si. Todo el mecanismo de despliegue y el ensayo de restore
-- —que compara este registro contra los archivos del repositorio— descansan en
-- que diga la verdad.
--
-- Lo escribe el migrador (`flash_app`), nunca el runtime. La lectura se conserva.
REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM flash_runtime;

-- Mensajeria de servicio y soporte: lo dicho, dicho.
REVOKE UPDATE, DELETE ON service_messages FROM flash_runtime;
REVOKE UPDATE, DELETE ON service_message_attachments FROM flash_runtime;
REVOKE UPDATE, DELETE ON service_message_reads FROM flash_runtime;
REVOKE UPDATE, DELETE ON support_messages FROM flash_runtime;
REVOKE UPDATE, DELETE ON support_ticket_assignments FROM flash_runtime;

-- Dinero y comprobantes que ya se emitieron.
REVOKE UPDATE, DELETE ON service_tips FROM flash_runtime;
REVOKE UPDATE, DELETE ON service_receipts FROM flash_runtime;
REVOKE UPDATE, DELETE ON promotion_redemptions FROM flash_runtime;

-- Hechos operativos reportados.
REVOKE UPDATE, DELETE ON job_cancellations FROM flash_runtime;
REVOKE UPDATE, DELETE ON ride_safety_incidents FROM flash_runtime;
REVOKE UPDATE, DELETE ON shipment_claim_evidence FROM flash_runtime;
REVOKE UPDATE, DELETE ON zone_readiness_assessments FROM flash_runtime;
