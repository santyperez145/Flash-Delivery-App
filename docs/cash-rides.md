# Viajes en efectivo (PAG-01)

Como Uber en Argentina: el pasajero puede pagar el viaje en efectivo al conductor.

## Cómo funciona

- **Al pedir,** el pasajero elige Flash Wallet o efectivo, en web y en la app. Con efectivo,
  Flash no cobra nada en el momento.
- **El conductor ve «Cobrá $ X en efectivo»** en la tarjeta del viaje.
- **Al terminar,** Flash liquida la ganancia del conductor y la comisión igual que en un viaje
  con Wallet (asiento `driver_earning`, con su desglose), y además asienta que el conductor
  cobró el total en mano (`cash_collection`, migración 143), que le debe a la plataforma. Neto,
  su saldo baja exactamente la comisión.
- **Tope de deuda.** El saldo puede quedar negativo: es deuda que se netea contra las próximas
  ganancias, como ya pasa con el saldo de un comercio (migración 119). Un conductor que debe
  más de `CASH_DRIVER_DEBT_LIMIT_CENTS` (por omisión 3.000.000 centavos, $ 30.000) **no
  recibe ofertas de viajes en efectivo ni puede aceptarlas** hasta bajar la deuda.
- **La API sólo acepta los dos medios.** Antes un viaje aceptaba cualquier texto, y uno que no
  dijera «wallet» se creaba sin cobro.

## Brechas

- Un viaje en efectivo cancelado no cobra cargo de cancelación: no hay con qué.
- El conductor no puede saldar la deuda pagando: se netea sólo contra sus ganancias. Pagarla
  por Mercado Pago necesita las credenciales productivas (dueño).

## Validación

- `npm run test:cash-rides` (en `ci-critical-flows`) rechaza otro medio de pago, liquida un
  viaje en efectivo y comprueba los dos asientos cuadrados, que el saldo del conductor baja la
  comisión y que una segunda liquidación no duplica nada. Prueba también que quien debe más del
  tope no puede aceptar otro viaje en efectivo. Si falla, Flash puede perder la comisión de un
  viaje en efectivo o dejar a un conductor acumular deuda sin límite.
- `npm run test:cash-rides-contract` (en `ci-fast`) vigila el filtro del despacho, el medio de
  pago de la API y que las dos apps ofrezcan efectivo y se lo muestren al conductor.
