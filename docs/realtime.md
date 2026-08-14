# Realtime de Flash

Flash tiene una primera capa realtime funcional para beta local y para validar el modelo operativo antes de introducir un bus de eventos.

## Contrato actual

- `GET /api/events`
- Autenticacion por `Authorization: Bearer <JWT>`.
- Respuesta `text/event-stream` sin cache y con buffering desactivado.
- Frame inicial `connected`.
- Heartbeat cada 25 segundos.
- Evento `state.updated` despues de una mutacion persistida.
- Payload deliberadamente pequeno: id del evento, tipo, entidad, accion, request id y timestamp.

El cliente vuelve a pedir `/api/state` cuando recibe una mutacion. El stream no transporta datos privados ni intenta ser la fuente de verdad; SQLite/API siguen siendo autoritativos.

## Eventos publicados

- `restaurant.updated`
- `order.created`
- `order.updated`
- `ride.created`
- `ride.updated`
- `driver.updated`
- `platform.reset`

## Evolucion productiva

1. Migrar el registro de conexiones a un gateway realtime con Redis Pub/Sub.
2. Filtrar eventos por usuario, comercio, driver, zona y rol.
3. Agregar secuencia monotona por particion y replay desde un event log.
4. Usar WebSocket cuando haga falta comunicacion bidireccional de presencia, chat o tracking.
5. Mantener SSE para dashboard, actividad y notificaciones de solo lectura.
6. Instrumentar conexiones abiertas, latencia de evento, reconexiones y eventos descartados.
