-- La autoridad administrativa queda acotada por operacion (ticket DAT-001).
--
-- El runtime asigna y revoca roles con INSERT/DELETE, pero nunca modifica una
-- asignacion existente. Con UPDATE podria convertir en sitio el usuario o el
-- rol de una fila sin recorrer los contratos de alta y baja.
--
-- Flags, perfiles de soporte, zonas y comercios se crean durante migraciones o
-- seeds. El producto actual sólo actualiza su estado. Eliminar o crear estos
-- objetos desde el proceso que atiende trafico agranda el control plane sin
-- habilitar una sola pantalla o flujo real.
--
-- Se conservan exactamente las operaciones observadas. Si aparece un alta real
-- futura, debera entrar con autorización, auditoria y prueba propias en lugar de
-- heredar un permiso preventivo.

REVOKE UPDATE ON user_roles FROM flash_runtime;
REVOKE INSERT, DELETE ON feature_flags FROM flash_runtime;
REVOKE INSERT, DELETE ON merchants FROM flash_runtime;
REVOKE INSERT, DELETE ON service_zones FROM flash_runtime;
REVOKE INSERT, DELETE ON support_agent_profiles FROM flash_runtime;
