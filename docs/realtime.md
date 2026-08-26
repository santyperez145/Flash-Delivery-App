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

Cada fila guarda usuarios públicos y roles autorizados. Pedidos, viajes, envíos y trabajos se limitan al cliente, comercio, conductor asignado y operaciones. Soporte se limita al cliente y operaciones; wallet, perfil y direcciones al titular y operaciones; restaurante al comercio propietario y operaciones. Sólo la configuración de plataforma declarada en una allowlist explícita se dirige a todos los roles autenticados.

El mismo predicado se usa para fanout en vivo y replay, evitando que una reconexión revele eventos que el cliente no habría recibido en directo.

### Default-deny (SEC-001, corregido el 26 de agosto de 2026)

La política de audiencias vive en `server/realtime-audience.js`, un módulo sin dependencias que sólo decide **quién** puede recibir un evento. `realtime-repository.js` la usa para resolver participantes concretos.

```text
Entidad conocida    → participantes + admin
Entidad desconocida → solamente admin
Sin entidad         → sólo los tipos declarados como globales llegan a todos
```

La difusión a todos los roles exige estar declarada en una de dos allowlists explícitas. **Nunca es el resultado de que un `entityType` no esté contemplado.**

#### Qué se encontró

El defecto era mayor de lo estimado. `resolveAudience` contemplaba 7 tipos de entidad, pero la API publica 11. **13 de las 44 publicaciones realtime difundían a clientes, comercios y conductores:**

| Entidad | Publicaciones | Audiencia correcta |
| --- | ---: | --- |
| `address` | 6 | Titular de la dirección |
| `job` | 3 | Participantes del trabajo |
| `service_zone` | 1 | Global, deliberada |
| `pricing_change_request` | 1 | Global, deliberada |
| Sin entidad (`platform.reset`) | 1 | Global, deliberada |

Las seis de `address` eran las más relevantes: cada alta, cambio de predeterminada o borrado en el libro de direcciones de un usuario despertaba a toda la plataforma. El evento no transporta la dirección, pero sí revela que ocurrió y fuerza a cada cliente conectado a revalidar.

#### Resultados de resolución

| `outcome` | Significado | ¿Alerta? |
| --- | --- | --- |
| `resolved` | Audiencia resuelta a participantes concretos | No |
| `global` | Difusión a todos los roles, declarada explícitamente | No |
| `actor_fallback` | La entidad ya no existe (borrado); se usó el actor autenticado | No |
| `orphan` | Entidad inexistente y sin actor | Investigar si es sostenido |
| `unclassified` | Clasificación faltante; sólo llegó a operaciones | **Sí** |

`actor_fallback` existe porque los eventos de borrado se publican después del commit: la fila ya no está para resolver su dueño. El actor autenticado es la audiencia correcta, y el endpoint ya validó su propiedad. Nunca se recurre a un rol.

La métrica es `flash_realtime_audience_total{entity_type,outcome}` y la alerta `FlashRealtimeUnclassifiedAudience` dispara ante cualquier `unclassified`. Runbook: [`docs/runbooks/realtime-audience.md`](runbooks/realtime-audience.md).

#### Puerta

`npm run test:realtime-audience` extrae del código todas las publicaciones y exige que cada una resuelva audiencia explícita. Corre en `ci-fast.yml`, sin necesidad de PostgreSQL. Se verificó que **falla** cuando un tipo publicado queda sin clasificar.

Agregar un `entityType` nuevo sin clasificarlo rompe el build.

#### Deuda

- La verificación de runtime de `resolveAudience` contra PostgreSQL todavía no existe; el contrato actual es estático.
- El fallback SQLite de `publishRealtimeEvent` (`server/index.js`) difunde a todos los clientes SSE conectados sin filtrar audiencia. Sólo es alcanzable sin `DATABASE_URL`, es decir en desarrollo y tests, nunca en producción — pero conviene alinearlo.

### Cobertura RLS de `realtime_events`

`realtime_events` es una de las 20 tablas **sin política RLS** identificadas en el hallazgo [H-04](auditoria-2026-08-25.md#h-04--20-tablas-sin-política-rls-y-cero-force-row-level-security), pese a que su grant explícito es `SELECT, INSERT, DELETE` para `flash_runtime`. El filtrado por audiencia depende hoy exclusivamente de la consulta de aplicación. Debe entrar en la matriz de [DAT-001](backlog-tecnico.md#dat-001--matriz-rls-default-deny).

## Retención y operación

```bash
npm run realtime:prune
```

Por defecto conserva siete días y como máximo 100.000 filas. Se configura con `REALTIME_RETENTION_DAYS` y `REALTIME_MAX_ROWS`; producción debe programar este comando como cron/job. Prometheus publica conexiones SSE por instancia y cantidad de eventos retenidos.

## Evolución pendiente

- **P0 —** Clasificar `realtime_events` en la matriz RLS (ticket [DAT-001](backlog-tecnico.md#dat-001--matriz-rls-default-deny)).
- **P0 —** Verificación de runtime de `resolveAudience` contra PostgreSQL, con fixtures multiusuario (cierra la deuda de SEC-001).
- Alinear el fallback SQLite de `publishRealtimeEvent` con la política de audiencias.
- Insertar el evento en la misma transacción de dominio mediante outbox para todas las mutaciones (actualmente se persiste inmediatamente después del commit).
- WebSocket para presencia bidireccional, chat y tracking de alta frecuencia.
- Métricas de latencia end-to-end, cursores demasiado antiguos y replay truncado.
- Dashboard para `flash_realtime_audience_total` (hoy existe la métrica y la alerta, no el panel).

### Cuándo cambiar de transporte

No es necesario incorporar Kafka. La secuencia recomendada por la auditoría es:

1. **PostgreSQL `LISTEN/NOTIFY`** — suficiente para la beta de una ciudad. Es lo que hay hoy.
2. **Redis Streams o NATS** — cuando existan varias réplicas y más consumidores.
3. **Kafka/Redpanda** — sólo con volumen sostenido alto, retención de eventos larga, varios equipos independientes, reprocesamiento analítico y necesidad real de particiones.
