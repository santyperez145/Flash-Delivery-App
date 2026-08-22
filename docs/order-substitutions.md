# Sustituciones de productos

La migración `040_order_substitutions.sql` agrega consentimiento explícito para reemplazos durante la preparación.

- El comercio primero marca el producto original sin stock y propone otro producto disponible del mismo comercio.
- Para evitar cargos sorpresa, el reemplazo debe costar igual o menos que el original.
- Mientras exista una decisión pendiente, el pedido no puede avanzar de estado.
- Sólo el cliente propietario puede aceptar o rechazar.
- Al aceptar se reemplaza el snapshot de `job_items`, se reduce el total del job y la captura, y Flash Wallet recibe automáticamente la diferencia mediante un asiento doble balanceado.
- Una propuesta ya decidida no puede procesarse otra vez. La propuesta, decisión, notificación y movimiento financiero quedan auditados.

API: `POST/GET /api/orders/:orderId/substitutions` y `PATCH /api/order-substitutions/:substitutionId`.

En mobile, las propuestas pendientes aparecen arriba de **Actividad** con producto original, reemplazo, motivo y diferencia a reintegrar. Aceptar o rechazar llama al workflow real y refresca pedidos y Wallet; la tarjeta fue validada renderizada dentro del viewport móvil con la barra inferior fija.
