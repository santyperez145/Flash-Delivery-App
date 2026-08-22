# Seguridad y seguimiento compartido de viajes

La pantalla de viaje activo permite crear un enlace temporal de seguimiento y activar un SOS. Ya no comparte un texto estático.

## Privacidad del enlace

- El servidor genera 256 bits aleatorios y entrega el bearer token una sola vez.
- PostgreSQL conserva únicamente SHA-256, vencimiento, revocación y contador de vistas.
- Crear otro enlace revoca el anterior. El pasajero también puede revocarlo explícitamente.
- La vista pública no expone teléfono, email, apellido del conductor ni datos de pago. Devuelve estado, ruta, ETA, primer nombre, vehículo y última ubicación disponible.
- Las respuestas públicas usan `Cache-Control: no-store` y están sujetas al rate limit global.

## SOS

Un participante de un viaje activo puede persistir un incidente `sos`, `medical`, `harassment`, `crash`, `unsafe_driving` u `other`. La app pide confirmación y trata de adjuntar ubicación GPS de alta precisión; si el permiso falla, la alerta se envía igualmente. El incidente queda abierto en PostgreSQL, genera notificaciones para roles de operaciones/soporte, evento realtime y auditoría sin guardar el token compartido.

Validación local: `npm run test:ride-safety`.
