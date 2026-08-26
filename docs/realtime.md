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

### Defecto abierto — fallback fail-open

**`server/realtime-repository.js` tiene dos caminos que devuelven `allRoles` (`admin` + `customer` + `merchant` + `driver`):**

```js
async function resolveAudience(entityType,entityId){
  if(!entityType||!entityId)return{users:[],roles:allRoles};   // línea 8
  ...
  return{users:[],roles:allRoles};                              // línea 16
}
```

El segundo es el peligroso: un `entityType` nuevo, mal escrito o no contemplado convierte un error de clasificación en un broadcast a clientes, comercios y conductores. El patrón es *fail-open*, y **cada tipo de entidad que se agregue en el futuro entra por defecto en el camino inseguro**.

El daño real está limitado porque el evento sólo transporta tipo, entidad, acción, requestId y timestamp, y la app revalida contra un recurso autorizado. Pero el modelo es incorrecto y debe invertirse:

```text
Entidad conocida    → participantes + admin
Entidad desconocida → solamente admin
Sin entidad         → audiencia explícita obligatoria
```

Nunca `unknown → customer + merchant + driver + admin`.

Hallazgo [H-03](auditoria-2026-08-25.md#h-03--realtime-hace-broadcast-a-todos-los-roles-ante-entidad-desconocida), ticket [SEC-001](backlog-tecnico.md#sec-001--realtime-default-deny). Prioridad P0.

### Cobertura RLS de `realtime_events`

`realtime_events` es una de las 20 tablas **sin política RLS** identificadas en el hallazgo [H-04](auditoria-2026-08-25.md#h-04--20-tablas-sin-política-rls-y-cero-force-row-level-security), pese a que su grant explícito es `SELECT, INSERT, DELETE` para `flash_runtime`. El filtrado por audiencia depende hoy exclusivamente de la consulta de aplicación. Debe entrar en la matriz de [DAT-001](backlog-tecnico.md#dat-001--matriz-rls-default-deny).

## Retención y operación

```bash
npm run realtime:prune
```

Por defecto conserva siete días y como máximo 100.000 filas. Se configura con `REALTIME_RETENTION_DAYS` y `REALTIME_MAX_ROWS`; producción debe programar este comando como cron/job. Prometheus publica conexiones SSE por instancia y cantidad de eventos retenidos.

## Evolución pendiente

- **P0 —** Corregir el fallback fail-open de audiencias (ticket [SEC-001](backlog-tecnico.md#sec-001--realtime-default-deny)).
- **P0 —** Clasificar `realtime_events` en la matriz RLS (ticket [DAT-001](backlog-tecnico.md#dat-001--matriz-rls-default-deny)).
- Insertar el evento en la misma transacción de dominio mediante outbox para todas las mutaciones (actualmente se persiste inmediatamente después del commit).
- WebSocket para presencia bidireccional, chat y tracking de alta frecuencia.
- Métricas de latencia end-to-end, cursores demasiado antiguos y replay truncado.
- Métrica de eventos descartados por audiencia no resoluble.

### Cuándo cambiar de transporte

No es necesario incorporar Kafka. La secuencia recomendada por la auditoría es:

1. **PostgreSQL `LISTEN/NOTIFY`** — suficiente para la beta de una ciudad. Es lo que hay hoy.
2. **Redis Streams o NATS** — cuando existan varias réplicas y más consumidores.
3. **Kafka/Redpanda** — sólo con volumen sostenido alto, retención de eventos larga, varios equipos independientes, reprocesamiento analítico y necesidad real de particiones.
