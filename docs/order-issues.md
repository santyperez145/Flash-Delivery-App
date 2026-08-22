# Incidencias y reintegros parciales

Los reclamos de pedidos de comida dejaron de ser mensajes informales. La migración `039_order_issues.sql` incorpora un workflow PostgreSQL auditable con estados `open`, `approved` y `rejected`.

## Flujo real

- El cliente propietario abre una incidencia por faltante, producto incorrecto, daño, calidad, demora u otro motivo y puede solicitar un importe hasta el total cobrado.
- Cliente, comercio propietario y operaciones pueden consultar la incidencia; sólo operaciones puede resolverla.
- Un rechazo exige explicación y no mueve fondos.
- Una aprobación puede ejecutar un reintegro parcial de Flash Wallet. La transacción reduce la captura, crea el refund y notifica al cliente.
- Si el pedido ya fue liquidado, se revierte proporcionalmente el split comercio/conductor/plataforma antes de devolver dinero al cliente. Tanto la reversión como el refund son asientos de doble partida balanceados.
- La segunda resolución es rechazada, por lo que una incidencia no puede pagar dos veces.
- En `Actividad`, cada pedido de comida entregado expone un formulario mobile con categoría, descripción y reintegro solicitado. La acción usa el usuario autenticado y persiste el caso en PostgreSQL; el cliente no puede aprobar su propio reintegro.

Las rutas son `POST/GET /api/orders/:orderId/issues` y `PATCH /api/order-issues/:issueId/resolve`.
