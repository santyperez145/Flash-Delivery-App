# Centro de notificaciones y preferencias

> **Push productivo ya es posible. Falta probarlo en un teléfono.**
>
> Hasta el 26 de agosto de 2026, `NOTIFICATION_PROVIDER` sólo aceptaba `disabled` y `sandbox`, y producción prohibía `sandbox`: el único valor válido en producción era `disabled`. No había forma de entregar un push, y el esquema de configuración lo impedía por construcción.
>
> El enum ahora acepta `expo`. En producción, `EXPO_ACCESS_TOKEN` es obligatoria con él: sin ella, cualquiera que conozca un token de dispositivo puede enviarle notificaciones en nombre de Flash.
>
> **Sigue abierto:** la entrega en un dispositivo físico Android y iOS, que exige credenciales FCM/APNs y un development build. Es la condición de cierre del ticket [NOT-001](backlog-tecnico.md#not-001--push-real). Hallazgo [H-02](auditoria-2026-08-25.md#h-02--push-productivo-es-imposible-por-configuración).

## Proveedor Expo

`server/push-provider.js` implementa envío por lotes (100 por petición), consulta de recibos (1000 por petición), clasificación de errores, reintentabilidad, timeout y métricas por operación. Nunca pone un token de dispositivo en un error.

### Un ticket aceptado no es una entrega

Es la distinción que ordena todo el flujo. Expo sólo confirma que **tomó** el mensaje, y su servicio **no ofrece SLA**.

| Momento | Estado de la notificación |
| --- | --- |
| Encolada | `queued` |
| Ticket aceptado por Expo | `sent` |
| Recibo confirmado | `delivered` |
| Recibo con error | `failed` |
| Recibo ausente | **sigue en `sent`** |

Un recibo ausente no se cuenta como éxito: queda pendiente y la alerta `FlashPushReceiptsStale` lo levanta. Eso es lo que diferencia monitorear la entrega de suponerla.

`npm run worker:push-receipts` confirma las entregas. **Sin él, cada notificación quedaría en `sent` para siempre.** Producción debe programarlo igual que `worker:notifications`. Runbook: [`docs/runbooks/push-receipts.md`](runbooks/push-receipts.md).

### Qué se revoca y qué se reintenta

`DeviceNotRegistered` revoca el token del dispositivo: la app se desinstaló o revocó el permiso, y seguir intentando es basura pura. `InvalidCredentials` y `MismatchSenderId` tampoco se reintentan, porque reintentar no los arregla. El resto sí.

### Verificación

`npm run test:push-provider` verifica el contrato con `fetch` interceptado: sin credenciales ni red. Lo que **no** puede verificar es que un push llegue a un teléfono.

Más adelante: FCM directo para Android, APNs directo para iOS y un proveedor alternativo de contingencia.

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
