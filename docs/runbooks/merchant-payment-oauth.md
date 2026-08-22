# Runbook — autorización de cobros de comercios

La alerta `FlashMerchantPaymentOAuthReconnectRequired` indica que al menos una
conexión seller venció o agotó cinco renovaciones automáticas. La métrica es
agregada y no contiene IDs de comercios, tokens ni motivos del proveedor.

## Diagnóstico

1. Confirmar que `npm run worker:payment-oauth` está desplegado y ejecutándose.
2. Consultar en PostgreSQL, usando un rol operativo autorizado, las conexiones con
   `revoked_at IS NULL AND (refresh_failures >= 5 OR token_expires_at <= now())`.
3. Revisar `refresh_last_error`, `refresh_last_at` y el estado del proveedor. No
   copiar ciphertexts, códigos OAuth ni respuestas completas a tickets o logs.
4. Si el problema es global, pausar reintentos y escalar al proveedor antes de que
   venzan más credenciales. Si es individual, pedir al comercio que use
   **Reconectar Mercado Pago** en su portal.

## Recuperación

Una reconexión OAuth válida reemplaza ambos tokens, reinicia los fallos y conserva
la identidad seller comprobada. Verificar que la serie
`status="reconnect_required"` vuelve a cero. No editar tokens o contadores a mano;
si la identidad devuelta cambia, investigar posible vinculación de una cuenta
incorrecta y no forzar la asociación.
