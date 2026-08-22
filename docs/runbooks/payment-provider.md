# Runbook — degradación del proveedor de pagos

`FlashPaymentProviderDegraded` se activa cuando Mercado Pago supera 5% de
resultados no exitosos durante diez minutos y existieron al menos diez llamadas.
La alerta abarca cobro, reintegro, OAuth y conciliación, sin IDs ni importes.

## Diagnóstico

1. Separar por `operation` y `outcome` en `flash_provider_calls_total`.
2. Confirmar el estado público del proveedor y revisar rate limits, red y DNS.
3. Verificar inbox de webhooks y casos de conciliación; no repetir manualmente un
   pago con una nueva clave idempotente.
4. Si predominan `invalid_response`, detener el rollout y conservar el payload
   únicamente en un entorno seguro de incidentes, nunca en logs de aplicación.

## Mitigación

- Mantener pedidos sin aprobación en estado de validación; no despachar.
- Reintentar sólo operaciones idempotentes con la misma clave y backoff.
- Informar indisponibilidad en checkout si el incidente continúa; Wallet sandbox
  no es reemplazo de un cobro productivo.
- Para reintegros inciertos, consultar el recurso autoritativo antes de reintentar.

La alerta puede cerrarse cuando la proporción vuelve bajo 5%, los casos urgentes
de conciliación están revisados y no quedan pagos aprobados sin captura contable.
