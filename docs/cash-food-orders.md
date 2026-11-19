# Efectivo en pedidos de comida (PAG-01)

Como en PedidosYa, Rappi y DiDi Food: quien pide paga en mano, al repartidor si se lo
llevan o en el mostrador si lo retira. Completa el efectivo de viajes
([`cash-rides.md`](cash-rides.md)).

## Cómo funciona

- **Lo decide cada sucursal** (`merchant_branches.cash_enabled`, migración 148), desde la
  consola del comercio. Viene apagado: un local que no lo quiere no recibe pedidos que
  después tiene que cobrar. Así lo configura DiDi Food para sus restaurantes.
- **Quien pide elige «Efectivo»** en el checkout de la web o la app, sólo si la sucursal lo
  acepta. Puede decir **con cuánto paga**, para que el repartidor lleve el vuelto; el monto
  tiene que alcanzar el total.
- **En efectivo no hay propina de checkout** (se da en mano) **ni entrega sin contacto**:
  alguien tiene que recibir la plata.
- **No se cobra nada al crear el pedido** y no se crea una intención de pago. El comercio lo
  recibe aceptado, como un pedido pagado.
- **Quien cobra lo ve**: el repartidor, «Cobrá $ X en efectivo · paga con $ Y, vuelto $ Z»
  (también en la oferta, antes de aceptar); el comercio, en un retiro, «Cobrá $ X en el
  mostrador»; quien pidió, «Pagás en efectivo».
- **Antifraude**, como la competencia. Un pedido en efectivo que nadie recibe deja comida
  hecha y un viaje sin cobrar, así que:
  - hace falta el teléfono verificado;
  - quien tiene dos pedidos en efectivo cancelados **después de empezar a prepararse** en 90
    días ya no puede pagar así, quien sea que haya cancelado y con el motivo que sea;
  - se puede tener un solo pedido en efectivo en curso a la vez;
  - un pedido en efectivo que superaría el tope de deuda de cualquier repartidor no se acepta
    («Para pedidos de este monto, pagá con Wallet o tarjeta»): ningún repartidor podría
    tomarlo y el comercio cocinaría un pedido que nadie lleva;
  - un comercio que debe más de `CASH_MERCHANT_DEBT_LIMIT_CENTS` en comisiones de retiros en
    efectivo deja de recibir efectivo hasta netearlas.

## El dinero

Al completar el pedido se liquida como uno pagado con Wallet: la parte del comercio, la
comisión de la plataforma y el envío del repartidor (`merchant_settlement`). Además se asienta
que quien cobró tiene el efectivo en la mano (`cash_collection`, la misma clase de asiento que
los viajes en efectivo):

| Quién cobró | Queda debiendo | Cómo se salda |
|---|---|---|
| Repartidor (entrega) | Todo menos su envío: la parte del comercio y la comisión | Rindiendo el efectivo a la operación, o neteando con sus próximas ganancias |
| Comercio (retiro, o su propio reparto) | La comisión de la plataforma | Se descuenta de sus próximas liquidaciones |

La caja de compensación vuelve a cero en cada pedido y cada asiento cuadra por sí solo. Un
pedido en efectivo **no se completa sin su liquidación**: es el único registro de esa plata.
Liquidarlo dos veces no duplica nada.

- **Sustituciones.** Un reemplazo más barato baja el total, así que se cobra menos en mano y
  el vuelto crece lo mismo. No hay nada que devolver.
- **Incidencias.** El reintegro de un pedido en efectivo va como saldo a la Flash Wallet de
  quien pidió, como en PedidosYa y Rappi, y sólo una vez entregado y cobrado. Revierte en
  proporción la liquidación (comercio, plataforma y repartidor), como cualquier incidencia.
- **Cancelación.** No hay nada cobrado, así que no hay reintegro. **Un pedido en efectivo que
  ya salió del local lo cancela la operación**, no el repartidor ni quien pidió: quien
  reparte tiene la comida o la plata en la mano, y cancelar no liquida nada. Sin esto, se podía
  cobrar en la puerta, cancelar y quedarse el efectivo sin deuda.
- **Comprobante.** Dice «Efectivo · cobrado» y quién cobró, en vez de «sin registrar».

## La deuda del repartidor y la rendición

- **El tope de deuda mira lo que va a deber**, no sólo lo que debe hoy
  (`CASH_DRIVER_DEBT_LIMIT_CENTS`, el mismo de los viajes): su saldo, más lo que va a deber por
  los pedidos en efectivo que todavía lleva sin liquidar, más el pedido nuevo. Un viaje en
  efectivo suma la comisión; un pedido suma casi todo su valor. Un pedido en efectivo no se le
  ofrece, ni puede aceptarlo, quien quedaría por encima del tope.
- **La rendición de efectivo** (`POST /api/admin/drivers/{driverId}/cash-deposits`): la
  operación registra que un repartidor o conductor entregó efectivo, y su deuda baja en lo que
  entregó. El asiento (`cash_deposit`) acredita su Wallet y debita la caja de efectivo recibido
  de la plataforma. **No puede pasar de lo que debe**: una rendición de más dejaría saldo
  retirable que nadie depositó. Pide `Idempotency-Key`: el formulario reusa la clave al
  reintentar la misma rendición, y una clave repetida con otro repartidor u otro importe se
  rechaza. Todo intento queda en la auditoría.
- El repartidor ve su «Efectivo por rendir» en su cuenta, y la operación lo ve en la lista de
  repartidores, con la acción para registrar la rendición.

## Brechas

- La rendición se registra a mano, en la consola de operaciones. No hay red de cobranza
  (Rapipago o Pago Fácil) para que el repartidor deposite solo: es PAG-03 y depende del dueño.
- El efectivo no entra en las métricas de facturación de operaciones, que cuentan cobros
  registrados.
- Un pedido en efectivo no cuenta como primera compra para el premio de referidos, que exige
  un cobro registrado.

## Validación

`npm run test:cash-food-orders` (en `ci-critical-flows`) usa un cliente y un repartidor
sintéticos y el comercio de ejemplo. Recorre:

- la sucursal que no acepta efectivo (409);
- el antifraude sin teléfono verificado (409);
- un retiro en efectivo por la API: sin cobro, aceptado, con el vuelto; con menos que el total,
  400;
- la liquidación del retiro (el comercio queda debiendo la comisión) y de una entrega (el
  repartidor queda debiendo todo menos su envío), con la caja de compensación en cero y sin
  duplicar al repetir;
- una incidencia: el reintegro va a la Wallet de quien pidió;
- la rendición: baja la deuda, no la supera y no se duplica.

Si falla, un pedido en efectivo puede cerrarse sin comisión, el comercio cobrar dos veces o un
repartidor quedar con deuda que no tiene. Borra todo lo que crea y restaura las opciones de la
sucursal.

`npm run test:cash-food-orders-contract` (en `ci-fast`) vigila lo que esa prueba no ve: el
camino explícito del efectivo en el alta, el rechazo de propina y entrega sin contacto, el
estado inicial, la liquidación obligatoria, el tope proyectado, la rendición acotada y las
pantallas de web y app.
