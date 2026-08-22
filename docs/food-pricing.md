# Cotización real de comida

El checkout de comida usa PostgreSQL/PostGIS como autoridad del precio de entrega.

## Flujo

1. El cliente selecciona una dirección geocodificada propia.
2. `POST /api/orders/quote` calcula distancia comercio-destino y aplica el plan `food` activo y el multiplicador de la zona que contiene al comercio.
3. La API carga el carrito desde sus identificadores, valida inventario/sucursal y calcula subtotal, delivery, servicio, descuento y total. Si hay cupón, comprueba vigencia, reglas, cupos y uso del cliente.
4. El método de pago se resuelve por su identificador tokenizado y debe pertenecer al usuario autenticado. La etiqueta enviada por el cliente no es autoridad.
5. La API devuelve el desglose final, ETA, distancia, versión tarifaria y un JWT firmado válido durante cinco minutos.
6. Mobile muestra una pantalla de checkout dedicada y envía ese mismo token al confirmar. El backend recalcula y rechaza cualquier cambio de carrito, promoción, dirección, método o importe antes del cobro.
7. El pedido conserva `quoteId`, versión, distancia, zona e importes consentidos en sus metadatos para auditoría.

El cliente nunca decide la tarifa. La creación es idempotente y cualquier rechazo previo a la transacción deja cero claves o movimientos financieros residuales. Wallet se captura de forma atómica y balanceada; las tarjetas externas permanecen pendientes de un PSP productivo y no se presentan como cobradas.

## Plan versionado

La migración `038_food_pricing_plan.sql` incorpora `food` a `pricing_plans`. Su configuración incluye base, precio por kilómetro, mínimos/máximos, cargo de servicio, factor vial y radio máximo. Operaciones puede publicar una nueva versión mediante `POST /api/admin/pricing/food`; el cambio queda auditado y sólo una versión permanece activa.

El runtime smoke verifica la firma, propiedad de dirección y método, PostGIS, procedencia tarifaria, desglose exacto, rechazo de carrito alterado, promociones, inventario, Wallet, rollback, settlement e idempotencia.
