# Prueba de entrega de envíos

Un envío no puede pasar de `delivering` a `delivered` por el endpoint genérico.
El conductor debe confirmar el PIN de cuatro dígitos mediante
`POST /api/shipments/:id/verify-delivery`.

## Seguridad

- El PIN se deriva con HMAC y `DELIVERY_PIN_SECRET`, independiente de JWT y push.
- PostgreSQL guarda únicamente bcrypt; ni jobs, auditoría, notificaciones,
  pagos ni respuestas idempotentes conservan el código en claro.
- Sólo el cliente propietario puede obtenerlo por
  `GET /api/shipments/:id/delivery-code`; conductor y otros clientes reciben 403.
- Tras cinco fallos, la verificación se bloquea 15 minutos. Existe además rate
  limit HTTP específico.
- El PIN deja de estar disponible al completar o cancelar.

Al verificar correctamente, una única transacción bloquea job y detalle, registra
`delivery_verified_at`, autor, evento y prueba `pin+photo` o `pin+photo+signature` sin el secreto. Luego
se acredita la ganancia del conductor con una clave idempotente; repetir la
petición no duplica el pago.

La app cliente permite revelar el PIN bajo demanda y la app conductor presenta
un teclado numérico únicamente en `delivering`. La foto y la firma se almacenan
cifradas; la firma incluye identidad declarada, relación, consentimiento, hora,
ubicación opcional y hash de integridad.
