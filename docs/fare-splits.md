# Dividir la tarifa de un viaje (PAG-02)

Como en Uber: quien pidió un viaje invita a quienes viajan con él, y cada uno paga su parte.

## Cómo funciona

- **Quién invita.** Quien pidió el viaje, si lo pagó con Flash Wallet y el viaje sigue en
  curso. Invita por email, hasta cuatro invitaciones.
- **Invitar no dice quién tiene cuenta.** Un email que no es de un cliente activo se guarda
  como una invitación más, que nunca se acepta, y la respuesta es la misma. Hasta que alguien
  acepta, quien invita ve el email que escribió y no un nombre. Como cada viaje admite cuatro
  invitaciones, averiguar cuentas así cuesta un viaje pagado cada cuatro emails; además las
  invitaciones tienen su propio límite de pedidos por minuto.
- **El invitado** recibe una push y ve la invitación en el inicio de Viajes, con la parte que
  le tocaría. Si acepta, la paga en el momento desde su Flash Wallet; sin saldo suficiente, no
  se acepta y nada se mueve.
- **Partes iguales, reequilibradas.** La tarifa se divide entre quien pidió y quienes
  aceptaron. Con cada aceptación, el nuevo paga su parte y a los anteriores se les devuelve lo
  que pagaron de más; quien pidió absorbe los centavos que no dividen exacto.
- **Cancelación.** Quien pidió recupera el total como siempre, y a cada invitado se le
  devuelve lo que pagó, en la misma transacción.
- **Borrar la cuenta.** Quien aceptó dividir un viaje que sigue en curso no puede borrar su
  cuenta hasta que termine: un reequilibrio o una cancelación le van a devolver plata.
- **Sin bloqueos cruzados.** Sólo se bloquea la billetera del invitado que paga, para
  controlar su saldo. Bloquear varias en distinto orden podía trabar una aceptación con una
  cancelación simultánea.
- **En pantalla.** Las invitaciones se releen cada 30 segundos en el inicio, y si no se pueden
  leer se dice, con «Reintentar».

## Por qué entre pasajeros

El viaje ya está cobrado entero a quien lo pidió. Cada parte es un reintegro de un pasajero a
otro (asiento `fare_split`, migración 144). Así la liquidación del conductor, la comisión y los
reintegros de una cancelación no cambian: dividir la tarifa no toca el dinero de nadie más.

## Brechas

- Sólo con Flash Wallet: un viaje en efectivo no se divide.
- No se puede dividir un viaje ya terminado. Uber tampoco lo permite.
- Se invita por email, no por la agenda del teléfono.

## Validación

`npm run test:fare-splits` (en `ci-critical-flows`), con cuatro cuentas sintéticas y un viaje
cobrado de verdad: invitar sin cuenta (404) y repetido (409), aceptar y reequilibrar, aceptar
sin saldo (402, sin movimientos) y cancelar, comprobando los saldos del libro contable en cada
paso. Si falla, un pasajero puede pagar de más o quedarse sin su reintegro. Borra todo lo que
crea. `test:cash-rides-contract` vigila el cableado en servidor, web y móvil.
