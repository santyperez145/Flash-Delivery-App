-- Se borran dos tablas que nadie escribe ni lee (ticket DAT-001).
--
-- `user_security_factors` es la que importa. Tiene forma de almacén de
-- credenciales —`secret_ciphertext` para TOTP, `credential_id` y `public_key`
-- para WebAuthn— y quedó superada por `user_mfa`, que es donde el MFA
-- administrativo guarda de verdad su secreto. Ningún archivo de `server/` ni de
-- `scripts/` la nombra.
--
-- Una tabla así vacía no es inofensiva. No tenía política RLS, y el rol
-- `flash_runtime` llega a ella por el `GRANT ... ON ALL TABLES` que este mismo
-- ticket todavía debe restringir. Es decir: existía un almacén de segundos
-- factores accesible sin condición de fila y sin nadie que lo vigilara, porque
-- nadie lo usaba. El día que alguien la hubiera adoptado, habría heredado esa
-- ausencia de política sin darse cuenta.
--
-- `outbox_events` es el patrón outbox de la migración 001, que nunca se
-- implementó: la entrega diferida real vive en `notifications` y
-- `notification_deliveries`. Se lleva su índice parcial por delante.
--
-- Borrar en lugar de dejarlas es la decisión: una tabla sin uso no se puede
-- probar, así que la deuda de RLS sobre ella no se puede cerrar más que
-- eliminándola. Si alguna vuelve a hacer falta, vuelve con su política y su
-- prueba negativa en el mismo PR, que es lo que la definición de terminado de
-- este ticket exige para cualquier tabla nueva.

DROP TABLE IF EXISTS outbox_events;
DROP TABLE IF EXISTS user_security_factors;
