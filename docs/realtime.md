# Realtime durable de Flash

## Contrato

- `GET /api/events` autenticado por JWT.
- SSE sin caché ni buffering, heartbeat cada 25 segundos.
- Cada evento PostgreSQL recibe una secuencia monotónica y se envía como `id:` SSE.
- El cliente conserva el último cursor procesado en `sessionStorage` y lo reenvía mediante `Last-Event-ID` al reconectar.
- La API reproduce hasta 100 eventos posteriores autorizados y luego continúa en vivo.
- El cliente descarta `state.updated` con secuencia repetida, renueva el access token
  si el stream recibe `401` y reintenta con backoff exponencial más jitter hasta 30 segundos.
- Logout elimina también el cursor para que una identidad nueva nunca herede el
  punto de replay de la sesión anterior.

## Arquitectura

`realtime_events` es el event log durable. Un trigger publica solamente su secuencia en el canal PostgreSQL `flash_realtime`; cada réplica de API mantiene una conexión `LISTEN`, recupera la fila y la distribuye a sus conexiones locales. Una escritura hecha desde otra conexión o réplica llega al mismo stream sin memoria compartida.

Los eventos transportan únicamente tipo, entidad, acción, request ID y timestamp. No incluyen coordenadas, direcciones, teléfonos, mensajes ni datos financieros. La app vuelve a consultar el recurso segmentado correspondiente (`/me/activity`, cuenta, catálogo u Operaciones), que aplica autorización y sigue siendo la fuente de verdad.

## Audiencias

Cada fila guarda usuarios públicos y roles autorizados. Pedidos, viajes y envíos se limitan al cliente, comercio, conductor asignado y operaciones. Soporte se limita al cliente y operaciones; wallet/perfil al titular y operaciones; restaurante al comercio propietario y operaciones. Eventos globales de configuración pueden dirigirse a todos los roles autenticados.

El mismo predicado se usa para fanout en vivo y replay, evitando que una reconexión revele eventos que el cliente no habría recibido en directo.

## Retención y operación

```bash
npm run realtime:prune
```

Por defecto conserva siete días y como máximo 100.000 filas. Se configura con `REALTIME_RETENTION_DAYS` y `REALTIME_MAX_ROWS`; producción debe programar este comando como cron/job. Prometheus publica conexiones SSE por instancia y cantidad de eventos retenidos.

## Evolución pendiente

- Insertar el evento en la misma transacción de dominio mediante outbox para todas las mutaciones (actualmente se persiste inmediatamente después del commit).
- WebSocket para presencia bidireccional, chat y tracking de alta frecuencia.
- Métricas de latencia end-to-end, cursores demasiado antiguos y replay truncado.
