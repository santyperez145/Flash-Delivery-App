# Runbook — recibos de push sin confirmar

Alerta: `FlashPushReceiptsStale`.

## Qué significa

Hay más de 100 tickets de push en estado `accepted` sin recibo confirmado durante 30 minutos.

Un ticket aceptado **no es una entrega**: Expo sólo confirmó que tomó el mensaje. La entrega se confirma consultando el recibo después, y hasta entonces la notificación queda en `sent`, no en `delivered`.

## Por qué la alerta existe

El servicio de push de Expo **no ofrece SLA**. Si Flash tratara el ticket como entrega, un fallo silencioso del proveedor sería indistinguible de una operación normal: el panel mostraría todo entregado mientras ningún conductor recibe sus ofertas.

Esta alerta es la que convierte «suponer la entrega» en «monitorearla».

## Causas, en orden de probabilidad

1. **El worker de recibos no está corriendo.** Es la causa más común y la más fácil de descartar.

   ```bash
   npm run worker:push-receipts
   ```

   Producción debe programarlo igual que `worker:notifications`. Si nadie lo programó, los tickets se acumulan indefinidamente.

2. **Expo está degradado.** Revisar la tasa de fallos del proveedor:

   ```promql
   sum by (operation, outcome) (rate(flash_provider_calls_total{provider="expo"}[10m]))
   ```

3. **Credenciales inválidas.** Un `invalid_credentials` o `credential_mismatch` en los tickets indica que las credenciales FCM/APNs del proyecto Expo caducaron o no corresponden al bundle. No se reintenta: hay que renovarlas.

4. **Volumen legítimo por encima del umbral.** Si el volumen creció, el umbral de 100 puede haber quedado corto. Subirlo es una decisión explícita, no el reflejo ante la primera alerta.

## Diagnóstico

```sql
SELECT status, receipt_error_code, count(*)
FROM notification_deliveries
WHERE provider='expo' AND created_at > now() - interval '2 hours'
GROUP BY status, receipt_error_code
ORDER BY count DESC;
```

Antigüedad de lo pendiente:

```sql
SELECT min(created_at) AS mas_viejo, count(*)
FROM notification_deliveries
WHERE status='accepted' AND receipt_checked_at IS NULL;
```

## Un recibo ausente no es un éxito

Si Expo no devuelve recibo para un ticket, la fila queda como `accepted` a propósito. **No se promueve a `delivered`.** Expo conserva los recibos un tiempo acotado: pasado ese plazo, esa notificación es sencillamente de destino desconocido.

Cuando eso se vuelve sostenido, el problema no es la cola: es que no se está pudiendo verificar la entrega, y el producto no debería prometer que la notificación llegó.

## Qué NO hacer

No marcar los pendientes como entregados para bajar la métrica. La alerta existe precisamente para impedir esa mentira, y hacerlo dejaría a operaciones sin forma de distinguir una caída del proveedor de una operación normal.
