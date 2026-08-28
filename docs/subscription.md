# Suscripción — Flash Más

Uber One, DashPass y PedidosYa Plus son el motor de retención y de margen de la
categoría: cambian la frecuencia de compra y el costo de adquisición de todo lo
demás. Flash no tenía tabla, ruta ni concepto hasta la migración 125.

## Los beneficios viven en la fila del plan

`subscription_plans` guarda precio, período y los tres beneficios como valores:
`free_delivery_min_subtotal_cents`, `ride_discount_bps` y
`dispatch_priority_boost`. **Cambiar la oferta es un `UPDATE`, no un
despliegue**, y `test:postgres` lo demuestra corriendo el umbral por encima y
por debajo del subtotal del mismo pedido.

`NULL` en el umbral significa que el plan no da envío sin cargo. No es lo mismo
que un umbral en cero, que lo daría siempre: distinguirlos evita regalar el
envío por un plan mal cargado.

## El envío sin cargo se aplica antes de firmar

`/api/orders/quote` firma un JWT con lo calculado y la creación del pedido sólo
acepta ese precio. Un descuento aplicado después de firmar no sobrevive, así que
el beneficio se calcula dentro de `getPostgresFoodCheckoutQuote` y se revalida al
crear el pedido contra la suscripción **releída dentro de la transacción**.

Se compara como campo propio y no sumado al descuento de promoción: dos errores
que se cancelaran darían el mismo total y pasarían el control cobrando mal el
desglose.

**No se acumula con un cupón de envío sin cargo.** Sin ese corte el envío se
descontaría dos veces y el pedido devolvería plata que nadie cobró.

## Quién paga el beneficio

El comercio cobra igual y el conductor cobra el envío completo aunque el cliente
no lo haya pagado. **La diferencia sale del margen de Flash**, que es de quien
tiene que salir un beneficio que Flash vendió.

Eso obligó a admitir un `platformNet` negativo en la liquidación, acotado
exactamente al subsidio otorgado: se admite perder lo que se regaló y ni un
centavo más, así que un error de tarifa sigue explotando igual que antes. El
asiento de la plataforma se debita en vez de acreditarse y el libro cuadra.

## Todavía no cobra

El cobro recurrente depende de PAY-001, que espera credenciales del proveedor.
`user_subscriptions.billed` distingue un período cobrado de uno otorgado, y las
dos pantallas muestran «Período bonificado» en lugar de simular una membresía
paga. Un período que se otorga y se llama cobrado es la forma más rápida de
tener un problema contable.

## Cancelar no es un estado

`status` es `active` o `expired`. Cancelar pone `cancelled_at` y **no mueve**
`current_period_end`: quien canceló pagó un período y lo termina de usar. Un
tercer estado `cancelled` obligaría a que toda lectura de beneficios aceptara dos
estados, y la primera que se olvidara le cortaría los beneficios a alguien que ya
pagó.

Reactivar dentro del período limpia la cancelación en vez de abrir uno nuevo:
abrir uno cobraría dos veces el mismo tramo.

## Lo que falta

De los tres beneficios sólo el envío sin cargo se aplica hoy.
`ride_discount_bps` no, porque `/api/rides/quote` no exige sesión —es un
estimador público de precio— y personalizarlo ahí cambia el contrato de la ruta.
`dispatch_priority_boost` tampoco, porque el orden de candidatos lo decide
[DSP-001](backlog-tecnico.md). Están en la fila del plan y nombrados como
pendientes, no marcados como hechos.

## Rutas

| Ruta | Quién | Nota |
| --- | --- | --- |
| `GET /api/subscription/plans` | pública | El precio tiene que poder verse antes de crear la cuenta |
| `GET /api/subscription` | sesión | `null` y no 404: no estar suscripto es una respuesta válida |
| `POST /api/subscription` | cliente | Alta o reactivación; una segunda alta vigente es 409 |
| `DELETE /api/subscription` | sesión | Deja de renovar y conserva el período pago |
