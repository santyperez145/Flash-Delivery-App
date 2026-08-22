# Confirmación y recompra de comida

Después de confirmar un checkout, mobile muestra el identificador persistido, total capturado, ETA calculada y acceso directo a Actividad. La confirmación usa la respuesta de `POST /api/orders`; no fabrica un pedido optimista local.

`POST /api/orders/:orderId/reorder` sólo admite clientes y deriva la identidad del token. El repositorio verifica que el pedido histórico pertenezca al cliente y reconstruye un carrito nuevo usando identificadores de producto y modificadores guardados en el snapshot inmutable.

La recompra nunca reutiliza precios históricos. Antes de escribir el carrito vuelve a comprobar:

- comercio activo;
- sucursal principal abierta según horario y pausa manual;
- inventario local disponible y cantidad positiva;
- producto publicado;
- modificadores todavía existentes, disponibles y dentro de los mínimos/máximos actuales.

Si una sola línea dejó de ser válida se revierte la operación completa y el cliente recibe un conflicto; el checkout posterior vuelve a cotizar dirección, distancia, tarifas, promociones y medio de pago.
