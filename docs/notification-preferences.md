# Centro de notificaciones y preferencias

> **Bloqueador P0 abierto — no existe push productivo.**
>
> `server/config.js:26` declara `NOTIFICATION_PROVIDER: z.enum(["disabled","sandbox"])` y `server/config.js:98` prohíbe `sandbox` en producción. **El único valor válido en producción es `disabled`.** Además, `server/notification-repository.js:465` envía a dead-letter cualquier proveedor distinto de `sandbox`.
>
> Todo lo descrito abajo — outbox, preferencias, dedupe, reintentos, dead-letter, replay administrativo, invalidación de dispositivos — está bien construido, pero **no tiene a dónde entregar**. El esquema de configuración impide un proveedor productivo por construcción.
>
> Hallazgo [H-02](auditoria-2026-08-25.md#h-02--push-productivo-es-imposible-por-configuración), ticket [NOT-001](backlog-tecnico.md#not-001--push-real).

## Camino de salida — Expo Push

Primer paso: extender el enum a `disabled | sandbox | expo`, y más adelante `fcm` y `apns`.

El proveedor Expo requiere Batch API, push tickets, **consulta de receipts**, invalidación por `DeviceNotRegistered`, retry con backoff, rate limits, circuit breaker, métricas por plantilla y fallback in-app.

El servicio de Expo **no ofrece SLA**, por lo que Flash debe tratar la entrega como asíncrona y monitoreada, nunca como garantizada. Más adelante: FCM directo para Android, APNs directo para iOS y un proveedor alternativo de contingencia.

El ticket no se cierra sin **evidencia física**: registro o captura de un dispositivo Android real y uno iOS real adjuntos al PR.

---

## Comportamiento actual

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
