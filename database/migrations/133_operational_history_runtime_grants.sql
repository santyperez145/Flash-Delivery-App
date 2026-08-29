-- El historial operativo central deja de ser borrable por el runtime (DAT-001).
--
-- Los pedidos, ofertas, incidencias, sustituciones, notificaciones y pruebas de
-- entrega cambian de estado, pero el producto no los elimina. Los DELETE de las
-- suites limpian fixtures con el rol migrador. Mantener el permiso en el rol que
-- atiende trafico no aporta una capacidad y permite borrar la secuencia que
-- explica quien ofrecio, acepto, sustituyo, reclamo o completo un servicio.
--
-- Se conservan INSERT y UPDATE. Una futura retencion fisica debera vivir en un
-- worker con rol explicito, ventana publicada, auditoria y restore probado; no
-- en una ruta de cliente, comercio, conductor u operaciones.

REVOKE DELETE ON dispatch_offers FROM flash_runtime;
REVOKE DELETE ON job_items FROM flash_runtime;
REVOKE DELETE ON jobs FROM flash_runtime;
REVOKE DELETE ON notification_deliveries FROM flash_runtime;
REVOKE DELETE ON order_issues FROM flash_runtime;
REVOKE DELETE ON order_item_substitutions FROM flash_runtime;
REVOKE DELETE ON shipment_delivery_evidence FROM flash_runtime;
REVOKE DELETE ON shipment_details FROM flash_runtime;
REVOKE DELETE ON shipment_protection_claims FROM flash_runtime;
REVOKE DELETE ON shipment_return_requests FROM flash_runtime;
