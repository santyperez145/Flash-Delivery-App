# Centro de notificaciones y preferencias

Mobile presenta un centro persistente con novedades de pedidos, viajes, envíos, sustituciones, incidencias, soporte y Wallet. Cada fila viene de `notifications`, puede marcarse como leída únicamente por su propietario y conserva fecha, canal, plantilla y payload estructurado.

La migración `044_notification_preferences.sql` agrega preferencias por usuario para `service_updates`, `promotions`, `support`, `wallet` y `account`. Promociones nacen con push desactivado; las demás categorías transaccionales nacen activadas.

Al encolar un evento:

- si push está habilitado, ingresa a la outbox para el worker;
- si está deshabilitado, se conserva como notificación `in_app` ya enviada;
- el evento nunca se descarta por una preferencia;
- eventos esenciales como ofertas de dispatch y alertas de seguridad no se silencian;
- deduplicación, cifrado de tokens de dispositivo y reintentos siguen aplicándose.

Las rutas son `GET/PATCH /api/notification-preferences`, `GET /api/notifications` y `PATCH /api/notifications/:id/read`. Las preferencias tienen RLS, ownership de API y auditoría sin contenido privado.

`npm run test:notification-preferences` comprueba defaults, persistencia, fallback in-app, cola push, protección BOLA, lectura y auditoría, restaurando el estado anterior al finalizar.

Los tokens rechazados permanentemente se invalidan sin guardar el valor en claro.
Cuando no queda un dispositivo entregable, la salida pasa a dead-letter en lugar
de quedar en un ciclo infinito. El replay administrativo requiere un dispositivo
activo, no duplica replays ya encolados y registra al operador. La cola operacional
devuelve sólo metadatos de entrega; excluye payloads y material criptográfico.
