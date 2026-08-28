# Servicios programados

Vale para viajes y, desde la migración 127, también para pedidos de comida.

> **Corrección.** `jobs.scheduled_for` existía desde la migración 001 y **sólo lo
> escribía el alta de viajes**, mientras la portada del cliente prometía
> «Programar · Food o taxi». La mitad de comida de esa promesa no existía.

La ventana vive en `server/scheduling.js` y la usan las tres rutas que tocan
horarios: alta de viaje, alta de pedido y reprogramación. Vivía escrita a mano
dentro del router de viajes, y una segunda copia diverge en silencio.

## Reprogramar

`PATCH /api/jobs/:id/schedule` mueve el horario de un pedido o de un viaje —los
dos son filas de `jobs` con horario, y una ruta por servicio serían dos versiones
de la misma política—. **Sólo mientras nadie empezó**: `requested` o `accepted`,
sin conductor asignado. Después, mover la hora tira comida o le hace perder el
viaje a alguien que se comprometió, y la salida correcta es cancelar con su
política.

Antes no existía: la única salida era cancelar y volver a pedir, que le cuenta la
cancelación al cliente, suelta el precio cotizado y —si ya había pagado— dispara
un reintegro para volver a cobrar lo mismo cinco minutos después.

## Una reserva no es trabajo activo

`merchant_ready_due_at` cuenta desde el horario reservado y no desde el cobro. Y
las reservas fuera de ventana salen de `activeOrders` y de
`oldestActiveMinutes`: una reserva para la semana que viene aparecía como un
pedido de siete días de antigüedad y disparaba la alarma de demora. Se cuentan
aparte en `scheduledAhead`, para que el comercio planifique sin que le cuenten
como trabajo pendiente.

## Ventana

El cliente puede reservar entre 30 minutos y 30 días hacia adelante. `scheduledFor` usa ISO-8601 con zona explícita y se
persiste en `jobs.scheduled_for`; el servidor vuelve a validar los límites y no
confía en la hora presentada por el cliente.

## Flujo operativo

1. `/api/rides/options` firma por cinco minutos tarifa, servicio, direcciones y
   coordenadas exactas. Cambiar cualquier elemento invalida el token.
2. `POST /api/rides` guarda la reserva y su captura Wallet de forma idempotente.
3. Se crea confirmación inmediata y un recordatorio para 30 minutos antes.
4. No se crean ofertas mientras falten más de 15 minutos.
5. El worker de dispatch incorpora automáticamente la reserva al entrar en esa
   ventana y mantiene las garantías de capacidad y aceptación atómica.
6. Cancelar retira todas las ofertas y reintegra una captura Wallet, si existía.

La app móvil ofrece Ahora, En 1 hora y Mañana, muestra fecha/hora en actividad y
mantiene la reserva como dato del backend. Un selector calendario más granular y
políticas de cancelación por ciudad siguen pendientes.
