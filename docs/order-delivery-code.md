# Código de entrega en pedidos (SEG-03)

Como el PIN de Uber Eats: un pedido con envío se entrega con un código de 4 dígitos
cuando hay más en juego.

## Cuándo

- **Valor alto:** el total del pedido, sin propina, llega a `ORDER_DELIVERY_CODE_MIN_CENTS`
  (por omisión 6.000.000 centavos, $ 60.000).
- **Reclamo previo:** el cliente tuvo un reclamo aprobado en los últimos 90 días. Uber Eats
  pide el PIN a quien reporta problemas seguido; acá alcanza con uno aprobado.
- **Nunca en un retiro en el local:** no hay entrega en una puerta.

Se decide al crear el pedido, en la misma transacción (`requireOrderDeliveryCodeIfNeeded`).

## Cómo

1. El cliente ve el código en el seguimiento, en web y móvil, mientras el pedido sigue en
   curso. Sólo él: quien reparte recibe 403.
2. Al llegar, quien reparte lo ingresa. Recién ahí puede marcar el pedido entregado: el
   servidor rechaza el cierre con 409 si falta. Operaciones puede cerrar sin código,
   auditado.
3. Cinco intentos fallidos bloquean diez minutos, también al código correcto.

Mismo esquema que el PIN de subida de los viajes: el código se deriva con HMAC del id del
pedido (`DELIVERY_PIN_SECRET`) y en la base (`order_delivery_codes`, migración 142) sólo
queda su hash bcrypt. La verificación se audita sin el código.

## Validación

`npm run test:order-delivery-code`, en `ci-critical-flows`:

- dentro de una transacción que se deshace, prueba la decisión con un cliente sintético:
  valor alto sí, retiro no, chico sin reclamos no, chico con reclamo aprobado sí;
- con un pedido en camino, prueba que el cliente ve el código y quien reparte no, que sin
  código no se cierra, que uno mal cargado no sirve y que cinco errores bloquean.

Si falla, un pedido de valor alto puede cerrarse sin que el cliente lo haya recibido.
`test:rls` prueba que el estado del código lo ve quien pidió y no otro cliente.
`test:delivery-preferences` vigila el cableado en servidor, web y móvil.
