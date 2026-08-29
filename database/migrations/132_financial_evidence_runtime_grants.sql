-- La evidencia financiera deja de ser borrable por el runtime (ticket DAT-001).
--
-- El servidor crea y actualiza estos registros para reflejar el ciclo de vida
-- real de un cobro, una conexion con el PSP, una conciliacion, un retiro o una
-- evaluacion de riesgo. Ningun flujo de producto los elimina. Los DELETE que
-- aparecen en las suites son limpieza de fixtures y se ejecutan con el rol
-- migrador, no con `flash_runtime`.
--
-- Conservar DELETE en el proceso que atiende trafico permitiria que un handler
-- comprometido borrara el evento recibido y tambien el caso que demuestra su
-- diferencia, o que hiciera desaparecer un payout y su evaluacion de riesgo.
-- Revocarlo por operacion conserva INSERT y UPDATE, que son los permisos que el
-- ciclo de vida real necesita.
--
-- El lote sigue el mismo criterio incremental de la migracion 131. Uber publica
-- que las remociones IAM pueden causar outages y las simula antes de aplicar;
-- Flash todavia no tiene replay de trafico productivo, asi que compensa con
-- lotes pequenos, inventario PostgreSQL por nombre y toda la suite ejecutada
-- como `flash_runtime` en CI.

REVOKE DELETE ON mercadopago_webhook_inbox FROM flash_runtime;
REVOKE DELETE ON merchant_payment_connections FROM flash_runtime;
REVOKE DELETE ON payment_reconciliation_cases FROM flash_runtime;
REVOKE DELETE ON payouts FROM flash_runtime;
REVOKE DELETE ON transaction_risk_assessments FROM flash_runtime;
REVOKE DELETE ON webhook_events FROM flash_runtime;
