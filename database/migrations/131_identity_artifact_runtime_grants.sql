-- El runtime deja de poder borrar artefactos de identidad y autorizaciones
-- efímeras (ticket DAT-001).
--
-- `test:runtime-write-scope` cruza permisos efectivos, SQL del servidor y
-- escrituras indirectas. En estas once tablas encontró DELETE concedido sin un
-- solo camino que lo use. El ciclo de vida real es insertar y luego consumir,
-- revocar o invalidar mediante UPDATE: borrar físicamente elimina evidencia de
-- recuperación, acceso, MFA, dispositivos, safety u OAuth.
--
-- El lote es deliberadamente pequeño. Uber documenta que las quitas de IAM
-- también pueden causar outages y las simula antes de desplegarlas; Flash hace
-- el equivalente que puede sostener hoy: inventario de accesos, revocación por
-- operación y replay de toda la suite contra `flash_runtime` en CI.
--
-- Una política futura de retención deberá ejecutar purgas con un rol de worker
-- explícito y auditable. No es motivo para que el proceso que atiende tráfico
-- conserve DELETE permanentemente.

REVOKE DELETE ON email_verification_challenges FROM flash_runtime;
REVOKE DELETE ON merchant_payment_oauth_states FROM flash_runtime;
REVOKE DELETE ON password_recovery_tokens FROM flash_runtime;
REVOKE DELETE ON payout_step_up_authorizations FROM flash_runtime;
REVOKE DELETE ON phone_verification_challenges FROM flash_runtime;
REVOKE DELETE ON refresh_sessions FROM flash_runtime;
REVOKE DELETE ON ride_pickup_verifications FROM flash_runtime;
REVOKE DELETE ON ride_tracking_links FROM flash_runtime;
REVOKE DELETE ON user_devices FROM flash_runtime;
REVOKE DELETE ON user_mfa FROM flash_runtime;
REVOKE DELETE ON user_notification_preferences FROM flash_runtime;
